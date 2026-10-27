import * as THREE from "three";
import { packMaterialWeights } from "./TerrainMaterialData.js";
import { TERRAIN_TILE_SIZE, TERRAIN_TILE_SEGMENTS } from "./TerrainDataProvider.js";

const SAMPLES = TERRAIN_TILE_SEGMENTS + 1;
const OVERVIEW_SAMPLES = 17;

function configureMask(texture, filter = THREE.LinearFilter) {
  texture.minFilter = texture.magFilter = filter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function imagePixels(image, size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  // TextureLoader's 2D textures used flipY=true. Array uploads do not flip,
  // so preserve that orientation while resampling images to a common size.
  context.translate(0, size);
  context.scale(1, -1);
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

// Independent paint residency. No height-cache mappings, uploads or terrain
// geometry revisions are read or changed here.
export class TerrainMaterialGpuCache {
  constructor(data, { layerCount = 64, overviewCapacity = 1024, lookupSize = 64, maxUploadsPerFrame = 2, imageSize = 512, textureLoader = new THREE.TextureLoader(), prepareImage = imagePixels } = {}) {
    for (const value of [layerCount, overviewCapacity, lookupSize, maxUploadsPerFrame, imageSize]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid material GPU cache size or upload budget.");
    }
    if (overviewCapacity < layerCount) throw new Error("Material overview capacity must cover every detail layer.");
    this.data = data;
    this.layerCount = layerCount;
    this.overviewCapacity = overviewCapacity;
    this.lookupSize = lookupSize;
    this.maxUploadsPerFrame = maxUploadsPerFrame;
    this.textureLoader = textureLoader;
    this.imageSize = imageSize;
    this.prepareImage = prepareImage;
    this.disposed = false;
    const maskGroupLength = SAMPLES * SAMPLES * 4 * layerCount;
    const maskBytes = new Uint8Array(maskGroupLength * 2);
    this.maskData = [maskBytes.subarray(0, maskGroupLength), maskBytes.subarray(maskGroupLength)];
    this.maskTextures = [configureMask(new THREE.DataArrayTexture(maskBytes, SAMPLES, SAMPLES, layerCount * 2))];
    this.overviewColumns = Math.ceil(Math.sqrt(overviewCapacity));
    this.overviewSize = this.overviewColumns * OVERVIEW_SAMPLES;
    this.overviewData = [0, 1].map(() => new Uint8Array(this.overviewSize ** 2 * 4));
    this.overviewTextures = this.overviewData.map(bytes => configureMask(new THREE.DataTexture(bytes, this.overviewSize, this.overviewSize)));
    this.lookupData = new Float32Array(lookupSize ** 2 * 2);
    this.lookupTexture = configureMask(new THREE.DataTexture(this.lookupData, lookupSize, lookupSize, THREE.RGFormat, THREE.FloatType), THREE.NearestFilter);
    this.lookupOrigin = new THREE.Vector2();
    this.detailLayers = new Map();
    this.overviewSlots = new Map();
    this.layerKeys = new Array(layerCount).fill(null);
    this.slotKeys = new Array(overviewCapacity).fill(null);
    this.knownKeys = new Set([...data.records.keys(), ...data.cache.keys()]);
    this.dirtyKeys = new Set(data.cache.keys());
    this.lookupDirty = true;
    this.textureEntries = new Map();
    this.loadErrors = new Map();
    // One sampler for all eight images, plus one for both mask groups. With
    // the unchanged height samplers and cutout, the whole program uses 16.
    this.imageData = new Uint8Array(imageSize * imageSize * 4 * 8);
    this.imageTexture = new THREE.DataArrayTexture(this.imageData, imageSize, imageSize, 8);
    this.imageTexture.colorSpace = THREE.SRGBColorSpace;
    this.imageTexture.wrapS = this.imageTexture.wrapT = THREE.RepeatWrapping;
    this.imageTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.imageTexture.magFilter = THREE.LinearFilter;
    this.imageTexture.generateMipmaps = true;
    this.imageTexture.unpackAlignment = 1;
    this.imageTexture.anisotropy = 4;
    this.imageTexture.needsUpdate = true;
    this.boundImages = new Array(8).fill(null);
    this.uniforms = {
      uMaterialEnabled: { value: false },
      uMaterialMasks: { value: this.maskTextures[0] }, uMaterialDetailLayers: { value: layerCount },
      uMaterialMaps: { value: this.imageTexture },
      uMaterialOverview0: { value: this.overviewTextures[0] }, uMaterialOverview1: { value: this.overviewTextures[1] },
      uMaterialLookup: { value: this.lookupTexture }, uMaterialLookupOrigin: { value: this.lookupOrigin },
      uMaterialLookupSize: { value: lookupSize }, uMaterialOverviewColumns: { value: this.overviewColumns },
      uMaterialReady: { value: new Float32Array(8) }, uMaterialRepeat: { value: new Float32Array(8) },
    };
    this.profile = { detailUploads: 0, overviewUploads: 0, lookupUploads: 0, visibleRequired: 0, visibleUnavailable: 0, updateMs: 0, updatePeakMs: 0 };
    this.unsubscribe = data.onChanged(event => {
      if (event.type === "palette") this.syncPalette();
      else {
        const key = `${event.tile.x / TERRAIN_TILE_SIZE},${event.tile.z / TERRAIN_TILE_SIZE}`;
        this.knownKeys.add(key);
        this.dirtyKeys.add(key);
        this.lookupDirty = true;
      }
    });
    this.syncPalette();
  }

  syncPalette() {
    const paths = new Set(this.data.materials.map(material => material.texture).filter(Boolean));
    for (const [path, entry] of this.textureEntries) {
      if (!paths.has(path)) {
        entry.texture?.dispose();
        this.textureEntries.delete(path);
        this.loadErrors.delete(path);
      }
    }
    for (const path of paths) {
      if (this.textureEntries.has(path)) continue;
      const entry = { texture: null, ready: false };
      this.textureEntries.set(path, entry);
      entry.texture = this.textureLoader.load(path, texture => {
        if (this.disposed || this.textureEntries.get(path) !== entry) { texture.dispose(); return; }
        entry.texture = texture;
        try {
          entry.pixels = this.prepareImage(texture.image, this.imageSize);
          if (entry.pixels.length !== this.imageSize ** 2 * 4) throw new Error("Invalid terrain material image buffer.");
          entry.ready = true;
        } catch (error) {
          this.loadErrors.set(path, error);
          entry.ready = false;
        }
        this.refreshPaletteUniforms();
      }, undefined, error => {
        if (this.disposed || this.textureEntries.get(path) !== entry) return;
        this.loadErrors.set(path, error);
        entry.ready = false;
        this.refreshPaletteUniforms();
      });
    }
    this.refreshPaletteUniforms();
  }

  refreshPaletteUniforms() {
    for (const material of this.data.materials) {
      const entry = this.textureEntries.get(material.texture);
      if (entry?.ready && this.boundImages[material.id] !== entry) {
        this.imageData.set(entry.pixels, material.id * this.imageSize ** 2 * 4);
        this.imageTexture.addLayerUpdate(material.id);
        this.imageTexture.needsUpdate = true;
      }
      this.boundImages[material.id] = entry?.ready ? entry : null;
      this.uniforms.uMaterialReady.value[material.id] = entry?.ready ? 1 : 0;
      this.uniforms.uMaterialRepeat.value[material.id] = material.repeatSize;
    }
  }

  allocate(key, mapping, owners, wanted) {
    if (mapping.has(key)) return mapping.get(key);
    let index = owners.indexOf(null);
    if (index === -1) index = owners.findIndex(previous => !wanted.has(previous));
    if (index === -1) return -1;
    mapping.delete(owners[index]);
    owners[index] = key;
    mapping.set(key, index);
    this.lookupDirty = true;
    return index;
  }

  uploadDetail(layer, bytes) {
    const offset = layer * SAMPLES * SAMPLES * 4;
    for (let sample = 0; sample < SAMPLES * SAMPLES; sample++) {
      const source = sample * 8, target = offset + sample * 4;
      for (let channel = 0; channel < 4; channel++) {
        this.maskData[0][target + channel] = bytes[source + channel];
        this.maskData[1][target + channel] = bytes[source + channel + 4];
      }
    }
    this.maskTextures[0].addLayerUpdate(layer);
    this.maskTextures[0].addLayerUpdate(layer + this.layerCount);
    this.maskTextures[0].needsUpdate = true;
    this.profile.detailUploads++;
  }

  uploadOverview(slot, bytes) {
    const left = (slot % this.overviewColumns) * OVERVIEW_SAMPLES;
    const top = Math.floor(slot / this.overviewColumns) * OVERVIEW_SAMPLES;
    // Box-filter interiors so thin painted paths survive distant sampling.
    // Shared borders filter only along the border, with exact corner values.
    // Thus both owners produce identical overview edges independently.
    const sums = new Float64Array(8);
    for (let z = 0; z < OVERVIEW_SAMPLES; z++) for (let x = 0; x < OVERVIEW_SAMPLES; x++) {
      const sx = x * 8, sz = z * 8;
      const rx = x === 0 || x === 16 ? 0 : 4, rz = z === 0 || z === 16 ? 0 : 4;
      sums.fill(0);
      const count = (rx * 2 + 1) * (rz * 2 + 1);
      for (let dz = -rz; dz <= rz; dz++) for (let dx = -rx; dx <= rx; dx++) {
        const source = ((sz + dz) * SAMPLES + sx + dx) * 8;
        for (let layer = 0; layer < 8; layer++) sums[layer] += bytes[source + layer];
      }
      let total = 0, previous = 0;
      const target = ((top + z) * this.overviewSize + left + x) * 4;
      for (let layer = 0; layer < 8; layer++) {
        total += sums[layer] / count;
        const next = Math.round(Math.min(255, total));
        this.overviewData[layer >> 2][target + layer % 4] = next - previous;
        previous = next;
      }
    }
    for (const texture of this.overviewTextures) {
      for (let row = 0; row < OVERVIEW_SAMPLES; row++) texture.addUpdateRange(((top + row) * this.overviewSize + left) * 4, OVERVIEW_SAMPLES * 4);
      texture.needsUpdate = true;
    }
    this.profile.overviewUploads++;
  }

  update(worldX, worldZ, visibleKeys = null) {
    if (this.disposed) return;
    const started = performance.now();
    const centerX = Math.floor(worldX / TERRAIN_TILE_SIZE), centerZ = Math.floor(worldZ / TERRAIN_TILE_SIZE);
    const originX = centerX - Math.floor(this.lookupSize / 2), originZ = centerZ - Math.floor(this.lookupSize / 2);
    if (this.lookupOrigin.x !== originX || this.lookupOrigin.y !== originZ) {
      this.lookupOrigin.set(originX, originZ);
      this.lookupDirty = true;
    }
    const required = [];
    for (const key of this.knownKeys) {
      if (visibleKeys && !visibleKeys.has(key)) continue;
      const [x, z] = key.split(",").map(Number);
      if (x < originX || z < originZ || x >= originX + this.lookupSize || z >= originZ + this.lookupSize) continue;
      required.push({ key, x, z, distance: (x - centerX) ** 2 + (z - centerZ) ** 2 });
    }
    required.sort((a, b) => Number(this.dirtyKeys.has(b.key)) - Number(this.dirtyKeys.has(a.key)) || a.distance - b.distance || a.x - b.x || a.z - b.z);
    const detailWanted = new Set(required.slice(0, this.layerCount).map(job => job.key));
    const overviewWanted = new Set(required.slice(0, this.overviewCapacity).map(job => job.key));
    let detailBudget = this.maxUploadsPerFrame, overviewBudget = this.maxUploadsPerFrame;
    for (const { key, x, z } of required) {
      const dirty = this.dirtyKeys.has(key);
      const needsDetail = detailWanted.has(key) && (dirty || !this.detailLayers.has(key));
      const needsOverview = overviewWanted.has(key) && (dirty || !this.overviewSlots.has(key));
      const doDetail = needsDetail && (dirty || detailBudget > 0);
      const doOverview = needsOverview && (dirty || doDetail || overviewBudget > 0);
      if (!doDetail && !doOverview) continue;
      const tile = this.data.getTile(x, z);
      const bytes = tile ? packMaterialWeights(tile.weights) : new Uint8Array(SAMPLES * SAMPLES * 8);
      if (doOverview) {
        const slot = this.allocate(key, this.overviewSlots, this.slotKeys, overviewWanted);
        if (slot !== -1) { this.uploadOverview(slot, bytes); overviewBudget--; }
      }
      if (doDetail) {
        const layer = this.allocate(key, this.detailLayers, this.layerKeys, detailWanted);
        if (layer !== -1) { this.uploadDetail(layer, bytes); detailBudget--; }
      } else if (dirty && this.detailLayers.has(key)) {
        // An edited overflow owner must not keep a stale former detail layer.
        this.layerKeys[this.detailLayers.get(key)] = null;
        this.detailLayers.delete(key);
        this.lookupDirty = true;
      }
      this.dirtyKeys.delete(key);
      if (!bytes.some(value => value !== 0)) {
        this.knownKeys.delete(key);
        this.lookupDirty = true;
      }
    }
    if (this.lookupDirty) this.publishLookup();
    this.uniforms.uMaterialEnabled.value = this.knownKeys.size > 0;
    this.profile.visibleRequired = required.length;
    this.profile.visibleUnavailable = required.filter(({ key }) => !this.detailLayers.has(key) && !this.overviewSlots.has(key)).length;
    const elapsed = performance.now() - started;
    this.profile.updateMs += elapsed;
    this.profile.updatePeakMs = Math.max(this.profile.updatePeakMs, elapsed);
  }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { detailUploads: 0, overviewUploads: 0, lookupUploads: 0, visibleRequired: profile.visibleRequired, visibleUnavailable: profile.visibleUnavailable, updateMs: 0, updatePeakMs: 0 };
    return profile;
  }

  publishLookup() {
    this.lookupData.fill(0);
    for (const key of this.knownKeys) {
      // Never publish old bytes for an edit deferred outside this view.
      if (this.dirtyKeys.has(key)) continue;
      const [x, z] = key.split(",").map(Number);
      const localX = x - this.lookupOrigin.x, localZ = z - this.lookupOrigin.y;
      if (localX < 0 || localZ < 0 || localX >= this.lookupSize || localZ >= this.lookupSize) continue;
      const offset = (localZ * this.lookupSize + localX) * 2;
      this.lookupData[offset] = (this.detailLayers.get(key) ?? -1) + 1;
      this.lookupData[offset + 1] = (this.overviewSlots.get(key) ?? -1) + 1;
    }
    this.lookupTexture.needsUpdate = true;
    this.lookupDirty = false;
    this.profile.lookupUploads++;
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
    for (const texture of [...this.maskTextures, ...this.overviewTextures, this.lookupTexture, this.imageTexture]) texture.dispose();
    for (const entry of this.textureEntries.values()) entry.texture?.dispose();
    this.textureEntries.clear();
    this.boundImages.fill(null);
  }
}
