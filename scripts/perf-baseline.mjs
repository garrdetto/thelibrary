// Performance baseline for every learning module.
//
//   node scripts/perf-baseline.mjs                 measure and write docs/PERF-BASELINE.md
//   node scripts/perf-baseline.mjs --compare       measure and compare with docs/PERF-BASELINE.md (exit 1 on regressions)
//   node scripts/perf-baseline.mjs --check         only verify docs/PERF-BASELINE.md lists every module (no browser; used by CI)
//
// Options: --port 3000, --only id,id, --warmup 10000, --sample 20000, --out docs/PERF-BASELINE.md, --no-prewarm
//
// Each module is opened from `pnpm dev` (started here when nothing answers on the port) in a fresh
// Playwright Chromium context, exactly as a visitor opens it from the hub: embedded modules at
// `/#module-<id>` inside the hub iframe, racing, oval and park at their hash, pool from its hub card.
// After the warm-up the script records every animation frame for the sample window.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const port = Number(option('port', '3000'));
const warmupMs = Number(option('warmup', '10000'));
const sampleMs = Number(option('sample', '20000'));
const outPath = option('out', 'docs/PERF-BASELINE.md');
const only = option('only', '').split(',').map((id) => id.trim()).filter(Boolean);
const base = `http://localhost:${port}`;
const viewport = { width: 1280, height: 800 };
const browserArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const hashRoutes = { racing: '#racing', oval: '#oval', park: '#park' };
const tolerance = { fps: 0.1, ttff: 0.15, heap: 0.15, draws: 0.1, js: 0.1 };

function readCatalog() {
  const source = readFileSync('src/lib/modules.ts', 'utf8');
  const embeddedBlock = source.slice(source.indexOf('embeddedModules'), source.indexOf('] as const'));
  const embedded = new Set([...embeddedBlock.matchAll(/id: '([^']+)'/g)].map((match) => match[1]));
  const learningBlock = source.slice(source.indexOf('learningModules: LearningModule[]'));
  const modules = [...learningBlock.matchAll(/\{ id: '([^']+)', title: '([^']+)'/g)].map((match) => ({
    id: match[1],
    title: match[2],
    embedded: embedded.has(match[1]),
  }));
  return modules;
}

const probe = () => {
  const state = {
    origin: performance.timeOrigin,
    firstGpu: null,
    first2d: null,
    gpuCalls: 0,
    renderers: [],
    recording: false,
    frames: [],
    gpuPerFrame: [],
    threePerFrame: [],
  };
  Object.defineProperty(window, '__tlPerf', { value: state, enumerable: false });

  const devtools = new EventTarget();
  devtools.addEventListener('observe', (event) => {
    const target = event.detail;
    if (target && target.info && target.info.render && !state.renderers.includes(target)) state.renderers.push(target);
  });
  try {
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { value: devtools, configurable: true, writable: true });
  } catch {}

  const wrapCounter = (proto, names, kind) => {
    if (!proto) return;
    for (const name of names) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function counted(...rest) {
        state.gpuCalls += 1;
        if (state.firstGpu === null) state.firstGpu = { at: performance.now(), kind };
        return original.apply(this, rest);
      };
    }
  };
  const glDraws = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  wrapCounter(window.WebGLRenderingContext && WebGLRenderingContext.prototype, glDraws, 'webgl');
  wrapCounter(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, glDraws, 'webgl');
  wrapCounter(window.GPURenderPassEncoder && GPURenderPassEncoder.prototype, ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect'], 'webgpu');
  wrapCounter(window.GPURenderBundleEncoder && GPURenderBundleEncoder.prototype, ['draw', 'drawIndexed'], 'webgpu');

  const canvasProto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (canvasProto) {
    const names = ['drawImage', 'fillRect', 'fill', 'stroke', 'fillText', 'putImageData'];
    const originals = Object.fromEntries(names.map((name) => [name, canvasProto[name]]));
    const restore = () => {
      for (const name of names) canvasProto[name] = originals[name];
    };
    for (const name of names) {
      canvasProto[name] = function firstPaint(...rest) {
        if (state.first2d === null) state.first2d = performance.now();
        restore();
        return originals[name].apply(this, rest);
      };
    }
  }

  let lastGpu = 0;
  const tick = (time) => {
    if (state.recording) {
      state.frames.push(time);
      state.gpuPerFrame.push(state.gpuCalls - lastGpu);
      if (state.renderers.length) {
        let calls = 0;
        for (const renderer of state.renderers) calls += renderer.info.render.calls || 0;
        state.threePerFrame.push(calls);
      }
    }
    lastGpu = state.gpuCalls;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  state.start = () => {
    state.frames = [];
    state.gpuPerFrame = [];
    state.threePerFrame = [];
    state.recording = true;
  };
  state.stop = () => {
    state.recording = false;
    const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
    return {
      origin: state.origin,
      firstGpu: state.firstGpu,
      first2d: state.first2d,
      fcp: paint ? paint.startTime : null,
      frames: state.frames,
      gpuPerFrame: state.gpuPerFrame,
      threePerFrame: state.threePerFrame,
      renderers: state.renderers.length,
      three: window.__THREE__ || null,
    };
  };
};

async function serverUp() {
  try {
    const response = await fetch(`${base}/`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverUp()) return null;
  const child = spawn('pnpm', ['dev', '--port', String(port)], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await serverUp()) return child;
  }
  process.kill(-child.pid);
  throw new Error(`dev server did not start on port ${port}`);
}

async function openModule(page, module) {
  if (module.embedded) {
    await page.goto(`${base}/#module-${module.id}`, { waitUntil: 'load' });
    const handle = await page.waitForSelector('.play-frame iframe', { timeout: 30000 });
    const frame = await handle.contentFrame();
    if (!frame) throw new Error('module iframe has no frame');
    await frame.waitForLoadState('load').catch(() => {});
    return { frame, anchor: 0 };
  }
  if (hashRoutes[module.id]) {
    await page.goto(`${base}/${hashRoutes[module.id]}`, { waitUntil: 'load' });
    return { frame: page.mainFrame(), anchor: 0 };
  }
  await page.goto(`${base}/`, { waitUntil: 'load' });
  const card = page.locator('.module-card', { hasText: module.title }).first();
  await card.waitFor({ timeout: 30000 });
  const anchor = await page.evaluate(() => performance.now());
  await card.click({ timeout: 30000 });
  return { frame: page.mainFrame(), anchor };
}

async function prewarm(browser, module) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await openModule(page, module).catch(() => {});
  await page.waitForTimeout(4000);
  await context.close();
}

function summarize(raw, topOrigin, anchor, embedded) {
  const intervals = [];
  for (let i = 1; i < raw.frames.length; i += 1) intervals.push(raw.frames[i] - raw.frames[i - 1]);
  const span = raw.frames.length > 1 ? raw.frames[raw.frames.length - 1] - raw.frames[0] : 0;
  const avgFps = span > 0 ? ((raw.frames.length - 1) * 1000) / span : 0;
  const worst = [...intervals].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(intervals.length * 0.01)));
  const worstMean = worst.length ? worst.reduce((sum, value) => sum + value, 0) / worst.length : 0;
  const lowFps = worstMean > 0 ? 1000 / worstMean : 0;
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const offset = raw.origin - topOrigin;
  const since = (time) => (time === null || time === undefined || time + offset < anchor ? null : time + offset - anchor);
  const candidates = [
    [since(raw.firstGpu && raw.firstGpu.at), raw.firstGpu && raw.firstGpu.kind],
    [since(raw.first2d), 'canvas2d'],
    [embedded ? since(raw.fcp) : null, 'fcp'],
  ];
  const [firstFrame, firstSource] = candidates.find(([time]) => time !== null) || [null, 'none'];
  const threeCalls = mean(raw.threePerFrame);
  const gpuCalls = mean(raw.gpuPerFrame);
  return {
    ttffMs: firstFrame,
    ttffSource: firstSource,
    avgFps,
    lowFps,
    frames: raw.frames.length,
    drawCalls: threeCalls,
    gpuDraws: gpuCalls && gpuCalls > 0 ? gpuCalls : null,
    three: raw.three,
  };
}

async function measure(browser, module) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(probe);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Performance.enable');
  const types = new Map();
  let totalBytes = 0;
  let jsBytes = 0;
  cdp.on('Network.responseReceived', (event) => types.set(event.requestId, event.type));
  cdp.on('Network.loadingFinished', (event) => {
    totalBytes += event.encodedDataLength;
    if (types.get(event.requestId) === 'Script') jsBytes += event.encodedDataLength;
  });
  let result;
  try {
    const { frame, anchor } = await openModule(page, module);
    const topOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.waitForTimeout(warmupMs);
    await frame.evaluate(() => window.__tlPerf.start());
    await page.waitForTimeout(sampleMs);
    const raw = await frame.evaluate(() => window.__tlPerf.stop());
    const metrics = await cdp.send('Performance.getMetrics');
    const heap = metrics.metrics.find((metric) => metric.name === 'JSHeapUsedSize');
    result = {
      id: module.id,
      title: module.title,
      ok: true,
      ...summarize(raw, topOrigin, anchor, module.embedded),
      heapBytes: heap ? heap.value : null,
      totalBytes,
      jsBytes,
      errors: errors.length,
    };
  } catch (error) {
    result = { id: module.id, title: module.title, ok: false, failure: error.message.split('\n')[0], totalBytes, jsBytes, errors: errors.length };
  }
  await context.close();
  return result;
}

const fmt = {
  ms: (value) => (value === null || value === undefined ? '—' : `${Math.round(value).toLocaleString('en-US')}`),
  fps: (value) => (value === null || value === undefined ? '—' : value.toFixed(1)),
  mb: (value) => (value === null || value === undefined ? '—' : (value / 1048576).toFixed(1)),
  kb: (value) => (value === null || value === undefined ? '—' : Math.round(value / 1024).toLocaleString('en-US')),
  calls: (value) => (value === null || value === undefined ? '—' : value.toFixed(0)),
};

function renderMarkdown(results, meta) {
  const lines = [
    '# Performance baseline',
    '',
    `Measured ${meta.date} by \`node scripts/perf-baseline.mjs\` against \`pnpm dev\` (commit \`${meta.commit}\`).`,
    `Headless Playwright Chromium ${meta.browser}, software WebGL (SwiftShader), viewport ${viewport.width}×${viewport.height}, cache disabled, one fresh context per module.`,
    `Each module is opened from the hub as a visitor would, left for ${warmupMs / 1000} s, then every animation frame is recorded for ${sampleMs / 1000} s.`,
    '',
    'These are the numbers every later phase must beat. Re-measure with `node scripts/perf-baseline.mjs --compare` on the same machine class; absolute FPS under software WebGL is far below a real GPU, so compare runs, not machines.',
    '',
    '| Module | id | First frame (ms) | Avg FPS | 1% low FPS | JS heap (MB) | Draw calls (renderer.info) | GPU draws / frame | Transferred (KB) | JS (KB) | three.js | Page errors |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |',
  ];
  for (const row of results) {
    if (!row.ok) {
      lines.push(`| ${row.title} | \`${row.id}\` | failed: ${row.failure.replace(/\|/g, '/')} | — | — | — | — | — | ${fmt.kb(row.totalBytes)} | ${fmt.kb(row.jsBytes)} | — | ${row.errors} |`);
      continue;
    }
    const ttff = `${fmt.ms(row.ttffMs)}${row.ttffSource === 'webgl' || row.ttffSource === 'none' ? '' : ` (${row.ttffSource})`}`;
    lines.push(`| ${row.title} | \`${row.id}\` | ${ttff} | ${fmt.fps(row.avgFps)} | ${fmt.fps(row.lowFps)} | ${fmt.mb(row.heapBytes)} | ${fmt.calls(row.drawCalls)} | ${fmt.calls(row.gpuDraws)} | ${fmt.kb(row.totalBytes)} | ${fmt.kb(row.jsBytes)} | ${row.three ? `r${row.three}` : '—'} | ${row.errors} |`);
  }
  lines.push(
    '',
    '## Columns',
    '',
    '- First frame: milliseconds from opening the module (hub navigation, or the hub-card click for pool) to its first WebGL/WebGPU draw call; `(canvas2d)` marks the first 2D canvas draw and `(fcp)` the iframe first contentful paint for embedded modules that draw neither. `—` means the landing screen draws no canvas (for example a sign-in prompt or menu).',
    '- Avg FPS: frames recorded divided by the sample window. 1% low FPS: 1000 divided by the mean of the slowest 1% of frame intervals.',
    '- JS heap: `JSHeapUsedSize` from the Chrome DevTools Protocol at the end of the sample (hub page and module iframe share one heap).',
    '- Draw calls (renderer.info): `renderer.info.render.calls` sampled every frame and averaged, summed over every three.js renderer found through the `__THREE_DEVTOOLS__` hook. three.js resets it on each `render()` call, so a module that renders several passes per frame reports only its last pass here.',
    '- GPU draws / frame: every WebGL `draw*` and WebGPU `draw*` call counted by wrapping the context prototypes, averaged per frame; this covers all passes and non-three.js renderers. `—` means nothing drew on the GPU during the sample.',
    '- Transferred / JS: encoded bytes over the network for the whole run, all resources and scripts only. `pnpm dev` serves unminified sources, so these are larger than production but comparable run to run.',
    '- Page errors: uncaught exceptions during the run.',
    '',
    '<!-- perf-data',
    JSON.stringify({ meta, results }),
    '-->',
    '',
  );
  return lines.join('\n');
}

function readBaseline() {
  if (!existsSync(outPath)) return null;
  const text = readFileSync(outPath, 'utf8');
  const match = text.match(/<!-- perf-data\n([\s\S]*?)\n-->/);
  return match ? JSON.parse(match[1]) : null;
}

function check() {
  const baseline = readBaseline();
  if (!baseline) {
    console.error(`${outPath} is missing or has no perf-data block; run node scripts/perf-baseline.mjs`);
    process.exit(1);
  }
  const recorded = new Set(baseline.results.map((row) => row.id));
  const missing = readCatalog().filter((module) => !recorded.has(module.id)).map((module) => module.id);
  if (missing.length) {
    console.error(`${outPath} has no row for: ${missing.join(', ')}; re-run node scripts/perf-baseline.mjs`);
    process.exit(1);
  }
  console.log(`perf baseline: ${baseline.results.length} modules recorded on ${baseline.meta.date} (commit ${baseline.meta.commit})`);
}

function compare(results, baseline) {
  const previous = new Map(baseline.results.map((row) => [row.id, row]));
  const regressions = [];
  for (const row of results) {
    const old = previous.get(row.id);
    if (!old || !old.ok) continue;
    if (!row.ok) {
      regressions.push(`${row.id}: failed (${row.failure})`);
      continue;
    }
    const worse = (label, now, then, limit, higherIsBetter) => {
      if (now === null || then === null || now === undefined || then === undefined || then === 0) return;
      const change = (now - then) / then;
      const bad = higherIsBetter ? change < -limit : change > limit;
      console.log(`  ${row.id.padEnd(12)} ${label.padEnd(12)} ${then.toFixed(1)} -> ${now.toFixed(1)} (${(change * 100).toFixed(1)}%)${bad ? '  REGRESSION' : ''}`);
      if (bad) regressions.push(`${row.id}: ${label} ${then.toFixed(1)} -> ${now.toFixed(1)}`);
    };
    worse('avg fps', row.avgFps, old.avgFps, tolerance.fps, true);
    worse('1% low fps', row.lowFps, old.lowFps, tolerance.fps, true);
    worse('first frame', row.ttffMs, old.ttffMs, tolerance.ttff, false);
    worse('heap', row.heapBytes, old.heapBytes, tolerance.heap, false);
    worse('draw calls', row.drawCalls, old.drawCalls, tolerance.draws, false);
    worse('gpu draws', row.gpuDraws, old.gpuDraws, tolerance.draws, false);
    worse('js bytes', row.jsBytes, old.jsBytes, tolerance.js, false);
  }
  return regressions;
}

async function gitCommit() {
  return new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', '--short', 'HEAD']);
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('close', () => resolve(out.trim() || 'unknown'));
    child.on('error', () => resolve('unknown'));
  });
}

if (flag('check')) {
  check();
  process.exit(0);
}

const catalog = readCatalog();
const targets = only.length ? catalog.filter((module) => only.includes(module.id)) : catalog;
const server = await ensureServer();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined, args: browserArgs });
try {
  if (!flag('no-prewarm')) {
    for (const module of targets) await prewarm(browser, module);
  }
  const results = [];
  for (const module of targets) {
    const row = await measure(browser, module);
    console.log(row.ok
      ? `${row.id}: first frame ${fmt.ms(row.ttffMs)} ms, ${fmt.fps(row.avgFps)} fps avg, ${fmt.fps(row.lowFps)} fps 1% low, ${fmt.mb(row.heapBytes)} MB heap, ${fmt.calls(row.drawCalls)} three draws, ${fmt.calls(row.gpuDraws)} gpu draws, ${fmt.kb(row.totalBytes)} KB`
      : `${row.id}: failed (${row.failure})`);
    results.push(row);
  }
  if (flag('compare')) {
    const baseline = readBaseline();
    if (!baseline) throw new Error(`${outPath} has no perf-data block to compare with`);
    const regressions = compare(results, baseline);
    if (regressions.length) {
      console.error(`\n${regressions.length} regression(s):\n${regressions.join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('\nno regressions against the baseline');
    }
  } else {
    const previous = only.length ? readBaseline() : null;
    if (previous) {
      const fresh = new Map(results.map((row) => [row.id, row]));
      const merged = previous.results.map((row) => fresh.get(row.id) || row);
      for (const row of results) if (!merged.some((item) => item.id === row.id)) merged.push(row);
      results.splice(0, results.length, ...merged);
    }
    const meta = { date: new Date().toISOString().slice(0, 10), commit: await gitCommit(), browser: browser.version(), warmupMs, sampleMs };
    writeFileSync(outPath, renderMarkdown(results, meta));
    console.log(`wrote ${outPath}`);
  }
} finally {
  await browser.close();
  if (server) process.kill(-server.pid);
}
