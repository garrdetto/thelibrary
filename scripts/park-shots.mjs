// Thrill Park graphics harness: matched screenshots, an in-park frame-time sample and a renderer audit.
//
//   node scripts/park-shots.mjs --out docs/park-graphics/after          screenshots + perf + audit
//   node scripts/park-shots.mjs --out <dir> --quality low|medium|high     force a quality tier (default: auto)
//   node scripts/park-shots.mjs --out <dir> --no-perf                     screenshots only
//   node scripts/park-shots.mjs --out <dir> --edition 2                   Thrill Park 2 (Babylon.js) instead of Thrill Park
//
// It opens Thrill Park from `pnpm dev` (started here when nothing answers on the port) in headless Chromium with
// SwiftShader at 1280×800, starts a sandbox park, swaps in the deterministic scene from scripts/park-scene.mjs, renders
// each camera from src/lib/park/shotCams.ts at 1280×800 (JPEG) plus captureOverview (JPEG), then samples every
// animation frame of the running park for --sample ms after --warmup ms and counts GPU draw calls per frame.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const flag = (name) => args.includes(`--${name}`);
const port = Number(option('port', '3000'));
const out = option('out', 'docs/park-graphics/current');
const quality = option('quality', '');
const warmupMs = Number(option('warmup', '6000'));
const sampleMs = Number(option('sample', '15000'));
const base = `http://localhost:${port}`;
const edition = option('edition', '1') === '2' ? 2 : 1;
const browserArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function up() { try { const r = await fetch(base); return r.ok || r.status < 500; } catch { return false; } }
async function ensureServer() {
  if (await up()) return null;
  const child = spawn('pnpm', ['dev'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 240; i++) { if (await up()) return child; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('pnpm dev did not start');
}

const probe = () => {
  const state = { draws: 0, recording: false, frames: [], perFrame: [] };
  Object.defineProperty(window, '__parkProbe', { value: state });
  const proto = window.WebGL2RenderingContext?.prototype;
  for (const name of ['drawArrays', 'drawArraysInstanced', 'drawElements', 'drawElementsInstanced']) {
    const original = proto?.[name];
    if (typeof original !== 'function') continue;
    proto[name] = function counted(...rest) { state.draws += 1; return original.apply(this, rest); };
  }
  const tick = (now) => {
    if (state.recording) { state.frames.push(now); state.perFrame.push(state.draws); }
    state.draws = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

mkdirSync(out, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch({ args: browserArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.addInitScript(probe);
  await page.goto(`${base}/${quality ? `?quality=${quality}` : ''}#park${edition === 2 ? '2' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pk-btn-go', { timeout: 120000 });
  await page.locator('.pk-btn-go').first().click();
  await page.waitForFunction(() => window.__park?.renderer, null, { timeout: 60000 });
  const info = await page.evaluate(async () => {
    const m = await import('/server/park/index.mjs');
    const { buildScene } = await import('/scripts/park-scene.mjs');
    const { state } = buildScene(m);
    const { session, renderer } = window.__park;
    session.state = state;
    renderer.setState(state, 0);
    return { guests: state.guests.length, entities: Object.keys(state.entities).length, quality: renderer.quality ?? 'n/a', tier: renderer.qualityReason ?? '' };
  });
  console.log('scene', info);
  await page.waitForTimeout(1500);
  const only = option('only', '').split(',').filter(Boolean);
  const names = ['station', 'flat', 'waterRide', 'wavePool', 'hotel', 'shoreline'].filter((n) => !only.length || only.includes(n));
  for (const name of names) {
    const shot = await page.evaluate(async ([name, day, tierHigh]) => {
      const { shotCamera } = await import('/src/lib/park/shotCams.ts');
      const { session, renderer } = window.__park;
      const cam = shotCamera(session.state, name);
      if (!cam) return null;
      renderer.renderShot(cam, 1280, 800, 'image/jpeg', day, tierHigh);
      return renderer.renderShot(cam, 1280, 800, 'image/jpeg', day, tierHigh);
    }, [name, Number(option('day', '0.45')), !flag('current-tier')]);
    if (shot) writeFileSync(`${out}/${name}.jpg`, Buffer.from(shot.data, 'base64'));
    console.log(name, shot ? 'ok' : 'missing');
  }
  const overview = !only.length || only.includes('overview') ? await page.evaluate(() => window.__park.renderer.captureOverview()) : null;
  if (overview) writeFileSync(`${out}/overview.jpg`, Buffer.from(overview.data, 'base64'));
  console.log('overview', overview ? `${Math.round(overview.data.length * 0.75 / 1024)} KB ${overview.mime}` : 'missing');

  const audit = await page.evaluate(() => {
    const r = window.__park.renderer;
    const verts = (mesh) => (mesh ? mesh.count : 0);
    const kinds = {};
    for (const [key, mesh] of r.kindMeshes) {
      const group = key.replace(/:\d+(:\d)?$/, '').replace(/^person:\d+/, 'person');
      const row = kinds[group] ?? (kinds[group] = { meshes: 0, verts: 0, maxVerts: 0, instances: 0 });
      row.meshes++; row.verts += verts(mesh); row.maxVerts = Math.max(row.maxVerts, verts(mesh)); row.instances += mesh?.instanceCount ?? 0;
    }
    const rides = {};
    for (const [key, model] of r.rideModels) rides[key] = verts(model.base) + model.parts.reduce((a, p) => a + verts(p.mesh), 0);
    const tracks = {};
    for (const [id, cache] of r.rides) { const e = r.state.entities[id]; tracks[`${e?.style}#${id}`] = verts(cache.track); }
    const hotels = {};
    for (const [id, entry] of r.hotelMeshes) hotels[String(id)] = verts(entry.mesh);
    return { kinds, rides, tracks, hotels, terrain: verts(r.terrain), water: verts(r.water), paths: verts(r.paths) };
  });
  writeFileSync(`${out}/audit.json`, JSON.stringify(audit, null, 1));

  if (flag('shots-only')) { await browser.close(); if (server) { try { process.kill(-server.pid); } catch {} } process.exit(0); }
  const split = await page.evaluate(() => {
    const { renderer } = window.__park, gl = renderer.g.gl ?? renderer.g.device.gl;
    renderer.focusPark(); renderer.cam.dist = 70;
    const px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (n) => { sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) { renderer.frame(performance.now()); sync(); } return (performance.now() - t0) / n; };
    time(1);
    const full = time(3), stats = { ...renderer.g.stats };
    renderer.debug.noShadow = true; const noShadow = time(3); renderer.debug.noShadow = false;
    return { canvas: [renderer.canvas.width, renderer.canvas.height], frameMs: full, noShadowMs: noShadow, shadowPassMs: full - noShadow, ...stats };
  });
  writeFileSync(`${out}/split.json`, JSON.stringify(split, null, 1));
  console.log('split', split);

  if (!flag('no-perf')) {
    await page.evaluate(() => { const { renderer } = window.__park; renderer.focusPark(); renderer.cam.dist = 70; });
    await page.waitForTimeout(warmupMs);
    await page.evaluate(() => { window.__parkProbe.frames.length = 0; window.__parkProbe.perFrame.length = 0; window.__parkProbe.recording = true; });
    await page.waitForTimeout(sampleMs);
    const perf = await page.evaluate(() => {
      const p = window.__parkProbe; p.recording = false;
      const f = p.frames, gaps = [];
      for (let i = 1; i < f.length; i++) gaps.push(f[i] - f[i - 1]);
      gaps.sort((a, b) => b - a);
      const worst = gaps.slice(0, Math.max(1, Math.floor(gaps.length / 100)));
      const span = (f[f.length - 1] - f[0]) / 1000;
      const draws = p.perFrame.slice(1);
      return { sampleDraws: p.perFrame.slice(0, 5), frames: f.length, avgFps: (f.length - 1) / span, lowFps: 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length), avgMs: gaps.reduce((a, b) => a + b, 0) / gaps.length, drawsPerFrame: draws.reduce((a, b) => a + b, 0) / draws.length };
    });
    const client = await page.context().newCDPSession(page);
    await client.send('HeapProfiler.collectGarbage');
    const { metrics } = await client.send('Performance.getMetrics').catch(() => ({ metrics: [] }));
    await client.send('Performance.enable');
    const heap = (await client.send('Performance.getMetrics')).metrics.find((x) => x.name === 'JSHeapUsedSize')?.value;
    void metrics;
    perf.heapMB = heap ? heap / 1048576 : null;
    writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 1));
    console.log('perf', perf);
  }
} finally {
  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch {} }
}
