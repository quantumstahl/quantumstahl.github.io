import * as THREE from "three";

export class EditorCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.yaw = .6; this.pitch = .5; this.distance = 14;
    this.updateCamera();
  }
  update(input, delta) {
    if (input.pointer.secondaryDown) {
      this.yaw -= input.pointer.dx * .005;
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.pointer.dy * .005, -.2, Math.PI / 2 - .05);
    }
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + input.pointer.wheel * .0015), 2, 120);
    const speed = delta * 9 * (input.down("shift") ? 3 : 1) * Math.max(.5, this.distance / 14);
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    if (input.down("w")) this.target.addScaledVector(forward, -speed);
    if (input.down("s")) this.target.addScaledVector(forward, speed);
    if (input.down("a")) this.target.addScaledVector(right, -speed);
    if (input.down("d")) this.target.addScaledVector(right, speed);
    this.updateCamera();
  }
  updateCamera() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * horizontal, this.target.y + Math.sin(this.pitch) * this.distance, this.target.z + Math.cos(this.yaw) * horizontal);
    this.camera.lookAt(this.target);
  }
}
