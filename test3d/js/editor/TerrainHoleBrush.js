// Reversible cell editing. Test all four authored corners against the swept
// world-space brush sphere so a hole never grows beyond the painted area.
// Picking intentionally includes hidden source triangles for restoration.
export class TerrainHoleBrush {
  constructor(provider) {
    this.provider = provider;
    this.radius = 24;
    this.stroke = null;
    this.previous = null;
  }

  beginStroke({ restore = false } = {}) {
    this.stroke = new Map(); this.restore = restore; this.previous = null;
  }

  resetPath() { this.previous = null; }

  paintTo(hit) {
    if (!this.stroke || !hit) return 0;
    const end = hit.point ?? hit, start = this.previous ?? end;
    if (this.previous && start.x === end.x && start.y === end.y && start.z === end.z) return 0;
    const p = this.provider, s = p.sampleSpacing, r = this.radius;
    const minX = Math.min(start.x, end.x) - r, maxX = Math.max(start.x, end.x) + r;
    const minZ = Math.min(start.z, end.z) - r, maxZ = Math.max(start.z, end.z) + r;
    const minY = Math.min(start.y, end.y) - r, maxY = Math.max(start.y, end.y) + r;
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    const length2 = dx * dx + dy * dy + dz * dz;
    const inside = (x, y, z) => {
      const t = length2 ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy + (z - start.z) * dz) / length2)) : 0;
      return (x - start.x - t * dx) ** 2 + (y - start.y - t * dy) ** 2 + (z - start.z - t * dz) ** 2 <= r * r;
    };
    // Reject off-path tiles before materializing their height arrays. A fast
    // diagonal drag should visit a narrow band, not its entire bounding box.
    const crossesTile = (left, right, top, bottom) => {
      let near = 0, far = 1;
      const axis = (origin, direction, low, high) => {
        if (Math.abs(direction) < 1e-10) return origin >= low && origin <= high;
        const a = (low - origin) / direction, b = (high - origin) / direction;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
        return near <= far;
      };
      return axis(start.x, dx, left - r, right + r) && axis(start.z, dz, top - r, bottom + r);
    };
    const tiles = new Set();
    for (let z = Math.floor(minZ / p.tileSize); z <= Math.floor(maxZ / p.tileSize); z++) {
      for (let x = Math.floor(minX / p.tileSize); x <= Math.floor(maxX / p.tileSize); x++) tiles.add(p.tileKey(x, z));
    }
    // Folded surfaces can originate outside the brush's source rectangle.
    for (const [key, b] of p.warpSummaries) {
      const x = b.tileX * p.tileSize, z = b.tileZ * p.tileSize;
      if (x + b.minWarpX <= maxX && x + p.tileSize + b.maxWarpX >= minX && z + b.minWarpZ <= maxZ
        && z + p.tileSize + b.maxWarpZ >= minZ && b.minHeight <= maxY && b.maxHeight >= minY) tiles.add(key);
    }
    let changed = 0;
    p.beginChanges();
    try {
      for (const key of tiles) {
        const [tx, tz] = key.split(",").map(Number);
        const b = p.warpSummaries.get(key);
        if (!crossesTile(tx * p.tileSize + (b?.minWarpX ?? 0), (tx + 1) * p.tileSize + (b?.maxWarpX ?? 0),
          tz * p.tileSize + (b?.minWarpZ ?? 0), (tz + 1) * p.tileSize + (b?.maxWarpZ ?? 0))) continue;
        if (this.restore && !p.holeMasks.get(key)?.some(Boolean)) continue;
        const tile = p.getTile(tx, tz, "hole-brush"), n = tile.segments, w = n + 1;
        const x0 = Math.max(0, Math.floor((minX - (b?.maxWarpX ?? 0) - tile.x) / s));
        const z0 = Math.max(0, Math.floor((minZ - (b?.maxWarpZ ?? 0) - tile.z) / s));
        const x1 = Math.min(n - 1, Math.floor((maxX - (b?.minWarpX ?? 0) - tile.x) / s));
        const z1 = Math.min(n - 1, Math.floor((maxZ - (b?.minWarpZ ?? 0) - tile.z) / s));
        const vertexInside = (x, z) => {
          const index = z * w + x;
          return inside(tile.x + x * s + (tile.warp?.[index * 2] ?? 0), tile.heights[index], tile.z + z * s + (tile.warp?.[index * 2 + 1] ?? 0));
        };
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const before = tile.holes?.[z * n + x] ?? 0, after = this.restore ? 0 : 1;
          if (before === after || !vertexInside(x, z) || !vertexInside(x + 1, z) || !vertexInside(x, z + 1) || !vertexInside(x + 1, z + 1)) continue;
          const cx = tx * n + x, cz = tz * n + z, id = `${cx},${cz}`;
          if (!this.stroke.has(id)) this.stroke.set(id, { x: cx, z: cz, before, after });
          else this.stroke.get(id).after = after;
          if (p.setHoleCell(cx, cz, after)) changed++;
        }
      }
    } finally { p.endChanges(); }
    this.previous = { x: end.x, y: end.y, z: end.z };
    return changed;
  }

  endStroke() {
    const entries = this.stroke ? [...this.stroke.values()].filter(e => e.before !== e.after) : [];
    this.stroke = null; this.previous = null;
    return entries.length ? entries : null;
  }

  applyHistory(entries, property) {
    this.provider.beginChanges();
    try { for (const e of entries) this.provider.setHoleCell(e.x, e.z, e[property]); }
    finally { this.provider.endChanges(); }
  }
}
