import * as THREE from "three";
import { PerformanceInfo } from "./PerformanceInfo.js";

export class ThreeApp {
  constructor(canvas, { shadows = true } = {}) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, .1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -40; sun.shadow.camera.right = sun.shadow.camera.top = 40;
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
      const delta = Math.min(this.clock.getDelta(), 1 / 20);
      update(delta);
      this.beforeRender?.(this.renderer, this.camera);
      this.renderer.render(this.scene, this.camera);
      this.performanceInfo.update(delta);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
