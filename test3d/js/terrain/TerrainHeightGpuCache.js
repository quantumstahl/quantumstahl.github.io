import * as THREE from "three";
import { proceduralHeight } from "./TerrainHeight.js";

const INVALID_TILE_COORDINATE = 2147483647;

function createOverviewTexture(data, width, height, format) {
  const texture = new THREE.DataTexture(data, width, height, format, THREE.FloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// Bounded detail layers backed by a geographic overview. All representations
// contain deltas; only untouched terrain renders with the procedural base.
export class TerrainHeightGpuCache {
  constructor(provider, { radius = 1, persistentSlots = 16, maxUploadsPerFrame = 1 } = {}) {
    this.provider = provider;
    this.radius = radius;
    this.windowWidth = radius * 2 + 1;
    this.windowSlotCount = this.windowWidth ** 2;
    this.layerCount = this.windowSlotCount + persistentSlots;
    this.samples = provider.tileSegments + 1;
    this.samplesPerTile = this.samples ** 2;
    this.data = new Float32Array(this.samplesPerTile * this.layerCount);
    this.texture = new THREE.DataArrayTexture(this.data, this.samples, this.samples, this.layerCount);
    this.texture.format = THREE.RedFormat;
    this.texture.type = THREE.FloatType;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
    // Warp shares layer ownership and coordinates with heights, but is kept
    // separate so a height tile remains a compact single-channel texture.
    this.warpData = new Float32Array(this.samplesPerTile * this.layerCount * 2);
    this.warpTexture = new THREE.DataArrayTexture(this.warpData, this.samples, this.samples, this.layerCount);
    this.warpTexture.format = THREE.RGFormat;
    this.warpTexture.type = THREE.FloatType;
    this.warpTexture.minFilter = THREE.NearestFilter;
    this.warpTexture.magFilter = THREE.NearestFilter;
    this.warpTexture.generateMipmaps = false;
    this.warpTexture.unpackAlignment = 1;
    this.warpTexture.needsUpdate = true;
    // Rockify's signed exposure shares the same layer mapping as height and
    // warp, but is kept separate so it can remain an optional scalar channel.
    this.rockExposureData = new Float32Array(this.samplesPerTile * this.layerCount);
    this.rockExposureTexture = new THREE.DataArrayTexture(this.rockExposureData, this.samples, this.samples, this.layerCount);
    this.rockExposureTexture.format = THREE.RedFormat;
    this.rockExposureTexture.type = THREE.FloatType;
    this.rockExposureTexture.minFilter = THREE.NearestFilter;
    this.rockExposureTexture.magFilter = THREE.NearestFilter;
    this.rockExposureTexture.generateMipmaps = false;
    this.rockExposureTexture.unpackAlignment = 1;
    this.rockExposureTexture.needsUpdate = true;

    // Reuse the coarse textures as a geographic overview, at a constant
    // 16 m grid per tile rather than compressing every view into 128 texels.
    // Each tile owns 17x17 texels including BOTH borders, so filtering never
    // blends an authored tile with an unrelated/empty neighbour. A 20x20
    // tile world needs only 340x340 texels, independently of residency slots.
    this.coarseSamples = 17;
    this.coarseWidth = this.coarseSamples;
    this.coarseHeight = this.coarseSamples;
    this.coarseData = new Float32Array(this.coarseWidth * this.coarseHeight * 2);
    this.coarseWarpData = new Float32Array(this.coarseData.length);
    // Preserve signed history AND absolute rock coverage through filtering.
    // Opposing strokes can cancel shading without making the rock disappear.
    this.coarseExposureData = new Float32Array(this.coarseWidth * this.coarseHeight * 2);
    this.coarseTexture = createOverviewTexture(this.coarseData, this.coarseWidth, this.coarseHeight, THREE.RGFormat);
    this.coarseWarpTexture = createOverviewTexture(this.coarseWarpData, this.coarseWidth, this.coarseHeight, THREE.RGFormat);
    this.coarseExposureTexture = createOverviewTexture(this.coarseExposureData, this.coarseWidth, this.coarseHeight, THREE.RGFormat);
    this.coarseOrigin = new THREE.Vector2();
    this.coarseSize = new THREE.Vector2(1, 1);
    this.coarseEnabled = false;
    // Derived overviews survive CPU eviction, but never retain a full CPU
    // tile. Saved tiles are read at most once for overview coverage. Changes
    // overwrite just that tile's overview; idle frames do no texture work.
    this.coarseTiles = new Map();
    this.coarseCapturedRevisions = new WeakMap();
    this.coarseDirtyTiles = new Set();
    this.coarsePublishedKeys = new Set();
    this.coarseDirty = false;
    // Scalar bounds only, retained alongside geographic overviews. Union all
    // captured revisions: an older full/fallback upload can still be sampled
    // while a newer edit is queued. Shrinking to the newest CPU shape could
    // otherwise cull a surface which the GPU is still rendering.
    this.cullingBounds = new Map();

    // Overflow tiles get their own lower-resolution layers. The layer count
    // is bounded, while every layer still covers exactly one 256 m source
    // tile, so authored shapes remain tile-local and cannot bleed into a
    // neighbour. 33 samples means an 8 m fallback grid; the full 2 m layers
    // are still used whenever available.
    this.fallbackSamples = 33;
    this.fallbackSamplesPerTile = this.fallbackSamples ** 2;
    this.fallbackLayerCount = 96;
    this.fallbackData = new Float32Array(this.fallbackSamplesPerTile * this.fallbackLayerCount);
    this.fallbackTexture = new THREE.DataArrayTexture(this.fallbackData, this.fallbackSamples, this.fallbackSamples, this.fallbackLayerCount);
    this.fallbackTexture.format = THREE.RedFormat;
    this.fallbackTexture.type = THREE.FloatType;
    this.fallbackTexture.minFilter = THREE.NearestFilter;
    this.fallbackTexture.magFilter = THREE.NearestFilter;
    this.fallbackTexture.generateMipmaps = false;
    this.fallbackTexture.unpackAlignment = 1;
    this.fallbackTexture.needsUpdate = true;
    this.fallbackWarpData = new Float32Array(this.fallbackSamplesPerTile * this.fallbackLayerCount * 2);
    this.fallbackWarpTexture = new THREE.DataArrayTexture(this.fallbackWarpData, this.fallbackSamples, this.fallbackSamples, this.fallbackLayerCount);
    this.fallbackWarpTexture.format = THREE.RGFormat;
    this.fallbackWarpTexture.type = THREE.FloatType;
    this.fallbackWarpTexture.minFilter = THREE.NearestFilter;
    this.fallbackWarpTexture.magFilter = THREE.NearestFilter;
    this.fallbackWarpTexture.generateMipmaps = false;
    this.fallbackWarpTexture.unpackAlignment = 1;
    this.fallbackWarpTexture.needsUpdate = true;
    this.fallbackExposureData = new Float32Array(this.fallbackSamplesPerTile * this.fallbackLayerCount);
    this.fallbackExposureTexture = new THREE.DataArrayTexture(this.fallbackExposureData, this.fallbackSamples, this.fallbackSamples, this.fallbackLayerCount);
    this.fallbackExposureTexture.format = THREE.RedFormat;
    this.fallbackExposureTexture.type = THREE.FloatType;
    this.fallbackExposureTexture.minFilter = THREE.NearestFilter;
    this.fallbackExposureTexture.magFilter = THREE.NearestFilter;
    this.fallbackExposureTexture.generateMipmaps = false;
    this.fallbackExposureTexture.unpackAlignment = 1;
    this.fallbackExposureTexture.needsUpdate = true;
    this.fallbackMapSize = 64;
    this.fallbackTileMapData = new Float32Array(this.fallbackMapSize ** 2);
    this.fallbackTileMap = new THREE.DataTexture(this.fallbackTileMapData, this.fallbackMapSize, this.fallbackMapSize, THREE.RedFormat, THREE.FloatType);
    this.fallbackTileMap.minFilter = THREE.NearestFilter;
    this.fallbackTileMap.magFilter = THREE.NearestFilter;
    this.fallbackTileMap.generateMipmaps = false;
    this.fallbackTileMap.needsUpdate = true;
    this.fallbackMapOrigin = new THREE.Vector2();
    this.fallbackMapExtent = new THREE.Vector2(1, 1);
    this.fallbackKeyToLayer = new Map();
    this.fallbackLayerToKey = new Array(this.fallbackLayerCount).fill(null);
    this.fallbackLayerLastUsed = new Uint32Array(this.fallbackLayerCount);
    this.pendingFallbackUploads = new Map();
    this.dirtyFallbackUploads = new Map();
    this.fallbackMapDirty = true;

    this.tileCoordinates = new Int32Array(this.layerCount * 2);
    this.tileCoordinates.fill(INVALID_TILE_COORDINATE);
    this.keyToLayer = new Map();
    this.layerToKey = new Array(this.layerCount).fill(null);
    this.layerLastUsed = new Uint32Array(this.layerCount);
    this.usageTick = 0;
    this.windowKeys = new Set();
    this.visibleKeys = new Set();
    // Only authored keys can need residency. Do not walk the much larger
    // selected source rectangle (mostly procedural tiles) on every frame.
    this.authoredKeys = new Set();
    this.authoredRevision = -1;
    this.authoredCache = null;
    this.authoredPersistedKeys = null;
    this.authoredCacheSize = -1;
    this.authoredPersistedSize = -1;
    this.centerTileX = null;
    this.centerTileZ = null;
    this.uploadedLayers = 0;
    this.maxUploadsPerFrame = Math.max(1, maxUploadsPerFrame | 0);
    this.pendingUploads = new Map();
    this.dirtyFullUploads = new Map();
    // The console-only residency trace was used to diagnose the overflow
    // regression. Keep its state for an opt-in local investigation, but do
    // not emit DevTools objects during normal sculpting: expanded console
    // logging is itself capable of destroying editor frame pacing.
    this.fullUploadRevisions = new Map();
    this.fallbackUploadRevisions = new Map();
    this.residencyTrace = null;
    this.residencyTraceEnabled = false;
    this.newTileUploadsEnabled = true;
    this.profile = { updateMs: 0, updatePeakMs: 0, remapMs: 0, uploadPreparationMs: 0, uploadPreparationPeakMs: 0, remappedTiles: 0, uploadedLayers: 0, pendingUploads: 0, visibleRequired: 0, visibleResident: 0, visibleFallback: 0, visibleCoarse: 0, visibleUnavailable: 0, visibleOverflow: 0, coarseBuildMs: 0, coarseUploads: 0 };
    Object.assign(this.profile, { sourceKeysExamined: 0, authoredKeysExamined: 0, coverageKeysExamined: 0, authoredIndexRebuilds: 0, updatePasses: 0, idleFrames: 0, fallbackUploadedLayers: 0 });
    this.unsubscribe = provider.onTileChanged(tile => this.onTileChanged(tile));
  }

  get uniforms() {
    return {
      texture: this.texture,
      warpTexture: this.warpTexture,
      rockExposureTexture: this.rockExposureTexture,
      tileCoordinates: this.tileCoordinates,
      tileSize: this.provider.tileSize,
      tileSegments: this.provider.tileSegments,
      layerCount: this.layerCount,
      coarseTexture: this.coarseTexture,
      coarseWarpTexture: this.coarseWarpTexture,
      coarseExposureTexture: this.coarseExposureTexture,
      coarseOrigin: this.coarseOrigin,
      coarseSize: this.coarseSize,
      coarseEnabled: this.coarseEnabled,
      fallbackTexture: this.fallbackTexture,
      fallbackWarpTexture: this.fallbackWarpTexture,
      fallbackExposureTexture: this.fallbackExposureTexture,
      fallbackTileMap: this.fallbackTileMap,
      fallbackMapOrigin: this.fallbackMapOrigin,
      fallbackMapExtent: this.fallbackMapExtent,
      fallbackSamples: this.fallbackSamples,
      fallbackEnabled: this.fallbackKeyToLayer.size > 0,
    };
  }

  update(worldX, worldZ, visibleSourceKeys = null) {
    if (!this.newTileUploadsEnabled) return;
    const started = performance.now();
    const centerX = Math.floor(worldX / this.provider.tileSize);
    const centerZ = Math.floor(worldZ / this.provider.tileSize);
    const sourceKeys = visibleSourceKeys instanceof Set ? visibleSourceKeys : new Set(visibleSourceKeys ?? []);
    const nextVisibleKeys = this.visibleAuthoredKeys(sourceKeys);
    // A camera center alone is not a valid cache state. After a context or
    // diagnostic transition the previous center can remain recorded while
    // every layer mapping has been released; returning early then renders
    // only the sparse procedural fallback and hides persistent LOD metadata.
    // Only authored tiles consume GPU layers. Procedural terrain is evaluated
    // directly in the vertex shader, so reserving a layer for every camera
    // window tile merely exhausts the cache without adding data.
    let visibleIsCovered = true;
    for (const key of nextVisibleKeys) {
      this.profile.coverageKeysExamined += 1;
      if (this.shaderSourceForKey(key) === "procedural") { visibleIsCovered = false; break; }
    }
    // A brush may change an already resident layer without changing the
    // camera tile or the visible source-tile set.  Those queued uploads are
    // still real cache work; treating the frame as idle here left edits
    // invisible until some later camera move happened to wake the scheduler.
    const hasQueuedWork = this.pendingUploads.size > 0
      || this.dirtyFullUploads.size > 0
      || this.pendingFallbackUploads.size > 0
      || this.dirtyFallbackUploads.size > 0
      || this.fallbackMapDirty || this.coarseDirty;
    if (centerX === this.centerTileX && centerZ === this.centerTileZ && nextVisibleKeys === this.visibleKeys && visibleIsCovered && !hasQueuedWork) {
      const elapsed = performance.now() - started;
      this.profile.updateMs += elapsed;
      this.profile.updatePeakMs = Math.max(this.profile.updatePeakMs, elapsed);
      this.profile.idleFrames += 1;
      return;
    }
    this.profile.updatePasses += 1;
    this.centerTileX = centerX;
    this.centerTileZ = centerZ;
    // Idle membership ignores ordering, as before. A real scheduling pass
    // must still observe the caller's current order, even when its Set was
    // reordered in place while work was queued.
    this.visibleKeys = nextVisibleKeys === this.visibleKeys ? this.orderedVisibleAuthoredKeys(sourceKeys) : nextVisibleKeys;
    this.fallbackMapDirty = true;

    const nextWindowKeys = new Set();
    for (let z = centerZ - this.radius; z <= centerZ + this.radius; z += 1) {
      for (let x = centerX - this.radius; x <= centerX + this.radius; x += 1) {
        if (this.provider.isTileAuthored(x, z)) nextWindowKeys.add(this.provider.tileKey(x, z));
      }
    }

    this.windowKeys = nextWindowKeys;
    // Required authored tiles are scheduled before camera-local prefetch.
    for (const key of this.visibleKeys) {
      if (this.keyToLayer.has(key)) {
        this.touchLayer(this.keyToLayer.get(key));
        continue;
      }
      if (this.fallbackKeyToLayer.has(key)) {
        const fallbackLayer = this.fallbackKeyToLayer.get(key);
        this.fallbackLayerLastUsed[fallbackLayer] = ++this.usageTick;
        continue;
      }
      const [x, z] = key.split(",").map(Number);
      if (this.coarsePublishedKeys.has(key) && this.findVisibleLayer() === -1) continue;
      // All visible authored tiles outrank prefetch, but closest visible
      // tiles get the scarce full-resolution layers first.
      const distance = (x - centerX) ** 2 + (z - centerZ) ** 2;
      this.queueTile(key, x, z, -100000 + distance, true);
    }
    for (const key of this.windowKeys) {
      if (this.keyToLayer.has(key) || this.visibleKeys.has(key)) continue;
      const [x, z] = key.split(",").map(Number);
      const distance = (x - centerX) ** 2 + (z - centerZ) ** 2;
      // Tile generation/deserialization is deliberately deferred too. The
      // scheduler is ineffective if crossing one boundary synchronously
      // creates every entering 2 m tile before those jobs are queued.
      this.queueTile(key, x, z, distance, false);
    }
    this.processDirtyFullUploads();
    this.processPendingUploads();
    this.processFallbackUploads();
    // Fallback assignment can change usable coverage after the full-layer
    // pass has produced its profile. Refresh the existing counters so the
    // HUD distinguishes an overflow tile that is actually shader-ready from
    // one still awaiting its first fallback upload.
    this.updateCoarseFallback();
    this.updateVisibleProfile();
    const trace = this.residencyTrace;
    if (trace && !trace.complete) {
      const tile = this.provider.cache.get(trace.key);
      if (tile) {
        const uploaded = Math.max(this.fullUploadRevisions.get(trace.key) ?? -1, this.fallbackUploadRevisions.get(trace.key) ?? -1);
        if (uploaded >= trace.cpuRevision && this.shaderSourceForKey(trace.key) !== "procedural") {
          this.traceResidency("ready-for-shader", trace.key, tile, { uploaded });
          trace.complete = true;
          console.info("[MaxWorld residency] trace complete", trace);
        }
      }
    }
    const elapsed = performance.now() - started;
    this.profile.updateMs += elapsed;
    this.profile.updatePeakMs = Math.max(this.profile.updatePeakMs, elapsed);
    this.profile.remapMs += elapsed;
  }

  visibleAuthoredKeys(sourceKeys) {
    const provider = this.provider;
    if (this.authoredRevision !== provider.tileStateRevision || this.authoredCache !== provider.cache
      || this.authoredPersistedKeys !== provider.persistedTileKeys || this.authoredCacheSize !== provider.cache.size
      || this.authoredPersistedSize !== provider.persistedTileKeys.size) {
      this.authoredKeys.clear();
      for (const key of provider.persistedTileKeys) this.authoredKeys.add(key);
      // A cached procedural tile overrides persisted metadata, exactly like
      // isTileAuthored(). This also handles missing/invalid saved payloads.
      for (const [key, tile] of provider.cache) {
        if (tile.source === "procedural") this.authoredKeys.delete(key);
        else this.authoredKeys.add(key);
      }
      this.authoredRevision = provider.tileStateRevision;
      this.authoredCache = provider.cache;
      this.authoredPersistedKeys = provider.persistedTileKeys;
      this.authoredCacheSize = provider.cache.size;
      this.authoredPersistedSize = provider.persistedTileKeys.size;
      this.profile.authoredIndexRebuilds += 1;
    }
    const sources = sourceKeys instanceof Set ? sourceKeys : new Set(sourceKeys ?? []);
    let visibleCount = 0, changed = false;
    // Inspect the small authored index, not thousands of procedural sources.
    // Membership is checked even for the same Set instance: callers can add
    // and remove keys in place, including same-size changes.
    for (const key of this.authoredKeys) {
      this.profile.authoredKeysExamined += 1;
      if (!sources.has(key)) continue;
      visibleCount += 1;
      if (!this.visibleKeys.has(key)) changed = true;
    }
    if (!changed && visibleCount === this.visibleKeys.size) return this.visibleKeys;
    return this.orderedVisibleAuthoredKeys(sources);
  }

  orderedVisibleAuthoredKeys(sources) {
    const visible = new Set();
    // Preserve original source iteration order whenever membership changes;
    // upload priorities and layer ownership must remain deterministic.
    for (const key of sources) {
      this.profile.sourceKeysExamined += 1;
      if (this.authoredKeys.has(key)) visible.add(key);
    }
    return visible;
  }

  setNewTileUploadsEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.newTileUploadsEnabled) return;
    this.newTileUploadsEnabled = next;
    // Re-enabling intentionally maps the current 3x3 window on the next
    // frame; no terrain-data resolution or render LOD setting changes.
    if (next) {
      this.centerTileX = null;
      this.centerTileZ = null;
    } else this.pendingUploads.clear();
    }

  sameKeys(a, b) {
    if (a.size !== b.size) return false;
    for (const key of a) if (!b.has(key)) return false;
    return true;
  }

  touchLayer(layer) {
    if (layer !== undefined && layer >= 0) this.layerLastUsed[layer] = ++this.usageTick;
  }

  queueTile(key, x, z, priority = Infinity, visible = false) {
    const existing = this.pendingUploads.get(key);
    if (!existing || priority < existing.priority || visible) this.pendingUploads.set(key, { key, x, z, priority: Math.min(priority, existing?.priority ?? Infinity), visible: visible || existing?.visible });
  }

  queuePersistentTile(key, tile) {
    const pendingKey = `persist:${key}`;
    if (!this.pendingUploads.has(pendingKey)) this.pendingUploads.set(pendingKey, { key: pendingKey, tileKey: key, tile, priority: 1000, persistent: true });
  }

  queueFullLayerUpdate(key, layer, tile) {
    this.dirtyFullUploads.set(key, { key, layer, tile });
  }

  shaderSourceForKey(key) {
    if (this.keyToLayer.has(key)) return "full";
    if (this.fallbackKeyToLayer.has(key) && this.visibleKeys.has(key) && this.fallbackMapExtent.x > 0 && this.fallbackMapExtent.y > 0) return "fallback";
    if (this.coarseEnabled && this.coarsePublishedKeys.has(key)) return "coarse";
    return "procedural";
  }

  sampleTraceHeight(tile, key) {
    if (!tile) return {};
    const changed = tile.lastChangedSample;
    const centerX = changed ? Math.round((changed.x - tile.x) / tile.sampleSpacing) : Math.floor(tile.segments * .5);
    const centerZ = changed ? Math.round((changed.z - tile.z) / tile.sampleSpacing) : Math.floor(tile.segments * .5);
    const fullIndex = changed?.index ?? centerZ * this.samples + centerX;
    const worldX = changed?.x ?? tile.x + centerX * tile.sampleSpacing;
    const worldZ = changed?.z ?? tile.z + centerZ * tile.sampleSpacing;
    const expectedDelta = tile.heights[fullIndex] - proceduralHeight(worldX, worldZ);
    const fullLayer = this.keyToLayer.get(key);
    const fallbackLayer = this.fallbackKeyToLayer.get(key);
    const fallbackX = Math.round((worldX - tile.x) / tile.size * (this.fallbackSamples - 1));
    const fallbackZ = Math.round((worldZ - tile.z) / tile.size * (this.fallbackSamples - 1));
    const fallbackIndex = fallbackZ * this.fallbackSamples + fallbackX;
    return {
      changedSample: [worldX, worldZ],
      cpuHeight: tile.heights[fullIndex],
      expectedDelta,
      preparedFullDelta: fullLayer === undefined ? null : this.data[fullLayer * this.samplesPerTile + fullIndex],
      preparedFallbackDelta: fallbackLayer === undefined ? null : this.fallbackData[fallbackLayer * this.fallbackSamplesPerTile + fallbackIndex],
    };
  }

  traceResidency(stage, key, tile = null, extra = {}) {
    if (!this.residencyTraceEnabled) return;
    const trace = this.residencyTrace;
    if (!trace || trace.key !== key) return;
    const snapshot = {
      stage,
      key,
      cpuRevision: tile?.revision ?? trace.cpuRevision,
      fullLayer: this.keyToLayer.get(key) ?? null,
      fallbackLayer: this.fallbackKeyToLayer.get(key) ?? null,
      uploadedFullRevision: this.fullUploadRevisions.get(key) ?? null,
      uploadedFallbackRevision: this.fallbackUploadRevisions.get(key) ?? null,
      visible: this.visibleKeys.has(key),
      pendingFull: this.pendingUploads.has(key),
      dirtyFull: this.dirtyFullUploads.has(key),
      pendingFallback: this.pendingFallbackUploads.has(key),
      dirtyFallback: this.dirtyFallbackUploads.has(key),
      shaderSource: this.shaderSourceForKey(key),
      fallbackMap: [this.fallbackMapOrigin.x, this.fallbackMapOrigin.y, this.fallbackMapExtent.x, this.fallbackMapExtent.y],
      ...this.sampleTraceHeight(tile, key),
      ...extra,
    };
    trace.events.push(snapshot);
    console.info("[MaxWorld residency]", snapshot);
  }

  beginOverflowTrace(key, tile) {
    if (!this.residencyTraceEnabled) return;
    if (this.residencyTrace?.key === key && !this.residencyTrace.complete) return;
    this.residencyTrace = { key, cpuRevision: tile.revision, complete: false, events: [] };
    this.traceResidency("cpu-change", key, tile, {
      visibleRequired: this.visibleKeys.size,
      fullCapacity: this.layerCount,
      note: "Trace follows the active brush tile through cache mapping and upload.",
    });
  }

  processDirtyFullUploads() {
    // Refresh all active source owners (including warped Rockify candidates)
    // before this frame renders. Sharing streaming's one-layer budget made a
    // held corner brush update each tile at 15 Hz on a 60 Hz display.
    // Background edits keep the original budget and cannot delay the brush.
    for (const active of [true, false]) {
      let processed = 0;
      for (const job of this.dirtyFullUploads.values()) {
        if (Boolean(this.isActiveEditKey(job.key)) !== active) continue;
        if (!active && processed >= this.maxUploadsPerFrame) break;
        this.dirtyFullUploads.delete(job.key);
        // A layer may have been reassigned while this tile was waiting.
        if (this.keyToLayer.get(job.key) !== job.layer) continue;
        this.uploadTile(job.layer, job.tile);
        this.traceResidency("full-upload", job.key, job.tile);
        processed += 1;
      }
    }
  }

  processPendingUploads() {
    let processed = 0;
    const jobs = [...this.pendingUploads.values()].sort((a, b) => a.priority - b.priority);
    for (const job of jobs) {
      if (processed >= this.maxUploadsPerFrame) break;
      this.pendingUploads.delete(job.key);
      if (job.persistent) {
        const currentLayer = this.keyToLayer.get(job.tileKey ?? job.key.replace("persist:", ""));
        const tileKey = job.tileKey ?? job.key.replace("persist:", "");
        if (currentLayer === undefined || currentLayer >= this.windowSlotCount) continue;
        const layer = this.findPersistentLayer();
        if (layer === -1) {
          this.pendingUploads.set(job.key, job);
          break;
        }
        this.assignTile(tileKey, job.tile, layer);
        // The key now points at its persistent copy; free its former camera
        // slot so an entering tile can use it on the following frame.
        if (this.layerToKey[currentLayer] === tileKey) {
          this.layerToKey[currentLayer] = null;
          this.tileCoordinates[currentLayer * 2] = INVALID_TILE_COORDINATE;
          this.tileCoordinates[currentLayer * 2 + 1] = INVALID_TILE_COORDINATE;
        }
        processed += 1;
        continue;
      }
      if (this.keyToLayer.has(job.key)) {
        this.touchLayer(this.keyToLayer.get(job.key));
        continue;
      }
      if (!job.visible && !this.windowKeys.has(job.key)) continue;
      const layer = job.visible ? this.findVisibleLayer() : this.findPrefetchLayer();
      if (layer === -1) {
        // A tile-local fallback already provides valid authored data. Once
        // every full layer is genuinely occupied by visible terrain, drop
        // this *full-resolution* request instead of retrying it forever.
        // Crucially, do this here rather than when fallback coverage first
        // appears: doing it earlier meant the first fallback upload won the
        // race and prevented the other 24 available full layers from ever
        // being filled.
        if (job.visible && (this.fallbackKeyToLayer.has(job.key) || this.coarsePublishedKeys.has(job.key))) continue;
        this.pendingUploads.set(job.key, job);
        // Later jobs cannot find a layer either; retrying every queued tile
        // in this frame does no useful work and used to turn saturation into
        // an unbounded brush-time loop.
        break;
      }
      const tile = this.provider.getTile(job.x, job.z, "gpu-full-upload");
      // A missing layer is correct for procedural terrain: its shader base is
      // already authoritative. GPU residency is reserved for authored data.
      if (tile.source === "procedural") continue;
      this.assignTile(job.key, tile, layer);
      processed += 1;
    }
    this.updateVisibleProfile();
    this.profile.pendingUploads = this.pendingUploads.size;
  }

  onTileChanged(tile) {
    this.captureCoarseTile(tile);
    const key = this.provider.tileKey(tile.x / tile.size, tile.z / tile.size);
    if (this.residencyTraceEnabled && key === this.provider.activeEditTileKey && this.visibleKeys.size >= this.layerCount) this.beginOverflowTrace(key, tile);
    let layer = this.keyToLayer.get(key);
    let needsFullResolutionUpload = false;
    if (layer === undefined) {
      if (!this.newTileUploadsEnabled) return;
      layer = this.visibleKeys.has(key) ? this.findVisibleLayer() : this.findPersistentLayer();
      // All full layers can be visible while a brush is working on an
      // overflow tile. Promote the explicitly active source tile by moving
      // one unrelated visible layer to its 8 m fallback or 16 m overview.
      // This is one bounded exchange, not extra GPU capacity.
      if (layer === -1 && this.isActiveEditKey(key) && this.promoteActiveTile(key, tile)) return;
      if (layer === -1) {
        // Full-resolution residency is intentionally bounded.  Never make
        // authoring depend on finding one of those scarce layers: the CPU
        // tile is authoritative, and an edited overflow tile must receive a
        // tile-local fallback immediately rather than briefly rendering its
        // procedural baseline (or waiting behind the streaming queue).
        needsFullResolutionUpload = true;
      } else {
        this.assignTile(key, tile, layer);
      }
    } else {
      // Coalesce a stamp's samples into one upload per affected layer. Active
      // brush layers are flushed together immediately before rendering.
      this.queueFullLayerUpdate(key, layer, tile);
    }

    let fallbackLayer = this.fallbackKeyToLayer.get(key);
    if (fallbackLayer !== undefined) {
      // Keep only the newest authoritative tile state for this layer. The
      // bounded fallback worker uploads it once on a following frame.
      this.dirtyFallbackUploads.set(key, { key, layer: fallbackLayer, tile });
      this.fallbackLayerLastUsed[fallbackLayer] = ++this.usageTick;
    } else if (needsFullResolutionUpload) {
      // A newly authored tile needs one valid layer before its source-space
      // mapping can become visible. This is deliberately a single 33x33
      // upload only on first residency; subsequent brush frames are
      // coalesced by dirtyFallbackUploads below.
      if (this.assignFallbackTile(key, tile)) this.updateFallbackTileMap();
      else this.queueFallbackTile(key, tile.x / tile.size, tile.z / tile.size);
    }

    if (needsFullResolutionUpload) {
      this.queueTile(key, tile.x / tile.size, tile.z / tile.size, -100000, this.visibleKeys.has(key));
    }
    this.traceResidency("cache-change", key, tile, { needsFullResolutionUpload });
  }

  assignTile(key, tile, requestedLayer = null) {
    const layer = requestedLayer ?? this.findFreeLayer();
    if (layer === -1) return false;
    // Promotion from the tile-local fallback must leave exactly one mapping
    // for this source tile. Keeping both wastes a bounded fallback layer and
    // can make the fallback map describe an obsolete representation.
    this.releaseFallbackTile(key);
    this.pendingFallbackUploads.delete(key);
    const previousKey = this.layerToKey[layer];
    if (previousKey) this.keyToLayer.delete(previousKey);
    this.keyToLayer.set(key, layer);
    this.layerToKey[layer] = key;
    this.touchLayer(layer);
    this.profile.remappedTiles += 1;
    this.uploadTile(layer, tile);
    this.traceResidency("full-assign", key, tile);
    return true;
  }

  findWindowLayer() {
    for (let layer = 0; layer < this.windowSlotCount; layer += 1) {
      if (this.layerToKey[layer] === null) return layer;
    }
    // Do not release a leaving tile early. It remains valid until this exact
    // replacement upload executes, avoiding a visible cache hole or a burst
    // of invalidations when the camera crosses a tile boundary.
    for (let layer = 0; layer < this.windowSlotCount; layer += 1) {
      const key = this.layerToKey[layer];
      const tile = key ? this.provider.cache.get(key) : null;
      if (key && !this.windowKeys.has(key) && (!tile || tile.source === "procedural")) return layer;
    }
    return -1;
  }

  releaseLayer(key) {
    const layer = this.keyToLayer.get(key);
    if (layer === undefined) return;
    this.keyToLayer.delete(key);
    this.layerToKey[layer] = null;
    this.tileCoordinates[layer * 2] = INVALID_TILE_COORDINATE;
    this.tileCoordinates[layer * 2 + 1] = INVALID_TILE_COORDINATE;
  }

  releaseWindowTile(key) {
    const layer = this.keyToLayer.get(key);
    if (layer === undefined || layer >= this.windowSlotCount) return;
    const [x, z] = key.split(",").map(Number);
    const tile = this.provider.getTile(x, z, "gpu-window-release");
    if (tile.source !== "procedural") {
      const persistentLayer = this.findPersistentLayer();
      if (persistentLayer !== -1) {
        this.keyToLayer.delete(key);
        this.layerToKey[layer] = null;
        this.tileCoordinates[layer * 2] = INVALID_TILE_COORDINATE;
        this.tileCoordinates[layer * 2 + 1] = INVALID_TILE_COORDINATE;
        this.assignTile(key, tile, persistentLayer);
        return;
      }
    }
    this.releaseLayer(key);
  }

  findFreeLayer() {
    for (let layer = 0; layer < this.layerCount; layer += 1) {
      if (this.layerToKey[layer] === null) return layer;
    }
    return -1;
  }

  findPersistentLayer() {
    for (let layer = this.windowSlotCount; layer < this.layerCount; layer += 1) {
      if (this.layerToKey[layer] === null) return layer;
    }
    // The persistent pool is full. Only now is it safe to replace a tile that
    // is outside the local camera window.
    for (let layer = this.windowSlotCount; layer < this.layerCount; layer += 1) {
      const key = this.layerToKey[layer];
      if (!this.windowKeys.has(key) && !this.visibleKeys.has(key)) return layer;
    }
    return -1;
  }

  findVisibleLayer() {
    const free = this.findFreeLayer();
    if (free !== -1) return free;
    let candidate = -1;
    let oldest = Infinity;
    for (let layer = 0; layer < this.layerCount; layer += 1) {
      const key = this.layerToKey[layer];
      if (!key || this.visibleKeys.has(key)) continue;
      if (this.layerLastUsed[layer] < oldest) {
        oldest = this.layerLastUsed[layer];
        candidate = layer;
      }
    }
    return candidate;
  }

  releaseFallbackTile(key) {
    const layer = this.fallbackKeyToLayer.get(key);
    if (layer === undefined) return;
    this.fallbackKeyToLayer.delete(key);
    this.fallbackLayerToKey[layer] = null;
    this.dirtyFallbackUploads.delete(key);
    this.fallbackMapDirty = true;
  }

  isActiveEditKey(key) {
    return key === this.provider.activeEditTileKey || this.provider.activeEditTileKeys?.has(key);
  }

  promoteActiveTile(key, tile) {
    let candidate = -1;
    let oldest = Infinity;
    for (let layer = 0; layer < this.layerCount; layer += 1) {
      const previousKey = this.layerToKey[layer];
      if (!previousKey || this.isActiveEditKey(previousKey) || !this.visibleKeys.has(previousKey)) continue;
      if (this.layerLastUsed[layer] < oldest) {
        oldest = this.layerLastUsed[layer];
        candidate = layer;
      }
    }
    if (candidate === -1) return false;

    const displacedKey = this.layerToKey[candidate];
    const [x, z] = displacedKey.split(",").map(Number);
    // The active tile may itself own the fallback slot needed by the victim.
    // Otherwise its victim can use the overview already captured on full
    // upload. Publish that coverage BEFORE replacing the full layer.
    this.releaseFallbackTile(key);
    if (this.findFallbackLayer() !== -1) {
      const displacedTile = this.provider.getTile(x, z, "gpu-active-promote");
      this.assignFallbackTile(displacedKey, displacedTile);
    } else {
      this.updateCoarseFallback(false);
      if (!this.coarsePublishedKeys.has(displacedKey)) return false;
    }

    this.keyToLayer.delete(displacedKey);
    this.layerToKey[candidate] = null;
    this.releaseFallbackTile(key);
    this.assignTile(key, tile, candidate);
    this.pendingUploads.delete(key);
    this.updateFallbackTileMap();
    return true;
  }

  findPrefetchLayer() {
    // Speculative data may use only truly spare capacity.
    return this.findFreeLayer();
  }

  updateVisibleProfile() {
    let resident = 0;
    for (const key of this.visibleKeys) if (this.keyToLayer.has(key)) resident += 1;
    this.profile.visibleRequired = this.visibleKeys.size;
    this.profile.visibleResident = resident;
    this.profile.visibleOverflow = this.visibleKeys.size - resident;
    this.updateFallbackTileMap();
    const fallbackUsable = this.fallbackMapExtent.x > 0 && this.fallbackMapExtent.y > 0;
    let fallback = 0;
    if (fallbackUsable) for (const key of this.visibleKeys) if (!this.keyToLayer.has(key) && this.fallbackKeyToLayer.has(key)) fallback += 1;
    this.profile.visibleFallback = fallback;
    const coarse = [...this.visibleKeys].filter(key => !this.keyToLayer.has(key) && !(fallbackUsable && this.fallbackKeyToLayer.has(key)) && this.coarsePublishedKeys.has(key)).length;
    this.profile.visibleCoarse = coarse;
    this.profile.visibleUnavailable = this.visibleKeys.size - resident - fallback - coarse;
  }

  queueFallbackTile(key, x, z) {
    if (!this.fallbackKeyToLayer.has(key)) this.pendingFallbackUploads.set(key, { key, x, z });
  }

  findFallbackLayer() {
    for (let layer = 0; layer < this.fallbackLayerCount; layer += 1) if (this.fallbackLayerToKey[layer] === null) return layer;
    let candidate = -1, oldest = Infinity;
    for (let layer = 0; layer < this.fallbackLayerCount; layer += 1) {
      const key = this.fallbackLayerToKey[layer];
      if (this.visibleKeys.has(key)) continue;
      if (this.fallbackLayerLastUsed[layer] < oldest) { oldest = this.fallbackLayerLastUsed[layer]; candidate = layer; }
    }
    return candidate;
  }

  assignFallbackTile(key, tile) {
    const layer = this.findFallbackLayer();
    if (layer === -1) return false;
    const previousKey = this.fallbackLayerToKey[layer];
    if (previousKey) {
      this.fallbackKeyToLayer.delete(previousKey);
      this.dirtyFallbackUploads.delete(previousKey);
    }
    this.fallbackKeyToLayer.set(key, layer);
    this.fallbackLayerToKey[layer] = key;
    this.fallbackLayerLastUsed[layer] = ++this.usageTick;
    this.uploadFallbackTile(layer, tile);
    this.traceResidency("fallback-assign", key, tile);
    this.fallbackMapDirty = true;
    return true;
  }

  processFallbackUploads() {
    const hasCapacity = this.findFallbackLayer() !== -1;
    for (const key of this.visibleKeys) {
      if (!this.keyToLayer.has(key) && !this.fallbackKeyToLayer.has(key) && (hasCapacity || !this.coarsePublishedKeys.has(key))) {
        const [x, z] = key.split(",").map(Number);
        this.queueFallbackTile(key, x, z);
      }
    }
    // New coverage comes first. Otherwise an actively sculpted resident tile
    // can continuously refresh itself and starve every newly edited overflow
    // tile behind it.
    for (const key of this.pendingFallbackUploads.keys()) {
      if (!this.visibleKeys.has(key) || this.keyToLayer.has(key) || this.fallbackKeyToLayer.has(key) || (!hasCapacity && this.coarsePublishedKeys.has(key))) this.pendingFallbackUploads.delete(key);
    }
    const job = hasCapacity ? this.pendingFallbackUploads.values().next().value : null;
    if (job) {
      this.pendingFallbackUploads.delete(job.key);
      const tile = this.provider.getTile(job.x, job.z, "gpu-fallback-upload");
      if (!this.assignFallbackTile(job.key, tile)) this.pendingFallbackUploads.set(job.key, job);
    } else {
      // One resident update per frame coalesces all brush samples since the
      // last upload without delaying new fallback coverage.
      const dirty = this.dirtyFallbackUploads.values().next().value;
      if (dirty) {
        this.dirtyFallbackUploads.delete(dirty.key);
        if (this.fallbackKeyToLayer.get(dirty.key) === dirty.layer) {
          this.uploadFallbackTile(dirty.layer, dirty.tile);
          this.traceResidency("fallback-upload", dirty.key, dirty.tile);
          this.fallbackLayerLastUsed[dirty.layer] = ++this.usageTick;
        }
      }
    }
    this.updateFallbackTileMap();
  }

  updateFallbackTileMap() {
    if (!this.fallbackMapDirty) return;
    const keys = [...this.visibleKeys].filter(key => this.fallbackKeyToLayer.has(key));
    this.fallbackTileMapData.fill(0);
    if (keys.length === 0) { this.fallbackMapExtent.set(1, 1); this.fallbackTileMap.needsUpdate = true; this.fallbackMapDirty = false; return; }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const key of keys) { const [x, z] = key.split(",").map(Number); minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
    const width = maxX - minX + 1, height = maxZ - minZ + 1;
    if (width > this.fallbackMapSize || height > this.fallbackMapSize) { this.fallbackMapExtent.set(0, 0); this.fallbackTileMap.needsUpdate = true; this.fallbackMapDirty = false; return; }
    for (const key of keys) {
      const [x, z] = key.split(",").map(Number);
      this.fallbackTileMapData[(z - minZ) * this.fallbackMapSize + (x - minX)] = this.fallbackKeyToLayer.get(key) + 1;
    }
    this.fallbackMapOrigin.set(minX, minZ);
    this.fallbackMapExtent.set(width, height);
    this.fallbackTileMap.needsUpdate = true;
    this.fallbackMapDirty = false;
  }

  uploadFallbackTile(layer, tile) {
    this.captureCoarseTile(tile);
    const heightOffset = layer * this.fallbackSamplesPerTile;
    const warpOffset = heightOffset * 2;
    for (let z = 0; z < this.fallbackSamples; z += 1) for (let x = 0; x < this.fallbackSamples; x += 1) {
      const index = z * this.fallbackSamples + x;
      // A fallback layer represents exactly one source tile. Sampling it via
      // the generic world sampler crosses to a neighbour at the last row or
      // column. When the bounded CPU cache is full of dirty authored tiles,
      // that untouched neighbour is generated and immediately evicted for
      // every edge texel. Read the owner tile directly instead: the fixed
      // 33x33 grid lands exactly on every fourth 2m source sample.
      const sampleX = Math.round(x * tile.segments / (this.fallbackSamples - 1));
      const sampleZ = Math.round(z * tile.segments / (this.fallbackSamples - 1));
      const sourceIndex = sampleZ * (tile.segments + 1) + sampleX;
      const worldX = tile.x + sampleX * tile.sampleSpacing;
      const worldZ = tile.z + sampleZ * tile.sampleSpacing;
      this.fallbackData[heightOffset + index] = tile.heights[sourceIndex] - proceduralHeight(worldX, worldZ);
      const warpSource = sourceIndex * 2;
      this.fallbackWarpData[warpOffset + index * 2] = tile.warp ? tile.warp[warpSource] : 0;
      this.fallbackWarpData[warpOffset + index * 2 + 1] = tile.warp ? tile.warp[warpSource + 1] : 0;
      this.fallbackExposureData[heightOffset + index] = tile.rockExposure?.[sourceIndex] ?? 0;
    }
    this.fallbackTexture.addLayerUpdate(layer); this.fallbackTexture.needsUpdate = true;
    this.fallbackWarpTexture.addLayerUpdate(layer); this.fallbackWarpTexture.needsUpdate = true;
    this.fallbackExposureTexture.addLayerUpdate(layer); this.fallbackExposureTexture.needsUpdate = true;
    const key = this.provider.tileKey(tile.x / tile.size, tile.z / tile.size);
    this.fallbackUploadRevisions.set(key, tile.revision);
    this.profile.fallbackUploadedLayers += 1;
  }

  captureCoarseTile(tile) {
    if (tile.source === "procedural" || this.coarseCapturedRevisions.get(tile) === tile.revision) return;
    const x = Math.round(tile.x / tile.size), z = Math.round(tile.z / tile.size);
    const key = this.provider.tileKey(x, z);
    this.captureCullingBounds(key, tile);
    let overview = this.coarseTiles.get(key);
    if (!overview) {
      overview = { x, z, values: new Float32Array(this.coarseSamples ** 2 * 4) };
      this.coarseTiles.set(key, overview);
    }
    // Read the owner directly, including its duplicated edge samples. No
    // world sampling, adjacent tile loads, or full-resolution tile retention.
    for (let z = 0; z < this.coarseSamples; z += 1) for (let x = 0; x < this.coarseSamples; x += 1) {
      const sx = Math.round(x * tile.segments / (this.coarseSamples - 1));
      const sz = Math.round(z * tile.segments / (this.coarseSamples - 1));
      const source = sz * (tile.segments + 1) + sx;
      const target = (z * this.coarseSamples + x) * 4;
      overview.values[target] = tile.heights[source] - proceduralHeight(tile.x + sx * tile.sampleSpacing, tile.z + sz * tile.sampleSpacing);
      overview.values[target + 1] = tile.warp?.[source * 2] ?? 0;
      overview.values[target + 2] = tile.warp?.[source * 2 + 1] ?? 0;
      overview.values[target + 3] = tile.rockExposure?.[source] ?? 0;
    }
    this.coarseCapturedRevisions.set(tile, tile.revision);
    this.coarseDirtyTiles.add(key);
    this.coarseDirty = true;
  }

  captureCullingBounds(key, tile) {
    let bounds = this.cullingBounds.get(key);
    if (!bounds) {
      bounds = { x: tile.x, z: tile.z, size: tile.size,
        minHeight: 0, maxHeight: 0, minWarpX: 0, maxWarpX: 0, minWarpZ: 0, maxWarpZ: 0 };
      this.cullingBounds.set(key, bounds);
    }
    // All GPU representations sample this snapshot (or a subset) with
    // bilinear interpolation. Full-tile extrema therefore enclose all of
    // them, including tiny warps omitted by feature-activity summaries.
    let { minHeight, maxHeight, minWarpX, maxWarpX, minWarpZ, maxWarpZ } = bounds;
    for (let i = 0; i < tile.heights.length; i++) {
      const height = tile.heights[i];
      const warpX = tile.warp?.[i * 2] ?? 0;
      const warpZ = tile.warp?.[i * 2 + 1] ?? 0;
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      minWarpX = Math.min(minWarpX, warpX);
      maxWarpX = Math.max(maxWarpX, warpX);
      minWarpZ = Math.min(minWarpZ, warpZ);
      maxWarpZ = Math.max(maxWarpZ, warpZ);
    }
    Object.assign(bounds, { minHeight, maxHeight, minWarpX, maxWarpX, minWarpZ, maxWarpZ });
  }

  expandPatchCullingBox(node, box) {
    let minWarpX = 0, maxWarpX = 0, minWarpZ = 0, maxWarpZ = 0;
    for (const bounds of this.cullingBounds.values()) {
      // Include source borders: a patch's final row/column can sample the
      // adjacent owner. A displaced footprint never moves unrelated sources.
      if (bounds.x + bounds.size < node.x || bounds.x > node.x + node.size
        || bounds.z + bounds.size < node.z || bounds.z > node.z + node.size) continue;
      minWarpX = Math.min(minWarpX, bounds.minWarpX);
      maxWarpX = Math.max(maxWarpX, bounds.maxWarpX);
      minWarpZ = Math.min(minWarpZ, bounds.minWarpZ);
      maxWarpZ = Math.max(maxWarpZ, bounds.maxWarpZ);
      box.min.y = Math.min(box.min.y, bounds.minHeight);
      box.max.y = Math.max(box.max.y, bounds.maxHeight);
    }
    box.min.x += minWarpX; box.max.x += maxWarpX;
    box.min.z += minWarpZ; box.max.z += maxWarpZ;
    return box;
  }

  updateCoarseFallback(allowLoad = true) {
    const started = performance.now();
    if (allowLoad) {
      // Full/fallback uploads already capture their owners. Read at most one
      // additional known authored tile per frame to fill remaining coverage.
      // Its small overview then survives CPU eviction and camera revisits.
      for (const key of this.visibleKeys) {
        if (this.coarseTiles.has(key)) continue;
        const [x, z] = key.split(",").map(Number);
        if (this.provider.isTileAuthored(x, z)) this.captureCoarseTile(this.provider.getTile(x, z, "gpu-overview-upload"));
        break;
      }
    }
    if (!this.coarseDirty) return;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const tile of this.coarseTiles.values()) {
      minX = Math.min(minX, tile.x); minZ = Math.min(minZ, tile.z);
      maxX = Math.max(maxX, tile.x); maxZ = Math.max(maxZ, tile.z);
    }
    const width = (maxX - minX + 1) * this.coarseSamples;
    const height = (maxZ - minZ + 1) * this.coarseSamples;
    const tileSize = this.provider.tileSize;
    if (width !== this.coarseWidth || height !== this.coarseHeight || this.coarseOrigin.x !== minX * tileSize || this.coarseOrigin.y !== minZ * tileSize) {
      // Three.js textures must be recreated when their dimensions change.
      // Extents grow only as new geographic coverage is discovered.
      this.coarseWidth = width; this.coarseHeight = height;
      this.coarseData = new Float32Array(width * height * 2);
      this.coarseWarpData = new Float32Array(width * height * 2);
      this.coarseExposureData = new Float32Array(width * height * 2);
      this.coarseTexture.dispose(); this.coarseWarpTexture.dispose(); this.coarseExposureTexture.dispose();
      this.coarseTexture = createOverviewTexture(this.coarseData, width, height, THREE.RGFormat);
      this.coarseWarpTexture = createOverviewTexture(this.coarseWarpData, width, height, THREE.RGFormat);
      this.coarseExposureTexture = createOverviewTexture(this.coarseExposureData, width, height, THREE.RGFormat);
      for (const key of this.coarseTiles.keys()) this.coarseDirtyTiles.add(key);
    }
    this.coarseOrigin.set(minX * tileSize, minZ * tileSize);
    this.coarseSize.set((maxX - minX + 1) * tileSize, (maxZ - minZ + 1) * tileSize);
    for (const key of this.coarseDirtyTiles) {
      const tile = this.coarseTiles.get(key);
      const left = (tile.x - minX) * this.coarseSamples, top = (tile.z - minZ) * this.coarseSamples;
      for (let z = 0; z < this.coarseSamples; z += 1) for (let x = 0; x < this.coarseSamples; x += 1) {
        const source = (z * this.coarseSamples + x) * 4;
        const target = (top + z) * width + left + x;
        this.coarseData[target * 2] = tile.values[source];
        this.coarseData[target * 2 + 1] = 1;
        this.coarseWarpData[target * 2] = tile.values[source + 1];
        this.coarseWarpData[target * 2 + 1] = tile.values[source + 2];
        this.coarseExposureData[target * 2] = tile.values[source + 3];
        this.coarseExposureData[target * 2 + 1] = Math.abs(tile.values[source + 3]);
      }
      this.coarsePublishedKeys.add(key);
    }
    this.coarseDirtyTiles.clear();
    this.coarseTexture.needsUpdate = true;
    this.coarseWarpTexture.needsUpdate = true;
    this.coarseExposureTexture.needsUpdate = true;
    this.coarseEnabled = true;
    this.coarseDirty = false;
    this.profile.coarseBuildMs += performance.now() - started;
    this.profile.coarseUploads += 1;
  }

  uploadTile(layer, tile) {
    this.captureCoarseTile(tile);
    const started = performance.now();
    const targetOffset = layer * this.samplesPerTile;
    if (tile.source === "procedural" && !tile.heightDeltas && !tile.hasPersistentHeights) {
      this.data.fill(0, targetOffset, targetOffset + this.samplesPerTile);
    } else {
      // `heights` is the authoritative CPU representation. Do not trust an
      // already allocated delta buffer here: worlds edited before the delta
      // migration can still have a sparse in-memory buffer even though their
      // full height field is correct. Rebuilding the compact GPU delta on each
      // tile upload is bounded (129² samples) and keeps old/new/save/reload
      // tiles on the exact same procedural-relative contract.
      for (let z = 0; z < this.samples; z += 1) for (let x = 0; x < this.samples; x += 1) {
        const index = z * this.samples + x;
        const worldX = tile.x + x * tile.sampleSpacing;
        const worldZ = tile.z + z * tile.sampleSpacing;
        this.data[targetOffset + index] = tile.heights[index] - proceduralHeight(worldX, worldZ);
      }
    }
    const warpOffset = layer * this.samplesPerTile * 2;
    if (tile.warp) this.warpData.set(tile.warp, warpOffset);
    else this.warpData.fill(0, warpOffset, warpOffset + this.samplesPerTile * 2);
    if (tile.rockExposure) this.rockExposureData.set(tile.rockExposure, targetOffset);
    else this.rockExposureData.fill(0, targetOffset, targetOffset + this.samplesPerTile);
    this.tileCoordinates[layer * 2] = Math.round(tile.x / tile.size);
    this.tileCoordinates[layer * 2 + 1] = Math.round(tile.z / tile.size);
    this.texture.addLayerUpdate(layer);
    // DataArrayTexture uses its version to enter Three.js's upload path.
    // With layerUpdates populated, this performs a texSubImage3D upload for
    // this layer rather than re-uploading the complete array texture.
    this.texture.needsUpdate = true;
    this.warpTexture.addLayerUpdate(layer);
    this.warpTexture.needsUpdate = true;
    this.rockExposureTexture.addLayerUpdate(layer);
    this.rockExposureTexture.needsUpdate = true;
    const key = this.provider.tileKey(tile.x / tile.size, tile.z / tile.size);
    this.fullUploadRevisions.set(key, tile.revision);
    this.uploadedLayers += 1;
    this.profile.uploadedLayers += 1;
    const elapsed = performance.now() - started;
    this.profile.uploadPreparationMs += elapsed;
    this.profile.uploadPreparationPeakMs = Math.max(this.profile.uploadPreparationPeakMs, elapsed);
  }

  consumeProfile() {
    const profile = this.profile;
    const resident = [...this.visibleKeys].filter(key => this.keyToLayer.has(key)).length;
    const fallbackUsable = this.fallbackMapExtent.x > 0 && this.fallbackMapExtent.y > 0;
    const fallback = fallbackUsable ? [...this.visibleKeys].filter(key => !this.keyToLayer.has(key) && this.fallbackKeyToLayer.has(key)).length : 0;
    const coarse = [...this.visibleKeys].filter(key => !this.keyToLayer.has(key) && !(fallbackUsable && this.fallbackKeyToLayer.has(key)) && this.coarsePublishedKeys.has(key)).length;
    this.profile = { updateMs: 0, updatePeakMs: 0, remapMs: 0, uploadPreparationMs: 0, uploadPreparationPeakMs: 0, remappedTiles: 0, uploadedLayers: 0, pendingUploads: this.pendingUploads.size, visibleRequired: this.visibleKeys.size, visibleResident: resident, visibleFallback: fallback, visibleCoarse: coarse, visibleUnavailable: this.visibleKeys.size - resident - fallback - coarse, visibleOverflow: this.visibleKeys.size - resident, coarseBuildMs: 0, coarseUploads: 0 };
    Object.assign(this.profile, { sourceKeysExamined: 0, authoredKeysExamined: 0, coverageKeysExamined: 0, authoredIndexRebuilds: 0, updatePasses: 0, idleFrames: 0, fallbackUploadedLayers: 0 });
    return profile;
  }

  dispose() {
    this.unsubscribe?.();
    this.cullingBounds.clear();
    this.authoredKeys.clear();
    this.authoredCache = null;
    this.authoredPersistedKeys = null;
    this.texture.dispose();
    this.warpTexture.dispose();
    this.rockExposureTexture.dispose();
    this.coarseTexture.dispose();
    this.coarseWarpTexture.dispose();
    this.coarseExposureTexture.dispose();
    this.fallbackTexture.dispose();
    this.fallbackWarpTexture.dispose();
    this.fallbackExposureTexture.dispose();
    this.fallbackTileMap.dispose();
  }
}
