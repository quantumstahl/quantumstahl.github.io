import * as THREE from "three";
import { PerformanceInfo } from "./PerformanceInfo.js";

export class ThreeApp {
  constructor(canvas, { shadows = true, mobileProfile = false } = {}) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, .1, 1000);
    this.mobileProfile = mobileProfile && window.matchMedia?.("(pointer: coarse)").matches;
    this.renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance',canvas, antialias: true });
    // A 2x mobile screen costs four times as many fragments. Preserve a sharp
    // enough image while avoiding an unnecessarily expensive full resolution.
     this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobileProfile ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = this.mobileProfile ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    this.performanceInfo = new PerformanceInfo(this.renderer);
    this.clock = new THREE.Clock();
    this.running = false;
    this.animationFramHandle;
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.targetFPS=60;
    this.lolo=0;
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

  setframerate(mobile){
    if(mobile)this.targetFPS=60;


  }

start(editor) {
    if(editor){ requestAnimationFrame((t) => this.editorLoop(t));}
    else{ requestAnimationFrame((t) => this.gameLoop(t));}
   
}
    gameLoop(time) {
        if(this.lolo===0){

            if (!this.lastTime) this.lastTime = time;
            let deltaMs = time - this.lastTime;
            this.lastTime = time;
            if (deltaMs > 50) deltaMs = 50;
            const scale = deltaMs / (1000 );

            player.update(scale);
            mapLoader.update(scale, this.camera);
            this.beforeRender?.(this.renderer, this.camera);
            this.renderer.render(this.scene, this.camera);
            this.performanceInfo.endFrame(scale);
            if(this.targetFPS<60)this.lolo=1;
        }else if(this.lolo===1) this.lolo=0;

        requestAnimationFrame((t) => this.gameLoop(t));
    }
    editorLoop(time) {
        if(this.lolo===0){

            if (!this.lastTime) this.lastTime = time;
            let deltaMs = time - this.lastTime;
            this.lastTime = time;
            //if (deltaMs > 50) deltaMs = 50;
            const scale = deltaMs / (1000 );

            editor.update(scale);
            mapLoader.update(scale, this.camera);
            this.beforeRender?.(this.renderer, this.camera)
            this.renderer.render(this.scene, this.camera)
            this.performanceInfo.endFrame(scale);
            if(this.targetFPS<60)this.lolo=1;
        }else if(this.lolo===1) this.lolo=0;

        requestAnimationFrame((t) => this.editorLoop(t));
    }
}
