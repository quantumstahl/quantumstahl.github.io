import * as THREE from "three";
import { PerformanceInfo } from "./PerformanceInfo.js";

export class ThreeApp {
  constructor(canvas, mobileProfile) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, .1, 1000);
    window.mobileProfile = mobileProfile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // A 2x mobile screen costs four times as many fragments. Preserve a sharp
    // enough image while avoiding an unnecessarily expensive full resolution.
    this.targetFPS = 60;
    this.minRenderScale = 0.5;
    this.maxRenderScale = 1;
    this.renderScale = this.maxRenderScale;
    // Assess sustained performance and leave time for a new render scale to
    // settle before considering another change.
    this.dynamicResolution = {
      elapsed: 0,
      frames: 0,
      cooldown: 0,
      sampleSeconds: 1,
      cooldownSeconds: 1,
      step: 0.1
    };
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.mobileProfile ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    this.performanceInfo = new PerformanceInfo(this.renderer);
    this.clock = new THREE.Clock();
    this.running = false;

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }
  addDefaultLighting() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(15, 40, 200); sun.castShadow = true;
    const shadowSize = this.mobileProfile ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.camera.left = sun.shadow.camera.bottom = -40; sun.shadow.camera.right = sun.shadow.camera.top = 40;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.04;

    this.scene.add(sun);

    

  }
  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const safeWidth = Math.max(1, width), safeHeight = Math.max(1, height);
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.camera.aspect = safeWidth / safeHeight; this.camera.updateProjectionMatrix();
  }
  updateDynamicResolution(rawDelta) {
    // Ignore a suspended-tab hitch: it should not lower resolution after the
    // game becomes visible again.
    if (rawDelta <= 0) return;
    if (rawDelta > 0.25) {
      this.dynamicResolution.elapsed = 0;
      this.dynamicResolution.frames = 0;
      return;
    }
    const controller = this.dynamicResolution;
    controller.elapsed += rawDelta;
    controller.frames++;
    controller.cooldown = Math.max(0, controller.cooldown - rawDelta);
    if (controller.elapsed < controller.sampleSeconds || controller.cooldown > 0) return;

    const fps = controller.frames / controller.elapsed;
    controller.elapsed = 0;
    controller.frames = 0;
    let nextScale = this.renderScale;
    // Leave a small dead zone below the target to prevent oscillation.
    if (fps < this.targetFPS - 2) nextScale = Math.max(this.minRenderScale, this.renderScale - controller.step);
    else if (fps > this.targetFPS + 3) nextScale = Math.min(this.maxRenderScale, this.renderScale + controller.step);
    if (nextScale === this.renderScale) return;

    this.renderScale = Number(nextScale.toFixed(2));
    // WebGLRenderer.setPixelRatio() internally reapplies its current size.
    // Calling resize() afterwards reallocates the drawing buffer a second
    // time, which briefly clears the canvas and appears as a screen blink.
    this.renderer.setPixelRatio(this.renderScale);
    controller.cooldown = controller.cooldownSeconds;
  }
  start(update) {
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      const rawDelta = this.clock.getDelta();
      // Keep simulation stable after a tab-switch hitch, but report actual
      // frame timing so short stalls are reflected in the FPS readout.
      const delta = Math.min(rawDelta, 1 / 20);
      this.updateDynamicResolution(rawDelta);
      this.performanceInfo.beginFrame(rawDelta);
      this.performanceInfo.measure("Update", () => update(delta));
      this.performanceInfo.beginGpuTimer("Sky");
      this.performanceInfo.measure("Sky capture", () => this.beforeRender?.(this.renderer, this.camera));
      this.performanceInfo.endGpuTimer();
      this.performanceInfo.beginGpuTimer("Scene");
      this.performanceInfo.measure("Render", () => this.renderer.render(this.scene, this.camera));
      this.performanceInfo.endGpuTimer();
      this.performanceInfo.endFrame(rawDelta);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
