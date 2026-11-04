const CLEARANCE = .42, FOOTPRINT = .18;

// Placement only, on authoritative physics triangles, never rendered terrain
// LODs or a heightmap that would ignore caves, holes, rocks and bridges.
export class PickupLanding {
  constructor(surfaces, collider) {
    this.surfaces = surfaces; this.collider = collider; this.bounds = {};
    this.visit = (a, b, c, object) => {
      const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
      const determinant = bx * cz - bz * cx;
      if (Math.abs(determinant) < 1e-10) return;
      const by = b.y - a.y, cy = c.y - a.y;
      // Two-sided solids, but only reasonably walkable faces support drops.
      if (Math.abs(determinant) / Math.hypot(by * cz - bz * cy, determinant, bx * cy - by * cx) < Math.SQRT1_2) return;
      for (let i = 0; i < 5; i++) {
        const x = this.x + (i === 1 ? FOOTPRINT : i === 2 ? -FOOTPRINT : 0) - a.x;
        const z = this.z + (i === 3 ? FOOTPRINT : i === 4 ? -FOOTPRINT : 0) - a.z;
        const u = (x * cz - z * cx) / determinant, v = (bx * z - bz * x) / determinant;
        if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
        const y = a.y + u * by + v * cy;
        if (y > this.ceiling || y <= this.height) continue;
        this.height = y; this.supportId = object?.id ?? "maxworld:terrain";
      }
    };
  }
  at(x, y, z) {
    this.x = x; this.z = z; this.ceiling = y + .1; this.height = -Infinity; this.supportId = null;
    const b = this.bounds;
    b.minX = x - FOOTPRINT; b.maxX = x + FOOTPRINT; b.minZ = z - FOOTPRINT; b.maxZ = z + FOOTPRINT;
    // Finite bounds are required when ObjectCollider transforms this box into
    // local space: a matrix's zero coefficients multiplied by Infinity are NaN.
    b.minY = y - 1000000; b.maxY = this.ceiling;
    // undefined means loading: keep the drop still until solids are ready.
    if (this.collider && !this.collider.prepare(b)) return undefined;
    for (const surface of this.surfaces) surface.query(b, this.visit);
    this.collider?.query(b, this.visit);
    return Number.isFinite(this.height) ? { position: [x, this.height + CLEARANCE, z], supportId: this.supportId } : null;
  }
  find(position, fallback) {
    const { x, y, z } = position;
    const direct = this.at(x, y, z); if (direct !== null) return direct;
    // A destroyed crate can straddle a hole. Search a small nearby ring once,
    // rather than letting a pickup fall forever through missing terrain.
    for (const radius of [.75, 1.5, 3]) for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const target = this.at(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius);
      if (target !== null) return target;
    }
    return fallback ? this.at(fallback.x, Math.max(y, fallback.y), fallback.z) : null;
  }
}
