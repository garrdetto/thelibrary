/**
 * Kestrel County, Phase 0: boots the renderer, the clipart kit and sky, and
 * the look-development scene, then wires the view, time-of-day and quality
 * controls. `?hour=`, `?view=street|hangar|helicopter|aerial`, `?quality=`
 * and `?ui=0` (no panel, for screenshots) set it up from the address bar;
 * `window.county` does the same from the console or a test harness.
 */
import * as pc from 'playcanvas';
import { Renderer } from './core/Renderer';
import { Kit } from './style/Kit';
import { Sky } from './world/Sky';
import { buildLookDev } from './world/LookDev';
import { OrbitCamera } from './game/OrbitCamera';
import { LIGHT, TIMES, VIEWS, type TimeName, type ViewName } from '../config';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot() {
  const status = $('status');
  if (params.get('ui') === '0') document.body.classList.add('clean');
  let r: Renderer;
  try {
    r = await Renderer.create($('app'));
  } catch {
    status.textContent = 'This browser could not start WebGL2.';
    return;
  }
  const kit = new Kit();
  const sky = new Sky(r);
  const asked = Number(params.get('hour'));
  sky.setHours(Number.isFinite(asked) && params.has('hour') ? asked : TIMES.noon);
  const scene = buildLookDev(r, kit);
  const cam = new OrbitCamera(r.camera, $('app'));
  const startView = (params.get('view') ?? 'street') as ViewName;
  cam.setView(startView in VIEWS ? startView : 'street', true);

  let rotorSpin = params.get('rotor') === '1' ? 1 : 0;
  let fpsAvg = 60;
  const setHour = (h: number) => { sky.setHours(h); syncButtons(); };
  const setView = (v: ViewName) => cam.setView(v);

  const qualityBtn = $<HTMLButtonElement>('quality');
  const rotorBtn = $<HTMLButtonElement>('rotor');
  const syncButtons = () => {
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-time]')) b.setAttribute('aria-pressed', String(Math.abs(TIMES[b.dataset.time as TimeName] - sky.hours) < 0.05));
    qualityBtn.textContent = `Quality: ${r.quality}`;
    rotorBtn.setAttribute('aria-pressed', String(rotorSpin > 0));
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view as ViewName));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-time]')) b.addEventListener('click', () => setHour(TIMES[b.dataset.time as TimeName]));
  qualityBtn.addEventListener('click', () => { r.cycleQuality(); syncButtons(); });
  rotorBtn.addEventListener('click', () => { rotorSpin = rotorSpin ? 0 : 1; syncButtons(); });
  addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    const views = Object.keys(VIEWS) as ViewName[];
    const n = Number(e.key);
    if (n >= 1 && n <= views.length) setView(views[n - 1]);
    if (e.key === 't' || e.key === 'T') {
      const times = Object.values(TIMES);
      const next = times.find(t => t > sky.hours + 0.05) ?? times[0];
      setHour(next);
    }
    if (e.key === 'q' || e.key === 'Q') { r.cycleQuality(); syncButtons(); }
  });
  syncButtons();

  const stats = $('stats');
  let statClock = 0, rotorSpeed = 0;
  r.app.on('update', (dt: number) => {
    cam.update(dt);
    sky.update(dt, cam.position);
    kit.setNight(sky.night);
    r.setNight(sky.night);
    r.adapt(dt);
    for (const l of scene.lamps) l.light!.intensity = LIGHT.lampIntensity * sky.night;
    scene.sign.emissiveIntensity = 0.05 + sky.night * 0.5;
    scene.sign.update();
    rotorSpeed += (rotorSpin * 6.6 - rotorSpeed) * Math.min(1, dt * 0.4);
    scene.heli.rotor.rotateLocal(0, rotorSpeed * dt * pc.math.RAD_TO_DEG * 6.28, 0);
    scene.heli.tailRotor.rotateLocal(0, 0, rotorSpeed * 5.6 * dt * pc.math.RAD_TO_DEG * 6.28);
    fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
    statClock += dt;
    if (statClock > 0.5) {
      statClock = 0;
      const draws = (r.app.stats as unknown as { drawCalls?: { total?: number } }).drawCalls?.total ?? 0;
      stats.textContent = `${sky.clockLabel} · ${Math.round(fpsAvg)} fps · ${draws} draws · ${(scene.triangles / 1000).toFixed(0)}k tris`;
    }
  });

  (window as unknown as { county: object }).county = {
    setHour, setView, quality: (q: 'low' | 'medium' | 'high') => { r.setQuality(q); syncButtons(); },
    rotor: (on: boolean) => { rotorSpin = on ? 1 : 0; syncButtons(); },
    info: () => ({ hours: sky.hours, quality: r.quality, fps: Math.round(fpsAvg), triangles: scene.triangles, breakdown: scene.breakdown, frameMs: r.frameMs, scale: r.renderScale }),
  };
  status.textContent = '';
  document.body.classList.add('ready');
}

void boot();
