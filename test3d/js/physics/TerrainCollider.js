import { Vector3 } from "three";
import { proceduralHeight } from "../terrain/TerrainHeight.js";
import { TERRAIN_CHANGE } from "../terrain/TerrainDataProvider.js";

// Numeric keys avoid allocating coordinate strings in warmed collision queries.
const OFFSET = 33554432, STRIDE = 67108864;
const keyOf = (x, z) => (x + OFFSET) * STRIDE + z + OFFSET;
const overlaps = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY && a.minZ <= b.maxZ && a.maxZ >= b.minZ;

export class TerrainCollider {
  constructor(provider, { maxCachedBlocks = 256, object = { id: "maxworld:terrain", name: "ground", type: "ground" }, rock = null } = {}) {
    this.rock = rock;
    this.provider = provider; this.object = object;
    this.segments = provider.tileSegments % 4 === 0 ? 4 : provider.tileSegments % 2 === 0 ? 2 : 1;
    this.blockSize = this.segments * provider.sampleSpacing;
    this.maxCachedBlocks = Math.max(4, maxCachedBlocks);
    this.blocks = new Map(); this.warpTiles = new Map(); this.warpCells = new Map(); this.largeWarpBlocks = new Set();
    this.a = new Vector3(); this.b = new Vector3(); this.c = new Vector3();
    this.placementBounds = { minX: 0, maxX: 0, minY: -Infinity, maxY: Infinity, minZ: 0, maxZ: 0 };
    this.visitPlacement = this.testPlacement.bind(this);
    this.stamp = 0;
    this.stats = { builtBlocks: 0, invalidatedBlocks: 0, candidateBlocks: 0, triangles: 0, vertexArrays: 0 };
    // WorldFile retains warp summaries while validating saved tiles. Generic
    // stores without metadata pay one discovery pass at initialization only.
    if (!provider.store?.warpSummaries || provider.store.warpMetadataComplete === false) {
      for (const key of provider.persistedTileKeys) {
        const separator = key.indexOf(",");
        provider.getTile(Number(key.slice(0, separator)), Number(key.slice(separator + 1)), "physics-warp-discovery");
      }
    }
    for (const summary of provider.warpSummaries.values()) this.indexWarpTile(provider.getTile(summary.tileX, summary.tileZ, "physics-warp-index"));
    this.unsubscribe = provider.onTileChanged((tile, channels, bounds) => this.invalidate(tile, channels, bounds));
  }

  readVertex(tile, sourceX, sourceZ, target, offset) {
    if (!tile) {
      target[offset] = sourceX; target[offset + 1] = proceduralHeight(sourceX, sourceZ); target[offset + 2] = sourceZ;
      return;
    }
    const x = Math.round((sourceX - tile.x) / this.provider.sampleSpacing);
    const z = Math.round((sourceZ - tile.z) / this.provider.sampleSpacing);
    const index = z * (tile.segments + 1) + x;
    target[offset] = sourceX + (tile.warp?.[index * 2] ?? 0);
    target[offset + 1] = tile.heights[index];
    target[offset + 2] = sourceZ + (tile.warp?.[index * 2 + 1] ?? 0);
  }

  getBlock(x, z) {
    const key = keyOf(x, z);
    let block = this.blocks.get(key);
    if (block) return block;
    const originX = x * this.blockSize, originZ = z * this.blockSize;
    const tile = this.provider.getSampleTile(Math.floor(originX / this.provider.tileSize), Math.floor(originZ / this.provider.tileSize), "physics-block");
    const width = this.segments + 1, values = new Float64Array(width * width * 3);
    block = { x, z, values, stamp: 0, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    for (let row = 0; row < width; row++) for (let column = 0; column < width; column++) {
      const offset = (row * width + column) * 3;
      this.readVertex(tile, originX + column * this.provider.sampleSpacing, originZ + row * this.provider.sampleSpacing, values, offset);
      block.minX = Math.min(block.minX, values[offset]); block.maxX = Math.max(block.maxX, values[offset]);
      block.minY = Math.min(block.minY, values[offset + 1]); block.maxY = Math.max(block.maxY, values[offset + 1]);
      block.minZ = Math.min(block.minZ, values[offset + 2]); block.maxZ = Math.max(block.maxZ, values[offset + 2]);
    }
    if (this.blocks.size >= this.maxCachedBlocks) this.blocks.delete(this.blocks.keys().next().value);
    this.blocks.set(key, block); this.stats.builtBlocks++; this.stats.vertexArrays++;
    return block;
  }

  indexWarpTile(tile) {
    const tileKey = this.provider.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size));
    for (const record of this.warpTiles.get(tileKey) ?? []) {
      if (record.large) this.largeWarpBlocks.delete(record);
      else for (let z = record.z0; z <= record.z1; z++) for (let x = record.x0; x <= record.x1; x++) {
        const key = keyOf(x, z), cell = this.warpCells.get(key);
        cell?.delete(record); if (!cell?.size) this.warpCells.delete(key);
      }
    }
    this.warpTiles.delete(tileKey);
    if (!tile.warp || !tile.warpSummary) return;
    const records = [], spacing = this.provider.sampleSpacing, count = tile.segments + 1;
    for (let z = 0; z < tile.segments; z += this.segments) for (let x = 0; x < tile.segments; x += this.segments) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, warped = false;
      for (let row = z; row <= z + this.segments; row++) for (let col = x; col <= x + this.segments; col++) {
        const offset = (row * count + col) * 2, wx = tile.warp[offset], wz = tile.warp[offset + 1];
        warped ||= wx !== 0 || wz !== 0;
        minX = Math.min(minX, tile.x + col * spacing + wx); maxX = Math.max(maxX, tile.x + col * spacing + wx);
        minZ = Math.min(minZ, tile.z + row * spacing + wz); maxZ = Math.max(maxZ, tile.z + row * spacing + wz);
      }
      if (!warped) continue;
      const record = { x: Math.round((tile.x + x * spacing) / this.blockSize), z: Math.round((tile.z + z * spacing) / this.blockSize),
        x0: Math.floor(minX / this.blockSize), x1: Math.floor(maxX / this.blockSize), z0: Math.floor(minZ / this.blockSize), z1: Math.floor(maxZ / this.blockSize) };
      record.large = (record.x1 - record.x0 + 1) * (record.z1 - record.z0 + 1) > 256;
      if (record.large) this.largeWarpBlocks.add(record);
      else for (let row = record.z0; row <= record.z1; row++) for (let col = record.x0; col <= record.x1; col++) {
        const key = keyOf(col, row);
        let cell = this.warpCells.get(key); if (!cell) this.warpCells.set(key, cell = new Set());
        cell.add(record);
      }
      records.push(record);
    }
    this.warpTiles.set(tileKey, records);
  }

  invalidate(tile, channels = TERRAIN_CHANGE.ALL, bounds) {
    if (!(channels & (TERRAIN_CHANGE.HEIGHT | TERRAIN_CHANGE.WARP))) return;
    const s = this.provider.sampleSpacing;
    for (const [key, block] of this.blocks) {
      const x = block.x * this.blockSize, z = block.z * this.blockSize;
      if (x < tile.x || x >= tile.x + tile.size || z < tile.z || z >= tile.z + tile.size) continue;
      if (bounds && (x > bounds.maxX + s || x + this.blockSize < bounds.minX - s || z > bounds.maxZ + s || z + this.blockSize < bounds.minZ - s)) continue;
      this.blocks.delete(key); this.stats.invalidatedBlocks++;
    }
    if (channels & TERRAIN_CHANGE.WARP) this.indexWarpTile(tile);
  }

  query(bounds, visit) {
    this.rock?.prepare();
    this.stamp++;
    const x0 = Math.floor(bounds.minX / this.blockSize), x1 = Math.floor(bounds.maxX / this.blockSize);
    const z0 = Math.floor(bounds.minZ / this.blockSize), z1 = Math.floor(bounds.maxZ / this.blockSize);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      this.visitBlock(x, z, bounds, visit);
      const cell = this.warpCells.get(keyOf(x, z));
      if (cell) for (const record of cell) this.visitBlock(record.x, record.z, bounds, visit);
    }
    for (const record of this.largeWarpBlocks) {
      if (record.x1 < x0 || record.x0 > x1 || record.z1 < z0 || record.z0 > z1) continue;
      this.visitBlock(record.x, record.z, bounds, visit);
    }
  }
  visitBlock(x, z, bounds, visit) {
    const block = this.getBlock(x, z);
    if (block.stamp === this.stamp) return;
    block.stamp = this.stamp; this.stats.candidateBlocks++;
    if (!overlaps(block, bounds)) return;
    const width = this.segments + 1;
    for (let row = 0; row < this.segments; row++) for (let col = 0; col < this.segments; col++) {
      if (this.rock?.isCovered((x * this.segments + col) * this.provider.sampleSpacing, (z * this.segments + row) * this.provider.sampleSpacing)) continue;
      const a = row * width + col, b = a + 1, c = a + width, d = c + 1;
      // Stable source triangle IDs are independent of cache lifetime and LOD.
      const id = keyOf(x * this.segments + col, z * this.segments + row) * 2;
      this.triangle(block.values, a, c, b, bounds, visit, id);
      this.triangle(block.values, b, c, d, bounds, visit, id + 1);
    }
  }
  triangle(values, a, b, c, bounds, visit, id) {
    this.a.fromArray(values, a * 3); this.b.fromArray(values, b * 3); this.c.fromArray(values, c * 3);
    if (Math.min(this.a.x, this.b.x, this.c.x) > bounds.maxX || Math.max(this.a.x, this.b.x, this.c.x) < bounds.minX
      || Math.min(this.a.y, this.b.y, this.c.y) > bounds.maxY || Math.max(this.a.y, this.b.y, this.c.y) < bounds.minY
      || Math.min(this.a.z, this.b.z, this.c.z) > bounds.maxZ || Math.max(this.a.z, this.b.z, this.c.z) < bounds.minZ) return;
    this.stats.triangles++; visit(this.a, this.b, this.c, this.object, id);
  }
  // Optional spawn placement query, not the movement solver. Finds the highest
  // walkable upward-facing triangle at XZ without consulting rendered patches.
  findSpawnSurface(x, z, target, maxSlopeAngle = 45, surface = this) {
    this.placementX = x; this.placementZ = z; this.placementTarget = target;
    this.placementMinNormal = Math.cos(maxSlopeAngle * Math.PI / 180); this.placementY = -Infinity;
    const bounds = this.placementBounds;
    bounds.minX = bounds.maxX = x; bounds.minZ = bounds.maxZ = z;
    surface.query(bounds, this.visitPlacement);
    return this.placementY > -Infinity ? target : null;
  }
  testPlacement(a, b, c) {
    const bx = b.x - a.x, bz = b.z - a.z, cx = c.x - a.x, cz = c.z - a.z;
    const denominator = bx * cz - bz * cx;
    if (Math.abs(denominator) < 1e-10) return;
    const x = this.placementX - a.x, z = this.placementZ - a.z;
    const u = (x * cz - z * cx) / denominator, v = (bx * z - bz * x) / denominator;
    if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) return;
    const by = b.y - a.y, cy = c.y - a.y;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const length = Math.hypot(nx, ny, nz);
    if (ny / length < this.placementMinNormal) return;
    const y = a.y + u * by + v * cy;
    if (y <= this.placementY) return;
    this.placementY = y; this.placementTarget.y = y;
    this.placementTarget.normal.set(nx / length, ny / length, nz / length);
  }
  dispose() {
    this.unsubscribe(); this.blocks.clear(); this.warpTiles.clear(); this.warpCells.clear(); this.largeWarpBlocks.clear();
  }
}
