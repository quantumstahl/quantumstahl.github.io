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
import { DestructibleSystem } from "./objects/DestructibleSystem.js";
import { PickupSystem } from "./objects/PickupSystem.js";
import { GameHud } from "./game/GameHud.js";
import { isFallingTree } from "./objects/DestructibleConfig.js";
import { BoxPhysics } from "./physics/BoxPhysics.js";
import { renderWorldFrame, renderStatsLabel } from "./engine/RenderFrame.js";
import { GrassSystem } from "./vegetation/GrassSystem.js";
import { findMapCat } from "./game/MapCat.js";
import { AudioManager } from "./audio/AudioManager.js";
import { SOUND_CONFIG } from "./audio/SoundConfig.js";
import { DayNightAudio } from "./audio/DayNightAudio.js";
import { attachAudioControls } from "./audio/AudioControls.js";
import { MenuController } from "./game/MenuController.js";
import { MenuPresentation } from "./game/MenuPresentation.js";
import { PlayerSession } from "./game/PlayerSession.js";
import { PlayerSettings } from "./game/PlayerSettings.js";
import { PlayerSaves, worldSaveKey } from "./game/PlayerSaves.js";
import { updateGameplay } from "./game/GameplayUpdates.js";
import { SpiderSystem } from "./enemies/SpiderSystem.js";
import { ArenaSystem } from "./triggers/ArenaSystem.js";
import { MountainTitleSequence } from './game/MountainTitleSequence.js';



//IMPORTANT: The existing iOS audio unlock hack is intentional and has been verified working on the actual iPhone.
var song= 'sounds/mountain.mp3';
var audio5 = new Audio(song);
const context = new (window.AudioContext || window.webkitAudioContext)();
            audio5.loop = true;

 document.addEventListener('click', (event) => {
                try{if(audio5.paused){ audio5.play();}}catch(error){};
                if(context.state === 'suspended'){context.suspend();context.resume();} 

            });
            document.addEventListener("touchstart" , function(e) {
                if (!e.target.closest?.(".game-settings")) e.preventDefault();
                try{if(audio5.paused){ audio5.play();}}catch(error){};
                if(context.state === 'suspended'){context.suspend();context.resume();}           
            });











const canvas = document.querySelector("#viewport");
const statsElement = document.querySelector("#stats");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83b9de);
const camera = new THREE.PerspectiveCamera(62, 1, 1, 5200);
const audioDiagnostics = new URLSearchParams(location.search).has("audioDebug")
  ? (await import("./audio/AudioDiagnostics.js")).createAudioDiagnostics() : null;
const audio = new AudioManager({ scene, camera, sounds: SOUND_CONFIG, onTrace: audioDiagnostics?.record });
audioDiagnostics?.attach(audio);
if (audioDiagnostics) window.maxWorldAudioDebug = audioDiagnostics;
const detachAudioControls = attachAudioControls(audio, document.querySelector("#audioControls"));
// Preload without delaying the world. The first touchstart uses CatAdventure's
// initial suspend/resume sequence; loops wait and locked one-shots are dropped.
void audio.preload(Object.keys(SOUND_CONFIG).filter(id => id !== "introduction" && id !== "exploration"));
// Keep the verified unlock handlers above verbatim. Their existing element is
// the single music source; the manager supplies channel gain and menu pausing.
audio.attachMusicElement(audio5, SOUND_CONFIG.exploration.url);
// Register gesture capture before any world/file-picker await. The first tap
// may select the world, and must also unlock the shared audio context.
const worldSession = await loadWorldSession(statsElement);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(1.0);
const combatAudio = {
  clawSound: () => audio.play("claw"),
  destructionSound: (hit, target) => audio.play3D("crate_break", target.position, { volume: .8, pitch: 1.1 }),
};
const terrainData = new TerrainDataProvider({ store: worldSession.store });
const runtimeOptions = new URLSearchParams(location.search);
const objectWarnings = document.querySelector("#objectWarnings");
const objectAssets = new GLBAssetLibrary(worldSession.objectData, { onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = `${message} Available LODs are used where possible; objects with no available model appear as pink boxes.`; } });
const mapCat = runtimeOptions.get("character") === "fly" ? null : findMapCat(worldSession.objectData);
let controller;
let physicsDebug = null;
let cameraDebug = null;
let movementDebug = null;
let combatTestTarget = null;
if (mapCat || runtimeOptions.get("character") === "cat") {
  const { CatCharacterRuntime } = await import("./game/CatCharacterRuntime.js");
  const spawnX = Number(runtimeOptions.get("spawnX") ?? 100), spawnZ = Number(runtimeOptions.get("spawnZ") ?? 100);
  const cameraMode = runtimeOptions.get("camera") === "smart" ? "smart" : "nextworld";
  const cameraSettings = { collisionEnabled: runtimeOptions.get("cameraCollision") !== "off" };
  controller = await CatCharacterRuntime.create(scene, camera, terrainData, mapCat
    ? { mapObject: mapCat, assetLibrary: objectAssets, cameraMode, cameraSettings, combat: combatAudio }
    : { spawnXZ: [Number.isFinite(spawnX) ? spawnX : 100, Number.isFinite(spawnZ) ? spawnZ : 100], cameraMode, cameraSettings, combat: combatAudio });
 
  if (runtimeOptions.has("combatTest")) {
    const { CombatTestTarget } = await import("./game/CombatTestTarget.js");
    combatTestTarget = new CombatTestTarget(scene, controller.melee, controller.body);
  }
  if (runtimeOptions.has("physicsDebug")) {
    const { PhysicsDebug } = await import("./physics/PhysicsDebug.js");
    physicsDebug = new PhysicsDebug(scene, controller.body, controller.terrainCollider);
  }
  if (runtimeOptions.has("cameraDebug")) {
    const { CameraDebug } = await import("./game/CameraDebug.js");
    cameraDebug = new CameraDebug(scene, controller.smartCamera);
  }
} else controller = new FlyCamera(camera);
if (controller.input) {
  const { TouchControls } = await import("./game/TouchControls.js");
  if (TouchControls.supported()) controller.input.attachTouch(new TouchControls(canvas));
  if (runtimeOptions.has("movementDebug")) {
    const { MovementDebug } = await import("./game/MovementDebug.js");
    movementDebug = new MovementDebug(controller);
  }
}
audioDiagnostics?.setInput(controller.input);
statsElement.hidden = !!controller.physics && !physicsDebug && !cameraDebug && !runtimeOptions.has("stats");
const heightCache = new TerrainHeightGpuCache(terrainData);
const materialCache = new TerrainMaterialGpuCache(worldSession.materialData);
const terrain = new TerrainQuadtree(scene, {
  atmosphere: { color: 0xa9bdc9, start: 3000, end: 5200, strength: 0.42 },
  heightCache,
  materialCache,
});
if (runtimeOptions.has("terrainPatchBoundaries")) terrain.setPatchBoundariesVisible(true);
const rockSurfaceShell = new RockSurfaceShell(scene, terrainData, heightCache);
if (cameraDebug) window.maxWorldCameraDebug = { runtime: controller, camera, rockSurfaceShell, snapshot: () => cameraDebug.snapshot() };
rockSurfaceShell.setEnabled(worldSession.settings.rockShellEnabled);
const water = new WaterSystem(scene, worldSession.waterData);
const environment = new EnvironmentSystem(scene, worldSession.settings.environment);
const ambientAudio = new DayNightAudio(audio);
ambientAudio.update(0, environment.uniforms.uDaylight.value);
const grass = new GrassSystem(scene, terrainData, worldSession.materialData, { settings: worldSession.settings.grass, water,
  diagnostics: new URLSearchParams(location.search).has("grassStats") });
environment.bindMaterial(grass.nearMaterial); environment.bindMaterial(grass.farMaterial);
environment.bindMaterial(grass.flowerMaterial);
const objects = new ObjectSystem(scene, worldSession.objectData, objectAssets, {
  diagnostics: runtimeOptions.has("objectLODStats"), excludeIds: new Set(mapCat ? [mapCat.id] : []),
});
if (controller.physics) controller.attachObjects(worldSession.objectData, objectAssets, { onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = message; } });
if (controller.physics) {
  const fade = document.querySelector("#respawnFade");
  controller.attachTriggers(worldSession.triggerData, { onFade: opacity => { fade.style.opacity = String(opacity); } });
}
const gameHud = controller.health ? new GameHud(document.querySelector("#gameHud"), controller.health) : null;
const spiders = controller.melee ? new SpiderSystem(scene, controller, worldSession.objectData, objectAssets, objects, {
  onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = message; },
}) : null;
// Optional bundled-model fixture; normal play uses editor placements.
if (spiders && runtimeOptions.has("spiderTest")) {
  const p = controller.body.position, yaw = controller.body.yaw;
  spiders.add({ id: "spider-test", assetId: "maxworld:spider", position: [p.x - Math.sin(yaw) * 4, p.y, p.z - Math.cos(yaw) * 4],
    rotation: [0, 0, 0], scale: [1, 1, 1], properties: { enemy: { type: "spider" } } });
}
spiders?.update(0);
const pickups = controller.physics ? new PickupSystem(scene, {
  assets: objectAssets, data: worldSession.objectData, objects, collider: controller.objectCollider,
  surfaces: [controller.terrainCollider, controller.rockCollider], body: controller.body, terrain: terrainData, audio,
  onChange: state => gameHud?.setCoins(state.coinCount),
  onHeal: amount => controller.heal?.(amount),
  onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = message; },
}) : null;
if (pickups) { controller.attachPickups(pickups); window.maxWorldPickups = pickups; }
const encounters = spiders ? new ArenaSystem(worldSession.triggerData, spiders, objects, controller.objectCollider, pickups, {
  onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = message; },
}) : null;
const titleSequence = controller.physics ? new MountainTitleSequence(controller, audio) : null;
const boxPhysics = controller.physics ? new BoxPhysics(worldSession.objectData, objects, controller.objectCollider,
  [controller.terrainCollider, controller.rockCollider], { terrain: terrainData, onMove: id => {
    destructibles?.refreshTarget(id); pickups?.wakeSupport(id);
  } }) : null;
const destructibles = controller.melee ? new DestructibleSystem(scene, worldSession.objectData, objectAssets, objects, controller.melee, terrainData, {
  collider: controller.objectCollider,
  onDestroy: (_hit, target) => { boxPhysics?.remove(target.id); pickups?.onBoxDestroyed(target); },
  hitSound: (_hit, target) => audio.play3D("crate_hit", target.position),
  destructionSound: (hit, target) => {
    if (isFallingTree(worldSession.objectData.assets.get(target.record.assetId))) return audio.play3D("tree_fall", target.position);
    if (!target.config.destroyedAnimation) return controller.combatOptions.destructionSound?.(hit, target);
  },
  onError: message => { objectWarnings.hidden = false; objectWarnings.textContent = message; },
}) : null;
destructibles?.syncTargets(controller.body.position);
// Embedders can dispatch this event to restart destruction state without
// touching the loaded world file. Reloading the game also starts fresh.
window.addEventListener("maxworld:reset-session", () => {
  destructibles?.resetSession(); boxPhysics?.reset(); pickups?.resetSession();
  controller.triggers?.resetSession(); spiders?.resetSession(); encounters?.restore(null);
  titleSequence?.resetSession();
});
window.addEventListener("keydown", event => {
  if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "l" && !event.target.closest?.("input, textarea, select, [contenteditable='true']")) objects.diagnostics = !objects.diagnostics;
});
for (const material of [terrain.material, rockSurfaceShell.material, water.material, water.waterfall.material, water.waterfall.effectsMaterial]) environment.bindMaterial(material);
const clock = new THREE.Clock();
let skipGameplayFrame = true;
const presentation = controller.physics ? new MenuPresentation(controller, camera) : null;
const playerSettings = new PlayerSettings({ apply: value => {
  if (renderer.getPixelRatio() !== value.renderScale) { renderer.setPixelRatio(value.renderScale); resize(); }
  if (grass.settings.enabled !== value.grass || grass.settings.flowersEnabled !== value.flowers) {
    grass.configure({ enabled: value.grass, flowersEnabled: value.flowers });
  }
  for (const channel of ["master", "music", "ambient", "sfx"]) if (audio.getVolume(channel) !== value[channel]) audio.setVolume(channel, value[channel]);
} });
const playerSession = controller.physics ? new PlayerSession({ runtime: controller, pickups, boxes: boxPhysics, destructibles, environment }) : null;
const saves = playerSession ? new PlayerSaves({ worldKey: worldSaveKey(worldSession), worldId: worldSession.worldId,
  validate: state => playerSession.validate(state), prepare: state => playerSession.compatibleState(state),
  matchesLegacy: state => playerSession.matchesLegacy(state) }) : null;
const menus = playerSession ? new MenuController({ session: playerSession, saves, settings: playerSettings, audio, presentation,
  onTransition: () => { clock.getDelta(); skipGameplayFrame = true; },
}) : null;
const gameplaySystems = { menus, boxes: boxPhysics, pickups, runtime: controller, destructibles, enemies: spiders, combatTarget: combatTestTarget, environment, ambient: ambientAudio };
if (titleSequence) titleSequence.isGameplayActive = () => !menus || menus.playing;
if (menus && runtimeOptions.has("menuDebug")) window.maxWorldMenuDebug = {
  menus, session: playerSession, audio, music: audio5, camera, presentation, environment, water, grass, renderer,
};

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
  presentation?.resize(camera.aspect);
  titleSequence?.resize(camera.aspect);
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
      `Boxes ${boxPhysics.stats.active} falling · ${boxPhysics.stats.sleeping} sleeping · ${boxPhysics.stats.triangleTests} triangle tests`,
      `Support ${controller.body.groundObject?.name ?? "none"}${controller.physics.stats.waitingForColliders ? " · loading nearby collision" : ""}`,
      "Left stick tilt: walk/run · A jump · X claw",
      "Right stick look (WASD/Shift/Space/arrows/F claw)",
    ] : []),
    ...(cameraDebug ? [
      `Camera auto-follow ${controller.smartCamera.autoFollowing ? "active" : "idle"} · distance ${controller.smartCamera.distance.toFixed(2)}m`,
      `Camera queries ${controller.smartCamera.collision.stats.queries} · triangle tests ${controller.smartCamera.collision.stats.triangleTests}${controller.smartCamera.collision.stats.waitingForColliders ? " · loading collision" : ""}`,
      `Camera collision ${controller.smartCamera.settings.collisionEnabled ? "on" : "off"}${controller.smartCamera.collisionLimited ? " · close obstruction" : ""}`,
    ] : []),
    renderStatsLabel(info),
    `Terrain ${terrain.stats.triangles.toLocaleString("en-US")} tris · ${terrain.stats.patches} patches (${terrain.stats.culledPatches} culled)`,
    `Terrain LOD ${lods}`,
    `Rock ${rockStats.submittedChunks}/${rockStats.chunks} chunks · ${(rockStats.submittedTriangles / 1000).toFixed(0)}k/${(rockStats.triangles / 1000).toFixed(0)}k tris submitted/resident`,
    `Rock LOD0 ${rockStats.visibleLod0} / LOD1 ${rockStats.visibleLod1} / morph ${rockStats.transitioning} · CPU ${rockStats.lodUpdateMs.toFixed(3)} ms · buffers ${(rockStats.geometryBytes / 1048576).toFixed(1)} MiB · queued ${rockStats.pendingLods}`,
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
  menus?.update(now, delta);
  audio.updateMusicElement();
  const gameDelta = skipGameplayFrame ? 0 : updateGameplay(gameplaySystems, rawDelta);
  skipGameplayFrame = false;
  const renderCamera = menus?.showingScene ? presentation.camera : titleSequence?.active ? titleSequence.camera : camera;
  if (audio.camera !== renderCamera) audio.setCamera(renderCamera);
  physicsDebug?.update();
  cameraDebug?.update();
  movementDebug?.update(now);
  water.update(gameDelta, renderCamera);
  objects.update(renderCamera, gameDelta);
  if (rockSurfaceShell.update()) terrain.setExperimentalRockMask(rockSurfaceShell.getSourceMask());
  terrain.update(renderCamera);
  heightCache.update(renderCamera.position.x, renderCamera.position.z, terrain.getVisibleSourceTileKeys());
  materialCache.update(renderCamera.position.x, renderCamera.position.z, terrain.getVisibleSourceTileKeys());
  rockSurfaceShell.syncCoverage();
  rockSurfaceShell.updateLod(renderCamera, delta);
  terrain.syncHeightCacheUniforms();
  grass.update(renderCamera, gameDelta);
  renderWorldFrame(renderer, environment, scene, renderCamera);
  updateStats(now, rawDelta);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
window.addEventListener("pagehide", event => { if (!event.persisted) { menus?.dispose(); titleSequence?.dispose(); gameHud?.dispose(); ambientAudio.dispose(); detachAudioControls(); audio.dispose(); audioDiagnostics?.dispose(); encounters?.dispose(); spiders?.dispose(); destructibles?.dispose(); boxPhysics?.dispose(); pickups?.dispose(); combatTestTarget?.dispose(); physicsDebug?.dispose(); cameraDebug?.dispose(); movementDebug?.dispose(); controller.dispose?.(); grass.dispose(); objects.dispose(); objectAssets.dispose(); } });
