import * as THREE from "three";
import { proceduralHeight } from "../terrain/TerrainHeight.js";
import { ROCK_APPEARANCE_GLSL } from "../engine/RockAppearance.js";
import { TERRAIN_CHANGE } from "../terrain/TerrainDataProvider.js";
import { rockCellCovered } from "../terrain/RockSurface.js";
import { createEnvironmentUniforms, ENVIRONMENT_GLSL } from "../engine/EnvironmentShader.js";

// Shell vertices retain authoritative authored height and warp independently
// of terrain texture residency. Bounds follow those same rendered positions.
const SHELL_CULLING_GUARD = .05;

function createShellMaterial(heightCache) {
  if (!heightCache) throw new Error("RockSurfaceShell requires TerrainHeightGpuCache.");
  return new THREE.ShaderMaterial({
    uniforms: {
      ...createEnvironmentUniforms(),
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
      ${ENVIRONMENT_GLSL}
      in vec3 vWorldPosition;
      out vec4 outColor;
      ${ROCK_APPEARANCE_GLSL}
      void main() {
        // Derivative normals face the visible side, including folded and
        // underside faces. Keep their direction: abs(dot) flattens the light.
        vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        vec3 color = environmentLightDisplayColor(shadeRock(vWorldPosition, normal, environmentDiffuse(normal)));
        outColor = vec4(environmentFog(color, vWorldPosition, false), 1.0);
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
  constructor(scene, provider, heightCache, { coverageThreshold = .035 } = {}) {
    this.provider = provider;
    this.heightCache = heightCache;
    this.coverageThreshold = coverageThreshold;
    this.scene = scene;
    this.material = createShellMaterial(heightCache);
    this.enabled = false;
    this.selectedTile = null;
    this.selectedCell = null;
    this.regionSeeds = new Map();
    this.chunkOrder = [];
    this.knownRockTileKeys = new Set();
    this.regionTileKeys = new Set();
    this.coverageTiles = new Map();
    this.dirtyTiles = new Set();
    this.chunks = new Map();
    this.dirty = false;
    this.sourceMask = null;
    this.cutoutReadyTileKeys = null;
    this.componentQueue = new Uint32Array(provider.tileSegments ** 2);
    this.stats = { tile: null, regions: 0, cells: 0, vertices: 0, triangles: 0, draws: 0,
      chunks: 0, rebuiltChunks: 0, sourceMaskTexels: 0, submittedChunks: 0, submittedTriangles: 0 };
    this.profile = { updateMs: 0, updatePeakMs: 0, geometryMs: 0, maskMs: 0, rebuiltChunks: 0 };
    this.unsubscribe = provider.onTileChanged((tile, channels = TERRAIN_CHANGE.ALL) => {
      const key = provider.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size));
      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.needsRebuild = true;
        if (this.enabled) {
          this.refreshChunkGeometry(chunk, tile);
          // Position changes do not alter source ownership. Missing/unknown
          // notification hints still take the conservative coverage check.
          if (!(channels & TERRAIN_CHANGE.ROCK_EXPOSURE) || this.coverageMatches(chunk, tile)) {
            chunk.signature = tile.revision + ":" + chunk.triangles * 3;
            return;
          }
        }
      }
      if (chunk || tile.rockExposure || this.selectedTile === key) this.markDirty(key);
    });
  }

  markDirty(key) { this.dirtyTiles.add(key); this.dirty = true; }

  selectAt(sourceX, sourceZ) {
    const coordinate = this.provider.worldToTile(sourceX, sourceZ);
    const key = this.provider.tileKey(coordinate.x, coordinate.z);
    const tile = this.provider.getTile(coordinate.x, coordinate.z, "rock-shell-sample");
    const x = Math.max(0, Math.min(tile.segments - 1, Math.floor((sourceX - tile.x) / tile.sampleSpacing)));
    const z = Math.max(0, Math.min(tile.segments - 1, Math.floor((sourceZ - tile.z) / tile.sampleSpacing)));
    this.selectedTile = key;
    this.selectedCell = { x, z };
    if (this.coverageTiles.get(key)?.coverage[z * tile.segments + x]) return false;
    this.regionSeeds.set(key + ":" + x + "," + z, { tileX: coordinate.x, tileZ: coordinate.z, x, z });
    this.markDirty(key);
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
      this.markDirty(key);
    }
    if (!this.dirty) return false;
    const started = performance.now();
    this.rebuild();
    this.dirty = this.dirtyTiles.size > 0;
    const elapsed = performance.now() - started;
    this.profile.updateMs += elapsed;
    this.profile.updatePeakMs = Math.max(this.profile.updatePeakMs, elapsed);
    return true;
  }

  rebuild() {
    const pending = new Set(this.dirtyTiles);
    this.dirtyTiles.clear();
    // Enabling, explicit refresh, or startup may require checking every owner.
    if (!pending.size) {
      for (const key of this.knownRockTileKeys) pending.add(key);
      for (const key of this.coverageTiles.keys()) pending.add(key);
      if (this.selectedTile) pending.add(this.selectedTile);
    }
    const records = new Map();
    const changedRects = [];
    let topologyChanged = false;
    for (const key of pending) {
      const [tx, tz] = key.split(",").map(Number);
      const tile = this.provider.getSampleTile(tx, tz, "rock-shell-region");
      if (!tile) continue;
      const segments = tile.segments, width = segments + 1;
      const old = this.coverageTiles.get(key);
      const coverage = new Uint8Array(segments ** 2);
      let count = 0, minX = segments, minZ = segments, maxX = -1, maxZ = -1;
      let left = segments, top = segments, right = -1, bottom = -1;
      for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
        const a = z * width + x, cell = z * segments + x;
        const present = rockCellCovered(tile, x, z, this.coverageThreshold);
        coverage[cell] = present ? 1 : 0;
        if (present) {
          count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        if (coverage[cell] !== (old?.coverage[cell] ?? 0)) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, z); bottom = Math.max(bottom, z);
        }
      }
      const changed = right >= left;
      const cellX = tx * segments, cellZ = tz * segments;
      if (changed) {
        topologyChanged = true;
        changedRects.push({ left: cellX + left, top: cellZ + top, right: cellX + right + 1, bottom: cellZ + bottom + 1 });
        if (count) {
          const state = { tx, tz, cellX, cellZ, segments, coverage, count,
            minX: cellX + minX, maxX: cellX + maxX, minZ: cellZ + minZ, maxZ: cellZ + maxZ };
          this.coverageTiles.set(key, state);
        } else {
          this.coverageTiles.delete(key);
        }
      }
      const chunk = this.chunks.get(key);
      if (!count) {
        if (chunk) { chunk.mesh.removeFromParent(); chunk.mesh.geometry.dispose(); this.chunks.delete(key); }
        continue;
      }
      if (!changed && chunk) {
        if (chunk.tileRevision !== tile.revision || chunk.needsRebuild) this.refreshChunkGeometry(chunk, tile);
        chunk.signature = tile.revision + ":" + count * 6;
      } else {
        records.set(key, { key, tile, cellCoverage: coverage, count, signature: tile.revision + ":" + count * 6,
          builder: null });
      }
      // Discover connected legacy owners not yet present in channel metadata.
      // No procedural tile is generated and no full tile is retained by state.
      const neighbours = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (let edge = 0; edge < 4; edge++) {
        let coveredEdge = false;
        for (let i = 0; i < segments && !coveredEdge; i++) {
          const index = edge === 0 ? i * segments : edge === 1 ? i * segments + segments - 1
            : edge === 2 ? i : (segments - 1) * segments + i;
          coveredEdge = Boolean(coverage[index]);
        }
        if (!coveredEdge) continue;
        const nx = tx + neighbours[edge][0], nz = tz + neighbours[edge][1], neighbourKey = this.provider.tileKey(nx, nz);
        if (this.knownRockTileKeys.has(neighbourKey) || pending.has(neighbourKey)) continue;
        const neighbour = this.provider.getSampleTile(nx, nz, "rock-shell-region");
        if (neighbour?.rockExposure) { this.knownRockTileKeys.add(neighbourKey); pending.add(neighbourKey); }
      }
    }
    if (topologyChanged) {
      this.regionTileKeys = new Set(this.coverageTiles.keys());
      this.stats.regions = this.updateCellOrder();
    }
    const orderedRecords = new Map();
    for (const key of this.chunkOrder) {
      const record = records.get(key);
      if (!record) continue;
      record.builder = this.buildChunkGeometry(record.tile, this.coverageTiles.get(key).order);
      orderedRecords.set(key, record);
    }
    const rebuiltChunks = this.syncChunks(orderedRecords);
    if (topologyChanged) {
      const started = performance.now();
      this.updateSourceMask(changedRects);
      this.profile.maskMs += performance.now() - started;
    }
    this.stats.cells = 0;
    for (const state of this.coverageTiles.values()) this.stats.cells += state.count;
    this.stats.vertices = 0; this.stats.triangles = 0;
    for (const chunk of this.chunks.values()) {
      this.stats.vertices += chunk.vertices; this.stats.triangles += chunk.triangles;
    }
    this.stats.tile = (this.selectedTile ?? "none") + " / " + this.coverageTiles.size + " tiles";
    this.stats.chunks = this.chunks.size;
    this.stats.rebuiltChunks = rebuiltChunks;
    this.stats.sourceMaskTexels = this.sourceMask?.texels ?? 0;
    this.profile.rebuiltChunks += rebuiltChunks;
  }

  updateCellOrder() {
    // Preserve legacy breadth-first triangle order at exact fold overlaps.
    // Coverage and visited flags are typed arrays; there are no per-cell
    // objects/string sets. Only changed owners receive new GPU geometry.
    const entries = [...this.coverageTiles.entries()], lookup = new Map();
    const size = this.provider.tileSegments, area = size * size;
    let cells = 0;
    for (let i = 0; i < entries.length; i++) {
      const [key, state] = entries[i];
      lookup.set(key, i); cells += state.count;
      state.order = new Uint32Array(state.count); state.orderCount = 0;
    }
    if (this.componentQueue.length < cells) this.componentQueue = new Uint32Array(cells);
    const queue = this.componentQueue, visited = new Uint8Array(entries.length * area);
    const neighbours = entries.map(([, state]) => [
      lookup.get(this.provider.tileKey(state.tx - 1, state.tz)) ?? -1,
      lookup.get(this.provider.tileKey(state.tx + 1, state.tz)) ?? -1,
      lookup.get(this.provider.tileKey(state.tx, state.tz - 1)) ?? -1,
      lookup.get(this.provider.tileKey(state.tx, state.tz + 1)) ?? -1,
    ]);
    let regions = 0;
    this.chunkOrder = [];
    const visit = (owner, first) => {
      if (visited[owner * area + first]) return;
      regions++;
      const state = entries[owner][1], sx = first % size, sz = Math.floor(first / size);
      this.regionSeeds.set(entries[owner][0] + ":" + sx + "," + sz, { tileX: state.tx, tileZ: state.tz, x: sx, z: sz });
      let head = 0, tail = 0;
      const enqueue = (index, cell) => {
        if (index < 0) return;
        const id = index * area + cell;
        if (visited[id] || !entries[index][1].coverage[cell]) return;
        visited[id] = 1; queue[tail++] = id;
      };
      enqueue(owner, first);
      while (head < tail) {
        const id = queue[head++], index = Math.floor(id / area), cell = id - index * area;
        const current = entries[index][1], x = cell % size, adjacent = neighbours[index];
        current.order[current.orderCount++] = cell;
        if (current.orderCount === 1) this.chunkOrder.push(entries[index][0]);
        enqueue(x > 0 ? index : adjacent[0], x > 0 ? cell - 1 : cell + size - 1);
        enqueue(x + 1 < size ? index : adjacent[1], x + 1 < size ? cell + 1 : cell - size + 1);
        enqueue(cell >= size ? index : adjacent[2], cell >= size ? cell - size : cell + area - size);
        enqueue(cell + size < area ? index : adjacent[3], cell + size < area ? cell + size : cell - area + size);
      }
    };
    // Snapshot before appending newly discovered component seeds, as before.
    for (const seed of [...this.regionSeeds.values()]) {
      const owner = lookup.get(this.provider.tileKey(seed.tileX, seed.tileZ));
      if (owner === undefined) continue;
      const coverage = entries[owner][1].coverage;
      let x = Math.max(0, Math.min(size - 1, seed.x)), z = Math.max(0, Math.min(size - 1, seed.z));
      if (!coverage[z * size + x]) {
        let distance = Infinity, nearest = -1;
        for (let cell = 0; cell < area; cell++) {
          if (!coverage[cell]) continue;
          const cx = cell % size, cz = Math.floor(cell / size), d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < distance) { distance = d; nearest = cell; }
        }
        if (distance === Infinity) continue;
        x = nearest % size; z = Math.floor(nearest / size);
      }
      visit(owner, z * size + x);
    }
    for (const key of this.knownRockTileKeys) {
      const owner = lookup.get(key);
      if (owner === undefined) continue;
      const state = entries[owner][1];
      for (let cell = 0; cell < area && state.orderCount < state.count; cell++) if (state.coverage[cell] && !visited[owner * area + cell]) visit(owner, cell);
    }
    return regions;
  }

  buildChunkGeometry(tile, order) {
    const started = performance.now();
    const width = tile.segments + 1;
    const lookup = new Int32Array(width ** 2); lookup.fill(-1);
    const builder = { positions: [], sourcePositions: [], sourceIndices: [], indices: [] };
    const add = (x, z) => {
      const index = z * width + x;
      if (lookup[index] !== -1) return lookup[index];
      const vertex = builder.sourceIndices.length;
      lookup[index] = vertex; builder.sourceIndices.push(index);
      const sourceX = tile.x + x * tile.sampleSpacing, sourceZ = tile.z + z * tile.sampleSpacing;
      builder.sourcePositions.push(sourceX, sourceZ);
      builder.positions.push(sourceX + (tile.warp?.[index * 2] ?? 0), tile.heights[index], sourceZ + (tile.warp?.[index * 2 + 1] ?? 0));
      return vertex;
    };
    for (const cell of order) {
      const x = cell % tile.segments, z = Math.floor(cell / tile.segments);
      builder.indices.push(add(x, z), add(x, z + 1), add(x + 1, z), add(x + 1, z), add(x, z + 1), add(x + 1, z + 1));
    }
    this.profile.geometryMs += performance.now() - started;
    return builder;
  }

  updateGeometryBounds(geometry) {
    geometry.computeBoundingBox();
    const sphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const box = geometry.boundingBox;
    const magnitude = Math.max(Math.abs(box.min.x), Math.abs(box.min.y), Math.abs(box.min.z),
      Math.abs(box.max.x), Math.abs(box.max.y), Math.abs(box.max.z));
    sphere.radius += Math.max(SHELL_CULLING_GUARD, magnitude * 1e-6);
    geometry.boundingSphere = sphere;
  }

  syncChunks(records) {
    let rebuilt = 0;
    for (const [key, record] of records) {
      let chunk = this.chunks.get(key);
      const { builder } = record;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(builder.positions, 3));
      geometry.setAttribute("sourcePosition", new THREE.Float32BufferAttribute(builder.sourcePositions, 2));
      const IndexAttribute = builder.positions.length / 3 <= 65535 ? THREE.Uint16BufferAttribute : THREE.Uint32BufferAttribute;
      geometry.setIndex(new IndexAttribute(builder.indices, 1));
      this.updateGeometryBounds(geometry);
      if (!chunk) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = "Rockify surface-shell chunk " + key;
        mesh.frustumCulled = true; mesh.renderOrder = 1;
        mesh.onBeforeRender = () => { this.stats.submittedChunks++; this.stats.submittedTriangles += chunk.triangles; };
        this.scene.add(mesh); chunk = { mesh }; this.chunks.set(key, chunk);
      } else { chunk.mesh.geometry.dispose(); chunk.mesh.geometry = geometry; }
      chunk.signature = record.signature;
      chunk.cellCoverage = record.cellCoverage;
      const SampleArray = record.tile.heights.length <= 65536 ? Uint16Array : Uint32Array;
      chunk.sourceIndices = new SampleArray(builder.sourceIndices);
      chunk.tileRevision = record.tile.revision; chunk.needsRebuild = false;
      chunk.vertices = builder.positions.length / 3; chunk.triangles = builder.indices.length / 3;
      chunk.mesh.visible = this.enabled;
      rebuilt++;
    }
    return rebuilt;
  }

  getStats() { return { ...this.stats, draws: [...this.chunks.values()].filter(chunk => chunk.mesh.visible).length, enabled: this.enabled }; }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { updateMs: 0, updatePeakMs: 0, geometryMs: 0, maskMs: 0, rebuiltChunks: 0 };
    return profile;
  }

  coverageMatches(chunk, tile) {
    const covered = chunk.cellCoverage;
    if (!covered || covered.length !== tile.segments ** 2) return false;
    const exposure = tile.rockExposure, width = tile.segments + 1;
    for (let z = 0; z < tile.segments; z++) for (let x = 0; x < tile.segments; x++) {
      const a = z * width + x;
      const present = rockCellCovered(tile, x, z, this.coverageThreshold);
      if (present !== Boolean(covered[z * tile.segments + x])) return false;
    }
    return true;
  }

  refreshChunkGeometry(chunk, tile) {
    const started = performance.now();
    const geometry = chunk.mesh.geometry, positions = geometry.getAttribute("position");
    const sources = geometry.getAttribute("sourcePosition").array;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const index = chunk.sourceIndices[vertex];
      positions.array[vertex * 3] = sources[vertex * 2] + (tile.warp?.[index * 2] ?? 0);
      positions.array[vertex * 3 + 1] = tile.heights[index];
      positions.array[vertex * 3 + 2] = sources[vertex * 2 + 1] + (tile.warp?.[index * 2 + 1] ?? 0);
    }
    positions.needsUpdate = true;
    this.updateGeometryBounds(geometry);
    chunk.tileRevision = tile.revision; chunk.needsRebuild = false;
    this.profile.geometryMs += performance.now() - started;
  }

  updateSourceMask(changedRects) {
    if (!this.coverageTiles.size) {
      this.sourceMask?.texture.dispose(); this.sourceMask = null; this.cutoutReadyTileKeys = null;
      return;
    }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, cells = 0;
    for (const state of this.coverageTiles.values()) {
      left = Math.min(left, state.minX); top = Math.min(top, state.minZ);
      right = Math.max(right, state.maxX + 1); bottom = Math.max(bottom, state.maxZ + 1); cells += state.count;
    }
    const spacing = this.provider.sampleSpacing;
    let mask = this.sourceMask, fresh = false;
    // Keep small empty borders to avoid resize churn, but release a large
    // allocation after undo/removal rather than retaining its peak extent.
    const shrink = mask && (right - left) * (bottom - top) * 2 < mask.texture.image.data.length;
    if (!mask || shrink || left < mask.cellX || top < mask.cellZ || right > mask.cellX + mask.texture.image.width || bottom > mask.cellZ + mask.texture.image.height) {
      const width = right - left, height = bottom - top;
      const texture = new THREE.DataTexture(new Uint8Array(width * height), width, height, THREE.RedFormat, THREE.UnsignedByteType);
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false; texture.unpackAlignment = 1; texture.needsUpdate = true;
      mask?.texture.dispose();
      mask = { kind: "source", texture, sourceData: new Uint8Array(width * height), coverageData: new Uint8Array(width * height),
        cellX: left, cellZ: top, minX: left * spacing, minZ: top * spacing, width: width * spacing, height: height * spacing,
        boundaryMargin: .5, cellSize: spacing, texels: 0, regionTexels: cells, dirtyRects: [] };
      this.sourceMask = mask; this.cutoutReadyTileKeys = null; fresh = true;
    }
    const { width, height } = mask.texture.image;
    const rects = fresh ? [{ left: mask.cellX, top: mask.cellZ, right: mask.cellX + width, bottom: mask.cellZ + height }] : changedRects;
    for (const rect of rects) {
      const x0 = Math.max(0, rect.left - mask.cellX), x1 = Math.min(width, rect.right - mask.cellX);
      const z0 = Math.max(0, rect.top - mask.cellZ), z1 = Math.min(height, rect.bottom - mask.cellZ);
      for (let z = z0; z < z1; z++) mask.coverageData.fill(0, z * width + x0, z * width + x1);
      for (const state of this.coverageTiles.values()) {
        const sx = state.cellX - mask.cellX, sz = state.cellZ - mask.cellZ;
        const a = Math.max(x0, sx), b = Math.min(x1, sx + state.segments);
        if (a >= b) continue;
        for (let z = Math.max(z0, sz); z < Math.min(z1, sz + state.segments); z++) {
          const offset = (z - sz) * state.segments;
          mask.coverageData.set(state.coverage.subarray(offset + a - sx, offset + b - sx), z * width + a);
        }
      }
    }
    for (const rect of rects) {
      const x0 = Math.max(0, rect.left - mask.cellX - 1), x1 = Math.min(width, rect.right - mask.cellX + 1);
      const z0 = Math.max(0, rect.top - mask.cellZ - 1), z1 = Math.min(height, rect.bottom - mask.cellZ + 1);
      let changed = false;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
        const index = z * width + x, coverage = mask.coverageData;
        const value = coverage[index] && x > 0 && x + 1 < width && z > 0 && z + 1 < height
          && coverage[index - 1] && coverage[index + 1] && coverage[index - width] && coverage[index + width] ? 255 : 0;
        const old = mask.sourceData[index];
        if (old !== value) { mask.texels += value ? 1 : -1; mask.sourceData[index] = value; changed = true; }
      }
      if (changed) mask.dirtyRects.push({ left: x0, top: z0, right: x1, bottom: z1 });
    }
    mask.regionTexels = cells;
  }

  // Readiness is independent of camera culling and terrain GPU residency.
  // Publish only cells whose authored mesh exists. Unchanged frames do no upload.
  syncCoverage() {
    this.stats.submittedChunks = 0; this.stats.submittedTriangles = 0;
    const ready = new Set();
    for (const [key, chunk] of this.chunks) {
      const represented = this.enabled && !chunk.needsRebuild;
      chunk.mesh.visible = represented;
      if (represented) ready.add(key);
    }
    const mask = this.sourceMask;
    if (!mask) return;
    const { width, height, data } = mask.texture.image;
    const readinessChanged = !this.cutoutReadyTileKeys || this.cutoutReadyTileKeys.size !== ready.size
      || [...ready].some(key => !this.cutoutReadyTileKeys.has(key));
    const rects = readinessChanged ? [{ left: 0, top: 0, right: width, bottom: height }] : mask.dirtyRects;
    if (!rects.length) return;
    for (const rect of rects) {
      for (let z = rect.top; z < rect.bottom; z++) data.fill(0, z * width + rect.left, z * width + rect.right);
      for (const key of ready) {
        const state = this.coverageTiles.get(key);
        if (!state) continue;
        const sx = state.cellX - mask.cellX, sz = state.cellZ - mask.cellZ;
        const left = Math.max(rect.left, sx), right = Math.min(rect.right, sx + state.segments);
        if (left >= right) continue;
        for (let z = Math.max(rect.top, sz); z < Math.min(rect.bottom, sz + state.segments); z++) {
          const start = z * width + left, end = z * width + right;
          data.set(mask.sourceData.subarray(start, end), start);
        }
      }
    }
    mask.texture.needsUpdate = true; mask.dirtyRects.length = 0; this.cutoutReadyTileKeys = ready;
  }

  getSourceMask() { return this.enabled ? this.sourceMask : null; }

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
    this.coverageTiles.clear(); this.dirtyTiles.clear();
    this.regionSeeds.clear(); this.chunkOrder.length = 0;
    this.material.dispose();
    this.sourceMask?.texture.dispose();
  }
}
