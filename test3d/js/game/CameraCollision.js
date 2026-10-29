import { Vector3 } from "three";
import { CapsuleTriangle } from "../physics/CapsuleTriangle.js";

// Swept sphere over the same cached triangles/BVHs used by PhysicsWorld.
// Prefix capsule distance is monotonic, so bisection finds the first contact
// with triangle faces, edges AND vertices, from either side. No thin rays.
export class CameraCollision {
  constructor(world, settings) {
    this.world = world; this.settings = settings;
    this.query = new CapsuleTriangle(); this.start = new Vector3();
    this.end = new Vector3(); this.direction = new Vector3(); this.probe = new Vector3();
    this.hitPoint = new Vector3(); this.normal = new Vector3();
    this.bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    this.visitSweep = this.testSweep.bind(this); this.visitOverlap = this.testOverlap.bind(this);
    this.visitPending = this.testPending.bind(this);
    this.stats = { queries: 0, triangleTests: 0, waitingForColliders: false };
    this.hit = false;
  }
  resetStats() { this.stats.queries = this.stats.triangleTests = 0; this.stats.waitingForColliders = false; }
  setBounds(a, b, radius) {
    const q = this.bounds;
    q.minX = Math.min(a.x, b.x) - radius; q.maxX = Math.max(a.x, b.x) + radius;
    q.minY = Math.min(a.y, b.y) - radius; q.maxY = Math.max(a.y, b.y) + radius;
    q.minZ = Math.min(a.z, b.z) - radius; q.maxZ = Math.max(a.z, b.z) + radius;
  }
  // A camera endpoint embedded at spawn or after streaming is recovered by
  // casting from the cat. A shallow overlap at the pivot is also depenetrated;
  // never use a highest-surface/heightmap correction under an overhang.
  recoverPivot(position, radius, result) {
    result.copy(position); this.radius = radius;
    for (let i = 0; i < this.settings.overlapIterations; i++) {
      this.depth = 0; this.probe.copy(result); this.setBounds(result, result, radius);
      this.stats.queries++; this.world.query(this.bounds, this.visitOverlap);
      if (this.depth < 1e-5) break;
      result.addScaledVector(this.normal, this.depth + 1e-4);
    }
    return result;
  }
  testOverlap(a, b, c) {
    const q = this.query.testSegment(this.probe, this.probe, a, b, c);
    this.stats.triangleTests++;
    const depth = this.radius - q.distance;
    if (depth > this.depth) { this.depth = depth; this.normal.copy(q.normal); }
  }
  sweep(start, end, radius) {
    this.start.copy(start); this.end.copy(end); this.radius = radius;
    this.direction.subVectors(end, start); this.length = this.direction.length();
    this.distance = this.length; this.hit = false;
    if (this.length < 1e-8) return 0;
    this.direction.multiplyScalar(1 / this.length);
    this.setBounds(start, end, radius);
    // Mesh colliders load independently of visual streaming. Until ready,
    // their indexed authored bounds act as conservative camera blockers.
    for (const collider of this.world.colliders) if (collider.assets) {
      collider.prepare(this.bounds);
      collider.index.query(this.bounds, this.visitPending);
    }
    this.stats.queries++; this.world.query(this.bounds, this.visitSweep);
    return this.distance;
  }
  testSweep(a, b, c) {
    this.probe.copy(this.start).addScaledVector(this.direction, this.distance);
    const q = this.query.testSegment(this.start, this.probe, a, b, c);
    this.stats.triangleTests++;
    if (q.distance >= this.radius) return;
    let low = 0, high = this.distance;
    for (let i = 0; i < this.settings.sweepIterations; i++) {
      const middle = (low + high) * .5;
      this.probe.copy(this.start).addScaledVector(this.direction, middle);
      q.testSegment(this.start, this.probe, a, b, c); this.stats.triangleTests++;
      if (q.distance < this.radius) high = middle; else low = middle;
    }
    this.distance = Math.max(0, low - 1e-4); this.hit = true;
    this.probe.copy(this.start).addScaledVector(this.direction, high);
    q.testSegment(this.probe, this.probe, a, b, c); this.stats.triangleTests++;
    this.hitPoint.copy(q.point);
  }
  testPending(entry) {
    if (entry.mesh) return;
    this.stats.waitingForColliders = true;
    // Slab intersection with the radius-expanded, world-space AABB.
    const b = entry.bounds, s = this.start, d = this.direction, r = this.radius;
    let near = 0, far = this.distance;
    for (let axis = 0; axis < 3; axis++) {
      const origin = s.getComponent(axis), direction = d.getComponent(axis);
      const min = (axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ) - r;
      const max = (axis === 0 ? b.maxX : axis === 1 ? b.maxY : b.maxZ) + r;
      if (Math.abs(direction) < 1e-10) { if (origin < min || origin > max) return; }
      else {
        const a = (min - origin) / direction, c = (max - origin) / direction;
        near = Math.max(near, Math.min(a, c)); far = Math.min(far, Math.max(a, c));
        if (near > far) return;
      }
    }
    this.distance = Math.max(0, near - 1e-4); this.hit = true;
    this.hitPoint.copy(s).addScaledVector(d, near);
  }
}
