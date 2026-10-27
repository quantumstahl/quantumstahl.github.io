import { sculptRockBlocks } from "./RockifyShape.js";

function smoothFalloff(value) {
  const t = Math.max(0, Math.min(1, value));
  return 1 - t * t * (3 - 2 * t);
}

export class TerrainSculptor {
  constructor(provider) {
    this.provider = provider;
    this.radius = 24;
    this.strength = 18;
    this.flattenHeight = 0;
    // Rockify is a cliff tool.  Horizontal terrain is deliberately excluded
    // so its first stamp cannot turn ordinary ground into a warped rock slab.
    // Existing rock exposure remains editable even where a folded surface has
    // become locally horizontal.
    this.rockifyGroundNormalLimit = 1.00;
    this.strokeChanges = null;
    this.rockifyFrame = null;
    this.profile = { rockifyBrushMs: 0, rockifySourceSamples: 0 };
  }

  captureFlattenHeight(worldX, worldZ) {
    this.flattenHeight = this.provider.sampleSurfaceHeight(worldX, worldZ);
  }

  beginStroke() {
    this.strokeChanges = new Map();
    this.rockifyFrame = null;
  }

  endStroke() {
    const changes = this.strokeChanges;
    this.strokeChanges = null;
    this.rockifyFrame = null;
    return changes && changes.size ? [...changes.values()] : null;
  }

  applyHistory(entries, property) {
    this.provider.beginChanges();
    try {
      for (const entry of entries) {
        if (entry.type === "warp") {
          const value = entry[property];
          this.provider.setWarpSample(entry.x, entry.z, value.x, value.z);
        } else if (entry.type === "rockExposure") {
          this.provider.setRockExposureSample(entry.x, entry.z, entry[property]);
        } else this.provider.setHeightSample(entry.x, entry.z, entry[property]);
      }
    } finally { this.provider.endChanges(); }
  }

  rememberHeight(x, z, before, after) {
    const key = `height:${x},${z}`;
    const entry = this.strokeChanges?.get(key);
    if (entry) entry.after = after;
    else this.strokeChanges?.set(key, { type: "height", x, z, before, after });
  }

  rememberWarp(x, z, before, after) {
    const key = `warp:${x},${z}`;
    const entry = this.strokeChanges?.get(key);
    if (entry) entry.after = after;
    else this.strokeChanges?.set(key, { type: "warp", x, z, before, after });
  }

  rememberRockExposure(x, z, before, after) {
    const key = `rockExposure:${x},${z}`;
    const entry = this.strokeChanges?.get(key);
    if (entry) entry.after = after;
    else this.strokeChanges?.set(key, { type: "rockExposure", x, z, before, after });
  }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { rockifyBrushMs: 0, rockifySourceSamples: 0 };
    return profile;
  }

  isRockifiableSurface(worldX, worldZ, normal = null) {
    if (Math.abs(this.provider.sampleRockExposure(worldX, worldZ)) > .001) return true;
    if (normal) return Math.abs(normal.y) <= this.rockifyGroundNormalLimit;
    const spacing = this.provider.sampleSpacing;
    // Normal-free callers supply source-grid coordinates. Use direct height
    // samples rather than inverse-warp surface sampling for that local slope.
    const left = this.provider.sampleHeight(worldX - spacing, worldZ);
    const right = this.provider.sampleHeight(worldX + spacing, worldZ);
    const near = this.provider.sampleHeight(worldX, worldZ - spacing);
    const far = this.provider.sampleHeight(worldX, worldZ + spacing);
    const normalY = (spacing * 2) / Math.hypot(left - right, spacing * 2, near - far);
    return normalY <= this.rockifyGroundNormalLimit;
  }

  sculpt(worldX, worldZ, delta, mode, { rockifyIn = false, rockNormal = null, rockStamp = null, rockifyCandidates = [] } = {}) {
    // Keep every source tile touched by the current brush eligible for
    // immediate full-resolution residency, including strokes at tile corners.
    this.provider.setActiveEditPosition(worldX, worldZ, this.radius);
    if (mode === "rockify") return this.sculptRockify(worldX, worldZ, delta, { rockifyIn, rockNormal, rockStamp, rockifyCandidates });
    const spacing = this.provider.sampleSpacing;
    const searchRadius = this.radius;
    const minX = Math.ceil((worldX - searchRadius) / spacing);
    const maxX = Math.floor((worldX + searchRadius) / spacing);
    const minZ = Math.ceil((worldZ - searchRadius) / spacing);
    const maxZ = Math.floor((worldZ + searchRadius) / spacing);
    const isWarpMode = mode === "smoothWarp";
    const originalHeight = mode === "smooth" ? new Map() : null;
    const originalWarp = mode === "smoothWarp" ? new Map() : null;
    const heightAt = (gridX, gridZ) => {
      const key = `${gridX},${gridZ}`;
      if (!originalHeight?.has(key)) originalHeight?.set(key, this.provider.sampleHeight(gridX * spacing, gridZ * spacing));
      return originalHeight ? originalHeight.get(key) : this.provider.sampleHeight(gridX * spacing, gridZ * spacing);
    };
    const warpAt = (gridX, gridZ) => {
      const key = `${gridX},${gridZ}`;
      if (!originalWarp) {
        const sampled = this.provider.sampleWarp(gridX * spacing, gridZ * spacing);
        return { x: sampled.x, z: sampled.z };
      }
      if (!originalWarp.has(key)) {
        const sampled = this.provider.sampleWarp(gridX * spacing, gridZ * spacing);
        originalWarp.set(key, { x: sampled.x, z: sampled.z });
      }
      return originalWarp.get(key);
    };
    if (originalHeight || originalWarp) {
      for (let z = minZ - 1; z <= maxZ + 1; z += 1) for (let x = minX - 1; x <= maxX + 1; x += 1) {
        if (originalHeight) heightAt(x, z);
        if (originalWarp) warpAt(x, z);
      }
    }

    let changed = 0;
    this.provider.beginChanges();
    try {
      for (let gridZ = minZ; gridZ <= maxZ; gridZ += 1) for (let gridX = minX; gridX <= maxX; gridX += 1) {
        const sampleX = gridX * spacing, sampleZ = gridZ * spacing;
        const dx = sampleX - worldX, dz = sampleZ - worldZ;
        const distance = Math.hypot(dx, dz);
        if (distance > this.radius) continue;
        const falloff = smoothFalloff(distance / this.radius);
        if (!isWarpMode) {
          const current = heightAt(gridX, gridZ);
          let next = current;
          if (mode === "raise") next += this.strength * delta * falloff;
          if (mode === "lower") next -= this.strength * delta * falloff;
          if (mode === "flatten") next += (this.flattenHeight - current) * Math.min(1, this.strength * delta * 1.08) * falloff;
          if (mode === "smooth") {
            const average = (heightAt(gridX - 1, gridZ) + heightAt(gridX + 1, gridZ) + heightAt(gridX, gridZ - 1) + heightAt(gridX, gridZ + 1)) * .25;
            next += (average - current) * Math.min(1, this.strength * delta * .08) * falloff;
          }
          if (next === current) continue;
          this.rememberHeight(sampleX, sampleZ, current, next);
          this.provider.setHeightSample(sampleX, sampleZ, next);
          changed += 1;
          continue;
        }

        const current = warpAt(gridX, gridZ);
        let nextX = current.x, nextZ = current.z;
        const left = warpAt(gridX - 1, gridZ), right = warpAt(gridX + 1, gridZ);
        const up = warpAt(gridX, gridZ - 1), down = warpAt(gridX, gridZ + 1);
        const blend = Math.min(1, this.strength * delta * .08) * falloff;
        nextX += ((left.x + right.x + up.x + down.x) * .25 - current.x) * blend;
        nextZ += ((left.z + right.z + up.z + down.z) * .25 - current.z) * blend;
        if (nextX === current.x && nextZ === current.z) continue;
        const after = { x: nextX, z: nextZ };
        this.rememberWarp(sampleX, sampleZ, { x: current.x, z: current.z }, after);
        this.provider.setWarpSample(sampleX, sampleZ, nextX, nextZ);
        changed += 1;
      }
    } finally { this.provider.endChanges(); }
    return changed;
  }

  sculptRockify(worldX, worldZ, delta, options) {
    const started = performance.now();
    try { return sculptRockBlocks(this, worldX, worldZ, delta, options); }
    finally { this.profile.rockifyBrushMs += performance.now() - started; }
  }
}
