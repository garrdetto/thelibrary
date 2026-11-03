/**
 * Crash dents: pushes a vehicle body's vertices in toward the chassis around
 * each stored dent (chassis space, the same frame as the body group), with a
 * smooth falloff, so a front-end hit crumples the bumper and hood corners.
 * Geometry is cloned first, so models shared through the loader cache are
 * never touched.
 */
import * as THREE from 'three/webgpu';
import type { Dent } from '../../shared/Cars';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

export function applyDents(body: THREE.Object3D, dents: Dent[] | undefined) {
  if (!dents?.length) return;
  body.updateMatrixWorld(true);
  const toBody = body.matrixWorld.clone().invert();
  body.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    if (!mesh.userData.ownGeometry) { mesh.geometry = mesh.geometry.clone(); mesh.userData.ownGeometry = true; }
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const toLocal = new THREE.Matrix4().multiplyMatrices(toBody, mesh.matrixWorld);
    const fromLocal = toLocal.clone().invert();
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
      let changed = false;
      for (const d of dents) {
        const radius = 0.35 + d.depth * 4;
        const dist = Math.hypot(_p.x - d.x, _p.y - d.y, _p.z - d.z);
        if (dist >= radius) continue;
        const k = (1 - dist / radius) ** 2 * d.depth;
        _n.set(d.x, 0, d.z);
        if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
        _n.normalize();
        _p.addScaledVector(_n, -k);
        _p.y -= k * 0.25;
        changed = true;
      }
      if (!changed) continue;
      _p.applyMatrix4(fromLocal);
      pos.setXYZ(i, _p.x, _p.y, _p.z);
      moved = true;
    }
    if (moved) { pos.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere(); }
  });
}

/** Where on the chassis a hit landed: the point on the body's outline facing the blow. */
export function impactPoint(chassis: { hx: number; hy: number; hz: number }, localDx: number, localDz: number) {
  const len = Math.hypot(localDx, localDz) || 1;
  const dx = -localDx / len, dz = -localDz / len;
  const s = Math.min(Math.abs(dx) > 1e-4 ? chassis.hx / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-4 ? chassis.hz / Math.abs(dz) : Infinity);
  return { x: dx * s, y: chassis.hy * 0.4, z: dz * s };
}
