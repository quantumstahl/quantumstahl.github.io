import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { StaticColliders, boxBounds } from "./StaticColliders.js";
import { ColliderAssets } from "./ColliderAssets.js";
import { initializeContacts } from "./Contacts.js";

export class ObjectCollider extends StaticColliders {
  constructor(data, library, { onError = library.onError ?? (() => {}), excludeIds = new Set() } = {}) {
    super(); this.data = data; this.assets = new ColliderAssets(data, library, onError);
    this.excludeIds = excludeIds;
    this.byAsset = new Map(); this.states = new Map(); this.loads = new Set(); this.disposed = false;
    this.matrix = new Matrix4(); this.position = new Vector3(); this.scale = new Vector3(); this.euler = new Euler(); this.quaternion = new Quaternion();
    this.readyVisitor = this.checkReady.bind(this);
    for (const object of data.objects.values()) this.updateObject(object);
    this.unsubscribe = data.onChanged(event => {
      if (event.kind === "object") {
        if (event.before) { this.byAsset.get(event.before.assetId)?.delete(event.id); this.delete(event.id); }
        if (event.after) this.updateObject(event.after);
      } else if (event.kind === "asset") this.updateAsset(event.id);
      else if (event.kind === "resource") for (const [id, state] of this.states) if (state?.sourceId === event.id) this.updateAsset(id);
    });
  }
  transform(record) {
    this.position.fromArray(record.position); this.scale.fromArray(record.scale); this.euler.set(...record.rotation); this.quaternion.setFromEuler(this.euler);
    return this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  setExcluded(id, excluded) {
    if (excluded) { this.excludeIds.add(id); this.delete(id); }
    else { this.excludeIds.delete(id); const record = this.data.objects.get(id); if (record) this.updateObject(record); }
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
    if (state.mesh) this.set(record.id, state.mesh, matrix, record);
    else {
      const b = state.sourceBounds;
      const box = b ? new Box3(new Vector3().fromArray(b.min), new Vector3().fromArray(b.max)).applyMatrix4(matrix) : null;
      // Missing bounds mean unknown extent: discover this asset once before
      // allowing simulation, rather than silently missing a large bridge.
      this.index.set(record.id, { mesh: null, object: record, state, bounds: box ? boxBounds(box) : { minX: -Infinity, minY: -Infinity, minZ: -Infinity, maxX: Infinity, maxY: Infinity, maxZ: Infinity } });
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
    if (entry.mesh) return;
    this.isReady = false; this.loads.add(entry.state); this.startLoad(entry.state);
  }
  prepare(bounds) {
    if (!bounds) return true;
    this.isReady = true; this.loads.clear(); this.index.query(bounds, this.readyVisitor);
    this.stats.loading = !this.isReady; return this.isReady;
  }
  async ready(bounds) {
    this.prepare(bounds); const loads = [...this.loads]; await Promise.all(loads.map(state => this.assets.load(state)));
    for (const state of loads) if (state.error) throw new Error(state.error);
    this.prepare(bounds);
  }
  query(bounds, visit) { this.prepare(bounds); super.query(bounds, visit); }
  dispose() { this.disposed = true; this.unsubscribe(); this.assets.dispose(); this.byAsset.clear(); this.states.clear(); this.loads.clear(); super.dispose(); }
}
