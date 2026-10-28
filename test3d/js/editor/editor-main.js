import * as THREE from "three";
import { TerrainQuadtree } from "../engine/TerrainQuadtree.js";
import { TerrainDataProvider } from "../terrain/TerrainDataProvider.js";
import { loadWorldSession, pickWorldFile } from "../WorldFileUI.js";
import { TerrainHeightGpuCache } from "../terrain/TerrainHeightGpuCache.js";
import { TerrainMaterialGpuCache } from "../terrain/TerrainMaterialGpuCache.js";
import { EditorCameraController } from "./EditorCameraController.js";
import { TerrainSculptor } from "./TerrainSculptor.js";
import { TerrainTexturePainter } from "./TerrainTexturePainter.js";
import { TerrainMaterialPanel } from "./TerrainMaterialPanel.js";
import { WarpSurfacePicker } from "./WarpSurfacePicker.js";
import { RockSurfaceShell } from "./RockSurfaceShell.js";
import { WaterSystem } from "../water/WaterSystem.js";
import { WaterEditor } from "./WaterEditor.js";
import { EnvironmentSystem } from "../engine/EnvironmentSystem.js";
import { SkyPanel } from "./SkyPanel.js";
import { GLBAssetLibrary } from "../objects/GLBAssetLibrary.js";
import { ObjectSystem } from "../objects/ObjectSystem.js";
import { refreshTerrainAnchors } from "../objects/ObjectSurface.js";
import { ObjectEditor } from "./ObjectEditor.js";
import { ObjectSurfacePicker } from "./ObjectSurfacePicker.js";
import { renderWorldFrame, renderStatsLabel } from "../engine/RenderFrame.js";
import { GrassSystem } from "../vegetation/GrassSystem.js";
import { GrassPanel } from "./GrassPanel.js";

const canvas = document.querySelector("#editorCanvas");
const status = document.querySelector("#editorStatus");
const statsElement = document.querySelector("#editorStats");
const radiusInput = document.querySelector("#radiusInput");
const strengthInput = document.querySelector("#strengthInput");
const radiusValue = document.querySelector("#radiusValue");
const strengthValue = document.querySelector("#strengthValue");
const undoButton = document.querySelector("#undoButton");
const redoButton = document.querySelector("#redoButton");
const rockShellButton = document.querySelector("#rockShellButton");
const saveButton = document.querySelector("#saveButton");
const saveAsButton = document.querySelector("#saveAsButton");
const openWorldButton = document.querySelector("#openWorldButton");
const worldFileName = document.querySelector("#worldFileName");
const worldSession = await loadWorldSession(status);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83b9de);
const camera = new THREE.PerspectiveCamera(62, 1, 1, 5200);
const terrainData = new TerrainDataProvider({ store: worldSession.store });
// Keep GPU residency bounded. The cache now allocates layers only for authored
// tiles; untouched terrain is evaluated from the shared procedural baseline.
const heightCache = new TerrainHeightGpuCache(terrainData);
const materialCache = new TerrainMaterialGpuCache(worldSession.materialData);
const terrain = new TerrainQuadtree(scene, { atmosphere: { color: 0xa9bdc9, start: 3000, end: 5200, strength: 0.42 }, heightCache, materialCache });
const cameraController = new EditorCameraController(camera, canvas);
const sculptor = new TerrainSculptor(terrainData);
const painter = new TerrainTexturePainter(worldSession.materialData);
const warpSurfacePicker = new WarpSurfacePicker(terrainData);
const rockSurfaceShell = new RockSurfaceShell(scene, terrainData, heightCache);
rockSurfaceShell.setEnabled(worldSession.settings.rockShellEnabled);
rockShellButton.setAttribute("aria-pressed", String(rockSurfaceShell.enabled));
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const rayPoint = new THREE.Vector3();
const rayProbe = new THREE.Vector3();
const strokeHit = new THREE.Vector3();
const rockifyNormal = new THREE.Vector3(0, 1, 0);
const brush = new THREE.Mesh(new THREE.RingGeometry(.94, 1, 48), new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: .8, side: THREE.DoubleSide, depthTest: false }));
brush.rotation.x = -Math.PI / 2;
brush.renderOrder = 2;
brush.visible = false;
scene.add(brush);

let activeTool = "raise";
let sculpting = false;
let strokeKind = null;
let paintHit = null;
let activePointerId = null;
let lastStrokeTime = 0;
let lastSculptStatusTime = 0;
let rockifyIn = false;
let rockifyStamp = null;
const undoStack = [];
const redoStack = [];
const water = new WaterSystem(scene, worldSession.waterData);
const environment = new EnvironmentSystem(scene, worldSession.settings.environment);
const grass = new GrassSystem(scene, terrainData, worldSession.materialData, { settings: worldSession.settings.grass, water,
  diagnostics: new URLSearchParams(location.search).has("grassStats") });
environment.bindMaterial(grass.nearMaterial); environment.bindMaterial(grass.farMaterial);
for (const material of [terrain.material, rockSurfaceShell.material, water.material, water.waterfall.material, water.waterfall.effectsMaterial]) environment.bindMaterial(material);
const waterEditor = new WaterEditor({ scene, camera, canvas, data: worldSession.waterData, water,
  panel: document.querySelector("#waterPanel"), recordHistory, onStatus: setStatus, sculptor,bedData:worldSession.waterBeds,pickSurface:event=>pickPaintSurface(event) });
const MAX_HISTORY_STEPS = 50;
const objectAssets = new GLBAssetLibrary(worldSession.objectData, { onError: message => { setStatus(message); objectEditor.listsDirty = true; } });
const objects = new ObjectSystem(scene, worldSession.objectData, objectAssets, { diagnostics: new URLSearchParams(location.search).has("objectLODStats") });
const objectSurfacePicker = new ObjectSurfacePicker(terrainData);
const objectEditor = new ObjectEditor({ scene, camera, canvas, data: worldSession.objectData, assets: objectAssets, system: objects, provider: terrainData,
  panel: document.querySelector("#objectPanel"), recordHistory, onStatus: setStatus, activate: () => setTool("objects") });
const changedObjectTerrain = new Map();
terrainData.onTileChanged((tile, channels) => { if (channels & 3) changedObjectTerrain.set(`${tile.x},${tile.z}`, tile); });
function flushObjectTerrain() {
  for (const tile of changedObjectTerrain.values()) refreshTerrainAnchors(worldSession.objectData, terrainData, tile);
  changedObjectTerrain.clear();
}
objectEditor.pickVertical = (x, z, y) => {
  const ray = new THREE.Ray(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0));
  return objectSurfacePicker.pick(ray, 20000);
};
function pickObjectSurface() { return objectSurfacePicker.pick(objectEditor.raycaster.ray); }
objectEditor.pickSurface = pickObjectSurface;
let statFrames = 0;
let statElapsed = 0;
let statPeak = 0;
let lastStatsAt = 0;
let renderCpuMs = 0;
let renderCpuPeakMs = 0;
const hoverPointer = { clientX: 0, clientY: 0 };
let hoverPickScheduled = false;
const rockifyPointer = { clientX: 0, clientY: 0, shiftKey: false };
let rockifyPickScheduled = false;
let rockCutoutEnabled = false;
let changingWorld = false;
const skyPanel = new SkyPanel(environment, refreshWorldFileName);
const grassPanel = new GrassPanel(document.querySelector("#grassPanel"), grass, worldSession.materialData, { onEdit(patch) {
  const before=grass.settings;
  const after=grass.configure(patch);
  if (JSON.stringify(before)!==JSON.stringify(after)) recordHistory({ kind:"grass", entries:{before,after} });
  refreshWorldFileName();
} });

function worldSettings() { return { rockShellEnabled: rockSurfaceShell.enabled, environment: { ...environment.settings }, grass: grass.settings }; }
function refreshWorldFileName() {
  const label = `${worldSession.name}${worldSession.hasUnsavedChanges(terrainData, worldSettings()) ? " *" : ""}`;
  if (worldFileName.textContent !== label) worldFileName.textContent = label;
  worldFileName.title = worldSession.handle ? worldSession.handle.name : "First Save: choose MaxWorld/worlds/main.maxworld.json for the shared project world.";
}
terrainData.onTileChanged(refreshWorldFileName);
worldSession.materialData.onChanged(refreshWorldFileName);
worldSession.waterData.onChanged(refreshWorldFileName);
worldSession.waterBeds.onChanged(refreshWorldFileName);
worldSession.objectData.onChanged(refreshWorldFileName);

async function saveWorld(saveAs = false) {
  if (worldSession.saving) return;
  objectEditor.finishTransform();
  waterEditor.finishDrag();
  if (!waterEditor.finishDraft()) return;
  flushObjectTerrain();
  saveButton.disabled = saveAsButton.disabled = openWorldButton.disabled = true;
  setStatus("Saving world…");
  try {
    const result = await worldSession.save(terrainData, { saveAs, settings: worldSettings() });
    if (!result) setStatus("Save cancelled — changes kept");
    else setStatus(`Saved ${result.name} (${result.tiles} tiles)${worldSession.hasUnsavedChanges(terrainData, worldSettings()) ? " — newer edits remain unsaved" : ""}${!result.remembered ? " — open this file again after restarting the browser" : ""}`);
  } catch (error) { setStatus(`Save failed: ${error.message}`); }
  finally { saveButton.disabled = saveAsButton.disabled = openWorldButton.disabled = false; refreshWorldFileName(); }
}

async function openWorld() {
  if (worldSession.saving) return;
  objectEditor.finishTransform();
  flushObjectTerrain();
  if ((waterEditor.draft?.points.length || worldSession.hasUnsavedChanges(terrainData, worldSettings())) && !window.confirm("Discard unsaved changes and open another world?")) return;
  try {
    const selected = await pickWorldFile();
    await worldSession.remember.set(selected.handle);
    changingWorld = true;
    window.location.reload();
  } catch (error) { if (error.name !== "AbortError") setStatus(`Open failed: ${error.message}`); }
}
window.addEventListener("beforeunload", event => {
  objectEditor.finishTransform();
  flushObjectTerrain();
  if (!changingWorld && (waterEditor.draft?.points.length || worldSession.hasUnsavedChanges(terrainData, worldSettings()))) { event.preventDefault(); event.returnValue = ""; }
});

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--editor-panel-top", `${document.querySelector(".editor-bar").getBoundingClientRect().bottom + 12}px`);
}).observe(document.querySelector(".editor-bar"));

function setStatus(message) {
  status.textContent = message;
}

function updateStats(now, delta) {
  statFrames += 1;
  statElapsed += delta;
  statPeak = Math.max(statPeak, delta * 1000);
  if (now - lastStatsAt < 500 || statElapsed <= 0) return;
  const renderInfo = renderer.info.render;
  const dataProfile = terrainData.consumeProfile();
  const cacheProfile = heightCache.consumeProfile();
  const quadtreeProfile = terrain.consumeProfile();
  const warpPickerProfile = warpSurfacePicker.consumeProfile();
  const sculptProfile = sculptor.consumeProfile();
  const paintProfile = painter.consumeProfile();
  const materialProfile = materialCache.consumeProfile();
  const rockShellStats = rockSurfaceShell.getStats();
  const rockShellProfile = rockSurfaceShell.consumeProfile();
  const rockShellGpu = rockSurfaceShell.getGpuCacheStatus(heightCache);
  const generationSources = Object.entries(dataProfile.generatedBySource ?? {})
    .sort(([, left], [, right]) => right - left)
    .slice(0, 2)
    .map(([source, count]) => `${source}:${count}`)
    .join(",");
  statsElement.textContent = [
    `${(statFrames / statElapsed).toFixed(0)} FPS · ${(statElapsed * 1000 / statFrames).toFixed(1)} ms`,
    `peak ${statPeak.toFixed(1)} ms`,
    renderStatsLabel(renderInfo),
    `${(terrain.stats.triangles / 1000).toFixed(0)}k terrain submitted + ${(rockShellStats.triangles / 1000).toFixed(0)}k rock shell resident`,
    `${terrain.stats.patches} submitted / ${terrain.stats.selectedPatches}/${terrain.stats.patchBudget} selected / ${terrain.stats.culledPatches} culled · ${heightCache.keyToLayer.size}/${heightCache.layerCount} tiles`,
    `gen ${dataProfile.generatedTiles}${generationSources ? ` [${generationSources}]` : ""} / ${dataProfile.generationMs.toFixed(1)}ms / cache ${cacheProfile.updateMs.toFixed(1)} p${cacheProfile.updatePeakMs.toFixed(1)}`,
    `balance +${terrain.stats.balanceSplits} / warp ${terrain.stats.warpFeaturePatches} patches / summaries ${dataProfile.warpSummaryTiles} ${dataProfile.warpSummaryMs.toFixed(1)}ms`,
    `map ${cacheProfile.remappedTiles} / prep ${cacheProfile.uploadPreparationMs.toFixed(1)} p${cacheProfile.uploadPreparationPeakMs.toFixed(1)} / up ${cacheProfile.uploadedLayers} / pending ${cacheProfile.pendingUploads} / vis ${cacheProfile.visibleResident}/${cacheProfile.visibleRequired}${cacheProfile.visibleOverflow ? ` +${cacheProfile.visibleOverflow}` : ""} / fb ${cacheProfile.visibleFallback} / overview ${cacheProfile.visibleCoarse ?? 0} / miss ${cacheProfile.visibleUnavailable} / coarse ${cacheProfile.coarseUploads}@${cacheProfile.coarseBuildMs.toFixed(1)}ms`,
    `quad S${quadtreeProfile.selectionMs.toFixed(1)} p${quadtreeProfile.selectionPeakMs.toFixed(1)} T${quadtreeProfile.streamingMs.toFixed(1)} p${quadtreeProfile.streamingPeakMs.toFixed(1)} C${quadtreeProfile.commitMs.toFixed(1)}`,
    `cull ${quadtreeProfile.cullingMs.toFixed(1)} p${quadtreeProfile.cullingPeakMs.toFixed(1)}ms`,
    `render CPU ${renderCpuMs.toFixed(1)} p${renderCpuPeakMs.toFixed(1)}ms`,
    `paint CPU ${paintProfile.paintMs.toFixed(1)} p${paintProfile.paintPeakMs.toFixed(1)}ms / ${paintProfile.samples} src / masks ${materialProfile.updateMs.toFixed(1)} p${materialProfile.updatePeakMs.toFixed(1)}ms / up ${materialProfile.detailUploads}+${materialProfile.overviewUploads}`,
    `warp select ${quadtreeProfile.warpLodMs.toFixed(1)}ms`,
    `pick ${warpPickerProfile.pickMs.toFixed(1)}ms / ${warpPickerProfile.pickHits} hits / ${warpPickerProfile.pickTiles} tiles / ${warpPickerProfile.pickTriangles} tris`,
    `brush ${warpPickerProfile.brushMs.toFixed(1)}ms / ${warpPickerProfile.brushTiles} tiles / ${warpPickerProfile.brushSamples} hits / sculpt ${sculptProfile.rockifyBrushMs.toFixed(1)}ms ${sculptProfile.rockifySourceSamples} src`,
    `rock shell ${rockShellStats.enabled ? "on" : "off"} / ${rockShellStats.regions} regions / ${rockShellStats.cells} cells / ${rockShellStats.vertices} verts / ${rockShellStats.submittedTriangles}/${rockShellStats.triangles} tris / ${rockShellStats.submittedChunks}/${rockShellStats.chunks} chunks submitted/resident / GPU ${rockShellGpu.state}${rockShellGpu.maxHeightDeltaError !== undefined ? ` h${rockShellGpu.maxHeightDeltaError.toFixed(3)} w${rockShellGpu.maxWarpError.toFixed(3)}` : ""}`,
    `shell CPU ${rockShellProfile.updateMs.toFixed(1)} p${rockShellProfile.updatePeakMs.toFixed(1)}ms / geometry ${rockShellProfile.geometryMs.toFixed(1)} / mask ${rockShellProfile.maskMs.toFixed(1)} / rebuilt ${rockShellProfile.rebuiltChunks}`,
    `rock shell cutout ${rockCutoutEnabled ? "on" : "off"} / ${rockShellStats.sourceMaskTexels} source cells`,
    `water ${water.stats.bodies} bodies / ${water.stats.triangles} tris / update ${water.stats.updateMs.toFixed(3)}ms / last build ${water.stats.buildMs.toFixed(2)}ms`,
    `waterfalls ${water.waterfall.records.size} / ${water.waterfall.records.size*26} effect tris`,
    `objects ${objects.stats.instances} visible / ${worldSession.objectData.objects.size} saved · ${objects.stats.visibleCells}/${objects.stats.residentCells} cells · ${objects.stats.animated} animated`,
    ...objects.diagnosticLines(),
    ...grass.diagnosticLines(),
  ].join("\n");
  statFrames = 0;
  statElapsed = 0;
  statPeak = 0;
  renderCpuMs = 0;
  renderCpuPeakMs = 0;
  lastStatsAt = now;
}

function isPaintTool() { return activeTool === "paint" || activeTool === "erasePaint"; }

function setTool(tool) {
  if (sculpting) finishStroke();
  activeTool = tool;
  hoverPickScheduled = rockifyPickScheduled = false;
  waterEditor.setActive(tool === "water");
  objectEditor.setActive(tool === "objects");
  document.querySelector("#brushPanel").hidden = tool === "water" || tool === "objects";
  brush.visible = false;
  for (const button of document.querySelectorAll("[data-tool]")) button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
  updateRockifyLabel();
  document.querySelector("#sculptStrengthControl").hidden = isPaintTool();
  document.querySelector("#paintFlowControl").hidden = !isPaintTool();
  if (tool === "water") return;
  if (tool === "objects") { setStatus("Objects: import a GLB, select an asset to place, or click an object to edit"); return; }
  if (isPaintTool()) {
    const material = worldSession.materialData.materials[painter.activeMaterial];
    setStatus(`${activeTool === "paint" ? "Paint" : "Erase"}: ${material.name}${material.texture || activeTool === "erasePaint" ? "" : " — import an image first"}`);
    return;
  }
  setStatus(`${tool === "smoothWarp" ? "Smooth Warp" : tool[0].toUpperCase() + tool.slice(1)} brush ready`);
}

function updateRockifyLabel() {
  const button = document.querySelector('[data-tool="rockify"]');
  if (!button) return;
  button.textContent = rockifyIn ? "Rockify In" : "Rockify Out";
}

function updateHistoryButtons() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function recordHistory(step) {
  undoStack.push(step);
  if (undoStack.length > MAX_HISTORY_STEPS) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function finishStroke() {
  const kind = strokeKind;
  const entries = kind === "paint" ? painter.endStroke() : sculptor.endStroke();
  sculpting = false;
  strokeKind = null;
  paintHit = null;
  rockifyStamp = null;
  hoverPickScheduled = rockifyPickScheduled = false;
  const pointerId = activePointerId;
  activePointerId = null;
  if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  if (entries) recordHistory({ kind: kind ?? "sculpt", entries });
}

function applyHistory(step, property) {
  if (step.kind === "grass") { grass.configure(step.entries[property]); grassPanel.render(); refreshWorldFileName(); }
  else if (step.kind === "object" || step.kind === "objectAsset" || step.kind === "objectLOD" || step.kind === "objectBrush") objectEditor.applyHistory(step.entries, property, step.kind);
  else if (step.kind === "water") waterEditor.applyHistory(step.entries, property);
  else if(step.kind==="waterbed")waterEditor.beds.applyHistory(step.entries,property);
  else if (step.kind === "paint") painter.applyHistory(step.entries, property);
  else if (step.kind === "palette") worldSession.materialData.updateMaterial(step.entries.id, step.entries[property]);
  else sculptor.applyHistory(step.entries, property);
}

function editMaterial(id, patch) {
  if (sculpting) finishStroke();
  const before = worldSession.materialData.materials[id];
  if (!worldSession.materialData.updateMaterial(id, patch)) return;
  recordHistory({ kind: "palette", entries: { id, before, after: worldSession.materialData.materials[id] } });
  if (patch.texture && painter.activeMaterial === id) setTool("paint");
}

function undo() {
  objectEditor.finishTransform();
  waterEditor.finishDrag();
  if (sculpting) finishStroke();
  const step = undoStack.pop();
  if (!step) return;
  applyHistory(step, "before");
  flushObjectTerrain();
  redoStack.push(step);
  updateHistoryButtons();
  setStatus("Undo");
}

function redo() {
  objectEditor.finishTransform();
  waterEditor.finishDrag();
  if (sculpting) finishStroke();
  const step = redoStack.pop();
  if (!step) return;
  applyHistory(step, "after");
  flushObjectTerrain();
  undoStack.push(step);
  updateHistoryButtons();
  setStatus("Redo");
}

function pickTerrain(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const ray = raycaster.ray;
  // The terrain's canonical surface is sampled on a 2 m grid.  A 24 m ray
  // march can leap completely over a narrow procedural ridge, returning the
  // lower ground behind the visible mountain.  Keep this editor-only pick at
  // source resolution so ordinary sculpt tools target the surface under the
  // cursor.  It is throttled to one requestAnimationFrame and never runs
  // during camera rotation.
  const pickStep = terrainData.sampleSpacing;
  let previousDistance = 0;
  let previousHeight = ray.origin.y - terrainData.sampleHeightCached(ray.origin.x, ray.origin.z);
  for (let distance = pickStep; distance <= 6000; distance += pickStep) {
    ray.at(distance, rayPoint);
    const height = rayPoint.y - terrainData.sampleHeightCached(rayPoint.x, rayPoint.z);
    if (previousHeight >= 0 && height <= 0) {
      let near = previousDistance;
      let far = distance;
      for (let step = 0; step < 9; step += 1) {
        const middle = (near + far) * .5;
        ray.at(middle, rayProbe);
        if (rayProbe.y >= terrainData.sampleHeightCached(rayProbe.x, rayProbe.z)) near = middle;
        else far = middle;
      }
      ray.at((near + far) * .5, rayPoint);
      rayPoint.y = terrainData.sampleHeightCached(rayPoint.x, rayPoint.z);
      return rayPoint;
    }
    previousDistance = distance;
    previousHeight = height;
  }
  return null;
}

function pickWarpSurface(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return warpSurfacePicker.pick(raycaster.ray);
}

function pickPaintSurface(event) {
  const flat = pickTerrain(event);
  const warped = pickWarpSurface(event);
  const displacement = flat ? terrainData.sampleWarp(flat.x, flat.z) : null;
  const flatIsDisplaced = displacement && Math.hypot(displacement.x, displacement.z) > .001;
  if (warped && (!flat || flatIsDisplaced || warped.distance <= raycaster.ray.origin.distanceTo(flat) + .01)) return warped;
  if (!flat || flatIsDisplaced) return null;
  return { point: flat.clone(), sourceX: flat.x, sourceZ: flat.z };
}

function sampleTerrainNormal(worldX, worldZ, target) {
  const step = terrainData.sampleSpacing;
  const left = terrainData.sampleSurfaceHeight(worldX - step, worldZ);
  const right = terrainData.sampleSurfaceHeight(worldX + step, worldZ);
  const near = terrainData.sampleSurfaceHeight(worldX, worldZ - step);
  const far = terrainData.sampleSurfaceHeight(worldX, worldZ + step);
  return target.set(left - right, step * 2, near - far).normalize();
}

function captureRockifyStamp(hit) {
  const point = hit.point ?? hit;
  if (hit.normal) rockifyNormal.copy(hit.normal);
  else sampleTerrainNormal(point.x, point.z, rockifyNormal);
  const referenceUp = Math.abs(rockifyNormal.y) > .95
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(referenceUp, rockifyNormal).normalize();
  const bitangent = new THREE.Vector3().crossVectors(rockifyNormal, tangent).normalize();
  return { center: point.clone(), normal: rockifyNormal.clone(), tangent, bitangent, sourceX: hit.sourceX ?? point.x, sourceZ: hit.sourceZ ?? point.z };
}

function canStartRockify(hit) {
  if (!hit) return false;
  const point = hit.point ?? hit;
  if (hit.normal) return sculptor.isRockifiableSurface(point.x, point.z, hit.normal);
  sampleTerrainNormal(point.x, point.z, rockifyNormal);
  return sculptor.isRockifiableSurface(point.x, point.z, rockifyNormal);
}

function selectRockShellRegion(hit) {
  const point = hit.point ?? hit;
  rockSurfaceShell.selectAt(hit.sourceX ?? point.x, hit.sourceZ ?? point.z);
}

function updateRockCutoutMask() {
  const mask = rockSurfaceShell.getSourceMask();
  rockCutoutEnabled = Boolean(mask);
  terrain.setExperimentalRockMask(mask);
}

function updateBrush(hit) {
  brush.visible = Boolean(hit) && activeTool !== "rockify";
  if (!hit) return;
  const point = hit.point ?? hit;
  brush.rotation.set(-Math.PI / 2, 0, 0);
  brush.position.set(point.x, point.y + .8, point.z);
  brush.scale.setScalar(sculptor.radius);
}

function queueHeightfieldHover(event) {
  hoverPointer.clientX = event.clientX;
  hoverPointer.clientY = event.clientY;
  hoverPickScheduled = true;
}

function updateHeightfieldHover() {
  if (!hoverPickScheduled) return;
  hoverPickScheduled = false;
  if (activeTool === "rockify") return;
  if (cameraController.dragging && !sculpting) return;
  const hit = isPaintTool() ? pickPaintSurface(hoverPointer) : pickTerrain(hoverPointer);
  updateBrush(hit);
  if (isPaintTool()) {
    paintHit = hit;
    if (!hit) painter.resetPath();
  }
  if (sculpting && hit) strokeHit.copy(hit.point ?? hit);
}

// Pointer events can arrive several times between two display frames.  The
// warped-surface picker deliberately tests real 2 m triangles, so run that
// expensive editor-only operation at most once per rendered frame and always
// use the newest pointer position.
function queueRockifyStrokePick(event) {
  rockifyPointer.clientX = event.clientX;
  rockifyPointer.clientY = event.clientY;
  rockifyPointer.shiftKey = event.shiftKey;
  rockifyPickScheduled = true;
}

function updateRockifyStrokePick() {
  if (!rockifyPickScheduled) return;
  rockifyPickScheduled = false;
  if (activeTool !== "rockify" || !sculpting) return;
  rockifyIn = rockifyPointer.shiftKey;
  updateRockifyLabel();
  const warpedHit = pickWarpSurface(rockifyPointer);
  // A first stamp on a newly raised slope has no warp summary yet. Keep the
  // heightfield fallback for that case, but still throttle it with this job.
  const hit = warpedHit?.point ?? pickTerrain(rockifyPointer);
  if (!hit) return;
  const surfaceHit = warpedHit ?? hit;
  if (canStartRockify(surfaceHit)) {
    strokeHit.copy(hit);
    rockifyStamp = captureRockifyStamp(surfaceHit);
    selectRockShellRegion(surfaceHit);
  } else rockifyStamp = null;
}

function sculptAt(hit, delta) {
  if (!hit) return;
  if (isPaintTool()) {
    if (!paintHit || !painter.stroke) return;
    const changed = painter.paintTo(paintHit.sourceX, paintHit.sourceZ, Math.min(delta, .08));
    if (changed && performance.now() - lastSculptStatusTime > 200) {
      setStatus(`${activeTool === "paint" ? "Paint" : "Erase paint"} · ${worldSession.materialData.materials[painter.activeMaterial].name}`);
      lastSculptStatusTime = performance.now();
    }
    return;
  }
  if (activeTool === "rockify" && !rockifyStamp) return;
  const sculptPoint = activeTool === "rockify" && rockifyStamp ? rockifyStamp.center : hit;
  const rockifyCandidates = activeTool === "rockify" && rockifyStamp
    ? warpSurfacePicker.queryBrushSphere(rockifyStamp.center, sculptor.radius)
    : [];
  const changed = sculptor.sculpt(sculptPoint.x, sculptPoint.z, Math.min(delta, .08), activeTool, { rockifyIn, rockNormal: rockifyNormal, rockStamp: rockifyStamp, rockifyCandidates });
  const now = performance.now();
  if (changed && now - lastSculptStatusTime > 200) {
    setStatus(`${activeTool[0].toUpperCase()}${activeTool.slice(1)} · ${changed} samples`);
    lastSculptStatusTime = now;
  }
}

const materialPanel = new TerrainMaterialPanel(document.querySelector("#materialPanel"), worldSession.materialData, materialCache, {
  onSelect(id) {
    if (sculpting) finishStroke();
    painter.activeMaterial = id;
    setTool(isPaintTool() ? activeTool : "paint");
  },
  onEdit: editMaterial,
  onStatus: setStatus,
});
for (const button of document.querySelectorAll("[data-tool]")) button.addEventListener("click", () => setTool(button.dataset.tool));
rockShellButton.addEventListener("click", () => {
  const enabled = !rockSurfaceShell.enabled;
  rockSurfaceShell.setEnabled(enabled);
  rockSurfaceShell.update();
  rockCutoutEnabled = enabled && Boolean(rockSurfaceShell.getSourceMask());
  updateRockCutoutMask();
  rockShellButton.setAttribute("aria-pressed", String(enabled));
  refreshWorldFileName();
  const shellStats = rockSurfaceShell.getStats();
  setStatus(enabled
    ? (shellStats.triangles ? `Rock shell and source cutout enabled: ${shellStats.triangles} tris / ${shellStats.chunks} chunks` : "Rock shell: Rockify a region first")
    : "Rock shell and source cutout hidden");
});
radiusInput.addEventListener("input", () => {
  sculptor.radius = Number(radiusInput.value);
  painter.radius = sculptor.radius;
  radiusValue.value = `${sculptor.radius} m`;
});
strengthInput.addEventListener("input", () => {
  sculptor.strength = Number(strengthInput.value);
  strengthValue.value = `${sculptor.strength}`;
});
document.querySelector("#paintFlowInput").addEventListener("input", event => {
  painter.flow = Number(event.target.value) * .06;
  document.querySelector("#paintFlowValue").value = `${event.target.value}%`;
});
saveButton.addEventListener("click", () => saveWorld());
saveAsButton.addEventListener("click", () => saveWorld(true));
openWorldButton.addEventListener("click", openWorld);
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
window.addEventListener("keydown", event => {
  const typing = event.target.closest?.("input, textarea, select, [contenteditable='true']");
  if (typing && !((event.ctrlKey || event.metaKey) && ["s", "o"].includes(event.key.toLowerCase()))) return;
  objectEditor.keyDown(event);
  if (isPaintTool() && !event.ctrlKey && !event.metaKey && /^[1-8]$/.test(event.key)) { materialPanel.select(Number(event.key) - 1); return; }
  if (event.key === "Shift") {
    rockifyIn = true;
    updateRockifyLabel();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveWorld(event.shiftKey); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); openWorld(); return; }
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  if (event.shiftKey) redo(); else undo();
});
window.addEventListener("keyup", event => {
  if (event.key === "Shift") {
    rockifyIn = false;
    updateRockifyLabel();
  }
});

canvas.addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  if (activeTool === "objects") { objectEditor.pointerDown(event); return; }
  if (activeTool === "water") { waterEditor.pointerDown(event); event.preventDefault(); return; }
  if (sculpting) return;
  if (activeTool === "paint") {
    const material = worldSession.materialData.materials[painter.activeMaterial];
    if (!material.texture || materialCache.loadErrors.has(material.texture)) { setStatus(`Choose a working image for ${material.name} before painting`); return; }
  }
  const paintSurface = isPaintTool() ? pickPaintSurface(event) : null;
  const warpedHit = activeTool === "rockify" ? pickWarpSurface(event) : null;
  const hit = isPaintTool() ? paintSurface?.point : warpedHit?.point ?? pickTerrain(event);
  if (!hit) return;
  if (activeTool === "rockify" && !canStartRockify(warpedHit ?? hit)) {
    setStatus("Rockify only works on sloped or existing rock surfaces");
    return;
  }
  sculpting = true;
  strokeKind = isPaintTool() ? "paint" : "sculpt";
  paintHit = paintSurface;
  if (isPaintTool()) painter.beginStroke({ erase: activeTool === "erasePaint" });
  else sculptor.beginStroke();
  lastStrokeTime = performance.now();
  strokeHit.copy(hit);
  canvas.setPointerCapture(event.pointerId);
  activePointerId = event.pointerId;
  if (activeTool === "flatten") sculptor.captureFlattenHeight(hit.x, hit.z);
  if (activeTool === "rockify") {
    rockifyIn = event.shiftKey;
    updateRockifyLabel();
    rockifyStamp = captureRockifyStamp(warpedHit ?? hit);
    selectRockShellRegion(warpedHit ?? hit);
  }
  sculptAt(hit, 1 / 60);
  event.preventDefault();
});
canvas.addEventListener("pointermove", event => {
  if (activeTool === "objects") { objectEditor.pointerMove(event); return; }
  if (activeTool === "water") { waterEditor.pointerMove(event); return; }
  // Camera look does not need a brush hit. More importantly, picking walks a
  // long terrain ray and can synchronously create missing 2 m data tiles.
  // Keep that editor-only CPU work out of right/middle-drag camera movement.
  if (cameraController.dragging && !sculpting) {
    brush.visible = false;
    return;
  }
  // Rockify follows the visible folded surface during a stroke and skips
  // triangle picking until pressed. Coalesce picks to one job per frame.
  if (activeTool === "rockify") {
    if (sculpting) queueRockifyStrokePick(event);
    return;
  }
  queueHeightfieldHover(event);
  if (!sculpting) return;
});
const stopSculpt = event => {
  if (activeTool === "objects") { objectEditor.pointerUp(event, pickObjectSurface); return; }
  if (activeTool === "water") waterEditor.pointerUp(event);
  if (event.type === "pointerup" && event.button !== 0) return;
  if (sculpting && isPaintTool() && event.type === "pointerup") {
    // Include a fast drag's final point even when release precedes the RAF.
    queueHeightfieldHover(event);
    camera.updateMatrixWorld();
    updateHeightfieldHover();
    sculptAt(strokeHit, Math.max(1 / 240, (performance.now() - lastStrokeTime) / 1000));
  }
  if (sculpting) finishStroke();
  sculpting = false;
  rockifyStamp = null;
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
};
canvas.addEventListener("pointerup", stopSculpt);
canvas.addEventListener("pointercancel", stopSculpt);
canvas.addEventListener("lostpointercapture", stopSculpt);
canvas.addEventListener("pointerleave", () => objectEditor.pointerLeave());
window.addEventListener("blur", () => { objectEditor.finishTransform(); waterEditor.finishDrag(); if (sculpting) finishStroke(); brush.visible = false; });

function frame(now) {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 1 / 20);
  cameraController.update(delta);
  environment.update(rawDelta);
  skyPanel.update();
  waterEditor.update();
  water.update(delta,camera);
  flushObjectTerrain();
  objectEditor.update(delta);
  objects.update(camera, delta);
  materialPanel.updateLoadState();
  // Consume the newest pointer before sculpting. A separate RAF callback
  // could run after this frame and leave the brush one rendered frame behind.
  if (hoverPickScheduled || rockifyPickScheduled) camera.updateMatrixWorld();
  updateHeightfieldHover();
  updateRockifyStrokePick();
  if (sculpting) {
    // A RAF timestamp describes the start of its rendering frame and can
    // precede a pointerdown handled in that frame. Use the same live clock
    // as the pointer handlers instead of subtracting those two timestamps.
    const strokeNow = performance.now();
    sculptAt(strokeHit, Math.max(0, (strokeNow - lastStrokeTime) / 1000));
    lastStrokeTime = strokeNow;
  }
  if (!sculpting && rockSurfaceShell.update()) updateRockCutoutMask();
  terrain.update(camera);
  heightCache.update(camera.position.x, camera.position.z, terrain.getVisibleSourceTileKeys());
  materialCache.update(camera.position.x, camera.position.z, terrain.getVisibleSourceTileKeys());
  rockSurfaceShell.syncCoverage();
  terrain.syncHeightCacheUniforms();
  grass.update(camera, delta);
  const renderStarted = performance.now();
  renderWorldFrame(renderer, environment, scene, camera);
  const renderElapsed = performance.now() - renderStarted;
  renderCpuMs += renderElapsed;
  renderCpuPeakMs = Math.max(renderCpuPeakMs, renderElapsed);
  updateStats(now, rawDelta);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
setTool(activeTool);
updateHistoryButtons();
refreshWorldFileName();
setStatus(worldSession.notice || (worldSession.importedLegacy ? "Imported browser save — Save to choose a world file" : `Loaded ${worldSession.name}`));
requestAnimationFrame(frame);
window.addEventListener("pagehide", event => { if (!event.persisted) { grassPanel.dispose(); grass.dispose(); objectEditor.dispose(); objects.dispose(); objectAssets.dispose(); } });
