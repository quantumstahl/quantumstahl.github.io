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
    this.shadowMaterial = null;
    this.terrainShadowDepthMaterial = null;
    this.textureLoader = new THREE.TextureLoader();
    this.textures = new Map();
    this.placeholderTexture = new THREE.Texture();
    this.cliffRockTexture = null;
    this.textureLoader.load("assets/rockrock.png", texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      this.cliffRockTexture = texture;
      for (const { mesh } of this.tiles.values()) {
        const material = mesh.userData.cliffWall?.material;
        if (!material) continue;
        material.map = texture;
        material.needsUpdate = true;
      }
    });
    this.surfaceRaycaster = new THREE.Raycaster();
    this.time = 0;
    this.sun= 0.84375;
    this.tint=new THREE.Color(0.00, 0.00, 0.00);
  }

  key(x, z) { return `${x},${z}`; }

  applyManifest(config) {
    this.config = config;
    this.chunkSize = config.chunkSize ?? this.chunkSize;
    this.material?.dispose();
    this.shadowMaterial?.dispose();
    this.terrainShadowDepthMaterial?.dispose();
    this.material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
     // side: THREE.DoubleSide,
      toneMapped: false,
      roughness: 1.0,
       metalness: 0.0  
    });
    (this.material.extensions ??= {}).derivatives = true;
    this.shadowMaterial = new THREE.ShadowMaterial({ opacity: .48, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    // Flat terrain receives shadows but must not cast into its own shadow map:
    // at dawn/dusk the huge grazing projection otherwise turns whole chunks
    // dark. Mountain and cliff faces still cast normally.
    this.terrainShadowDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide
    });
    this.terrainShadowDepthMaterial.onBeforeCompile = shader => {
      shader.vertexShader = `varying float vTerrainShadowNormalY;\n${shader.vertexShader}`
        .replace(
          "#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\nvTerrainShadowNormalY = abs(normalize(objectNormal).y);"
        );
      shader.fragmentShader = `varying float vTerrainShadowNormalY;\n${shader.fragmentShader}`
        .replace(
          "#include <alphatest_fragment>",
          "#include <alphatest_fragment>\nif (vTerrainShadowNormalY > 0.985) discard;"
        );
    };
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
    chunk.terrain.xOffsets ??= [];
    chunk.terrain.zOffsets ??= [];
    chunk.terrain.rockifyExposure ??= [];
    chunk.terrain.colors ??= [];
    chunk.terrain.masks ??= [];
    while (chunk.terrain.heights.length < count) chunk.terrain.heights.push(0);
    while (chunk.terrain.xOffsets.length < count) chunk.terrain.xOffsets.push(0);
    while (chunk.terrain.zOffsets.length < count) chunk.terrain.zOffsets.push(0);
    while (chunk.terrain.rockifyExposure.length < count) chunk.terrain.rockifyExposure.push(0);
    while (chunk.terrain.colors.length < count) chunk.terrain.colors.push(this.config?.color ?? 0x638450);
    const heights = chunk.terrain.heights;
    const xOffsets = chunk.terrain.xOffsets;
    const zOffsets = chunk.terrain.zOffsets;
    const rockifyExposure = chunk.terrain.rockifyExposure;
    const colors = chunk.terrain.colors;
    const masks = chunk.terrain?.masks ?? [];
    const colorAttribute = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    const color = new THREE.Color();
    const fallback = this.config?.color ?? 0x638450;

    for (let index = 0; index < count; index++) {
      positions.setX(index, positions.getX(index) + (Number(xOffsets[index]) || 0));
      positions.setY(index, Number(heights[index]) || 0);
      positions.setZ(index, positions.getZ(index) + (Number(zOffsets[index]) || 0));
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
            Float32Array.from({ length: count * 4 }, (_, index) => {
                const component = index % 4;
                const vertex = Math.floor(index / 4);
                if (component !== 3) return decorativeOuterBoundary[component];
                const packedExposure = THREE.MathUtils.clamp(((Number(rockifyExposure[vertex]) || 0) + 2) / 4, .001, .999);
                return decorativeOuterBoundary[component] + packedExposure;
            }),
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
    geometry.computeBoundingBox();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `Terrain ${x},${z}`;
    mesh.position.set(x * this.chunkSize + this.chunkSize * .5, 0, z * this.chunkSize + this.chunkSize * .5);
    // Do not feed the terrain back into its own low-resolution directional
    // shadow map. Steep terrain produced severe moving acne bands; objects
    // still cast onto this receiver normally.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const shadowOverlay = new THREE.Mesh(geometry, this.shadowMaterial);
    shadowOverlay.name = `Terrain real shadow receiver ${x},${z}`;
    shadowOverlay.castShadow = false;
    shadowOverlay.receiveShadow = true;
    shadowOverlay.renderOrder = 1;
    mesh.add(shadowOverlay);
    mesh.userData.shadowOverlay = shadowOverlay;
    mesh.userData.chunk = chunk;
    this.root.add(mesh);
    this.tiles.set(key, { chunk, mesh });
    this.refreshNormalsAround(x, z);
    return mesh;
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
                outerEdges[3] + outerCorners[3] * 2 + THREE.MathUtils.clamp(((Number(chunk.terrain?.rockifyExposure?.[i]) || 0) + 2) / 4, .001, .999)
            );
        }

        outerEdgeAttribute.needsUpdate = true;
    }
}

  // Build the vertical rock faces for raised decorative-border edges. The
  // hill generator keeps the top heights in terrain.heights and the original
  // playable-edge heights in terrain.cliffEdges; this mesh joins the two.
  updateCliffWall(chunk) {
    const tile = this.tiles.get(this.key(chunk?.x, chunk?.z));
    if (!tile?.mesh) return null;
    const mesh = tile.mesh;
    const previous = mesh.userData.cliffWall;
    if (previous) {
      mesh.remove(previous);
      previous.geometry.dispose();
      previous.material.dispose();
      delete mesh.userData.cliffWall;
    }

    const edges = chunk.terrain?.cliffEdges;
    const heights = chunk.terrain?.heights;
    const positions = mesh.geometry.getAttribute("position");
    const resolution = this.config?.resolution ?? 50;
    const width = resolution + 1;
    if (!edges || !heights || !positions) return null;

    const vertexFor = (edge, index) => {
      if (edge === 0) return index * width;
      if (edge === 1) return index * width + resolution;
      if (edge === 2) return resolution * width + index;
      return index;
    };
    const vertices = [];
    const uvs = [];
    const thickness = .22;
    const pushQuad = (a, b, c, d, u0, u1, v0, v1) => {
      vertices.push(...a, ...b, ...c, ...a, ...c, ...d);
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    const outward = [[-1, 0], [1, 0], [0, 1], [0, -1]];
    for (let edge = 0; edge < 4; edge++) {
      const bottoms = edges[edge] ?? [];
      for (let index = 0; index < resolution; index++) {
        const rawBottomA = bottoms[index];
        const rawBottomB = bottoms[index + 1];
        if (!Number.isFinite(rawBottomA) || !Number.isFinite(rawBottomB)) continue;
        const bottomA = Number(rawBottomA);
        const bottomB = Number(rawBottomB);
        const first = vertexFor(edge, index), second = vertexFor(edge, index + 1);
        const ax = positions.getX(first), az = positions.getZ(first);
        const bx = positions.getX(second), bz = positions.getZ(second);
        const topA = positions.getY(first), topB = positions.getY(second);
        const [normalX, normalZ] = outward[edge];
        const offsetX = normalX * thickness, offsetZ = normalZ * thickness;
        const innerBottomA = [ax, bottomA, az], innerBottomB = [bx, bottomB, bz];
        const innerTopA = [ax, topA, az], innerTopB = [bx, topB, bz];
        const outerBottomA = [ax + offsetX, bottomA, az + offsetZ], outerBottomB = [bx + offsetX, bottomB, bz + offsetZ];
        const outerTopA = [ax + offsetX, topA, az + offsetZ], outerTopB = [bx + offsetX, topB, bz + offsetZ];
        const along = Math.hypot(bx - ax, bz - az);
        const tall = Math.max(topA - bottomA, topB - bottomB, .01);
        const u0 = index * along * .18, u1 = (index + 1) * along * .18;
        const v1 = tall * .18;
        // Front/back, crest, and bottom make the cliff a shallow rock slab
        // rather than a paper-thin wall.
        pushQuad(innerBottomA, innerBottomB, innerTopB, innerTopA, u0, u1, 0, v1);
        pushQuad(outerBottomB, outerBottomA, outerTopA, outerTopB, u0, u1, 0, v1);
        pushQuad(innerTopA, innerTopB, outerTopB, outerTopA, u0, u1, 0, thickness * .5);
        pushQuad(outerBottomA, outerBottomB, innerBottomB, innerBottomA, u0, u1, 0, thickness * .5);
      }
    }
    if (!vertices.length) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      // MeshStandardMaterial multiplies map pixels by its colour. Keep this
      // neutral so rockrock.png is not tinted brown/darkened.
      color: 0xffffff,
      map: this.cliffRockTexture,
      roughness: 1,
      metalness: 0,
      fog: true,
      side: THREE.DoubleSide
    });
    const wall = new THREE.Mesh(geometry, material);
    wall.name = `Decorative cliff wall ${chunk.x},${chunk.z}`;
    wall.castShadow = true;
    wall.receiveShadow = true;
    mesh.add(wall);
    mesh.userData.cliffWall = wall;
    return wall;
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

  // Heightfield sampling is fast, but Rockify can move terrain sideways and
  // create an overhang. The player needs the highest rendered surface at its
  // X/Z position so those authored stone bridges are solid underfoot.
  getSurfaceHeightAt(point, maxSurfaceY = Infinity) {
    // Rockify can extend a face beyond its source tile. Test the local 3×3
    // tile neighbourhood, rather than only the chunk containing the X/Z
    // coordinate, so an overhanging bridge remains solid across a seam.
    const chunkX = Math.floor(point.x / this.chunkSize);
    const chunkZ = Math.floor(point.z / this.chunkSize);
    const meshes = [];
    for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const mesh = this.tiles.get(this.key(chunkX + offsetX, chunkZ + offsetZ))?.mesh;
        if (!mesh) continue;
        // Player setup runs before the first renderer frame, so make every
        // candidate transform current before asking Raycaster to use it.
        mesh.updateWorldMatrix(true, false);
        meshes.push(mesh);
      }
    }
    if (!meshes.length) return this.getHeightAt(point);
    this.surfaceRaycaster.ray.origin.set(point.x, 10000, point.z);
    this.surfaceRaycaster.ray.direction.set(0, -1, 0);
    // Intersections are nearest-first from the sky. Ignore bridge decks that
    // are above the actor's feet, then return the highest surface it can
    // actually stand on. This keeps the space beneath an arch walkable.
    const hit = this.surfaceRaycaster.intersectObjects(meshes, false)
      .find(candidate => candidate.point.y <= maxSurfaceY);
    return hit?.point.y ?? this.getHeightAt(point);
  }

  sculpt(point, radius, amount, mode, flattenHeight = 0, rockStamp = null) {
    let changed = false;
    const changedTileKeys = new Set();
    const resolution = this.config?.resolution ?? 50;
    const spacing = this.chunkSize / resolution;
    for (const tile of this.tiles.values()) {
      const { chunk, mesh } = tile;
      const originX = chunk.x * this.chunkSize;
      const originZ = chunk.z * this.chunkSize;
      const brushRadius = radius;
      if (point.x + brushRadius < originX || point.x - brushRadius > originX + this.chunkSize || point.z + brushRadius < originZ || point.z - brushRadius > originZ + this.chunkSize) continue;
      const positions = mesh.geometry.getAttribute("position");
      // Take a stable snapshot before moving vertices. A Rockify stroke is
      // normal-directed rather than an arbitrary X/Z offset, so it builds
      // out from (or cuts into) the existing rock face.
      const normals = mode === "rockify" ? mesh.geometry.getAttribute("normal") : null;
      const heights = chunk.terrain.heights;
      const xOffsets = chunk.terrain.xOffsets ??= [];
      const zOffsets = chunk.terrain.zOffsets ??= [];
      const rockifyExposure = chunk.terrain.rockifyExposure ??= [];
      while (xOffsets.length < positions.count) xOffsets.push(0);
      while (zOffsets.length < positions.count) zOffsets.push(0);
      while (rockifyExposure.length < positions.count) rockifyExposure.push(0);
      const rockExposureAttribute = mesh.geometry.getAttribute("terrainDecorativeOuterEdges");
      const before = mode === "smooth" ? heights.slice() : null;
      let tileChanged = false;
      for (let z = 0; z <= resolution; z++) for (let x = 0; x <= resolution; x++) {
        const index = z * (resolution + 1) + x;
        const sampleX = originX + x * spacing, sampleZ = originZ + z * spacing;
        const vertexX = mesh.position.x + positions.getX(index);
        const vertexY = positions.getY(index);
        const vertexZ = mesh.position.z + positions.getZ(index);
        // Rockify is a sphere in world space; the other terrain brushes keep
        // their familiar top-down circular footprint.
        const distance = mode === "rockify"
          ? Math.hypot(vertexX - point.x, vertexY - point.y, vertexZ - point.z)
          : Math.hypot(sampleX - point.x, sampleZ - point.z);
        if (distance > brushRadius) continue;
        const weight = (1 - distance / radius) ** 2;
        if (weight <= 0) continue;
        if (mode === "flatten") heights[index] += (flattenHeight - heights[index]) * Math.min(1, amount * 15) * weight;
        else if (mode === "smooth") {
          const neighbours = [index, x ? index - 1 : -1, x < resolution ? index + 1 : -1, z ? index - resolution - 1 : -1, z < resolution ? index + resolution + 1 : -1].filter(item => item >= 0);
          heights[index] += (neighbours.reduce((sum, item) => sum + (before[item] ?? 0), 0) / neighbours.length - heights[index]) * Math.min(1, amount * 3) * weight;
        } else if (mode === "rockify") {
          // A stamp uses one captured face direction for every affected
          // vertex, forming one coherent rounded rock rather than noise.
          const normalX = rockStamp?.normal?.x ?? normals?.getX(index) ?? 0;
          const normalY = rockStamp?.normal?.y ?? normals?.getY(index) ?? 1;
          const normalZ = rockStamp?.normal?.z ?? normals?.getZ(index) ?? 0;
          const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
        // Vertex position relative to stamp center
const dx = mesh.position.x + positions.getX(index)
         - rockStamp.center.x;

const dy = positions.getY(index)
         - rockStamp.center.y;

const dz = mesh.position.z + positions.getZ(index)
         - rockStamp.center.z;

// Project onto the rock face
const u = dx * rockStamp.tangent.x
        + dy * rockStamp.tangent.y
        + dz * rockStamp.tangent.z;

const v = dx * rockStamp.bitangent.x
        + dy * rockStamp.bitangent.y
        + dz * rockStamp.bitangent.z;

// Irregular stone outline
const angle = Math.atan2(v, u);

const irregularity =
    1.0
    + 0.33 * Math.sin(angle * 5.0 + 0.7)
    + 0.07 * Math.sin(angle * 3.0 - 1.1);

// Rounded polygon rather than circle
const sx = u / (radius * 0.8 * irregularity);
const sy = v / (radius * 0.8 * irregularity);

const shapeDistance = Math.pow(
    Math.pow(Math.abs(sx), 10.0) +
    Math.pow(Math.abs(sy), 10.0),
    0.25
);

// Broad central mass, smoother edges
const rockProfile = THREE.MathUtils.smoothstep(
    1.0 - shapeDistance,
    0.0,
    1.00
);

const displacement = amount * rockProfile * 1.4;
          const offsetX = normalX / normalLength * displacement;
          const offsetY = normalY / normalLength * displacement;
          const offsetZ = normalZ / normalLength * displacement;
          xOffsets[index] += offsetX;
          heights[index] += offsetY*0.0;
          zOffsets[index] += offsetZ;
          rockifyExposure[index] += displacement/10.0;
          positions.setX(index, positions.getX(index) + offsetX);
          positions.setY(index, positions.getY(index) + offsetY*0.0);
          positions.setZ(index, positions.getZ(index) + offsetZ);
          // Pack signed Rockify exposure into the unused fractional part of
          // the existing fourth decorative-edge component. This material is
          // already at the GPU attribute limit, so no new attribute is added.
          const packedExposure = THREE.MathUtils.clamp((rockifyExposure[index] + 2) / 4, .001, .999);
          rockExposureAttribute?.setW(index, Math.floor(rockExposureAttribute.getW(index)) + packedExposure);
        } else {
          heights[index] += amount * weight;
        }
        if (mode !== "rockify") positions.setY(index, heights[index]);
        changed = true;
        tileChanged = true;
      }
      if (tileChanged) {
        positions.needsUpdate = true;
        // Grass painting uses this deformed box to cheaply find Rockify
        // overhangs that extend beyond the chunk's original square.
        mesh.geometry.computeBoundingBox();
        if (mode === "rockify" && rockExposureAttribute) rockExposureAttribute.needsUpdate = true;
        changedTileKeys.add(this.key(chunk.x, chunk.z));
      }
    }
    if (changed) this.synchronizeSharedEdgeHeights(changedTileKeys);
    return changed;
  }

  synchronizeSharedEdgeHeights(changedTileKeys) {
    const resolution = this.config?.resolution ?? 50;
    const width = resolution + 1;
    const sharedVertices = new Map();
    const targetVertexKeys = new Set();
    const nearbyTileKeys = new Set();

    for (const key of changedTileKeys) {
      const [chunkX, chunkZ] = key.split(",").map(Number);
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) for (let offsetX = -1; offsetX <= 1; offsetX++) {
        nearbyTileKeys.add(this.key(chunkX + offsetX, chunkZ + offsetZ));
      }
      for (let index = 0; index <= resolution; index++) {
        targetVertexKeys.add(`${chunkX * resolution + index},${chunkZ * resolution}`);
        targetVertexKeys.add(`${chunkX * resolution + index},${(chunkZ + 1) * resolution}`);
        targetVertexKeys.add(`${chunkX * resolution},${chunkZ * resolution + index}`);
        targetVertexKeys.add(`${(chunkX + 1) * resolution},${chunkZ * resolution + index}`);
      }
    }

    // A world-space terrain vertex can be stored by two chunks (or four at a
    // corner). Reconcile every loaded shared vertex in one pass, rather than
    // copying one edge after another and leaving a corner out of sync.
    for (const key of nearbyTileKeys) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      const { chunk, mesh } = tile;
      const heights = chunk.terrain.heights;
      const xOffsets = chunk.terrain.xOffsets ?? [];
      const zOffsets = chunk.terrain.zOffsets ?? [];
      const rockifyExposure = chunk.terrain.rockifyExposure ?? [];
      for (let z = 0; z <= resolution; z++) for (let x = 0; x <= resolution; x++) {
        if (x !== 0 && x !== resolution && z !== 0 && z !== resolution) continue;
        const key = `${chunk.x * resolution + x},${chunk.z * resolution + z}`;
        if (!targetVertexKeys.has(key)) continue;
        const index = z * width + x;
        const records = sharedVertices.get(key) ?? [];
        records.push({ heights, xOffsets, zOffsets, rockifyExposure, rockExposureAttribute: mesh.geometry.getAttribute("terrainDecorativeOuterEdges"), positions: mesh.geometry.getAttribute("position"), index, chunkX: chunk.x, chunkZ: chunk.z });
        sharedVertices.set(key, records);
      }
    }

    for (const records of sharedVertices.values()) {
      if (records.length < 2) continue;
      const height = records.reduce((sum, record) => sum + (Number(record.heights[record.index]) || 0), 0) / records.length;
      const xOffset = records.reduce((sum, record) => sum + (Number(record.xOffsets[record.index]) || 0), 0) / records.length;
      const zOffset = records.reduce((sum, record) => sum + (Number(record.zOffsets[record.index]) || 0), 0) / records.length;
      const exposure = records.reduce((sum, record) => sum + (Number(record.rockifyExposure[record.index]) || 0), 0) / records.length;
      for (const record of records) {
        record.heights[record.index] = height;
        const previousXOffset = Number(record.xOffsets[record.index]) || 0;
        const previousZOffset = Number(record.zOffsets[record.index]) || 0;
        record.xOffsets[record.index] = xOffset;
        record.zOffsets[record.index] = zOffset;
        record.rockifyExposure[record.index] = exposure;
        const packedExposure = THREE.MathUtils.clamp((exposure + 2) / 4, .001, .999);
        if (record.rockExposureAttribute) record.rockExposureAttribute.setW(record.index, Math.floor(record.rockExposureAttribute.getW(record.index)) + packedExposure);
        if (record.rockExposureAttribute) record.rockExposureAttribute.needsUpdate = true;
        record.positions.setX(record.index, record.positions.getX(record.index) + xOffset - previousXOffset);
        record.positions.setY(record.index, height);
        record.positions.setZ(record.index, record.positions.getZ(record.index) + zOffset - previousZOffset);
        record.positions.needsUpdate = true;
      }
    }
    // Each tile's normals are rebuilt at most once. The former implementation
    // refreshed the same 3x3 area for every shared edge, which made sculpting
    // progressively slower as more chunks streamed in.
    for (const key of nearbyTileKeys) {
      const [x, z] = key.split(",").map(Number);
      this.refreshTileNormals(x, z);
      this.tiles.get(key)?.mesh.geometry.computeBoundingBox();
    }
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

  // Keep authoring rules aligned with the material: its rock blend starts
  // when `1.0 - abs(normal.y)` reaches 0.15.
  isRockVertex(mesh, index, resolution) {
    return Math.abs(mesh.geometry.getAttribute("normal")?.getY(index) ?? 1) <= 0.85;
  }

  isPointInTerrainTriangle(point, mesh, first, second, third) {
    const positions = mesh.geometry.getAttribute("position");
    const ax = mesh.position.x + positions.getX(first), az = mesh.position.z + positions.getZ(first);
    const bx = mesh.position.x + positions.getX(second), bz = mesh.position.z + positions.getZ(second);
    const cx = mesh.position.x + positions.getX(third), cz = mesh.position.z + positions.getZ(third);
    const cross = (x1, z1, x2, z2) => x1 * z2 - z1 * x2;
    const firstSide = cross(bx - ax, bz - az, point.x - ax, point.z - az);
    const secondSide = cross(cx - bx, cz - bz, point.x - bx, point.z - bz);
    const thirdSide = cross(ax - cx, az - cz, point.x - cx, point.z - cz);
    return (firstSide >= 0 && secondSide >= 0 && thirdSide >= 0) || (firstSide <= 0 && secondSide <= 0 && thirdSide <= 0);
  }

  isRockSurfaceAt(point) {
    const tile = this.getTileAt(point);
    if (!tile) return false;
    const resolution = this.config?.resolution ?? 50;
    const spacing = this.chunkSize / resolution;
    // The common flat-ground case needs no raycast. Only the narrow visual
    // transition band falls through to the more expensive Rockify test.
    const slopeX = (this.getHeightAt({ x: point.x + spacing, z: point.z }) - this.getHeightAt({ x: point.x - spacing, z: point.z })) / (2 * spacing);
    const slopeZ = (this.getHeightAt({ x: point.x, z: point.z + spacing }) - this.getHeightAt({ x: point.x, z: point.z - spacing })) / (2 * spacing);
    const slopeNormalY = 1 / Math.hypot(slopeX, 1, slopeZ);
    if (slopeNormalY <= 0.85) return true;
    if (slopeNormalY >= 0.93) return false;
    // Raycast the rendered terrain itself first. This catches Rockify faces
    // whose sideways displacement puts them outside their original height
    // grid cell.
    this.surfaceRaycaster.ray.origin.set(point.x, 10000, point.z);
    this.surfaceRaycaster.ray.direction.set(0, -1, 0);
    const hit = this.surfaceRaycaster.intersectObject(tile.mesh, false)[0];
    if (hit?.face) {
      const faceNormal = hit.face.normal.clone().transformDirection(tile.mesh.matrixWorld);
      if (Math.abs(faceNormal.y) <= 0.85) return true;
    }
    // This is the same central-difference slope used by refreshTileNormals(),
    // which feeds vTerrainSteepness in the terrain shader. It remains reliable
    // when a Rockify displacement moves a face beyond its original grid cell.
    const width = resolution + 1;
    const localX = (point.x - tile.mesh.position.x + this.chunkSize * .5) / this.chunkSize * resolution;
    const localZ = (point.z - tile.mesh.position.z + this.chunkSize * .5) / this.chunkSize * resolution;
    // Check neighbouring cells too: Rockify can shift a face across its
    // original grid-cell boundary. A face is kept bare if any vertex is in
    // the shader's rock range, preventing grass from leaking along its edge.
    for (let z = Math.max(0, Math.floor(localZ) - 2); z <= Math.min(resolution - 1, Math.floor(localZ) + 2); z++) {
      for (let x = Math.max(0, Math.floor(localX) - 2); x <= Math.min(resolution - 1, Math.floor(localX) + 2); x++) {
        const topLeft = z * width + x, topRight = topLeft + 1, bottomLeft = topLeft + width, bottomRight = bottomLeft + 1;
        if (this.isPointInTerrainTriangle(point, tile.mesh, topLeft, topRight, bottomLeft)) return [topLeft, topRight, bottomLeft].some(index => this.isRockVertex(tile.mesh, index, resolution));
        if (this.isPointInTerrainTriangle(point, tile.mesh, topRight, bottomRight, bottomLeft)) return [topRight, bottomRight, bottomLeft].some(index => this.isRockVertex(tile.mesh, index, resolution));
      }
    }
    return false;
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
        if (distance > radius || this.isRockVertex(mesh, index, resolution)) continue;
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

  eraseTexture(point, radius, strength) {
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
      let tileChanged = false;
      for (let z = 0; z <= resolution; z++) for (let x = 0; x <= resolution; x++) {
        const index = z * (resolution + 1) + x;
        const distance = Math.hypot(originX + x * spacing - point.x, originZ + z * spacing - point.z);
        if (distance > radius) continue;
        const current = chunk.terrain.masks[layer][index];
        const next = Math.max(0, current - strength * (1 - distance / radius) ** 2);
        if (next === current) continue;
        chunk.terrain.masks[layer][index] = next;
        tileChanged = changed = true;
      }
      if (tileChanged) for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) {
        const attribute = mesh.geometry.getAttribute(`terrainTextureMask${index}`);
        for (let vertex = 0; vertex < count; vertex++) attribute.setX(vertex, chunk.terrain.masks[index][vertex]);
        attribute.needsUpdate = true;
      }
    }
    return changed;
  }

  configureTextureBlend(material) {
    material.onBeforeCompile = shader => {


      const attributes = `${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `attribute float terrainTextureMask${i}; varying float vTerrainTextureMask${i};`).join("\n")}\nattribute float terrainDecorative; varying float vTerrainDecorative;\nattribute vec4 terrainDecorativeEdges; varying vec4 vTerrainDecorativeEdges;\nattribute vec4 terrainDecorativeCorners; varying vec4 vTerrainDecorativeCorners;\nattribute vec4 terrainDecorativeOuterEdges;\nvarying float vTerrainRockExposure;\nvarying float vTerrainOuterBackgroundFade;\nvarying float vTerrainSteepness;`;
      const varyings = `${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `varying float vTerrainTextureMask${i};`).join("\n")}\nvarying float vTerrainDecorative;\nvarying vec4 vTerrainDecorativeEdges;\nvarying vec4 vTerrainDecorativeCorners;\nvarying float vTerrainOuterBackgroundFade;\nvarying float vTerrainSteepness;\nvarying float vTerrainRockExposure;\nvarying vec3 vWorldPosition;`;
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
      shader.vertexShader = shader.vertexShader
        .replace("vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;", "vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainSteepness = 1.0 - abs(normal.y);\nvTerrainRockExposure = fract(terrainDecorativeOuterEdges.w) * 4.0 - 2.0;")
        .replace("mod(terrainDecorativeOuterEdges, 2.0)", "mod(floor(terrainDecorativeOuterEdges), 2.0)")
        .replace("step(vec4(1.5), terrainDecorativeOuterEdges)", "step(vec4(1.5), floor(terrainDecorativeOuterEdges))");
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



// Use a face normal (rather than interpolated vertex normals) on steep
// terrain. This makes cliff triangles read as deliberate flat-shaded facets
// while plateau tops retain their normal ground/texture treatment.
vec3 terrainFaceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
terrainFaceNormal *= terrainFaceNormal.y < 0.0 ? -1.0 : 1.0;
float cliffShade = 1.0 - smoothstep(0.58, 0.74, abs(terrainFaceNormal.y));

// Rockify stores signed movement: positive is pushed out, negative is carved
// in. Recesses darken nonlinearly, so deeper Rockify In strokes read as
// properly occluded hollows rather than a flat grey surface.
float rockOutward = max(0.0, vTerrainRockExposure);
float rockInward = max(0.0, -vTerrainRockExposure);
float outwardLight = 0.0;// 1.0 - exp(-rockOutward  * 0.5);
float inwardOcclusion = 1.0 - exp(-rockInward *2.0);
// Fade the entire facet contribution in a deep stamp. This hides the mesh's
// thin normal/triangle streaks instead of making them visible as dark bands.
//float facetLight = (0.5 + outwardLight) * (1.0 - inwardOcclusion * 1.00);
//float facetLight2 = 0.68 + 0.32 * max(0.0, dot(terrainFaceNormal, normalize(vec3(-0.45, 0.78, 0.42))));

float facetLight = (0.50 + 0.25 * max(0.0, dot(terrainFaceNormal, normalize(vec3(-0.45, 0.78, 0.42))))+ outwardLight)* (1.0 - inwardOcclusion * 1.00);


// Texture-free broad forms keep the cliff modern and painted, not like a
// repeating rock-wall wallpaper. The variation is deliberately low-frequency.
float cliffMacro = 0.5 + 0.26 * sin(dot(vWorldPosition.xz, vec2(0.066, 0.042))) + 0.24 * sin(dot(vWorldPosition.xz, vec2(-0.030, 0.059)));
cliffShade = smoothstep(0.0, 1.0, cliffShade + (cliffMacro - 0.5) * 0.07);
// A very soft, warped tonal drift implies layers without forming evenly
// spaced stripes. Most breakup comes from broad sideways rock patches.
float cliffStrata = 0.91 + 0.09 * sin(vWorldPosition.y * 0.5 + sin(dot(vWorldPosition.xz, vec2(0.041, -0.030))) * 2.1);
float cliffPatch = smoothstep(0.34, 0.76, sin(dot(vWorldPosition.xz, vec2(0.047, -0.039))) + 0.48 * sin(dot(vWorldPosition.xz, vec2(-0.064, -0.022)) + vWorldPosition.y * 0.075));
vec3 rockColor = (mix(vec3(0.831, 0.710, 0.498), vec3(0.659, 0.565, 0.396), cliffMacro) * cliffStrata) * facetLight;
rockColor = mix(rockColor, vec3(0.31, 0.27, 0.24) * cliffStrata, cliffPatch * 0.40);



vec3 n = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));

vec3 blend = pow(abs(n), vec3(4.0));
blend /= max(blend.x + blend.y + blend.z, 0.0001);

float rockVariation =
    noise(vWorldPosition.yz * 2.00) * blend.x +
    noise(vWorldPosition.xz * 2.00) * blend.y +
    noise(vWorldPosition.xy * 2.00) * blend.z;

rockVariation = clamp(0.5 + (rockVariation - 0.5) * 8.0, 0.0, 1.0);

rockColor *= mix(1.04, 1.08, rockVariation);



terrainBaseColor = mix(terrainBaseColor, rockColor, cliffShade);












vec3 finalTerrainColor =
    ((terrainBaseColor+utint/1.5)) * max(0.0, 1.0 - terrainWeight)
    + terrainPaint;

   
                       
                    finalTerrainColor *=((-1.00+usun)*0.80)+1.0;


































diffuseColor.rgb = (finalTerrainColor * terrainTint);



`);
 shader.fragmentShader = shader.fragmentShader.replace("float cliffShade = 1.0 - smoothstep(0.58, 0.74, abs(terrainFaceNormal.y));", "float cliffShade = smoothstep(0.15, 0.36, vTerrainSteepness);");


        



        
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
    material.customProgramCacheKey = () => "next-world-chunked-terrain-textures-v26-stylized-cliff-balanced-variation";
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
