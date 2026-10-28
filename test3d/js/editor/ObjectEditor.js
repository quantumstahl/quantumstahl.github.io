import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { copy, copyAsset, objectId } from "../objects/ObjectData.js";
import { applyObjectTransform, releaseObject, objectHitVisible } from "../objects/ObjectSystem.js";
import { sampleObjectSurface } from "../objects/ObjectSurface.js";
import { chooseLOD, enabledLODLevels, lodResourceIds } from "../objects/ObjectLOD.js";
import { ObjectLODPanel, applyLODHistory } from "./ObjectLODPanel.js";
import { ObjectBrush, DEFAULT_OBJECT_BRUSH, applyBrushHistory } from "./ObjectBrush.js";

export class ObjectEditor {
  constructor({ scene, camera, canvas, data, assets, system, provider, panel, recordHistory, onStatus, activate }) {
    Object.assign(this, { scene, camera, canvas, data, assets, system, provider, panel, recordHistory, onStatus, activate });
    this.active = false; this.assetId = null; this.selectedId = null; this.selectedRoot = null;
    this.selectVersion = 0; this.beforeDrag = null; this.pointerStart = null; this.mode = "select";
    this.sourceLease = null; this.selectedLODVersion = 0; this.selectedChoice = null; this.requestedLOD = null; this.previewLOD = null; this.nextLODCheck = 0;
    this.objectBrush = new ObjectBrush(data, provider, { onCommit: step => {
      this.recordHistory(step); this.listsDirty = true;
      this.onStatus(`Object brush: ${step.entries.filter(e => e.after).length} added, ${step.entries.filter(e => !e.after).length} removed`);
    } });
    this.brushPointerId = null; this.brushPointer = null; this.brushPickDirty = false; this.nextListRefresh = 0;
    this.brushCameraPosition = new THREE.Vector3(Infinity, Infinity, Infinity); this.brushCameraRotation = new THREE.Quaternion();
    this.brushPreview = new THREE.Group(); this.brushPreview.name = "Object brush preview"; this.brushPreview.visible = false;
    const circle = [];
    for (let i = 0; i < 64; i++) { const angle = i / 64 * Math.PI * 2; circle.push(Math.cos(angle), Math.sin(angle), 0); }
    this.brushGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(circle, 3));
    this.brushMaterial = new THREE.LineBasicMaterial({ color: 0x8ce5ff, transparent: true, opacity: .65, depthTest: false, depthWrite: false });
    for (const rotation of [[0, 0, 0], [Math.PI / 2, 0, 0], [0, Math.PI / 2, 0]]) {
      const line = new THREE.LineLoop(this.brushGeometry, this.brushMaterial); line.rotation.set(...rotation); line.renderOrder = 3; line.frustumCulled = false; this.brushPreview.add(line);
    }
    scene.add(this.brushPreview);
    this.controls = new TransformControls(camera, canvas); this.controls.enabled = false;
    scene.add(this.controls.getHelper());
    this.outline = new THREE.BoxHelper(undefined, 0x80d7ff); this.outline.visible = false; scene.add(this.outline);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.controls.addEventListener("mouseDown", () => { this.beforeDrag = copy(data.objects.get(this.selectedId)); });
    this.controls.addEventListener("mouseUp", () => this.finishTransform(false));
    this.controls.addEventListener("objectChange", () => { this.syncFields(); this.updateOutline(); });
    this.buildPanel();
    this.unsubscribe = data.onChanged(event => {
      this.listsDirty = true;
      const selectedAsset = data.assets.get(data.objects.get(this.selectedId)?.assetId);
      if ((event.kind === "asset" || event.kind === "resource") && selectedAsset && lodResourceIds(selectedAsset).has(event.id)) this.select(this.selectedId, true);
      else if (event.id === this.selectedId && event.kind === "object") {
        if (!event.after) this.select(null);
        else if (this.selectedRoot && !this.beforeDrag) { applyObjectTransform(this.selectedRoot, event.after); this.syncFields(); this.updateOutline(); }
      }
    });
  }
  buildPanel() {
    this.panel.innerHTML = `
      <h2 class="inspector-title">Objects</h2>
      <div class="material-actions"><button id="importGLB" type="button">Import GLB…</button><button id="removeGLB" type="button">Remove asset</button></div>
      <input id="glbFiles" type="file" accept=".glb,model/gltf-binary" multiple hidden>
      <label>Asset library<select id="objectAssets" size="5" aria-label="GLB asset library"></select></label>
      <div class="material-actions"><button id="placeObject" type="button">Place copies</button><button id="selectObject" type="button">Select objects</button></div>
      <div class="material-actions"><button id="paintObjects" type="button">Paint brush</button><button id="eraseObjects" type="button">Erase brush</button></div>
      <section id="objectBrushPanel" aria-label="Object brush settings" hidden>
        <label>Brush radius (m)<input id="objectBrushRadius" type="range" min="1" max="80" step="1" value="12"><output id="objectBrushRadiusValue">12 m</output></label>
        <label>Density (approx. objects / 100 m²)<input id="objectBrushDensity" type="number" min="0.1" max="50" step="0.1" value="4"></label>
        <label>Object scale<input id="objectBrushScale" type="number" min="0.01" max="1000" step="0.1" value="1"></label>
        <label class="object-check">Random scale<input id="objectBrushRandomScale" type="checkbox" checked></label>
        <div class="object-brush-range"><label>Min multiplier<input id="objectBrushMinScale" type="number" min="0.01" step="0.05" value="0.8"></label><label>Max multiplier<input id="objectBrushMaxScale" type="number" min="0.01" step="0.05" value="1.2"></label></div>
        <label class="object-check">Random Y rotation<input id="objectBrushRotation" type="checkbox" checked></label>
        <label class="object-check">Erase all assets<input id="objectBrushEraseAll" type="checkbox"></label>
        <p id="objectBrushProgress" role="status" hidden></p>
        <p>Left drag paints or erases. Hold Shift to erase while painting. Erase affects the selected asset unless “Erase all assets” is enabled. Each stroke is one undo step.</p>
      </section>
      <p id="objectAssetStatus" role="status"></p>
      <section id="objectLODPanel" aria-label="Object LOD"></section>
      <label>Placed objects<select id="placedObjects" aria-label="Placed objects"></select></label>
      <div class="material-actions"><button id="focusObject" type="button">Focus</button><button id="duplicateObject" type="button">Duplicate</button><button id="deleteObject" type="button">Delete</button></div>
      <div class="material-actions" aria-label="Object transform"><button data-object-mode="translate" type="button">Move</button><button data-object-mode="rotate" type="button">Rotate</button><button data-object-mode="scale" type="button">Scale</button></div>
      <fieldset id="objectTransform"><legend>Selected object</legend>
      ${["position", "rotation", "scale"].map(kind => `<label>${kind === "rotation" ? "Rotation (degrees)" : kind[0].toUpperCase() + kind.slice(1)}<span class="object-vector">${["X", "Y", "Z"].map((axis, i) => `<input type="number" step="${kind === "rotation" ? 1 : .1}" ${kind === "scale" ? 'min="0.001"' : ""} data-transform="${kind}" data-axis="${i}" aria-label="${kind} ${axis}" title="${axis}">`).join("")}</span></label>`).join("")}
      <label class="object-check">Follow terrain edits<input id="objectFollowTerrain" type="checkbox"></label>
      <label>Animation<select id="objectAnimation"></select></label>
      </fieldset>
      <label>Source grid snap (m; 0 = off)<input id="objectGrid" type="number" min="0" step="0.5" value="0"></label>
      <label>Rotation snap (degrees; 0 = off)<input id="objectRotationSnap" type="number" min="0" max="180" step="5" value="0"></label>
      <label>Placement height offset (m)<input id="objectHeightOffset" type="number" step="0.1" value="0"></label>
      <p>Select an asset, then click terrain to place copies. Select objects to edit. Ctrl+D duplicates; Delete removes; Escape selects. Positions use the model’s authored origin. Move detaches from terrain; vertical moves retain the terrain offset.</p>
      <p>Save embeds each unique GLB once. Imported textures and animations travel with the world.</p>`;
    this.$ = selector => this.panel.querySelector(selector);
    this.lodPanel = new ObjectLODPanel({ element: this.$("#objectLODPanel"), data: this.data, assets: this.assets, system: this.system,
      getAssetId: () => this.assetId, getSelectedId: () => this.selectedId, preview: level => this.setLODPreview(level), recordHistory: this.recordHistory, onStatus: this.onStatus });
    this.$("#importGLB").onclick = () => this.$("#glbFiles").click();
    this.$("#glbFiles").onchange = async event => {
      for (const file of event.target.files) {
        try {
          this.onStatus(`Importing ${file.name}…`);
          const beforeIds = new Set(this.data.assets.keys());
          const beforeResources = new Map(this.data.resources);
          const asset = await this.assets.importFile(file);
          if (!beforeIds.has(asset.id)) this.recordHistory({ kind: "objectAsset", entries: { id: asset.id, before: null, after: copyAsset(asset), resourceBefore: copyAsset(beforeResources.get(asset.id)) } });
          this.assetId = asset.id; this.setMode("place"); this.activate();
          this.onStatus(`${asset.name} ready — click terrain to place`);
        } catch (error) { this.onStatus(`Import failed: ${error.message}`); }
      }
      event.target.value = "";
    };
    this.$("#objectAssets").onchange = event => { const id = event.target.value; this.select(null); this.assetId = id; this.setMode("place"); this.activate(); };
    this.$("#removeGLB").onclick = () => {
      this.finishTransform();
      const before = copyAsset(this.data.assets.get(this.assetId)); if (!before) return;
      try { this.data.deleteAsset(this.assetId); this.recordHistory({ kind: "objectAsset", entries: { id: before.id, before, after: null } }); this.assetId = null; this.refreshLists(); }
      catch (error) { this.onStatus(error.message); }
    };
    this.$("#placeObject").onclick = () => this.setMode("place");
    this.$("#selectObject").onclick = () => this.setMode("select");
    this.$("#paintObjects").onclick = () => this.setMode("paintBrush");
    this.$("#eraseObjects").onclick = () => this.setMode("eraseBrush");
    this.$("#objectBrushRadius").oninput = event => { this.$("#objectBrushRadiusValue").textContent = `${event.target.value} m`; this.brushPickDirty = true; };
    this.$("#placedObjects").onchange = event => { const id = event.target.value; this.setMode("select"); this.select(id || null); };
    this.$("#focusObject").onclick = () => this.focus();
    this.$("#duplicateObject").onclick = () => this.duplicate();
    this.$("#deleteObject").onclick = () => this.remove();
    for (const button of this.panel.querySelectorAll("[data-object-mode]")) button.onclick = () => {
      this.setMode("select"); this.controls.setMode(button.dataset.objectMode); this.refreshLists();
    };
    for (const input of this.panel.querySelectorAll("[data-transform]")) input.onchange = () => this.editFields(input);
    const snap = () => {
      this.controls.setTranslationSnap(this.number("#objectGrid") || null);
      this.controls.setRotationSnap(THREE.MathUtils.degToRad(this.number("#objectRotationSnap")) || null);
    };
    this.$("#objectGrid").onchange = snap; this.$("#objectRotationSnap").onchange = snap;
    this.$("#objectFollowTerrain").onchange = event => {
      const before = this.data.objects.get(this.selectedId); if (!before) return;
      const after = copy(before);
      if (event.target.checked) {
        const hit = this.pickVertical?.(before.position[0], before.position[2], before.position[1] + 10000);
        if (!hit) { this.onStatus("No terrain beneath the object."); this.syncFields(); return; }
        after.anchor = { sourceX: hit.sourceX, sourceZ: hit.sourceZ, offset: before.position[1] - hit.point.y };
      } else delete after.anchor;
      this.commit(before, after);
    };
    this.$("#objectAnimation").onchange = async event => {
      const before = this.data.objects.get(this.selectedId); if (!before) return;
      const after = copy(before); after.properties.animation = event.target.value !== "__paused";
      after.properties.clip = event.target.value;
      this.commit(before, after); await this.select(after.id, true);
    };
    this.refreshLists(); this.syncFields();
  }
  number(selector) { const n = Number(this.$(selector).value); return Number.isFinite(n) ? n : 0; }
  isBrushMode() { return this.mode === "paintBrush" || this.mode === "eraseBrush"; }
  setMode(mode) {
    this.finishTransform(); this.mode = mode;
    if (mode === "place" || this.isBrushMode()) this.select(null);
    this.controls.enabled = this.active && !this.isBrushMode();
    if (!this.isBrushMode()) { this.brushPreview.visible = false; this.brushPointer = null; }
    this.refreshLists();
  }
  setActive(active) {
    this.finishTransform(); this.active = active; this.panel.hidden = !active;
    this.controls.enabled = active && !this.isBrushMode(); this.controls.getHelper().visible = active && !!this.selectedRoot;
    if (!active || !this.isBrushMode()) this.brushPreview.visible = false;
    this.outline.visible = active && !!this.selectedRoot;
    if (!active) { this.brushPreview.visible = false; this.brushPointer = null; this.select(null); }
  }
  refreshLists() {
    const list = this.$("#objectAssets"); list.replaceChildren();
    for (const asset of this.data.assets.values()) {
      const option = new Option(`${asset.name}${asset.lod ? " · LOD" : ""}${!this.canPlace(asset) ? " — missing; reimport to repair" : this.assets.errors.has(asset.id) ? " — load failed" : ""}`, asset.id);
      list.add(option);
    }
    list.value = this.assetId ?? "";
    const placed = this.$("#placedObjects"); placed.replaceChildren(new Option("Select an object…", ""));
    for (const record of this.data.objects.values()) placed.add(new Option(`${this.data.assets.get(record.assetId)?.name ?? "Missing asset"} · ${record.id.slice(-8)}`, record.id));
    placed.value = this.selectedId ?? "";
    this.$("#placeObject").disabled = !this.canPlace(this.data.assets.get(this.assetId));
    this.$("#paintObjects").disabled = !this.canPlace(this.data.assets.get(this.assetId));
    this.$("#paintObjects").setAttribute("aria-pressed", String(this.mode === "paintBrush"));
    this.$("#eraseObjects").setAttribute("aria-pressed", String(this.mode === "eraseBrush"));
    this.$("#objectBrushPanel").hidden = !this.isBrushMode();
    this.$("#placeObject").setAttribute("aria-pressed", String(this.mode === "place"));
    this.$("#selectObject").setAttribute("aria-pressed", String(this.mode === "select"));
    this.$("#objectAssetStatus").textContent = `${this.data.assets.size} assets · ${this.data.objects.size} objects${this.isBrushMode() ? this.mode === "paintBrush" ? " · drag to paint; Shift erases" : " · drag to erase" : this.mode === "place" ? " · click terrain to place" : " · click an object to select"}${this.assets.errors.size ? ` · ${this.assets.errors.size} missing/failed assets (pink boxes)` : ""}`;
    for (const button of this.panel.querySelectorAll("[data-object-mode]")) button.setAttribute("aria-pressed", String(button.dataset.objectMode === this.controls.mode));
    for (const selector of ["#deleteObject", "#duplicateObject", "#focusObject"]) this.$(selector).disabled = !this.selectedId;
  }
  async select(id, force = false) {
    this.finishTransform();
    if (id === this.selectedId && !force) return;
    const version = ++this.selectVersion;
    ++this.selectedLODVersion; this.sourceLease?.release(); this.sourceLease = null;
    this.selectedChoice = null; this.requestedLOD = null;
    if (!force) this.previewLOD = null;
    this.controls.detach(); this.outline.visible = false;
    if (this.selectedRoot) releaseObject(this.selectedRoot);
    this.selectedRoot = null; this.selectedId = id; this.system.setSelected(id); this.refreshLists(); this.syncFields();
    const record = this.data.objects.get(id); if (!record) return;
    this.assetId = record.assetId; this.refreshLists();
    await this.loadSelectedLOD(this.selectedLODChoice(), version);
  }
  canPlace(asset) { return !!asset && (enabledLODLevels(asset).some(level => !!this.data.getResource(level.resourceId)?.data) || !!asset.data); }
  selectedLODChoice() {
    const record = this.data.objects.get(this.selectedId); if (!record) return 0;
    if (this.previewLOD != null) return this.previewLOD;
    const asset = this.data.assets.get(record.assetId), c = this.camera.position, p = record.position;
    const level = chooseLOD(asset, Math.hypot(c.x - p[0], c.y - p[1], c.z - p[2]), this.selectedChoice);
    // A selected object remains available to edit beyond its visibility limit.
    return level < 0 ? enabledLODLevels(asset).at(-1)?.level ?? 0 : level;
  }
  async loadSelectedLOD(choice, selectionVersion = this.selectVersion) {
    const record = this.data.objects.get(this.selectedId); if (!record) return;
    const request = ++this.selectedLODVersion; this.requestedLOD = choice; this.selectedChoice = choice;
    const lease = await this.assets.acquireLOD(record.assetId, choice, { preview: this.previewLOD != null });
    if (request !== this.selectedLODVersion || selectionVersion !== this.selectVersion || !this.active || !this.data.objects.has(record.id)) { lease.release(); return; }
    if (this.beforeDrag) { lease.release(); this.requestedLOD = null; return; }
    const oldRoot = this.selectedRoot, oldLease = this.sourceLease;
    if (oldRoot && oldLease?.resourceId === lease.resourceId && oldRoot.userData.lodLevel === lease.level) { lease.release(); return; }
    const current = this.data.objects.get(record.id), oldClip = oldRoot?.userData.animationClip;
    const effective = oldClip && !current.properties.clip ? { ...current, properties: { ...current.properties, clip: oldClip.name } } : current;
    this.selectedRoot = this.system.createLive(effective, lease.source, lease.level); this.sourceLease = lease;
    if (oldRoot?.userData.mixer && this.selectedRoot.userData.mixer && oldClip?.duration > 0) this.selectedRoot.userData.mixer.setTime((oldRoot.userData.mixer.time % oldClip.duration) / oldClip.duration * this.selectedRoot.userData.animationClip.duration);
    this.scene.add(this.selectedRoot); this.controls.attach(this.selectedRoot); this.controls.enabled = this.active;
    if (oldRoot) releaseObject(oldRoot); oldLease?.release();
    const clips = this.$("#objectAnimation"); clips.replaceChildren(new Option("Paused / bind pose", "__paused"));
    for (const clip of lease.source?.animations ?? []) clips.add(new Option(clip.name || "Animation", clip.name));
    this.syncFields(); this.updateOutline();
  }
  setLODPreview(level) {
    this.finishTransform(); this.previewLOD = level;
    return this.loadSelectedLOD(this.selectedLODChoice());
  }
  syncFields() {
    const record = this.data.objects.get(this.selectedId), root = this.selectedRoot;
    this.$("#objectTransform").disabled = !record;
    for (const input of this.panel.querySelectorAll("[data-transform]")) {
      const kind = input.dataset.transform, i = Number(input.dataset.axis);
      let value = root ? root[kind].toArray()[i] : record?.[kind]?.[i] ?? (kind === "scale" ? 1 : 0);
      if (kind === "rotation") value = THREE.MathUtils.radToDeg(value);
      if (document.activeElement !== input) input.value = Number(value.toFixed(4));
    }
    this.$("#objectFollowTerrain").checked = !!record?.anchor;
    this.$("#objectAnimation").value = record?.properties.animation === false ? "__paused" : record?.properties.clip ?? this.$("#objectAnimation").options[1]?.value ?? "__paused";
  }
  updateOutline() { if (this.selectedRoot) { this.outline.setFromObject(this.selectedRoot); this.outline.visible = this.active; } }
  commit(before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.data.setObject(after); this.recordHistory({ kind: "object", entries: { id: after.id, before: copy(before), after: copy(after) } });
  }
  adjustAnchor(before, after) {
    if (!before.anchor) return;
    if (Math.abs(before.position[0] - after.position[0]) > 1e-5 || Math.abs(before.position[2] - after.position[2]) > 1e-5) delete after.anchor;
    else after.anchor.offset += after.position[1] - before.position[1];
  }
  finishTransform(endDrag = true) {
    if (this.objectBrush?.stroke) this.finishBrush();
    if (!this.beforeDrag || !this.selectedRoot) return;
    const before = this.beforeDrag; this.beforeDrag = null;
    if (endDrag && this.controls.dragging) this.controls.pointerUp({ button: 0 });
    const after = copy(before);
    after.position = this.selectedRoot.position.toArray(); after.rotation = this.selectedRoot.rotation.toArray().slice(0, 3);
    after.scale = this.selectedRoot.scale.toArray().map(n => Math.max(.001, n));
    this.adjustAnchor(before, after); this.commit(before, after); applyObjectTransform(this.selectedRoot, after); this.syncFields();
  }
  editFields(input) {
    this.finishTransform(); const before = this.data.objects.get(this.selectedId); if (!before) return;
    const after = copy(before);
    const value = Number(input.value); if (!Number.isFinite(value)) { this.syncFields(); return; }
    const kind = input.dataset.transform;
    after[kind][Number(input.dataset.axis)] = kind === "rotation" ? THREE.MathUtils.degToRad(value) : kind === "scale" ? Math.max(.001, value) : value;
    this.adjustAnchor(before, after); this.commit(before, after);
  }
  setRay(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.camera.updateMatrixWorld(); this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  pointerDown(event) {
    if (!this.active || event.button !== 0) return;
    if (this.isBrushMode()) { this.beginBrush(event); return; }
    this.pointerStart = { x: event.clientX, y: event.clientY, gizmo: !!this.controls.axis || this.controls.dragging };
    event.preventDefault();
  }
  pointerUp(event, pickSurface) {
    if (this.isBrushMode()) {
      if (this.brushPointerId === null || (event.pointerId != null && event.pointerId !== this.brushPointerId) || (event.type === "pointerup" && event.button !== 0)) return;
      const id = this.brushPointerId; this.brushPointerId = null;
      if (event.type === "pointerup") { this.queueBrushPointer(event); this.brushFinalPoint = true; }
      this.objectBrush.end();
      if (event.type === "pointercancel") { this.brushPointer = null; this.brushPreview.visible = false; }
      if (this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
      return;
    }
    const start = this.pointerStart; this.pointerStart = null;
    if (event.type !== "pointerup") { this.finishTransform(); return; }
    if (!this.active || !start || event.button !== 0 || event.type !== "pointerup" || start.gizmo || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    this.setRay(event);
    let hit = this.system.pick(this.raycaster);
    if (this.selectedRoot) {
      const selectedHit = this.raycaster.intersectObject(this.selectedRoot, true).find(h => objectHitVisible(h.object));
      if (selectedHit && (!hit || selectedHit.distance < hit.distance)) hit = { id: this.selectedId, distance: selectedHit.distance };
    }
    const surface = pickSurface(event);
    const terrainDistance = surface ? this.raycaster.ray.origin.distanceTo(surface.point) : Infinity;
    if (hit && hit.distance <= terrainDistance + .1) { this.mode = "select"; this.select(hit.id); this.refreshLists(); return; }
    if (this.mode !== "place" || !this.assetId || !surface || !this.canPlace(this.data.assets.get(this.assetId))) { this.select(null); return; }
    let { sourceX, sourceZ } = surface;
    const grid = Math.max(0, this.number("#objectGrid"));
    if (grid) { sourceX = Math.round(sourceX / grid) * grid; sourceZ = Math.round(sourceZ / grid) * grid; }
    const offset = this.number("#objectHeightOffset"), position = sampleObjectSurface(this.provider, sourceX, sourceZ); position[1] += offset;
    const record = { id: objectId(), assetId: this.assetId, position, rotation: [0, 0, 0], scale: [1, 1, 1], properties: {}, anchor: { sourceX, sourceZ, offset } };
    this.data.setObject(record); this.recordHistory({ kind: "object", entries: { id: record.id, before: null, after: copy(record) } });
    this.onStatus(`Placed ${this.data.assets.get(this.assetId).name} — click to place another`);
  }
  duplicate() {
    this.finishTransform(); const source = this.data.objects.get(this.selectedId); if (!source) return;
    const after = copy(source); after.id = objectId(); after.position[0] += Math.max(1, this.number("#objectGrid")); delete after.anchor;
    this.data.setObject(after); this.recordHistory({ kind: "object", entries: { id: after.id, before: null, after: copy(after) } }); this.select(after.id);
  }
  remove() {
    this.finishTransform(); const before = copy(this.data.objects.get(this.selectedId)); if (!before) return;
    this.data.deleteObject(before.id); this.recordHistory({ kind: "object", entries: { id: before.id, before, after: null } });
  }
  applyHistory(entries, property, kind) {
    const value = entries[property];
    if (kind === "objectBrush") applyBrushHistory(this.data, entries, property);
    else if (kind === "objectLOD") applyLODHistory(this.data, entries, property);
    else if (kind === "objectAsset") {
      if (value) this.data.setAsset(value);
      else if (entries.resourceBefore) this.data.demoteAsset(entries.id, entries.resourceBefore);
      else this.data.deleteAsset(entries.id);
    }
    else { if (value) this.data.setObject(value); else this.data.deleteObject(entries.id); }
    this.syncFields();
  }
  focus() {
    const record = this.data.objects.get(this.selectedId); if (!record) return;
    const asset = this.data.assets.get(record.assetId), extent = asset?.bounds ? new THREE.Vector3().fromArray(asset.bounds.max).sub(new THREE.Vector3().fromArray(asset.bounds.min)).length() * Math.max(...record.scale) : 10;
    const distance = Math.max(10, extent * 1.8);
    this.camera.position.fromArray(record.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), -distance);
  }
  keyDown(event) {
    if (!this.active) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); this.duplicate(); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); this.remove(); }
    else if (event.key === "Escape") { this.setMode("select"); this.select(null); }
  }
  brushSettings() {
    return { ...DEFAULT_OBJECT_BRUSH, radius: this.number("#objectBrushRadius"), density: this.number("#objectBrushDensity"), scale: this.number("#objectBrushScale"),
      randomScale: this.$("#objectBrushRandomScale").checked, minScale: this.number("#objectBrushMinScale"), maxScale: this.number("#objectBrushMaxScale"),
      randomRotation: this.$("#objectBrushRotation").checked, eraseAll: this.$("#objectBrushEraseAll").checked,
      rotationSnap: THREE.MathUtils.degToRad(this.number("#objectRotationSnap")), heightOffset: this.number("#objectHeightOffset") };
  }
  queueBrushPointer(event) {
    this.brushPointer = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, buttons: event.buttons ?? 0 }; this.brushPickDirty = true;
  }
  pointerMove(event) { if (this.active && this.isBrushMode()) this.queueBrushPointer(event); }
  pointerLeave() { if (this.brushPointerId === null) { this.brushPointer = null; this.brushPreview.visible = false; } }
  beginBrush(event) {
    this.finishBrush(); this.queueBrushPointer(event); this.updateBrushPointer();
    if (!this.brushHit) return;
    try {
      const erase = this.mode === "eraseBrush" || event.shiftKey;
      if (!erase && !this.canPlace(this.data.assets.get(this.assetId))) throw new Error("Select an imported asset to paint.");
      this.objectBrush.begin(this.assetId, this.brushSettings(), this.mode === "eraseBrush" ? "erase" : "paint");
      this.objectBrush.queue(this.brushHit, erase); this.brushPointerId = event.pointerId;
      this.canvas.setPointerCapture?.(event.pointerId); event.preventDefault();
    } catch (error) { this.onStatus(error.message); }
  }
  updateBrushPointer() {
    if (!this.brushPickDirty || !this.brushPointer || !this.active || !this.isBrushMode()) return;
    this.brushPickDirty = false;
    const pointer = this.brushPointer, rect = this.canvas.getBoundingClientRect();
    const over = document.elementFromPoint(pointer.clientX, pointer.clientY);
    const valid = !(pointer.buttons & 6) && pointer.clientX >= rect.left && pointer.clientX <= rect.right && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom && (!over || over === this.canvas);
    this.setRay(pointer); this.brushCameraPosition.copy(this.camera.position); this.brushCameraRotation.copy(this.camera.quaternion);
    this.brushHit = valid ? this.pickSurface?.(pointer) : null; this.brushPreview.visible = !!this.brushHit;
    if (this.brushHit) {
      this.brushPreview.position.copy(this.brushHit.point); this.brushPreview.scale.setScalar(this.objectBrush.stroke?.settings.radius ?? this.number("#objectBrushRadius"));
      this.brushMaterial.color.set(this.mode === "eraseBrush" || pointer.shiftKey ? 0xff9999 : 0x8ce5ff);
    }
    if (this.objectBrush.stroke && (this.brushPointerId !== null || this.brushFinalPoint)) this.objectBrush.queue(this.brushHit, this.mode === "eraseBrush" || pointer.shiftKey, this.brushFinalPoint);
    this.brushFinalPoint = false;
  }
  finishBrush() {
    if (!this.objectBrush) return;
    this.updateBrushPointer(); this.objectBrush.finish(); this.brushFinalPoint = false;
    const id = this.brushPointerId; this.brushPointerId = null;
    if (id != null && this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
  }
  update(delta) {
    if (this.active && this.isBrushMode()) {
      if (this.brushPointer && (this.brushCameraPosition.distanceToSquared(this.camera.position) > 1e-6 || this.brushCameraRotation.angleTo(this.camera.quaternion) > 1e-6)) this.brushPickDirty = true;
      this.updateBrushPointer(); this.objectBrush.work();
      const stroke = this.objectBrush.stroke, progress = this.$("#objectBrushProgress"); progress.hidden = !stroke;
      if (stroke) {
        const text = `${stroke.released ? "Finishing stroke" : "Stroke"}: ${stroke.changes.size} object changes`;
        if (progress.textContent !== text) progress.textContent = text;
      }
    }
    const now = this.system.now();
    if (this.listsDirty && (!this.objectBrush.stroke || now >= this.nextListRefresh)) { this.listsDirty = false; this.nextListRefresh = now + 250; this.refreshLists(); }
    if (this.active) this.lodPanel.update(this.selectedRoot?.userData.lodLevel, this.previewLOD);
    if (!this.active || !this.selectedRoot) return;
    const time = this.system.now();
    if (!this.beforeDrag && time >= this.nextLODCheck) {
      this.nextLODCheck = time + 100; const choice = this.selectedLODChoice();
      if (choice !== this.requestedLOD) this.loadSelectedLOD(choice);
    }
    const root = this.selectedRoot;
    if (root.userData.mixer) { root.userData.mixer.update(delta); this.updateOutline(); }
  }
  dispose() {
    this.finishBrush(); this.brushPreview.removeFromParent(); this.brushGeometry.dispose(); this.brushMaterial.dispose();
    this.lodPanel.dispose();
    this.select(null); this.unsubscribe(); this.controls.getHelper().removeFromParent(); this.controls.dispose();
    this.outline.removeFromParent(); this.outline.geometry.dispose(); this.outline.material.dispose();
  }
}
