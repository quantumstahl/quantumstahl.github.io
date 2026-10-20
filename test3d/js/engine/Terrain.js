import * as THREE from "three";

const MAX_TEXTURE_LAYERS = 8;
// Preserve the editor's original ~1m terrain grid when maps are enlarged.
// A 200m, 192-segment map can therefore grow to 2,000m at 1,920 segments.
const MAX_TERRAIN_SEGMENTS = 2048;

// Keep the legacy, single-mesh terrain compatible with the streamed terrain
// brush.  This noise is world-space and deterministic, so a brush pass can
// be built up gradually without changing its underlying formation.
const rockHash = (x, z) => {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};
const smoothNoise = (x, z) => {
  const x0 = Math.floor(x), z0 = Math.floor(z), tx = x - x0, tz = z - z0;
  const fade = value => value * value * (3 - 2 * value);
  const a = rockHash(x0, z0), b = rockHash(x0 + 1, z0);
  const c = rockHash(x0, z0 + 1), d = rockHash(x0 + 1, z0 + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, fade(tx)), THREE.MathUtils.lerp(c, d, fade(tx)), fade(tz));
};
const rockFormation = (x, z) => {
  const broad = smoothNoise(x * .115, z * .115);
  const ridge = 1 - Math.abs(smoothNoise(x * .19 + z * .07, z * .19 - x * .07) * 2 - 1);
  const detail = smoothNoise(x * .52 - z * .13, z * .52 + x * .13);
  const crevice = Math.max(0, (detail - .68) / .32);
  return broad * .52 + ridge * .38 + detail * .16 - .45 - crevice * .48;
};

export class Terrain {
  constructor(scene) { this.scene = scene; this.mesh = null; this.signature = ""; this.textureLoader = new THREE.TextureLoader(); this.textures = new Map(); this.placeholderTexture = new THREE.Texture(); }
  apply(config) {
    if (!config?.enabled) { this.mesh?.removeFromParent(); return; }
    const signature = `${config.size}:${config.segments}:${config.color}`;
    if (this.signature !== signature || !this.mesh) {
      this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); this.mesh?.material.dispose(); this.mesh?.userData.shadowOverlay?.material.dispose();
       const geometry = new THREE.PlaneGeometry(config.size, config.size, config.segments, config.segments); geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, fog: true }); (material.extensions ??= {}).derivatives = true; this.configureTextureBlend(material);
      this.mesh = new THREE.Mesh(geometry, material); this.mesh.name = "Terrain"; this.mesh.receiveShadow = true; this.mesh.userData.isTerrain = true;
      const shadowMaterial = new THREE.ShadowMaterial({ opacity: .48, transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const shadowOverlay = new THREE.Mesh(geometry, shadowMaterial); shadowOverlay.name = "Terrain real shadow receiver"; shadowOverlay.receiveShadow = true; shadowOverlay.renderOrder = 1; this.mesh.add(shadowOverlay); this.mesh.userData.shadowOverlay = shadowOverlay;
      this.scene.add(this.mesh); this.signature = signature;
    }
    this.config = config; this.updateHeights(config); this.updateColors(config); this.updateTextureMasks(config); this.loadTextures(config.textures);
  }
  updateHeights(config) { const positions = this.mesh?.geometry.getAttribute("position"); if (!positions) return; config.xOffsets ??= []; config.zOffsets ??= []; for (let i = 0; i < positions.count; i++) { const x = i % (config.segments + 1), z = Math.floor(i / (config.segments + 1)); positions.setX(i, -config.size / 2 + x * config.size / config.segments + (config.xOffsets[i] ?? 0)); positions.setY(i, config.heights[i] ?? 0); positions.setZ(i, -config.size / 2 + z * config.size / config.segments + (config.zOffsets[i] ?? 0)); } positions.needsUpdate = true; this.mesh.geometry.computeVertexNormals(); this.updateSteepnessAttribute(); }
  updateSteepnessAttribute() { const geometry = this.mesh?.geometry, normals = geometry?.getAttribute("normal"); if (!normals) return; let steepness = geometry.getAttribute("terrainSteepness"); if (!steepness) { steepness = new THREE.BufferAttribute(new Float32Array(normals.count), 1); geometry.setAttribute("terrainSteepness", steepness); } for (let i = 0; i < normals.count; i++) steepness.setX(i, 1 - Math.abs(normals.getY(i))); steepness.needsUpdate = true; }
  updateColors(config) { if (!this.mesh) return; const geometry = this.mesh.geometry; let colors = geometry.getAttribute("color"); if (!colors) { colors = new THREE.BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 3), 3); geometry.setAttribute("color", colors); } const color = new THREE.Color(); for (let i = 0; i < colors.count; i++) { color.setHex(config.colors[i] ?? config.color); colors.setXYZ(i, color.r, color.g, color.b); } colors.needsUpdate = true; }
  updateTextureMasks(config) { if (!this.mesh) return; const geometry = this.mesh.geometry, count = geometry.getAttribute("position").count; for (let layer = 0; layer < MAX_TEXTURE_LAYERS; layer++) { let mask = geometry.getAttribute(`terrainTextureMask${layer}`); if (!mask) { mask = new THREE.BufferAttribute(new Float32Array(count), 1); geometry.setAttribute(`terrainTextureMask${layer}`, mask); } const values = config.textures?.[layer]?.mask ?? []; for (let i = 0; i < count; i++) mask.setX(i, values[i] ?? 0); mask.needsUpdate = true; } }
  configureTextureBlend(material) {
    material.onBeforeCompile = shader => {
      // Always compile eight slots. This prevents Three.js from retaining a
      // one-texture shader program when layers are added during editing.
      const attributes = `varying vec2 vTerrainUv;\nvarying vec3 vTerrainWorldPosition;\nvarying float vTerrainSteepness;\nattribute float terrainSteepness;\n${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `attribute float terrainTextureMask${i};\nvarying float vTerrainTextureMask${i};`).join("\n")}`;
      const varyings = `varying vec2 vTerrainUv;\nvarying vec3 vTerrainWorldPosition;\nvarying float vTerrainSteepness;\n${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `varying float vTerrainTextureMask${i};`).join("\n")}`;
      const assignments = `vTerrainUv = uv;\n${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `vTerrainTextureMask${i} = terrainTextureMask${i};`).join("\n")}`;
      const uniforms = `${Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `uniform sampler2D terrainMap${i};\nuniform float terrainMapScale${i};`).join("\n")}\nuniform sampler2D terrainBaseMap;\nuniform float terrainBaseMapScale;\nuniform float terrainHasBaseMap;`;
      // Most of the terrain only has one painted layer. Avoid sampling all
      // eight textures for every terrain fragment, especially on mobile GPUs.
      const samples = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => `float terrainMask${i} = vTerrainTextureMask${i}; if (terrainMask${i} > 0.0001) { vec3 terrainColor${i} = texture2D(terrainMap${i}, vTerrainUv * terrainMapScale${i}).rgb; terrainWeight += terrainMask${i}; terrainPaint += terrainColor${i} * terrainMask${i}; }`).join("\n        ");
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${attributes}`).replace("#include <begin_vertex>", `${assignments}\n#include <begin_vertex>\nvTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.vertexShader = shader.vertexShader.replace("vTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;", "vTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainSteepness = terrainSteepness;");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${varyings}\n${uniforms}`).replace("#include <color_fragment>", `#include <color_fragment>\n        vec3 terrainBaseColor = terrainHasBaseMap > 0.5 ? texture2D(terrainBaseMap, vTerrainUv * terrainBaseMapScale).rgb : diffuseColor.rgb;\n        float terrainWeight = 0.0; vec3 terrainPaint = vec3(0.0);\n        ${samples}\n        vec3 finalTerrainColor = terrainBaseColor * max(0.0, 1.0 - terrainWeight) + terrainPaint;\n        vec3 terrainFaceNormal = normalize(cross(dFdx(vTerrainWorldPosition), dFdy(vTerrainWorldPosition)));\n        terrainFaceNormal *= terrainFaceNormal.y < 0.0 ? -1.0 : 1.0;\n        float cliffShade = 1.0 - smoothstep(0.58, 0.74, abs(terrainFaceNormal.y));\n        float facetLight = 0.68 + 0.32 * max(0.0, dot(terrainFaceNormal, normalize(vec3(-0.45, 0.78, 0.42))));\n        vec3 rockColor = finalTerrainColor;\n        if (cliffShade > 0.001) {\n          vec2 cliffUvX = vTerrainWorldPosition.zy * 0.18;\n          vec2 cliffUvZ = vTerrainWorldPosition.xy * 0.18;\n          vec2 cliffBlend = pow(abs(terrainFaceNormal.xz), vec2(4.0));\n          cliffBlend /= max(0.0001, cliffBlend.x + cliffBlend.y);\n          vec3 cliffRock = texture2D(terrainCliffMap, cliffUvX).rgb * cliffBlend.x + texture2D(terrainCliffMap, cliffUvZ).rgb * cliffBlend.y;\n          float cliffVariation = 0.92 + 0.08 * sin(dot(vTerrainWorldPosition.xz, vec2(0.047, 0.031)));\n          float cliffStrata = 0.92 + 0.08 * sin(vTerrainWorldPosition.y * 1.35 + sin(dot(vTerrainWorldPosition.xz, vec2(0.13, 0.09))));\n          rockColor = cliffRock * cliffVariation * cliffStrata * facetLight;\n        }\n        diffuseColor.rgb = mix(finalTerrainColor, rockColor, cliffShade);`);
      shader.fragmentShader = shader.fragmentShader.replace(`vec3 rockColor = finalTerrainColor;
        if (cliffShade > 0.001) {
          vec2 cliffUvX = vTerrainWorldPosition.zy * 0.18;
          vec2 cliffUvZ = vTerrainWorldPosition.xy * 0.18;
          vec2 cliffBlend = pow(abs(terrainFaceNormal.xz), vec2(4.0));
          cliffBlend /= max(0.0001, cliffBlend.x + cliffBlend.y);
          vec3 cliffRock = texture2D(terrainCliffMap, cliffUvX).rgb * cliffBlend.x + texture2D(terrainCliffMap, cliffUvZ).rgb * cliffBlend.y;
          float cliffVariation = 0.92 + 0.08 * sin(dot(vTerrainWorldPosition.xz, vec2(0.047, 0.031)));
          float cliffStrata = 0.92 + 0.08 * sin(vTerrainWorldPosition.y * 1.35 + sin(dot(vTerrainWorldPosition.xz, vec2(0.13, 0.09))));
          rockColor = cliffRock * cliffVariation * cliffStrata * facetLight;
        }`, `float cliffMacro = 0.5 + 0.26 * sin(dot(vTerrainWorldPosition.xz, vec2(0.066, 0.042))) + 0.24 * sin(dot(vTerrainWorldPosition.xz, vec2(-0.030, 0.059)));
        cliffShade = smoothstep(0.0, 1.0, cliffShade + (cliffMacro - 0.5) * 0.07);
        float cliffStrata = 0.91 + 0.09 * sin(vTerrainWorldPosition.y * 0.52 + sin(dot(vTerrainWorldPosition.xz, vec2(0.041, -0.030))) * 2.1);
        float cliffPatch = smoothstep(0.34, 0.76, sin(dot(vTerrainWorldPosition.xz, vec2(0.047, -0.039))) + 0.48 * sin(dot(vTerrainWorldPosition.xz, vec2(-0.064, -0.022)) + vTerrainWorldPosition.y * 0.075));
        vec3 rockColor = mix(vec3(0.24, 0.20, 0.18), vec3(0.61, 0.49, 0.35), cliffMacro) * cliffStrata * facetLight;
        rockColor = mix(rockColor, vec3(0.31, 0.27, 0.24) * cliffStrata, cliffPatch * 0.40);
        float mossBand = smoothstep(0.16, 0.48, cliffShade) * (1.0 - smoothstep(0.46, 0.82, cliffShade));
        rockColor = mix(rockColor, vec3(0.31, 0.43, 0.21), mossBand * 0.34);`);
      shader.fragmentShader = shader.fragmentShader.replace("float cliffShade = 1.0 - smoothstep(0.58, 0.74, abs(terrainFaceNormal.y));", "float cliffShade = smoothstep(0.15, 0.36, vTerrainSteepness);");
      for (let i = 0; i < MAX_TEXTURE_LAYERS; i++) {
        shader.uniforms[`terrainMap${i}`] = { value: material.userData.terrainTextures?.[i] ?? this.placeholderTexture };
        shader.uniforms[`terrainMapScale${i}`] = { value: material.userData.terrainTextureScales?.[i] ?? 1 };
      }
      shader.uniforms.terrainBaseMap = { value: material.userData.terrainBaseTexture ?? this.placeholderTexture };
      shader.uniforms.terrainBaseMapScale = { value: material.userData.terrainBaseTextureScale ?? 1 };
      shader.uniforms.terrainHasBaseMap = { value: material.userData.terrainBaseTexture ? 1 : 0 };
      material.userData.terrainShader = shader;
    };
    material.customProgramCacheKey = () => "next-world-terrain-eight-texture-slots-v11-stylized-cliff-balanced-variation";
  }
  configureTexture(texture, scale) { texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(scale, scale); texture.anisotropy = 8; return texture; }
  loadTextures(layers = []) { for (const layer of [this.config?.baseTexture, ...layers.slice(0, MAX_TEXTURE_LAYERS)]) if (layer?.src && !this.textures.has(layer.src)) this.textureLoader.load(layer.src, texture => { this.textures.set(layer.src, this.configureTexture(texture, layer.scale)); this.applyTextures(); }, undefined, () => console.warn(`Could not load terrain texture: ${layer.src}`)); this.applyTextures(layers); }
  loadTextureFile(file, savedPath, scale = 8) { const url = URL.createObjectURL(file); this.textureLoader.load(url, texture => { URL.revokeObjectURL(url); this.textures.get(savedPath)?.dispose(); this.textures.set(savedPath, this.configureTexture(texture, scale)); this.applyTextures(); }, undefined, () => URL.revokeObjectURL(url)); }
  applyTextures(layers) { if (!this.mesh) return; const sourceLayers = layers ?? this.mesh.userData.terrainLayers ?? []; this.mesh.userData.terrainLayers = sourceLayers; const material = this.mesh.material; material.userData.terrainTextures = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => this.textures.get(sourceLayers[i]?.src) ?? this.placeholderTexture); material.userData.terrainTextureScales = Array.from({ length: MAX_TEXTURE_LAYERS }, (_, i) => sourceLayers[i]?.scale ?? 1); const baseTexture = this.config?.baseTexture; material.userData.terrainBaseTexture = baseTexture?.src ? this.textures.get(baseTexture.src) ?? null : null; material.userData.terrainBaseTextureScale = baseTexture?.scale ?? 1; material.map = null; const shader = material.userData.terrainShader; if (!shader) { material.needsUpdate = true; return; } for (let i = 0; i < MAX_TEXTURE_LAYERS; i++) { shader.uniforms[`terrainMap${i}`].value = material.userData.terrainTextures[i]; shader.uniforms[`terrainMapScale${i}`].value = material.userData.terrainTextureScales[i]; } shader.uniforms.terrainBaseMap.value = material.userData.terrainBaseTexture ?? this.placeholderTexture; shader.uniforms.terrainBaseMapScale.value = material.userData.terrainBaseTextureScale; shader.uniforms.terrainHasBaseMap.value = material.userData.terrainBaseTexture ? 1 : 0; }
  sculpt(config, point, radius, amount, mode, flattenHeight = 0) { if (!this.mesh || radius <= 0) return false; const positions = this.mesh.geometry.getAttribute("position"), heights = config.heights, width = config.segments + 1, before = mode === "smooth" ? heights.slice() : null; config.xOffsets ??= []; config.zOffsets ??= []; let changed = false; for (let i = 0; i < positions.count; i++) { const xPosition = positions.getX(i), zPosition = positions.getZ(i), distance = Math.hypot(xPosition - point.x, zPosition - point.z); if (distance > radius) continue; const weight = (1 - distance / radius) ** 2; if (weight <= 0) continue; if (mode === "smooth") { const x = i % width, z = Math.floor(i / width); let total = before[i], count = 1; for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, z > 0 ? i - width : -1, z < width - 1 ? i + width : -1]) if (n >= 0) { total += before[n]; count++; } heights[i] += (total / count - heights[i]) * Math.min(1, amount * 3) * weight; } else if (mode === "flatten") heights[i] += (flattenHeight - heights[i]) * Math.min(1, amount * 3) * weight; else if (mode === "rockify") { const displacement = amount * rockFormation(xPosition, zPosition) * weight, angle = rockHash(xPosition * .37, zPosition * .37) * Math.PI * 2; config.xOffsets[i] = (config.xOffsets[i] ?? 0) + Math.cos(angle) * displacement; config.zOffsets[i] = (config.zOffsets[i] ?? 0) + Math.sin(angle) * displacement; } else heights[i] += amount * weight; changed = true; } if (changed) this.updateHeights(config); return changed; }
  paint(config, point, radius, colorHex, strength) { if (!this.mesh || radius <= 0) return false; const positions = this.mesh.geometry.getAttribute("position"), from = new THREE.Color(), target = new THREE.Color(colorHex); let changed = false; for (let i = 0; i < positions.count; i++) { const d = Math.hypot(positions.getX(i) - point.x, positions.getZ(i) - point.z); if (d > radius) continue; from.setHex(config.colors[i] ?? config.color).lerp(target, Math.min(1, strength * (1 - d / radius) ** 2)); config.colors[i] = from.getHex(); changed = true; } if (changed) this.updateColors(config); return changed; }
  paintTexture(config, point, radius, strength) { const active = config.activeTexture ?? 0, layers = config.textures ?? []; if (!this.mesh || radius <= 0 || !layers[active]?.src) return false; const positions = this.mesh.geometry.getAttribute("position"); let changed = false; for (let i = 0; i < positions.count; i++) { const d = Math.hypot(positions.getX(i) - point.x, positions.getZ(i) - point.z); if (d > radius) continue; const add = Math.min(1, strength * (1 - d / radius) ** 2), current = layers[active].mask[i] ?? 0, next = Math.min(1, current + add), reduction = Math.max(0, 1 - next) / Math.max(.0001, 1 - current); for (let layer = 0; layer < layers.length; layer++) if (layer !== active) layers[layer].mask[i] = (layers[layer].mask[i] ?? 0) * reduction; layers[active].mask[i] = next; changed = true; } if (changed) this.updateTextureMasks(config); return changed; }
  resize(config, newSize) {
    const oldSize = config.size;
    const sizeRatio = newSize / oldSize;
    const segments = config.segments;
    const newSegments = THREE.MathUtils.clamp(
      Math.round(segments * sizeRatio),
      8,
      MAX_TERRAIN_SEGMENTS
    );
    const width = segments + 1;
    const newWidth = newSegments + 1;
    const oldHeights = config.heights.slice();
    const oldXOffsets = config.xOffsets?.slice() ?? [];
    const oldZOffsets = config.zOffsets?.slice() ?? [];
    const oldColors = config.colors.slice();
    const oldMasks = config.textures.map(layer => layer.mask.slice());

    // Bilinear sampling preserves sculpted slopes and painted masks when the
    // terrain grid is rebuilt at a new resolution.
    const sample = (values, x, z, fallback = 0) => {
      if (x < 0 || z < 0 || x > segments || z > segments) return fallback;
      const x0 = Math.floor(x), z0 = Math.floor(z);
      const x1 = Math.min(segments, x0 + 1), z1 = Math.min(segments, z0 + 1);
      const tx = x - x0, tz = z - z0;
      const valueAt = (column, row) => values[row * width + column] ?? fallback;
      return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(valueAt(x0, z0), valueAt(x1, z0), tx),
        THREE.MathUtils.lerp(valueAt(x0, z1), valueAt(x1, z1), tx),
        tz
      );
    };
    const remap = (values, fallback) => Array.from({ length: newWidth * newWidth }, (_, i) => {
      const x = i % newWidth, z = Math.floor(i / newWidth);
      // Keep the existing landscape at its current world size in the centre.
      // Positions outside the former bounds become new, flat map area rather
      // than stretching every hill and painted texture across the larger map.
      const wx = (x / newSegments - .5) * newSize;
      const wz = (z / newSegments - .5) * newSize;
      return sample(
        values,
        (wx / oldSize + .5) * segments,
        (wz / oldSize + .5) * segments,
        fallback
      );
    });

    config.heights = remap(oldHeights, 0);
    config.xOffsets = remap(oldXOffsets, 0);
    config.zOffsets = remap(oldZOffsets, 0);
    config.colors = remap(oldColors, config.color);
    config.textures.forEach((layer, i) => {
      layer.mask = remap(oldMasks[i], 0);
      // Layer scale is repeats across the terrain. Increase it with world
      // size so a grass/rock tile stays the same number of metres wide.
      layer.scale = Math.max(0.01, (Number(layer.scale) || 16) * sizeRatio);
    });
    config.size = newSize;
    config.segments = newSegments;
    this.signature = "";
    this.apply(config);
  }
  getHeightAt(point) { const config = this.config; if (!config) return 0; const width = config.segments + 1, gridX = THREE.MathUtils.clamp((point.x / config.size + .5) * config.segments, 0, config.segments), gridZ = THREE.MathUtils.clamp((point.z / config.size + .5) * config.segments, 0, config.segments), x0 = Math.floor(gridX), z0 = Math.floor(gridZ), x1 = Math.min(config.segments, x0 + 1), z1 = Math.min(config.segments, z0 + 1), tx = gridX - x0, tz = gridZ - z0, h00 = config.heights[z0 * width + x0] ?? 0, h10 = config.heights[z0 * width + x1] ?? 0, h01 = config.heights[z1 * width + x0] ?? 0, h11 = config.heights[z1 * width + x1] ?? 0; return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h00, h10, tx), THREE.MathUtils.lerp(h01, h11, tx), tz); }
}
