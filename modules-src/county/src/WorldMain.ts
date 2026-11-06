/**
 * Kestrel County, Phase 1: the streamed county with walking and driving.
 * The resident starts at home on Juniper Street with the Maple Hauler in the
 * driveway; F8 opens the developer panel. `?hour=` pins the time of day,
 * `?dev=1` loads the admin's draft vehicles and `?panel=1` opens the panel.
 */
import type { Renderer } from './core/Renderer';
import type { Kit } from './style/Kit';
import type { Sky } from './world/Sky';
import { Physics } from '../../foxplains2/src/physics/Physics';
import { county } from '../shared/County';
import { rowHalf } from '../shared/Roads';
import { Chunks } from './world/Chunks';
import { lotPoint } from './world/Scatter';
import { Game } from './game/Game';
import { DevPanel } from './game/DevPanel';
import { registerVehicles } from './game/Vehicles';
import { STARTER_TRUCK } from '../../maplestreet/shared/Economy';

const params = new URLSearchParams(location.search);
const DAY_MINUTES = 48;

export async function bootWorld(r: Renderer, kit: Kit, sky: Sky, say: (s: string) => void) {
  say('Setting up the county…');
  const [physics] = await Promise.all([Physics.create(), registerVehicles()]);
  const c = county();
  const chunks = new Chunks(r.app, kit, c, physics);
  const game = new Game(r, sky, c, chunks, physics);
  const { net } = c;
  const home = net.lots.find(l => l.house >= 0 && net.edges[l.edge].name === 'Juniper Street' && l.origin[0] > -1060) ?? net.lots.find(l => l.house >= 0)!;
  const e = net.edges[home.edge];
  const [hx, hz] = lotPoint(home, 3.5, 6);
  await game.start({ x: hx, z: hz, yaw: home.yaw + Math.PI }, left => say(`Building the neighbourhood… ${left}`));
  const [dx, dz] = net.offset(e, home.drive, home.side * (rowHalf(e.cls) + 6.5));
  game.addVehicle(STARTER_TRUCK, { x: dx, z: dz, yaw: home.yaw - Math.PI / 2 });

  const pinned = params.has('hour') && Number.isFinite(Number(params.get('hour')));
  sky.setHours(pinned ? Number(params.get('hour')) : 10);
  const place = (name: string, edge: string, frac = 0.5) => {
    const ed = net.edges.find(x => x.name === edge)!, p = net.pointAt(ed, ed.len * frac);
    return { name, x: p.x - p.tz * (rowHalf(ed.cls) + 1.5), z: p.z + p.tx * (rowHalf(ed.cls) + 1.5) };
  };
  const places = [
    { name: 'Home', x: hx, z: hz },
    place('Main Street', 'Main Street'), place('Ridge Road', 'Ridge Road', 0.45), place('County Road south', 'County Road', 0.3),
    { name: 'Airport site', x: 640, z: 200 },
  ];
  const hud = { where: document.getElementById('where')!, speed: document.getElementById('speed')!, hint: document.getElementById('hint')!, stats: document.getElementById('stats')! };
  const nearestStreet = (x: number, z: number) => {
    let best = '', bd = 40;
    for (const [id, n] of net.nearest(x, z, 1)) if (n.d < bd) { bd = n.d; best = net.edges[id].name; }
    return best || 'Open country';
  };
  let fps = 60, clock = 0;
  r.app.on('update', (dt: number) => {
    if (!pinned) sky.setHours((sky.hours + (dt * 24) / (DAY_MINUTES * 60)) % 24);
    sky.update(dt, r.camera.getPosition());
    kit.setNight(sky.night);
    r.setNight(sky.night);
    r.adapt(dt);
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    if ((clock += dt) > 0.25) {
      clock = 0;
      const p = game.here;
      hud.where.textContent = nearestStreet(p.x, p.z);
      hud.speed.textContent = game.driving ? `${Math.round(Math.abs(game.driving.speed) * 2.237)} mph` : '';
      hud.hint.textContent = game.hint;
      hud.stats.textContent = `${sky.clockLabel} · ${Math.round(fps)} fps`;
    }
  });
  const panel = new DevPanel(game, {
    setHour: h => sky.setHours(h), hours: () => sky.hours, places,
    stats: () => {
      const draws = (r.app.stats as unknown as { drawCalls?: { total?: number } }).drawCalls?.total ?? 0;
      return `${Math.round(fps)} fps · ${draws} draws · ${chunks.busy} streaming jobs · scale ${r.renderScale.toFixed(2)}`;
    },
  });
  if (params.get('panel') === '1') panel.toggle(true);
  addEventListener('message', ev => {
    if (ev.origin === location.origin && ev.source === window.parent && (ev.data as { type?: string })?.type === 'tl-dev-panel') panel.toggle();
  });
  (window as unknown as { county: object }).county = {
    game, chunks, net, setHour: (h: number) => sky.setHours(h), teleport: (x: number, z: number) => game.teleport(x, z),
    info: () => ({ fps: Math.round(fps), busy: chunks.busy, at: game.here, driving: game.driving?.kind ?? null }),
  };
}
