import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { StaticColliders, boxBounds } from "./StaticColliders.js";
import { ColliderAssets, meshColliderFromObject } from "./ColliderAssets.js";
import { initializeContacts } from "./Contacts.js";

export class ObjectCollider extends StaticColliders {
  constructor(data, library, { onError = library.onError ?? (() => {}), excludeIds = new Set() } = {}) {
    super(); this.data = data; this.assets = new ColliderAssets(data, library, onError);
    this.excludeIds = excludeIds;
    this.runtimeY = new Map();
    this.runtimeMeshes = new Map();
    this.byAsset = new Map(); this.states = new Map(); this.loads = new Set(); this.disposed = false;
    this.matrix = new Matrix4(); this.position = new Vector3(); this.scale = new Vector3(); this.euler = new Euler(); this.quaternion = new Quaternion();
    this.readyVisitor = this.checkReady.bind(this);
    for (const object of data.objects.values()) this.updateObject(object);
    this.unsubscribe = data.onChanged(event => {
      if (event.kind === "object") {
        this.runtimeMeshes.delete(event.id);
        if (event.before) { this.byAsset.get(event.before.assetId)?.delete(event.id); this.delete(event.id); }
        if (event.after) this.updateObject(event.after);
      } else if (event.kind === "asset") this.updateAsset(event.id);
      else if (event.kind === "resource") for (const [id, state] of this.states) if (state?.sourceId === event.id) this.updateAsset(id);
    });
  }
  transform(record) {
    this.position.fromArray(record.position); this.scale.fromArray(record.scale); this.euler.set(...record.rotation); this.quaternion.setFromEuler(this.euler);
    this.position.y += this.runtimeY.get(record.id) ?? 0;
    return this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  setExcluded(id, excluded) {
    if (excluded) { this.excludeIds.add(id); this.runtimeMeshes.delete(id); this.delete(id); }
    else { this.excludeIds.delete(id); const record = this.data.objects.get(id); if (record) this.updateObject(record); }
  }
  setAnimatedPose(id, root) {
    const record = this.data.objects.get(id);
    if (!record || this.excludeIds.has(id) || this.assets.get(record.assetId)?.config.mode !== "mesh") return;
    // Per-placement mesh: cached asset colliders and neighbouring trees stay intact.
    this.runtimeMeshes.set(id, meshColliderFromObject(root, { local: true }));
    this.updateObject(record);
  }
  clearAnimatedPose(id) {
    if (!this.runtimeMeshes.delete(id)) return;
    this.delete(id);
    const record = this.data.objects.get(id); if (record) this.updateObject(record);
  }
  setRuntimeY(id, offset) {
    const previous = this.runtimeY.get(id) ?? 0;
    if (offset) this.runtimeY.set(id, offset); else this.runtimeY.delete(id);
    const entry = this.index.entries.get(id); if (!entry) return;
    const delta = offset - previous;
    entry.matrix.elements[13] += delta; entry.inverse.copy(entry.matrix).invert();
    entry.bounds.minY += delta; entry.bounds.maxY += delta;
    // XZ membership stays fixed for vertical motion. Bounds are read live.
  }
  updateObject(record) {
    if (this.excludeIds.has(record.id)) return;
    let ids = this.byAsset.get(record.assetId); if (!ids) this.byAsset.set(record.assetId, ids = new Set()); ids.add(record.id);
    const state = this.assets.get(record.assetId); this.states.set(record.assetId, state);
    if (!state || state.config.mode === "none") return;
    if (!Object.hasOwn(record, "contactsSolid")) initializeContacts(record);
    const data = this.data;
    if (!Object.hasOwn(record, "name")) Object.defineProperty(record, "name", { configurable: true, get: () => record.properties.name ?? data.assets.get(record.assetId)?.name ?? record.assetId });
    if (!Object.hasOwn(record, "colliderKind")) Object.defineProperty(record, "colliderKind", { value: "object", configurable: true });
    const matrix = this.transform(record);
    const mesh = this.runtimeMeshes.get(record.id) ?? state.mesh;
    if (mesh) this.set(record.id, mesh, matrix, record);
    else {
      const b = state.sourceBounds;
      const box = b ? new Box3(new Vector3().fromArray(b.min), new Vector3().fromArray(b.max)).applyMatrix4(matrix) : null;
      // Missing bounds mean unknown extent: discover this asset once before
      // allowing simulation, rather than silently missing a large bridge.
      this.index.set(record.id, { mesh: null, object: record, state, matrix: matrix.clone(), inverse: matrix.clone().invert(), mirrored: matrix.determinant() < 0,
        bounds: box ? boxBounds(box) : { minX: -Infinity, minY: -Infinity, minZ: -Infinity, maxX: Infinity, maxY: Infinity, maxZ: Infinity } });
    }
    const entry = this.index.entries.get(record.id);
    entry.cameraMesh = state.cameraMesh;
    if (state.cameraMesh) {
      const b = state.cameraMesh.bounds, bounds = entry.bounds;
      const box = new Box3(new Vector3(b.minX, b.minY, b.minZ), new Vector3(b.maxX, b.maxY, b.maxZ)).applyMatrix4(matrix);
      bounds.minX = Math.min(bounds.minX, box.min.x); bounds.maxX = Math.max(bounds.maxX, box.max.x);
      bounds.minY = Math.min(bounds.minY, box.min.y); bounds.maxY = Math.max(bounds.maxY, box.max.y);
      bounds.minZ = Math.min(bounds.minZ, box.min.z); bounds.maxZ = Math.max(bounds.maxZ, box.max.z);
      // Reindex the union if an authored camera proxy extends beyond physics.
      this.index.set(record.id, entry);
    }
    this.stats.instances = this.index.entries.size;
  }
  updateAsset(id) {
    const previous = this.states.get(id), current = this.assets.get(id);
    if (previous === current) return; // LOD/draw distance edits do not rebuild.
    this.states.set(id, current);
    for (const objectId of this.byAsset.get(id) ?? []) {
      this.delete(objectId); const object = this.data.objects.get(objectId); if (object) this.updateObject(object);
    }
  }
  startLoad(state) {
    if (state.watched) return;
    state.watched = true;
    this.assets.load(state).then(mesh => {
      if (this.disposed || !mesh || this.states.get(state.id) !== state) return;
      for (const id of this.byAsset.get(state.id) ?? []) { const object = this.data.objects.get(id); if (object) this.updateObject(object); }
    });
  }
  checkReady(entry) {
    if (entry.mesh || (this.preparingCamera && entry.cameraMesh !== undefined)) return;
    this.isReady = false; this.loads.add(entry.state); this.startLoad(entry.state);
  }
  prepare(bounds, camera = false) {
    if (!bounds) return true;
    this.preparingCamera = camera;
    this.isReady = true; this.loads.clear(); this.index.query(bounds, this.readyVisitor);
    this.stats.loading = !this.isReady; return this.isReady;
  }
  async ready(bounds) {
    this.prepare(bounds); const loads = [...this.loads]; await Promise.all(loads.map(state => this.assets.load(state)));
    for (const state of loads) if (state.error) throw new Error(state.error);
    this.prepare(bounds);
  }
  query(bounds, visit) { this.prepare(bounds, this.cameraQuery); super.query(bounds, visit); }
  dispose() { this.disposed = true; this.unsubscribe(); this.assets.dispose(); this.byAsset.clear(); this.states.clear(); this.loads.clear(); this.runtimeMeshes.clear(); super.dispose(); }
}
