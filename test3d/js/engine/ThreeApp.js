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
    this.renderer.setPixelRatio(1);
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
    // HemisphereLight takes sky colour, ground colour, then intensity.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1b2534, 1.5));
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
  start(update) {
    this.running = true;
    const frame = () => {
      if (!this.running) return;
      const rawDelta = this.clock.getDelta();
      // Keep simulation stable after a tab-switch hitch, but report actual
      // frame timing so short stalls are reflected in the FPS readout.
      const delta = Math.min(rawDelta, 1 / 20);
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
