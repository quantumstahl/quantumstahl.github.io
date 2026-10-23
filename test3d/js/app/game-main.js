import * as THREE from "three";
import { ThreeApp } from "../engine/ThreeApp.js";
import { AssetManager } from "../engine/AssetManager.js";
import { MapLoader } from "../engine/MapLoader.js";
import { Input } from "../engine/Input.js";
import { PlayerController } from "../game/PlayerController.js";
import { HorsePatrolController } from "../game/HorsePatrolController.js";
import { TouchJoystick } from "../game/TouchJoystick.js";
import { CatAdventure } from "../../CatAdventure.js";

const isMobile = {Android: function() { return navigator.userAgent.match(/Android/i); },BlackBerry: function() { return navigator.userAgent.match(/BlackBerry/i); },iOS: function() { return navigator.userAgent.match(/iPhone|iPod/i); },Opera: function() { return navigator.userAgent.match(/Opera Mini/i); },Windows: function() { return navigator.userAgent.match(/IEMobile/i) || navigator.userAgent.match(/WPDesktop/i); },any: function() {return (isMobile.Android() ||isMobile.BlackBerry() ||isMobile.iOS() ||isMobile.Opera() ||isMobile.Windows() ||(navigator.userAgent.toLowerCase().indexOf('macintosh') > -1 &&navigator.maxTouchPoints &&navigator.maxTouchPoints > 1));}};

// Installed PWAs can usually lock immediately. In browser tabs, the same API
// normally requires the first player interaction and fullscreen permission.
async function lockLandscape({ allowFullscreen = false } = {}) {
    if (!isMobile.any() || typeof screen.orientation?.lock !== "function") return false;
    try {
        await screen.orientation.lock("landscape");
        return true;
    } catch (_) {
        if (!allowFullscreen || document.fullscreenElement || !document.documentElement.requestFullscreen) return false;
    }

    try {
        await document.documentElement.requestFullscreen();
        await screen.orientation.lock("landscape");
        return true;
    } catch (_) {
        return false;
    }
}

void lockLandscape();
window.addEventListener("pointerdown", () => { void lockLandscape({ allowFullscreen: true }); }, { once: true, passive: true });

const installPrompt = document.querySelector("#installPrompt");
const installInstructions = document.querySelector("#installPromptInstructions");
const installDismissKey = "nextworld-install-prompt-dismissed";
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isLandscape = window.matchMedia("(orientation: landscape)");

function updateInstallPrompt() {
    if (!installPrompt || !installInstructions) return;
    const shouldShow = !isStandalone() && isLandscape.matches && !sessionStorage.getItem(installDismissKey) && (isIOS || isAndroid);
    installPrompt.hidden = !shouldShow;
    if (!shouldShow) return;

    installInstructions.textContent = isIOS
        ? "In Safari, tap Share, choose Add to Home Screen, turn on Open as Web App, then tap Add."
        : "In Chrome, tap the three-dot menu, then choose Install app or Add to Home screen.";
}

document.querySelector(".install-prompt__close")?.addEventListener("click", () => {
    sessionStorage.setItem(installDismissKey, "true");
    updateInstallPrompt();
});
isLandscape.addEventListener("change", updateInstallPrompt);
window.addEventListener("pageshow", updateInstallPrompt);
updateInstallPrompt();

var song= 'sounds/TheGoldenYarn.mp3';          
var audio = new Audio(song);
audio.loop = true;
const context = new (window.AudioContext || window.webkitAudioContext)();
const audio2 = url => {
    let source = null;
    let stopRequested = false;
    let finishPlayback = null;
    const finished = new Promise((resolve, reject) => {
        finishPlayback = resolve;
        fetch(url)
            .then(res => res.arrayBuffer())
            .then(buffer => context.decodeAudioData(buffer))
            .then(audioBuffer => {
                if (stopRequested) return resolve();
                source = context.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(context.destination);
                source.onended = resolve;
                source.start();
            })
            .catch(reject);
    });
    finished.stop = () => {
        stopRequested = true;
        if (source) source.stop();
        else finishPlayback?.();
    };
    return finished;
};
window.song=song;
window.audio=audio;
window.audio2=audio2;

document.addEventListener('click', (event) => {
    try{if(audio.paused){ audio.play();}}catch(error){};
    if(context.state === 'suspended'){context.suspend();context.resume();} 

});
document.addEventListener("touchstart" , function(e) {
    e.preventDefault();
    try{if(audio.paused){ audio.play();}}catch(error){};
    if(context.state === 'suspended'){context.suspend();context.resume();}           
});
document.addEventListener("visibilitychange", event => {
    if (document.visibilityState === "visible") {
        audio.pause();
        audio.src = song;
        audio.play();
        context.resume();
    }
    else {audio.pause(); audio.src = "";context.suspend();}
});
window.addEventListener("keydown", e => {
        try{if(audio.paused){ audio.play();}}catch(error){};
        if(context.state === 'suspended'){context.suspend();context.resume();} 
    
});





const app = new ThreeApp(document.querySelector("#gameCanvas"),isMobile.any());
// Keep the base sky and fog identical to the editor. Sky captures this
// background when it is created, while the fog remains visible on terrain.
app.scene.background = new THREE.Color(0x8fb3d9);
app.scene.fog = new THREE.Fog(0x8fb3d9, 90, 190);
app.scene.fog.near = 215;
app.scene.fog.far = 225;
app.addDefaultLighting();
app.camera.position.set(12, 10, 16); app.camera.lookAt(0, 0, 0);

const mapLoader = new MapLoader({ scene: app.scene, assets: new AssetManager() });
const input = new Input(app.canvas);
const joystick = new TouchJoystick();
app.performanceInfo.setObjectCountProvider(() => mapLoader.objects.length);
const status = document.querySelector("#status");
try {
  await mapLoader.load("maps/world.json");
  restoreSavedCameraView(app.camera, mapLoader.world.editor?.camera);
  status.textContent = `${mapLoader.world.name} loaded`;
} catch (error) {
  console.error(error); status.textContent = "Could not load maps/world.json";
}

app.beforeRender = (renderer, camera) => mapLoader.sky.renderToTexture(renderer, camera);
const player = new PlayerController({ mapLoader, input, camera: app.camera, joystick, initialCameraView: mapLoader.world.editor?.camera });
const horsePatrol = new HorsePatrolController({ mapLoader });
const hasPlayer = player.attach();
const hasHorsePatrol = horsePatrol.attach();
const catAdventure = new CatAdventure({ playerController: player, input });
if (hasPlayer) status.textContent = "Use WASD, arrow keys, or the mobile joystick to move the cat";
else if (hasHorsePatrol) status.textContent = "Horse patrol active between the two Box markers";
else status.textContent = "No cat player or horse patrol markers found in this map";
app.start(delta => {
  app.performanceInfo.measure("Gameplay", () => catAdventure.update(delta));
  app.performanceInfo.measure("Player", () => player.update(delta));
  app.performanceInfo.measure("Horse patrol", () => horsePatrol.update(delta));
  app.performanceInfo.measure("World", () => mapLoader.update(delta, app.camera));
  app.performanceInfo.measure("Input", () => input.endFrame());
});

// Wait until the render loop has had a frame to draw before revealing the game.
const loadingScreen = document.querySelector("#loadingScreen");
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#000000");
  loadingScreen?.classList.add("is-hidden");
}));

function restoreSavedCameraView(camera, state) {
  const target = state?.target;
  const values = [target?.x, target?.y, target?.z, state?.yaw, state?.pitch, state?.distance];
  if (!values.every(Number.isFinite)) return false;
  const pitch = THREE.MathUtils.clamp(state.pitch, -.2, Math.PI / 2 - .05);
  const distance = THREE.MathUtils.clamp(state.distance, 2, 120);
  const horizontal = Math.cos(pitch) * distance;
  camera.position.set(target.x + Math.sin(state.yaw) * horizontal, target.y + Math.sin(pitch) * distance, target.z + Math.cos(state.yaw) * horizontal);
  camera.lookAt(target.x, target.y, target.z);
  return true;
}
