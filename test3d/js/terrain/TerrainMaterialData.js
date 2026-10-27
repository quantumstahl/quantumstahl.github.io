import { TERRAIN_TILE_SIZE, TERRAIN_TILE_SEGMENTS } from "./TerrainDataProvider.js";

export const TERRAIN_MATERIAL_COUNT = 8;
export const MATERIAL_MASK_VERSION = 1;
const SAMPLE_COUNT = (TERRAIN_TILE_SEGMENTS + 1) ** 2;
const WEIGHT_COUNT = SAMPLE_COUNT * TERRAIN_MATERIAL_COUNT;
const SPACING = TERRAIN_TILE_SIZE / TERRAIN_TILE_SEGMENTS;
const WEIGHT_EPSILON = 1e-6;

function validateMaterials(materials) {
  if (!Array.isArray(materials) || materials.length !== TERRAIN_MATERIAL_COUNT) throw new Error("Terrain requires exactly eight material slots.");
  return Object.freeze(materials.map((material, id) => {
    if (!material || material.id !== id || typeof material.name !== "string" || !material.name.trim()
      || !(material.texture === null || (typeof material.texture === "string" && material.texture.trim()))
      || !Number.isFinite(material.repeatSize) || material.repeatSize <= 0) throw new Error(`Invalid terrain material slot: ${id}.`);
    return Object.freeze({ id, name: material.name, texture: material.texture, repeatSize: material.repeatSize });
  }));
}

function defaultMaterials() {
  return validateMaterials(Array.from({ length: TERRAIN_MATERIAL_COUNT }, (_, id) => ({ id, name: `Material ${id + 1}`, texture: null, repeatSize: 8 })));
}

function validateTilePosition(x, z) {
  if (![x, z].every(value => Number.isSafeInteger(value) && Number.isSafeInteger(value / TERRAIN_TILE_SIZE))) throw new Error("Invalid material tile position.");
}

function encodeBytes(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function decodeRecord(record) {
  if (!record || record.version !== MATERIAL_MASK_VERSION || typeof record.weights !== "string"
    || record.weights.length !== Math.ceil(WEIGHT_COUNT / 3) * 4) throw new Error("Invalid material mask payload.");
  validateTilePosition(record.x, record.z);
  const binary = atob(record.weights);
  if (binary.length !== WEIGHT_COUNT || btoa(binary) !== record.weights) throw new Error("Invalid material mask encoding or length.");
  const bytes = new Uint8Array(WEIGHT_COUNT);
  for (let offset = 0; offset < WEIGHT_COUNT; offset += TERRAIN_MATERIAL_COUNT) {
    let sum = 0;
    for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) sum += bytes[offset + layer] = binary.charCodeAt(offset + layer);
    if (sum > 255) throw new Error("Material mask coverage exceeds one.");
  }
  return bytes;
}

// Cumulative rounding preserves total coverage, including eight-way blends.
// Independent rounding can produce a byte sum above 255 and darken/brighten
// the ground. Each channel's quantization error stays below 1/255.
export function packMaterialWeights(weights) {
  if (!(weights instanceof Float32Array) || weights.length !== WEIGHT_COUNT) throw new Error("Invalid material weight buffer.");
  const bytes = new Uint8Array(WEIGHT_COUNT);
  for (let offset = 0; offset < WEIGHT_COUNT; offset += TERRAIN_MATERIAL_COUNT) {
    let total = 0, previous = 0;
    for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) {
      const weight = weights[offset + layer];
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("Invalid material weight.");
      total += weight;
      const next = Math.round(Math.min(1, total) * 255);
      bytes[offset + layer] = next - previous;
      previous = next;
    }
    if (total > 1 + WEIGHT_EPSILON) throw new Error("Material mask coverage exceeds one.");
  }
  return bytes;
}

// Paint owns its cache, revisions and notifications. It never materializes a
// height tile or calls TerrainDataProvider's geometry-change notification.
export class TerrainMaterialData {
  constructor({ maxCachedTiles = 64 } = {}) {
    if (!Number.isSafeInteger(maxCachedTiles) || maxCachedTiles < 1) throw new Error("Invalid material cache size.");
    this.maxCachedTiles = maxCachedTiles;
    this.materials = defaultMaterials();
    this.records = new Map();
    this.cache = new Map();
    this.paletteRevision = 0;
    this.savedPaletteRevision = 0;
    this.listeners = new Set();
    this.changeBatchDepth = 0;
    this.changedTiles = new Set();
    this.sampleAccessDepth = 0;
  }

  static fromJSON({ materials, tiles }) {
    const data = new TerrainMaterialData();
    data.materials = validateMaterials(materials);
    if (!Array.isArray(tiles)) throw new Error("Invalid material tile list.");
    for (const record of tiles) {
      decodeRecord(record);
      const key = `${record.x / TERRAIN_TILE_SIZE},${record.z / TERRAIN_TILE_SIZE}`;
      if (data.records.has(key)) throw new Error(`Duplicate material tile: ${key}.`);
      data.records.set(key, JSON.stringify({ version: MATERIAL_MASK_VERSION, x: record.x, z: record.z, weights: record.weights }));
    }
    return data;
  }

  get hasUnsavedChanges() {
    return this.paletteRevision !== this.savedPaletteRevision || [...this.cache.values()].some(tile => tile.dirty);
  }

  onChanged(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) { for (const listener of this.listeners) listener(event); }

  updateMaterial(id, patch) {
    if (!Number.isInteger(id) || id < 0 || id >= TERRAIN_MATERIAL_COUNT || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid material update.");
    const materials = this.materials.map((material, index) => index === id ? { ...material, ...patch } : material);
    const next = validateMaterials(materials);
    if (JSON.stringify(next) === JSON.stringify(this.materials)) return false;
    this.materials = next;
    this.paletteRevision++;
    this.emit({ type: "palette", materials: this.materials });
    return true;
  }

  beginChanges() { this.changeBatchDepth++; }

  endChanges() {
    if (!this.changeBatchDepth) throw new Error("endChanges called without beginChanges.");
    if (--this.changeBatchDepth) return;
    const changed = [...this.changedTiles];
    this.changedTiles.clear();
    for (const tile of changed) this.emit({ type: "tile", tile });
  }

  getTile(tileX, tileZ, create = false) {
    if (!Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileZ)) throw new Error("Invalid material tile coordinate.");
    validateTilePosition(tileX * TERRAIN_TILE_SIZE, tileZ * TERRAIN_TILE_SIZE);
    const key = `${tileX},${tileZ}`;
    let tile = this.cache.get(key);
    if (!tile) {
      const serialized = this.records.get(key);
      if (!serialized && !create) return null;
      const weights = serialized ? Float32Array.from(decodeRecord(JSON.parse(serialized)), value => value / 255) : new Float32Array(WEIGHT_COUNT);
      tile = { x: tileX * TERRAIN_TILE_SIZE, z: tileZ * TERRAIN_TILE_SIZE, weights, revision: 0, dirty: false };
    }
    this.cache.delete(key);
    this.cache.set(key, tile);
    this.trimCache(tile);
    return tile;
  }

  trimCache(retainedTile = null) {
    if (this.sampleAccessDepth) return;
    while (this.cache.size > this.maxCachedTiles) {
      const disposable = [...this.cache.entries()].find(([, tile]) => !tile.dirty && tile !== retainedTile);
      if (!disposable) return; // Unsaved owners stay pinned, as with heights.
      this.cache.delete(disposable[0]);
    }
  }

  // A synchronous fixed-grid edit pass. Resolve owner tiles once, reuse
  // sample buffers, and notify once per changed owner. Clean owners cannot
  // evict underneath the pass when the CPU cache has a small soft limit.
  editSamples(edit) {
    const owners = new Map(), changed = new Set();
    const next = new Float32Array(TERRAIN_MATERIAL_COUNT);
    let lastX = NaN, lastZ = NaN, lastTile = null;
    const owner = (x, z, create = false) => {
      const key = `${x},${z}`;
      if (!owners.has(key) || (!owners.get(key) && create)) owners.set(key, this.getTile(x, z, create));
      return owners.get(key);
    };
    const primary = (x, z) => {
      if (x !== lastX || z !== lastZ) { lastX = x; lastZ = z; lastTile = owner(x, z); }
      return lastTile;
    };
    const access = {
      read: (gx, gz, target) => {
        const x = Math.floor(gx / thisSegments), z = Math.floor(gz / thisSegments);
        const tile = primary(x, z);
        const offset = ((gz - z * thisSegments) * width + gx - x * thisSegments) * TERRAIN_MATERIAL_COUNT;
        for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) target[layer] = tile ? tile.weights[offset + layer] : 0;
        return target;
      },
      write: (gx, gz, weights, sourceOffset = 0) => {
        if (!Number.isSafeInteger(gx) || !Number.isSafeInteger(gz) || !weights || !Number.isSafeInteger(sourceOffset) || sourceOffset < 0 || weights.length < sourceOffset + TERRAIN_MATERIAL_COUNT) throw new Error("Invalid material grid sample.");
        let sum = 0;
        for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) {
          const value = weights[sourceOffset + layer];
          if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid material weight.");
          sum += value;
        }
        if (sum > 1 + WEIGHT_EPSILON) throw new Error("Material mask coverage exceeds one.");
        const normalization = 1 / Math.max(1, sum);
        for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) next[layer] = weights[sourceOffset + layer] * normalization;
        const x = Math.floor(gx / thisSegments), z = Math.floor(gz / thisSegments);
        let count = 0;
        for (let tz = gz % thisSegments === 0 ? z - 1 : z; tz <= z; tz++) {
          for (let tx = gx % thisSegments === 0 ? x - 1 : x; tx <= x; tx++) {
            let tile = tx === x && tz === z ? primary(x, z) : owner(tx, tz);
            const offset = ((gz - tz * thisSegments) * width + gx - tx * thisSegments) * TERRAIN_MATERIAL_COUNT;
            let differs = false;
            for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) {
              if (next[layer] !== (tile ? tile.weights[offset + layer] : 0)) { differs = true; break; }
            }
            if (!differs) continue;
            if (!tile) {
              tile = owner(tx, tz, true);
              if (tx === lastX && tz === lastZ) lastTile = tile;
            }
            tile.weights.set(next, offset);
            tile.dirty = true;
            changed.add(tile);
            count++;
          }
        }
        return count;
      },
    };
    const thisSegments = TERRAIN_TILE_SEGMENTS, width = thisSegments + 1;
    this.beginChanges();
    this.sampleAccessDepth++;
    try { return edit(access); }
    finally {
      for (const tile of changed) { tile.revision++; this.changedTiles.add(tile); }
      this.sampleAccessDepth--;
      this.endChanges();
      this.trimCache();
    }
  }

  sampleWeights(worldX, worldZ, target = new Float32Array(TERRAIN_MATERIAL_COUNT)) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new Error("Invalid material sample position.");
    if (!target || target.length !== TERRAIN_MATERIAL_COUNT) throw new Error("Expected an eight-channel material sample target.");
    target.fill(0);
    const tileX = Math.floor(worldX / TERRAIN_TILE_SIZE), tileZ = Math.floor(worldZ / TERRAIN_TILE_SIZE);
    const tile = this.getTile(tileX, tileZ);
    if (!tile) return target;
    const x = (worldX - tile.x) / SPACING, z = (worldZ - tile.z) / SPACING;
    const x0 = Math.floor(x), z0 = Math.floor(z), x1 = Math.min(x0 + 1, TERRAIN_TILE_SEGMENTS), z1 = Math.min(z0 + 1, TERRAIN_TILE_SEGMENTS);
    const fx = x - x0, fz = z - z0, width = TERRAIN_TILE_SEGMENTS + 1;
    for (const [sx, sz, weight] of [[x0, z0, (1 - fx) * (1 - fz)], [x1, z0, fx * (1 - fz)], [x0, z1, (1 - fx) * fz], [x1, z1, fx * fz]]) {
      const offset = (sz * width + sx) * TERRAIN_MATERIAL_COUNT;
      for (let layer = 0; layer < TERRAIN_MATERIAL_COUNT; layer++) target[layer] += tile.weights[offset + layer] * weight;
    }
    return target;
  }

  // One global sample has two owners on an edge and four at a corner.
  // Compute the blend once in the caller, then copy identical values to all
  // owners; editing each owner's old value independently can create seams.
  setSampleWeights(worldX, worldZ, weights) {
    const gridX = Math.round(worldX / SPACING), gridZ = Math.round(worldZ / SPACING);
    if (![worldX, worldZ, gridX * SPACING, gridZ * SPACING].every(Number.isFinite)
      || !Number.isSafeInteger(gridX * SPACING) || !Number.isSafeInteger(gridZ * SPACING)
      || Math.abs(worldX - gridX * SPACING) > 1e-5 || Math.abs(worldZ - gridZ * SPACING) > 1e-5) throw new Error("Material edits must target a fixed terrain sample point.");
    if (!weights || weights.length !== TERRAIN_MATERIAL_COUNT) throw new Error("Expected eight material weights.");
    let sum = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("Invalid material weight.");
      sum += weight;
    }
    if (sum > 1 + WEIGHT_EPSILON) throw new Error("Material mask coverage exceeds one.");
    const next = Float32Array.from(weights, weight => weight / Math.max(1, sum));
    const primaryX = Math.floor(gridX / TERRAIN_TILE_SEGMENTS), primaryZ = Math.floor(gridZ / TERRAIN_TILE_SEGMENTS);
    const xs = gridX % TERRAIN_TILE_SEGMENTS === 0 ? [primaryX - 1, primaryX] : [primaryX];
    const zs = gridZ % TERRAIN_TILE_SEGMENTS === 0 ? [primaryZ - 1, primaryZ] : [primaryZ];
    let changed = 0;
    this.beginChanges();
    try {
      for (const tileX of xs) for (const tileZ of zs) {
        let tile = this.getTile(tileX, tileZ);
        const offset = ((gridZ - tileZ * TERRAIN_TILE_SEGMENTS) * (TERRAIN_TILE_SEGMENTS + 1) + gridX - tileX * TERRAIN_TILE_SEGMENTS) * TERRAIN_MATERIAL_COUNT;
        if (next.every((value, layer) => value === (tile?.weights[offset + layer] ?? 0))) continue;
        tile ??= this.getTile(tileX, tileZ, true);
        tile.weights.set(next, offset);
        tile.revision++;
        tile.dirty = true;
        this.changedTiles.add(tile);
        changed++;
      }
    } finally { this.endChanges(); }
    return changed;
  }

  snapshot() {
    const tiles = new Map(this.records), versions = new Map();
    for (const [key, tile] of this.cache) {
      if (!tile.dirty) continue;
      const bytes = packMaterialWeights(tile.weights);
      if (bytes.some(value => value !== 0)) tiles.set(key, JSON.stringify({ version: MATERIAL_MASK_VERSION, x: tile.x, z: tile.z, weights: encodeBytes(bytes) }));
      else tiles.delete(key); // Erasing all paint restores implicit ground.
      versions.set(tile, { key, revision: tile.revision });
    }
    return { materials: this.materials, tiles, versions, paletteRevision: this.paletteRevision };
  }

  commit(snapshot) {
    this.records = snapshot.tiles;
    this.savedPaletteRevision = snapshot.paletteRevision;
    for (const [tile, saved] of snapshot.versions) {
      if (this.cache.get(saved.key) === tile && tile.revision === saved.revision) tile.dirty = false;
    }
    this.trimCache();
  }
}
