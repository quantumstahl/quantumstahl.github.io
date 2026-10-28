import * as THREE from "three";
import { chooseLOD } from "./ObjectLOD.js";
import { releaseObject } from "./ObjectSystem.js";

const capacityFor = count => 2 ** Math.ceil(Math.log2(Math.max(8, count)));

// One target for an actual resolved LOD within a logical asset/cell. Static
// membership is densely packed. A transition swaps only the departing slot
// and appends the arriving slot; other cells/assets/levels remain untouched.
class LODTarget {
  constructor(owner, lease, reserve) {
    Object.assign(this, { owner, lease, source: lease.source, level: lease.level });
    this.root = new THREE.Group(); this.root.name = `${owner.asset.name} LOD ${this.level}`;
    owner.root.add(this.root);
    this.ids = []; this.slots = new Map(); this.live = new Map(); this.animated = new Set(); this.batches = [];
    this.capacity = capacityFor(reserve); this.dirtyMin = Infinity; this.dirtyMax = -1; this.emptySince = owner.system.now();
    this.canBatch = this.source?.canInstance && this.source.meshes.every(({ matrix }) => matrix.determinant() > 0);
    this.matrix = new THREE.Matrix4();
    if (this.canBatch) this.allocate(this.capacity);
  }
  allocate(capacity) {
    const previous = this.batches;
    this.batches = this.source.meshes.map(({ mesh }, meshIndex) => {
      const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, capacity);
      batch.name = mesh.name; batch.castShadow = mesh.castShadow; batch.receiveShadow = mesh.receiveShadow;
      batch.layers.mask = mesh.layers.mask; batch.count = this.ids.length; batch.visible = batch.count > 0;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.userData.objectIds = this.ids; batch.userData.shadowProxy = mesh.userData.shadowProxy; batch.userData.lodLevel = this.level;
      // The parent cell already culls the conservative union of ALL variants.
      // No changing bounding sphere or full matrix scan is needed per move.
      batch.frustumCulled = false; batch.matrixAutoUpdate = false;
      batch.boundingBox = this.owner.system.cellBounds(this.owner.cell.key).clone();
      batch.boundingSphere = batch.boundingBox.getBoundingSphere(new THREE.Sphere());
      this.owner.system.observeMesh(batch, this.level);
      if (previous[meshIndex]) for (let i = 0; i < this.ids.length; i++) {
        previous[meshIndex].getMatrixAt(i, this.matrix); batch.setMatrixAt(i, this.matrix);
      }
      this.root.add(batch); return batch;
    });
    for (const batch of previous) { batch.removeFromParent(); batch.dispose(); }
    this.capacity = capacity;
    if (this.ids.length) { this.dirtyMin = 0; this.dirtyMax = this.ids.length - 1; }
  }
  get count() { return this.ids.length + this.live.size; }
  add(record, oldRoot) {
    this.emptySince = null;
    if (this.canBatch && !record.properties.independent) {
      if (this.ids.length === this.capacity) this.allocate(this.capacity * 2);
      const index = this.ids.length; this.ids.push(record.id); this.slots.set(record.id, index);
      this.source.meshes.forEach(({ matrix }, i) => this.batches[i].setMatrixAt(index, this.owner.system.recordMatrix(record).multiply(matrix)));
      this.dirtyMin = Math.min(this.dirtyMin, index); this.dirtyMax = Math.max(this.dirtyMax, index);
      for (const batch of this.batches) { batch.count = this.ids.length; batch.visible = true; }
    } else {
      const oldClip = oldRoot?.userData.animationClip;
      const effectiveRecord = oldClip && !record.properties.clip ? { ...record, properties: { ...record.properties, clip: oldClip.name } } : record;
      const root = this.owner.system.createLive(effectiveRecord, this.source, this.level);
      root.userData.lodLevel = this.level;
      const mixer = root.userData.mixer, oldMixer = oldRoot?.userData.mixer;
      if (mixer) this.animated.add(root);
      if (mixer && oldMixer && oldClip?.duration > 0) {
        const phase = (oldMixer.time % oldClip.duration) / oldClip.duration;
        mixer.setTime(phase * root.userData.animationClip.duration);
      }
      if (!mixer && !record.properties.independent) root.traverse(node => { node.matrixAutoUpdate = false; node.matrixWorldAutoUpdate = false; });
      this.live.set(record.id, root); this.root.add(root);
    }
  }
  remove(id) {
    const index = this.slots.get(id);
    if (index !== undefined) {
      const last = this.ids.length - 1, movedId = this.ids[last];
      if (index !== last) {
        this.ids[index] = movedId; this.slots.set(movedId, index);
        for (const batch of this.batches) { batch.getMatrixAt(last, this.matrix); batch.setMatrixAt(index, this.matrix); }
        this.dirtyMin = Math.min(this.dirtyMin, index); this.dirtyMax = Math.max(this.dirtyMax, index);
      }
      this.ids.pop(); this.slots.delete(id);
      for (const batch of this.batches) { batch.count = this.ids.length; batch.visible = batch.count > 0; }
    }
    const root = this.live.get(id); if (root) { this.animated.delete(root); releaseObject(root); this.live.delete(id); }
    if (!this.count) this.emptySince = this.owner.system.now();
  }
  flush() {
    if (this.dirtyMax < 0) return;
    for (const batch of this.batches) {
      let start = this.dirtyMin * 16, end = (this.dirtyMax + 1) * 16;
      for (const range of batch.instanceMatrix.updateRanges) { start = Math.min(start, range.start); end = Math.max(end, range.start + range.count); }
      batch.instanceMatrix.clearUpdateRanges();
      batch.instanceMatrix.addUpdateRange(start, end - start);
      batch.instanceMatrix.needsUpdate = true;
    }
    this.dirtyMin = Infinity; this.dirtyMax = -1;
  }
  dispose() {
    for (const batch of this.batches) { batch.removeFromParent(); batch.dispose(); }
    for (const root of this.live.values()) releaseObject(root);
    this.live.clear(); this.animated.clear(); this.ids.length = 0; this.slots.clear(); this.root.removeFromParent(); this.lease.release();
  }
}

export class ObjectLODGroup {
  constructor(system, cell, asset, records) {
    Object.assign(this, { system, cell, asset });
    this.root = new THREE.Group(); this.root.name = `LOD asset ${asset.name}`; cell.group.add(this.root);
    this.states = records.map(record => ({ record, choice: null, target: null, revision: 0 }));
    this.byId = new Map(this.states.map(state => [state.record.id, state]));
    this.targets = new Map(); this.loading = new Map(); this.pending = new Set(); this.reservations = new Map();
    this.disposed = false; this.cursor = 0; this.checking = false; this.nextCheck = 0;
    this.lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.checkView = { position: new THREE.Vector3() }; this.flushScheduled = false;
  }
  async initialize(camera) {
    const view = { position: camera.position.clone() };
    for (const state of this.states) {
      const choice = chooseLOD(this.asset, this.distance(state, view));
      this.reservations.set(choice, (this.reservations.get(choice) ?? 0) + 1);
    }
    await Promise.all(this.states.map(state => this.switchTo(state, chooseLOD(this.asset, this.distance(state, view)))));
    this.lastCamera.copy(view.position);
    this.flush();
  }
  distance(state, camera) {
    const p = state.record.position, c = camera.position;
    return Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z);
  }
  ensureTarget(requested) {
    if (!this.loading.has(requested)) {
      const task = this.system.assets.acquireLOD(this.asset.id, requested).then(lease => {
        if (this.disposed) { lease.release(); return null; }
        const key = `${lease.level}:${lease.resourceId}`;
        let target = this.targets.get(key);
        if (target) lease.release();
        else {
          try { target = new LODTarget(this, lease, this.reservations.get(requested) ?? 8); this.targets.set(key, target); }
          catch (error) { lease.release(); throw error; }
        }
        return target;
      }).finally(() => this.loading.delete(requested));
      this.loading.set(requested, task);
    }
    return this.loading.get(requested);
  }
  switchTo(state, choice) {
    const previousChoice = state.choice; state.choice = choice; const revision = ++state.revision;
    if (choice === -1) {
      if (state.target) { state.target.remove(state.record.id); state.target = null; this.system.stats.lodTransitions++; }
      return Promise.resolve();
    }
    const task = this.ensureTarget(choice).then(target => {
      if (!target || this.disposed || state.revision !== revision || state.target === target) return;
      const previous = state.target;
      // Add and remove in one turn after the GLB is ready: no blank frames,
      // duplicated render frames, identity changes or per-tree THREE.LODs.
      target.add(state.record, previous?.live.get(state.record.id));
      previous?.remove(state.record.id); state.target = target;
      this.scheduleFlush();
      if (previous || previousChoice === -1) this.system.stats.lodTransitions++;
    }).catch(error => this.system.assets.onError(`LOD ${choice}: ${error.message}`)).finally(() => this.pending.delete(task));
    this.pending.add(task); return task;
  }
  updateLOD(camera, now, budget) {
    if (!this.checking) {
      if (now < this.nextCheck || this.lastCamera.distanceToSquared(camera.position) < .0001) return 0;
      this.checking = true; this.cursor = 0;
      this.checkView.position.copy(camera.position);
    }
    let checked = 0;
    while (this.cursor < this.states.length && checked < budget) {
      const state = this.states[this.cursor++], choice = chooseLOD(this.asset, this.distance(state, this.checkView), state.choice);
      if (choice !== state.choice) this.switchTo(state, choice);
      checked++;
    }
    if (this.cursor === this.states.length) {
      this.checking = false; this.lastCamera.copy(this.checkView.position); this.nextCheck = now + this.system.lodUpdateInterval;
    }
    return checked;
  }
  updateAnimations(delta) {
    let animated = 0;
    for (const target of this.targets.values()) for (const root of target.animated) {
      root.userData.mixer.update(Math.min(delta, .1)); animated++;
    }
    return animated;
  }
  flush() { for (const target of this.targets.values()) target.flush(); }
  scheduleFlush() {
    if (this.flushScheduled) return; this.flushScheduled = true;
    queueMicrotask(() => { this.flushScheduled = false; if (!this.disposed) this.flush(); });
  }
  cleanup(now) {
    for (const [key, target] of this.targets) if (target.emptySince !== null && now - target.emptySince >= this.system.evictionDelay) {
      target.dispose(); this.targets.delete(key);
    }
  }
  get count() { let count = 0; for (const target of this.targets.values()) count += target.count; return count; }
  activeLevel(id) { return this.byId.get(id)?.target?.level ?? null; }
  dispose() {
    this.disposed = true;
    for (const target of this.targets.values()) target.dispose();
    this.targets.clear(); this.root.removeFromParent();
  }
}
