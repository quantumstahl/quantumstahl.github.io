import * as THREE from "three";
import { proceduralHeight } from "../terrain/TerrainHeight.js";
import { ROCK_APPEARANCE_GLSL } from "../engine/RockAppearance.js";

// Shell vertices retain authoritative authored height and warp independently
// of terrain texture residency. Bounds follow those same rendered positions.
const SHELL_CULLING_GUARD = 128;

function createShellMaterial(heightCache) {
  if (!heightCache) throw new Error("RockSurfaceShell requires TerrainHeightGpuCache.");
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDirection: { value: new THREE.Vector3(-.45, .78, .42).normalize() },
    },
    glslVersion: THREE.GLSL3,
    vertexShader: `
      out vec3 vWorldPosition;
      void main() {
        // Position is the complete authored snapshot, including XZ warp.
        // Never substitute a coarser height field into this detailed mesh.
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 uLightDirection;
      in vec3 vWorldPosition;
      out vec4 outColor;
      ${ROCK_APPEARANCE_GLSL}
      void main() {
        // Derivative normals face the visible side, including folded and
        // underside faces. Keep their direction: abs(dot) flattens the light.
        vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        outColor = vec4(shadeRock(vWorldPosition, normal, uLightDirection), 1.0);
      }`,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

// Detailed authored Rockify surfaces, partitioned into terrain-data-sized
// chunks. Every discovered component owns its emitted source cells.
export class RockSurfaceShell {
  constructor(scene, provider, heightCache, {
    coverageThreshold = .035,
  } = {}) {
    this.provider = provider;
    this.heightCache = heightCache;
    this.coverageThreshold = coverageThreshold;
    this.selectedTile = null;
    this.selectedCell = null;
    this.regionSeeds = new Map();
    this.regionCellKeys = new Set();
    this.regionTileKeys = new Set();
    this.knownRockTileKeys = new Set();
    this.dirty = false;
    this.enabled = false;
    this.sourceMask = null;
    this.cutoutReadyTileKeys = null;
    this.material = createShellMaterial(heightCache);
    this.scene = scene;
    this.chunkSize = provider.tileSize;
    this.chunks = new Map();
    this.stats = { tile: null, regions: 0, cells: 0, vertices: 0, triangles: 0, draws: 0, chunks: 0, rebuiltChunks: 0, sourceMaskTexels: 0 };

    this.unsubscribe = provider.onTileChanged(tile => {
      const key = provider.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size));
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.needsRebuild = true;
        if (this.enabled) {
          this.refreshChunkGeometry(chunk, tile);
          // Height/warp edits already updated the exact rendered vertices.
          // Only a changed source-cell footprint needs region discovery,
          // triangulation, and a new cutout texture. Keep any OTHER pending
          // topology work dirty; this tile must not cancel a previous edit.
          if (this.coverageMatches(chunk, tile)) {
            chunk.signature = `${tile.revision}:${chunk.triangles * 3}`;
            return;
          }
        }
      }
      if (this.selectedTile === key || this.regionTileKeys.has(key) || tile.rockExposure) this.dirty = true;
    });
  }

  selectAt(sourceX, sourceZ) {
    const coordinate = this.provider.worldToTile(sourceX, sourceZ);
    const key = this.provider.tileKey(coordinate.x, coordinate.z);
    const tile = this.provider.getTile(coordinate.x, coordinate.z, "rock-shell-sample");
    const cellX = Math.max(0, Math.min(tile.segments - 1, Math.floor((sourceX - tile.x) / tile.sampleSpacing)));
    const cellZ = Math.max(0, Math.min(tile.segments - 1, Math.floor((sourceZ - tile.z) / tile.sampleSpacing)));
    const sourceCellKey = `${coordinate.x},${coordinate.z}:${cellX},${cellZ}`;
    this.selectedTile = key;
    this.selectedCell = { x: cellX, z: cellZ };
    // Existing connected shell cells are already represented by a seed. A
    // click within one must not add another full region scan every stroke.
    if (this.regionCellKeys.has(sourceCellKey)) return false;
    this.regionSeeds.set(sourceCellKey, { tileX: coordinate.x, tileZ: coordinate.z, x: cellX, z: cellZ });
    this.dirty = true;
    return true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const chunk of this.chunks.values()) chunk.mesh.visible = enabled;
    if (enabled) this.dirty = true;
  }

  update() {
    if (!this.enabled) return false;
    for (const key of this.provider.rockExposureTileKeys) {
      if (this.knownRockTileKeys.has(key)) continue;
      this.knownRockTileKeys.add(key);
      this.dirty = true;
    }
    if (!this.dirty) return false;
    this.rebuild();
    this.dirty = false;
    return true;
  }

  rebuild() {
    const tileMap = new Map();
    const getTile = (tileX, tileZ) => {
      const key = this.provider.tileKey(tileX, tileZ);
      let tile = tileMap.get(key);
      if (!tile) {
        tile = this.provider.getSampleTile(tileX, tileZ, "rock-shell-region");
        tileMap.set(key, tile);
      }
      return tile;
    };
    const isCovered = (tile, x, z) => {
      if (!tile) return false;
      const width = tile.segments + 1;
      const a = z * width + x, b = a + 1, c = a + width, d = c + 1;
      return Math.max(
        Math.abs(tile.rockExposure?.[a] ?? 0), Math.abs(tile.rockExposure?.[b] ?? 0),
        Math.abs(tile.rockExposure?.[c] ?? 0), Math.abs(tile.rockExposure?.[d] ?? 0),
      ) >= this.coverageThreshold;
    };
    const cellKey = (tileX, tileZ, x, z) => `${tileX},${tileZ}:${x},${z}`;
    const neighbour = (cell, direction) => {
      const { tileX, tileZ, x, z, tile } = cell;
      if (direction === 0) return x > 0 ? { tileX, tileZ, x: x - 1, z, tile } : { tileX: tileX - 1, tileZ, x: tile.segments - 1, z, tile: getTile(tileX - 1, tileZ) };
      if (direction === 1) return x + 1 < tile.segments ? { tileX, tileZ, x: x + 1, z, tile } : { tileX: tileX + 1, tileZ, x: 0, z, tile: getTile(tileX + 1, tileZ) };
      if (direction === 2) return z > 0 ? { tileX, tileZ, x, z: z - 1, tile } : { tileX, tileZ: tileZ - 1, x, z: tile.segments - 1, tile: getTile(tileX, tileZ - 1) };
      return z + 1 < tile.segments ? { tileX, tileZ, x, z: z + 1, tile } : { tileX, tileZ: tileZ + 1, x, z: 0, tile: getTile(tileX, tileZ + 1) };
    };
    const region = [];
    const visited = new Set();
    let regionCount = 0;
    const shell = this;
    function* seeds() {
      yield* [...shell.regionSeeds.values()];
      // Discover every component in every known authored rock owner. Keep
      // one seed per component so CPU eviction cannot forget a built region.
      for (const key of shell.knownRockTileKeys) {
        const [tileX, tileZ] = key.split(",").map(Number);
        const tile = getTile(tileX, tileZ);
        if (!tile?.rockExposure) continue;
        for (let z = 0; z < tile.segments; z++) for (let x = 0; x < tile.segments; x++) {
          if (!visited.has(cellKey(tileX, tileZ, x, z)) && isCovered(tile, x, z)) yield { tileX, tileZ, x, z };
        }
      }
    }
    for (const seed of seeds()) {
      const initialTile = getTile(seed.tileX, seed.tileZ);
      if (!initialTile) continue;
      let seedX = Math.max(0, Math.min(initialTile.segments - 1, seed.x));
      let seedZ = Math.max(0, Math.min(initialTile.segments - 1, seed.z));
      if (!isCovered(initialTile, seedX, seedZ)) {
        let distance = Infinity;
        for (let z = 0; z < initialTile.segments; z += 1) for (let x = 0; x < initialTile.segments; x += 1) {
          if (!isCovered(initialTile, x, z)) continue;
          const nextDistance = (x - seedX) ** 2 + (z - seedZ) ** 2;
          if (nextDistance < distance) { distance = nextDistance; seedX = x; seedZ = z; }
        }
        if (!Number.isFinite(distance)) continue;
      }
      if (visited.has(cellKey(seed.tileX, seed.tileZ, seedX, seedZ))) continue;
      this.regionSeeds.set(cellKey(seed.tileX, seed.tileZ, seedX, seedZ), { tileX: seed.tileX, tileZ: seed.tileZ, x: seedX, z: seedZ });
      regionCount += 1;
      const queue = [{ tileX: seed.tileX, tileZ: seed.tileZ, x: seedX, z: seedZ, tile: initialTile }];
      for (let read = 0; read < queue.length; read += 1) {
        const cell = queue[read];
        const key = cellKey(cell.tileX, cell.tileZ, cell.x, cell.z);
        if (visited.has(key) || !isCovered(cell.tile, cell.x, cell.z)) continue;
        visited.add(key);
        region.push(cell);
        for (let direction = 0; direction < 4; direction += 1) queue.push(neighbour(cell, direction));
      }
    }
    const regionTileKeys = new Set(region.map(cell => this.provider.tileKey(cell.tileX, cell.tileZ)));
    const chunkRecords = new Map();
    const getChunkRecord = (tile, cellX, cellZ) => {
      const sourceX = tile.x + cellX * tile.sampleSpacing;
      const sourceZ = tile.z + cellZ * tile.sampleSpacing;
      const chunkX = Math.floor(sourceX / this.chunkSize);
      const chunkZ = Math.floor(sourceZ / this.chunkSize);
      const key = `${chunkX},${chunkZ}`;
      let record = chunkRecords.get(key);
      if (!record) {
        record = { key, tile, cells: [], cellCoverage: new Uint8Array(tile.segments ** 2) };
        chunkRecords.set(key, record);
      }
      return record;
    };
    const addVertex = (builder, tile, sampleX, sampleZ) => {
      const sourceX = tile.x + sampleX * tile.sampleSpacing;
      const sourceZ = tile.z + sampleZ * tile.sampleSpacing;
      const key = `${Math.round(sourceX / tile.sampleSpacing)},${Math.round(sourceZ / tile.sampleSpacing)}`;
      const existing = builder.vertexLookup.get(key);
      if (existing !== undefined) return existing;
      const sourceIndex = sampleZ * (tile.segments + 1) + sampleX;
      const result = builder.positions.length / 3;
      builder.vertexLookup.set(key, result);
      const warpOffset = sourceIndex * 2;
      builder.positions.push(
        sourceX + (tile.warp?.[warpOffset] ?? 0),
        // Keep height and warp from one authoritative source snapshot.
        tile.heights[sourceIndex],
        sourceZ + (tile.warp?.[warpOffset + 1] ?? 0),
      );
      builder.sourcePositions.push(sourceX, sourceZ);
      return result;
    };
    for (const { tile, x, z } of region) {
      // Source cells belong to one fixed 256 m terrain-data chunk. A shared
      // border vertex is duplicated only when a neighboring chunk needs it,
      // keeping every render chunk independently rebuildable.
      const record = getChunkRecord(tile, x, z);
      record.cells.push({ tile, x, z });
      record.cellCoverage[z * tile.segments + x] = 1;
    }
    for (const record of chunkRecords.values()) {
      // A fixed shell chunk maps to one terrain-data tile. Its revision
      // changes for any height/warp/exposure edit in that tile; index count
      // also captures a changed connected-region footprint.
      record.signature = `${record.tile.revision}:${record.cells.length * 6}`;
      if (this.chunks.get(record.key)?.signature === record.signature) continue;
      const builder = { positions: [], sourcePositions: [], indices: [], vertexLookup: new Map() };
      for (const { tile, x, z } of record.cells) {
        // Same winding as createPatchGeometry(): a,c,b and b,c,d.
        builder.indices.push(addVertex(builder, tile, x, z), addVertex(builder, tile, x, z + 1), addVertex(builder, tile, x + 1, z));
        builder.indices.push(addVertex(builder, tile, x + 1, z), addVertex(builder, tile, x, z + 1), addVertex(builder, tile, x + 1, z + 1));
      }
      record.builder = builder;
    }
    const rebuiltChunks = this.syncChunks(chunkRecords);
    this.sourceMask?.texture.dispose();
    this.sourceMask = region.length ? this.buildSourceMask(region) : null;
    this.cutoutReadyTileKeys = null;
    const vertices = [...this.chunks.values()].reduce((total, chunk) => total + chunk.vertices, 0);
    const triangles = [...this.chunks.values()].reduce((total, chunk) => total + chunk.triangles, 0);
    this.stats = {
      tile: `${this.selectedTile ?? "none"} / ${regionTileKeys.size} tiles`,
      regions: regionCount,
      cells: region.length,
      vertices,
      triangles,
      draws: this.enabled ? chunkRecords.size : 0,
      chunks: chunkRecords.size,
      rebuiltChunks,
      sourceMaskTexels: this.sourceMask?.texels ?? 0,
    };
    this.regionTileKeys = regionTileKeys;
    this.regionCellKeys = visited;
  }

  syncChunks(records) {
    let rebuilt = 0;
    for (const [key, chunk] of this.chunks) {
      if (records.has(key)) continue;
      chunk.mesh.removeFromParent();
      chunk.mesh.geometry.dispose();
      this.chunks.delete(key);
    }
    for (const [key, record] of records) {
      let chunk = this.chunks.get(key);
      if (chunk?.signature === record.signature) {
        chunk.tileRevision = record.tile.revision;
        chunk.needsRebuild = false;
        chunk.cellCoverage = record.cellCoverage;
        continue;
      }
      const { builder } = record;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(builder.positions, 3));
      geometry.setAttribute("sourcePosition", new THREE.Float32BufferAttribute(builder.sourcePositions, 2));
      geometry.setIndex(new THREE.Uint32BufferAttribute(builder.indices, 1));
      geometry.computeBoundingBox();
      const boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      boundingSphere.radius += SHELL_CULLING_GUARD;
      geometry.boundingSphere = boundingSphere;
      if (!chunk) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = `Rockify surface-shell chunk ${key}`;
        mesh.frustumCulled = true;
        mesh.renderOrder = 1;
        this.scene.add(mesh);
        chunk = { mesh, vertices: 0, triangles: 0 };
        this.chunks.set(key, chunk);
      } else {
        chunk.mesh.geometry.dispose();
        chunk.mesh.geometry = geometry;
      }
      chunk.signature = record.signature;
      chunk.cellCoverage = record.cellCoverage;
      chunk.tileRevision = record.tile.revision;
      chunk.needsRebuild = false;
      chunk.vertices = builder.positions.length / 3;
      chunk.triangles = builder.indices.length / 3;
      chunk.mesh.visible = this.enabled;
      rebuilt += 1;
    }
    return rebuilt;
  }

  getStats() { return { ...this.stats, draws: [...this.chunks.values()].filter(chunk => chunk.mesh.visible).length, enabled: this.enabled }; }

  coverageMatches(chunk, tile) {
    const covered = chunk.cellCoverage;
    if (!covered || covered.length !== tile.segments ** 2) return false;
    const exposure = tile.rockExposure, width = tile.segments + 1;
    for (let z = 0; z < tile.segments; z++) for (let x = 0; x < tile.segments; x++) {
      const a = z * width + x;
      const present = Math.max(Math.abs(exposure?.[a] ?? 0), Math.abs(exposure?.[a + 1] ?? 0), Math.abs(exposure?.[a + width] ?? 0), Math.abs(exposure?.[a + width + 1] ?? 0)) >= this.coverageThreshold;
      if (present !== Boolean(covered[z * tile.segments + x])) return false;
    }
    return true;
  }

  refreshChunkGeometry(chunk, tile) {
    const geometry = chunk.mesh.geometry;
    const positions = geometry.getAttribute("position");
    const sources = geometry.getAttribute("sourcePosition").array;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = sources[vertex * 2], z = sources[vertex * 2 + 1];
      const sx = Math.round((x - tile.x) / tile.sampleSpacing);
      const sz = Math.round((z - tile.z) / tile.sampleSpacing);
      const index = sz * (tile.segments + 1) + sx;
      positions.array[vertex * 3] = x + (tile.warp?.[index * 2] ?? 0);
      positions.array[vertex * 3 + 1] = tile.heights[index];
      positions.array[vertex * 3 + 2] = z + (tile.warp?.[index * 2 + 1] ?? 0);
    }
    positions.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.boundingSphere.radius += SHELL_CULLING_GUARD;
    chunk.tileRevision = tile.revision;
    chunk.needsRebuild = false;
  }

  // Ownership follows the actual authored mesh, independent of full/8 m/16 m
  // terrain residency. Position edits refresh that mesh before rendering;
  // new cells gain cutout only after rebuild has emitted their triangles.
  syncCoverage() {
    const ready = new Set();
    for (const [key, chunk] of this.chunks) {
      const represented = this.enabled && !chunk.needsRebuild;
      chunk.mesh.visible = represented;
      if (represented) ready.add(key);
    }
    if (!this.sourceMask) return;
    if (this.cutoutReadyTileKeys?.size === ready.size && [...ready].every(key => this.cutoutReadyTileKeys.has(key))) return;
    const mask = this.sourceMask;
    const { width, height, data } = mask.texture.image;
    data.fill(0);
    const tileSize = this.provider.tileSize;
    for (const key of ready) {
      const [x, z] = key.split(",").map(Number);
      const left = Math.max(0, Math.round((x * tileSize - mask.minX) / mask.cellSize));
      const right = Math.min(width, Math.round(((x + 1) * tileSize - mask.minX) / mask.cellSize));
      const top = Math.max(0, Math.round((z * tileSize - mask.minZ) / mask.cellSize));
      const bottom = Math.min(height, Math.round(((z + 1) * tileSize - mask.minZ) / mask.cellSize));
      for (let row = top; row < bottom; row++) {
        const start = row * width + left, end = row * width + right;
        data.set(mask.sourceData.subarray(start, end), start);
      }
    }
    mask.texture.needsUpdate = true;
    this.cutoutReadyTileKeys = ready;
  }

  // Exact source-grid ownership mask. Each enabled texel maps to one 2 m
  // source cell that emitted the two shell triangles above; unlike a world-XZ
  // footprint it has no ambiguity from XZ warp, folds, or overhangs.
  getSourceMask() { return this.enabled ? this.sourceMask : null; }

  buildSourceMask(region) {
    const spacing = this.provider.sampleSpacing;
    let minCellX = Infinity, maxCellX = -Infinity, minCellZ = Infinity, maxCellZ = -Infinity;
    const cells = [];
    const cellKeys = new Set();
    for (const cell of region) {
      const cellX = Math.round(cell.tile.x / spacing) + cell.x;
      const cellZ = Math.round(cell.tile.z / spacing) + cell.z;
      cells.push([cellX, cellZ]);
      cellKeys.add(`${cellX},${cellZ}`);
      minCellX = Math.min(minCellX, cellX); maxCellX = Math.max(maxCellX, cellX);
      minCellZ = Math.min(minCellZ, cellZ); maxCellZ = Math.max(maxCellZ, cellZ);
    }
    const width = maxCellX - minCellX + 1;
    const height = maxCellZ - minCellZ + 1;
    const data = new Uint8Array(width * height);
    let texels = 0;
    for (const [cellX, cellZ] of cells) {
      // Leave a one-cell source-space overlap at the outer boundary. The
      // fixed shell still owns these triangles, but the regular terrain is
      // retained immediately beneath/around its perimeter. This avoids tiny
      // sky slivers when a coarse quadtree patch interpolates across the
      // shell boundary, without using warped world-XZ coordinates or masking
      // any cell outside the generated shell region.
      const hasAllCardinalNeighbours =
        cellKeys.has(`${cellX - 1},${cellZ}`) &&
        cellKeys.has(`${cellX + 1},${cellZ}`) &&
        cellKeys.has(`${cellX},${cellZ - 1}`) &&
        cellKeys.has(`${cellX},${cellZ + 1}`);
      if (!hasAllCardinalNeighbours) continue;
      data[(cellZ - minCellZ) * width + cellX - minCellX] = 255;
      texels += 1;
    }
    // Start with no ownership. syncCoverage publishes only existing, current
    // authored shell chunks, independent of terrain texture residency.
    const texture = new THREE.DataTexture(new Uint8Array(data.length), width, height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return {
      kind: "source", texture, sourceData: data,
      minX: minCellX * spacing, minZ: minCellZ * spacing,
      width: width * spacing, height: height * spacing,
      // This only expands the retained interior cutout into its existing
      // one-cell guard; it never reaches the shell's outer source boundary.
      // Keeping it in source metres makes the result independent of patch LOD.
      boundaryMargin: .5,
      cellSize: spacing, texels, regionTexels: cells.length,
    };
  }

  // A small diagnostic for the surface-shell experiment. The terrain shader
  // only sees a source tile when it is resident in TerrainHeightGpuCache;
  // checking a few representative samples distinguishes a true generator
  // mismatch from a cache/LOD representation mismatch without a full scan.
  getGpuCacheStatus(cache) {
    if (!this.selectedTile) return { state: "no tile" };
    const layer = cache.keyToLayer.get(this.selectedTile);
    if (layer === undefined) return { state: "unmapped" };
    const [tileX, tileZ] = this.selectedTile.split(",").map(Number);
    const tile = this.provider.getTile(tileX, tileZ, "rock-shell-refresh");
    const width = tile.segments + 1;
    const samples = [0, tile.segments, tile.segments * width, width * width - 1, Math.floor(width * width * .5)];
    let maxHeightDeltaError = 0;
    let maxWarpError = 0;
    for (const index of samples) {
      const x = index % width;
      const z = Math.floor(index / width);
      const expectedDelta = tile.heights[index] - proceduralHeight(tile.x + x * tile.sampleSpacing, tile.z + z * tile.sampleSpacing);
      const cachedDelta = cache.data[layer * cache.samplesPerTile + index];
      maxHeightDeltaError = Math.max(maxHeightDeltaError, Math.abs(expectedDelta - cachedDelta));
      const offset = index * 2;
      const cachedOffset = layer * cache.samplesPerTile * 2 + offset;
      maxWarpError = Math.max(
        maxWarpError,
        Math.abs((tile.warp?.[offset] ?? 0) - cache.warpData[cachedOffset]),
        Math.abs((tile.warp?.[offset + 1] ?? 0) - cache.warpData[cachedOffset + 1]),
      );
    }
    return { state: `L${layer}`, maxHeightDeltaError, maxWarpError };
  }

  dispose() {
    this.unsubscribe?.();
    for (const chunk of this.chunks.values()) {
      chunk.mesh.removeFromParent();
      chunk.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.material.dispose();
    this.sourceMask?.texture.dispose();
  }
}
