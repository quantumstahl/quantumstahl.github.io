import { Vector3 } from "three";

// Sweep the near-plane rectangle along the existing camera boom. Clip each
// candidate triangle to that rectangular beam and take its nearest depth.
// One cached spatial/BVH query; no pivot recovery or iterative world queries.
export class CameraCollision {
  constructor(world) {
    this.world = world;
    this.start = new Vector3(); this.direction = new Vector3(); this.right = new Vector3(); this.up = new Vector3();
    this.hitPoint = new Vector3(); this.bounds = {};
    // Clipping a triangle against six planes produces at most nine vertices.
    this.polygons = [new Float64Array(36), new Float64Array(36)];
    this.visit = this.testTriangle.bind(this); this.visitPending = this.testPending.bind(this);
    this.stats = { queries: 0, triangleTests: 0, waitingForColliders: false }; this.hit = false;
  }
  resetStats() { this.stats.queries = this.stats.triangleTests = 0; this.stats.waitingForColliders = false; this.hit = false; }
  sweep(start, end, halfWidth, halfHeight = halfWidth, margin = 0) {
    this.start.copy(start); this.direction.subVectors(end, start);
    this.length = this.direction.length(); this.distance = this.length; this.hit = false;
    this.halfWidth = halfWidth; this.halfHeight = halfHeight; this.margin = margin;
    if (this.length < 1e-8) return this.length;
    this.direction.multiplyScalar(1 / this.length);
    this.right.set(this.direction.z, 0, -this.direction.x);
    if (this.right.lengthSq() < 1e-10) this.right.set(1, 0, 0); else this.right.normalize();
    this.up.crossVectors(this.direction, this.right).normalize();
    const r = Math.hypot(halfWidth, halfHeight), b = this.bounds;
    b.minX = Math.min(start.x, end.x) - r; b.maxX = Math.max(start.x, end.x) + r;
    b.minY = Math.min(start.y, end.y) - r; b.maxY = Math.max(start.y, end.y) + r;
    b.minZ = Math.min(start.z, end.z) - r; b.maxZ = Math.max(start.z, end.z) + r;
    // Request real triangles. An unloaded cave's whole bounding box is not a
    // solid wall: blocking it can collapse the camera in an open passage.
    for (const collider of this.world.colliders) if (collider.assets) {
      collider.prepare(b, true); collider.index.query(b, this.visitPending);
    }
    this.stats.queries++; this.world.queryCamera(b, this.visit);
    return this.distance;
  }
  testTriangle(a, b, c) {
    this.stats.triangleTests++;
    const p = this.polygons[0], s = this.start, r = this.right, u = this.up, d = this.direction;
    this.localVertex(a, p, 0); this.localVertex(b, p, 3); this.localVertex(c, p, 6);
    let count = 3, current = 0;
    for (let axis = 0; axis < 3; axis++) for (let sign = -1; sign <= 1; sign += 2) {
      const limit = axis === 0 ? this.halfWidth : axis === 1 ? this.halfHeight : sign < 0 ? 0 : this.distance + this.margin;
      count = this.clip(this.polygons[current], count, this.polygons[1 - current], axis, sign, limit);
      if (!count) return;
      current = 1 - current;
    }
    const polygon = this.polygons[current]; let nearest = 0;
    for (let i = 3; i < count * 3; i += 3) if (polygon[i + 2] < polygon[nearest + 2]) nearest = i;
    const depth = polygon[nearest + 2], distance = Math.max(0, depth - this.margin);
    if (distance >= this.distance) return;
    this.distance = distance; this.hit = true;
    this.hitPoint.copy(s).addScaledVector(r, polygon[nearest]).addScaledVector(u, polygon[nearest + 1]).addScaledVector(d, depth);
  }
  localVertex(v, polygon, offset) {
    const x = v.x - this.start.x, y = v.y - this.start.y, z = v.z - this.start.z;
    for (let axis = 0; axis < 3; axis++) {
      const basis = axis === 0 ? this.right : axis === 1 ? this.up : this.direction;
      polygon[offset + axis] = x * basis.x + y * basis.y + z * basis.z;
    }
  }
  clip(input, count, output, axis, sign, limit) {
    let written = 0, previous = (count - 1) * 3;
    for (let i = 0; i < count * 3; i += 3) {
      const a = sign * input[previous + axis] - limit, b = sign * input[i + axis] - limit;
      if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
        const t = a / (a - b);
        for (let j = 0; j < 3; j++) output[written++] = input[previous + j] + (input[i + j] - input[previous + j]) * t;
      }
      if (b <= 0) for (let j = 0; j < 3; j++) output[written++] = input[i + j];
      previous = i;
    }
    return written / 3;
  }
  testPending(entry) {
    if (!entry.mesh && entry.cameraMesh === undefined) this.stats.waitingForColliders = true;
  }
}
