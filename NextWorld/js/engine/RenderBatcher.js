import * as THREE from "three";

// Renders repeated static GLB types with InstancedMesh. Source objects stay
// alive for editor picking and transforms, but are hidden while their instance
// matrix is rendered by the batch. The selected source is shown normally.
export class RenderBatcher {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "Instanced map batches";
    this.entries = new Map();
    this.typeBatches = new Map();
    this.selected = null;
    this.hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  rebuild(objects) {
    const previouslySelected = this.selected;
    this.clear();
    const groups = new Map();
    for (const source of objects) {
      const type = source.userData.assetType;
      if (!type?.glb || type.render?.instanced === false) continue;
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(source);
    }
    for (const sources of groups.values()) if (sources.length >= 2) this.buildType(sources);
    if (this.root.children.length) this.scene.add(this.root);
    this.setSelected(previouslySelected);
  }
  buildType(sources) {
    const templateMeshes = this.getMeshes(sources[0]);
    if (!templateMeshes.length) return;
    const capacity = this.capacityFor(sources.length);
    const batches = templateMeshes.map(template => {
      const batch = new THREE.InstancedMesh(template.geometry, template.material, capacity);
      batch.name = `Instances: ${sources[0].userData.assetType.name}`;
      batch.castShadow = template.castShadow; batch.receiveShadow = template.receiveShadow;
      batch.count = sources.length;
      batch.frustumCulled = false; this.root.add(batch);
      return batch;
    });
    sources.forEach((source, index) => {
      source.updateWorldMatrix(true, true);
      const meshes = this.getMeshes(source);
      if (meshes.length !== batches.length) return;
      const slots = [];
      meshes.forEach((mesh, meshIndex) => {
        batches[meshIndex].setMatrixAt(index, mesh.matrixWorld);
        slots.push({ batch: batches[meshIndex], index, mesh });
      });
      source.visible = false;
      this.entries.set(source, slots);
    });
    batches.forEach(batch => batch.instanceMatrix.needsUpdate = true);
    this.typeBatches.set(sources[0].userData.assetType, { batches, count: sources.length, capacity });
  }
  // Add one object without rebuilding every existing batch. `objects` lets us
  // form the first batch as soon as a type gains its second instance.
  add(source, objects) {
    const type = source?.userData.assetType;
    if (!type?.glb || type.render?.instanced === false) return;
    let record = this.typeBatches.get(type);
    if (!record) {
      const siblings = objects.filter(object => object.userData.assetType === type);
      if (siblings.length >= 2) {
        this.buildType(siblings);
        if (!this.root.parent) this.scene.add(this.root);
      }
      return;
    }
    if (this.entries.has(source)) return;
    const meshes = this.getMeshes(source);
    if (meshes.length !== record.batches.length) return;
    if (record.count === record.capacity) record = this.grow(type, record);
    source.updateWorldMatrix(true, true);
    const slots = [];
    meshes.forEach((mesh, meshIndex) => {
      const batch = record.batches[meshIndex];
      batch.setMatrixAt(record.count, mesh.matrixWorld);
      batch.count = record.count + 1;
      batch.instanceMatrix.needsUpdate = true;
      slots.push({ batch, index: record.count, mesh });
    });
    source.visible = false;
    this.entries.set(source, slots);
    record.count++;
  }
  grow(type, record) {
    const capacity = this.capacityFor(record.count + 1);
    const grown = record.batches.map(oldBatch => {
      const batch = new THREE.InstancedMesh(oldBatch.geometry, oldBatch.material, capacity);
      batch.name = oldBatch.name; batch.castShadow = oldBatch.castShadow; batch.receiveShadow = oldBatch.receiveShadow;
      batch.frustumCulled = false; batch.count = record.count;
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < record.count; index++) { oldBatch.getMatrixAt(index, matrix); batch.setMatrixAt(index, matrix); }
      batch.instanceMatrix.needsUpdate = true;
      this.root.add(batch); oldBatch.removeFromParent();
      return batch;
    });
    // Existing source slots must point at the new InstancedMesh objects.
    for (const slots of this.entries.values()) for (const slot of slots) {
      const index = record.batches.indexOf(slot.batch);
      if (index >= 0) slot.batch = grown[index];
    }
    const result = { batches: grown, count: record.count, capacity };
    this.typeBatches.set(type, result);
    return result;
  }
  capacityFor(count) { return 2 ** Math.ceil(Math.log2(Math.max(2, count))); }
  getMeshes(source) {
    const meshes = [];
    source.traverse(child => { if (child.isMesh && child.geometry && child.material) meshes.push(child); });
    return meshes;
  }
  has(source) { return this.entries.has(source); }
  setSelected(source) {
    if (this.selected && this.selected !== source) this.setSourceBatched(this.selected, true);
    this.selected = source ?? null;
    if (this.selected) this.setSourceBatched(this.selected, false);
  }
  setSourceBatched(source, showInBatch) {
    const slots = this.entries.get(source);
    if (!slots) return;
    source.visible = !showInBatch;
    source.updateWorldMatrix(true, true);
    for (const slot of slots) {
      slot.batch.setMatrixAt(slot.index, showInBatch ? slot.mesh.matrixWorld : this.hiddenMatrix);
      slot.batch.instanceMatrix.needsUpdate = true;
    }
  }
  remove(source) {
    if (this.selected === source) this.selected = null;
    const slots = this.entries.get(source);
    if (!slots?.length) return;
    const type = source.userData.assetType;
    const record = this.typeBatches.get(type);
    if (!record) { this.entries.delete(source); return; }
    const removedIndex = slots[0].index;
    const lastIndex = record.count - 1;
    if (removedIndex !== lastIndex) {
      const matrix = new THREE.Matrix4();
      for (const batch of record.batches) {
        batch.getMatrixAt(lastIndex, matrix);
        batch.setMatrixAt(removedIndex, matrix);
        batch.instanceMatrix.needsUpdate = true;
      }
      // The source occupying the last slot now owns the deleted slot.
      for (const otherSlots of this.entries.values()) {
        if (otherSlots === slots || otherSlots[0]?.index !== lastIndex) continue;
        otherSlots.forEach(slot => { slot.index = removedIndex; });
        break;
      }
    }
    record.count--;
    record.batches.forEach(batch => { batch.count = record.count; batch.instanceMatrix.needsUpdate = true; });
    this.entries.delete(source);
    source.visible = true;
    if (record.count === 0) {
      record.batches.forEach(batch => batch.removeFromParent());
      this.typeBatches.delete(type);
    }
  }
  removeType(type, sources) {
    const record = this.typeBatches.get(type);
    record?.batches.forEach(batch => batch.removeFromParent());
    this.typeBatches.delete(type);
    for (const source of sources) {
      if (this.selected === source) this.selected = null;
      this.entries.delete(source);
      source.visible = true;
    }
  }
  clear() {
    for (const source of this.entries.keys()) source.visible = true;
    this.entries.clear(); this.selected = null;
    this.typeBatches.clear();
    this.root.removeFromParent(); this.root.clear();
  }
}
