// Persistent authoring data. Render cells may be discarded without touching it.
import { normalizeLOD } from "./ObjectLOD.js";
export const OBJECT_CELL_SIZE = 128;
export const objectId = () => globalThis.crypto.randomUUID();
export const copy = value => value == null ? null : structuredClone(value);
// GLB strings are immutable. History needs independent editable metadata, but
// must not copy megabytes of base64 on every distance/checkbox edit.
export const copyAsset = value => {
  if (value == null) return null;
  const { data, ...metadata } = value; return { ...structuredClone(metadata), data };
};
const vector = (value, fallback) => {
  const result = value ?? fallback;
  if (!Array.isArray(result) || result.length !== 3 || !result.every(Number.isFinite)) throw new Error("Invalid object transform.");
  return [...result];
};
export function normalizeObject(value) {
  if (!value || typeof value.id !== "string" || !value.id || typeof value.assetId !== "string" || !value.assetId) throw new Error("Invalid placed object ID or asset reference.");
  const result = { id: value.id, assetId: value.assetId, position: vector(value.position, [0, 0, 0]), rotation: vector(value.rotation, [0, 0, 0]), scale: vector(value.scale, [1, 1, 1]), properties: copy(value.properties ?? {}) };
  if (typeof result.properties !== "object" || Array.isArray(result.properties)) throw new Error("Invalid object properties.");
  if (result.scale.some(n => n <= 0)) throw new Error("Object scales must be positive.");
  if (value.anchor) {
    const { sourceX, sourceZ, offset = 0 } = value.anchor;
    if (![sourceX, sourceZ, offset].every(Number.isFinite)) throw new Error("Invalid object terrain anchor.");
    result.anchor = { sourceX, sourceZ, offset };
  }
  return result;
}
export function normalizeAsset(value, validatePayload = true) {
  if (!value || typeof value.id !== "string" || !value.id || typeof value.name !== "string") throw new Error("Invalid GLB asset.");
  // Missing payloads are retained as explicit missing assets, allowing repair.
  if (validatePayload && value.data != null && (typeof value.data !== "string" || !/^data:model\/gltf-binary;base64,[A-Za-z0-9+/]*={0,2}$/.test(value.data))) throw new Error(`Invalid GLB payload: ${value.name}`);
  const result = { id: value.id, name: value.name, data: value.data ?? null };
  if (value.bounds) {
    result.bounds = { min: vector(value.bounds.min), max: vector(value.bounds.max) };
    if (result.bounds.min.some((n, i) => n > result.bounds.max[i])) throw new Error("Invalid GLB bounds.");
  }
  if (value.triangles != null) {
    if (!Number.isSafeInteger(value.triangles) || value.triangles < 0) throw new Error("Invalid GLB triangle count.");
    result.triangles = value.triangles;
  }
  if (value.clips) {
    if (!Array.isArray(value.clips) || !value.clips.every(name => typeof name === "string")) throw new Error("Invalid animation clip list.");
    result.clips = [...value.clips];
  }
  if (value.lod != null) result.lod = normalizeLOD(value.lod, result.id);
  return result;
}
export class ObjectData {
  constructor() {
    this.assets = new Map(); this.resources = new Map(); this.objects = new Map(); this.cells = new Map(); this.anchors = new Map();
    this.listeners = new Set(); this.revision = 0; this.savedRevision = 0;
  }
  static fromJSON(value) {
    const data = new ObjectData();
    if (value == null) return data;
    if (!Array.isArray(value.assets) || !Array.isArray(value.instances)) throw new Error("Invalid object library.");
    for (const asset of value.assets) {
      const record = normalizeAsset(asset);
      if (data.assets.has(record.id)) throw new Error(`Duplicate asset: ${record.id}`);
      data.assets.set(record.id, record);
    }
    if (value.resources !== undefined && !Array.isArray(value.resources)) throw new Error("Invalid GLB resources.");
    for (const resource of value.resources ?? []) {
      const record = normalizeAsset(resource);
      if (record.lod || data.resources.has(record.id) || data.assets.has(record.id)) throw new Error(`Invalid or duplicate GLB resource: ${record.id}`);
      data.resources.set(record.id, record);
    }
    for (const object of value.instances) {
      if (data.objects.has(object.id)) throw new Error(`Duplicate object: ${object.id}`);
      data.setObject(object);
    }
    data.revision = data.savedRevision = 0;
    return data;
  }
  cellKey(position) { return `${Math.floor(position[0] / OBJECT_CELL_SIZE)},${Math.floor(position[2] / OBJECT_CELL_SIZE)}`; }
  anchorKey(anchor) { return `${Math.floor(anchor.sourceX / 256)},${Math.floor(anchor.sourceZ / 256)}`; }
  onChanged(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed(event) { ++this.revision; for (const listener of this.listeners) listener(event); }
  get hasUnsavedChanges() { return this.revision !== this.savedRevision; }
  setAsset(value) {
    const before = this.getResource(value?.id), asset = normalizeAsset(value, before?.data !== value?.data);
    this.resources.delete(asset.id); this.assets.set(asset.id, asset);
    this.changed({ kind: "asset", id: asset.id, before, after: asset }); return asset;
  }
  getResource(id) { return this.resources.get(id) ?? this.assets.get(id); }
  setResource(value) {
    const before = this.resources.get(value?.id), resource = normalizeAsset(value, before?.data !== value?.data);
    if (resource.lod || this.assets.has(resource.id)) throw new Error("GLB resources cannot replace logical assets.");
    this.resources.set(resource.id, resource);
    this.changed({ kind: "resource", id: resource.id, before, after: resource }); return resource;
  }
  deleteResource(id) {
    if ([...this.assets.values()].some(asset => asset.lod?.levels.some(level => level.resourceId === id))) throw new Error("This GLB is still used by an LOD level.");
    const before = this.resources.get(id);
    if (this.resources.delete(id)) this.changed({ kind: "resource", id, before, after: null });
  }
  demoteAsset(id, value) {
    if ([...this.objects.values()].some(object => object.assetId === id)) throw new Error("Delete this asset's placed objects first.");
    const resource = normalizeAsset(value), before = this.assets.get(id);
    if (resource.id !== id || resource.lod) throw new Error("Invalid restored GLB resource.");
    this.assets.delete(id); this.resources.set(id, resource);
    this.changed({ kind: "asset", id, before, after: null });
  }
  deleteAsset(id) {
    if ([...this.objects.values()].some(object => object.assetId === id)) throw new Error("Delete this asset's placed objects first.");
    if ([...this.assets.values()].some(asset => asset.id !== id && asset.lod?.levels.some(level => level.resourceId === id))) throw new Error("This GLB is used by another asset's LOD configuration.");
    const before = this.assets.get(id);
    if (this.assets.delete(id)) this.changed({ kind: "asset", id, before, after: null });
  }
  index(map, key, id, add) {
    if (add) { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); }
    else { const entries = map.get(key); entries?.delete(id); if (!entries?.size) map.delete(key); }
  }
  setObject(value) {
    const object = normalizeObject(value), before = this.objects.get(object.id);
    if (before) {
      this.index(this.cells, this.cellKey(before.position), before.id, false);
      if (before.anchor) this.index(this.anchors, this.anchorKey(before.anchor), before.id, false);
    }
    this.objects.set(object.id, object);
    this.index(this.cells, this.cellKey(object.position), object.id, true);
    if (object.anchor) this.index(this.anchors, this.anchorKey(object.anchor), object.id, true);
    this.changed({ kind: "object", id: object.id, before, after: object }); return object;
  }
  deleteObject(id) {
    const before = this.objects.get(id); if (!before) return;
    this.objects.delete(id); this.index(this.cells, this.cellKey(before.position), id, false);
    if (before.anchor) this.index(this.anchors, this.anchorKey(before.anchor), id, false);
    this.changed({ kind: "object", id, before, after: null });
  }
  snapshot() {
    const used = new Set([...this.assets.values()].flatMap(asset => asset.lod?.levels.map(level => level.resourceId) ?? []));
    return { revision: this.revision, value: { assets: [...this.assets.values()], resources: [...this.resources.values()].filter(resource => used.has(resource.id)), instances: [...this.objects.values()] } };
  }
  commit(snapshot) { this.savedRevision = snapshot.revision; }
}
