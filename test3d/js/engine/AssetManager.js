import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// Adapted from CatAdventure: cache source GLBs, then clone a fresh scene per map object.
export class AssetManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.localUrls = new Map();
    // One shared clock keeps every instance cheap. The tree material receives
    // the value as a uniform; no CPU-side vertex animation is required.
    this.treeWindTime = { value: 0 };
    this.treeNightAmount = { value: 0 };
  }

  // Used by the editor for a local preview. The saved map still references
  // assets/name.glb, so putting that file in NextWorld/assets makes it work in
  // both the editor and the game after a reload.
  registerFile(path, file) {
    this.localUrls.get(path) && URL.revokeObjectURL(this.localUrls.get(path));
    this.localUrls.set(path, URL.createObjectURL(file));
    this.cache.delete(path);
  }

  loadGLB(path) {
    if (!path) return Promise.resolve(null);
    if (!this.cache.has(path)) {
      const source = this.localUrls.get(path) ?? path;
      this.cache.set(path, this.loader.loadAsync(source).then(gltf => {
        const scene = gltf.scene;
        scene.userData.animations = gltf.animations ?? [];
        scene.userData.hasSkinnedMeshes = false;
        scene.traverse(object => {
          if (object.isSkinnedMesh) scene.userData.hasSkinnedMeshes = true;
          if (object.isMesh) {
            // MaxPaint shadow proxies are marked by name because shadow-only
            // is not a core glTF feature. Shadow-map rendering in the engine
            // follows the visible scene layer, so keep proxies on layer 0 and
            // suppress their normal colour/depth output below.
            const isShadowProxy = /^SHADOW_PROXY_/i.test(object.name) || !!object.userData?.gltfExtensions?.EXT_maxpaint_shadow_proxy;
            const isLeafBatch = /^LEAF_NO_SHADOW$/i.test(object.name) || !!object.userData?.gltfExtensions?.EXT_maxpaint_leaf_batch;
            object.userData.shadowProxy = isShadowProxy;
            object.userData.maxPaintLeafBatch = isLeafBatch;
            if (isShadowProxy) {
              object.layers.set(0);
              object.frustumCulled = false;
              for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                if (!material) continue;
                material.colorWrite = false;
                material.depthWrite = false;
                material.needsUpdate = true;
              }
            }
            object.castShadow = isShadowProxy || !isLeafBatch;
            object.receiveShadow = true;
            // GLTF base-colour maps are sRGB. Keep this explicit for atlas
            // textures as well, then improve the detail held on angled foliage
            // surfaces without changing authored material colours.
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              const map = material?.map;
              if (!map) continue;
              map.colorSpace = THREE.SRGBColorSpace;
              map.minFilter = THREE.LinearMipmapLinearFilter;
              map.magFilter = THREE.LinearFilter;
              map.anisotropy = Math.max(map.anisotropy || 1, 8);
              map.needsUpdate = true;
            }
          }
        });
        if (/(?:träd|trad|tree)/i.test(path)) this.addTreeLife(scene);
        return scene;
      }));
    }
    return this.cache.get(path);
  }

  update(delta) {
    this.treeWindTime.value += Math.min(delta, 0.05);
  }

  setEnvironment({ nightAmount = 0 } = {}) {
    this.treeNightAmount.value = THREE.MathUtils.clamp(nightAmount, 0, 1);
  }

  addTreeLife(scene) {
    scene.traverse(mesh => {
      // Shadow proxies must be completely rigid.  Applying the foliage wind
      // shader here makes their depth silhouette change every frame.
      if (!mesh.isMesh || mesh.userData.treeLifeApplied || mesh.userData.shadowProxy) return;
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      if (!bounds) return;

      const minY = bounds.min.y;
      const height = Math.max(0.001, bounds.max.y - minY);
      const foliageCenter = bounds.getCenter(new THREE.Vector3());
      // The lower half is trunk; the upper half becomes softly swaying foliage.
      const foliageStart = minY + height * 0.20;
      const foliageFade = height * 0.20;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material || material.userData.treeLifeApplied) continue;
        // Trees are authored as painted, matte assets. Remove runtime
        // specular/environment contribution so their albedo is not turned
        // into a glossy, lime-tinted surface by the game sky.
        if (material.isMeshStandardMaterial) {
          material.metalness = 0;
          material.roughness = 1;
          material.envMap = null;
          material.envMapIntensity = 0;
          if ("specularIntensity" in material) material.specularIntensity = 0;
        }
        const previousOnBeforeCompile = material.onBeforeCompile;
        const previousProgramKey = material.customProgramCacheKey?.() ?? "";
        const foliageMaterial = material.alphaTest > 0 || /leaf|foliage/i.test(material.name || "");

        material.onBeforeCompile = (shader, renderer) => {
          previousOnBeforeCompile?.call(material, shader, renderer);
          shader.uniforms.uTreeWindTime = this.treeWindTime;
          shader.uniforms.uTreeNightAmount = this.treeNightAmount;
          shader.uniforms.uTreeFoliageTintEnabled = { value: foliageMaterial ? 1 : 0 };
          shader.uniforms.uTreeFoliageStart = { value: foliageStart };
          shader.uniforms.uTreeFoliageFade = { value: foliageFade };
          shader.uniforms.uTreeFoliageCenter = { value: foliageCenter };

          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              `
              #include <common>
              uniform float uTreeWindTime;
              uniform float uTreeFoliageStart;
              uniform float uTreeFoliageFade;
              uniform vec3 uTreeFoliageCenter;
              varying float vTreeFoliage;
              varying float vTreeLeafTone;
              `
            )
            .replace(
              "#include <begin_vertex>",
              `
              #include <begin_vertex>
              float treeFoliage = smoothstep(
                uTreeFoliageStart,
                uTreeFoliageStart + uTreeFoliageFade,
                position.y
              );
              vec3 treeWindAnchor = modelMatrix[3].xyz;
              #ifdef USE_INSTANCING
                treeWindAnchor += instanceMatrix[3].xyz;
              #endif
              float treePhase = uTreeWindTime * 1.00
                + treeWindAnchor.x * 50.19
                + treeWindAnchor.z * 50.14;
              // Same two motion layers as MaxPaint V4's generated leaves:
              // a slow rotation of the full crown, then faster leaf flutter.
              // The foliage mask keeps the trunk fixed.
              vec3 treeCrown = transformed - uTreeFoliageCenter;
              float canopyPitch = sin(uTreeWindTime * 0.85 + treePhase) * 0.01225;
              float canopyYaw = sin(uTreeWindTime * 0.57 + treePhase) * 0.007;
              float canopyRoll = cos(uTreeWindTime * 0.72 + treePhase) * 0.01575;
              treeCrown.yz = mat2(cos(canopyPitch), -sin(canopyPitch), sin(canopyPitch), cos(canopyPitch)) * treeCrown.yz;
              treeCrown.xz = mat2(cos(canopyYaw), -sin(canopyYaw), sin(canopyYaw), cos(canopyYaw)) * treeCrown.xz;
              treeCrown.xy = mat2(cos(canopyRoll), -sin(canopyRoll), sin(canopyRoll), cos(canopyRoll)) * treeCrown.xy;
              vec3 swayedCrown = treeCrown + uTreeFoliageCenter;
              transformed = mix(transformed, swayedCrown, treeFoliage);

              float leafPhase = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
              float flutterX = sin(uTreeWindTime * 2.35 + leafPhase) * 0.042;
              float flutterY = cos(uTreeWindTime * 1.73 + leafPhase) * 0.028;
              float flutterZ = sin(uTreeWindTime * 2.90 + leafPhase) * 0.056;
              transformed += vec3(flutterX, flutterY, flutterZ) * treeFoliage;
              vTreeFoliage = treeFoliage;

              `
            );

          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `
              #include <common>
              uniform float uTreeNightAmount;
              uniform float uTreeFoliageTintEnabled;
              varying float vTreeFoliage;

              
              `
            )
            .replace(
              "#include <tonemapping_fragment>",
              `


gl_FragColor.rgb *=0.5;              
vec3 leaf = gl_FragColor.rgb ;

// 1. Gör om till gråskala / ljushetsvärde
float luma = dot(leaf, vec3(1.0, 1.0, 1.0));

// 2. Behåll eller förstärk kontrast lite
//luma = pow(luma, 0.01); // < 1.0 lyfter mellanvärden, > 1.0 mörkar

luma = clamp(luma, 0.0, 1.0);

// 3. Färga med nattfärg
vec3 treeNightTint = vec3(0.0,0.00, 0.00);   // mörk grön/blågrön bas
vec3 treeMoonTint  = vec3(0.192, 0.239, 0.380);   // ljusare månljus

vec3 tintedNight = mix(treeNightTint, treeMoonTint, luma);

// 4. Blanda in på natten
gl_FragColor.rgb = mix(gl_FragColor.rgb, tintedNight, (uTreeNightAmount*0.9) );
gl_FragColor.rgb *=(((-uTreeNightAmount)*0.20)+1.0);
























           //   float treeNightTint = uTreeNightAmount * uTreeFoliageTintEnabled * vTreeFoliage;
              
          //    gl_FragColor.rgb = (gl_FragColor.rgb-(vec3(0.0,gl_FragColor.g/3.0,0.0)*treeNightTint)) ;
          //    gl_FragColor.rgb = (gl_FragColor.rgb+(vec3(0.0,0.01,0.03)*treeNightTint));

          //    gl_FragColor.rgb *=(((-uTreeNightAmount)*0.40)+1.0);

              // Preserve the leaf texture and shift only upper foliage
              // toward a cool moonlit colour at night.

              #include <tonemapping_fragment>

             


              


              `
            )

        };
        material.customProgramCacheKey = () => `${previousProgramKey}|next-world-tree-life-v2`;
        material.needsUpdate = true;
        material.userData.treeLifeApplied = true;
      }
      mesh.userData.treeLifeApplied = true;
    });
  }

  async createInstance(path, { cloneMaterials = false } = {}) {
    const source = await this.loadGLB(path);
    if (!source) return null;
    // Object3D.clone shares Skeleton instances. That is fine for static
    // assets, but makes every horse/character reference the cached source
    // bones instead of its own clone. SkeletonUtils reconnects each skinned
    // mesh to the cloned bone hierarchy.
    const instance = source.userData.hasSkinnedMeshes ? cloneSkinned(source) : source.clone(true);
    instance.userData.animations = source.userData.animations;
    if (cloneMaterials) instance.traverse(object => {
      if (object.isMesh && object.material) {
        object.material = Array.isArray(object.material)
          ? object.material.map(material => material.clone())
          : object.material.clone();
      }
    });
    return instance;
  }
}
