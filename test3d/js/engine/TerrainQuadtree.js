import * as THREE from "three";
import { TERRAIN_HEIGHT_GLSL } from "../terrain/TerrainHeight.js";
import { ROCK_APPEARANCE_GLSL } from "./RockAppearance.js";
import { TERRAIN_MATERIAL_GLSL } from "../terrain/TerrainMaterialShader.js";

const GRID_RESOLUTION = 32;
const ROOT_SIZE = 8192;
const MIN_PATCH_SIZE = 64;
// The balanced quadtree needs headroom around the camera. At 280 leaves the
// selection can exhaust its split budget before nearby neighbours resolve,
// leaving a coarse patch beside fine terrain after travelling away and back.
// 500 remains a fixed upper bound (not a per-frame allocation) and preserves
// the camera-priority LOD policy without the old debug override.
const MAX_PATCHES = 500;
const TERRAIN_MIN_Y = -220;
const TERRAIN_MAX_Y = 720;
const DEFAULT_WARP_LOD = {
  distance: 900,
  minGradient: .15,
  guardBand: 128,
  hysteresis: .18,
};

const DEFAULT_ATMOSPHERE = {
  color: 0xa9bdc9,
  start: 3000,
  end: 5200,
  strength: 0.42,
};

function createPatchGeometry() {
  const positions = [];
  const indices = [];
  const row = GRID_RESOLUTION + 1;
  for (let z = 0; z <= GRID_RESOLUTION; z++) for (let x = 0; x <= GRID_RESOLUTION; x++) {
    positions.push(x / GRID_RESOLUTION, 0, z / GRID_RESOLUTION);
  }
  for (let z = 0; z < GRID_RESOLUTION; z++) for (let x = 0; x < GRID_RESOLUTION; x++) {
    const a = z * row + x, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createTerrainMaterial(atmosphere, heightCache, materialCache) {
  const heightUniforms = heightCache.uniforms;
  const emptyRockSourceMask = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  emptyRockSourceMask.needsUpdate = true;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...materialCache?.uniforms,
      uAtmosphereColor: { value: new THREE.Color(atmosphere.color) },
      uAtmosphereStart: { value: atmosphere.start },
      uAtmosphereEnd: { value: atmosphere.end },
      uAtmosphereStrength: { value: atmosphere.strength },
      uHeightTiles: { value: heightUniforms.texture },
      uWarpTiles: { value: heightUniforms.warpTexture },
      uRockExposureTiles: { value: heightUniforms.rockExposureTexture },
      uHeightTileCoordinates: { value: heightUniforms.tileCoordinates },
      uHeightTileSize: { value: heightUniforms.tileSize },
      uHeightTileSegments: { value: heightUniforms.tileSegments },
      uCoarseHeight: { value: heightUniforms.coarseTexture },
      uCoarseWarp: { value: heightUniforms.coarseWarpTexture },
      uCoarseRockExposure: { value: heightUniforms.coarseExposureTexture },
      uCoarseHeightOrigin: { value: heightUniforms.coarseOrigin },
      uCoarseHeightSize: { value: heightUniforms.coarseSize },
      uCoarseHeightEnabled: { value: false },
      uFallbackHeight: { value: heightUniforms.fallbackTexture },
      uFallbackWarp: { value: heightUniforms.fallbackWarpTexture },
      uFallbackRockExposure: { value: heightUniforms.fallbackExposureTexture },
      uFallbackTileMap: { value: heightUniforms.fallbackTileMap },
      uFallbackMapOrigin: { value: heightUniforms.fallbackMapOrigin },
      uFallbackMapExtent: { value: heightUniforms.fallbackMapExtent },
      uFallbackTileMapSize: { value: 64 },
      uFallbackTileSamples: { value: heightUniforms.fallbackSamples },
      uFallbackEnabled: { value: false },
      uRockSourceMask: { value: emptyRockSourceMask },
      uRockSourceMaskOrigin: { value: new THREE.Vector2() },
      uRockSourceMaskCellSize: { value: 2 },
      uRockSourceMaskResolution: { value: new THREE.Vector2(1, 1) },
      uRockSourceMaskBoundaryMargin: { value: .5 },
      uRockSourceMaskEnabled: { value: false },
    },
    glslVersion: THREE.GLSL3,
    vertexShader: `
      out float vHeight;
      out float vRockExposure;
      out float vRockCoverage;
      out float vTerrainSurface;
      out vec3 vWorldPosition;
      out vec2 vSourcePosition;
      uniform highp sampler2DArray uHeightTiles;
      uniform highp sampler2DArray uWarpTiles;
      uniform highp sampler2DArray uRockExposureTiles;
      uniform ivec2 uHeightTileCoordinates[${heightUniforms.layerCount}];
      uniform float uHeightTileSize;
      uniform int uHeightTileSegments;
      uniform sampler2D uCoarseHeight;
      uniform sampler2D uCoarseWarp;
      uniform sampler2D uCoarseRockExposure;
      uniform vec2 uCoarseHeightOrigin;
      uniform vec2 uCoarseHeightSize;
      uniform bool uCoarseHeightEnabled;
      uniform highp sampler2DArray uFallbackHeight;
      uniform highp sampler2DArray uFallbackWarp;
      uniform highp sampler2DArray uFallbackRockExposure;
      uniform sampler2D uFallbackTileMap;
      uniform vec2 uFallbackMapOrigin;
      uniform vec2 uFallbackMapExtent;
      uniform int uFallbackTileMapSize;
      uniform int uFallbackTileSamples;
      uniform bool uFallbackEnabled;
      ${TERRAIN_HEIGHT_GLSL}
      int fallbackLayerForTile(ivec2 tileCoordinate) {
        if (!uFallbackEnabled) return -1;
        ivec2 mapCoordinate = tileCoordinate - ivec2(uFallbackMapOrigin);
        if (any(lessThan(mapCoordinate, ivec2(0))) || mapCoordinate.x >= int(uFallbackMapExtent.x) || mapCoordinate.y >= int(uFallbackMapExtent.y)) return -1;
        return int(texelFetch(uFallbackTileMap, mapCoordinate, 0).r + .5) - 1;
      }
      vec2 fallbackSamplePosition(vec2 position, vec2 tileOrigin) {
        return clamp((position - tileOrigin) / uHeightTileSize * float(uFallbackTileSamples - 1), 0.0, float(uFallbackTileSamples - 1));
      }
      vec2 coarseSampleUv(vec2 position) {
        vec2 tilePosition = (position - uCoarseHeightOrigin) / uHeightTileSize;
        vec2 tile = floor(tilePosition);
        vec2 tileCount = uCoarseHeightSize / uHeightTileSize;
        if (any(lessThan(tile, vec2(0.0))) || any(greaterThanEqual(tile, tileCount))) return vec2(-1.0);
        // Each tile has its own duplicated borders. Sample texel centres so
        // linear filtering cannot leak into an empty or unrelated tile.
        vec2 samples = vec2(textureSize(uCoarseHeight, 0)) / tileCount;
        return (tile * samples + fract(tilePosition) * (samples - 1.0) + .5) / vec2(textureSize(uCoarseHeight, 0));
      }
      float terrainDataDelta(vec2 position, out bool fullResolutionResident) {
        fullResolutionResident = false;
        ivec2 tileCoordinate = ivec2(floor(position / uHeightTileSize));
        vec2 tileOrigin = vec2(tileCoordinate) * uHeightTileSize;
        vec2 samplePosition = clamp((position - tileOrigin) / uHeightTileSize * float(uHeightTileSegments), 0.0, float(uHeightTileSegments));
        ivec2 sample0 = ivec2(floor(samplePosition));
        ivec2 sample1 = min(sample0 + ivec2(1), ivec2(uHeightTileSegments));
        vec2 fraction = samplePosition - vec2(sample0);
        for (int layer = 0; layer < ${heightUniforms.layerCount}; layer += 1) {
          if (all(equal(tileCoordinate, uHeightTileCoordinates[layer]))) {
            fullResolutionResident = true;
            float a = texelFetch(uHeightTiles, ivec3(sample0, layer), 0).r;
            float b = texelFetch(uHeightTiles, ivec3(sample1.x, sample0.y, layer), 0).r;
            float c = texelFetch(uHeightTiles, ivec3(sample0.x, sample1.y, layer), 0).r;
            float d = texelFetch(uHeightTiles, ivec3(sample1, layer), 0).r;
            return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
          }
        }
        int fallbackLayer = fallbackLayerForTile(tileCoordinate);
        if (fallbackLayer >= 0) {
          vec2 fallbackPosition = fallbackSamplePosition(position, tileOrigin);
          ivec2 sample0 = ivec2(floor(fallbackPosition));
          ivec2 sample1 = min(sample0 + ivec2(1), ivec2(uFallbackTileSamples - 1));
          vec2 fraction = fallbackPosition - vec2(sample0);
          float a = texelFetch(uFallbackHeight, ivec3(sample0, fallbackLayer), 0).r;
          float b = texelFetch(uFallbackHeight, ivec3(sample1.x, sample0.y, fallbackLayer), 0).r;
          float c = texelFetch(uFallbackHeight, ivec3(sample0.x, sample1.y, fallbackLayer), 0).r;
          float d = texelFetch(uFallbackHeight, ivec3(sample1, fallbackLayer), 0).r;
          return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
        }
        if (uCoarseHeightEnabled) {
          vec2 coarseUv = coarseSampleUv(position);
          if (all(greaterThanEqual(coarseUv, vec2(0.0))) && all(lessThanEqual(coarseUv, vec2(1.0)))) {
            vec2 coarse = texture(uCoarseHeight, coarseUv).rg;
            if (coarse.g > .5) return coarse.r;
          }
        }
        return 0.0;
      }
      vec2 terrainDataWarp(vec2 position) {
        ivec2 tileCoordinate = ivec2(floor(position / uHeightTileSize));
        vec2 tileOrigin = vec2(tileCoordinate) * uHeightTileSize;
        vec2 samplePosition = clamp((position - tileOrigin) / uHeightTileSize * float(uHeightTileSegments), 0.0, float(uHeightTileSegments));
        ivec2 sample0 = ivec2(floor(samplePosition));
        ivec2 sample1 = min(sample0 + ivec2(1), ivec2(uHeightTileSegments));
        vec2 fraction = samplePosition - vec2(sample0);
        for (int layer = 0; layer < ${heightUniforms.layerCount}; layer += 1) {
          if (all(equal(tileCoordinate, uHeightTileCoordinates[layer]))) {
            vec2 a = texelFetch(uWarpTiles, ivec3(sample0, layer), 0).rg;
            vec2 b = texelFetch(uWarpTiles, ivec3(sample1.x, sample0.y, layer), 0).rg;
            vec2 c = texelFetch(uWarpTiles, ivec3(sample0.x, sample1.y, layer), 0).rg;
            vec2 d = texelFetch(uWarpTiles, ivec3(sample1, layer), 0).rg;
            return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
          }
        }
        int fallbackLayer = fallbackLayerForTile(tileCoordinate);
        if (fallbackLayer >= 0) {
          vec2 fallbackPosition = fallbackSamplePosition(position, tileOrigin);
          ivec2 sample0 = ivec2(floor(fallbackPosition));
          ivec2 sample1 = min(sample0 + ivec2(1), ivec2(uFallbackTileSamples - 1));
          vec2 fraction = fallbackPosition - vec2(sample0);
          vec2 a = texelFetch(uFallbackWarp, ivec3(sample0, fallbackLayer), 0).rg;
          vec2 b = texelFetch(uFallbackWarp, ivec3(sample1.x, sample0.y, fallbackLayer), 0).rg;
          vec2 c = texelFetch(uFallbackWarp, ivec3(sample0.x, sample1.y, fallbackLayer), 0).rg;
          vec2 d = texelFetch(uFallbackWarp, ivec3(sample1, fallbackLayer), 0).rg;
          return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
        }
        if (uCoarseHeightEnabled) {
          vec2 coarseUv = coarseSampleUv(position);
          if (all(greaterThanEqual(coarseUv, vec2(0.0))) && all(lessThanEqual(coarseUv, vec2(1.0))) && texture(uCoarseHeight, coarseUv).g > .5) {
            return texture(uCoarseWarp, coarseUv).rg;
          }
        }
        return vec2(0.0);
      }
      vec2 terrainDataRockExposure(vec2 position) {
    ivec2 tileCoordinate = ivec2(floor(position / uHeightTileSize));
    vec2 tileOrigin = vec2(tileCoordinate) * uHeightTileSize;

    vec2 samplePosition = clamp(
        (position - tileOrigin) / uHeightTileSize *
        float(uHeightTileSegments),
        0.0,
        float(uHeightTileSegments)
    );

    ivec2 sample0 = ivec2(floor(samplePosition));
    ivec2 sample1 = min(
        sample0 + ivec2(1),
        ivec2(uHeightTileSegments)
    );

    vec2 fraction = samplePosition - vec2(sample0);

    for (int layer = 0; layer < ${heightUniforms.layerCount}; layer++) {
        if (all(equal(tileCoordinate, uHeightTileCoordinates[layer]))) {

            float a = texelFetch(uRockExposureTiles, ivec3(sample0, layer), 0).r;
            float b = texelFetch(uRockExposureTiles, ivec3(sample1.x, sample0.y, layer), 0).r;
            float c = texelFetch(uRockExposureTiles, ivec3(sample0.x, sample1.y, layer), 0).r;
            float d = texelFetch(uRockExposureTiles, ivec3(sample1, layer), 0).r;

            vec2 signedValues = vec2(
                mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y),
                mix(mix(abs(a), abs(b), fraction.x),
                    mix(abs(c), abs(d), fraction.x), fraction.y)
            );

            return signedValues;
        }
    }

    int fallbackLayer = fallbackLayerForTile(tileCoordinate);
    if (fallbackLayer >= 0) {
        vec2 fallbackPosition = fallbackSamplePosition(position, tileOrigin);
        ivec2 sample0 = ivec2(floor(fallbackPosition));
        ivec2 sample1 = min(sample0 + ivec2(1), ivec2(uFallbackTileSamples - 1));
        vec2 fraction = fallbackPosition - vec2(sample0);
        float a = texelFetch(uFallbackRockExposure, ivec3(sample0, fallbackLayer), 0).r;
        float b = texelFetch(uFallbackRockExposure, ivec3(sample1.x, sample0.y, fallbackLayer), 0).r;
        float c = texelFetch(uFallbackRockExposure, ivec3(sample0.x, sample1.y, fallbackLayer), 0).r;
        float d = texelFetch(uFallbackRockExposure, ivec3(sample1, fallbackLayer), 0).r;
        float exposure = mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
        float coverage = mix(mix(abs(a), abs(b), fraction.x), mix(abs(c), abs(d), fraction.x), fraction.y);
        return vec2(exposure, coverage);
    }

    if (uCoarseHeightEnabled) {
        vec2 coarseUv = coarseSampleUv(position);
        if (all(greaterThanEqual(coarseUv, vec2(0.0))) && all(lessThanEqual(coarseUv, vec2(1.0))) && texture(uCoarseHeight, coarseUv).g > .5) {
            return texture(uCoarseRockExposure, coarseUv).rg;
        }
    }
    return vec2(0.0);
}
      void main() {
        vec4 local = vec4(position, 1.0);
        // The unused affine matrix component [1][3] carries a four-bit edge
        // mask: west=1, east=2, north=4, south=8. It has no transform effect
        // because terrain vertices have local Y=0. Fine 2:1 edges snap their
        // odd samples to the coarser neighbour before data sampling.
        vec2 patchUv = position.xz;
        float mask = floor(instanceMatrix[1][3] + .5);
        bool stitchWest = mod(mask, 2.0) > .5;
        bool stitchEast = mod(floor(mask * .5), 2.0) > .5;
        bool stitchNorth = mod(floor(mask * .25), 2.0) > .5;
        bool stitchSouth = mod(floor(mask * .125), 2.0) > .5;
        if ((stitchWest && position.x < .001) || (stitchEast && position.x > .999)) {
          patchUv.y = round(patchUv.y * 16.0) / 16.0;
        }
        if ((stitchNorth && position.z < .001) || (stitchSouth && position.z > .999)) {
          patchUv.x = round(patchUv.x * 16.0) / 16.0;
        }
        local.xz = patchUv;
        vec4 instancePosition = instanceMatrix * local;
        vec2 sourcePosition = instancePosition.xz;
        bool fullResolutionResident;
        float surfaceHeight = terrainHeight(sourcePosition) + terrainDataDelta(sourcePosition, fullResolutionResident);
        instancePosition.xz += terrainDataWarp(sourcePosition);
        instancePosition.y = surfaceHeight;
        vec4 world = modelMatrix * instancePosition;
        vWorldPosition = world.xyz; vHeight = surfaceHeight;
        vSourcePosition = sourcePosition;
        vec2 exposure = terrainDataRockExposure(sourcePosition);

        vRockExposure = exposure.x;
        vRockCoverage = exposure.y;
        vTerrainSurface = 1.0;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 uAtmosphereColor;
      uniform float uAtmosphereStart, uAtmosphereEnd, uAtmosphereStrength;
      uniform sampler2D uRockSourceMask;
      uniform vec2 uRockSourceMaskOrigin;
      uniform float uRockSourceMaskCellSize;
      uniform vec2 uRockSourceMaskResolution;
      uniform float uRockSourceMaskBoundaryMargin;
      uniform bool uRockSourceMaskEnabled;
      in float vHeight; in float vRockExposure; in float vRockCoverage;in float vTerrainSurface; in vec3 vWorldPosition; in vec2 vSourcePosition;
      out vec4 outColor;
      ${ROCK_APPEARANCE_GLSL}
      ${materialCache ? TERRAIN_MATERIAL_GLSL : ""}
      void main() {
        bool rockMaskHit = false;
        if (uRockSourceMaskEnabled) {
          vec2 sourceCellPosition = (vSourcePosition - uRockSourceMaskOrigin) / uRockSourceMaskCellSize;
          ivec2 sourceCell = ivec2(floor(sourceCellPosition));
          ivec2 sourceResolution = ivec2(uRockSourceMaskResolution);
          if (all(greaterThanEqual(sourceCell, ivec2(0))) && all(lessThan(sourceCell, sourceResolution))) {
            rockMaskHit = texelFetch(uRockSourceMask, sourceCell, 0).r > .5;
            // A half-metre source-space inset into the retained one-cell
            // guard prevents a coarse patch from peeking through beside the
            // shell. It deliberately samples only cardinal interior cells,
            // so the cutout cannot grow beyond the generated source region.
            if (!rockMaskHit && uRockSourceMaskBoundaryMargin > 0.0) {
              vec2 local = fract(sourceCellPosition);
              float margin = min(uRockSourceMaskBoundaryMargin / uRockSourceMaskCellSize, .499);
              if (local.x < margin && sourceCell.x > 0)
                rockMaskHit = texelFetch(uRockSourceMask, sourceCell + ivec2(-1, 0), 0).r > .5;
              if (!rockMaskHit && local.x > 1.0 - margin && sourceCell.x + 1 < sourceResolution.x)
                rockMaskHit = texelFetch(uRockSourceMask, sourceCell + ivec2(1, 0), 0).r > .5;
              if (!rockMaskHit && local.y < margin && sourceCell.y > 0)
                rockMaskHit = texelFetch(uRockSourceMask, sourceCell + ivec2(0, -1), 0).r > .5;
              if (!rockMaskHit && local.y > 1.0 - margin && sourceCell.y + 1 < sourceResolution.y)
                rockMaskHit = texelFetch(uRockSourceMask, sourceCell + ivec2(0, 1), 0).r > .5;
            }
          }
        }
        if (rockMaskHit) discard;
        vec3 low = vec3(.11, .24, .12), meadow = vec3(.24, .43, .17), high = vec3(.40, .39, .28), snow = vec3(.79, .86, .84);
        float meadowMix = smoothstep(-100.0, 120.0, vHeight);
        vec3 groundColor = mix(low, meadow, meadowMix);
        groundColor = mix(groundColor, high, smoothstep(150.0, 330.0, vHeight));
        groundColor = mix(groundColor, snow, smoothstep(410.0, 590.0, vHeight));
        ${materialCache ? "groundColor = terrainPaintColor(vSourcePosition, groundColor);" : ""}
        vec3 faceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        // The terrain is double-sided. This keeps top faces stable while
        // still allowing folded Rockify walls to receive facet lighting.
       // if (faceNormal.y < 0.0) faceNormal *= -1.0;
        vec3 lightDirection = normalize(vec3(-.45, .78, .42));
        float groundLight = clamp(dot(faceNormal, lightDirection) * .42 + .58, .30, 1.0);
        groundColor *= groundLight;

        // Coverage keeps either signed Rockify history stone. Its appearance
        // matches the detailed shell; inward history is not fake occlusion.
        float cliffShade = (1.0 - smoothstep(0.58, 0.74, abs(faceNormal.y))) * vTerrainSurface;
        float cliffMacro = .5 + .26 * sin(dot(vWorldPosition.xz, vec2(.066, .042))) + .24 * sin(dot(vWorldPosition.xz, vec2(-.030, .059)));
        cliffShade = smoothstep(0.0, 1.0, cliffShade + (cliffMacro - .5) * .07);
        float exposureRockCoverage =smoothstep(0.05, 0.30, vRockCoverage);

        float rockShade = max(cliffShade, exposureRockCoverage);

        vec3 rockColor = shadeRock(vWorldPosition, faceNormal, lightDirection);
        vec3 color = mix(groundColor, rockColor, rockShade);
        float atmosphere = smoothstep(uAtmosphereStart, uAtmosphereEnd, length(cameraPosition - vWorldPosition)) * uAtmosphereStrength;
        outColor = vec4(mix(color, uAtmosphereColor, atmosphere), 1.0);
      }`,
    // Folded Rockify faces may intentionally be viewed from either side.
    side: THREE.DoubleSide,
  });
}

export class TerrainQuadtree {
  constructor(scene, { atmosphere = {}, heightCache, materialCache = null, warpLod = {} } = {}) {
    if (!heightCache) throw new Error("TerrainQuadtree requires a terrain height GPU cache.");
    this.scene = scene;
    this.geometry = createPatchGeometry();
    this.atmosphere = { ...DEFAULT_ATMOSPHERE, ...atmosphere };
    this.material = createTerrainMaterial(this.atmosphere, heightCache, materialCache);
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.bounds = new THREE.Box3();
    this.hysteresis = new Map();
    this.batches = new Map();
    this.matrix = new THREE.Matrix4();
    this.selectedNodes = [];
    this.renderedNodes = [];
    this.visibleSourceTileKeys = new Set();
    this.lodDecisions = new Map();
    this.renderSignature = "";
    this.selectionSignature = "";
    this.stats = { patches: 0, selectedPatches: 0, culledPatches: 0, patchBudget: MAX_PATCHES, triangles: 0, lods: [], warpFeaturePatches: 0, balanceSplits: 0, persistentRefinementSplits: 0 };
    this.trianglesPerPatch = this.geometry.index.count / 3;
    this.minimumPatchSize = MIN_PATCH_SIZE;
    this.dataProvider = heightCache.provider;
    this.heightCache = heightCache;
    this.warpLod = { ...DEFAULT_WARP_LOD, ...warpLod };
    this.warpBoundsScratch = {};
    this.heightBoundsScratch = {};
    this.warpFeatureScratch = {};
    this.profile = { updateMs: 0, selectionMs: 0, selectionPeakMs: 0, warpLodMs: 0, streamingMs: 0, streamingPeakMs: 0, cullingMs: 0, cullingPeakMs: 0, commitMs: 0 };
  }

  getBatch(size) {
    let batch = this.batches.get(size);
    if (batch) return batch;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PATCHES);
    mesh.name = `Terrain LOD ${size}m`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    batch = { mesh, count: 0 };
    this.batches.set(size, batch);
    return batch;
  }

  update(camera) {
    const updateStarted = performance.now();
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const roots = [];
    const rootX = Math.floor(camera.position.x / ROOT_SIZE);
    const rootZ = Math.floor(camera.position.z / ROOT_SIZE);
    for (let z = rootZ - 1; z <= rootZ + 1; z++) for (let x = rootX - 1; x <= rootX + 1; x++) roots.push({ x: x * ROOT_SIZE, z: z * ROOT_SIZE, size: ROOT_SIZE });

    const distanceToNode = node => {
      const dx = Math.max(node.x - camera.position.x, 0, camera.position.x - (node.x + node.size));
      const dz = Math.max(node.z - camera.position.z, 0, camera.position.z - (node.z + node.size));
      return dx * dx + dz * dz;
    };
    // Budgeted subdivision must start at the camera. Fixed coordinate order
    // can exhaust the fixed patch budget in a farther root before the nearby
    // terrain has reached its intended 2 m vertex spacing.
    roots.sort((a, b) => distanceToNode(a) - distanceToNode(b));
    const desired = new Map();
    this.patchBudget = MAX_PATCHES;
    this.remainingSplits = Math.floor((this.patchBudget - roots.length) / 3);
    this.lodDecisions.clear();
    // Rockify and height edits share normal camera-distance LOD. Do not
    // reserve budget or inject extra refinement for authored data; selection
    // correctness must come from the general camera-priority policy.
    this.featureSplitReserve = 0;
    const selectionStarted = performance.now();
    for (const root of roots) this.selectDesired(root, camera.position, desired);
    const selectionElapsed = performance.now() - selectionStarted;
    this.profile.selectionMs += selectionElapsed;
    this.profile.selectionPeakMs = Math.max(this.profile.selectionPeakMs, selectionElapsed);

    const streamingStarted = performance.now();
    const rendered = [];
    for (const root of roots) {
      if (desired.has(this.key(root))) this.resolve(root, desired, rendered);
    }
    const streamingElapsed = performance.now() - streamingStarted;
    this.profile.streamingMs += streamingElapsed;
    this.profile.streamingPeakMs = Math.max(this.profile.streamingPeakMs, streamingElapsed);
    const persistentRefinementSplits = 0;
    const balanceSplits = this.balanceSelected(rendered);
    this.assignStitchMasks(rendered);
    rendered.sort((a, b) => a.size - b.size || a.z - b.z || a.x - b.x);
    this.selectedNodes = rendered;
    this.stats.selectedPatches = rendered.length;
    this.stats.balanceSplits = balanceSplits;
    this.stats.persistentRefinementSplits = persistentRefinementSplits;
    const signature = rendered.map(node => this.key(node)).join("|");
    // Streaming retains the complete balanced topology, including offscreen
    // neighbours. Visibility compaction must not change residency or seams.
    if (signature !== this.selectionSignature) {
      this.selectionSignature = signature;
      this.visibleSourceTileKeys = this.collectSourceTileKeys(rendered);
    }
    this.profile.updateMs += performance.now() - updateStarted;
  }

  commitVisiblePatches() {
    const started = performance.now();
    const visible = [];
    for (const node of this.selectedNodes) {
      this.bounds.min.set(node.x, TERRAIN_MIN_Y, node.z);
      this.bounds.max.set(node.x + node.size, TERRAIN_MAX_Y, node.z + node.size);
      this.heightCache.expandPatchCullingBox(node, this.bounds);
      // Cover float arithmetic at the frustum boundary, including large
      // world coordinates. Seam snapping stays inside the source rectangle.
      const min = this.bounds.min, max = this.bounds.max;
      const magnitude = Math.max(Math.abs(min.x), Math.abs(min.y), Math.abs(min.z), Math.abs(max.x), Math.abs(max.y), Math.abs(max.z));
      this.bounds.expandByScalar(Math.max(.05, magnitude * 1e-6));
      if (this.frustum.intersectsBox(this.bounds)) visible.push(node);
    }
    // Masks remain those of the full balanced topology. Recomputing them
    // from just visible instances could unsnap an edge beside a culled leaf.
    this.renderedNodes = visible;
    this.stats.culledPatches = this.selectedNodes.length - visible.length;
    const signature = visible.map(node => `${this.key(node)}:${node.stitchMask}`).join("|");
    const elapsed = performance.now() - started;
    this.profile.cullingMs += elapsed;
    this.profile.cullingPeakMs = Math.max(this.profile.cullingPeakMs, elapsed);
    if (signature === this.renderSignature) return;
    this.renderSignature = signature;
    const commitStarted = performance.now();
    this.commit(visible, this.stats.balanceSplits, this.stats.persistentRefinementSplits);
    this.profile.commitMs += performance.now() - commitStarted;
  }

  syncHeightCacheUniforms() {
    const uniforms = this.material.uniforms;
    uniforms.uCoarseHeight.value = this.heightCache.coarseTexture;
    uniforms.uCoarseWarp.value = this.heightCache.coarseWarpTexture;
    uniforms.uCoarseRockExposure.value = this.heightCache.coarseExposureTexture;
    uniforms.uCoarseHeightOrigin.value.copy(this.heightCache.coarseOrigin);
    uniforms.uCoarseHeightSize.value.copy(this.heightCache.coarseSize);
    uniforms.uCoarseHeightEnabled.value = this.heightCache.coarseEnabled;
    uniforms.uFallbackHeight.value = this.heightCache.fallbackTexture;
    uniforms.uFallbackWarp.value = this.heightCache.fallbackWarpTexture;
    uniforms.uFallbackRockExposure.value = this.heightCache.fallbackExposureTexture;
    uniforms.uFallbackTileMap.value = this.heightCache.fallbackTileMap;
    uniforms.uFallbackMapOrigin.value.copy(this.heightCache.fallbackMapOrigin);
    uniforms.uFallbackMapExtent.value.copy(this.heightCache.fallbackMapExtent);
    uniforms.uFallbackEnabled.value = this.heightCache.fallbackKeyToLayer.size > 0;
    // Both frame loops call this after cache uploads, immediately before
    // rendering. New displacement must affect culling in that same frame.
    this.commitVisiblePatches();
  }

  // Conservative source-tile coverage for the selected render set. A patch
  // may be coarse, but its shader still samples terrain data in world/source
  // space, so cache residency must be derived from bounds rather than LOD.
  getVisibleSourceTileKeys() {
    return this.visibleSourceTileKeys;
  }

  collectSourceTileKeys(nodes) {
    const keys = new Set();
    const tileSize = this.dataProvider.tileSize;
    for (const node of nodes) {
      const minX = Math.floor(node.x / tileSize);
      const maxX = Math.floor((node.x + node.size) / tileSize);
      const minZ = Math.floor(node.z / tileSize);
      const maxZ = Math.floor((node.z + node.size) / tileSize);
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) keys.add(this.dataProvider.tileKey(x, z));
      }
    }
    return keys;
  }

  // Editor-only RockSurfaceShell source cutout. This transient render data is
  // independent of persistent terrain and immediately restores cleanly.
  setExperimentalRockMask(mask = null) {
    const uniforms = this.material.uniforms;
    uniforms.uRockSourceMaskEnabled.value = Boolean(mask);
    if (!mask) return;
    uniforms.uRockSourceMask.value = mask.texture;
    uniforms.uRockSourceMaskOrigin.value.set(mask.minX, mask.minZ);
    uniforms.uRockSourceMaskCellSize.value = mask.cellSize;
    uniforms.uRockSourceMaskResolution.value.set(mask.texture.image.width, mask.texture.image.height);
    uniforms.uRockSourceMaskBoundaryMargin.value = mask.boundaryMargin ?? .5;
  }

  consumeProfile() {
    const profile = this.profile;
    this.profile = { updateMs: 0, selectionMs: 0, selectionPeakMs: 0, warpLodMs: 0, streamingMs: 0, streamingPeakMs: 0, cullingMs: 0, cullingPeakMs: 0, commitMs: 0 };
    return profile;
  }

  key(node) { return `${node.x},${node.z},${node.size}`; }

  selectDesired(node, cameraPosition, desired) {
    const key = this.key(node);
    // Include displaced footprints here. This can make the bound a little
    // larger than necessary, but it means a heavily Rockified source tile is
    // never rejected merely because its visible surface moved beyond its
    // original XZ cell.
    const warpBounds = this.dataProvider.getWarpDetailForArea(
      node.x, node.z, node.x + node.size, node.z + node.size,
      0, this.warpBoundsScratch, true,
    );
    const heightBounds = this.dataProvider.getHeightBoundsForArea(node.x, node.z, node.x + node.size, node.z + node.size, this.heightBoundsScratch);
    const boundMinX = node.x + Math.min(0, warpBounds?.minWarpX ?? 0);
    const boundMaxX = node.x + node.size + Math.max(0, warpBounds?.maxWarpX ?? 0);
    const boundMinZ = node.z + Math.min(0, warpBounds?.minWarpZ ?? 0);
    const boundMaxZ = node.z + node.size + Math.max(0, warpBounds?.maxWarpZ ?? 0);
    this.bounds.min.set(boundMinX, Math.min(TERRAIN_MIN_Y, heightBounds?.minHeight ?? TERRAIN_MIN_Y), boundMinZ);
    this.bounds.max.set(boundMaxX, Math.max(TERRAIN_MAX_Y, heightBounds?.maxHeight ?? TERRAIN_MAX_Y), boundMaxZ);
    // Height edits can form tall surfaces that cross a source-patch boundary.
    // Keep their coarse coverage resident until we have a true displaced
    // per-patch bound hierarchy; culling them here caused painted terrain to
    // disappear. This does *not* request special fine LOD—the height-specific
    // budget reserve and refinement were removed above.
    const hasPersistentTerrain = Boolean(warpBounds || heightBounds)
      || this.dataProvider.hasPersistentTerrainNearArea(
        node.x, node.z, node.x + node.size, node.z + node.size, 0,
      );
    if (!hasPersistentTerrain && !this.frustum.intersectsBox(this.bounds)) {
      this.lodDecisions.set(key, {
        x: node.x, z: node.z, actualLod: node.size, requestedChildSize: node.size / 2,
        distance: Infinity, splitAt: 0, remainingSplits: this.remainingSplits,
        featureSplitReserve: this.featureSplitReserve, reason: "frustum-rejected",
      });
      return;
    }
    const dx = Math.max(boundMinX - cameraPosition.x, 0, cameraPosition.x - boundMaxX);
    const dz = Math.max(boundMinZ - cameraPosition.z, 0, cameraPosition.z - boundMaxZ);
    node.distance = Math.hypot(dx, dz);
    const wasSplit = this.hysteresis.get(key) === true;
    const splitAt = node.size * (wasSplit ? 2.15 : 1.72);
    const wantsDistanceSplit = node.distance < splitAt;
    const wantsSplit = node.size > this.minimumPatchSize && wantsDistanceSplit;
    const budgetAllowsSplit = this.remainingSplits > 0;
    const split = wantsSplit && budgetAllowsSplit;
    const reason = split
      ? "distance"
      : node.size <= this.minimumPatchSize ? "minimum-lod"
        : !wantsSplit ? "distance-threshold"
          : this.remainingSplits <= 0 ? "budget-empty" : "budget-reserved";
    this.lodDecisions.set(key, {
      x: node.x, z: node.z, actualLod: node.size,
      requestedChildSize: wantsSplit ? node.size / 2 : node.size,
      distance: node.distance, splitAt, remainingSplits: this.remainingSplits,
      featureSplitReserve: this.featureSplitReserve, reason,
    });
    this.hysteresis.set(key, split);
    desired.set(key, { node, split });
    if (!split) return;
    this.remainingSplits--;
    const children = this.children(node);
    children.sort((a, b) => {
      const distance = child => {
        const dx = Math.max(child.x - cameraPosition.x, 0, cameraPosition.x - (child.x + child.size));
        const dz = Math.max(child.z - cameraPosition.z, 0, cameraPosition.z - (child.z + child.size));
        return dx * dx + dz * dz;
      };
      return distance(a) - distance(b);
    });
    for (const child of children) this.selectDesired(child, cameraPosition, desired);
  }

  isWarpFeaturePatch(node) {
    const detail = this.dataProvider.getWarpDetailForArea(
      node.x, node.z, node.x + node.size, node.z + node.size,
      this.warpLod.guardBand, this.warpFeatureScratch, true,
    );
    return Boolean(detail && detail.maxGradient >= this.warpLod.minGradient);
  }

  children(node) {
    const half = node.size * .5;
    return [
      { x: node.x, z: node.z, size: half }, { x: node.x + half, z: node.z, size: half },
      { x: node.x, z: node.z + half, size: half }, { x: node.x + half, z: node.z + half, size: half },
    ];
  }

  resolve(node, desired, rendered) {
    const entry = desired.get(this.key(node));
    if (!entry?.split) { rendered.push(node); return; }
    const children = this.children(node);
    // A MaxWorld render patch is an instance of an already-created shared
    // grid. Unlike the old chunk system it has no CPU mesh build or upload
    // stage, so a selected child is renderable immediately. Holding a parent
    // in a synthetic "ready" queue makes close terrain sample a 2 m edit at
    // coarse parent vertices, which is exactly the collapsed-wall artifact.
    // Real terrain-data cache uploads remain independently budgeted.
    for (const child of children) this.resolve(child, desired, rendered);
  }

  assignStitchMasks(selected) {
    for (const node of selected) {
      let mask = 0;
      for (const other of selected) {
        if (other.size !== node.size * 2) continue;
        const xOverlap = Math.min(node.x + node.size, other.x + other.size) - Math.max(node.x, other.x);
        const zOverlap = Math.min(node.z + node.size, other.z + other.size) - Math.max(node.z, other.z);
        if (other.x + other.size === node.x && zOverlap > 0) mask |= 1;
        if (node.x + node.size === other.x && zOverlap > 0) mask |= 2;
        if (other.z + other.size === node.z && xOverlap > 0) mask |= 4;
        if (node.z + node.size === other.z && xOverlap > 0) mask |= 8;
      }
      node.stitchMask = mask;
    }
  }

  // A coarse leaf beside a 64 m leaf stretches its 32x32 grid over the
  // edited cliff and causes the apparent "lower resolution when close"
  // failure. Balance the selected leaves so any shared edge has at most a
  // two-to-one size transition. This is LOD selection only; all children use
  // the same shared geometry and material.
  balanceSelected(selected) {
    let splits = 0;
    const touches = (a, b) => {
      const xOverlap = Math.min(a.x + a.size, b.x + b.size) - Math.max(a.x, b.x);
      const zOverlap = Math.min(a.z + a.size, b.z + b.size) - Math.max(a.z, b.z);
      const verticalEdge = (a.x + a.size === b.x || b.x + b.size === a.x) && zOverlap > 0;
      const horizontalEdge = (a.z + a.size === b.z || b.z + b.size === a.z) && xOverlap > 0;
      return verticalEdge || horizontalEdge;
    };
    let changed = true;
    while (changed && selected.length + 3 <= this.patchBudget) {
      changed = false;
      for (let aIndex = 0; aIndex < selected.length && !changed; aIndex += 1) {
        for (let bIndex = aIndex + 1; bIndex < selected.length; bIndex += 1) {
          const a = selected[aIndex], b = selected[bIndex];
          if (!touches(a, b)) continue;
          const coarseIndex = a.size > b.size * 2 ? aIndex : b.size > a.size * 2 ? bIndex : -1;
          if (coarseIndex === -1) continue;
          selected.splice(coarseIndex, 1, ...this.children(selected[coarseIndex]));
          splits += 1;
          changed = true;
          break;
        }
      }
    }
    return splits;
  }

  commit(selected, balanceSplits = 0, persistentRefinementSplits = 0) {
    for (const batch of this.batches.values()) batch.count = 0;
    const lods = new Map();
    let warpFeaturePatches = 0;
    for (const node of selected) {
      const batch = this.getBatch(node.size);
      const index = batch.count++;
      this.matrix.makeScale(node.size, 1, node.size);
      this.matrix.setPosition(node.x, 0, node.z);
      this.matrix.elements[7] = node.stitchMask ?? 0;
      batch.mesh.setMatrixAt(index, this.matrix);
      lods.set(node.size, (lods.get(node.size) ?? 0) + 1);
      if (this.isWarpFeaturePatch(node)) warpFeaturePatches += 1;
    }
    for (const batch of this.batches.values()) {
      batch.mesh.count = batch.count;
      if (batch.count) {
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.stats.patches = selected.length;
    this.stats.patchBudget = this.patchBudget;
    this.stats.triangles = selected.length * this.trianglesPerPatch;
    this.stats.lods = [...lods.entries()].sort((a, b) => a[0] - b[0]);
    this.stats.warpFeaturePatches = warpFeaturePatches;
    this.stats.balanceSplits = balanceSplits;
    this.stats.persistentRefinementSplits = persistentRefinementSplits;
  }
}
