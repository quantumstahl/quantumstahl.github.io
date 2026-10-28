const OFFSET = 33554432, STRIDE = 67108864;
export const spatialKey = (x, z) => (x + OFFSET) * STRIDE + z + OFFSET;
const keyOf = spatialKey;
export const overlaps = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

// Index extents, not just pivots: bridges and scaled instances can cross cells.
export class SpatialIndex {
  constructor(cellSize = 16) { this.cellSize = cellSize; this.cells = new Map(); this.large = new Set(); this.entries = new Map(); this.stamp = 0; this.candidates = 0; }
  set(id, entry) {
    this.delete(id); entry.id = id; entry.queryStamp = -1;
    const b = entry.bounds, s = this.cellSize;
    entry.x0 = Math.floor(b.minX / s); entry.x1 = Math.floor(b.maxX / s);
    entry.z0 = Math.floor(b.minZ / s); entry.z1 = Math.floor(b.maxZ / s);
    entry.large = (entry.x1 - entry.x0 + 1) * (entry.z1 - entry.z0 + 1) > 256;
    if (entry.large) this.large.add(entry);
    else for (let z = entry.z0; z <= entry.z1; z++) for (let x = entry.x0; x <= entry.x1; x++) {
      const key = keyOf(x, z); let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = new Set()); cell.add(entry);
    }
    this.entries.set(id, entry); return entry;
  }
  delete(id) {
    const entry = this.entries.get(id); if (!entry) return;
    if (entry.large) this.large.delete(entry);
    else for (let z = entry.z0; z <= entry.z1; z++) for (let x = entry.x0; x <= entry.x1; x++) {
      const key = keyOf(x, z), cell = this.cells.get(key); cell?.delete(entry); if (!cell?.size) this.cells.delete(key);
    }
    this.entries.delete(id);
  }
  query(bounds, visit) {
    this.stamp++; this.candidates = 0;
    const s = this.cellSize;
    for (let z = Math.floor(bounds.minZ / s); z <= Math.floor(bounds.maxZ / s); z++) for (let x = Math.floor(bounds.minX / s); x <= Math.floor(bounds.maxX / s); x++) {
      const cell = this.cells.get(keyOf(x, z)); if (!cell) continue;
      for (const entry of cell) {
        if (entry.queryStamp === this.stamp) continue;
        entry.queryStamp = this.stamp; this.candidates++;
        if (overlaps(entry.bounds, bounds)) visit(entry);
      }
    }
    for (const entry of this.large) { this.candidates++; if (overlaps(entry.bounds, bounds)) visit(entry); }
  }
  clear() { this.entries.clear(); this.cells.clear(); this.large.clear(); }
}
