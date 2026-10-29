import * as THREE from "three";
import { ObjectLODGroup } from "./ObjectLODGroup.js";
import { lodResourceIds } from "./ObjectLOD.js";

const NO_DIAGNOSTICS = [];
const sameModels = (before, after) => before?.lod && after?.lod && before.data === after.data
  && JSON.stringify(before.bounds) === JSON.stringify(after.bounds)
  && JSON.stringify(before.lod.levels.filter(l => l.enabled && l.resourceId)) === JSON.stringify(after.lod.levels.filter(l => l.enabled && l.resourceId));

export function applyObjectTransform(root, record) {
  root.position.fromArray(record.position); root.rotation.set(...record.rotation);
  root.scale.fromArray(record.scale); root.updateMatrixWorld(true);
}
export function objectHitVisible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible || node.userData.shadowProxy) return false;
  return true;
}
export function releaseObject(root) {
  root.userData.mixer?.stopAllAction(); root.userData.mixer?.uncacheRoot(root.userData.animationRoot ?? root);
  // Instance clones share geometry/materials, but own their skeleton textures.
  const skeletons = new Set();
  root.traverse(node => { if (node.skeleton) skeletons.add(node.skeleton); });
  for (const skeleton of skeletons) skeleton.dispose();
  root.removeFromParent();
}

// One asset promise per GLB; one GPU batch per mesh/asset/cell. Persistent
// records and asset sources outlive all streamed render cells. No terrain LOD
// dependency. Configured assets add independently updated LOD batch groups.
export class ObjectSystem {
  constructor(scene, data, assets, { visibilityDistance = 5000, maxConcurrentLoads = 2, evictionDelay = 2000, now = () => performance.now(), lodChecksPerFrame = 2048, lodUpdateInterval = 100, diagnostics = false, excludeIds = new Set() } = {}) {
    Object.assign(this, { scene, data, assets, visibilityDistance, maxConcurrentLoads, evictionDelay, now, lodChecksPerFrame, lodUpdateInterval, diagnostics });
    this.excludeIds = excludeIds;
    this.root = new THREE.Group(); this.root.name = "World objects"; scene.add(this.root);
    this.cells = new Map(); this.pending = new Map(); this.versions = new Map(); this.bounds = new Map();
    this.drawLimits = new Map();
    this.frustum = new THREE.Frustum(); this.viewProjection = new THREE.Matrix4();
    this.matrix = new THREE.Matrix4(); this.localMatrix = new THREE.Matrix4(); this.quaternion = new THREE.Quaternion();
    this.position = new THREE.Vector3(); this.scale = new THREE.Vector3(); this.euler = new THREE.Euler();
    this.wanted = new Set(); this.selectedId = null; this.disposed = false;
    this.visibleLODGroups = []; this.lodCursor = 0;
    this.missingGeometry = new THREE.BoxGeometry(2, 2, 2);
    this.missingMaterial = new THREE.MeshBasicMaterial({ color: 0xff48cf, wireframe: true });
    this.unsubscribe = data.onChanged(event => {
      if (event.kind === "asset" || event.kind === "resource") {
        if (event.before && event.after && event.before.data === event.after.data && JSON.stringify(event.before.lod) === JSON.stringify(event.after.lod)
          && JSON.stringify(event.before.bounds) === JSON.stringify(event.after.bounds) && JSON.stringify(event.before.clips) === JSON.stringify(event.after.clips)) return;
        if (event.kind === "asset" && sameModels(event.before, event.after)) {
          for (const [key, ids] of data.cells) for (const id of ids) if (data.objects.get(id).assetId === event.id) {
            this.drawLimits.delete(key);
            for (const group of this.cells.get(key)?.lodGroups ?? []) if (group.asset.id === event.id) group.configure(event.after);
            // A pending cell build owns a snapshot of the previous settings.
            if (this.pending.has(key)) this.invalidate(key);
            break;
          }
          return;
        }
        const affected = new Set([...data.assets.values()].filter(asset => asset.id === event.id || lodResourceIds(asset).has(event.id)).map(asset => asset.id));
        if (event.kind === "asset") affected.add(event.id);
        for (const [key, ids] of data.cells) if ([...ids].some(id => affected.has(data.objects.get(id).assetId))) {
          this.invalidate(key);
          const cell = this.cells.get(key); if (cell) { this.disposeCell(cell); this.cells.delete(key); }
        }
      } else {
        if (event.before) this.invalidate(data.cellKey(event.before.position));
        if (event.after) this.invalidate(data.cellKey(event.after.position));
      }
    });
    this.stats = { residentCells: 0, visibleCells: 0, instances: 0, animated: 0, pending: 0,
      lodInstances: [0, 0, 0, 0], lodTriangles: [0, 0, 0, 0], objectDrawCalls: 0, culledCells: 0, lodTransitions: 0, lodUpdateMs: 0, lodChecks: 0 };
  }
  invalidate(key) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.bounds.delete(key); this.drawLimits.delete(key);
  }
  cellDrawLimit(key) {
    if (this.drawLimits.has(key)) return this.drawLimits.get(key);
    let limit = 0;
    for (const id of this.data.cells.get(key) ?? []) {
      const lod = this.data.assets.get(this.data.objects.get(id).assetId)?.lod;
      if (lod?.maxDistance == null) { limit = Infinity; break; }
      limit = Math.max(limit, lod.maxDistance * (1 + lod.hysteresis));
    }
    this.drawLimits.set(key, limit); return limit;
  }
  recordMatrix(record, target = this.matrix) {
    this.position.fromArray(record.position); this.scale.fromArray(record.scale); this.euler.set(...record.rotation);
    this.quaternion.setFromEuler(this.euler); return target.compose(this.position, this.quaternion, this.scale);
  }
  cellBounds(key) {
    if (this.bounds.has(key)) return this.bounds.get(key);
    const bounds = new THREE.Box3(), box = new THREE.Box3(), variantBox = new THREE.Box3();
    for (const id of this.data.cells.get(key) ?? []) {
      const record = this.data.objects.get(id), asset = this.data.assets.get(record.assetId);
      box.min.fromArray(asset?.bounds?.min ?? [-1, -1, -1]); box.max.fromArray(asset?.bounds?.max ?? [1, 1, 1]);
      for (const level of asset?.lod?.levels ?? []) {
        if (!level.enabled || !level.resourceId) continue;
        const variant = this.data.getResource(level.resourceId)?.bounds; if (!variant) continue;
        variantBox.min.fromArray(variant.min); variantBox.max.fromArray(variant.max); box.union(variantBox);
      }
      box.applyMatrix4(this.recordMatrix(record)); bounds.union(box);
      // Distance uses placement pivots, including models exported off-origin.
      bounds.expandByPoint(this.position.fromArray(record.position));
    }
    this.bounds.set(key, bounds); return bounds;
  }
  createLive(record, source, level = 0) {
    const root = new THREE.Group(); root.userData.objectId = record.id;
    const model = source ? this.assets.clone(source) : new THREE.Mesh(this.missingGeometry, this.missingMaterial);
    root.add(model); applyObjectTransform(root, record);
    if (source?.animations.length && record.properties.animation !== false) {
      // A wrapper owns world placement. Root animation can never overwrite it.
      const mixer = new THREE.AnimationMixer(model);
      const clip = source.animations.find(clip => clip.name === record.properties.clip) ?? source.animations[0];
      const action = mixer.clipAction(clip);
      action.play(); root.userData.mixer = mixer; root.userData.animationRoot = model; root.userData.animationClip = clip;
    }
    root.userData.lodLevel = level;
    root.traverse(mesh => { if (mesh.isMesh || mesh.isLine || mesh.isPoints) this.observeMesh(mesh, level); });
    return root;
  }
  observeMesh(mesh, level) {
    const original = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      original.call(mesh, renderer, scene, camera, geometry, material, group);
      if (!this.diagnostics) return;
      this.stats.objectDrawCalls++;
      if (!mesh.isMesh || level < 0 || material?.wireframe) return;
      const total = geometry.index?.count ?? geometry.attributes.position?.count ?? 0;
      const start = Math.max(geometry.drawRange.start, group?.start ?? 0);
      const end = Math.min(total, geometry.drawRange.start + geometry.drawRange.count, group ? group.start + group.count : Infinity);
      this.stats.lodTriangles[level] += Math.max(0, Math.floor((end - start) / 3)) * (mesh.isInstancedMesh ? mesh.count : 1);
    };
  }
  diagnosticLines() {
    if (!this.diagnostics) return NO_DIAGNOSTICS;
    const s = this.stats;
    return [`Object LOD instances ${s.lodInstances.map((n, i) => `${i}:${n}`).join(" ")}`,
      `Object LOD tris ${s.lodTriangles.map((n, i) => `${i}:${n}`).join(" ")} · ${s.objectDrawCalls} GLB draws`,
      `Object cells culled ${s.culledCells} · LOD changes ${s.lodTransitions} · ${s.lodChecks} checks / ${s.lodUpdateMs.toFixed(3)} ms`];
  }
  activeLOD(id) {
    const record = this.data.objects.get(id); if (!record) return null;
    if (!this.data.assets.get(record.assetId)?.lod) return 0;
    const cell = this.cells.get(this.data.cellKey(record.position));
    return cell?.lodGroups.find(group => group.asset.id === record.assetId)?.activeLevel(id) ?? null;
  }
  setSelected(id) {
    const previous = this.data.objects.get(this.selectedId); this.selectedId = id;
    if (previous) this.invalidate(this.data.cellKey(previous.position));
    const current = this.data.objects.get(id); if (current) this.invalidate(this.data.cellKey(current.position));
    this.hideObject(id);
  }
  setExcluded(id, excluded) {
    if (this.excludeIds.has(id) === excluded) return;
    if (excluded) this.excludeIds.add(id); else this.excludeIds.delete(id);
    const record = this.data.objects.get(id);
    if (record) {
      const key = this.data.cellKey(record.position), version = this.versions.get(key) ?? 0;
      this.versions.set(key, version + 1); // Cancel any pending cell snapshot.
      const cell = this.cells.get(key);
      if (excluded && cell?.version === version) {
        // The resident cell is already correct after hiding this slot. Keep
        // its other GPU batches instead of rebuilding a large cell per hit.
        cell.version = version + 1;
        if (id !== this.selectedId && !this.data.assets.get(record.assetId)?.lod) cell.count = Math.max(0, cell.count - 1);
      }
    }
    if (excluded) this.hideObject(id);
  }
  hideObject(id) {
    // Hide the old batch slot immediately, before the asynchronous rebuild.
    if (id) for (const cell of this.cells.values()) {
      for (const group of cell.lodGroups) {
        const state = group.byId.get(id);
        if (state) { state.revision++; state.target?.remove(id); state.target = null; group.flush(); }
      }
      cell.group.traverse(mesh => {
        const index = mesh.userData.objectIds?.indexOf(id);
        if (index >= 0) { mesh.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0)); mesh.instanceMatrix.needsUpdate = true; }
      });
      for (const root of cell.live) if (root.userData.objectId === id) root.visible = false;
    }
  }
  async buildCell(key, version) {
    const group = new THREE.Group(); group.name = `Object cell ${key}`;
    const cell = { key, group, live: [], animated: [], lodGroups: [], leases: [], version, lastVisible: this.now(), count: 0 };
    try {
      const buckets = new Map();
      for (const id of this.data.cells.get(key) ?? []) {
        if (id === this.selectedId || this.excludeIds.has(id)) continue;
        const record = this.data.objects.get(id);
        if (!buckets.has(record.assetId)) buckets.set(record.assetId, []);
        buckets.get(record.assetId).push(record);
      }
      for (const [assetId, records] of buckets) {
        const asset = this.data.assets.get(assetId);
        if (asset?.lod) {
          const lodGroup = new ObjectLODGroup(this, cell, asset, records); cell.lodGroups.push(lodGroup);
          await lodGroup.initialize(this.camera);
          if (this.disposed || version !== (this.versions.get(key) ?? 0) || !this.wanted.has(key)) { this.disposeCell(cell); return; }
          continue;
        }
        const lease = this.assets.acquire(assetId); cell.leases.push(lease);
        const source = await lease.promise.catch(() => null);
        if (this.disposed || version !== (this.versions.get(key) ?? 0) || !this.wanted.has(key)) { this.disposeCell(cell); return; }
        // Reflections cannot be represented by InstancedMesh. Positive object
        // scales are enforced; authored mirrored nodes stay live as well.
        const canBatch = source?.canInstance && source.meshes.every(({ matrix }) => matrix.determinant() > 0);
        const batchRecords = canBatch ? records.filter(record => !record.properties.independent) : [];
        const liveRecords = batchRecords.length > 1 ? records.filter(record => record.properties.independent) : records;
        if (batchRecords.length > 1) {
          for (const { mesh, matrix } of source.meshes) {
            const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, batchRecords.length);
            batch.name = mesh.name; batch.castShadow = mesh.castShadow; batch.receiveShadow = mesh.receiveShadow;
            batch.layers.mask = mesh.layers.mask;
            batch.userData.objectIds = batchRecords.map(record => record.id);
            batch.userData.shadowProxy = mesh.userData.shadowProxy;
            this.observeMesh(batch, 0);
            batchRecords.forEach((record, i) => batch.setMatrixAt(i, this.recordMatrix(record).multiply(matrix)));
            batch.instanceMatrix.needsUpdate = true; batch.computeBoundingBox(); batch.computeBoundingSphere();
            batch.matrixAutoUpdate = false; group.add(batch);
          }
        }
        for (const record of liveRecords) {
          const root = this.createLive(record, source); cell.live.push(root); group.add(root);
          if (root.userData.mixer) cell.animated.push(root);
          else if (!record.properties.independent) root.traverse(node => { node.matrixAutoUpdate = false; node.matrixWorldAutoUpdate = false; });
        }
        cell.count += records.length;
      }
      if (this.disposed || version !== (this.versions.get(key) ?? 0) || !this.wanted.has(key)) { this.disposeCell(cell); return; }
      const old = this.cells.get(key); if (old) this.disposeCell(old);
      this.cells.set(key, cell); this.root.add(group);
    } catch (error) { this.disposeCell(cell); this.assets.onError(`Object cell ${key}: ${error.message}`); }
  }
  disposeCell(cell) {
    for (const group of cell.lodGroups) group.dispose();
    for (const lease of cell.leases) lease.release();
    cell.group.traverse(node => { if (node.isInstancedMesh) node.dispose(); });
    for (const live of cell.live) {
      releaseObject(live);
    }
    cell.group.removeFromParent();
  }
  update(camera, delta = 0) {
    if (this.disposed) return;
    this.camera = camera; this.visibleLODGroups.length = 0;
    if (this.diagnostics) { this.stats.lodInstances.fill(0); this.stats.lodTriangles.fill(0); this.stats.objectDrawCalls = 0; }
    camera.updateMatrixWorld(); this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection); this.wanted.clear();
    const candidates = [], now = this.now(); let visibleCells = 0, instances = 0, animated = 0;
    // Walk occupied cells, never individual distant objects. Bounds are cached
    // until that cell's data changes, and include objects crossing cell edges.
    for (const key of this.data.cells.keys()) {
      const box = this.cellBounds(key), distance = box.distanceToPoint(camera.position);
      const cell = this.cells.get(key);
      let active = cell?.count > 0;
      if (cell && !active) for (const group of cell.lodGroups) if (group.count || group.pending.size) { active = true; break; }
      // Existing members finish their ordinary budgeted cull pass. Empty or
      // unbuilt cells beyond every asset's limit need no GLB loads or checks.
      const visible = distance <= this.visibilityDistance && (active || distance <= this.cellDrawLimit(key)) && this.frustum.intersectsBox(box);
      if (visible) {
        this.wanted.add(key); visibleCells++;
        if (!cell || cell.version !== (this.versions.get(key) ?? 0)) candidates.push({ key, distance });
      }
      if (cell) {
        cell.group.visible = visible;
        if (visible) {
          cell.lastVisible = now; instances += cell.count;
          if (this.diagnostics) this.stats.lodInstances[0] += cell.count;
          for (const group of cell.lodGroups) {
            this.visibleLODGroups.push(group); animated += group.updateAnimations(delta);
          }
          for (const live of cell.animated) if (live.visible) {
            live.userData.mixer.update(Math.min(delta, .1)); animated++;
          }
        }
      }
    }
    const lodStarted = this.diagnostics ? performance.now() : 0;
    let remaining = this.lodChecksPerFrame;
    let idleGroups = 0;
    while (this.visibleLODGroups.length && remaining > 0 && idleGroups < this.visibleLODGroups.length) {
      this.lodCursor %= this.visibleLODGroups.length;
      const group = this.visibleLODGroups[this.lodCursor++];
      const checked = group.updateLOD(camera, now, Math.min(256, remaining));
      remaining -= checked; idleGroups = checked ? 0 : idleGroups + 1;
      group.flush(); group.cleanup(now);
    }
    this.stats.lodChecks = this.lodChecksPerFrame - remaining;
    for (const group of this.visibleLODGroups) {
      instances += group.count;
      if (this.diagnostics) for (const target of group.targets.values()) if (target.level >= 0) this.stats.lodInstances[target.level] += target.count;
    }
    if (this.diagnostics) this.stats.lodUpdateMs = performance.now() - lodStarted;
    for (const [key, cell] of this.cells) {
      if (!this.data.cells.has(key) || (!this.wanted.has(key) && now - cell.lastVisible > this.evictionDelay)) {
        this.disposeCell(cell); this.cells.delete(key);
        if (!this.data.cells.has(key)) { this.bounds.delete(key); this.versions.delete(key); this.drawLimits.delete(key); }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let started = 0;
    for (const { key } of candidates) {
      if (this.pending.size >= this.maxConcurrentLoads || started >= 2) break;
      if (this.pending.has(key)) continue;
      started++;
      const promise = this.buildCell(key, this.versions.get(key) ?? 0).finally(() => this.pending.delete(key));
      this.pending.set(key, promise);
    }
    Object.assign(this.stats, { residentCells: this.cells.size, visibleCells, instances, animated, pending: this.pending.size, culledCells: this.data.cells.size - visibleCells });
    this.assets.trim();
  }
  async whenIdle() {
    for (let pass = 0; pass < 10; pass++) {
      const tasks = [...this.pending.values()];
      for (const cell of this.cells.values()) for (const group of cell.lodGroups) tasks.push(...group.pending);
      if (!tasks.length) return;
      await Promise.all(tasks);
    }
  }
  pick(raycaster) {
    const roots = [];
    for (const cell of this.cells.values()) if (cell.group.visible) roots.push(cell.group);
    this.root.updateMatrixWorld(true);
    for (const hit of raycaster.intersectObjects(roots, true)) {
      if (!objectHitVisible(hit.object)) continue;
      if (hit.object.isInstancedMesh && hit.object.userData.objectIds) {
        const id = hit.object.userData.objectIds[hit.instanceId];
        if (id !== this.selectedId && !this.excludeIds.has(id)) return { id, distance: hit.distance };
      }
      let root = hit.object;
      while (root && !root.userData.objectId) root = root.parent;
      if (root?.visible && root.userData.objectId !== this.selectedId && !this.excludeIds.has(root.userData.objectId)) return { id: root.userData.objectId, distance: hit.distance };
    }
    return null;
  }
  dispose() {
    this.disposed = true; this.unsubscribe();
    for (const cell of this.cells.values()) this.disposeCell(cell);
    this.cells.clear(); this.root.removeFromParent();
    this.drawLimits.clear();
    this.missingGeometry.dispose(); this.missingMaterial.dispose();
  }
}
