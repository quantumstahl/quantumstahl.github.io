import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { PhysicsWorld } from "../physics/PhysicsWorld.js";
import { TerrainCollider } from "../physics/TerrainCollider.js";
import { RockCollider } from "../physics/RockCollider.js";
import { ObjectCollider } from "../physics/ObjectCollider.js";
import { GameplayInput } from "./GameplayInput.js";
import { ThirdPersonCamera, angleDifference } from "./ThirdPersonCamera.js";
import { NextWorldCamera } from "./NextWorldCamera.js";
import { CatAnimationController, CLAW_CLIP_NAMES, compatibleCatClips, catClipsNeedRefresh } from "./CatAnimationController.js";
import { ClawCombo } from "./ClawCombo.js";
import { MeleeHitSystem } from "./MeleeHitSystem.js";
import { CombatFeedback } from "./CombatFeedback.js";

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
        if (catClipsNeedRefresh(animations)) {
          const reference = await new GLTFLoader().loadAsync(new URL("../../assets/cat.glb", import.meta.url).href);
          animations = compatibleCatClips(runtime.model, reference.scene, animations, reference.animations);
          reference.scene.traverse(node => {
            node.skeleton?.dispose(); node.geometry?.dispose();
            for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
              for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
              material.dispose();
            }
          });
        }
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
      runtime.initializeAnimations(animations);
      runtime.mixer.update(0);
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
      runtime.smartCamera.initialized = false;
      runtime.syncVisual(1, 0);
      return runtime;
    } catch (error) { runtime.dispose(); throw error; }
  }
  constructor(scene, camera, provider, { character = {}, cameraMode = "nextworld", cameraSettings = {}, spawn = null, spawnXZ = [0, 0], mapObject = null, combat = {}, input = {} } = {}) {
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
    const CameraController = cameraMode === "smart" ? ThirdPersonCamera : NextWorldCamera;
    this.smartCamera = new CameraController(camera, this.physics, { yaw: this.body.yaw, ...cameraSettings });
    this.input = new GameplayInput(input);
    this.combatOptions = combat;
    this.feedback = new CombatFeedback(scene);
    this.melee = new MeleeHitSystem(this.object, { hitSound: combat.hitSound, onHit: (hit, target) => {
      this.feedback.hit(hit); combat.onHit?.(hit, target);
    } });
    this.keys = this.input.keys; this.viewPosition = new THREE.Vector3(); this.target = this.smartCamera.target;
    this.syncVisual(1, 0);
  }
  get gamepadConnected() { return this.input.gamepadConnected; }
  get yaw() { return this.smartCamera.yaw; }
  set yaw(value) { this.smartCamera.yaw = value; }
  get pitch() { return this.smartCamera.pitch; }
  set pitch(value) { this.smartCamera.pitch = value; }
  initializeAnimations(animations) {
    this.mixer = new THREE.AnimationMixer(this.model);
    const locomotion = animations.filter(clip => !CLAW_CLIP_NAMES.includes(clip.name));
    const clip = locomotion.find(clip => clip.name === this.object.properties?.clip)
      ?? locomotion.find(clip => clip.name === "Animation 1") ?? locomotion[0];
    this.animation = new CatAnimationController(this.mixer, animations, clip, this.combatOptions);
    this.action = this.animation.locomotion;
    this.animation.setLocomotion(this.body);
    this.combat = new ClawCombo(this.animation, this.melee, this.body, this.combatOptions);
    if (!this.animation.available) console.warn("Cat claw combat requires compatible Animation 2, Animation 3 and Animation 4 clips.");
  }
  attachObjects(data, library, options = {}) {
    if (this.objectCollider) { this.physics.removeCollider(this.objectCollider); this.objectCollider.dispose(); }
    const excludeIds = new Set(options.excludeIds ?? []);
    if (this.controlledObjectId) excludeIds.add(this.controlledObjectId);
    return this.objectCollider = this.physics.addCollider(new ObjectCollider(data, library, { ...options, excludeIds }));
  }
  update(delta) {
    const input = this.input;
    input.update();
    const inputDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
    this.smartCamera.applyInput(input, inputDelta);
    const x = input.moveX, z = input.moveZ;
    const movementYaw = this.smartCamera.movementYaw ?? this.yaw;
    const sin = Math.sin(movementYaw), cos = Math.cos(movementYaw);
    this.body.setMovement(x * cos + z * sin, z * cos - x * sin, input.running);
    if (this.body.intent.lengthSq() > .01) this.body.setYaw(Math.atan2(-this.body.intent.x, -this.body.intent.z));
    if (input.jump.pressed) this.body.jump();
    this.physics.update(delta);
    this.syncVisual(this.physics.alpha, inputDelta, input.claw.pressed);
  }
  syncVisual(alpha, delta, clawPressed = false) {
    const body = this.body;
    alpha = THREE.MathUtils.clamp(alpha, 0, 1);
    this.viewPosition.lerpVectors(body.previousPosition, body.position, alpha);
    this.root.position.copy(this.viewPosition);
    this.root.rotation.y = body.previousYaw + angleDifference(body.yaw, body.previousYaw) * alpha;
    this.feedback.update(delta);
    if (this.animation) {
      this.animation.setLocomotion(body);
      this.combat.update(delta, clawPressed);
    }
    this.smartCamera.update(this.viewPosition, body, this.input, delta);
  }
  dispose() {
    this.input.dispose();
    this.melee.dispose(); this.feedback.dispose();
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
