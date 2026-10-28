import { OBJECT_CELL_SIZE, copy, objectId } from "../objects/ObjectData.js";
import { sampleObjectSurface } from "../objects/ObjectSurface.js";

export const DEFAULT_OBJECT_BRUSH = Object.freeze({ radius: 12, density: 4, scale: 1, randomScale: true, minScale: .8, maxScale: 1.2, randomRotation: true, rotationSnap: 0, heightOffset: 0, eraseAll: false });
export function brushSettings(value = {}) {
  const s = { ...DEFAULT_OBJECT_BRUSH, ...value };
  for (const key of ["radius", "density", "scale", "minScale", "maxScale"]) if (!Number.isFinite(s[key]) || s[key] <= 0) throw new Error("Brush radius, density and scales must be positive.");
  if (s.radius > 80 || s.density > 50 || s.minScale > s.maxScale || !Number.isFinite(s.heightOffset) || !Number.isFinite(s.rotationSnap) || s.rotationSnap < 0) throw new Error("Use a radius up to 80 m, density up to 50, and minimum scale no greater than maximum.");
  return s;
}
const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const pointArray = point => [point.x, point.y, point.z];
function noise(x, z, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function applyBrushHistory(data, entries, property) {
  for (const entry of entries) { if (entry[property]) data.setObject(entry[property]); else data.deleteObject(entry.id); }
}

// Editor-only data brush. Render cells/LOD batches remain owned by ObjectSystem.
// Stable jittered source-grid candidates give approximately density/100 m²,
// while world-space sphere tests and conservative inverse warp bounds keep
// placements on actual terrain and inside the visible brush volume.
export class ObjectBrush {
  constructor(data, provider, { onCommit = () => {}, createId = objectId } = {}) {
    Object.assign(this, { data, provider, onCommit, createId }); this.stroke = null;
  }
  begin(assetId, settings, mode = "paint") {
    this.finish(); settings = brushSettings(settings);
    if ((!assetId || !this.data.assets.has(assetId)) && (mode === "paint" || !settings.eraseAll)) throw new Error("Select an asset first, or enable Erase all assets.");
    let seed = 0; for (const char of assetId ?? "") seed = Math.imul(seed, 31) + char.charCodeAt(0) | 0;
    const spacing = Math.sqrt(100 / settings.density);
    this.stroke = { assetId, settings, mode, seed, spacing, separation: spacing * .35, changes: new Map(), jobs: [], head: 0, iterator: null,
      released: false, last: null, lastMode: null, painted: new Map(), loadedCells: new Set(), occupancy: new Map() };
  }
  queue(hit, erase = false, final = false) {
    const s = this.stroke; if (!s) return;
    if (!hit) { s.last = null; return; }
    const current = { point: pointArray(hit.point), sourceX: hit.sourceX ?? hit.point.x, sourceZ: hit.sourceZ ?? hit.point.z };
    const mode = erase || s.mode === "erase" ? "erase" : "paint", previous = s.last;
    const distance = previous ? Math.sqrt(distance2(previous.point, current.point)) : 0, step = Math.max(.25, s.settings.radius * .35);
    if (previous && s.lastMode === mode && distance < 1e-6) return;
    if (previous && s.lastMode === mode && distance < step && !final) return;
    // Never connect unrelated folded sheets or a cursor jump across a valley.
    const sourceDistance = previous ? Math.hypot(current.sourceX - previous.sourceX, current.sourceZ - previous.sourceZ) : 0;
    const join = previous && s.lastMode === mode && distance <= s.settings.radius * 12 && sourceDistance <= distance * 4 + s.settings.radius * 2;
    const steps = join ? Math.max(1, Math.ceil(distance / step)) : 1;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const centre = join ? { point: previous.point.map((n, axis) => n + (current.point[axis] - n) * t), sourceX: previous.sourceX + (current.sourceX - previous.sourceX) * t, sourceZ: previous.sourceZ + (current.sourceZ - previous.sourceZ) * t } : current;
      s.jobs.push({ centre, mode });
    }
    s.last = current; s.lastMode = mode;
  }
  end() { if (this.stroke) this.stroke.released = true; }
  change(id, after) {
    const s = this.stroke;
    if (!s.changes.has(id)) s.changes.set(id, { id, before: copy(this.data.objects.get(id)), after: null });
    if (after) this.data.setObject(after); else this.data.deleteObject(id);
    const entry = s.changes.get(id); entry.after = copy(this.data.objects.get(id));
    if (!entry.before && !entry.after) s.changes.delete(id);
  }
  foot(object) { return [object.position[0], object.position[1] - (object.anchor?.offset ?? 0), object.position[2]]; }
  bin(point) { const d = this.stroke.separation; return point.map(n => Math.floor(n / d)); }
  occupy(id, point) {
    const key = this.bin(point).join(","), bins = this.stroke.occupancy;
    if (!bins.has(key)) bins.set(key, []); bins.get(key).push({ id, point });
  }
  *loadOccupancy(centre) {
    const s = this.stroke, radius = s.settings.radius + s.separation;
    for (let z = Math.floor((centre[2] - radius) / OBJECT_CELL_SIZE); z <= Math.floor((centre[2] + radius) / OBJECT_CELL_SIZE); z++) {
      for (let x = Math.floor((centre[0] - radius) / OBJECT_CELL_SIZE); x <= Math.floor((centre[0] + radius) / OBJECT_CELL_SIZE); x++) {
        const key = `${x},${z}`; if (s.loadedCells.has(key)) continue; s.loadedCells.add(key);
        for (const id of this.data.cells.get(key) ?? []) { const object = this.data.objects.get(id); if (object?.assetId === s.assetId) this.occupy(id, this.foot(object)); yield; }
      }
    }
  }
  occupied(point) {
    const s = this.stroke, [bx, by, bz] = this.bin(point);
    for (let z = bz - 1; z <= bz + 1; z++) for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) {
      for (const item of s.occupancy.get(`${x},${y},${z}`) ?? []) if (this.data.objects.has(item.id) && distance2(point, item.point) < s.separation ** 2) return true;
    }
    return false;
  }
  ranges(centre) {
    const { radius: r } = this.stroke.settings, [x, y, z] = centre;
    const ranges = [[x - r, x + r, z - r, z + r]], size = this.provider.tileSize;
    for (const summary of this.provider.warpSummaries.values()) {
      const ox = summary.tileX * size, oz = summary.tileZ * size;
      const dx = Math.max(ox + summary.minWarpX - x, 0, x - ox - size - summary.maxWarpX);
      const dz = Math.max(oz + summary.minWarpZ - z, 0, z - oz - size - summary.maxWarpZ);
      const dy = Math.max(summary.minHeight - y, 0, y - summary.maxHeight);
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      ranges.push([Math.max(ox, x - r - summary.maxWarpX), Math.min(ox + size, x + r - summary.minWarpX),
        Math.max(oz, z - r - summary.maxWarpZ), Math.min(oz + size, z + r - summary.minWarpZ)]);
    }
    return ranges;
  }
  *paint(centre) {
    const s = this.stroke, settings = s.settings, d = s.spacing, seen = new Set(); yield* this.loadOccupancy(centre);
    for (const [minX, maxX, minZ, maxZ] of this.ranges(centre)) {
      for (let z = Math.floor(minZ / d) - 1; z <= Math.floor(maxZ / d) + 1; z++) for (let x = Math.floor(minX / d) - 1; x <= Math.floor(maxX / d) + 1; x++) {
        const key = `${x},${z}`;
        if (seen.has(key) || this.data.objects.has(s.painted.get(key))) { yield; continue; } seen.add(key);
        const sourceX = (x + .5 + (noise(x, z, s.seed) - .5) * .6) * d;
        const sourceZ = (z + .5 + (noise(x, z, s.seed ^ 7351) - .5) * .6) * d;
        const foot = sampleObjectSurface(this.provider, sourceX, sourceZ);
        if (distance2(foot, centre) <= settings.radius ** 2 && !this.occupied(foot)) {
          const factor = settings.randomScale ? settings.minScale + noise(x, z, s.seed ^ 19273) * (settings.maxScale - settings.minScale) : 1;
          const scale = settings.scale * factor; let yaw = settings.randomRotation ? noise(x, z, s.seed ^ 9719) * Math.PI * 2 : 0;
          if (settings.rotationSnap) yaw = Math.round(yaw / settings.rotationSnap) * settings.rotationSnap;
          const id = this.createId(), position = [...foot]; position[1] += settings.heightOffset;
          this.change(id, { id, assetId: s.assetId, position, rotation: [0, yaw, 0], scale: [scale, scale, scale], properties: {}, anchor: { sourceX, sourceZ, offset: settings.heightOffset } });
          this.occupy(id, foot); s.painted.set(key, id);
        }
        yield;
      }
    }
  }
  *erase(centre) {
    const s = this.stroke, r = s.settings.radius;
    for (let z = Math.floor((centre[2] - r) / OBJECT_CELL_SIZE); z <= Math.floor((centre[2] + r) / OBJECT_CELL_SIZE); z++) {
      for (let x = Math.floor((centre[0] - r) / OBJECT_CELL_SIZE); x <= Math.floor((centre[0] + r) / OBJECT_CELL_SIZE); x++) {
        for (const id of this.data.cells.get(`${x},${z}`) ?? []) {
          const object = this.data.objects.get(id);
          if (object && (s.settings.eraseAll || object.assetId === s.assetId) && distance2(this.foot(object), centre) <= r * r) this.change(id, null);
          yield;
        }
      }
    }
  }
  work(budget = 512) {
    const s = this.stroke; if (!s) return 0;
    if (s.mode === "paint" && !this.data.assets.has(s.assetId)) { s.jobs.length = 0; s.head = 0; s.iterator = null; s.released = true; }
    let checked = 0;
    while (checked < budget && s.head < s.jobs.length) {
      const job = s.jobs[s.head]; s.iterator ??= job.mode === "erase" ? this.erase(job.centre.point) : this.paint(job.centre.point);
      if (s.iterator.next().done) { s.iterator = null; s.head++; }
      else checked++;
    }
    if (s.head === s.jobs.length) {
      s.jobs.length = 0; s.head = 0;
      if (s.released) {
        this.stroke = null; const entries = [...s.changes.values()];
        if (entries.length) this.onCommit({ kind: "objectBrush", entries });
      }
    }
    return checked;
  }
  finish() { if (this.stroke) { this.end(); this.work(Infinity); } }
}
