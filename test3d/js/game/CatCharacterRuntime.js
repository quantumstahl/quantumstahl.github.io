import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PhysicsWorld } from "../physics/PhysicsWorld.js";
import { TerrainCollider } from "../physics/TerrainCollider.js";
import { RockCollider } from "../physics/RockCollider.js";
import { ObjectCollider } from "../physics/ObjectCollider.js";

// Manually tuned at the existing 0.2 visual scale. Preserve these dimensions
// and offsets when extending collision providers; they are not derived per frame.
export const CAT_CHARACTER_DEFAULTS = Object.freeze({
  capsuleAxis: "horizontal", radius: .33, length: 1.0, height: .82,
  groundClearance: .16, offsetX: -.18, offsetZ: .20,
});

// Small game-facing adapter. Physics never reads animation, GLB bounds or camera.
export class CatCharacterRuntime {
  static async create(scene, camera, provider, options = {}) {
    const runtime = new CatCharacterRuntime(scene, camera, provider, options);
    try {
      let animations;
      if (options.mapObject) {
        runtime.modelLease = await options.assetLibrary.acquireLOD(options.mapObject.assetId, 0);
        const source = runtime.modelLease.source;
        if (!source) throw new Error("The map cat's GLB is unavailable. Reimport its asset in the editor.");
        runtime.sharedVisual = true;
        runtime.model = options.assetLibrary.clone(source); animations = source.animations;
        runtime.model.scale.multiply(new THREE.Vector3().fromArray(options.mapObject.scale));
      } else {
        const gltf = await new GLTFLoader().loadAsync(options.modelURL ?? new URL("../../assets/cat.glb", import.meta.url).href);
        runtime.model = gltf.scene; animations = gltf.animations;
        runtime.model.scale.setScalar(options.visualScale ?? .2);
      }
      runtime.model.userData.mapObject = runtime.object;
      runtime.root.add(runtime.model);
      runtime.mixer = new THREE.AnimationMixer(runtime.model);
      const clip = animations.find(clip => clip.name === options.mapObject?.properties.clip)
        ?? animations.find(clip => clip.name === "Animation 1") ?? animations[0];
      if (clip) {
        runtime.action = runtime.mixer.clipAction(clip); runtime.action.play();
        runtime.mixer.update(0); runtime.action.paused = true;
      }
      return runtime;
    } catch (error) { runtime.dispose(); throw error; }
  }
  constructor(scene, camera, provider, { character = {}, spawn = null, spawnXZ = [0, 0], mapObject = null } = {}) {
    this.camera = camera; camera.near = .1; camera.updateProjectionMatrix();
    this.physics = new PhysicsWorld(); this.rockCollider = new RockCollider(provider);
    this.terrainCollider = this.physics.addCollider(new TerrainCollider(provider, { rock: this.rockCollider }));
    this.physics.addCollider(this.rockCollider);
    this.object = mapObject ?? { id: "cat-player", name: "cat" };
    this.controlledObjectId = mapObject?.id ?? null;
    this.body = this.physics.createCharacter(this.object, { ...CAT_CHARACTER_DEFAULTS, ...character });
    if (mapObject) this.body.teleport(...mapObject.position, mapObject.rotation[1]);
    else if (spawn) this.body.teleport(...spawn);
    else {
      const [x, z] = spawnXZ;
      const surface = this.terrainCollider.findSpawnSurface(x, z, { y: 0, normal: new THREE.Vector3() }, this.body.config.maxSlopeAngle, this.physics);
      this.body.teleport(x, surface ? surface.y + .5 + this.body.config.radius * (1 / surface.normal.y - 1) : 4, z);
    }
    this.root = new THREE.Group(); this.root.name = "Cat character"; this.root.userData.mapObject = this.object; scene.add(this.root);
    if (mapObject) this.root.userData.objectId = mapObject.id;
    this.yaw = this.body.yaw; this.pitch = .3; this.gamepad = null; this.jumpWasDown = false;
    this.keys = new Set(); this.viewPosition = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.keyDown = event => {
      if (event.target?.closest?.("input,textarea,select,[contenteditable='true']")) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
    };
    this.keyUp = event => this.keys.delete(event.code);
    this.blur = () => { this.keys.clear(); this.body.setMovement(0, 0); this.jumpWasDown = false; };
    window.addEventListener("keydown", this.keyDown); window.addEventListener("keyup", this.keyUp); window.addEventListener("blur", this.blur);
    this.syncVisual(1, 0);
  }
  get gamepadConnected() { return this.gamepad !== null; }
  attachObjects(data, library, options = {}) {
    if (this.objectCollider) { this.physics.removeCollider(this.objectCollider); this.objectCollider.dispose(); }
    const excludeIds = new Set(options.excludeIds ?? []);
    if (this.controlledObjectId) excludeIds.add(this.controlledObjectId);
    return this.objectCollider = this.physics.addCollider(new ObjectCollider(data, library, { ...options, excludeIds }));
  }
  axis(index) {
    const value = this.gamepad?.axes[index] ?? 0, deadzone = .16;
    return Math.abs(value) <= deadzone ? 0 : (value - Math.sign(value) * deadzone) / (1 - deadzone);
  }
  button(index) { return Boolean(this.gamepad?.buttons[index]?.pressed); }
  update(delta) {
    this.gamepad = null;
    const pads = navigator.getGamepads?.();
    if (pads) for (let i = 0; i < pads.length; i++) if (pads[i]?.connected) { this.gamepad = pads[i]; break; }
    const inputDelta = Math.max(0, Math.min(delta, .1));
    const lookX = this.axis(2) + Number(this.keys.has("ArrowRight")) - Number(this.keys.has("ArrowLeft"));
    const lookY = this.axis(3) + Number(this.keys.has("ArrowDown")) - Number(this.keys.has("ArrowUp"));
    this.yaw -= lookX * 2.5 * inputDelta; this.pitch = THREE.MathUtils.clamp(this.pitch + lookY * 1.5 * inputDelta, -.1, 1.2);
    const x = this.axis(0) + Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
    const z = this.axis(1) + Number(this.keys.has("KeyS")) - Number(this.keys.has("KeyW"));
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.body.setMovement(x * cos + z * sin, z * cos - x * sin, this.button(7) || this.button(10) || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"));
    if (this.body.intent.lengthSq() > .01) this.body.setYaw(Math.atan2(-this.body.intent.x, -this.body.intent.z));
    const jumpDown = this.button(0) || this.keys.has("Space");
    if (jumpDown && !this.jumpWasDown) this.body.jump(); this.jumpWasDown = jumpDown;
    this.physics.update(delta);
    this.syncVisual(this.physics.alpha, inputDelta);
  }
  syncVisual(alpha, delta) {
    const body = this.body;
    this.viewPosition.lerpVectors(body.previousPosition, body.position, alpha);
    this.root.position.copy(this.viewPosition);
    this.root.rotation.y = body.previousYaw + (body.yaw - body.previousYaw) * alpha;
    if (this.action) {
      // Keep the valid animated pose applied during idle/jump/fall.
      this.action.paused = !body.grounded || body.intent.lengthSq() < .01;
      this.action.timeScale = body.running ? 1.7 : 1;
      this.mixer.update(delta);
    }
    this.target.copy(this.viewPosition); this.target.y += .8;
    const distance = 5, horizontal = Math.cos(this.pitch) * distance;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * distance + .7, this.target.z + Math.cos(this.yaw) * horizontal);
    this.camera.lookAt(this.target);
  }
  dispose() {
    window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp); window.removeEventListener("blur", this.blur);
    this.mixer?.stopAllAction(); if (this.model) this.mixer?.uncacheRoot(this.model);
    this.root.traverse(node => {
      if (this.sharedVisual) { node.skeleton?.dispose(); return; }
      node.geometry?.dispose();
      const materials = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
    });
    this.modelLease?.release();
    this.root.removeFromParent(); this.physics.dispose();
  }
}
