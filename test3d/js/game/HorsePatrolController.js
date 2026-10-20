import * as THREE from "three";

// A map-authored horse that uses the first two Box helpers as patrol markers.
// Marker boxes stay invisible in play mode; only their saved positions matter.
export class HorsePatrolController {
  constructor({ mapLoader, speed = 2.4 }) {
    this.mapLoader = mapLoader;
    this.speed = speed;
    this.horse = null;
    this.points = [];
    this.targetIndex = 0;
    this.direction = new THREE.Vector3();
  }
  attach() {
    const boxType = this.mapLoader.world.layers
      .flatMap(layer => layer.assetTypes)
      .find(type => type.shape === "box" || String(type.id).toLowerCase() === "box");
    if (!boxType || boxType.instances.length < 2) return false;

    this.points = boxType.instances.slice(0, 2).map(marker => new THREE.Vector3(marker.position.x, marker.position.y, marker.position.z));
    this.horse = this.mapLoader.objects.find(object => {
      const type = object.userData.assetType;
      return String(type?.id ?? "").toLowerCase() === "horse" || String(type?.name ?? "").toLowerCase() === "horse";
    }) ?? null;
    if (!this.horse) return false;

    this.groundOffset = this.horse.position.y - this.mapLoader.terrain.getHeightAt(this.horse.position);
    this.targetIndex = this.horse.position.distanceToSquared(this.points[0]) <= this.horse.position.distanceToSquared(this.points[1]) ? 0 : 1;
    let animations = this.horse.userData.animations ?? [];
    this.horse.traverse(node => { if (!animations.length && node.userData.animations?.length) animations = node.userData.animations; });
    const clip = THREE.AnimationClip.findByName(animations, "Animation 1") ?? animations[0];
    if (clip) {
      this.mixer = new THREE.AnimationMixer(this.horse);
      this.walkAction = this.mixer.clipAction(clip);
      this.walkAction.setLoop(THREE.LoopRepeat, Infinity);
      this.walkAction.play();
    }
    return true;
  }
  update(delta) {
    if (!this.horse || this.points.length < 2) return;
    const target = this.points[this.targetIndex];
    this.direction.subVectors(target, this.horse.position);
    this.direction.y = 0;
    const remaining = this.direction.length();
    const step = this.speed * delta;
    if (remaining <= step || remaining < .05) {
      this.horse.position.x = target.x;
      this.horse.position.z = target.z;
      this.targetIndex = (this.targetIndex + 1) % this.points.length;
    } else {
      this.direction.multiplyScalar(1 / remaining);
      this.horse.position.addScaledVector(this.direction, step);
      // MaxPaint's horse assets use +Z as their forward axis, while the
      // world controller's default heading convention faces -Z.
      const heading = Math.atan2(-this.direction.x, -this.direction.z) + Math.PI;
      this.horse.rotation.y = THREE.MathUtils.lerp(this.horse.rotation.y, heading, 1 - Math.exp(-10 * delta));
    }
    this.horse.position.y = this.mapLoader.terrain.getHeightAt(this.horse.position) + this.groundOffset;
    this.mixer?.update(delta);
  }
}
