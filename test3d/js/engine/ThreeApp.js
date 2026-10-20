import * as THREE from "three";
import { PerformanceInfo } from "./PerformanceInfo.js";

export class ThreeApp {
  constructor(canvas, mobileProfile) {
    this.canvas = canvas;
    this.mobileProfile = Boolean(mobileProfile);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, .1, 1000);
    window.mobileProfile = this.mobileProfile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // A 2x mobile screen costs four times as many fragments. Preserve a sharp
    // enough image while avoiding an unnecessarily expensive full resolution.
    this.targetFPS = 60;
    this.renderer.setPixelRatio(1.0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.performanceInfo = new PerformanceInfo(this.renderer);
    this.scene.userData.performanceInfo = this.performanceInfo;
    this.clock = new THREE.Clock();
    this.running = false;

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }
  addDefaultLighting() {
    // HemisphereLight takes sky colour, ground colour, then intensity.

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(18,28,16); sun.castShadow = true;
    // Layer 1 is reserved for shadow-only proxy meshes. The gameplay camera
    // remains on layer 0, while this shadow camera renders both layers.
    sun.shadow.camera.layers.enable(1);
    const shadowSize = this.mobileProfile ? 2048  : 4096;
    sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.camera.left = sun.shadow.camera.bottom = -80; sun.shadow.camera.right = sun.shadow.camera.top = 80;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    // A positive bias avoids terrain self-shadowing; EnvironmentSystem raises
    // normalBias further only while the sun is near the horizon.
    sun.shadow.bias = 0.0005;
    sun.shadow.normalBias = 0.06;
    this.scene.add(new THREE.HemisphereLight(0xe9f5ff,0x24382b,2.0));

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
