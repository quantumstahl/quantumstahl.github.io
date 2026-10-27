import * as THREE from "three";

function rayIntersectsBox(ray, minX, minY, minZ, maxX, maxY, maxZ) {
  let near = 0;
  let far = Infinity;
  for (const [origin, direction, minimum, maximum] of [
    [ray.origin.x, ray.direction.x, minX, maxX],
    [ray.origin.y, ray.direction.y, minY, maxY],
    [ray.origin.z, ray.direction.z, minZ, maxZ],
  ]) {
    if (Math.abs(direction) < 1e-8) {
      if (origin < minimum || origin > maximum) return false;
      continue;
    }
    const inverse = 1 / direction;
    const a = (minimum - origin) * inverse;
    const b = (maximum - origin) * inverse;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return false;
  }
  return far >= 0;
}

function sphereIntersectsBox(center, radius, minX, minY, minZ, maxX, maxY, maxZ) {
  const x = Math.max(minX, Math.min(center.x, maxX));
  const y = Math.max(minY, Math.min(center.y, maxY));
  const z = Math.max(minZ, Math.min(center.z, maxZ));
  return (x - center.x) ** 2 + (y - center.y) ** 2 + (z - center.z) ** 2 <= radius ** 2;
}

// Editor-only CPU picking over the persistent 2 m source grid. It mirrors
// the shader's position rule: finalXZ = sourceXZ + warp(sourceXZ), Y = height.
export class WarpSurfacePicker {
  constructor(provider) {
    this.provider = provider;
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.profile = { pickMs: 0, pickTiles: 0, pickTriangles: 0, pickHits: 0, brushMs: 0, brushTiles: 0, brushSamples: 0 };
  }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { pickMs: 0, pickTiles: 0, pickTriangles: 0, pickHits: 0, brushMs: 0, brushTiles: 0, brushSamples: 0 };
    return profile;
  }

  summaryBounds(summary) {
    const tileMinX = summary.tileX * this.provider.tileSize;
    const tileMinZ = summary.tileZ * this.provider.tileSize;
    return {
      minX: tileMinX + summary.minWarpX,
      maxX: tileMinX + this.provider.tileSize + summary.maxWarpX,
      minY: summary.minHeight,
      maxY: summary.maxHeight,
      minZ: tileMinZ + summary.minWarpZ,
      maxZ: tileMinZ + this.provider.tileSize + summary.maxWarpZ,
    };
  }

  pick(ray) {
    const started = performance.now();
    const best = { distance: Infinity, sourceX: 0, sourceZ: 0, tileX: 0, tileZ: 0 };
    let candidateTiles = 0;
    let triangles = 0;
    for (const summary of this.provider.warpSummaries.values()) {
      const bounds = this.summaryBounds(summary);
      if (!rayIntersectsBox(ray, bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ)) continue;
      candidateTiles += 1;
      const tile = this.provider.getTile(summary.tileX, summary.tileZ, "warp-picker");
      const range = this.sampleRange(tile, summary);
      for (let z = range.minZ; z < range.maxZ; z += 1) for (let x = range.minX; x < range.maxX; x += 1) {
        const a = this.vertex(tile, x, z);
        const b = this.vertex(tile, x + 1, z);
        const c = this.vertex(tile, x, z + 1);
        const d = this.vertex(tile, x + 1, z + 1);
        triangles += 2;
        this.testTriangle(ray, a, c, b, tile, best);
        this.testTriangle(ray, b, c, d, tile, best);
      }
    }
    this.profile.pickMs += performance.now() - started;
    this.profile.pickTiles += candidateTiles;
    this.profile.pickTriangles += triangles;
    if (!Number.isFinite(best.distance)) return null;
    this.profile.pickHits += 1;
    this.point.copy(ray.direction).multiplyScalar(best.distance).add(ray.origin);
    return {
      point: this.point.clone(), normal: this.normal.clone(),
      sourceX: best.sourceX, sourceZ: best.sourceZ,
      tileX: best.tileX, tileZ: best.tileZ,
      distance: best.distance,
    };
  }

  queryBrushSphere(center, radius) {
    const started = performance.now();
    const samples = [];
    let candidateTiles = 0;
    for (const summary of this.provider.warpSummaries.values()) {
      const bounds = this.summaryBounds(summary);
      if (!sphereIntersectsBox(center, radius, bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ)) continue;
      candidateTiles += 1;
      const tile = this.provider.getTile(summary.tileX, summary.tileZ, "warp-picker");
      // finalXZ = sourceXZ + warp.  The tile summary gives a conservative
      // inverse range, so a small brush does not need to scan all 16,641
      // source samples in a 256 m tile every sculpt frame.
      const range = this.brushSampleRange(tile, summary, center, radius);
      if (range.minX > range.maxX || range.minZ > range.maxZ) continue;
      const width = tile.segments + 1;
      for (let z = range.minZ; z <= range.maxZ; z += 1) for (let x = range.minX; x <= range.maxX; x += 1) {
        const index = z * width + x;
        const offset = index * 2;
        const sourceX = tile.x + x * tile.sampleSpacing;
        const sourceZ = tile.z + z * tile.sampleSpacing;
        const vertexX = sourceX + (tile.warp?.[offset] ?? 0);
        const vertexZ = sourceZ + (tile.warp?.[offset + 1] ?? 0);
        if ((vertexX - center.x) ** 2 + (tile.heights[index] - center.y) ** 2 + (vertexZ - center.z) ** 2 <= radius ** 2) {
          samples.push({ x: sourceX, z: sourceZ });
        }
      }
    }
    this.profile.brushMs += performance.now() - started;
    this.profile.brushTiles += candidateTiles;
    this.profile.brushSamples += samples.length;
    return samples;
  }

  brushSampleRange(tile, summary, center, radius) {
    const spacing = tile.sampleSpacing;
    const toSample = value => Math.floor((value - tile.x) / spacing);
    const toRow = value => Math.floor((value - tile.z) / spacing);
    // If finalX is inside the sphere then sourceX is inside this interval.
    // The same holds for Z. Bounds are conservative, so no displaced sample
    // can be omitted even with large unrestricted Rockify displacement.
    const minX = Math.max(0, toSample(center.x - radius - summary.maxWarpX));
    const maxX = Math.min(tile.segments, Math.ceil((center.x + radius - summary.minWarpX - tile.x) / spacing));
    const minZ = Math.max(0, toRow(center.z - radius - summary.maxWarpZ));
    const maxZ = Math.min(tile.segments, Math.ceil((center.z + radius - summary.minWarpZ - tile.z) / spacing));
    return { minX, maxX, minZ, maxZ };
  }

  sampleRange(tile, summary) {
    return {
      minX: 0,
      maxX: tile.segments,
      minZ: 0,
      maxZ: tile.segments,
    };
  }

  vertex(tile, sampleX, sampleZ) {
    const width = tile.segments + 1;
    const index = sampleZ * width + sampleX;
    const offset = index * 2;
    const sourceX = tile.x + sampleX * tile.sampleSpacing;
    const sourceZ = tile.z + sampleZ * tile.sampleSpacing;
    return {
      x: sourceX + (tile.warp?.[offset] ?? 0), y: tile.heights[index], z: sourceZ + (tile.warp?.[offset + 1] ?? 0),
      sourceX, sourceZ,
    };
  }

  testTriangle(ray, a, b, c, tile, best) {
    const edge1X = b.x - a.x, edge1Y = b.y - a.y, edge1Z = b.z - a.z;
    const edge2X = c.x - a.x, edge2Y = c.y - a.y, edge2Z = c.z - a.z;
    const pX = ray.direction.y * edge2Z - ray.direction.z * edge2Y;
    const pY = ray.direction.z * edge2X - ray.direction.x * edge2Z;
    const pZ = ray.direction.x * edge2Y - ray.direction.y * edge2X;
    const determinant = edge1X * pX + edge1Y * pY + edge1Z * pZ;
    // Folded Rockify faces may intentionally be visible from either side, so
    // the editor accepts both windings too.
    if (Math.abs(determinant) < 1e-8) return;
    const inverse = 1 / determinant;
    const tx = ray.origin.x - a.x, ty = ray.origin.y - a.y, tz = ray.origin.z - a.z;
    const u = (tx * pX + ty * pY + tz * pZ) * inverse;
    if (u < 0 || u > 1) return;
    const qX = ty * edge1Z - tz * edge1Y;
    const qY = tz * edge1X - tx * edge1Z;
    const qZ = tx * edge1Y - ty * edge1X;
    const v = (ray.direction.x * qX + ray.direction.y * qY + ray.direction.z * qZ) * inverse;
    if (v < 0 || u + v > 1) return;
    const distance = (edge2X * qX + edge2Y * qY + edge2Z * qZ) * inverse;
    if (distance <= 0 || distance >= best.distance) return;
    const weightA = 1 - u - v;
    best.distance = distance;
    best.sourceX = a.sourceX * weightA + b.sourceX * u + c.sourceX * v;
    best.sourceZ = a.sourceZ * weightA + b.sourceZ * u + c.sourceZ * v;
    best.tileX = Math.round(tile.x / tile.size);
    best.tileZ = Math.round(tile.z / tile.size);
    this.normal.set(
      edge1Y * edge2Z - edge1Z * edge2Y,
      edge1Z * edge2X - edge1X * edge2Z,
      edge1X * edge2Y - edge1Y * edge2X,
    ).normalize();
    // A double-sided surface has no single artist-facing normal. Orient it
    // toward the ray origin so Rockify Out deforms the visible side, whether
    // that triangle happened to keep or reverse its original winding.
    if (this.normal.dot(ray.direction) > 0) this.normal.multiplyScalar(-1);
  }
}
