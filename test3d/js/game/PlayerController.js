import * as THREE from "three";
import { CollisionSystem } from "./CollisionSystem.js";

// Runtime-only control for the cat map instance. Map transforms remain the
// spawn point; movement is intentionally not written back into the editor map.
export class PlayerController {
  constructor({ mapLoader, input, camera, joystick = null, initialCameraView = null }) {
    this.mapLoader = mapLoader; this.input = input; this.camera = camera; this.joystick = joystick; this.player = null;
    this.initialCameraView = initialCameraView;
    this.speed = 10.2; this.cameraYaw = Math.PI; this.cameraDistance = 10; this.cameraHeight = 3; this.groundOffset = 0; this.targetPlayerHeight = 0; this.collisionRadius = .05; this.playerBottomOffset = 0; this.playerHeight = 1; this.verticalOffset = 0; this.airborne = false; this.airborneWorldHeight = null; this.jumpStartGroundHeight = null;
    // Uphill movement follows the rock threshold; descent allows much steeper
    // ramps, but still treats near-vertical Rockify faces as solid cliffs.
    this.maxWalkableSlope = THREE.MathUtils.degToRad(40);
    this.maxDescendingSlope = THREE.MathUtils.degToRad(80);
    this.maxJumpStepHeight = 1.3;
    this.collisions = new CollisionSystem({ mapLoader });
     this.cameraForward = new THREE.Vector3(); this.cameraRight = new THREE.Vector3(); this.move = new THREE.Vector3(); this.previousPosition = new THREE.Vector3(); this.cameraTarget = new THREE.Vector3(); this.desiredCameraTarget = new THREE.Vector3(); this.cameraPosition = new THREE.Vector3();
  }
  attach() {
    this.player = this.mapLoader.objects.find(object => {
      const type = object.userData.assetType;
      return String(type?.id ?? "").toLowerCase() === "cat" || String(type?.name ?? "").toLowerCase() === "cat";
    }) ?? null;
    if (!this.player) return false;
    // The cat is authored in a streamed map chunk, but becomes a persistent
    // runtime player once control begins. Its source chunk may unload later.
    this.mapLoader.playerObject = this.player;
    // Movement uses the model origin, so reserve enough room for the visible
    // body as well as the origin when it meets a cliff wall.
    this.player.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(this.player);
    this.collisionRadius = Math.max(.60, (bounds.max.x - bounds.min.x) * .5, (bounds.max.z - bounds.min.z) * .5) + .06;
    this.playerBottomOffset = this.player.position.y - bounds.min.y;
    this.playerHeight = Math.max(.1, bounds.max.y - bounds.min.y);
    // Spawns are authored against the terrain heightfield. Keep that stable;
    // rendered-surface grounding is used only once movement begins so a
    // nearby Rockify overhang cannot change the cat's initial base offset.
    this.groundOffset = this.player.position.y - this.mapLoader.terrain.getHeightAt(this.player.position);
    this.targetPlayerHeight = this.player.position.y;
    this.cameraYaw = this.player.rotation.y;
    let animations = this.player.userData.animations ?? [];
    this.player.traverse(node => { if (!animations.length && node.userData.animations?.length) animations = node.userData.animations; });
    const clip = THREE.AnimationClip.findByName(animations, "Animation 1") ?? animations[0];
    if (clip) { this.mixer = new THREE.AnimationMixer(this.player); this.walkAction = this.mixer.clipAction(clip); this.walkAction.setLoop(THREE.LoopRepeat, Infinity); this.walkAction.reset().play(); this.walkAction.paused = true; this.mixer.update(0); }
    this.showingInitialView = this.applyInitialCameraView();
    if (!this.showingInitialView) this.snapCameraToPlayer();
    return true;
  }
  update(delta) {
    if (!this.player) return;
    const stick = this.joystick?.getVector() ?? { x: 0, y: 0, power: 0 };
    const x = THREE.MathUtils.clamp((this.input.down("d") || this.input.down("arrowright") ? 1 : 0) - (this.input.down("a") || this.input.down("arrowleft") ? 1 : 0) + stick.x, -1, 1);
    const z = THREE.MathUtils.clamp((this.input.down("w") || this.input.down("arrowup") ? 1 : 0) - (this.input.down("s") || this.input.down("arrowdown") ? 1 : 0) + stick.y, -1, 1);
    const moving = Boolean(x || z);
    // Keep the authored editor view on screen until the player begins moving.
    // That lets index.html open with exactly the composition saved in the editor.
    if (this.showingInitialView && !moving && !this.airborne) {
      this.setWalkAnimation(false); this.mixer?.update(delta);
      this.mapLoader.grass.setTramplePosition(this.player.position);
      return;
    }
    this.showingInitialView = false;
    if (moving) {
      this.camera.getWorldDirection(this.cameraForward); this.cameraForward.y = 0; this.cameraForward.normalize();
      this.cameraRight.crossVectors(this.cameraForward, THREE.Object3D.DEFAULT_UP).normalize();
      this.move.copy(this.cameraRight).multiplyScalar(x).addScaledVector(this.cameraForward, z).normalize();
      this.previousPosition.copy(this.player.position);
      this.player.position.addScaledVector(this.move, this.speed * Math.min(1, Math.hypot(x, z)) * delta);
      this.limitUphillSlope(this.previousPosition);
      this.mapLoader.constrainToGameplayChunks(this.player.position, this.previousPosition, this.collisionRadius);
      this.collisions.resolvePlayer(this.player, this.collisionRadius, this.playerBottomOffset, this.playerHeight);
      // A prop on the map edge can push the cat outward; apply the streamed
      // world boundary once more after collision correction.
      this.mapLoader.constrainToGameplayChunks(this.player.position, this.previousPosition, this.collisionRadius);
      const targetHeading = Math.atan2(-this.move.x, -this.move.z);
      this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetHeading, 1 - Math.exp(-11 * delta));
    }
    this.setWalkAnimation(moving); this.mixer?.update(delta);
    this.targetPlayerHeight = this.getGroundHeight(this.player.position) + this.groundOffset + this.verticalOffset;
    // Terrain sampling is discrete at the mesh resolution. Smooth just the
    // vertical response so the character glides over those sample changes.
    if (this.airborne && Number.isFinite(this.airborneWorldHeight)) {
      this.player.position.y = this.airborneWorldHeight;
    } else if (this.targetPlayerHeight >= this.player.position.y) {
      // Never ease upward into a hill: that visually buries the cat's feet.
      // Camera target smoothing below still removes vertical terrain jitter.
      this.player.position.y = this.targetPlayerHeight;
    } else {
      // A small downward ease avoids a hard camera/cat pop over terrain steps.
      this.player.position.y = THREE.MathUtils.lerp(this.player.position.y, this.targetPlayerHeight, 1 - Math.exp(-10 * delta));
    }
    this.desiredCameraTarget.copy(this.player.position).add(new THREE.Vector3(0, 1.15, 0));
    // Terrain height is sampled instantly for the cat. Ease the look target's
    // vertical component instead, preventing each terrain triangle from
    // producing a visible camera bump.
    const horizontalFollow = 1 - Math.exp(-12 * delta);
    const verticalFollow = 1 - Math.exp(-4 * delta);
    this.cameraTarget.x = THREE.MathUtils.lerp(this.cameraTarget.x, this.desiredCameraTarget.x, horizontalFollow);
    this.cameraTarget.z = THREE.MathUtils.lerp(this.cameraTarget.z, this.desiredCameraTarget.z, horizontalFollow);
    this.cameraTarget.y = THREE.MathUtils.lerp(this.cameraTarget.y, this.desiredCameraTarget.y, verticalFollow);
    this.cameraYaw = this.lerpAngle(this.cameraYaw, this.player.rotation.y, 1 - Math.exp(-.7 * delta));
    this.cameraPosition.set(this.cameraTarget.x + Math.sin(this.cameraYaw) * this.cameraDistance, this.cameraTarget.y + this.cameraHeight, this.cameraTarget.z + Math.cos(this.cameraYaw) * this.cameraDistance);
    this.camera.position.lerp(this.cameraPosition, 1 - Math.exp(-7 * delta)); this.camera.lookAt(this.cameraTarget);
    this.mapLoader.grass.setTramplePosition(this.player.position);
  }
  limitUphillSlope(previousPosition) {
    const terrain = this.mapLoader.terrain;
    const deltaX = this.player.position.x - previousPosition.x;
    const deltaZ = this.player.position.z - previousPosition.z;
    const distance = Math.hypot(deltaX, deltaZ);
    if (distance < .0001) return;
    const steps = Math.max(1, Math.ceil(distance / .2));
    const maxRise = Math.tan(this.maxWalkableSlope);
    const maxDrop = Math.tan(this.maxDescendingSlope);
    let lastX = previousPosition.x, lastZ = previousPosition.z;
    let lastHeight = this.getGroundHeight(previousPosition);
    for (let step = 1; step <= steps; step++) {
      const progress = step / steps;
      const x = THREE.MathUtils.lerp(previousPosition.x, this.player.position.x, progress);
      const z = THREE.MathUtils.lerp(previousPosition.z, this.player.position.z, progress);
      const height = this.getGroundHeight({ x, z });
      const horizontalDistance = Math.hypot(x - lastX, z - lastZ);
      const heightChange = height - lastHeight;
      const isFlatLanding = !terrain.isRockSurfaceAt?.({ x, z });
      const jumpBase = this.jumpStartGroundHeight ?? lastHeight;
      const isLowJumpLanding = this.airborne && isFlatLanding && height - jumpBase <= this.maxJumpStepHeight;
      if ((heightChange > horizontalDistance * maxRise && !isLowJumpLanding) || -heightChange > horizontalDistance * maxDrop) {
        this.player.position.x = lastX;
        this.player.position.z = lastZ;
        return;
      }
      lastX = x; lastZ = z; lastHeight = height;
    }
  }
  getGroundHeight(point) {
    // A bridge above the cat must not become its ground. Permit a small step
    // up while walking, but otherwise query only surfaces at foot level.
    const footY = this.player ? this.player.position.y - this.groundOffset + .35 : Infinity;
    return this.mapLoader.terrain.getSurfaceHeightAt?.(point, footY) ?? this.mapLoader.terrain.getHeightAt(point);
  }
  lerpAngle(from, to, amount) { let difference = to - from; while (difference > Math.PI) difference -= Math.PI * 2; while (difference < -Math.PI) difference += Math.PI * 2; return from + difference * amount; }
  setWalkAnimation(moving) { if (!this.walkAction || this.walkAction.paused === !moving) return; this.walkAction.enabled = true; this.walkAction.paused = !moving; if (moving) this.walkAction.setEffectiveWeight(1).play(); }
  applyInitialCameraView() {
    const state = this.initialCameraView, target = state?.target;
    const values = [target?.x, target?.y, target?.z, state?.yaw, state?.pitch, state?.distance];
    if (!values.every(Number.isFinite)) return false;
    const pitch = THREE.MathUtils.clamp(state.pitch, -.2, Math.PI / 2 - .05);
    const distance = THREE.MathUtils.clamp(state.distance, 2, 120);
    const horizontal = Math.cos(pitch) * distance;
    this.camera.position.set(target.x + Math.sin(state.yaw) * horizontal, target.y + Math.sin(pitch) * distance, target.z + Math.cos(state.yaw) * horizontal);
    this.camera.lookAt(target.x, target.y, target.z);
    return true;
  }
  snapCameraToPlayer() { if (!this.player) return; this.cameraTarget.copy(this.player.position).add(new THREE.Vector3(0, 1.15, 0)); this.desiredCameraTarget.copy(this.cameraTarget); this.camera.position.set(this.cameraTarget.x + Math.sin(this.cameraYaw) * this.cameraDistance, this.cameraTarget.y + this.cameraHeight, this.cameraTarget.z + Math.cos(this.cameraYaw) * this.cameraDistance); this.camera.lookAt(this.cameraTarget); }
}
