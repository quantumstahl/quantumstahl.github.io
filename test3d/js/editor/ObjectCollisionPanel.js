import * as THREE from "three";
import { copyAsset } from "../objects/ObjectData.js";
import { fitSimpleCollider, normalizeCollision } from "../objects/ObjectCollision.js";
import { ColliderAssets } from "../physics/ColliderAssets.js";

export function commitCollision(data, id, config, recordHistory) {
  const before = copyAsset(data.assets.get(id)); if (!before) return;
  const collision = normalizeCollision(config);
  if (JSON.stringify(normalizeCollision(before.collision)) === JSON.stringify(collision)) return;
  const after = data.setAsset({ ...before, collision });
  recordHistory({ kind: "objectAsset", entries: { id, before, after: copyAsset(after) } });
}

// Uses the same mesh builder as runtime physics. No LOD/camera mesh is sampled.
export class ObjectCollisionPanel {
  constructor({ element, scene, data, assets, getAssetId, getSelectedId, getRoot, recordHistory, onStatus }) {
    Object.assign(this, { element, data, getAssetId, getSelectedId, getRoot, recordHistory, onStatus });
    this.cache = new ColliderAssets(data, assets, onStatus); this.dirty = true; this.disposed = false;
    this.unsubscribe = data.onChanged(() => { this.dirty = true; });
    element.innerHTML = `<h3>Collision</h3>
      <label>Solid collision<select id="objectCollisionMode"><option value="none">None</option><option value="simple">Simple</option><option value="mesh">Mesh</option></select></label>
      <div id="objectCollisionSimple"><label>Shape<select id="objectCollisionShape"><option value="box">Box</option><option value="cylinder">Cylinder</option><option value="capsule">Capsule</option></select></label>
      <label id="objectCollisionSizeLabel">Size (m)<span class="object-vector">${[0,1,2].map(i=>`<input data-collision-size="${i}" type="number" min="0.01" step="0.1" aria-label="Collider size ${"XYZ"[i]}">`).join("")}</span></label>
      <label id="objectCollisionRadiusLabel">Radius (m)<input id="objectCollisionRadius" type="number" min="0.01" step="0.05"></label>
      <label id="objectCollisionHeightLabel">Height including caps (m)<input id="objectCollisionHeight" type="number" min="0.01" step="0.1"></label>
      <label>Local offset (m)<span class="object-vector">${[0,1,2].map(i=>`<input data-collision-offset="${i}" type="number" step="0.1" aria-label="Collider offset ${"XYZ"[i]}">`).join("")}</span></label></div>
      <label id="objectCollisionSourceLabel">Mesh source<select id="objectCollisionSource"></select></label>
      <label class="object-check">Preview selected collider<input id="objectCollisionPreview" type="checkbox"></label>
      <p id="objectCollisionStatus" role="status"></p>`;
    this.$ = selector => element.querySelector(selector);
    this.$("#objectCollisionMode").onchange = () => {
      const mode = this.$("#objectCollisionMode").value;
      this.commit(mode === "simple" ? fitSimpleCollider(data.assets.get(getAssetId())) : { mode });
    };
    this.$("#objectCollisionShape").onchange = () => this.commit(fitSimpleCollider(data.assets.get(getAssetId()), this.$("#objectCollisionShape").value));
    for (const input of element.querySelectorAll("input[type=number]")) input.onchange = () => {
      const config = normalizeCollision(data.assets.get(getAssetId())?.collision);
      config.offset = [0,1,2].map(i => Number(this.$(`[data-collision-offset="${i}"]`).value));
      if (config.shape === "box") config.size = [0,1,2].map(i => Number(this.$(`[data-collision-size="${i}"]`).value));
      else { config.radius = Number(this.$("#objectCollisionRadius").value); config.height = Number(this.$("#objectCollisionHeight").value); }
      this.commit(config);
    };
    this.$("#objectCollisionSource").onchange = () => this.commit({ mode: "mesh", sourceId: this.$("#objectCollisionSource").value || undefined });
    this.preview = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color:0x00eeff,depthTest:false,transparent:true,opacity:.7}));
    this.preview.name = "Selected object collision preview"; this.preview.matrixAutoUpdate = false; this.preview.visible = false; this.preview.frustumCulled = false; scene.add(this.preview);
    this.refresh();
  }
  commit(config) {
    try { commitCollision(this.data, this.getAssetId(), config, this.recordHistory); }
    catch (error) { this.onStatus(error.message); }
    this.dirty = true; this.refresh();
  }
  refresh() {
    const asset = this.data.assets.get(this.getAssetId()), c = normalizeCollision(asset?.collision);
    this.assetId = asset?.id; this.dirty = false;
    this.$("#objectCollisionMode").disabled = !asset; this.$("#objectCollisionMode").value = c.mode;
    this.$("#objectCollisionSimple").hidden = c.mode !== "simple"; this.$("#objectCollisionSourceLabel").hidden = c.mode !== "mesh";
    this.$("#objectCollisionShape").value = c.shape ?? "box";
    this.$("#objectCollisionSizeLabel").hidden = c.shape !== "box";
    this.$("#objectCollisionRadiusLabel").hidden = this.$("#objectCollisionHeightLabel").hidden = c.shape === "box";
    for (let i=0;i<3;i++) {
      this.$(`[data-collision-size="${i}"]`).value = c.size?.[i] ?? 1;
      this.$(`[data-collision-offset="${i}"]`).value = c.offset?.[i] ?? 0;
    }
    this.$("#objectCollisionRadius").value = c.radius ?? .5; this.$("#objectCollisionHeight").value = c.height ?? 1;
    const source = this.$("#objectCollisionSource"); source.replaceChildren(new Option("Original logical GLB", ""));
    for (const resource of [...this.data.assets.values(), ...this.data.resources.values()]) if (resource.id !== asset?.id) source.add(new Option(resource.name, resource.id));
    if (c.sourceId && ![...source.options].some(o => o.value === c.sourceId)) source.add(new Option("Missing collision source", c.sourceId));
    source.value = c.sourceId ?? "";
    this.$("#objectCollisionStatus").textContent = c.mode === "mesh" ? "Static mesh; independent of visual LOD and draw distance." : c.mode === "simple" ? "Dimensions use the GLB's authored local units." : "Existing assets have no collision until enabled.";
  }
  update(active = true) {
    if (this.dirty || this.assetId !== this.getAssetId()) this.refresh();
    const record = this.data.objects.get(this.getSelectedId()), selected = record?.assetId === this.getAssetId();
    this.$("#objectCollisionPreview").disabled = !selected;
    this.preview.visible = false;
    if (!active || !selected || !this.$("#objectCollisionPreview").checked) return;
    const state = this.cache.get(record.assetId); if (!state || state.config.mode === "none") return;
    if (!state.mesh) {
      this.cache.load(state); this.$("#objectCollisionStatus").textContent = state.error ?? "Loading collider preview…"; return;
    }
    if (state.mesh !== this.previewMesh) {
      const v = state.mesh.vertices, lines = new Float32Array(v.length * 2); let offset = 0;
      for (let i = 0; i < v.length; i += 9) for (const edge of [0,1,1,2,2,0]) {
        const p = i + edge * 3; lines[offset++] = v[p]; lines[offset++] = v[p+1]; lines[offset++] = v[p+2];
      }
      this.preview.geometry.dispose(); this.preview.geometry = new THREE.BufferGeometry();
      this.preview.geometry.setAttribute("position", new THREE.BufferAttribute(lines,3)); this.previewMesh = state.mesh;
      this.$("#objectCollisionStatus").textContent = `${v.length/9} collider triangles · static, independent of LOD`;
    }
    const root = this.getRoot();
    if (root) { root.updateMatrixWorld(true); this.preview.matrix.copy(root.matrixWorld); }
    else {
      this.preview.position.fromArray(record.position); this.preview.rotation.set(...record.rotation); this.preview.scale.fromArray(record.scale); this.preview.updateMatrix();
    }
    this.preview.matrixWorldNeedsUpdate = true; this.preview.visible = true;
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.cache.dispose(); this.preview.geometry.dispose(); this.preview.material.dispose(); this.preview.removeFromParent(); }
}
