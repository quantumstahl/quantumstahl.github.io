import * as THREE from "three";
import { ThreeApp } from "../engine/ThreeApp.js";
import { AssetManager } from "../engine/AssetManager.js";
import { MapLoader } from "../engine/MapLoader.js";
import { Input } from "../engine/Input.js";
import { PlayerController } from "../game/PlayerController.js";

const app = new ThreeApp(document.querySelector("#gameCanvas"));
// Keep the base sky and fog identical to the editor. Sky captures this
// background when it is created, while the fog remains visible on terrain.
app.scene.background = new THREE.Color(0x8fb3d9);
app.scene.fog = new THREE.Fog(0x8fb3d9, 90, 190);
app.addDefaultLighting();
app.camera.position.set(12, 10, 16); app.camera.lookAt(0, 0, 0);

const mapLoader = new MapLoader({ scene: app.scene, assets: new AssetManager() });
const input = new Input(app.canvas);
app.performanceInfo.setObjectCountProvider(() => mapLoader.objects.length);
const status = document.querySelector("#status");
try {
  await mapLoader.load("maps/world.json");
  status.textContent = `${mapLoader.world.name} loaded`;
} catch (error) {
  console.error(error); status.textContent = "Could not load maps/world.json";
}
app.beforeRender = (renderer, camera) => mapLoader.sky.renderToTexture(renderer, camera);
const player = new PlayerController({ mapLoader, input, camera: app.camera });
if (player.attach()) status.textContent = "WASD or arrow keys to move the cat";
else status.textContent = "No cat player found in this map";
app.start(delta => { player.update(delta); mapLoader.update(delta, app.camera); input.endFrame(); });
