import { AnimationMixer, BoxGeometry, CapsuleGeometry, CylinderGeometry, Matrix4, Vector3 } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { normalizeCollision } from "../objects/ObjectCollision.js";
import { TriangleMesh } from "./TriangleMesh.js";

export function simpleColliderMesh(config) {
  const c = normalizeCollision(config);
  const geometry = c.shape === "box" ? new BoxGeometry(...c.size) : c.shape === "cylinder" ? new CylinderGeometry(c.radius, c.radius, c.height, 16)
    : new CapsuleGeometry(c.radius, c.height - c.radius * 2, 4, 12);
  geometry.translate(...c.offset); const mesh = TriangleMesh.fromGeometry(geometry); geometry.dispose(); return mesh;
}

// Bake a deterministic static pose once, never a live LOD or a render instance.
// Collision data copies vertices and survives source/visual cache eviction.
export function meshColliderFromSource(source) {
  const animated = source.animations?.length || source.scene.getObjectByProperty("isSkinnedMesh", true);
  const root = animated ? cloneSkeleton(source.scene) : source.scene;
  let mixer = null;
  if (source.animations?.length) { mixer = new AnimationMixer(root); mixer.clipAction(source.animations[0]).play(); mixer.update(0); }
  const mesh = meshColliderFromObject(root);
  mixer?.stopAllAction(); mixer?.uncacheRoot(root);
  if (animated) root.traverse(node => node.skeleton?.dispose());
  return mesh;
}

// Bake the current pose without restarting animations or cloning its skeleton.
// Local coordinates let a runtime pose use the placement's existing transform.
export function meshColliderFromObject(root, { local = false } = {}) {
  root.updateWorldMatrix(true, false);
  // Use the renderer's update path so attached skins refresh bindMatrixInverse.
  root.updateMatrixWorld(true);
  const inverse = local ? root.matrixWorld.clone().invert() : null;
  const vertices = [], point = new Vector3(), instance = new Matrix4(), matrix = new Matrix4();
  const append = (mesh, transform) => {
    mesh.skeleton?.update();
    const g = mesh.geometry, index = g.index, count = index?.count ?? g.attributes.position.count;
    const start = g.drawRange.start, end = Math.min(count, start + g.drawRange.count), mirrored = transform.determinant() < 0;
    for (let i = start; i + 2 < end; i += 3) for (let j = 0; j < 3; j++) {
      const corner = mirrored && j ? 3 - j : j, vertex = index ? index.getX(i + corner) : i + corner;
      mesh.getVertexPosition(vertex, point).applyMatrix4(transform); vertices.push(point.x, point.y, point.z);
    }
  };
  root.traverseVisible(node => {
    if (!node.isMesh || node.userData.shadowProxy || /^SHADOW_PROXY_/i.test(node.name)) return;
    if (node.isInstancedMesh) for (let i = 0; i < node.count; i++) {
      node.getMatrixAt(i, instance); matrix.multiplyMatrices(node.matrixWorld, instance);
      if (inverse) matrix.premultiply(inverse); append(node, matrix);
    }
    else { matrix.copy(node.matrixWorld); if (inverse) matrix.premultiply(inverse); append(node, matrix); }
  });
  if (!vertices.length) throw new Error("Collision source has no visible mesh triangles.");
  return new TriangleMesh(vertices);
}

export class ColliderAssets {
  constructor(data, library, onError = () => {}) { this.data = data; this.library = library; this.onError = onError; this.states = new Map(); this.builds = 0; }
  get(id) {
    const asset = this.data.assets.get(id); if (!asset) return null;
    const config = normalizeCollision(asset.collision), cameraConfig = asset.cameraCollision;
    const key = JSON.stringify([config, cameraConfig]);
    const sourceId = config.sourceId ?? id, resource = this.data.getResource(sourceId), payload = resource?.data;
    let state = this.states.get(id);
    if (state?.key === key && state.payload === payload) return state;
    state = { id, config, key, sourceId, payload, sourceBounds: resource?.bounds, mesh: null, promise: null, error: null };
    // Optional authored camera proxy. Share it across every placed instance;
    // leave character collision and the visual LODs independent.
    if (cameraConfig) state.cameraMesh = cameraConfig.mode === "none" ? null : simpleColliderMesh(cameraConfig);
    this.states.set(id, state);
    if (config.mode === "simple") { state.mesh = simpleColliderMesh(config); this.builds++; }
    return state;
  }
  load(state) {
    if (state.mesh || state.config.mode !== "mesh") return Promise.resolve(state.mesh);
    if (!state.promise) {
      const lease = this.library.acquire(state.sourceId);
      state.promise = lease.promise.then(source => { state.mesh = meshColliderFromSource(source); this.builds++; return state.mesh; })
        .catch(error => { state.error = error.message; this.onError(`Collision ${state.id}: ${error.message}`); return null; }).finally(lease.release);
    }
    return state.promise;
  }
  dispose() { this.states.clear(); }
}
