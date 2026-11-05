/**
 * Test drive for the admin vehicle editor (`?vehicleTest=1`, embedded in the
 * editor). The editor posts a draft vehicle record whose model URL is a blob
 * URL; this page registers it exactly like a published vehicle, runs a
 * full-throttle dyno pull on the real physics, reports measured top speed and
 * 0–60 back to the editor, then lets the admin drive it on a long test pad.
 */
import * as THREE from 'three/webgpu';
import { customVehicleKind, isValidVehicleRecord, type CustomVehicleRecord } from '../../shared/CustomVehicles';
import { Engine } from '../core/Engine';
import { FixedLoop } from '../core/Loop';
import { installVehicles } from '../physics/CustomVehicleModels';
import { MPH, runDyno, type DynoResult } from '../physics/Dyno';
import { Physics } from '../physics/Physics';
import { Vehicle } from '../physics/Vehicle';

type InMsg = { type: 'tl-vehicle-test'; record: CustomVehicleRecord } | { type: 'tl-vehicle-test-rerun' };
export type TestDriveReport = { type: 'tl-vehicle-test-result'; result: DynoResult; targetTopMph: number } | { type: 'tl-vehicle-test-live'; mph: number; launch: number | null } | { type: 'tl-vehicle-test-error'; message: string };

const PAD = 2600;

function post(msg: TestDriveReport) {
  try { if (window.parent !== window) window.parent.postMessage(msg, location.origin); } catch { /* standalone */ }
}

async function measure(kind: string, targetMph: number): Promise<DynoResult> {
  const physics = await Physics.create();
  physics.addGround(PAD + 400);
  const scene = new THREE.Scene();
  const v = new Vehicle(physics, kind, 'dyno', new THREE.Vector3(-PAD, 0, 0), 0, scene);
  const result = runDyno(physics, v, { targetMph, maxDistance: PAD * 2 - 100 });
  v.dispose(scene);
  return result;
}

export async function startVehicleTestDrive(container: HTMLElement) {
  document.body.classList.add('vehicle-test');
  const start = document.getElementById('start');
  if (start) start.style.display = 'none';
  const hud = document.createElement('div');
  hud.className = 'vt-hud';
  hud.setAttribute('role', 'status');
  hud.textContent = 'Waiting for the vehicle…';
  document.body.appendChild(hud);

  const engine = await Engine.create(container);
  const physics = await Physics.create();
  physics.addGround(PAD + 400);
  const scene = engine.scene;
  scene.background = new THREE.Color(0xbfd8ea);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 60, 20);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry((PAD + 400) * 2, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.95 }));
  scene.add(ground);
  const grid = new THREE.GridHelper(80, 80, 0x6e7680, 0x50565e);
  scene.add(grid);
  for (let x = -PAD; x <= PAD; x += 50) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), new THREE.MeshStandardMaterial({ color: x % 400 === 0 ? 0xf2b544 : 0xeeeeee }));
    post.position.set(x, 0.6, -7);
    scene.add(post);
  }

  let vehicle: Vehicle | null = null;
  let record: CustomVehicleRecord | null = null;
  const keys = new Set<string>();
  addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault(); });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  let launchT: number | null = null, launchStart = 0, clock = 0, lastLive = 0, orbit = 0, tilt = 0;

  const spawn = () => {
    if (!record) return;
    vehicle?.dispose(scene);
    vehicle = new Vehicle(physics, customVehicleKind(record.id), 'test', new THREE.Vector3(-PAD + 20, 0, 0), 0, scene);
    launchT = null; launchStart = 0;
  };

  const runPull = async () => {
    if (!record) return;
    hud.textContent = 'Running a full-throttle pull…';
    try {
      const result = await measure(customVehicleKind(record.id), record.targets.zeroToMph);
      post({ type: 'tl-vehicle-test-result', result, targetTopMph: record.targets.topSpeedMph });
      hud.textContent = `Measured: top ${result.topMph} mph · 0–${result.targetMph} ${result.time === null ? 'not reached' : result.time + ' s'}. Drive with E = forward, S = reverse, A = left, D = right, arrow keys = turn the camera, Space = handbrake, R = restart.`;
    } catch {
      post({ type: 'tl-vehicle-test-error', message: 'The test pull failed.' });
    }
  };

  addEventListener('message', async (e: MessageEvent<InMsg>) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'tl-vehicle-test') {
      if (!isValidVehicleRecord(e.data.record)) { post({ type: 'tl-vehicle-test-error', message: 'That vehicle setup is incomplete.' }); return; }
      record = e.data.record;
      await installVehicles([record]);
      spawn();
      await runPull();
    } else if (e.data.type === 'tl-vehicle-test-rerun') {
      spawn();
      await runPull();
    }
  });

  const cam = engine.camera;
  const loop = new FixedLoop(60, dt => {
    clock += dt;
    const v = vehicle;
    if (v) {
      const throttle = (keys.has('e') ? 1 : 0) - (keys.has('s') ? 1 : 0);
      const steer = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      v.input = { throttle: Math.max(0, throttle), brake: throttle < 0 && v.speed > 0.5 ? 1 : 0, steer, handbrake: keys.has(' ') };
      if (throttle < 0 && v.speed <= 0.5) v.input.throttle = -1;
      if (keys.has('r')) { keys.delete('r'); spawn(); }
      const mph = v.speed / MPH;
      if (mph < 0.5 && throttle <= 0) { launchStart = 0; }
      if (throttle > 0 && launchStart === 0 && mph < 0.5) { launchStart = clock; launchT = null; }
      if (launchStart && launchT === null && mph >= 60) launchT = Math.round((clock - launchStart) * 100) / 100;
      if (clock - lastLive > 0.2) { lastLive = clock; post({ type: 'tl-vehicle-test-live', mph: Math.round(mph * 10) / 10, launch: launchT }); }
    }
    physics.step(dt);
  }, (dt, alpha) => {
    physics.interpolate(alpha);
    const v = vehicle;
    if (v) {
      v.updateVisuals(0, v.input.brake > 0);
      orbit += ((keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0)) * 1.9 * dt;
      tilt = THREE.MathUtils.clamp(tilt + ((keys.has('arrowup') ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0)) * 1.1 * dt, -0.2, 1.2);
      const fwd = v.forward().clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -orbit);
      const reach = v.preset.cam.dist * Math.cos(tilt);
      const want = v.root.position.clone().addScaledVector(fwd, -reach).add(new THREE.Vector3(0, v.preset.cam.height + v.preset.cam.dist * Math.sin(tilt), 0));
      cam.position.lerp(want, Math.min(1, dt * 5));
      cam.lookAt(v.root.position.x, v.root.position.y + 1, v.root.position.z);
      grid.position.set(Math.round(v.root.position.x), 0.01, Math.round(v.root.position.z));
    }
    engine.render();
  });
  loop.start();
  post({ type: 'tl-vehicle-test-live', mph: 0, launch: null });
}
