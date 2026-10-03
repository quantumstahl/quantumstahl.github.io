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
  }

  key(x, z) { return `${x},${z}`; }

  applyManifest(config) {
    this.config = config;
    this.chunkSize = config.chunkSize ?? this.chunkSize;
    this.material?.dispose();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      fog: true
    });
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
    return mesh;
  }

  unloadChunk(x, z) {
    const key = this.key(x, z);
    const tile = this.tiles.get(key);
    if (!tile) return;
    tile.mesh.removeFromParent();
    tile.mesh.geometry.dispose();
    this.tiles.delete(key);
  }

  clear() {
    for (const tile of this.tiles.values()) tile.mesh.geometry.dispose();
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
      const attributes = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `attribute float terrainTextureMask${i}; varying float vTerrainTextureMask${i};`).join("\n");
      const varyings = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `varying float vTerrainTextureMask${i};`).join("\n");
      const uniforms = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `uniform sampler2D terrainMap${i}; uniform float terrainMapScale${i};`).join("\n");
      const assignments = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `vTerrainTextureMask${i} = terrainTextureMask${i};`).join("\n");
      const samples = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `float terrainMask${i} = vTerrainTextureMask${i}; if (terrainMask${i} > 0.0001) { terrainWeight += terrainMask${i}; terrainPaint += texture2D(terrainMap${i}, vTerrainUv * terrainMapScale${i}).rgb * terrainMask${i}; }`).join("\n");
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\nvarying vec2 vTerrainUv;\n${attributes}`)
        .replace("#include <begin_vertex>", `vTerrainUv = uv;\n${assignments}\n#include <begin_vertex>`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec2 vTerrainUv;\n${varyings}\n${uniforms}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\nfloat terrainWeight = 0.0; vec3 terrainPaint = vec3(0.0);\n${samples}\ndiffuseColor.rgb = diffuseColor.rgb * max(0.0, 1.0 - terrainWeight) + terrainPaint;`);
      for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) {
        shader.uniforms[`terrainMap${index}`] = { value: material.userData.terrainTextures?.[index] ?? this.placeholderTexture };
        shader.uniforms[`terrainMapScale${index}`] = { value: material.userData.terrainTextureScales?.[index] ?? 1 };
      }
      material.userData.terrainShader = shader;
    };
    material.customProgramCacheKey = () => "next-world-chunked-terrain-textures-v1";
  }

  configureTexture(texture, scale) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(scale, scale);
    texture.anisotropy = 8;
    return texture;
  }

  loadTextures(layers = []) {
    for (const layer of layers.slice(0, MAX_TEXTURE_LAYERS)) if (layer?.src && !this.textures.has(layer.src)) {
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
    const shader = this.material.userData.terrainShader;
    if (!shader) { this.material.needsUpdate = true; return; }
    for (let index = 0; index < MAX_TEXTURE_LAYERS; index++) {
      shader.uniforms[`terrainMap${index}`].value = this.material.userData.terrainTextures[index];
      shader.uniforms[`terrainMapScale${index}`].value = this.material.userData.terrainTextureScales[index];
    }
  }
}
