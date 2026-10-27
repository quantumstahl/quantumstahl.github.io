import * as THREE from "three";
import { DEFAULT_WATER_STYLE,DEFAULT_WATERFALL,DEFAULT_WATERFALL_STYLE,normalizeWaterBody } from "../water/WaterData.js";
import { sampleRiver } from "../water/WaterSystem.js";
import { RiverbedCarver } from "./RiverbedCarver.js";
import {WaterBedManager} from "./WaterBedManager.js";
import {lakeBoundary} from "../water/LakeBoundary.js";

// Surface placement reads visible/canonical surface hits in WORLD space.
// Carving remains an independent explicit, source-grid operation.
export class WaterEditor {
  constructor({ scene, camera, canvas, data, water, panel, recordHistory, onStatus, sculptor,bedData,pickSurface }) {
    Object.assign(this, { camera, canvas, data, water, panel, recordHistory, onStatus,pickSurface });
    this.active = false; this.selectedId = null; this.pointIndex = -1;
    this.draft = null; this.drag = null; this.pendingMove = null;
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3(); this.projected = new THREE.Vector3();
    this.overlay = new THREE.Group(); this.overlay.renderOrder = 10; scene.add(this.overlay);
    this.lineMaterial = new THREE.LineBasicMaterial({ color: 0xaff4ff, depthTest: false, transparent: true, opacity: .9 });
    this.pointMaterial = new THREE.PointsMaterial({ color: 0xffe69b, size: 12, sizeAttenuation: false, depthTest: false });
    const query = id => panel.querySelector(`#${id}`);
    this.carver = new RiverbedCarver(sculptor);
    this.beds=new WaterBedManager(sculptor,bedData,this.carver);
    this.carvePreview = new THREE.Group(); scene.add(this.carvePreview);
    this.carvePreviewMaterial = new THREE.PointsMaterial({color:0xffce78,size:3,sizeAttenuation:false,transparent:true,opacity:.65,depthTest:false});
    query("previewRiverbed").onclick = () => this.carveRiverbed(true);
    query("carveRiverbed").onclick = () => this.carveRiverbed(false);
    this.unsubscribeTerrain = sculptor.provider.onTileChanged(() => this.clearCarvePreview());
    for (const id of ["riverbedDepth","riverbedBankWidth","riverbedAllowRockify"]) query(id).addEventListener("input",() => { this.clearCarvePreview(); query("riverbedStatus").textContent="Settings changed. Preview or Carve waterbed to replace the previous bed."; });
    this.list = query("waterBodies");
    this.controls = Object.fromEntries(["waterName", "waterElevation", "waterColor", "waterOpacity", "waterWaves", "waterFlow", "waterFoam", "waterDepth", "waterPointX", "waterPointZ", "waterPointY", "waterPointWidth","lakeRoundness"].map(id => [id, query(id)]));
    query("newLake").onclick = () => this.startBody("lake");
    query("newRoundLake").onclick = () => this.startBody("roundLake");
    query("newRiver").onclick = () => this.startBody("river");
    query("newWaterfall").onclick=()=>this.startBody("waterfall");
    query("waterfallPointSelect").onchange=event=>{const index=Number(event.target.value);this.finishDrag();this.pointIndex=index;this.refresh();};
    this.fallControls=Object.fromEntries(["Width","Curvature","Heading","Turbulence","Mist","Spray","Overlap"].map(key=>[key.toLowerCase(),query(`waterfall${key}`)]));
    for(const [key,input] of Object.entries(this.fallControls))input.addEventListener("change",()=>{
      const body=this.selected;if(body?.type==="waterfall")this.edit({...body,fall:{...body.fall,[key]:Number(input.value)}});
    });
    query("finishWater").onclick = () => this.finishDraft();
    query("cancelWater").onclick = () => { this.draft = null; this.refresh(); };
    query("deleteWater").onclick = () => this.edit(null);
    query("insertWaterPoint").onclick = () => this.insertPoint();
    query("removeWaterPoint").onclick = () => this.removePoint();
    query("reverseWaterFlow").onclick = () => { if (this.selected?.type === "river") this.edit({ ...this.selected, flowDirection: -this.selected.flowDirection }); };
    this.list.onchange = () => { this.finishDrag(); this.draft = null; this.selectedId = this.list.value || null; this.pointIndex = -1; this.refresh(); };
    for (const [id, input] of Object.entries(this.controls)) input.addEventListener("change", () => this.changeProperties(id));
    this.unsubscribe = data.onChanged(() => { this.clearCarvePreview(); this.refresh(); });
    this.unsubscribeBeds=bedData.onChanged(()=>{this.settingsBodyId=null;this.refresh();});
    this.refresh();
  }
  get selected() { return this.data.get(this.selectedId); }
  clearCarvePreview() {
    for (const child of [...this.carvePreview.children]) { child.geometry.dispose(); this.carvePreview.remove(child); }
  }
  carveRiverbed(preview) {
    this.finishDrag(); this.clearCarvePreview();
    const body = this.selected; if (!body || this.draft || body.type==="waterfall") return;
    try {
      const options={depth:Number(this.panel.querySelector("#riverbedDepth").value),bankWidth:Number(this.panel.querySelector("#riverbedBankWidth").value),allowRockify:this.panel.querySelector("#riverbedAllowRockify").checked};
      const plan=this.beds.plan(body.id,options,sampleHeight=>body.type==="river"?this.carver.plan(sampleRiver(body),{...options,sampleHeight}):this.carver.planLake(body,{...options,sampleHeight}));
      let stats = plan.stats;
      if (preview) {
        const positions = [], stride = Math.max(1,Math.ceil(plan.heights.length/6000));
        for (let i=0;i<plan.heights.length;i+=stride) {const p=plan.heights[i],warp=this.beds.provider.sampleWarp(p.x,p.z);positions.push(p.x+warp.x,p.after+.1,p.z+warp.z);}
        const geometry = new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
        const points = new THREE.Points(geometry,this.carvePreviewMaterial);points.renderOrder=9;this.carvePreview.add(points);
      } else {
        stats=this.beds.apply(plan);
        if(this.beds.hasChanges(plan))this.recordHistory({kind:"waterbed",entries:plan});
      }
      this.lastCarveStats = stats;
      const message=`${preview?"Preview":"Applied"}: ${stats.changed.toLocaleString()} height samples (${stats.restored} restored) · ${(stats.planMs+(stats.applyMs??0)).toFixed(1)} ms${stats.lowBanks?" — some banks are below water; lower water elevation or raise the surrounding land":""}${stats.preserved?" — later terrain/Rockify edits preserved":""}${!stats.changed?" — bed already meets this profile":""}`;
      const feedback=message+(stats.rockSamples?` — ${stats.rockSamples.toLocaleString()} samples near Rockify; cliff shape may change`:"");
      this.panel.querySelector("#riverbedStatus").textContent=feedback;this.onStatus(feedback);
    } catch (error) {this.panel.querySelector("#riverbedStatus").textContent=error.message;this.onStatus(error.message);}
  }
  setActive(active) {
    this.finishDrag(); this.active = active; this.panel.hidden = !active;
    this.overlay.visible = active;
    if (!active) this.clearCarvePreview();
    this.refresh();
    if (active) this.onStatus("Water: create a lake, river or waterfall, or select existing water");
  }
  startBody(type) {
    this.finishDrag(); this.selectedId = null; this.pointIndex = -1;
    this.draft = { type:type==="roundLake"?"lake":type, circle:type==="roundLake",roundness:type==="river"||type==="waterfall"?undefined:.85, points: [], elevation:type==="waterfall"?0:Number(this.controls.waterElevation.value) };
    this.refresh(); this.onStatus(type==="waterfall"?"Click the upper lip, then the lower pool. Use point elevation fields for exact alignment.":type === "roundLake"?"Click the centre to place a round lake at the chosen radius":type === "river" ? "Click river points from upstream to downstream, then Finish water" : "Click boundary points at the chosen water elevation, then Finish water");
  }
  finishDraft() {
    if (!this.draft) return true;
    const fall=this.draft.type==="waterfall";
    const body = { id: `water-${crypto.randomUUID()}`, type: this.draft.type, name: fall?"Waterfall":this.draft.type === "river" ? "River" : "Lake", elevation: this.draft.elevation, points: this.draft.points,roundness:this.draft.roundness, style:fall?DEFAULT_WATERFALL_STYLE:DEFAULT_WATER_STYLE,...(fall?{fall:DEFAULT_WATERFALL}:{}) };
    try {
      this.data.set(body.id, body);
      this.recordHistory({ kind: "water", entries: { id: body.id, before: null, after: this.data.get(body.id) } });
      this.selectedId = body.id; this.draft = null; this.refresh(); this.onStatus(`${body.name} created — drag points to shape it`); return true;
    } catch (error) { this.onStatus(error.message); return false; }
  }
  edit(after) {
    this.finishDrag(); const before = this.selected;
    if (!before) return;
    try {
      const next=after===null?null:normalizeWaterBody({...after,id:before.id});
      let bed=null;
      if(before.type!=="waterfall"&&this.geometryKey(before)!==this.geometryKey(next)) {
        bed=this.beds.plan(before.id,null);if(this.beds.hasChanges(bed))this.beds.apply(bed);else bed=null;
      }
      if (this.data.set(before.id, next)) this.recordHistory({ kind: "water", entries: { id: before.id, before, after: this.data.get(before.id),bed } });
      this.refresh();
      if(bed)this.onStatus(next?"Previous waterbed restored. Use Carve waterbed to apply the new shape.":"Water and its tracked bed removed");
    } catch (error) { this.onStatus(error.message); this.refresh(); }
  }
  applyHistory(entries, property) {
    this.finishDrag(); this.draft = null; this.selectedId = entries.id;
    if(entries.bed)this.beds.applyHistory(entries.bed,property);
    this.data.set(entries.id, entries[property]); this.refresh();
  }
  geometryKey(body){return body?JSON.stringify([body.type,body.elevation,body.points,body.roundness??0,body.fall?.width,body.fall?.curvature,body.fall?.heading,body.fall?.overlap]):null;}
  changeProperties(changed) {
    const c = this.controls;
    if (this.draft) { this.draft.elevation = Number(c.waterElevation.value);if(changed==="lakeRoundness")this.draft.roundness=Number(c.lakeRoundness.value);this.refresh();return; }
    const body = this.selected; if (!body) return;
    const points = body.points.map(p => ({ ...p }));
    if (points[this.pointIndex]) {
      if (changed === "waterPointX") points[this.pointIndex].x = Number(c.waterPointX.value);
      if (changed === "waterPointZ") points[this.pointIndex].z = Number(c.waterPointZ.value);
      if (body.type === "river"||body.type==="waterfall") {
        if (changed === "waterPointY") points[this.pointIndex].y = Number(c.waterPointY.value) - body.elevation;
        if (body.type==="river"&&changed === "waterPointWidth") points[this.pointIndex].width = Number(c.waterPointWidth.value);
      }
    }
    this.edit({ ...body, name: c.waterName.value, elevation: Number(c.waterElevation.value), points,...(body.type==="lake"?{roundness:Number(c.lakeRoundness.value)}:{}),
      style: { ...body.style, color: c.waterColor.value, opacity: Number(c.waterOpacity.value), waveStrength: Number(c.waterWaves.value), flowSpeed: Number(c.waterFlow.value), foam: Number(c.waterFoam.value), depthTint: Number(c.waterDepth.value) } });
  }
  insertPoint() {
    const body = this.selected; if (!body) return;
    const i = body.type==="waterfall"?Math.min(body.points.length-2,Math.max(0,this.pointIndex)):Math.max(0,this.pointIndex), a = body.points[i];
    const end = body.type === "river" && i === body.points.length - 1;
    const b = end ? body.points[i-1] : body.points[(i + 1) % body.points.length];
    const point = end ? { x: a.x + (a.x-b.x)*.5, z: a.z+(a.z-b.z)*.5, y: a.y, width: a.width }
      : { x: (a.x+b.x)/2, z: (a.z+b.z)/2, ...(body.type === "river"||body.type==="waterfall" ? { y: (a.y+b.y)/2,...(body.type==="river"?{width:(a.width+b.width)/2}:{}) } : {}) };
    const points = [...body.points]; points.splice(i + 1, 0, point);
    this.pointIndex = i + 1; this.edit({ ...body, points });
  }
  removePoint() {
    const body = this.selected; if (!body || this.pointIndex < 0) return;
    const points = body.points.filter((_, i) => i !== this.pointIndex);
    this.pointIndex = Math.min(this.pointIndex, points.length - 1); this.edit({ ...body, points });
  }
  setRay(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.camera.updateMatrixWorld(); this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  planeHit(elevation) {
    this.plane.constant = -elevation;
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    return hit && this.raycaster.ray.origin.distanceTo(hit) <= 6000 ? hit : null;
  }
  pickVisibleSurface(event) {
    const terrain=this.pickSurface?.(event);
    this.water.root.updateMatrixWorld(true);
    // Ignore the edited river: otherwise repeated dragging would pick its own
    // elevated surface and accumulate clearance on every pointer update.
    const surfaces=[...this.water.meshes.values()].filter(mesh=>mesh.visible&&mesh.userData.waterId!==this.selectedId&&this.data.get(mesh.userData.waterId)?.type!=="waterfall");
    const water=this.raycaster.intersectObjects(surfaces,false)[0];
    if(water&&(!terrain||water.distance<this.raycaster.ray.origin.distanceTo(terrain.point)))return {point:water.point,distance:water.distance,waterId:water.object.userData.waterId};
    return terrain??null;
  }
  pickWaterfallPoint(event) {
    if(!this.panel.querySelector("#waterfallUseSurface").checked)return this.planeHit(Number(this.panel.querySelector("#waterfallPlaceElevation").value));
    return this.pickVisibleSurface(event)?.point??null;
  }
  riverSurfacePoint(event) {
    const clearance=Number(this.panel.querySelector("#riverSurfaceOffset").value);
    if(!Number.isFinite(clearance)||clearance<0||clearance>2){this.onStatus("River surface clearance must be 0–2 m.");return null;}
    const hit=this.pickVisibleSurface(event);
    if(!hit){this.onStatus("No visible surface at the cursor. Turn off Snap river points to surface to use the elevation plane.");return null;}
    // sourceX/sourceZ belong to terrain editing, never to water definitions.
    const point=hit.point.clone();if(!hit.waterId)point.y+=clearance;return point;
  }
  pointerDown(event) {
    if (event.button !== 0 || this.drag) return;
    this.setRay(event);
    if (this.draft) {
      if(this.draft.type==="waterfall") {
        const hit=this.pickWaterfallPoint(event);if(!hit){this.onStatus("No surface hit. Use the explicit placement elevation to place this endpoint.");return;}
        if(!this.draft.points.length)this.draft.elevation=hit.y;
        else if(hit.y>this.draft.elevation-.25){this.onStatus("Choose a lower endpoint at least 0.25 m below the upper lip.");return;}
        else if(this.draft.elevation-hit.y>1000){this.onStatus("Waterfall drop is limited to 1000 m. Choose a nearer lower endpoint.");return;}
        this.draft.points.push({x:hit.x,z:hit.z,y:hit.y-this.draft.elevation});
        if(this.draft.points.length===2)this.finishDraft();else{this.refresh();this.onStatus("Upper lip placed. Click the lower pool or set an explicit placement elevation.");}return;
      }
      const surfaceRiver=this.draft.type==="river"&&this.panel.querySelector("#riverUseSurface").checked;
      const hit = surfaceRiver?this.riverSurfacePoint(event):this.planeHit(this.draft.elevation);
      if(surfaceRiver&&hit&&!this.draft.points.length)this.draft.elevation=hit.y;
      if(hit&&this.draft.circle) {
        const radius=Number(this.panel.querySelector("#lakeRadius").value);
        if(!Number.isFinite(radius)||radius<2||radius>300){this.onStatus("Round lake radius must be 2–300 m");return;}
        this.draft.points=Array.from({length:12},(_,i)=>({x:hit.x+Math.cos(i*Math.PI/6)*radius,z:hit.z+Math.sin(i*Math.PI/6)*radius}));
        this.draft.roundness=1;this.finishDraft();return;
      }
      if (hit && this.draft.points.length < 256) { this.draft.points.push({ x: hit.x, z: hit.z, ...(this.draft.type === "river" ? { y:hit.y-this.draft.elevation, width: Number(this.controls.waterPointWidth.value) || 16 } : {}) }); this.refresh(); }
      return;
    }
    const body = this.selected, rect = this.canvas.getBoundingClientRect();
    let closest = 16, index = -1;
    body?.points.forEach((p, i) => {
      this.projected.set(p.x, body.elevation + (p.y ?? 0), p.z).project(this.camera);
      if (this.projected.z < -1 || this.projected.z > 1) return;
      const distance = Math.hypot((this.projected.x + 1) / 2 * rect.width + rect.left - event.clientX, (1 - this.projected.y) / 2 * rect.height + rect.top - event.clientY);
      if (distance < closest) { closest = distance; index = i; }
    });
    if (index >= 0) {
      this.pointIndex = index; this.drag = { before: body, pointerId: event.pointerId };
      this.canvas.setPointerCapture(event.pointerId); this.refresh(); return;
    }
    this.water.root.updateMatrixWorld(true);
    const picked = this.raycaster.intersectObjects([...this.water.meshes.values()], false)[0];
    this.selectedId = picked?.object.userData.waterId ?? null; this.pointIndex = -1; this.refresh();
  }
  pointerMove(event) { if (this.drag && event.pointerId === this.drag.pointerId) this.pendingMove = { clientX: event.clientX, clientY: event.clientY }; }
  update() {
    if (!this.pendingMove || !this.drag) return;
    const event = this.pendingMove; this.pendingMove = null; this.setRay(event);
    const body = this.selected,surfaceRiver=body.type==="river"&&this.panel.querySelector("#riverUseSurface").checked;
    const hit=surfaceRiver?this.riverSurfacePoint(event):this.planeHit(body.elevation + (body.points[this.pointIndex].y ?? 0)); if (!hit) return;
    const points = body.points.map((p, i) => i === this.pointIndex ? { ...p, x: hit.x, z: hit.z,...(surfaceRiver?{y:hit.y-body.elevation}:{}) } : p);
    try { this.data.set(body.id, { ...body, points }); } catch (error) { this.onStatus(error.message); }
  }
  pointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (event.type === "pointerup") this.pointerMove(event);
    this.finishDrag();
  }
  finishDrag() {
    if (!this.drag) return;
    this.update(); const { before, pointerId } = this.drag;
    this.drag = null; this.pendingMove = null;
    const after = this.data.get(before.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const bed=before.type==="waterfall"?null:this.beds.plan(before.id,null);const changed=bed&&this.beds.hasChanges(bed);
      if(changed)this.beds.apply(bed);
      this.recordHistory({ kind: "water", entries: { id: before.id, before, after,bed:changed?bed:null } });
      if(changed)this.onStatus("Previous waterbed restored. Use Carve waterbed to apply the new shape.");
    }
    if (this.canvas.hasPointerCapture?.(pointerId)) this.canvas.releasePointerCapture(pointerId);
  }
  refresh() {
    this.clearCarvePreview();
    this.panel.querySelector("#riverbedStatus").textContent="";
    const body = this.selected, c = this.controls;
    this.list.replaceChildren(new Option("Select water…", ""), ...this.data.bodies.map(b => new Option(b.name, b.id)));
    this.list.value = body?.id ?? "";
    const source = this.draft ?? body;
    c.waterName.disabled = !body;
    if (body) c.waterName.value = body.name;
    if (source) c.waterElevation.value = source.elevation;
    const style = body?.style ?? DEFAULT_WATER_STYLE;
    for (const [id, key] of [["waterColor", "color"], ["waterOpacity", "opacity"], ["waterWaves", "waveStrength"], ["waterFlow", "flowSpeed"], ["waterFoam", "foam"], ["waterDepth", "depthTint"]]) { c[id].value = style[key]; c[id].disabled = !body; }
    const point = body?.points[this.pointIndex];
    c.waterPointX.disabled = c.waterPointZ.disabled = !point;
    c.waterPointX.value = point?.x.toFixed(2) ?? ""; c.waterPointZ.value = point?.z.toFixed(2) ?? "";
    const river = source?.type === "river";
    this.panel.querySelector("#riverPlacementControls").hidden=!river;
    const waterfall=source?.type==="waterfall";
    this.panel.querySelector("#waterElevationLabel").textContent=waterfall?"Base elevation (m)":"Water elevation (m)";
    this.panel.querySelector("#waterWavesLabel").textContent=waterfall?"Surface ripple":"Wave strength";
    this.panel.querySelector("#waterFlowLabel").textContent=waterfall?"Flow speed":"Surface speed";
    this.panel.querySelector("#waterFoamLabel").textContent=waterfall?"Impact foam / splashes":"Boundary foam";
    this.panel.querySelector("#riverbedControls").hidden = !body || Boolean(this.draft)||waterfall;
    this.panel.querySelector("#lakeControls").hidden=river||waterfall;
    this.panel.querySelector("#waterfallControls").hidden=!waterfall;
    this.panel.querySelector("#waterfallPlacementControls").hidden=!waterfall||!this.draft;
    const pointSelect=this.panel.querySelector("#waterfallPointSelect");
    pointSelect.replaceChildren(new Option("Choose endpoint / control point","-1"),...(waterfall&&body?body.points.map((_,i)=>new Option(i===0?"Upper lip":i===body.points.length-1?"Lower pool":`Curve point ${i+1}`,String(i))):[]));pointSelect.value=String(this.pointIndex);pointSelect.disabled=!body||!waterfall;
    for(const [key,input] of Object.entries(this.fallControls)){input.value=body?.fall?.[key]??DEFAULT_WATERFALL[key];input.disabled=!body||!waterfall;}
    this.panel.querySelector("#waterDepth").closest("label").hidden=waterfall;
    c.lakeRoundness.value=source?.roundness??0;c.lakeRoundness.disabled=!source||river;
    const saved=this.beds.data.settings.get(body?.id);
    if(this.settingsBodyId!==body?.id){this.panel.querySelector("#riverbedDepth").value=saved?.depth??3;this.panel.querySelector("#riverbedBankWidth").value=saved?.bankWidth??12;this.panel.querySelector("#riverbedAllowRockify").checked=saved?Boolean(saved.allowRockify):true;this.settingsBodyId=body?.id;}
    this.panel.querySelector("#riverPointControls").hidden = !river&&!waterfall;
    c.waterPointWidth.closest("label").hidden=waterfall;
    this.panel.querySelector("#reverseWaterFlow").hidden=waterfall;
    c.waterPointY.disabled = !point || (!river&&!waterfall);
    c.waterPointWidth.disabled = !river || (!point && !this.draft);
    c.waterPointY.value = point && (river||waterfall) ? (body.elevation + point.y).toFixed(2) : "";
    if (point && river) c.waterPointWidth.value = point.width;
    this.panel.querySelector("#reverseWaterFlow").disabled = !body || !river;
    this.panel.querySelector("#reverseWaterFlow").textContent = body?.flowDirection === -1 ? "Flow: last → first" : "Flow: first → last";
    this.panel.querySelector("#finishWater").disabled = !this.draft;
    this.panel.querySelector("#cancelWater").disabled = !this.draft;
    this.panel.querySelector("#deleteWater").disabled = !body;
    this.panel.querySelector("#insertWaterPoint").disabled = !body || body.points.length >= (waterfall?32:256);
    this.panel.querySelector("#removeWaterPoint").disabled = !point || body.points.length <= (river||waterfall ? 2 : 3);
    this.panel.querySelector("#waterPointLabel").textContent = this.draft ? `${this.draft.points.length} ${waterfall?"waterfall":river ? "river" : "boundary"} points` : point ? waterfall?`${this.pointIndex===0?"Upper lip":this.pointIndex===body.points.length-1?"Lower pool":"Curve point"} (${this.pointIndex+1})`:`Point ${this.pointIndex + 1}${river ? " (flow follows point order)" : ""}` : "Select a control point";
    const narrowed = body && this.water.meshes.get(body.id)?.geometry.userData.narrowedSections;
    this.panel.querySelector("#waterMeshStatus").textContent = narrowed ? "Tight bend: rendered width is limited locally to prevent folded water. Widen the bend or reduce point width." : "";
    this.refreshOverlay();
  }
  refreshOverlay() {
    for (const child of [...this.overlay.children]) { child.geometry.dispose(); this.overlay.remove(child); }
    const body = this.draft ?? this.selected;
    if (!this.active || !body?.points.length) return;
    const positions = body.points.flatMap(p => [p.x, body.elevation + (p.y ?? 0) + .05, p.z]);
    const outline=body.type==="lake"&&!this.draft?lakeBoundary(body).flatMap(p=>[p.x,body.elevation+.05,p.z]):positions;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(outline, 3));
    const line = this.draft || body.type !== "lake" ? new THREE.Line(geometry, this.lineMaterial) : new THREE.LineLoop(geometry, this.lineMaterial);
    line.renderOrder = 10;
    const controlGeometry=new THREE.BufferGeometry();controlGeometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    const points = new THREE.Points(controlGeometry, this.pointMaterial); points.renderOrder = 11;
    this.overlay.add(line, points);
    const selected = !this.draft && body.points[this.pointIndex];
    if (selected) {
      const marker = new THREE.BufferGeometry();
      marker.setAttribute("position", new THREE.Float32BufferAttribute([selected.x,body.elevation+(selected.y??0)+.05,selected.z],3));
      const highlight = new THREE.Points(marker,this.selectedPointMaterial ??= new THREE.PointsMaterial({color:0xffffff,size:6,sizeAttenuation:false,depthTest:false}));
      highlight.renderOrder=12;this.overlay.add(highlight);
    }
  }
}
