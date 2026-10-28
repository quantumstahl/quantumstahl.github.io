import { Vector3, Triangle } from "three";

// Exact closest points between an arbitrary capsule segment and one triangle.
// All math storage belongs to the query, including output; no per-test objects.
export class CapsuleTriangle {
  constructor() {
    this.triangle = new Triangle();
    this.start = new Vector3(); this.end = new Vector3();
    this.point = new Vector3(); this.segmentPoint = new Vector3();
    this.normal = new Vector3(); this.faceNormal = new Vector3();
    this.temp = new Vector3(); this.hit = new Vector3();
    this.distance = Infinity;
  }

  test(position, radius, height, a, b, c) {
    this.start.set(position.x, position.y + radius, position.z);
    this.end.set(position.x, position.y + height - radius, position.z);
    return this.testSegment(this.start, this.end, a, b, c);
  }

  testSegment(start, end, a, b, c) {
    this.start.copy(start); this.end.copy(end);
    this.triangle.set(a, b, c);
    this.triangle.getNormal(this.faceNormal);
    this.distance = Infinity;
    const dx = this.end.x - this.start.x, dy = this.end.y - this.start.y, dz = this.end.z - this.start.z;
    const denominator = this.faceNormal.x * dx + this.faceNormal.y * dy + this.faceNormal.z * dz;
    if (Math.abs(denominator) > 1e-12) {
      const t = this.temp.subVectors(a, this.start).dot(this.faceNormal) / denominator;
      if (t >= 0 && t <= 1) {
        this.hit.set(this.start.x + t * dx, this.start.y + t * dy, this.start.z + t * dz);
        if (this.triangle.containsPoint(this.hit)) this.consider(this.hit, this.hit);
      }
    }
    this.triangle.closestPointToPoint(this.start, this.temp); this.consider(this.start, this.temp);
    this.triangle.closestPointToPoint(this.end, this.temp); this.consider(this.end, this.temp);
    this.edge(a, b); this.edge(b, c); this.edge(c, a);
    if (this.distance > 1e-10) this.normal.subVectors(this.segmentPoint, this.point).multiplyScalar(1 / this.distance);
    else {
      this.normal.copy(this.faceNormal);
      // Two-sided response. Choose the side occupied by the segment midpoint.
      this.temp.copy(this.start).add(this.end).multiplyScalar(.5).sub(a);
      if (this.temp.dot(this.normal) < 0) this.normal.negate();
    }
    return this;
  }

  consider(p, q) {
    const distance = p.distanceTo(q);
    if (distance < this.distance) {
      this.distance = distance; this.segmentPoint.copy(p); this.point.copy(q);
    }
  }

  edge(a, b) {
    // Closest points of two finite segments (including degenerate edges).
    const dx = this.end.x - this.start.x, dy = this.end.y - this.start.y, dz = this.end.z - this.start.z;
    const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
    const rx = this.start.x - a.x, ry = this.start.y - a.y, rz = this.start.z - a.z;
    const aa = dx * dx + dy * dy + dz * dz, ee = ex * ex + ey * ey + ez * ez;
    const bb = dx * ex + dy * ey + dz * ez, cc = dx * rx + dy * ry + dz * rz, ff = ex * rx + ey * ry + ez * rz;
    let s = 0, t = 0;
    if (aa < 1e-12) t = ee > 1e-12 ? Math.max(0, Math.min(1, ff / ee)) : 0;
    else if (ee < 1e-12) s = Math.max(0, Math.min(1, -cc / aa));
    else {
      const denominator = aa * ee - bb * bb;
      s = denominator > 1e-12 ? Math.max(0, Math.min(1, (bb * ff - cc * ee) / denominator)) : 0;
      t = (bb * s + ff) / ee;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -cc / aa)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (bb - cc) / aa)); }
    }
    this.hit.set(this.start.x + dx * s, this.start.y + dy * s, this.start.z + dz * s);
    this.temp.set(a.x + ex * t, a.y + ey * t, a.z + ez * t);
    this.consider(this.hit, this.temp);
  }
}
