import { proceduralHeight } from "./TerrainHeight.js";

export const TERRAIN_TILE_SIZE = 256;
export const TERRAIN_TILE_SEGMENTS = 128;
export const TERRAIN_TILE_VERSION = 4;
// Transient notification hints; not serialized. Unknown/direct mutations use
// ALL so consumers never infer unchanged exposure from a missing hint.
export const TERRAIN_CHANGE = Object.freeze({ HEIGHT: 1, WARP: 2, ROCK_EXPOSURE: 4, ALL: 7 });
const WARP_ACTIVITY_EPSILON = 0.001;

function encodeFloat32(values) {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeFloat32(base64, expectedLength) {
  const binary = atob(base64);
  if (binary.length !== expectedLength * Float32Array.BYTES_PER_ELEMENT) throw new Error("Terrain tile height payload has an invalid length.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Float32Array(bytes.buffer);
}

export class TerrainTile {
  constructor({ x, z, size, segments, heights, source = "procedural", warp = null, rockExposure = null, materialMask = null }) {
    this.x = x;
    this.z = z;
    this.size = size;
    this.segments = segments;
    this.heights = heights;
    this.source = source;
    // Loaded tiles may have saved height edits without a transient delta
    // buffer. Keep this fact when a later warp edit changes source to
    // "modified", so the GPU cache still derives their height delta.
    this.hasPersistentHeights = source === "persistent";
    this.revision = 0;
    this.dirty = false;
    // Allocated only after a persistent sample differs from the procedural
    // fallback. GPU upload then uses this compact delta field directly.
    this.heightDeltas = null;
    this.heightSummary = null;
    this.heightSummaryDirty = source === "persistent";
    // Reserved channels. They remain null until those systems are introduced.
    this.warp = warp;
    this.warpSummary = null;
    this.warpSummaryDirty = Boolean(warp);
    // Signed Rockify history. Positive values were pushed outward; negative
    // values were carved inward. It intentionally remains independent from
    // current warp magnitude so smoothing and opposing strokes do not erase
    // the artist's lighting intent.
    this.rockExposure = rockExposure;
    this.changedChannels = 0;
    this.materialMask = materialMask;
  }

  get sampleSpacing() { return this.size / this.segments; }

  heightAt(sampleX, sampleZ) {
    return this.heights[sampleZ * (this.segments + 1) + sampleX];
  }

  warpAt(sampleX, sampleZ, target = { x: 0, z: 0 }) {
    if (!this.warp) return target;
    const offset = (sampleZ * (this.segments + 1) + sampleX) * 2;
    target.x = this.warp[offset];
    target.z = this.warp[offset + 1];
    return target;
  }

  rockExposureAt(sampleX, sampleZ) {
    return this.rockExposure?.[sampleZ * (this.segments + 1) + sampleX] ?? 0;
  }
}

export class LocalStorageTerrainTileStore {
  constructor(namespace = "maxworld:terrain") {
    this.namespace = namespace;
  }

  read(key) {
    try {
      return globalThis.localStorage?.getItem(`${this.namespace}:${key}`) ?? null;
    } catch {
      return null;
    }
  }

  write(key, value) {
    try {
      globalThis.localStorage?.setItem(`${this.namespace}:${key}`, value);
      return true;
    } catch {
      return false;
    }
  }

  listKeys() {
    try {
      const prefix = `${this.namespace}:`;
      const keys = [];
      for (let index = 0; index < globalThis.localStorage.length; index += 1) {
        const name = globalThis.localStorage.key(index);
        if (name?.startsWith(prefix)) keys.push(name.slice(prefix.length));
      }
      return keys;
    } catch {
      return [];
    }
  }
}

export class TerrainDataProvider {
  constructor({ tileSize = TERRAIN_TILE_SIZE, tileSegments = TERRAIN_TILE_SEGMENTS, maxCachedTiles = 64, store = new LocalStorageTerrainTileStore() } = {}) {
    if (!Number.isInteger(tileSegments) || tileSegments <= 0) throw new Error("tileSegments must be a positive integer.");
    this.tileSize = tileSize;
    this.tileSegments = tileSegments;
    this.sampleSpacing = tileSize / tileSegments;
    this.maxCachedTiles = maxCachedTiles;
    this.store = store;
    this.cache = new Map();
    // Changes to tile membership/authorship, not LRU touches. The height GPU
    // cache uses this to reuse its small authored-key index between frames.
    this.tileStateRevision = 0;
    // This is deliberately only tile metadata, not another height cache. It
    // lets GPU streaming distinguish authored tiles from procedural terrain
    // without loading every saved Float32 tile into CPU memory.
    this.persistedTileKeys = new Set(store?.listKeys?.() ?? []);
    this.tileListeners = new Set();
    // The editor supplies this transient hint before a brush stamp. It is not
    // terrain data and is never serialized; the GPU cache uses it only to
    // give the current brush area precedence over unrelated visible tiles
    // when its full-resolution pool is saturated.
    this.activeEditTileKey = null;
    this.activeEditTileKeys = new Set();
    this.changeBatchDepth = 0;
    this.changedTiles = new Set();
    this.warpSummaries = new Map();
    this.heightSummaries = new Map();
    // Exact channel-presence metadata survives CPU eviction. The rock shell
    // can discover saved/disconnected regions as their owners are loaded.
    this.rockExposureTileKeys = new Set(store?.rockExposureTileKeys ?? []);
    // Diagnostic counters are accumulated between HUD refreshes. They only
    // measure newly-created procedural tiles, not ordinary cached sampling.
    this.profile = { generatedTiles: 0, generationMs: 0, generatedBySource: Object.create(null), warpSummaryTiles: 0, warpSummaryMs: 0 };
  }

  get cachedTileCount() { return this.cache.size; }

  onTileChanged(listener) {
    this.tileListeners.add(listener);
    return () => this.tileListeners.delete(listener);
  }

  beginChanges() {
    this.changeBatchDepth += 1;
  }

  endChanges() {
    if (this.changeBatchDepth === 0) throw new Error("endChanges called without beginChanges.");
    this.changeBatchDepth -= 1;
    if (this.changeBatchDepth !== 0) return;
    for (const tile of this.changedTiles) {
      this.refreshHeightSummary(tile);
      this.refreshWarpSummary(tile);
      this.emitTileChanged(tile);
    }
    this.changedTiles.clear();
  }

  tileKey(tileX, tileZ) { return `${tileX},${tileZ}`; }

  setActiveEditPosition(worldX, worldZ, radius = 0) {
    const tile = this.worldToTile(worldX, worldZ);
    this.activeEditTileKey = this.tileKey(tile.x, tile.z);
    this.activeEditTileKeys.clear();
    const min = this.worldToTile(worldX - radius, worldZ - radius);
    const max = this.worldToTile(worldX + radius, worldZ + radius);
    for (let z = min.z; z <= max.z; z += 1) for (let x = min.x; x <= max.x; x += 1) this.activeEditTileKeys.add(this.tileKey(x, z));
  }

  isTileAuthored(tileX, tileZ) {
    const key = this.tileKey(tileX, tileZ);
    const cached = this.cache.get(key);
    return cached ? cached.source !== "procedural" : this.persistedTileKeys.has(key);
  }

  worldToTile(worldX, worldZ) {
    return { x: Math.floor(worldX / this.tileSize), z: Math.floor(worldZ / this.tileSize) };
  }

  getTile(tileX, tileZ, requestSource = "direct") {
    const key = this.tileKey(tileX, tileZ);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const serialized = this.store?.read(key);
    let tile = serialized ? this.deserializeTile(serialized) : null;
    if (tile) this.persistedTileKeys.add(key);
    else if (serialized === null) this.persistedTileKeys.delete(key);
    if (!tile) tile = this.createProceduralTile(tileX, tileZ, requestSource);
    if (tile.rockExposure) this.rockExposureTileKeys.add(key);
    this.refreshHeightSummary(tile);
    this.refreshWarpSummary(tile);
    this.cache.set(key, tile);
    this.tileStateRevision += 1;
    this.trimCache(tile);
    return tile;
  }

  // Sampling untouched terrain must not allocate a 129 x 129 CPU tile. The
  // procedural baseline is already the authoritative value for such a tile;
  // edited/saved tiles are explicitly materialized on demand. This is the
  // copy-on-write boundary between the large logical world and the bounded
  // CPU cache.
  getSampleTile(tileX, tileZ, requestSource = "sample-authored") {
    const key = this.tileKey(tileX, tileZ);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    return this.persistedTileKeys.has(key) ? this.getTile(tileX, tileZ, requestSource) : null;
  }

  sampleHeight(worldX, worldZ) {
    const coordinates = this.worldToTile(worldX, worldZ);
    const tile = this.getSampleTile(coordinates.x, coordinates.z, "height-sample");
    if (!tile) return proceduralHeight(worldX, worldZ);
    const localX = (worldX - tile.x) / tile.sampleSpacing;
    const localZ = (worldZ - tile.z) / tile.sampleSpacing;
    const x0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localX)));
    const z0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localZ)));
    const xFraction = Math.min(1, Math.max(0, localX - x0));
    const zFraction = Math.min(1, Math.max(0, localZ - z0));
    const a = tile.heightAt(x0, z0);
    const b = tile.heightAt(x0 + 1, z0);
    const c = tile.heightAt(x0, z0 + 1);
    const d = tile.heightAt(x0 + 1, z0 + 1);
    return (a + (b - a) * xFraction) + ((c + (d - c) * xFraction) - (a + (b - a) * xFraction)) * zFraction;
  }

  // Editor hover picking must not create a chain of 2 m tiles along a long
  // camera ray. Existing cached edits are sampled exactly; uncached terrain
  // uses the same procedural fallback the renderer uses before streaming.
  sampleHeightCached(worldX, worldZ) {
    const coordinates = this.worldToTile(worldX, worldZ);
    // A long editor ray must not materialize arbitrary procedural tiles, but
    // it also cannot pretend an evicted authored tile is procedural terrain.
    // That mismatch made the hover circle ray-march through a visible saved
    // mountain and stamp a different tile behind it. Loading only known
    // persisted tiles keeps picking authoritative without turning a camera
    // move into a 2 m world-generation pass.
    const tile = this.getSampleTile(coordinates.x, coordinates.z, "picker-authored");
    if (!tile) return proceduralHeight(worldX, worldZ);
    const localX = (worldX - tile.x) / tile.sampleSpacing;
    const localZ = (worldZ - tile.z) / tile.sampleSpacing;
    const x0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localX)));
    const z0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localZ)));
    const xFraction = Math.min(1, Math.max(0, localX - x0));
    const zFraction = Math.min(1, Math.max(0, localZ - z0));
    const a = tile.heightAt(x0, z0);
    const b = tile.heightAt(x0 + 1, z0);
    const c = tile.heightAt(x0, z0 + 1);
    const d = tile.heightAt(x0 + 1, z0 + 1);
    return (a + (b - a) * xFraction) + ((c + (d - c) * xFraction) - (a + (b - a) * xFraction)) * zFraction;
  }

  sampleWarp(worldX, worldZ, target = { x: 0, z: 0 }) {
    const coordinates = this.worldToTile(worldX, worldZ);
    const tile = this.getSampleTile(coordinates.x, coordinates.z, "warp-sample");
    if (!tile) {
      target.x = 0;
      target.z = 0;
      return target;
    }
    if (!tile.warp) {
      target.x = 0;
      target.z = 0;
      return target;
    }
    const localX = (worldX - tile.x) / tile.sampleSpacing;
    const localZ = (worldZ - tile.z) / tile.sampleSpacing;
    const x0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localX)));
    const z0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localZ)));
    const xFraction = Math.min(1, Math.max(0, localX - x0));
    const zFraction = Math.min(1, Math.max(0, localZ - z0));
    const width = tile.segments + 1;
    const a = (z0 * width + x0) * 2;
    const b = a + 2;
    const c = a + width * 2;
    const d = c + 2;
    const x0Value = tile.warp[a] + (tile.warp[b] - tile.warp[a]) * xFraction;
    const x1Value = tile.warp[c] + (tile.warp[d] - tile.warp[c]) * xFraction;
    const z0Value = tile.warp[a + 1] + (tile.warp[b + 1] - tile.warp[a + 1]) * xFraction;
    const z1Value = tile.warp[c + 1] + (tile.warp[d + 1] - tile.warp[c + 1]) * xFraction;
    target.x = x0Value + (x1Value - x0Value) * zFraction;
    target.z = z0Value + (z1Value - z0Value) * zFraction;
    return target;
  }

  sampleRockExposure(worldX, worldZ) {
    const coordinates = this.worldToTile(worldX, worldZ);
    const tile = this.getSampleTile(coordinates.x, coordinates.z, "exposure-sample");
    if (!tile) return 0;
    if (!tile.rockExposure) return 0;
    const localX = (worldX - tile.x) / tile.sampleSpacing;
    const localZ = (worldZ - tile.z) / tile.sampleSpacing;
    const x0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localX)));
    const z0 = Math.min(tile.segments - 1, Math.max(0, Math.floor(localZ)));
    const xFraction = Math.min(1, Math.max(0, localX - x0));
    const zFraction = Math.min(1, Math.max(0, localZ - z0));
    const width = tile.segments + 1;
    const a = z0 * width + x0;
    const b = a + 1;
    const c = a + width;
    const d = c + 1;
    const first = tile.rockExposure[a] + (tile.rockExposure[b] - tile.rockExposure[a]) * xFraction;
    const second = tile.rockExposure[c] + (tile.rockExposure[d] - tile.rockExposure[c]) * xFraction;
    return first + (second - first) * zFraction;
  }

  // Finds the canonical height-field coordinate beneath a visibly warped XZ
  // position. A few fixed iterations keep editor picking inexpensive; with
  // intentionally folded Rockify geometry this remains an approximation.
  sampleSurfaceHeight(worldX, worldZ) {
    let sourceX = worldX;
    let sourceZ = worldZ;
    const warp = { x: 0, z: 0 };
    for (let iteration = 0; iteration < 3; iteration += 1) {
      this.sampleWarp(sourceX, sourceZ, warp);
      sourceX = worldX - warp.x;
      sourceZ = worldZ - warp.z;
    }
    return this.sampleHeight(sourceX, sourceZ);
  }

  // The renderer stores a tile as a delta from the shared procedural base,
  // never as absolute heights. A deserialized tile has the authoritative
  // absolute field but no transient delta field yet. Materialize every delta
  // before changing one sample; creating a zero-filled buffer here would
  // otherwise erase the rest of its saved edits on the GPU.
  ensureHeightDeltas(tile) {
    if (tile.heightDeltas) return tile.heightDeltas;
    if (!tile.hasPersistentHeights) return null;
    const deltas = new Float32Array(tile.heights.length);
    const width = tile.segments + 1;
    for (let sampleZ = 0; sampleZ < width; sampleZ += 1) {
      for (let sampleX = 0; sampleX < width; sampleX += 1) {
        const index = sampleZ * width + sampleX;
        const worldX = tile.x + sampleX * tile.sampleSpacing;
        const worldZ = tile.z + sampleZ * tile.sampleSpacing;
        deltas[index] = tile.heights[index] - proceduralHeight(worldX, worldZ);
      }
    }
    tile.heightDeltas = deltas;
    return deltas;
  }

  // Changes one fixed terrain sample. At a tile edge the duplicate sample in
  // every neighbouring tile is changed too, preserving a seamless data field.
  setHeightSample(worldX, worldZ, height) {
    const gridX = Math.round(worldX / this.sampleSpacing);
    const gridZ = Math.round(worldZ / this.sampleSpacing);
    const alignedX = gridX * this.sampleSpacing;
    const alignedZ = gridZ * this.sampleSpacing;
    if (Math.abs(worldX - alignedX) > 1e-5 || Math.abs(worldZ - alignedZ) > 1e-5) {
      throw new Error("Height edits must target a fixed terrain sample point.");
    }

    const primaryX = Math.floor(gridX / this.tileSegments);
    const primaryZ = Math.floor(gridZ / this.tileSegments);
    const tileXs = gridX % this.tileSegments === 0 ? [primaryX - 1, primaryX] : [primaryX];
    const tileZs = gridZ % this.tileSegments === 0 ? [primaryZ - 1, primaryZ] : [primaryZ];
    for (const tileX of tileXs) for (const tileZ of tileZs) {
      const tile = this.getTile(tileX, tileZ, "height-edit");
      const localX = gridX - tileX * this.tileSegments;
      const localZ = gridZ - tileZ * this.tileSegments;
      const index = localZ * (this.tileSegments + 1) + localX;
      if (tile.heights[index] === height) continue;
      tile.heights[index] = height;
      tile.heightSummaryDirty = true;
      // Warp picker candidate bounds include Y as well as XZ. A raised or
      // lowered warped tile therefore needs its retained warp summary
      // refreshed too; otherwise a valid tall surface could be rejected
      // before its triangles are tested.
      if (tile.warp) tile.warpSummaryDirty = true;
      const deltas = this.ensureHeightDeltas(tile) ?? (tile.heightDeltas ??= new Float32Array(tile.heights.length));
      deltas[index] = height - proceduralHeight(alignedX, alignedZ);
      tile.source = "modified";
      tile.dirty = true;
      tile.revision += 1;
      // Console-only cache-residency diagnostics use the actual edited
      // source sample. Keeping this lightweight metadata on the CPU tile
      // avoids incorrectly inspecting the unchanged centre of a large tile.
      tile.lastChangedSample = { x: alignedX, z: alignedZ, index, height, revision: tile.revision };
      this.markTileChanged(tile, TERRAIN_CHANGE.HEIGHT);
    }
  }

  // Warp samples are duplicated at tile borders using the same fixed-grid
  // ownership rule as heights. Every LOD therefore interpolates one shared
  // continuous XZ field rather than per-patch offsets.
  setWarpSample(worldX, worldZ, warpX, warpZ) {
    const gridX = Math.round(worldX / this.sampleSpacing);
    const gridZ = Math.round(worldZ / this.sampleSpacing);
    const alignedX = gridX * this.sampleSpacing;
    const alignedZ = gridZ * this.sampleSpacing;
    if (Math.abs(worldX - alignedX) > 1e-5 || Math.abs(worldZ - alignedZ) > 1e-5) {
      throw new Error("Warp edits must target a fixed terrain sample point.");
    }
    const primaryX = Math.floor(gridX / this.tileSegments);
    const primaryZ = Math.floor(gridZ / this.tileSegments);
    const tileXs = gridX % this.tileSegments === 0 ? [primaryX - 1, primaryX] : [primaryX];
    const tileZs = gridZ % this.tileSegments === 0 ? [primaryZ - 1, primaryZ] : [primaryZ];
    for (const tileX of tileXs) for (const tileZ of tileZs) {
      const tile = this.getTile(tileX, tileZ, "warp-edit");
      if (!tile.warp) tile.warp = new Float32Array(tile.heights.length * 2);
      const localX = gridX - tileX * this.tileSegments;
      const localZ = gridZ - tileZ * this.tileSegments;
      const offset = (localZ * (this.tileSegments + 1) + localX) * 2;
      if (tile.warp[offset] === warpX && tile.warp[offset + 1] === warpZ) continue;
      tile.warp[offset] = warpX;
      tile.warp[offset + 1] = warpZ;
      tile.warpSummaryDirty = true;
      tile.source = "modified";
      tile.dirty = true;
      tile.revision += 1;
      this.markTileChanged(tile, TERRAIN_CHANGE.WARP);
    }
  }

  setRockExposureSample(worldX, worldZ, exposure) {
    const gridX = Math.round(worldX / this.sampleSpacing);
    const gridZ = Math.round(worldZ / this.sampleSpacing);
    const alignedX = gridX * this.sampleSpacing;
    const alignedZ = gridZ * this.sampleSpacing;
    if (Math.abs(worldX - alignedX) > 1e-5 || Math.abs(worldZ - alignedZ) > 1e-5) {
      throw new Error("Rock exposure edits must target a fixed terrain sample point.");
    }
    const primaryX = Math.floor(gridX / this.tileSegments);
    const primaryZ = Math.floor(gridZ / this.tileSegments);
    const tileXs = gridX % this.tileSegments === 0 ? [primaryX - 1, primaryX] : [primaryX];
    const tileZs = gridZ % this.tileSegments === 0 ? [primaryZ - 1, primaryZ] : [primaryZ];
    for (const tileX of tileXs) for (const tileZ of tileZs) {
      const tile = this.getTile(tileX, tileZ, "exposure-edit");
      const localX = gridX - tileX * this.tileSegments;
      const localZ = gridZ - tileZ * this.tileSegments;
      const index = localZ * (this.tileSegments + 1) + localX;
      if (!tile.rockExposure) tile.rockExposure = new Float32Array(tile.heights.length);
      if (tile.rockExposure[index] === exposure) continue;
      tile.rockExposure[index] = exposure;
      tile.source = "modified";
      tile.dirty = true;
      tile.revision += 1;
      this.markTileChanged(tile, TERRAIN_CHANGE.ROCK_EXPOSURE);
    }
  }

  createProceduralTile(tileX, tileZ, requestSource = "direct") {
    const started = performance.now();
    const count = this.tileSegments + 1;
    const heights = new Float32Array(count * count);
    const originX = tileX * this.tileSize;
    const originZ = tileZ * this.tileSize;
    for (let sampleZ = 0; sampleZ < count; sampleZ += 1) {
      for (let sampleX = 0; sampleX < count; sampleX += 1) {
        heights[sampleZ * count + sampleX] = proceduralHeight(originX + sampleX * this.sampleSpacing, originZ + sampleZ * this.sampleSpacing);
      }
    }
    this.profile.generatedTiles += 1;
    this.profile.generationMs += performance.now() - started;
    this.profile.generatedBySource[requestSource] = (this.profile.generatedBySource[requestSource] ?? 0) + 1;
    return new TerrainTile({ x: originX, z: originZ, size: this.tileSize, segments: this.tileSegments, heights });
  }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { generatedTiles: 0, generationMs: 0, generatedBySource: Object.create(null), warpSummaryTiles: 0, warpSummaryMs: 0 };
    return profile;
  }

  refreshWarpSummary(tile) {
    if (!tile.warpSummaryDirty) return tile.warpSummary;
    const started = performance.now();
    const key = this.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size));
    const warp = tile.warp;
    if (!warp) {
      tile.warpSummary = null;
      tile.warpSummaryDirty = false;
      this.warpSummaries.delete(key);
      return null;
    }
    const width = tile.segments + 1;
    let minWarpX = Infinity, maxWarpX = -Infinity, minWarpZ = Infinity, maxWarpZ = -Infinity;
    let minHeight = Infinity, maxHeight = -Infinity;
    let activeMinX = Infinity, activeMaxX = -Infinity, activeMinZ = Infinity, activeMaxZ = -Infinity;
    let maxGradient = 0;
    for (let z = 0; z < width; z += 1) for (let x = 0; x < width; x += 1) {
      const offset = (z * width + x) * 2;
      const warpX = warp[offset], warpZ = warp[offset + 1];
      const height = tile.heights[z * width + x];
      minWarpX = Math.min(minWarpX, warpX);
      maxWarpX = Math.max(maxWarpX, warpX);
      minWarpZ = Math.min(minWarpZ, warpZ);
      maxWarpZ = Math.max(maxWarpZ, warpZ);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      if (Math.abs(warpX) > WARP_ACTIVITY_EPSILON || Math.abs(warpZ) > WARP_ACTIVITY_EPSILON) {
        activeMinX = Math.min(activeMinX, x); activeMaxX = Math.max(activeMaxX, x);
        activeMinZ = Math.min(activeMinZ, z); activeMaxZ = Math.max(activeMaxZ, z);
      }
      if (x > 0) {
        const previous = offset - 2;
        maxGradient = Math.max(maxGradient, Math.hypot(warpX - warp[previous], warpZ - warp[previous + 1]) / tile.sampleSpacing);
      }
      if (z > 0) {
        const previous = offset - width * 2;
        maxGradient = Math.max(maxGradient, Math.hypot(warpX - warp[previous], warpZ - warp[previous + 1]) / tile.sampleSpacing);
      }
    }
    const active = activeMinX !== Infinity;
    tile.warpSummary = active ? {
      tileX: Math.round(tile.x / tile.size), tileZ: Math.round(tile.z / tile.size),
      minWarpX, maxWarpX, minWarpZ, maxWarpZ, minHeight, maxHeight, maxGradient,
      activeMinSampleX: activeMinX, activeMaxSampleX: activeMaxX,
      activeMinSampleZ: activeMinZ, activeMaxSampleZ: activeMaxZ,
      sourceMinX: tile.x + activeMinX * tile.sampleSpacing,
      sourceMaxX: tile.x + activeMaxX * tile.sampleSpacing,
      sourceMinZ: tile.z + activeMinZ * tile.sampleSpacing,
      sourceMaxZ: tile.z + activeMaxZ * tile.sampleSpacing,
    } : null;
    tile.warpSummaryDirty = false;
    if (tile.warpSummary) this.warpSummaries.set(key, tile.warpSummary);
    else this.warpSummaries.delete(key);
    this.profile.warpSummaryTiles += 1;
    this.profile.warpSummaryMs += performance.now() - started;
    return tile.warpSummary;
  }

  refreshHeightSummary(tile) {
    if (!tile.heightSummaryDirty) return tile.heightSummary;
    const key = this.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size));
    if (tile.source === "procedural" && !tile.heightDeltas) {
      tile.heightSummary = null;
      tile.heightSummaryDirty = false;
      this.heightSummaries.delete(key);
      return null;
    }
    let minHeight = Infinity, maxHeight = -Infinity;
    for (const height of tile.heights) {
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }
    tile.heightSummary = { x: tile.x, z: tile.z, size: tile.size, minHeight, maxHeight };
    tile.heightSummaryDirty = false;
    this.heightSummaries.set(key, tile.heightSummary);
    return tile.heightSummary;
  }

  getHeightBoundsForArea(minX, minZ, maxX, maxZ, target = {}) {
    let found = false;
    target.minHeight = Infinity;
    target.maxHeight = -Infinity;
    for (const summary of this.heightSummaries.values()) {
      if (summary.x + summary.size < minX || summary.x > maxX || summary.z + summary.size < minZ || summary.z > maxZ) continue;
      found = true;
      target.minHeight = Math.min(target.minHeight, summary.minHeight);
      target.maxHeight = Math.max(target.maxHeight, summary.maxHeight);
    }
    return found ? target : null;
  }

  // A modified source tile can meet an otherwise procedural neighbour at a
  // quadtree boundary. Keep a small conservative culling guard around that
  // relationship so an adjacent fallback patch is never rejected while its
  // edited neighbour remains visible.
  hasPersistentTerrainNearArea(minX, minZ, maxX, maxZ, guard = 0) {
    const overlaps = (left, top, right, bottom) => !(right + guard < minX || left - guard > maxX || bottom + guard < minZ || top - guard > maxZ);
    for (const summary of this.heightSummaries.values()) {
      if (overlaps(summary.x, summary.z, summary.x + summary.size, summary.z + summary.size)) return true;
    }
    for (const summary of this.warpSummaries.values()) {
      const displacedMinX = summary.sourceMinX + summary.minWarpX;
      const displacedMaxX = summary.sourceMaxX + summary.maxWarpX;
      const displacedMinZ = summary.sourceMinZ + summary.minWarpZ;
      const displacedMaxZ = summary.sourceMaxZ + summary.maxWarpZ;
      if (overlaps(summary.sourceMinX, summary.sourceMinZ, summary.sourceMaxX, summary.sourceMaxZ)
        || overlaps(displacedMinX, displacedMinZ, displacedMaxX, displacedMaxZ)) return true;
    }
    return false;
  }

  // Uses only retained metadata: quadtree selection must never create terrain
  // tiles or deserialize saves merely to decide LOD/culling.
  getWarpDetailForArea(minX, minZ, maxX, maxZ, guard = 0, target = {}, includeDisplacedFootprint = false) {
    let found = false;
    target.minWarpX = 0; target.maxWarpX = 0;
    target.minWarpZ = 0; target.maxWarpZ = 0;
    target.sourceMinX = Infinity; target.sourceMaxX = -Infinity;
    target.sourceMinZ = Infinity; target.sourceMaxZ = -Infinity;
    target.maxGradient = 0;
    for (const summary of this.warpSummaries.values()) {
      // Culling needs source-space overlap: this summary's warp values only
      // belong to its own source grid. Feature LOD may additionally follow
      // the displaced footprint, but using that footprint for culling would
      // incorrectly apply a remote warp to an unrelated patch's bounds.
      const displacedMinX = summary.sourceMinX + summary.minWarpX;
      const displacedMaxX = summary.sourceMaxX + summary.maxWarpX;
      const displacedMinZ = summary.sourceMinZ + summary.minWarpZ;
      const displacedMaxZ = summary.sourceMaxZ + summary.maxWarpZ;
      const sourceOverlaps = !(summary.sourceMaxX + guard < minX || summary.sourceMinX - guard > maxX
        || summary.sourceMaxZ + guard < minZ || summary.sourceMinZ - guard > maxZ);
      const displacedOverlaps = !(displacedMaxX + guard < minX || displacedMinX - guard > maxX
        || displacedMaxZ + guard < minZ || displacedMinZ - guard > maxZ);
      if (!sourceOverlaps && !(includeDisplacedFootprint && displacedOverlaps)) continue;
      found = true;
      target.minWarpX = Math.min(target.minWarpX, summary.minWarpX);
      target.maxWarpX = Math.max(target.maxWarpX, summary.maxWarpX);
      target.minWarpZ = Math.min(target.minWarpZ, summary.minWarpZ);
      target.maxWarpZ = Math.max(target.maxWarpZ, summary.maxWarpZ);
      target.sourceMinX = Math.min(target.sourceMinX, summary.sourceMinX);
      target.sourceMaxX = Math.max(target.sourceMaxX, summary.sourceMaxX);
      target.sourceMinZ = Math.min(target.sourceMinZ, summary.sourceMinZ);
      target.sourceMaxZ = Math.max(target.sourceMaxZ, summary.sourceMaxZ);
      if (includeDisplacedFootprint) {
        target.sourceMinX = Math.min(target.sourceMinX, displacedMinX);
        target.sourceMaxX = Math.max(target.sourceMaxX, displacedMaxX);
        target.sourceMinZ = Math.min(target.sourceMinZ, displacedMinZ);
        target.sourceMaxZ = Math.max(target.sourceMaxZ, displacedMaxZ);
      }
      target.maxGradient = Math.max(target.maxGradient, summary.maxGradient);
    }
    return found ? target : null;
  }

  serializeTile(tile) {
    if (!(tile instanceof TerrainTile)) throw new Error("serializeTile expects a TerrainTile.");
    return JSON.stringify({
      version: TERRAIN_TILE_VERSION,
      x: tile.x,
      z: tile.z,
      size: tile.size,
      segments: tile.segments,
      heights: encodeFloat32(tile.heights),
      warp: tile.warp ? encodeFloat32(tile.warp) : null,
      rockExposure: tile.rockExposure ? encodeFloat32(tile.rockExposure) : null,
      // Material masks remain reserved; warp stores interleaved Float32 X/Z.
      channels: { height: "float32", warp: tile.warp ? "float32x2" : null, rockExposure: tile.rockExposure ? "float32" : null, materialMask: null },
    });
  }

  deserializeTile(serialized) {
    try {
      const record = JSON.parse(serialized);
      if (![2, 3, TERRAIN_TILE_VERSION].includes(record.version) || record.size !== this.tileSize || record.segments !== this.tileSegments) return null;
      const count = (this.tileSegments + 1) ** 2;
      const warp = record.warp ? decodeFloat32(record.warp, count * 2) : null;
      const rockExposure = record.rockExposure ? decodeFloat32(record.rockExposure, count) : null;
      return new TerrainTile({ x: record.x, z: record.z, size: record.size, segments: record.segments, heights: decodeFloat32(record.heights, count), source: "persistent", warp, rockExposure });
    } catch {
      return null;
    }
  }

  saveTile(tile) {
    if (!this.store) return false;
    const tileX = Math.round(tile.x / this.tileSize);
    const tileZ = Math.round(tile.z / this.tileSize);
    const saved = this.store.write(this.tileKey(tileX, tileZ), this.serializeTile(tile));
    if (saved) {
      tile.dirty = false;
      if (!this.persistedTileKeys.has(this.tileKey(tileX, tileZ))) this.tileStateRevision += 1;
      this.persistedTileKeys.add(this.tileKey(tileX, tileZ));
    }
    return saved;
  }

  saveDirtyTiles() {
    let saved = 0;
    for (const tile of this.cache.values()) {
      if (tile.dirty && this.saveTile(tile)) saved += 1;
    }
    return saved;
  }

  markTileChanged(tile, channels = TERRAIN_CHANGE.ALL) {
    tile.changedChannels |= channels;
    if (tile.rockExposure) this.rockExposureTileKeys.add(this.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size)));
    if (this.changeBatchDepth > 0) {
      this.changedTiles.add(tile);
      return;
    }
    this.refreshHeightSummary(tile);
    this.refreshWarpSummary(tile);
    this.emitTileChanged(tile);
  }

  emitTileChanged(tile) {
    this.tileStateRevision += 1;
    const channels = tile.changedChannels || TERRAIN_CHANGE.ALL;
    tile.changedChannels = 0;
    for (const listener of this.tileListeners) listener(tile, channels);
  }

  trimCache(retainedTile = null) {
    while (this.cache.size > this.maxCachedTiles) {
      // A newly requested tile is still clean until its caller edits it. If
      // all older tiles are dirty, evicting this tile would detach the edit
      // and regenerate its full height field for every subsequent sample.
      // Keep it under the same soft-limit policy that retains unsaved tiles.
      const disposable = [...this.cache.entries()].find(([, tile]) => !tile.dirty && tile !== retainedTile);
      if (!disposable) return;
      this.cache.delete(disposable[0]);
      this.tileStateRevision += 1;
    }
  }
}
