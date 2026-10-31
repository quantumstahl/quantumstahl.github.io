import * as THREE from "three";
import { TERRAIN_CHANGE } from "./TerrainDataProvider.js";

// One geographic, full-resolution mask in the existing rock-cutout sampler:
// R = transient shell replacement, G = persistent terrain holes. Never filtered
// or downsampled with height LOD/cache eviction. The atlas grows only on edits.
// RGBA8 is required by this Three.js version for row update ranges; B/A are
// unused. R/G still share ONE existing sampler, including material painting.
export class TerrainCutoutMask {
  constructor(provider) {
    this.provider = provider;
    this.mask = null;
    this.rock = null;
    this.rockVersion = -1;
    this.dirty = new Map();
    for (const key of provider.holeMasks.keys()) this.dirty.set(key, null);
    this.unsubscribe = provider.onTileChanged((tile, channels, bounds) => {
      if (!(channels & TERRAIN_CHANGE.HOLES)) return;
      const key = provider.tileKey(tile.x / tile.size, tile.z / tile.size);
      // Union multiple notifications before the next frame.
      const old = this.dirty.get(key);
      this.dirty.set(key, !bounds || old === null ? null : old ? {
        minX: Math.min(old.minX, bounds.minX), maxX: Math.max(old.maxX, bounds.maxX),
        minZ: Math.min(old.minZ, bounds.minZ), maxZ: Math.max(old.maxZ, bounds.maxZ),
      } : { ...bounds });
    });
  }

  update(rock = null) {
    const version = rock?.texture.version ?? -1;
    if (!this.dirty.size && rock === this.rock && version === this.rockVersion) return this.mask;
    const p = this.provider, s = p.sampleSpacing, n = p.tileSegments;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const key of p.holeMasks.keys()) {
      const [x, z] = key.split(",").map(Number);
      left = Math.min(left, x * n); top = Math.min(top, z * n);
      right = Math.max(right, (x + 1) * n); bottom = Math.max(bottom, (z + 1) * n);
    }
    if (rock) {
      left = Math.min(left, Math.round(rock.minX / s)); top = Math.min(top, Math.round(rock.minZ / s));
      right = Math.max(right, Math.round(rock.minX / s) + rock.texture.image.width);
      bottom = Math.max(bottom, Math.round(rock.minZ / s) + rock.texture.image.height);
    }
    if (right <= left) {
      this.mask?.texture.dispose(); this.mask = null;
      this.rock = rock; this.rockVersion = version;
      this.dirty.clear();
      return null;
    }
    const old = this.mask;
    // Retain allocated bounds on restore; no resizing or whole-world rebuild.
    if (old) {
      left = Math.min(left, old.cellX); top = Math.min(top, old.cellZ);
      right = Math.max(right, old.cellX + old.texture.image.width);
      bottom = Math.max(bottom, old.cellZ + old.texture.image.height);
    }
    const width = right - left, height = bottom - top;
    const fresh = !old || old.cellX !== left || old.cellZ !== top || old.texture.image.width !== width || old.texture.image.height !== height;
    if (fresh) {
      const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height, THREE.RGBAFormat);
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      texture.onUpdate = () => { texture.userData.uploaded = true; };
      texture.generateMipmaps = false; texture.unpackAlignment = 1; texture.needsUpdate = true;
      this.mask = { texture, cellX: left, cellZ: top, minX: left * s, minZ: top * s, cellSize: s, boundaryMargin: .5 };
      old?.texture.dispose();
      for (const key of p.holeMasks.keys()) this.dirty.set(key, null);
    }
    const { texture } = this.mask, data = texture.image.data;
    const writeRect = (x0, z0, x1, z1, channel, read) => {
      x0 = Math.max(left, x0); z0 = Math.max(top, z0);
      x1 = Math.min(right, x1); z1 = Math.min(bottom, z1);
      for (let z = z0; z < z1; z++) {
        const start = ((z - top) * width + x0 - left) * 4;
        let changed = false;
        for (let x = x0; x < x1; x++) {
          const index = ((z - top) * width + x - left) * 4 + channel, value = read(x, z);
          if (data[index] !== value) { data[index] = value; changed = true; }
        }
        if (changed && !fresh && texture.userData.uploaded) texture.addUpdateRange(start, (x1 - x0) * 4);
        if (changed) texture.needsUpdate = true;
      }
    };
    if (fresh || rock !== this.rock || version !== this.rockVersion) {
      if (!fresh && rock !== this.rock && this.rock) {
        const r = this.rock;
        writeRect(r.cellX, r.cellZ, r.cellX + r.texture.image.width, r.cellZ + r.texture.image.height, 0, () => 0);
      }
      if (rock) {
        const rx = Math.round(rock.minX / s), rz = Math.round(rock.minZ / s), image = rock.texture.image;
        const rects = !fresh && rock === this.rock && version === this.rockVersion + 1 && rock.lastUpdateRects ? rock.lastUpdateRects : [{ left: 0, top: 0, right: image.width, bottom: image.height }];
        for (const r of rects) writeRect(rx + r.left, rz + r.top, rx + r.right, rz + r.bottom, 0, (x, z) => image.data[(z - rz) * image.width + x - rx]);
      }
    }
    for (const [key, bounds] of this.dirty) {
      const [tx, tz] = key.split(",").map(Number), values = p.holeMasks.get(key);
      const x0 = bounds ? Math.floor(bounds.minX / s) : tx * n, z0 = bounds ? Math.floor(bounds.minZ / s) : tz * n;
      const x1 = bounds ? Math.floor(bounds.maxX / s) + 1 : (tx + 1) * n, z1 = bounds ? Math.floor(bounds.maxZ / s) + 1 : (tz + 1) * n;
      writeRect(x0, z0, x1, z1, 1, (x, z) => values?.[(z - tz * n) * n + x - tx * n] ? 255 : 0);
    }
    this.dirty.clear(); this.rock = rock; this.rockVersion = version;
    return this.mask;
  }

  dispose() { this.unsubscribe(); this.mask?.texture.dispose(); }
}
