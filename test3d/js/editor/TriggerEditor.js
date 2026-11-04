import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ArenaPanel } from './ArenaPanel.js';
import { TitleRevealPanel } from './TitleRevealPanel.js';
import { TITLE_CHECKPOINT, mountainTitleDestination } from '../game/MountainTitleConfig.js';

const colorFor = record => record.type === 'Arena' ? 0xc793ff : record.type === "Checkpoint" ? 0x65ed9a : 0xff716b;

export class TriggerEditor {
  constructor({ scene, camera, canvas, panel, data, pickSurface, recordHistory, onStatus }) {
    Object.assign(this, { scene, camera, canvas, panel, data, pickSurface, recordHistory, onStatus });
    this.active = false; this.selectedId = null; this.placing = null; this.beforeDrag = null;
    this.roots = new Map(); this.markers = new Map(); this.titleMarkers = new Map();
    this.group = new THREE.Group(); this.group.name = "Editor trigger volumes"; scene.add(this.group);
    this.geometry = new THREE.BoxGeometry(1, 1, 1); this.edges = new THREE.EdgesGeometry(this.geometry);
    this.sphereGeometry = new THREE.SphereGeometry(.5, 20, 12); this.sphereEdges = new THREE.WireframeGeometry(this.sphereGeometry);
    this.controls = new TransformControls(camera, canvas); this.controls.enabled = false; this.controls.setSpace("world");
    scene.add(this.controls.getHelper());
    this.controls.addEventListener("mouseDown", () => { this.beforeDrag = structuredClone(data.volumes.get(this.selectedId)); });
    this.controls.addEventListener("objectChange", () => {
      const record = this.dragRecord(); this.syncFields(record);
      if (record?.respawn) this.markers.get(record.id)?.position.fromArray(record.respawn.position).add(new THREE.Vector3(0, .15, 0));
    });
    this.controls.addEventListener("mouseUp", () => this.finishTransform(false));
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.buildPanel();
    this.unsubscribe = data.onChanged(() => this.refresh());
    this.refresh();
  }
  buildPanel() {
    const vector = (field, title, min = "") => `<label>${title}<span class="trigger-vector">${["X", "Y", "Z"].map((axis, i) => `<input type="number" step="0.1" ${min} data-vector="${field}" data-axis="${i}" aria-label="${title} ${axis}">`).join("")}</span></label>`;
    this.panel.innerHTML = `<h2 class="inspector-title">Triggers</h2>
      <div class="material-actions"><button type="button" data-place-trigger="Checkpoint">Place Checkpoint</button><button type="button" data-place-trigger="KillZone">Place KillZone</button><button type="button" data-place-trigger="Arena">Place Arena sphere</button><button type="button" data-trigger-select>Select</button></div>
      <label>Volumes<select data-trigger-list aria-label="Trigger volumes"></select></label>
      <div class="material-actions"><button type="button" data-trigger-focus>Focus</button><button type="button" data-trigger-duplicate>Duplicate</button><button type="button" data-trigger-delete>Delete</button></div>
      <div class="material-actions"><button type="button" data-trigger-mode="translate">Move</button><button type="button" data-trigger-mode="scale">Resize</button></div>
      <fieldset data-trigger-fields><legend>Selected volume</legend>
      <label>ID<input data-trigger-id readonly aria-label="Trigger ID"></label>
      <label>Name<input data-trigger-field="name" maxlength="80"></label>
      <label>Type<select data-trigger-field="type"><option>Checkpoint</option><option>KillZone</option><option>Arena</option></select></label>
      <label class="trigger-check">Enabled<input type="checkbox" data-trigger-field="enabled"></label>
      <label class="trigger-check">Once per session<input type="checkbox" data-trigger-field="once"></label>
      ${vector("position", "Center (m)")}<div data-trigger-box-size>${vector("size", "Box size (m)", 'min="0.01"')}</div>
      <section data-arena-fields></section>
      <section data-title-reveal-fields></section>
      <section data-checkpoint-fields>${vector("respawn", "Respawn feet (m)")}
      <label>Respawn heading (degrees)<input type="number" step="1" data-trigger-yaw></label></section>
      </fieldset>
      <p>Green: Checkpoint. Red: KillZone. Purple: Arena sphere. Click terrain or Rockify to place, then move or resize. Arena spheres only detect entry; they never create a solid dome. Use the list to select overlapping volumes.</p>
      <p>The green arrow marks the checkpoint's respawn position and heading. Set its feet on safe ground. Moving a box moves its respawn point; resizing keeps the point fixed.</p>
      <p>Place a wide KillZone below a ravine. Volumes are invisible during gameplay and never block movement. Only entering a checkpoint activates it. Once limits activation to one entry per session; exit is still reported.</p>`;
    this.$ = selector => this.panel.querySelector(selector);
    this.arenaPanel = new ArenaPanel(this, this.$('[data-arena-fields]'));
    this.titleRevealPanel = new TitleRevealPanel(this, this.$('[data-title-reveal-fields]'));
    for (const button of this.panel.querySelectorAll("[data-place-trigger]")) button.onclick = () => {
      this.finishTransform(); this.placing = button.dataset.placeTrigger; this.select(null);
      this.onStatus(`Click terrain or Rockify to place ${this.placing}`);
    };
    this.$("[data-trigger-select]").onclick = () => { this.placing = null; this.onStatus("Click a trigger box to select it"); };
    this.$("[data-trigger-list]").onchange = event => { this.placing = null; this.select(event.target.value || null); };
    this.$("[data-trigger-focus]").onclick = () => {
      const record = this.data.volumes.get(this.selectedId); if (!record) return;
      this.camera.position.fromArray(record.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), -Math.max(10, Math.hypot(...record.size) * 1.5));
    };
    this.$("[data-trigger-duplicate]").onclick = () => this.duplicate();
    this.$("[data-trigger-delete]").onclick = () => this.remove();
    for (const button of this.panel.querySelectorAll("[data-trigger-mode]")) button.onclick = () => {
      this.finishTransform(); this.controls.setMode(button.dataset.triggerMode);
    };
    this.$("[data-trigger-fields]").onchange = event => this.editField(event.target);
  }
  setActive(active) {
    this.finishTransform(); this.active = active; this.panel.hidden = !active; this.placing = null;
    this.controls.enabled = active;
    if (active && this.roots.has(this.selectedId)) this.controls.attach(this.roots.get(this.selectedId));
    else this.controls.detach();
  }
  refresh() {
    for (const [id, root] of this.roots) if (!this.data.volumes.has(id)) {
      if (this.controls.object === root) this.controls.detach();
      root.material.dispose(); root.children[0].material.dispose(); root.removeFromParent(); this.roots.delete(id);
    }
    for (const marker of [...this.markers.values(), ...this.titleMarkers.values()]) {
      marker.line.geometry.dispose(); marker.line.material.dispose(); marker.cone.geometry.dispose(); marker.cone.material.dispose(); marker.removeFromParent();
    }
    this.markers.clear(); this.titleMarkers.clear();
    for (const record of this.data.volumes.values()) {
      let root = this.roots.get(record.id);
      if (!root) {
        root = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        root.userData.triggerId = record.id;
        root.add(new THREE.LineSegments(this.edges, new THREE.LineBasicMaterial()));
        this.roots.set(record.id, root); this.group.add(root);
      }
      root.position.fromArray(record.position); root.scale.fromArray(record.size);
      root.geometry = record.type === 'Arena' ? this.sphereGeometry : this.geometry;
      root.children[0].geometry = record.type === 'Arena' ? this.sphereEdges : this.edges;
      root.material.color.setHex(colorFor(record)); root.children[0].material.color.setHex(record.enabled ? colorFor(record) : 0x888888);
      root.material.opacity = record.enabled ? (record.id === this.selectedId ? .25 : .10) : .04;
      if (record.respawn) {
        const marker = new THREE.ArrowHelper(new THREE.Vector3(-Math.sin(record.respawn.yaw), 0, -Math.cos(record.respawn.yaw)),
          new THREE.Vector3().fromArray(record.respawn.position).add(new THREE.Vector3(0, .15, 0)), 2, 0x65ed9a, .5, .35);
        // ArrowHelper otherwise shares geometry with every other helper.
        marker.line.geometry = marker.line.geometry.clone(); marker.cone.geometry = marker.cone.geometry.clone();
        this.group.add(marker); this.markers.set(record.id, marker);
        if (record.id === TITLE_CHECKPOINT || record.titleReveal?.destination) {
          const end = new THREE.Vector3().fromArray(mountainTitleDestination(record, this.data.volumes)), start = new THREE.Vector3().fromArray(record.respawn.position);
          const direction = end.sub(start), length = direction.length();
          const arrow = new THREE.ArrowHelper(length > 0 ? direction.normalize() : new THREE.Vector3(0, 0, -1), start.add(new THREE.Vector3(0, .2, 0)), Math.max(.1, length), 0xffdc7b, .7, .4);
          arrow.line.geometry = arrow.line.geometry.clone(); arrow.cone.geometry = arrow.cone.geometry.clone();
          this.group.add(arrow); this.titleMarkers.set(record.id, arrow);
        }
      }
    }
    if (!this.data.volumes.has(this.selectedId)) this.selectedId = null;
    const list = this.$("[data-trigger-list]"); list.replaceChildren(new Option("Select a volume", ""));
    for (const record of this.data.volumes.values()) list.add(new Option(`${record.name} (${record.type})`, record.id));
    list.value = this.selectedId ?? "";
    this.$("[data-trigger-fields]").disabled = !this.selectedId;
    this.syncFields(this.data.volumes.get(this.selectedId));
  }
  select(id) {
    this.finishTransform(); this.selectedId = this.data.volumes.has(id) ? id : null;
    this.controls.detach();
    if (this.active && this.selectedId) this.controls.attach(this.roots.get(this.selectedId));
    this.refresh();
  }
  syncFields(record) {
    this.titleRevealPanel.refresh(record);
    this.arenaPanel.refresh(record);
    this.$('[data-trigger-box-size]').hidden = record?.type === 'Arena';
    this.$('[data-trigger-field="once"]').closest('label').hidden = record?.type === 'Arena';
    this.$("[data-trigger-id]").value = record?.id ?? "";
    for (const input of this.panel.querySelectorAll("[data-trigger-field]")) {
      const value = record?.[input.dataset.triggerField];
      if (input.type === "checkbox") input.checked = !!value; else input.value = value ?? "";
    }
    for (const input of this.panel.querySelectorAll("[data-vector]")) {
      const values = input.dataset.vector === "respawn" ? record?.respawn?.position : record?.[input.dataset.vector];
      input.value = values ? Number(values[Number(input.dataset.axis)].toFixed(4)) : "";
    }
    this.$("[data-checkpoint-fields]").hidden = record?.type !== "Checkpoint";
    this.$("[data-trigger-yaw]").value = record?.respawn ? THREE.MathUtils.radToDeg(record.respawn.yaw) : "";
  }
  commit(before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) { this.refresh(); return; }
    try {
      const saved = after ? this.data.set(after) : (this.data.delete(before.id), null);
      this.recordHistory({ kind: "trigger", entries: { id: (after ?? before).id, before: structuredClone(before), after: structuredClone(saved) } });
    } catch (error) { this.onStatus(error.message); this.refresh(); }
  }
  moveRespawn(before, after) {
    if (after.respawn) after.respawn.position = before.respawn.position.map((n, i) => n + after.position[i] - before.position[i]);
  }
  dragRecord() {
    const before = this.beforeDrag, root = this.roots.get(this.selectedId);
    if (!before || !root) return this.data.volumes.get(this.selectedId);
    const after = structuredClone(before); after.position = root.position.toArray(); after.size = root.scale.toArray().map(n => Math.max(.01, n));
    if (after.type === 'Arena') after.radius = Math.max(...after.size) / 2;
    this.moveRespawn(before, after); return after;
  }
  finishTransform(endDrag = true) {
    if (!this.beforeDrag) return;
    const before = this.beforeDrag, after = this.dragRecord(); this.beforeDrag = null;
    if (endDrag && this.controls.dragging) this.controls.pointerUp({ button: 0 });
    this.commit(before, after);
  }
  editField(input) {
    this.finishTransform(); const before = this.data.volumes.get(this.selectedId); if (!before) return;
    const after = structuredClone(before);
    if (input.dataset.triggerField) {
      after[input.dataset.triggerField] = input.type === "checkbox" ? input.checked : input.value;
      if (after.type !== "Checkpoint") delete after.respawn;
    } else {
      const value = input.value.trim() ? Number(input.value) : NaN;
      if (!Number.isFinite(value)) { this.syncFields(before); return; }
      if (input.hasAttribute("data-trigger-yaw")) after.respawn.yaw = THREE.MathUtils.degToRad(value);
      else if (input.dataset.vector === "respawn") after.respawn.position[Number(input.dataset.axis)] = value;
      else if (input.dataset.vector) {
        after[input.dataset.vector][Number(input.dataset.axis)] = value;
        if (input.dataset.vector === "position") this.moveRespawn(before, after);
      } else return;
    }
    this.commit(before, after);
  }
  pointerDown(event) {
    this.pointerStart = { x: event.clientX, y: event.clientY, gizmo: !!this.controls.axis || this.controls.dragging };
    event.preventDefault();
  }
  pointerUp(event) {
    const start = this.pointerStart; this.pointerStart = null;
    if (event.type !== "pointerup") { this.finishTransform(); return; }
    if (!start || start.gizmo || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.camera.updateMatrixWorld(); this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.placing) {
      const hit = this.pickSurface(this.raycaster.ray); if (!hit) { this.onStatus("No terrain surface here; place nearby, then edit the coordinates"); return; }
      const type = this.placing, id = globalThis.crypto.randomUUID(), p = hit.point;
      this.commit(null, { id, type, name: type, position: [p.x, p.y + 1.5, p.z], size: [4, 3, 4], ...(type === 'Arena' ? { radius: 20 } : {}) });
      this.placing = null; this.select(id); this.onStatus(`${type} placed`);
    } else {
      this.group.updateMatrixWorld(true);
      this.select(this.raycaster.intersectObjects([...this.roots.values()], false)[0]?.object.userData.triggerId ?? null);
    }
  }
  duplicate() {
    this.finishTransform(); const before = this.data.volumes.get(this.selectedId); if (!before) return;
    const after = structuredClone(before); after.id = globalThis.crypto.randomUUID(); after.name += " copy";
    if (after.type === 'Arena') { after.arenaId = after.id; after.enemyIds = []; after.barrierIds = []; after.completed = false; }
    after.position[0] += 2; if (after.respawn) after.respawn.position[0] += 2;
    this.commit(null, after); this.select(after.id);
  }
  remove() { this.finishTransform(); const before = this.data.volumes.get(this.selectedId); if (before) this.commit(before, null); }
  keyDown(event) {
    if (!this.active) return;
    if (event.key === "Escape") { this.placing = null; this.select(null); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); this.remove(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); this.duplicate(); }
  }
  applyHistory(entries, property) {
    if (entries[property]) this.data.set(entries[property]); else this.data.delete(entries.id);
    this.select(entries[property] ? entries.id : null);
  }
  dispose() {
    this.unsubscribe(); this.controls.getHelper().removeFromParent(); this.controls.dispose();
    for (const root of this.roots.values()) { root.material.dispose(); root.children[0].material.dispose(); }
    for (const marker of this.markers.values()) marker.dispose();
    for (const marker of this.titleMarkers.values()) marker.dispose();
    this.geometry.dispose(); this.edges.dispose(); this.sphereGeometry.dispose(); this.sphereEdges.dispose(); this.group.removeFromParent();
  }
}
