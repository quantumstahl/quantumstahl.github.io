import * as THREE from "three";
import { FlyCamera } from "./engine/FlyCamera.js";
import { TerrainQuadtree } from "./engine/TerrainQuadtree.js";
import { TerrainDataProvider } from "./terrain/TerrainDataProvider.js";
import { TerrainHeightGpuCache } from "./terrain/TerrainHeightGpuCache.js";
import { TerrainMaterialGpuCache } from "./terrain/TerrainMaterialGpuCache.js";
import { RockSurfaceShell } from "./editor/RockSurfaceShell.js";
import { loadWorldSession, pickWorldFile } from "./WorldFileUI.js";
import { WaterSystem } from "./water/WaterSystem.js";

const canvas = document.querySelector("#viewport");
const statsElement = document.querySelector("#stats");
const worldSession = await loadWorldSession(statsElement);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(1.0);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83b9de);
const camera = new THREE.PerspectiveCamera(62, 1, 1, 5200);
const controller = new FlyCamera(camera);
const terrainData = new TerrainDataProvider({ store: worldSession.store });
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
  frames += 1;
  elapsed += delta;
  peakFrame = Math.max(peakFrame, delta * 1000);
  if (now - lastStatsAt < 500 || elapsed <= 0) return;

  const averageFrame = elapsed * 1000 / frames;
  const info = renderer.info.render;
  const lods = terrain.stats.lods.map(([size, count]) => `${size}m:${count}`).join(" ");
  statsElement.textContent = [
    `${(frames / elapsed).toFixed(0)} FPS · ${averageFrame.toFixed(1)} ms · peak ${peakFrame.toFixed(1)} ms`,
    `Gamepad ${controller.gamepadConnected ? "connected" : "not detected"}`,
    `${(terrain.stats.triangles / 1000).toFixed(0)}k tris · ${info.calls} draws · ${terrain.stats.patches} patches`,
    `LOD ${lods}`,
    `Water ${water.stats.bodies} bodies · ${water.stats.triangles} tris · CPU ${water.stats.updateMs.toFixed(3)} ms`,
    `Waterfalls ${water.waterfall.records.size} · ${water.waterfall.records.size*26} effect tris`,
  ].join("\n");
  frames = 0;
  elapsed = 0;
  peakFrame = 0;
  lastStatsAt = now;
}

function frame(now) {
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 1 / 20);
  controller.update(delta);
  water.update(delta,camera);
  if (rockSurfaceShell.update()) terrain.setExperimentalRockMask(rockSurfaceShell.getSourceMask());
  terrain.update(camera);
  heightCache.update(camera.position.x, camera.position.z, terrain.getVisibleSourceTileKeys());
  materialCache.update(camera.position.x, camera.position.z, terrain.getVisibleSourceTileKeys());
  rockSurfaceShell.syncCoverage();
  terrain.syncHeightCacheUniforms();
  renderer.render(scene, camera);
  updateStats(now, rawDelta);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
