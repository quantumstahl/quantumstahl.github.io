import { TERRAIN_TILE_SIZE, TERRAIN_TILE_SEGMENTS } from "../terrain/TerrainDataProvider.js";

const SPACING = TERRAIN_TILE_SIZE / TERRAIN_TILE_SEGMENTS;

// Share Float32 storage across many history samples instead of allocating
// two tiny ArrayBuffers per sample during a large, fast stroke.
class PaintSampleChange {
  constructor(x, z, values, offset) { this.x = x; this.z = z; this.values = values; this.offset = offset; }
  get before() { return this.values.subarray(this.offset, this.offset + 8); }
  get after() { return this.values.subarray(this.offset + 8, this.offset + 16); }
  hasChanged() {
    for (let layer = 0; layer < 8; layer++) if (this.values[this.offset + layer] !== this.values[this.offset + layer + 8]) return true;
    return false;
  }
}

export class TerrainTexturePainter {
  constructor(data) {
    this.data = data;
    this.activeMaterial = 0;
    this.radius = 24;
    this.flow = 3;
    this.stroke = null;
    this.profile = { paintMs: 0, paintPeakMs: 0, samples: 0 };
  }

  beginStroke({ erase = false } = {}) {
    if (this.stroke) throw new Error("Finish the current paint stroke first.");
    if (!Number.isInteger(this.activeMaterial) || this.activeMaterial < 0 || this.activeMaterial > 7
      || !Number.isFinite(this.radius) || this.radius <= 0 || !Number.isFinite(this.flow) || this.flow <= 0) throw new Error("Invalid paint brush settings.");
    this.stroke = { material: this.activeMaterial, radius: this.radius, flow: this.flow, erase, previous: null, changes: new Map(), historyBlock: null, historyOffset: 0 };
  }

  resetPath() { if (this.stroke) this.stroke.previous = null; }

  paintTo(x, z, delta) {
    if (!this.stroke) throw new Error("Begin a paint stroke first.");
    if (![x, z, delta].every(Number.isFinite) || delta < 0) throw new Error("Invalid paint position or elapsed time.");
    if (!delta) return 0;
    const { previous, radius } = this.stroke;
    const distance = previous ? Math.hypot(x - previous.x, z - previous.z) : 0;
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, Math.min(8, radius / 4))));
    const started = performance.now();
    try {
      const changed = this.paintSegment(previous?.x ?? x, previous?.z ?? z, x, z, steps, delta);
      this.stroke.previous = { x, z };
      this.profile.samples += changed;
      return changed;
    } finally {
      const elapsed = performance.now() - started;
      this.profile.paintMs += elapsed;
      this.profile.paintPeakMs = Math.max(this.profile.paintPeakMs, elapsed);
    }
  }

  paintSegment(startX, startZ, x, z, steps, delta) {
    const { radius, flow, material, erase, changes } = this.stroke;
    const before = new Float32Array(8), after = new Float32Array(8);
    const dx = (x - startX) / steps, dz = (z - startZ) / steps;
    const stepSquared = dx * dx + dz * dz, stepLength = Math.sqrt(stepSquared), radiusSquared = radius * radius;
    // Exponential blending toward one target composes by adding exposure.
    // Sum the same interpolated stamps, then read/write each source sample
    // once instead of rewriting overlapping brush discs many times.
    return this.data.editSamples(access => {
      let changed = 0;
      const minZ = Math.ceil((Math.min(startZ + dz, z) - radius) / SPACING);
      const maxZ = Math.floor((Math.max(startZ + dz, z) + radius) / SPACING);
      for (let gz = minZ; gz <= maxZ; gz++) {
        const worldZ = gz * SPACING;
        let rowFirst = 1, rowLast = steps;
        if (dz) {
          const a = (worldZ - radius - startZ) / dz, b = (worldZ + radius - startZ) / dz;
          rowFirst = Math.max(1, Math.ceil(Math.min(a, b)));
          rowLast = Math.min(steps, Math.floor(Math.max(a, b)));
        }
        if (rowFirst > rowLast) continue;
        const firstX = startX + rowFirst * dx, lastX = startX + rowLast * dx;
        const minX = Math.ceil((Math.min(firstX, lastX) - radius) / SPACING);
        const maxX = Math.floor((Math.max(firstX, lastX) + radius) / SPACING);
        for (let gx = minX; gx <= maxX; gx++) {
          const worldX = gx * SPACING, qx = worldX - startX, qz = worldZ - startZ;
          let first = 1, last = 1;
          if (stepSquared) {
            const projection = (qx * dx + qz * dz) / stepSquared;
            const perpendicular = Math.max(0, qx * qx + qz * qz - projection * projection * stepSquared);
            if (perpendicular >= radiusSquared) continue;
            const span = Math.sqrt(radiusSquared - perpendicular) / stepLength;
            first = Math.max(rowFirst, Math.ceil(projection - span));
            last = Math.min(rowLast, Math.floor(projection + span));
          }
          let exposure = 0;
          for (let step = first; step <= last; step++) {
            const sx = qx - step * dx, sz = qz - step * dz;
            const squared = sx * sx + sz * sz;
            if (squared >= radiusSquared) continue;
            const t = 1 - Math.sqrt(squared) / radius;
            exposure += t * t * (3 - 2 * t);
          }
          if (!exposure) continue;
          const alpha = -Math.expm1(-flow * delta / steps * exposure);
          access.read(gx, gz, before);
          let differs = false;
          for (let layer = 0; layer < 8; layer++) {
            after[layer] = erase
              ? before[layer] * (layer === material ? 1 - alpha : 1)
              : before[layer] * (1 - alpha) + (layer === material ? alpha : 0);
            if (after[layer] !== before[layer]) differs = true;
          }
          if (!differs) continue;
          access.write(gx, gz, after);
          access.read(gx, gz, after); // Record the exact normalized Float32 result.
          const key = `${gx},${gz}`;
          const entry = changes.get(key);
          if (entry) entry.values.set(after, entry.offset + 8);
          else {
            if (!this.stroke.historyBlock || this.stroke.historyOffset === this.stroke.historyBlock.length) {
              this.stroke.historyBlock = new Float32Array(1024 * 16);
              this.stroke.historyOffset = 0;
            }
            const values = this.stroke.historyBlock, offset = this.stroke.historyOffset;
            values.set(before, offset); values.set(after, offset + 8);
            changes.set(key, new PaintSampleChange(worldX, worldZ, values, offset));
            this.stroke.historyOffset += 16;
          }
          changed++;
        }
      }
      return changed;
    });
  }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { paintMs: 0, paintPeakMs: 0, samples: 0 };
    return profile;
  }

  endStroke() {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return null;
    const entries = [...stroke.changes.values()].filter(entry => entry.hasChanged());
    return entries.length ? entries : null;
  }

  applyHistory(entries, property) {
    if (property !== "before" && property !== "after") throw new Error("Invalid paint history direction.");
    this.data.editSamples(access => {
      for (const entry of entries) {
        if (entry instanceof PaintSampleChange) access.write(Math.round(entry.x / SPACING), Math.round(entry.z / SPACING), entry.values, entry.offset + (property === "after" ? 8 : 0));
        else access.write(Math.round(entry.x / SPACING), Math.round(entry.z / SPACING), entry[property]);
      }
    });
  }
}
