import * as THREE from "three";
import { FlyCamera } from "./engine/FlyCamera.js";
import { TerrainQuadtree } from "./engine/TerrainQuadtree.js";
import { TerrainDataProvider } from "./terrain/TerrainDataProvider.js";
import { TerrainHeightGpuCache } from "./terrain/TerrainHeightGpuCache.js";
import { TerrainMaterialGpuCache } from "./terrain/TerrainMaterialGpuCache.js";
import { RockSurfaceShell } from "./editor/RockSurfaceShell.js";
import { loadWorldSession, pickWorldFile } from "./WorldFileUI.js";
import { WaterSystem } from "./water/WaterSystem.js";
import { EnvironmentSystem } from "./engine/EnvironmentSystem.js";
import { GLBAssetLibrary } from "./objects/GLBAssetLibrary.js";
import { ObjectSystem } from "./objects/ObjectSystem.js";
import { renderWorldFrame, renderStatsLabel } from "./engine/RenderFrame.js";
import { GrassSystem } from "./vegetation/GrassSystem.js";
import { findMapCat } from "./game/MapCat.js";

const canvas = document.querySelector("#viewport");
const statsElement = document.querySelector("#stats");
const worldSession = await loadWorldSession(statsElement);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(1.0);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83b9de);
const camera = new THREE.PerspectiveCamera(62, 1, 1, 5200);
const terrainData = new TerrainDataProvider({ store: worldSession.store });
const runtimeOptions = new URLSearchParams(location.search);
const objectWarnings = document.querySelector("#objectWarnings");
const objectAssets = new GLBAssetLibrary(worldSession.objectData, { onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = `${message} Available LODs are used where possible; objects with no available model appear as pink boxes.`; } });
const mapCat = runtimeOptions.get("character") === "fly" ? null : findMapCat(worldSession.objectData);
let controller;
let physicsDebug = null;
if (mapCat || runtimeOptions.get("character") === "cat") {
  const { CatCharacterRuntime } = await import("./game/CatCharacterRuntime.js");
  const spawnX = Number(runtimeOptions.get("spawnX") ?? 100), spawnZ = Number(runtimeOptions.get("spawnZ") ?? 100);
  controller = await CatCharacterRuntime.create(scene, camera, terrainData, mapCat
    ? { mapObject: mapCat, assetLibrary: objectAssets }
    : { spawnXZ: [Number.isFinite(spawnX) ? spawnX : 100, Number.isFinite(spawnZ) ? spawnZ : 100] });
  if (runtimeOptions.has("physicsDebug")) {
    const { PhysicsDebug } = await import("./physics/PhysicsDebug.js");
    physicsDebug = new PhysicsDebug(scene, controller.body, controller.terrainCollider);
  }
} else controller = new FlyCamera(camera);
if (controller.input) {
  const { TouchControls } = await import("./game/TouchControls.js");
  if (TouchControls.supported()) controller.input.attachTouch(new TouchControls(canvas));
}
statsElement.hidden = !!controller.physics && !physicsDebug && !runtimeOptions.has("stats");
const heightCache = new TerrainHeightGpuCache(terrainData);
const materialCache = new TerrainMaterialGpuCache(worldSession.materialData);
const terrain = new TerrainQuadtree(scene, {
  atmosphere: { color: 0xa9bdc9, start: 3000, end: 5200, strength: 0.42 },
  heightCache,
  materialCache,
});
const rockSurfaceShell = new RockSurfaceShell(scene, terrainData, heightCache);
rockSurfaceShell.setEnabled(worldSession.settings.rockShellEnabled);
const water = new WaterSystem(scene, worldSession.waterData);
const environment = new EnvironmentSystem(scene, worldSession.settings.environment);
const grass = new GrassSystem(scene, terrainData, worldSession.materialData, { settings: worldSession.settings.grass, water,
  diagnostics: new URLSearchParams(location.search).has("grassStats") });
environment.bindMaterial(grass.nearMaterial); environment.bindMaterial(grass.farMaterial);
environment.bindMaterial(grass.flowerMaterial);
const objects = new ObjectSystem(scene, worldSession.objectData, objectAssets, {
  diagnostics: runtimeOptions.has("objectLODStats"), excludeIds: new Set(mapCat ? [mapCat.id] : []),
});
if (controller.physics) controller.attachObjects(worldSession.objectData, objectAssets, { onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = message; } });
window.addEventListener("keydown", event => {
  if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "l" && !event.target.closest?.("input, textarea, select, [contenteditable='true']")) objects.diagnostics = !objects.diagnostics;
});
for (const material of [terrain.material, rockSurfaceShell.material, water.material, water.waterfall.material, water.waterfall.effectsMaterial]) environment.bindMaterial(material);
const clock = new THREE.Clock();

let frames = 0;
let elapsed = 0;
let peakFrame = 0;
let lastStatsAt = 0;

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function updateStats(now, delta) {
  if (statsElement.hidden) return;
  frames += 1;
  elapsed += delta;
  peakFrame = Math.max(peakFrame, delta * 1000);
  if (now - lastStatsAt < 500 || elapsed <= 0) return;

  const averageFrame = elapsed * 1000 / frames;
  const info = renderer.info.render;
  const rockStats = rockSurfaceShell.getStats();
  const lods = terrain.stats.lods.map(([size, count]) => `${size}m:${count}`).join(" ");
  statsElement.textContent = [
    `${(frames / elapsed).toFixed(0)} FPS · ${averageFrame.toFixed(1)} ms · peak ${peakFrame.toFixed(1)} ms`,
    `Gamepad ${controller.gamepadConnected ? "connected" : "not detected"}`,
    ...(controller.physics ? [
      `Cat ${controller.body.state} · physics ${controller.physics.stats.updateMs.toFixed(3)} ms`,
      `Support ${controller.body.groundObject?.name ?? "none"}${controller.physics.stats.waitingForColliders ? " · loading nearby collision" : ""}`,
      "Left stick walk · RT/L3 run · A jump",
      "Right stick look (WASD/Shift/Space/arrows)",
    ] : []),
    renderStatsLabel(info),
    `Terrain ${terrain.stats.triangles.toLocaleString("en-US")} tris · ${terrain.stats.patches} patches (${terrain.stats.culledPatches} culled)`,
    `Terrain LOD ${lods}`,
    `Rock ${rockStats.submittedChunks}/${rockStats.chunks} chunks · ${(rockStats.submittedTriangles / 1000).toFixed(0)}k/${(rockStats.triangles / 1000).toFixed(0)}k tris submitted/resident`,
    `Water ${water.stats.bodies} bodies · ${water.stats.triangles} tris · CPU ${water.stats.updateMs.toFixed(3)} ms`,
    `Waterfalls ${water.waterfall.records.size} · ${water.waterfall.records.size*26} effect tris`,
    `Objects ${objects.stats.instances} · ${objects.stats.visibleCells}/${objects.stats.residentCells} cells · ${objects.stats.animated} animated`,
    ...objects.diagnosticLines(),
    ...grass.diagnosticLines(),
  ].join("\n");
  frames = 0;
  elapsed = 0;
  peakFrame = 0;
  lastStatsAt = now;
}

function frame(now) {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 1 / 20);
  controller.update(controller.physics ? rawDelta : delta);
  physicsDebug?.update();
  environment.update(rawDelta);
  water.update(delta,camera);
  objects.update(camera, delta);
  if (rockSurfaceShell.update()) terrain.setExperimentalRockMask(rockSurfaceShell.getSourceMask());
  terrain.update(camera);
  heightCache.update(camera.position.x, camera.position.z, terrain.getVisibleSourceTileKeys());
  materialCache.update(camera.position.x, camera.position.z, terrain.getVisibleSourceTileKeys());
  rockSurfaceShell.syncCoverage();
  terrain.syncHeightCacheUniforms();
  grass.update(camera, delta);
  renderWorldFrame(renderer, environment, scene, camera);
  updateStats(now, rawDelta);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
window.addEventListener("pagehide", event => { if (!event.persisted) { physicsDebug?.dispose(); controller.dispose?.(); grass.dispose(); objects.dispose(); objectAssets.dispose(); } });
