import * as THREE from "three";

// Runtime-only control for the cat map instance. Map transforms remain the
// spawn point; movement is intentionally not written back into the editor map.
export class PlayerController {
  constructor({ mapLoader, input, camera, joystick = null }) {
    this.mapLoader = mapLoader; this.input = input; this.camera = camera; this.joystick = joystick; this.player = null;
    this.speed = 4.2; this.cameraYaw = Math.PI; this.cameraDistance = 6; this.cameraHeight = 3; this.groundOffset = 0; this.targetPlayerHeight = 0;
    this.cameraForward = new THREE.Vector3(); this.cameraRight = new THREE.Vector3(); this.move = new THREE.Vector3(); this.cameraTarget = new THREE.Vector3(); this.desiredCameraTarget = new THREE.Vector3(); this.cameraPosition = new THREE.Vector3();
  }
  attach() {
    this.player = this.mapLoader.objects.find(object => {
      const type = object.userData.assetType;
      return String(type?.id ?? "").toLowerCase() === "cat" || String(type?.name ?? "").toLowerCase() === "cat";
    }) ?? null;
    if (!this.player) return false;
    this.groundOffset = this.player.position.y - this.mapLoader.terrain.getHeightAt(this.player.position);
    this.targetPlayerHeight = this.player.position.y;
    this.cameraYaw = this.player.rotation.y;
    let animations = this.player.userData.animations ?? [];
    this.player.traverse(node => { if (!animations.length && node.userData.animations?.length) animations = node.userData.animations; });
    const clip = THREE.AnimationClip.findByName(animations, "Animation 1") ?? animations[0];
    if (clip) { this.mixer = new THREE.AnimationMixer(this.player); this.walkAction = this.mixer.clipAction(clip); this.walkAction.setLoop(THREE.LoopRepeat, Infinity); this.walkAction.reset().play(); this.walkAction.paused = true; this.mixer.update(0); }
    this.snapCameraToPlayer();
    return true;
  }
  update(delta) {
    if (!this.player) return;
    const stick = this.joystick?.getVector() ?? { x: 0, y: 0, power: 0 };
    const x = THREE.MathUtils.clamp((this.input.down("d") || this.input.down("arrowright") ? 1 : 0) - (this.input.down("a") || this.input.down("arrowleft") ? 1 : 0) + stick.x, -1, 1);
    const z = THREE.MathUtils.clamp((this.input.down("w") || this.input.down("arrowup") ? 1 : 0) - (this.input.down("s") || this.input.down("arrowdown") ? 1 : 0) + stick.y, -1, 1);
    const moving = Boolean(x || z);
    if (moving) {
      this.camera.getWorldDirection(this.cameraForward); this.cameraForward.y = 0; this.cameraForward.normalize();
      this.cameraRight.crossVectors(this.cameraForward, THREE.Object3D.DEFAULT_UP).normalize();
      this.move.copy(this.cameraRight).multiplyScalar(x).addScaledVector(this.cameraForward, z).normalize();
      this.player.position.addScaledVector(this.move, this.speed * Math.min(1, Math.hypot(x, z)) * delta);
      const targetHeading = Math.atan2(-this.move.x, -this.move.z);
      this.player.rotation.y = this.lerpAngle(this.player.rotation.y, targetHeading, 1 - Math.exp(-11 * delta));
    }
    this.setWalkAnimation(moving); this.mixer?.update(delta);
    this.targetPlayerHeight = this.mapLoader.terrain.getHeightAt(this.player.position) + this.groundOffset;
    // Terrain sampling is discrete at the mesh resolution. Smooth just the
    // vertical response so the character glides over those sample changes.
    this.player.position.y = THREE.MathUtils.lerp(
      this.player.position.y,
      this.targetPlayerHeight,
      1 - Math.exp(-5 * delta)
    );
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
  lerpAngle(from, to, amount) { let difference = to - from; while (difference > Math.PI) difference -= Math.PI * 2; while (difference < -Math.PI) difference += Math.PI * 2; return from + difference * amount; }
  setWalkAnimation(moving) { if (!this.walkAction || this.walkAction.paused === !moving) return; this.walkAction.enabled = true; this.walkAction.paused = !moving; if (moving) this.walkAction.setEffectiveWeight(1).play(); }
  snapCameraToPlayer() { if (!this.player) return; this.cameraTarget.copy(this.player.position).add(new THREE.Vector3(0, 1.15, 0)); this.desiredCameraTarget.copy(this.cameraTarget); this.camera.position.set(this.cameraTarget.x + Math.sin(this.cameraYaw) * this.cameraDistance, this.cameraTarget.y + this.cameraHeight, this.cameraTarget.z + Math.cos(this.cameraYaw) * this.cameraDistance); this.camera.lookAt(this.cameraTarget); }
}
