import * as THREE from "three";

const MAX_TEXTURE_LAYERS = 8;

// Renders only terrain tiles that are currently streamed by WorldChunkStore.
// A tile owns its local vertex arrays, so unloading it releases its geometry.
export class ChunkedTerrain {
  constructor(scene, { chunkSize = 50 } = {}) {
    this.scene = scene;
    this.chunkSize = chunkSize;
    this.root = new THREE.Group();
    this.root.name = "Streamed terrain chunks";
    this.scene.add(this.root);
    this.tiles = new Map();
    this.config = null;
    this.material = null;
    this.textureLoader = new THREE.TextureLoader();
    this.textures = new Map();
    this.placeholderTexture = new THREE.Texture();
    this.cliffTexture = this.textureLoader.load("assets/rockrock.png");
    this.cliffTexture.colorSpace = THREE.SRGBColorSpace;
    this.cliffTexture.wrapS = this.cliffTexture.wrapT = THREE.RepeatWrapping;
    this.cliffTexture.anisotropy = 8;
    this.time = 0;
    this.sun= 0.84375;
    this.tint=new THREE.Color(0.00, 0.00, 0.00);
  }

  key(x, z) { return `${x},${z}`; }

  applyManifest(config) {
    this.config = config;
    this.chunkSize = config.chunkSize ?? this.chunkSize;
    this.material?.dispose();
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      

        toneMapped :false
    });
    // Sky.addBackgroundFadeToMaterial uses this marker to blend the terrain's
    // outer-edge fade with the captured sky background.
    this.material.userData.terrainOuterBackgroundFade = true;
    this.configureTextureBlend(this.material);
    this.loadTextures(config.textures);
  }

  createTileData(x, z) {
    const resolution = this.config?.resolution ?? 50;
    const count = (resolution + 1) ** 2;
    return {
      version: 1,
      x,
      z,
      terrain: {
        heights: Array(count).fill(0),
        colors: Array(count).fill(this.config?.color ?? 0x638450),
        masks: []
      },
      grass: { points: [] },
      objects: []
    };
  }

  loadChunk(chunk) {
    const x = Number(chunk.x) || 0;
    const z = Number(chunk.z) || 0;
    const key = this.key(x, z);
    this.unloadChunk(x, z);

    const resolution = this.config?.resolution ?? 50;
    const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute("position");
    const count = positions.count;
    chunk.terrain ??= {};
    chunk.terrain.heights ??= [];
    chunk.terrain.colors ??= [];
    chunk.terrain.masks ??= [];
    while (chunk.terrain.heights.length < count) chunk.terrain.heights.push(0);
    while (chunk.terrain.colors.length < count) chunk.terrain.colors.push(this.config?.color ?? 0x638450);
    const heights = chunk.terrain.heights;
    const colors = chunk.terrain.colors;
    const masks = chunk.terrain?.masks ?? [];
    const colorAttribute = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    const color = new THREE.Color();
    const fallback = this.config?.color ?? 0x638450;

    for (let index = 0; index < count; index++) {
      positions.setY(index, Number(heights[index]) || 0);
      color.setHex(Number(colors[index]) || fallback);
      colorAttribute.setXYZ(index, color.r, color.g, color.b);
    }
    geometry.setAttribute("color", colorAttribute);
    geometry.setAttribute("terrainDecorative", new THREE.BufferAttribute(
      Float32Array.from({ length: count }, () => chunk._decorative ? 1 : 0), 1
    ));
    const decorativeEdges = chunk._decorativeEdges ?? [0, 0, 0, 0];
    geometry.setAttribute("terrainDecorativeEdges", new THREE.BufferAttribute(
      Float32Array.from({ length: count * 4 }, (_, index) => decorativeEdges[index % 4]), 4
    ));
    const decorativeCorners = chunk._decorativeCorners ?? [0, 0, 0, 0];
    geometry.setAttribute("terrainDecorativeCorners", new THREE.BufferAttribute(
      Float32Array.from({ length: count * 4 }, (_, index) => decorativeCorners[index % 4]), 4
    ));
const decorativeOuterEdges =
    chunk._decorativeOuterEdges ?? [0, 0, 0, 0];
    const decorativeOuterCorners = chunk._decorativeOuterCorners ?? [0, 0, 0, 0];
    const decorativeOuterBoundary = decorativeOuterEdges.map((edge, index) => edge + decorativeOuterCorners[index] * 2);

    geometry.setAttribute(
        "terrainDecorativeOuterEdges",
        new THREE.BufferAttribute(
            Float32Array.from(
                { length: count * 4 },
                (_, index) => decorativeOuterBoundary[index % 4]
            ),
            4
        )
    );


    for (let layer = 0; layer < MAX_TEXTURE_LAYERS; layer++) {
      const values = masks[layer] ?? [];
      geometry.setAttribute(`terrainTextureMask${layer}`, new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, index) => Number(values[index]) || 0), 1));
    }
    positions.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `Terrain ${x},${z}`;
    mesh.position.set(x * this.chunkSize + this.chunkSize * .5, 0, z * this.chunkSize + this.chunkSize * .5);
    mesh.receiveShadow = true;
    mesh.userData.chunk = chunk;
    this.root.add(mesh);
    this.tiles.set(key, { chunk, mesh });
   // this.updateCliffWall(chunk);
    // BufferGeometry only derives normals from triangles in its own mesh.
    // Refresh this tile and its loaded neighbours with shared height samples
    // so a continuous terrain surface does not get a dark lighting seam at
    // chunk borders.
    this.refreshNormalsAround(x, z);
    return mesh;
  }

  updateCliffWall(chunk) {
    const tile = this.tiles.get(this.key(chunk.x, chunk.z));
    if (!tile) return null;
    const oldWall = tile.mesh.userData.cliffWall;
    if (oldWall) {
      oldWall.removeFromParent();
      oldWall.geometry.dispose();
      oldWall.material.dispose();
      tile.mesh.userData.cliffWall = null;
    }

    const bottoms = chunk.terrain?.cliffEdges ?? [];
    const diagonalCorners = chunk._decorativeCorners ?? [0, 0, 0, 0];
    const hasCliffEdges = bottoms.some(edge => edge?.some(Number.isFinite));
    if (!hasCliffEdges && !diagonalCorners.some(Boolean)) return null;

    const resolution = this.config?.resolution ?? 50;
    const width = resolution + 1;
    const cliffApron = 1.25;
    const terrainPositions = tile.mesh.geometry.getAttribute("position");
    const terrainHeightAt = (localX, localZ) => {
      const step = this.chunkSize / resolution;
      const gridX = THREE.MathUtils.clamp((localX + this.chunkSize * .5) / step, 0, resolution);
      const gridZ = THREE.MathUtils.clamp((localZ + this.chunkSize * .5) / step, 0, resolution);
      const x0 = Math.floor(gridX), z0 = Math.floor(gridZ);
      const x1 = Math.min(resolution, x0 + 1), z1 = Math.min(resolution, z0 + 1);
      const tx = gridX - x0, tz = gridZ - z0;
      const heightAt = (x, z) => terrainPositions.getY(z * width + x);
      return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(heightAt(x0, z0), heightAt(x1, z0), tx),
        THREE.MathUtils.lerp(heightAt(x0, z1), heightAt(x1, z1), tx),
        tz
      );
    };
    const vertices = [], uvs = [];
    const addQuad = (bottomA, bottomB, topIndexA, topIndexB) => {
      const ax = terrainPositions.getX(topIndexA), az = terrainPositions.getZ(topIndexA), topA = terrainPositions.getY(topIndexA);
      const bx = terrainPositions.getX(topIndexB), bz = terrainPositions.getZ(topIndexB), topB = terrainPositions.getY(topIndexB);
      vertices.push(ax, bottomA, az, bx, bottomB, bz, bx, topB, bz, ax, bottomA, az, bx, topB, bz, ax, topA, az);
      const useX = Math.abs(bx - ax) >= Math.abs(bz - az);
      const uA = (useX ? ax : az) * 0.35, uB = (useX ? bx : bz) * 0.35;
      const vBottomA = bottomA * 0.35, vBottomB = bottomB * 0.35, vTopA = topA * 0.35, vTopB = topB * 0.35;
      uvs.push(uA, vBottomA, uB, vBottomB, uB, vTopB, uA, vBottomA, uB, vTopB, uA, vTopA);
    };
    const addTopCap = (topIndexA, topIndexB, offsetX, offsetZ) => {
      const ax = terrainPositions.getX(topIndexA), az = terrainPositions.getZ(topIndexA), topA = terrainPositions.getY(topIndexA);
      const bx = terrainPositions.getX(topIndexB), bz = terrainPositions.getZ(topIndexB), topB = terrainPositions.getY(topIndexB);
      vertices.push(ax, topA, az, bx, topB, bz, bx + offsetX, topB, bz + offsetZ, ax, topA, az, bx + offsetX, topB, bz + offsetZ, ax + offsetX, topA, az + offsetZ);
      const useX = Math.abs(bx - ax) >= Math.abs(bz - az);
      const uA = (useX ? ax : az) * 0.35, uB = (useX ? bx : bz) * 0.35;
      uvs.push(uA, 0, uB, 0, uB, cliffApron * 0.35, uA, 0, uB, cliffApron * 0.35, uA, cliffApron * 0.35);
      // Close the decorative-side edge of the cap down to the actual terrain
      // surface, so the wider ledge never appears to float above the ground.
      const innerAx = ax + offsetX, innerAz = az + offsetZ;
      const innerBx = bx + offsetX, innerBz = bz + offsetZ;
      const groundA = terrainHeightAt(innerAx, innerAz), groundB = terrainHeightAt(innerBx, innerBz);
      vertices.push(innerAx, groundA, innerAz, innerBx, groundB, innerBz, innerBx, topB, innerBz, innerAx, groundA, innerAz, innerBx, topB, innerBz, innerAx, topA, innerAz);
      uvs.push(uA, groundA * 0.35, uB, groundB * 0.35, uB, topB * 0.35, uA, groundA * 0.35, uB, topB * 0.35, uA, topA * 0.35);
    };
    const addEdge = (edge, indexAt, capOffsetX, capOffsetZ) => {
      const values = bottoms[edge];
      if (!Array.isArray(values)) return;
      for (let step = 0; step < resolution; step++) {
        // `null` marks a non-cliff chunk edge. Do not coerce it to zero,
        // otherwise every decorative-to-decorative seam becomes a wall.
        if (!Number.isFinite(values[step]) || !Number.isFinite(values[step + 1])) continue;
        const bottomA = Number(values[step]), bottomB = Number(values[step + 1]);
        addQuad(bottomA, bottomB, indexAt(step), indexAt(step + 1));
        addTopCap(indexAt(step), indexAt(step + 1), capOffsetX, capOffsetZ);
      }
    };
    // The face stays vertical at the playable boundary. Only the rocky crest
    // widens inward, creating a natural bare ledge before the grass starts.
    addEdge(0, z => z * width, cliffApron, 0);
    addEdge(1, z => z * width + resolution, -cliffApron, 0);
    addEdge(2, x => resolution * width + x, 0, -cliffApron);
    addEdge(3, x => x, 0, cliffApron);
    // At a playable-chunk corner, the two perpendicular cap strips leave a
    // triangular opening on their decorative-side backs. Bridge it with a
    // rock cap and a rear face down to the local terrain.
    const addCorner = (edgeA, sampleA, offsetAX, offsetAZ, edgeB, sampleB, offsetBX, offsetBZ, topIndex) => {
      if (!Number.isFinite(bottoms[edgeA]?.[sampleA]) || !Number.isFinite(bottoms[edgeB]?.[sampleB])) return;
      const x = terrainPositions.getX(topIndex), z = terrainPositions.getZ(topIndex), top = terrainPositions.getY(topIndex);
      const ax = x + offsetAX, az = z + offsetAZ, bx = x + offsetBX, bz = z + offsetBZ;
      const cx = x + offsetAX + offsetBX, cz = z + offsetAZ + offsetBZ;
      const base = (Number(bottoms[edgeA][sampleA]) + Number(bottoms[edgeB][sampleB])) * .5;
      const groundA = terrainHeightAt(ax, az), groundB = terrainHeightAt(bx, bz), groundC = terrainHeightAt(cx, cz);
      const pushQuad = (a, b, c, d) => {
        vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      };
      const topO = [x, top, z], topA = [ax, top, az], topB = [bx, top, bz], topC = [cx, top, cz];
      const bottomO = [x, base, z], bottomA = [ax, groundA, az], bottomB = [bx, groundB, bz], bottomC = [cx, groundC, cz];
      // Solid four-sided cap: it overlaps the strips slightly, but prevents
      // any diagonal hole where the two cliff backs meet.
      pushQuad(topO, topA, topC, topB);
      pushQuad(topA, bottomA, bottomC, topC);
      pushQuad(topB, topC, bottomC, bottomB);
      pushQuad(topO, bottomO, bottomA, topA);
      pushQuad(topO, topB, bottomB, bottomO);
      pushQuad(bottomO, bottomB, bottomC, bottomA);
    };
    // The diagonal decorative tile owns the final connector where two wall
    // chunks meet around a playable corner. Build a solid rock corner there.
    const heightInTile = (chunkX, chunkZ, index) => {
      const neighbour = this.tiles.get(this.key(chunkX, chunkZ));
      return neighbour ? neighbour.mesh.geometry.getAttribute("position").getY(index) : null;
    };
    const addDiagonalCorner = (flag, topIndex, offsetAX, offsetAZ, offsetBX, offsetBZ, sources) => {
      if (!diagonalCorners[flag]) return;
      const top = Math.max(...sources.map(([x, z, index]) => heightInTile(chunk.x + x, chunk.z + z, index)).filter(Number.isFinite));
      if (!Number.isFinite(top)) return;
      // This connector has to overlap the two 1.25m wall caps from its
      // diagonal tile. A wider single owner avoids both the corner gap and
      // the z-fighting caused by two independent corner caps.
      offsetAX *= 2.0; offsetAZ *= 2.0; offsetBX *= 2.0; offsetBZ *= 2.0;
      const x = terrainPositions.getX(topIndex), z = terrainPositions.getZ(topIndex);
      const ax = x + offsetAX, az = z + offsetAZ, bx = x + offsetBX, bz = z + offsetBZ, cx = x + offsetAX + offsetBX, cz = z + offsetAZ + offsetBZ;
      const pushQuad = (a, b, c, d) => {
        vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
        uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      };
      const topO = [x, top, z], topA = [ax, top, az], topB = [bx, top, bz], topC = [cx, top, cz];
      const bottomO = [x, terrainHeightAt(x, z), z], bottomA = [ax, terrainHeightAt(ax, az), az], bottomB = [bx, terrainHeightAt(bx, bz), bz], bottomC = [cx, terrainHeightAt(cx, cz), cz];
      pushQuad(topO, topA, topC, topB);
      pushQuad(topA, bottomA, bottomC, topC);
      pushQuad(topB, topC, bottomC, bottomB);
      pushQuad(topO, bottomO, bottomA, topA);
      pushQuad(topO, topB, bottomB, bottomO);
      pushQuad(bottomO, bottomB, bottomC, bottomA);
    };
    addDiagonalCorner(0, resolution * width, cliffApron, 0, 0, -cliffApron, [[-1, 0, resolution * width + resolution], [0, 1, 0]]);
    addDiagonalCorner(1, resolution * width + resolution, -cliffApron, 0, 0, -cliffApron, [[1, 0, resolution * width], [0, 1, resolution]]);
    addDiagonalCorner(2, 0, cliffApron, 0, 0, cliffApron, [[-1, 0, resolution], [0, -1, resolution * width]]);
    addDiagonalCorner(3, resolution, -cliffApron, 0, 0, cliffApron, [[1, 0, 0], [0, -1, resolution * width + resolution]]);
    if (!vertices.length) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    // Basic material keeps the rock face readable even under the night sky,
    // where a Lambert wall with no direct light would render nearly black.
    const material = new THREE.MeshBasicMaterial({ map: this.cliffTexture, color: 0xffffff, side: THREE.DoubleSide, fog: true, toneMapped: false });
    const cliffUniforms = { usun: { value: this.sun }, utint: { value: this.tint.clone() } };
    material.onBeforeCompile = shader => {
      shader.uniforms.usun = cliffUniforms.usun;
      shader.uniforms.utint = cliffUniforms.utint;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float usun;\nuniform vec3 utint;")
        // Map sampling happens before this chunk, so the adjustment affects
        // the rock texture exactly as it affects terrainBaseColor.
        .replace("#include <alphamap_fragment>", "diffuseColor.rgb = (diffuseColor.rgb + utint / 1.5) * (((-1.0 + usun) * 0.80) + 1.0);\n#include <alphamap_fragment>");
      material.userData.cliffShader = shader;
    };
    material.customProgramCacheKey = () => "next-world-cliff-tint-v1";
    material.userData.cliffUniforms = cliffUniforms;
    const wall = new THREE.Mesh(geometry, material);
    wall.name = "Decorative cliff wall";
    wall.receiveShadow = true;
    tile.mesh.add(wall);
    tile.mesh.userData.cliffWall = wall;
    return wall;
  }

  refreshNormalsAround(chunkX, chunkZ) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        this.refreshTileNormals(chunkX + offsetX, chunkZ + offsetZ);
      }
    }
  }

  refreshTileNormals(chunkX, chunkZ) {
    const tile = this.tiles.get(this.key(chunkX, chunkZ));
    if (!tile) return;
    const resolution = this.config?.resolution ?? 50;
    const width = resolution + 1;
    const step = this.chunkSize / resolution;
    const normal = tile.mesh.geometry.getAttribute("normal");
    if (!normal) return;
    const originX = chunkX * this.chunkSize;
    const originZ = chunkZ * this.chunkSize;
    const heightAt = (x, z) => this.getHeightAt({ x, z });

    for (let z = 0; z <= resolution; z++) {
      for (let x = 0; x <= resolution; x++) {
        const worldX = originX + x * step;
        const worldZ = originZ + z * step;
        const slopeX = (heightAt(worldX + step, worldZ) - heightAt(worldX - step, worldZ)) / (2 * step);
        const slopeZ = (heightAt(worldX, worldZ + step) - heightAt(worldX, worldZ - step)) / (2 * step);
        const inverseLength = 1 / Math.hypot(slopeX, 1, slopeZ);
        normal.setXYZ(z * width + x, -slopeX * inverseLength, inverseLength, -slopeZ * inverseLength);
      }
    }
    normal.needsUpdate = true;
  }

setChunkDecorative(
    chunk,
    decorative,
    edges = [0, 0, 0, 0],
    corners = [0, 0, 0, 0],
    outerEdges = [0, 0, 0, 0],
    outerCorners = [0, 0, 0, 0]
) {
    chunk._decorative = Boolean(decorative);
    chunk._decorativeEdges = edges;
    chunk._decorativeCorners = corners;
    chunk._decorativeOuterEdges = outerEdges;
    chunk._decorativeOuterCorners = outerCorners;

    const tile =
        this.tiles.get(this.key(chunk.x, chunk.z));

    const attribute =
        tile?.mesh.geometry.getAttribute("terrainDecorative");

    const edgeAttribute =
        tile?.mesh.geometry.getAttribute("terrainDecorativeEdges");

    const cornerAttribute =
        tile?.mesh.geometry.getAttribute("terrainDecorativeCorners");

    const outerEdgeAttribute =
        tile?.mesh.geometry.getAttribute("terrainDecorativeOuterEdges");


    if (attribute) {
        attribute.array.fill(
            chunk._decorative ? 1 : 0
        );

        attribute.needsUpdate = true;
    }

    if (edgeAttribute) {
        for (
            let i = 0;
            i < edgeAttribute.count;
            i++
        ) {
            edgeAttribute.setXYZW(
                i,
                edges[0],
                edges[1],
                edges[2],
                edges[3]
            );
        }

        edgeAttribute.needsUpdate = true;
    }

    if (cornerAttribute) {
        for (
            let i = 0;
            i < cornerAttribute.count;
            i++
        ) {
            cornerAttribute.setXYZW(
                i,
                corners[0],
                corners[1],
                corners[2],
                corners[3]
            );
        }

        cornerAttribute.needsUpdate = true;
    }

    if (outerEdgeAttribute) {
        for (
            let i = 0;
            i < outerEdgeAttribute.count;
            i++
        ) {
            outerEdgeAttribute.setXYZW(
                i,
                outerEdges[0] + outerCorners[0] * 2,
                outerEdges[1] + outerCorners[1] * 2,
                outerEdges[2] + outerCorners[2] * 2,
                outerEdges[3] + outerCorners[3] * 2
            );
        }

        outerEdgeAttribute.needsUpdate = true;
    }
}

  unloadChunk(x, z) {
    const key = this.key(x, z);
    const tile = this.tiles.get(key);
    if (!tile) return;
    const wall = tile.mesh.userData.cliffWall;
    wall?.geometry.dispose();
    wall?.material.dispose();
    tile.mesh.removeFromParent();
    tile.mesh.geometry.dispose();
    this.tiles.delete(key);
  }

  clear() {
    for (const tile of this.tiles.values()) {
      tile.mesh.userData.cliffWall?.geometry.dispose();
      tile.mesh.userData.cliffWall?.material.dispose();
      tile.mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.root.clear();
  }

  get meshes() { return [...this.tiles.values()].map(tile => tile.mesh); }
  // Existing editor tools use terrain.mesh as their raycast target. The root
  // keeps that API while allowing a recursive intersection with all tiles.
  get mesh() { return this.root; }

  getTileAt(point) {
    return this.tiles.get(this.key(Math.floor(point.x / this.chunkSize), Math.floor(point.z / this.chunkSize))) ?? null;
  }
  updatesun(tint,sun){
    this.sun=sun;
    this.tint=tint;
    const shader = this.material.userData.terrainShader;
    if (shader) {
      shader.uniforms.usun.value = this.sun;
      shader.uniforms.utint.value = this.tint;
    }
    for (const { mesh } of this.tiles.values()) {
      const cliffUniforms = mesh.userData.cliffWall?.material.userData.cliffUniforms;
      if (!cliffUniforms) continue;
      cliffUniforms.usun.value = this.sun;
      cliffUniforms.utint.value.copy(this.tint);
    }
    
  }
  getHeightAt(point) {
    const tile = this.getTileAt(point);
    if (!tile) return 0;
    const resolution = this.config?.resolution ?? 50;
    const localX = THREE.MathUtils.clamp((point.x - tile.mesh.position.x + this.chunkSize * .5) / this.chunkSize * resolution, 0, resolution);
    const localZ = THREE.MathUtils.clamp((point.z - tile.mesh.position.z + this.chunkSize * .5) / this.chunkSize * resolution, 0, resolution);
    const x0 = Math.floor(localX), z0 = Math.floor(localZ);
    const x1 = Math.min(resolution, x0 + 1), z1 = Math.min(resolution, z0 + 1);
    const tx = localX - x0, tz = localZ - z0;
    const heightAt = (x, z) => Number(tile.chunk.terrain.heights[z * (resolution + 1) + x]) || 0;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(heightAt(x0, z0), heightAt(x1, z0), tx),
      THREE.MathUtils.lerp(heightAt(x0, z1), heightAt(x1, z1), tx),
      tz
    );
  }

  sculpt(point, radius, amount, mode, flattenHeight = 0) {
    let changed = false;
    const resolution = this.config?.resolution ?? 50;
    const spacing = this.chunkSize / resolution;
    for (const tile of this.tiles.values()) {
      const { chunk, mesh } = tile;
      const originX = chunk.x * this.chunkSize;
      const originZ = chunk.z * this.chunkSize;
      if (point.x + radius < originX || point.x - radius > originX + this.chunkSize || point.z + radius < originZ || point.z - radius > originZ + this.chunkSize) continue;
      const positions = mesh.geometry.getAttribute("position");
      const heights = chunk.terrain.heights;
      const before = mode === "smooth" ? heights.slice() : null;
      for (let z = 0; z <= resolution; z++) for (let x = 0; x <= resolution; x++) {
        const index = z * (resolution + 1) + x;
        const distance = Math.hypot(originX + x * spacing - point.x, originZ + z * spacing - point.z);
        if (distance > radius) continue;
        const weight = (1 - distance / radius) ** 2;
        if (mode === "flatten") heights[index] += (flattenHeight - heights[index]) * Math.min(1, amount * 3) * weight;
        else if (mode === "smooth") {
          const neighbours = [index, x ? index - 1 : -1, x < resolution ? index + 1 : -1, z ? index - resolution - 1 : -1, z < resolution ? index + resolution + 1 : -1].filter(item => item >= 0);
          heights[index] += (neighbours.reduce((sum, item) => sum + (before[item] ?? 0), 0) / neighbours.length - heights[index]) * Math.min(1, amount * 3) * weight;
        } else heights[index] += amount * weight;
        positions.setY(index, heights[index]);
        changed = true;
      }
      if (changed) {
        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    }
    return changed;
  }

  paint(point, radius, colorHex, strength) {
    let changed = false;
    const resolution = this.config?.resolution ?? 50;
    const spacing = this.chunkSize / resolution;
    const from = new THREE.Color();
    const target = new THREE.Color(colorHex);
    for (const tile of this.tiles.values()) {
      const { chunk, mesh } = tile;
      const originX = chunk.x * this.chunkSize;
      const originZ = chunk.z * this.chunkSize;
      if (point.x + radius < originX || point.x - radius > originX + this.chunkSize || point.z + radius < originZ || point.z - radius > originZ + this.chunkSize) continue;
      const colors = chunk.terrain.colors;
      const attribute = mesh.geometry.getAttribute("color");
      for (let z = 0; z <= resolution; z++) for (let x = 0; x <= resolution; x++) {
        const index = z * (resolution + 1) + x;
        const distance = Math.hypot(originX + x * spacing - point.x, originZ + z * spacing - point.z);
        if (distance > radius) continue;
        const weight = Math.min(1, strength * (1 - distance / radius) ** 2);
        from.setHex(Number(colors[index]) || (this.config?.color ?? 0x638450)).lerp(target, weight);
        colors[index] = from.getHex();
        attribute.setXYZ(index, from.r, from.g, from.b);
        changed = true;
      }
      if (changed) attribute.needsUpdate = true;
    }
    return changed;
  }

  updateTextureMasks() {
    for (const { chunk, mesh } of this.tiles.values()) {
      const count = mesh.geometry.getAttribute("position").count;
      chunk.terrain.masks ??= [];
      for (let layer = 0; layer < MAX_TEXTURE_LAYERS; layer++) {
        const values = chunk.terrain.masks[layer] ?? [];
        const attribute = mesh.geometry.getAttribute(`terrainTextureMask${layer}`);
        for (let index = 0; index < count; index++) attribute.setX(index, Number(values[index]) || 0);
        attribute.needsUpdate = true;
      }
    }
  }

  paintTexture(point, radius, strength) {
    const layer = this.config?.activeTexture ?? 0;
    let changed = false;
    const resolution = this.config?.resolution ?? 50;
    const spacing = this.chunkSize / resolution;
    for (const tile of this.tiles.values()) {
      const { chunk, mesh } = tile;
      const originX = chunk.x * this.chunkSize;
      const originZ = chunk.z * this.chunkSize;
      if (point.x + radius < originX || point.x - radius > originX + this.chunkSize || point.z + radius < originZ || point.z - radius > originZ + this.chunkSize) continue;
      const count = (resolution + 1) ** 2;
      chunk.terrain.masks ??= [];
      for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) chunk.terrain.masks[index] ??= Array(count).fill(0);
      for (let z = 0; z <= resolution; z++) for (let x = 0; x <= resolution; x++) {
        const index = z * (resolution + 1) + x;
        const distance = Math.hypot(originX + x * spacing - point.x, originZ + z * spacing - point.z);
        if (distance > radius) continue;
        const next = Math.min(1, chunk.terrain.masks[layer][index] + strength * (1 - distance / radius) ** 2);
        const reduction = Math.max(0, 1 - next) / Math.max(.0001, 1 - chunk.terrain.masks[layer][index]);
        for (let other = 0; other < MAX_TEXTURE_LAYERS; other++) if (other !== layer) chunk.terrain.masks[other][index] *= reduction;
        chunk.terrain.masks[layer][index] = next;
        changed = true;
      }
      if (changed) for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) {
        const attribute = mesh.geometry.getAttribute(`terrainTextureMask${index}`);
        for (let vertex = 0; vertex < count; vertex++) attribute.setX(vertex, chunk.terrain.masks[index][vertex]);
        attribute.needsUpdate = true;
      }
    }
    return changed;
  }

  configureTextureBlend(material) {
    material.onBeforeCompile = shader => {


      const attributes = `${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `attribute float terrainTextureMask${i}; varying float vTerrainTextureMask${i};`).join("\n")}\nattribute float terrainDecorative; varying float vTerrainDecorative;\nattribute vec4 terrainDecorativeEdges; varying vec4 vTerrainDecorativeEdges;\nattribute vec4 terrainDecorativeCorners; varying vec4 vTerrainDecorativeCorners;\nattribute vec4 terrainDecorativeOuterEdges;\nvarying float vTerrainOuterBackgroundFade;`;
      const varyings = `${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `varying float vTerrainTextureMask${i};`).join("\n")}\nvarying float vTerrainDecorative;\nvarying vec4 vTerrainDecorativeEdges;\nvarying vec4 vTerrainDecorativeCorners;\nvarying float vTerrainOuterBackgroundFade;\nvarying vec3 vWorldPosition;`;
      const uniforms = Array.from(
    { length: MAX_TEXTURE_LAYERS },
    (_, i) => `
        uniform sampler2D terrainMap${i};
        uniform float terrainMapScale${i};
    `
).join("\n");
      const baseUniforms = `
        uniform sampler2D terrainBaseMap;
        uniform float terrainBaseMapScale;
        uniform float terrainHasBaseMap;
        uniform vec3 terrainHorizonColor;
        uniform float terrainHorizonTintStrength;
        uniform float uTime;

        uniform float usun;
        uniform vec3 utint;
      `;
      const assignments = `${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `vTerrainTextureMask${i} = terrainTextureMask${i};`).join("\n")}\nvTerrainDecorative = terrainDecorative; vTerrainDecorativeEdges = terrainDecorativeEdges; vTerrainDecorativeCorners = terrainDecorativeCorners;\nvec4 terrainOuterEdges = step(vec4(0.5), mod(terrainDecorativeOuterEdges, 2.0));\nvec4 terrainOuterCorners = step(vec4(1.5), terrainDecorativeOuterEdges);\nfloat terrainOuterDistance = 1000.0;\nif (terrainOuterEdges.x > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, uv.x, 0.12);\nif (terrainOuterEdges.y > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, 1.0 - uv.x, 0.12);\nif (terrainOuterEdges.z > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, uv.y, 0.12);\nif (terrainOuterEdges.w > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, 1.0 - uv.y, 0.12);\nif (terrainOuterCorners.x > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, length(uv - vec2(0.0, 0.0)), 0.12);\nif (terrainOuterCorners.y > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, length(uv - vec2(1.0, 0.0)), 0.12);\nif (terrainOuterCorners.z > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, length(uv - vec2(0.0, 1.0)), 0.12);\nif (terrainOuterCorners.w > 0.5) terrainOuterDistance = smoothTerrainMin(terrainOuterDistance, length(uv - vec2(1.0, 1.0)), 0.12);\nvTerrainOuterBackgroundFade = (1.0 - smoothstep(0.0, 0.30, terrainOuterDistance)) * step(0.5, terrainDecorative);`;
      const samples = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `float terrainMask${i} = vTerrainTextureMask${i}; if (terrainMask${i} > 0.0001) { terrainWeight += terrainMask${i}; terrainPaint += texture2D(terrainMap${i}, vTerrainUv * terrainMapScale${i}).rgb * terrainMask${i}; }`).join("\n");
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nvarying vec2 vTerrainUv;\nvarying vec3 vWorldPosition;\nfloat smoothTerrainMin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }\n${attributes}`)
        .replace("#include <begin_vertex>", `vTerrainUv = uv;\n${assignments}\n#include <begin_vertex>\nvWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec2 vTerrainUv;\n${varyings}\n${uniforms}\n${baseUniforms}\nfloat terrainHash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\nfloat vnoise(vec2 p) { vec2 cell = floor(p); vec2 local = fract(p); local = local * local * (3.0 - 2.0 * local); float a = terrainHash21(cell); float b = terrainHash21(cell + vec2(1.0, 0.0)); float c = terrainHash21(cell + vec2(0.0, 1.0)); float d = terrainHash21(cell + vec2(1.0, 1.0)); return mix(mix(a, b, local.x), mix(c, d, local.x), local.y); }  
float hash(vec2 p) {

                return fract(
                    sin(
                        dot(
                            p,
                            vec2(127.1, 311.7)
                        )
                    ) * 43758.5453
                );
            }


            float noise(vec2 p) {

                vec2 i = floor(p);
                vec2 f = fract(p);

                f = f * f * (3.0 - 2.0 * f);

                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));

                return mix(
                    mix(a, b, f.x),
                    mix(c, d, f.x),
                    f.y
                );
            }

            mat2 rot2(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
}





`)
.replace("#include <color_fragment>", `
#include <color_fragment>




vec2 uv = vTerrainUv * terrainBaseMapScale;



vec3 terrainBaseColor = terrainHasBaseMap > 0.5
    ? texture2D(terrainBaseMap, uv/2.0).rgb
    : diffuseColor.rgb;













float terrainWeight = 0.0;
vec3 terrainPaint = vec3(0.0);

${samples}


// ==================================================
// Decorative boundary
// ==================================================

vec4 edges =
    step(vec4(0.5), vTerrainDecorativeEdges);

vec4 corners =
    step(vec4(0.5), vTerrainDecorativeCorners);


// Samma fade-avstånd för edges och corners.
// Då möts de geometriskt korrekt.
float fadeSize = 0.12;


// Börja väldigt långt bort.
float boundaryDistance = 1000.0;


// --------------------------------------------------
// Direct playable neighbours
// --------------------------------------------------

if (edges.x > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        vTerrainUv.x
    );

if (edges.y > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        1.0 - vTerrainUv.x
    );

if (edges.z > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        vTerrainUv.y
    );

if (edges.w > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        1.0 - vTerrainUv.y
    );


// --------------------------------------------------
// Diagonal playable neighbours
//
// Det här är chunken som ligger "mellan"
// de två andra edge-chunksen.
//
// Avståndet måste vara radiellt från hörnet.
// --------------------------------------------------

// world (-X, +Z)
if (corners.x > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        length(vTerrainUv - vec2(0.0, 0.0))
    );

// world (+X, +Z)
if (corners.y > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        length(vTerrainUv - vec2(1.0, 0.0))
    );

// world (-X, -Z)
if (corners.z > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        length(vTerrainUv - vec2(0.0, 1.0))
    );

// world (+X, -Z)
if (corners.w > 0.5)
    boundaryDistance = min(
        boundaryDistance,
        length(vTerrainUv - vec2(1.0, 1.0))
    );


// --------------------------------------------------
// One continuous distance -> one continuous fade
// --------------------------------------------------

float borderFade =
    1.0 - smoothstep(
        0.0,
        fadeSize,
        boundaryDistance
    );


// Mörkt ute i decorative-terrain.
// Normal färg mot playable-terrain.
float decorativeTint =
    mix(
        0.68,
        1.0,
        borderFade
    );

float terrainTint =
    mix(
        1.0,
        decorativeTint,
        step(0.5, vTerrainDecorative)
    );

// The sky fade hook reads this interpolated terrain-edge value and blends the
// final terrain colour into the same captured sky background as scene fog.
float terrainOuterBackgroundFade = vTerrainOuterBackgroundFade;
// --------------------------------------------------
// Terrain + texture first, tint afterwards
// --------------------------------------------------



float broad = noise(vWorldPosition.xz * 0.018);
float mid   = noise(vWorldPosition.xz * 0.07);
float small   = noise(vWorldPosition.xz * 0.5);
float variation =
    (broad - 0.5) * 0.6 +
    (mid   - 0.5) * 0.6 +
    (small   - 0.5) * 0.1
    ;

terrainBaseColor *= 1.0 + variation;


vec3 finalTerrainColor =
    ((terrainBaseColor+utint/1.5)) * max(0.0, 1.0 - terrainWeight)
    + terrainPaint;

   
                       
                    finalTerrainColor *=((-1.00+usun)*0.80)+1.0;



diffuseColor.rgb = (finalTerrainColor * terrainTint);



`);


        
      for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) {
        shader.uniforms[`terrainMap${index}`] = { value: material.userData.terrainTextures?.[index] ?? this.placeholderTexture };
        shader.uniforms[`terrainMapScale${index}`] = { value: material.userData.terrainTextureScales?.[index] ?? 1 };
      }
      shader.uniforms.terrainBaseMap = { value: material.userData.terrainBaseTexture ?? this.placeholderTexture };
      shader.uniforms.terrainBaseMapScale = { value: material.userData.terrainBaseTextureScale ?? 1 };
      shader.uniforms.terrainHasBaseMap = { value: material.userData.terrainBaseTexture ? 1 : 0 };
      shader.uniforms.terrainHorizonColor = { value: material.userData.terrainHorizonColor ?? new THREE.Color(1, 1, 1) };
      shader.uniforms.terrainHorizonTintStrength = { value: material.userData.terrainHorizonTintStrength ?? 0.45 };
      shader.uniforms.uTime = { value: material.userData.terrainTime ?? 0 };

        shader.uniforms.usun = { value: this.sun };
         shader.uniforms.utint = { value: this.tint };

        
      material.userData.terrainShader = shader;



    };
    material.customProgramCacheKey = () => "next-world-chunked-terrain-textures-v16";
  }

  setHorizonTint(color, strength = 0.85) {
    if (!this.material || !color) return;
    const tint = this.material.userData.terrainHorizonColor ??= new THREE.Color();
    tint.copy(color);
    this.material.userData.terrainHorizonTintStrength = strength;
    const shader = this.material.userData.terrainShader;
    if (!shader) return;
    shader.uniforms.terrainHorizonColor.value.copy(tint);
    shader.uniforms.terrainHorizonTintStrength.value = strength;
  }

  update(delta) {
    this.time += delta;
    if (!this.material) return;
    this.material.userData.terrainTime = this.time;
    const shader = this.material.userData.terrainShader;
    if (shader) shader.uniforms.uTime.value = this.time;
  }

  configureTexture(texture, scale) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(scale, scale);
    texture.anisotropy = 8;
    return texture;
  }

  loadTextures(layers = []) {
    const sources = [this.config?.baseTexture, ...layers.slice(0, MAX_TEXTURE_LAYERS)];
    for (const layer of sources) if (layer?.src && !this.textures.has(layer.src)) {
      this.textureLoader.load(layer.src, texture => {
        this.textures.set(layer.src, this.configureTexture(texture, layer.scale));
        this.applyTextures();
      });
    }
    this.applyTextures(layers);
  }

  loadTextureFile(file, savedPath, scale = 8) {
    const url = URL.createObjectURL(file);
    this.textureLoader.load(url, texture => {
      URL.revokeObjectURL(url);
      this.textures.set(savedPath, this.configureTexture(texture, scale));
      this.applyTextures();
    }, undefined, () => URL.revokeObjectURL(url));
  }

  applyTextures(layers = this.config?.textures ?? []) {
    if (!this.material) return;
    this.material.userData.terrainTextures = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, index) => this.textures.get(layers[index]?.src) ?? this.placeholderTexture);
    this.material.userData.terrainTextureScales = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, index) => layers[index]?.scale ?? 1);
    const baseTexture = this.config?.baseTexture;
    
    this.material.userData.terrainBaseTexture = baseTexture?.src ? this.textures.get(baseTexture.src) ?? null : null;
    this.material.userData.terrainBaseTextureScale = baseTexture?.scale ?? 1;

    const shader = this.material.userData.terrainShader;
    if (!shader) { this.material.needsUpdate = true; return; }
    for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) {
      shader.uniforms[`terrainMap${index}`].value = this.material.userData.terrainTextures[index];
      shader.uniforms[`terrainMapScale${index}`].value = this.material.userData.terrainTextureScales[index];
    }
  
   
    
    shader.uniforms.terrainBaseMap.value = this.material.userData.terrainBaseTexture ?? this.placeholderTexture;
    shader.uniforms.terrainBaseMapScale.value = this.material.userData.terrainBaseTextureScale;
    shader.uniforms.terrainHasBaseMap.value = this.material.userData.terrainBaseTexture ? 1 : 0;
  }
}
