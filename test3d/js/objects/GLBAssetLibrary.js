import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { lodCandidates } from "./ObjectLOD.js";
import { runtimeMaterial } from "./RuntimeMaterials.js";

export function encodeGLB(buffer) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:model/gltf-binary;base64,${btoa(binary)}`;
}
export function decodeGLB(data) {
  const binary = atob(data.slice(data.indexOf(",") + 1));
  return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
}
export function validateGLB(buffer) {
  if (buffer.byteLength < 20) throw new Error("The file is not a GLB model.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error("Expected a complete glTF 2.0 binary (.glb).");
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  // A local file picker cannot resolve neighbouring files. Fail explicitly
  // instead of saving an apparently portable GLB with missing dependencies.
  for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (entry.uri && !entry.uri.startsWith("data:")) throw new Error("Import a self-contained GLB with embedded textures and buffers.");
  }
  return json;
}
export class GLBAssetLibrary {
  constructor(data, { loader = new GLTFLoader(), onError = () => {}, now = () => performance.now(), resourceRetention = 5000, materialMode = 'standard' } = {}) {
    this.data = data; this.loader = loader; this.onError = onError;
    this.materialMode = materialMode;
    this.cache = new Map(); this.errors = new Map(); this.disposed = false;
    this.references = new Map(); this.lastUsed = new Map(); this.now = now; this.resourceRetention = resourceRetention; this.nextTrim = 0;
    this.unsubscribe = data.onChanged(event => {
      if ((event.kind === "asset" || event.kind === "resource") && (event.before?.data !== event.after?.data || this.errors.has(event.id))) this.invalidate(event.id);
      if (event.kind === "asset" || event.kind === "resource") {
        const used = new Set([...data.assets.values()].flatMap(asset => [asset.id, ...(asset.lod?.levels.map(level => level.resourceId) ?? []), asset.collision?.sourceId].filter(Boolean)));
        for (const id of this.errors.keys()) if (!used.has(id)) this.invalidate(id);
      }
    });
  }
  async importFile(file) {
    const prepared = await this.prepareFile(file);
    const existing = this.data.assets.get(prepared.resource.id);
    if (existing?.data && !this.errors.has(existing.id)) return existing;
    // Repairing a logical payload must retain its authored collision/LOD settings.
    const asset = this.data.setAsset({ ...existing, ...prepared.resource });
    this.cache.set(asset.id, Promise.resolve(prepared.source)); this.lastUsed.set(asset.id, this.now());
    return asset;
  }
  async prepareFile(file) {
    if (!/\.glb$/i.test(file.name)) throw new Error("Choose a .glb file.");
    const buffer = await file.arrayBuffer(); validateGLB(buffer);
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    const id = `glb-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const existing = this.data.getResource(id);
    if (existing?.data) {
      try {
        const source = await this.load(id);
        return { resource: { ...existing, triangles: source.triangles, clips: source.animations.map(clip => clip.name) }, source, existing: true };
      }
      catch { /* Reimporting the original bytes repairs a failed payload. */ }
    }
    // Decode before mutating the library: failed imports never dirty the world.
    const source = await this.parse(buffer);
    const bounds = this.measureBounds(source);
    const resource = { id, name: file.name.replace(/\.glb$/i, ""), data: encodeGLB(buffer), triangles: source.triangles, clips: source.animations.map(clip => clip.name),
      bounds: bounds.isEmpty() ? { min: [0, 0, 0], max: [0, 0, 0] } : { min: bounds.min.toArray(), max: bounds.max.toArray() } };
    return { resource, source, existing: false };
  }
  registerResource(prepared) {
    if (!this.data.getResource(prepared.resource.id)?.data) this.data.setResource(prepared.resource);
    this.cache.set(prepared.resource.id, Promise.resolve(prepared.source)); this.lastUsed.set(prepared.resource.id, this.now());
    return prepared.resource;
  }
  async parse(buffer) {
    const gltf = await this.loader.parseAsync(buffer, "");
    const converted = new Map();
    let canInstance = gltf.animations.length === 0;
    gltf.scene.traverse(node => {
      if (node.isSkinnedMesh || node.morphTargetInfluences?.length || node.isLight || node.isCamera || node.isLine || node.isPoints || node.isInstancedMesh) canInstance = false;
      if (!node.isMesh) return;
      const convert = material => {
        if (!converted.has(material)) converted.set(material, runtimeMaterial(material, this.materialMode));
        return converted.get(material);
      };
      node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
      if (node.isSkinnedMesh || node.morphTargetInfluences?.length) node.frustumCulled = false;
      const proxy = /^SHADOW_PROXY_/i.test(node.name) || node.userData.shadowProxy || !!node.userData.gltfExtensions?.EXT_maxpaint_shadow_proxy;
      const leaves = /^LEAF_NO_SHADOW$/i.test(node.name) || !!node.userData.gltfExtensions?.EXT_maxpaint_leaf_batch;
      node.userData.shadowProxy = !!proxy;
      node.castShadow = !!proxy || !leaves; node.receiveShadow = !proxy;
      if (proxy) {
        const shadowMaterial = material => { const clone = material.clone(); clone.colorWrite = false; clone.depthWrite = false; return clone; };
        node.material = Array.isArray(node.material) ? node.material.map(shadowMaterial) : shadowMaterial(node.material);
      }
      // Blended objects require independent sorting. Leave them as live clones.
      if ((Array.isArray(node.material) ? node.material : [node.material]).some(m => m.transparent)) canInstance = false;
    });
    for (const [source, target] of converted) if (source !== target) source.dispose();
    gltf.scene.updateMatrixWorld(true);
    const meshes = [];
    const visit = (node, visible) => {
      visible &&= node.visible;
      if (visible && node.isMesh) meshes.push({ mesh: node, matrix: node.matrixWorld.clone() });
      for (const child of node.children) visit(child, visible);
    };
    visit(gltf.scene, true);
    const triangles = meshes.reduce((sum, { mesh }) => sum + Math.floor((mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3) * (mesh.isInstancedMesh ? mesh.count : 1), 0);
    return { scene: gltf.scene, animations: gltf.animations, canInstance: canInstance && meshes.length > 0, meshes, triangles };
  }
  measureBounds(source) {
    const bounds = new THREE.Box3().setFromObject(source.scene);
    if (!source.animations.length) return bounds;
    // Import-time envelope, never frame-time work. Include authored key times
    // and intermediate poses so character limbs/root tracks are not culled
    // against just their bind pose. Preserve the authored scene afterwards.
    const pose = [];
    source.scene.traverse(node => pose.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), morph: node.morphTargetInfluences?.slice() }));
    const restore = () => {
      for (const { node, position, quaternion, scale, morph } of pose) {
        node.position.copy(position); node.quaternion.copy(quaternion); node.scale.copy(scale);
        if (morph) node.morphTargetInfluences.splice(0, morph.length, ...morph);
      }
      source.scene.updateMatrixWorld(true);
      source.scene.traverse(node => { if (node.isSkinnedMesh) node.computeBoundingBox(); });
    };
    const mixer = new THREE.AnimationMixer(source.scene), box = new THREE.Box3();
    for (const clip of source.animations) {
      const times = new Set([0, clip.duration]);
      for (const track of clip.tracks) for (const time of track.times) times.add(time);
      const steps = Math.min(600, Math.ceil(clip.duration * 10));
      for (let i = 0; i <= steps; i++) times.add(clip.duration * i / Math.max(1, steps));
      const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
      for (const time of [...times].sort((a, b) => a - b)) {
        mixer.setTime(time); source.scene.updateMatrixWorld(true);
        source.scene.traverse(node => { if (node.isSkinnedMesh) node.computeBoundingBox(); });
        bounds.union(box.setFromObject(source.scene));
      }
      mixer.stopAllAction(); restore();
    }
    mixer.uncacheRoot(source.scene); restore();
    // Guard interpolation extrema between sampled poses and floating error.
    return bounds.expandByScalar(bounds.getSize(new THREE.Vector3()).length() * .1 + .01);
  }
  load(id) {
    if (this.disposed) return Promise.reject(new Error("Asset library is closed."));
    this.lastUsed.set(id, this.now());
    if (!this.cache.has(id)) {
      const asset = this.data.getResource(id);
      const promise = Promise.resolve().then(() => {
        if (!asset?.data) throw new Error(`Missing GLB: ${asset?.name ?? id}. Reimport the asset to repair it.`);
        const buffer = decodeGLB(asset.data); validateGLB(buffer); return this.parse(buffer);
      }).catch(error => { this.errors.set(id, error.message); this.onError(error.message); throw error; });
      this.cache.set(id, promise);
    }
    return this.cache.get(id);
  }
  acquire(id) {
    this.references.set(id, (this.references.get(id) ?? 0) + 1);
    let released = false;
    return { id, promise: this.load(id), release: () => {
      if (released) return; released = true;
      const count = (this.references.get(id) ?? 1) - 1;
      if (count) this.references.set(id, count); else this.references.delete(id);
      this.lastUsed.set(id, this.now());
    } };
  }
  async acquireLOD(assetId, requested = 0, { preview = false } = {}) {
    if (requested === -1 && !preview) return { source: null, level: -1, resourceId: null, release() {} };
    const asset = this.data.assets.get(assetId);
    const candidates = lodCandidates(asset ?? { id: assetId }, requested);
    const forced = asset?.lod?.levels[requested];
    if (preview && forced?.resourceId) candidates.unshift({ ...forced, level: requested });
    for (const candidate of candidates) {
      const lease = this.acquire(candidate.resourceId);
      try { return { source: await lease.promise, level: candidate.level, resourceId: candidate.resourceId, release: lease.release }; }
      catch { lease.release(); }
    }
    return { source: null, level: -1, resourceId: null, release() {} };
  }
  trim(force = false) {
    const time = this.now(); if (!force && time < this.nextTrim) return;
    this.nextTrim = time + 1000;
    for (const id of this.cache.keys()) if (!this.references.has(id) && !this.errors.has(id) && time - (this.lastUsed.get(id) ?? time) >= this.resourceRetention) this.invalidate(id);
  }
  clone(source) { return cloneSkeleton(source.scene); }
  disposeSource(source) {
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
    source.scene.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.skeleton) skeletons.add(node.skeleton);
      for (const m of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
        materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      }
    });
    for (const s of skeletons) s.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) { t.dispose(); t.source?.data?.close?.(); }
  }
  invalidate(id) {
    const source = this.cache.get(id); this.cache.delete(id); this.errors.delete(id);
    this.lastUsed.delete(id);
    source?.then(value => this.disposeSource(value), () => {});
  }
  dispose() { this.disposed = true; this.unsubscribe(); for (const id of this.cache.keys()) this.invalidate(id); }
}
