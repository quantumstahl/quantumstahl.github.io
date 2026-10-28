import { Matrix4 } from "three";
import { rockCellCovered } from "../terrain/RockSurface.js";
import { TERRAIN_CHANGE } from "../terrain/TerrainDataProvider.js";
import { StaticColliders } from "./StaticColliders.js";
import { TriangleMesh } from "./TriangleMesh.js";
import { spatialKey } from "./SpatialIndex.js";

export function buildRockCollider(tile) {
  const coverage = new Uint8Array(tile.segments ** 2); let count = 0;
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for (let z = 0; z < tile.segments; z++) for (let x = 0; x < tile.segments; x++) {
    if (rockCellCovered(tile, x, z)) {
      coverage[z * tile.segments + x] = 1; count++;
      minX=Math.min(minX,tile.x+x*tile.sampleSpacing);maxX=Math.max(maxX,tile.x+(x+1)*tile.sampleSpacing);
      minZ=Math.min(minZ,tile.z+z*tile.sampleSpacing);maxZ=Math.max(maxZ,tile.z+(z+1)*tile.sampleSpacing);
    }
  }
  const vertices = new Float64Array(count * 18), width = tile.segments + 1;
  let offset = 0;
  const vertex = index => {
    // Match RockSurfaceShell's Float32 authored geometry, including fold faces.
    vertices[offset++] = Math.fround(tile.x + index % width * tile.sampleSpacing + (tile.warp?.[index * 2] ?? 0));
    vertices[offset++] = tile.heights[index];
    vertices[offset++] = Math.fround(tile.z + Math.floor(index / width) * tile.sampleSpacing + (tile.warp?.[index * 2 + 1] ?? 0));
  };
  for (let cell = 0; cell < coverage.length; cell++) if (coverage[cell]) {
    const a = Math.floor(cell / tile.segments) * width + cell % tile.segments;
    vertex(a); vertex(a + width); vertex(a + 1); vertex(a + 1); vertex(a + width); vertex(a + width + 1);
  }
  return { coverage, sourceBounds:{minX,minZ,maxX,maxZ}, mesh: count ? new TriangleMesh(vertices) : null };
}

export class RockCollider extends StaticColliders {
  constructor(provider) {
    super(); this.provider = provider; this.chunks = new Map(); this.coverageIndex = new Map(); this.references = new Map(); this.pending = new Set(provider.rockExposureTileKeys);
    this.identity = new Matrix4();
    this.unsubscribe = provider.onTileChanged((tile, channels, bounds) => {
      if (!(channels & TERRAIN_CHANGE.ALL)) return;
      const key = provider.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size));
      if (!(channels & TERRAIN_CHANGE.ROCK_EXPOSURE)) {
        const chunk = this.chunks.get(key); if (!chunk) return;
        const b = chunk.sourceBounds;
        if (bounds && (bounds.minX>b.maxX||bounds.maxX<b.minX||bounds.minZ>b.maxZ||bounds.maxZ<b.minZ)) return;
      }
      if (tile.rockExposure || this.chunks.has(key)) this.pending.add(key);
    });
    this.prepare();
  }
  prepare() {
    for (const key of this.pending) {
      const comma = key.indexOf(","), x = Number(key.slice(0, comma)), z = Number(key.slice(comma + 1));
      const tile = this.provider.getSampleTile(x, z, "physics-rock-chunk");
      const data = tile ? buildRockCollider(tile) : null;
      this.coverageIndex.delete(spatialKey(x, z));
      this.delete(key); this.chunks.delete(key);
      if (!data?.mesh) continue;
      let object = this.references.get(key);
      if (!object) { object = { id: `maxworld:rock:${key}`, name: "rock", type: "rock" }; this.references.set(key, object); }
      this.chunks.set(key, data); this.coverageIndex.set(spatialKey(x, z), data); this.set(key, data.mesh, this.identity, object); this.stats.builds++;
    }
    this.pending.clear(); return true;
  }
  isCovered(sourceX, sourceZ) {
    const p = this.provider, tx = Math.floor(sourceX / p.tileSize), tz = Math.floor(sourceZ / p.tileSize);
    const chunk = this.coverageIndex.get(spatialKey(tx, tz));
    if (!chunk) return false;
    const x = Math.floor((sourceX - tx * p.tileSize) / p.sampleSpacing), z = Math.floor((sourceZ - tz * p.tileSize) / p.sampleSpacing);
    return !!chunk.coverage[z * p.tileSegments + x];
  }
  query(bounds, visit) { this.prepare(); super.query(bounds, visit); }
  dispose() { this.unsubscribe(); super.dispose(); this.chunks.clear(); this.coverageIndex.clear(); this.references.clear(); this.pending.clear(); }
}
