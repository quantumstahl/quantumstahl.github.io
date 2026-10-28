import * as THREE from "three";
import { WarpSurfacePicker } from "./WarpSurfacePicker.js";

// Canonical terrain picking, independent of terrain render meshes/LOD/GPU
// residency. WarpSurfacePicker handles all displaced source triangles,
// including overlapping folds and the fixed Rockify shell. Ordinary terrain
// uses a 2D grid traversal and exact triangle intersections without allocating
// tiles. There is no approximate heightfield hit or inverse-warp iteration.
export class ObjectSurfacePicker {
  constructor(provider) {
    this.provider = provider; this.warped = new WarpSurfacePicker(provider);
    this.intersection = new THREE.Vector3();
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3(); this.d = new THREE.Vector3();
    this.warp = { x: 0, z: 0 };
  }
  vertex(x, z, target) {
    this.provider.sampleWarp(x, z, this.warp);
    return target.set(x + this.warp.x, this.provider.sampleHeightCached(x, z), z + this.warp.z);
  }
  pick(ray, maxDistance = 6000) {
    let best = this.warped.pick(ray);
    if (best?.distance > maxDistance) best = null;
    const step = this.provider.sampleSpacing;
    const test = (a, b, c) => {
      if (!ray.intersectTriangle(a, b, c, false, this.intersection)) return;
      const distance = ray.origin.distanceTo(this.intersection);
      if (distance > maxDistance || (best && distance >= best.distance)) return;
      // Only unwarped cells are handled here, so final XZ equals source XZ.
      best = { point: this.intersection.clone(), distance, sourceX: this.intersection.x, sourceZ: this.intersection.z };
    };
    let ix = Math.floor(ray.origin.x / step), iz = Math.floor(ray.origin.z / step);
    const sx = Math.sign(ray.direction.x), sz = Math.sign(ray.direction.z);
    const dx = sx ? step / Math.abs(ray.direction.x) : Infinity, dz = sz ? step / Math.abs(ray.direction.z) : Infinity;
    let nextX = sx ? ((ix + (sx > 0 ? 1 : 0)) * step - ray.origin.x) / ray.direction.x : Infinity;
    let nextZ = sz ? ((iz + (sz > 0 ? 1 : 0)) * step - ray.origin.z) / ray.direction.z : Infinity;
    let distance = 0;
    while (distance <= Math.min(maxDistance, best?.distance ?? maxDistance)) {
      const x = ix * step, z = iz * step;
      this.vertex(x, z, this.a); this.vertex(x + step, z, this.b);
      this.vertex(x, z + step, this.c); this.vertex(x + step, z + step, this.d);
      const displacement = Math.abs(this.a.x - x) + Math.abs(this.a.z - z)
        + Math.abs(this.b.x - x - step) + Math.abs(this.b.z - z)
        + Math.abs(this.c.x - x) + Math.abs(this.c.z - z - step)
        + Math.abs(this.d.x - x - step) + Math.abs(this.d.z - z - step);
      if (displacement <= .001) { test(this.a, this.c, this.b); test(this.b, this.c, this.d); }
      distance = Math.min(nextX, nextZ);
      if (!Number.isFinite(distance)) break;
      if (nextX <= nextZ) { ix += sx; nextX += dx; }
      else { iz += sz; nextZ += dz; }
    }
    return best;
  }
}
