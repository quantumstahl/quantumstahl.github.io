import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PhysicsWorld } from "../physics/PhysicsWorld.js";
import { TerrainCollider } from "../physics/TerrainCollider.js";
import { RockCollider } from "../physics/RockCollider.js";
import { ObjectCollider } from "../physics/ObjectCollider.js";
import { GameplayInput } from "./GameplayInput.js";

// Preserve the tuned capsule dimensions. Position is now the centered foot
// datum; horizontal offsets tied to the old GLB origin no longer apply.
export const CAT_CHARACTER_DEFAULTS = Object.freeze({
  capsuleAxis: "horizontal", radius: .33, length: 1.0, height: .82,
  groundClearance: .16, offsetX: 0, offsetZ: 0,
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
      // Keep skin vertices, bone locals and inverse binds intact. A parent
      // translates the entire animated hierarchy to a stable foot pivot.
      runtime.visual = new THREE.Group(); runtime.visual.name = "Cat visual alignment";
      runtime.visual.add(runtime.model);
      runtime.mixer = new THREE.AnimationMixer(runtime.model);
      const clip = animations.find(clip => clip.name === options.mapObject?.properties.clip)
        ?? animations.find(clip => clip.name === "Animation 1") ?? animations[0];
      if (clip) {
        runtime.action = runtime.mixer.clipAction(clip); runtime.action.play();
        runtime.mixer.update(0); runtime.action.paused = true;
      }
      // Measure once in the initial pose, after the existing instance scale,
      // while detached from world placement/yaw. Never follow animated bounds.
      runtime.visual.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(runtime.visual, true);
      runtime.visualAnchor = new THREE.Vector3();
      if (!bounds.isEmpty()) {
        bounds.getCenter(runtime.visualAnchor); runtime.visualAnchor.y = bounds.min.y;
      }
      runtime.visual.position.copy(runtime.visualAnchor).negate();
      runtime.root.add(runtime.visual);
      if (options.mapObject) {
        // Map positions refer to the authored GLB origin. Rebase only this
        // runtime body's foot datum so taking control does not move the model.
        const position = new THREE.Vector3().fromArray(options.mapObject.position)
          .add(runtime.visualAnchor.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), runtime.body.yaw));
        runtime.body.teleport(position.x, position.y, position.z, runtime.body.yaw);
      }
      runtime.syncVisual(1, 0);
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
    this.yaw = this.body.yaw; this.pitch = .3;
    this.input = new GameplayInput();
    this.keys = this.input.keys; this.viewPosition = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.syncVisual(1, 0);
  }
  get gamepadConnected() { return this.input.gamepadConnected; }
  attachObjects(data, library, options = {}) {
    if (this.objectCollider) { this.physics.removeCollider(this.objectCollider); this.objectCollider.dispose(); }
    const excludeIds = new Set(options.excludeIds ?? []);
    if (this.controlledObjectId) excludeIds.add(this.controlledObjectId);
    return this.objectCollider = this.physics.addCollider(new ObjectCollider(data, library, { ...options, excludeIds }));
  }
  update(delta) {
    const input = this.input;
    input.update();
    const inputDelta = Math.max(0, Math.min(delta, .1));
    this.yaw -= input.lookX * 2.5 * inputDelta + input.dragX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.lookY * 1.5 * inputDelta + input.dragY, -.1, 1.2);
    const x = input.moveX, z = input.moveZ;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.body.setMovement(x * cos + z * sin, z * cos - x * sin, input.running);
    if (this.body.intent.lengthSq() > .01) this.body.setYaw(Math.atan2(-this.body.intent.x, -this.body.intent.z));
    if (input.jump.pressed) this.body.jump();
    // Combat can consume input.claw.{down,pressed,released}; no combat exists yet.
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
    this.input.dispose();
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
