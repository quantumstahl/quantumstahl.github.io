import { SpatialIndex } from "./SpatialIndex.js";

// A separate broad phase for sensors. Never register these with PhysicsWorld's
// solid triangle queries (including camera queries).
export class GhostCollision {
  constructor() {
    this.index = new SpatialIndex(); this.bounds = {};
    this.visit = entry => {
      const { body, onOverlap } = this, a = body.capsuleStart, b = body.capsuleEnd, p = entry.position;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const length = dx * dx + dy * dy + dz * dz;
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / length)) : 0;
      const distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2 + (p.z - a.z - t * dz) ** 2;
      if (distance <= (body.config.radius + entry.radius) ** 2) onOverlap(entry.object);
    };
  }
  set(id, position, radius, object) {
    if (!(radius > 0) || !Number.isFinite(radius) || ![position.x, position.y, position.z].every(Number.isFinite)) throw new Error("Invalid ghost sphere.");
    return this.index.set(id, { position, radius, object, bounds: {
      minX: position.x - radius, maxX: position.x + radius, minY: position.y - radius, maxY: position.y + radius,
      minZ: position.z - radius, maxZ: position.z + radius,
    } });
  }
  delete(id) { this.index.delete(id); }
  query(body, onOverlap) {
    // Reward hooks may query again while this traversal is consuming sensors.
    // The current traversal already visits every overlapping sensor once.
    if (this.body) return;
    body.updateCapsule();
    const a = body.capsuleStart, b = body.capsuleEnd, r = body.config.radius, bounds = this.bounds;
    bounds.minX = Math.min(a.x, b.x) - r; bounds.maxX = Math.max(a.x, b.x) + r;
    bounds.minY = Math.min(a.y, b.y) - r; bounds.maxY = Math.max(a.y, b.y) + r;
    bounds.minZ = Math.min(a.z, b.z) - r; bounds.maxZ = Math.max(a.z, b.z) + r;
    this.body = body; this.onOverlap = onOverlap;
    try { this.index.query(bounds, this.visit); }
    finally { this.body = this.onOverlap = null; }
  }
  clear() { this.index.clear(); }
}
