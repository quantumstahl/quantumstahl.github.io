import * as THREE from "three";

export class FlyCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = -0.24;
    this.speed = 240;
    this.lookSpeed = 2.5;
    this.deadzone = 0.16;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.gamepad = null;
    this.resetWasDown = false;
    this.reset();
  }

  reset() {
    this.camera.position.set(0, 280, 520);
    this.yaw = Math.PI;
    this.pitch = -0.33;
    this.applyRotation();
  }

  applyRotation() { this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ"); }

  getGamepad() {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return null;
    for (let index = 0; index < gamepads.length; index += 1) {
      if (gamepads[index]?.connected) return gamepads[index];
    }
    return null;
  }

  axis(gamepad, index) {
    const value = gamepad?.axes[index] ?? 0;
    if (Math.abs(value) <= this.deadzone) return 0;
    return (value - Math.sign(value) * this.deadzone) / (1 - this.deadzone);
  }

  button(gamepad, index) { return Boolean(gamepad?.buttons[index]?.pressed); }

  get gamepadConnected() { return this.gamepad !== null; }

  update(delta) {
    this.gamepad = this.getGamepad();
    const gamepad = this.gamepad;
    const lookX = this.axis(gamepad, 2);
    const lookY = this.axis(gamepad, 3);
    this.yaw -= lookX * this.lookSpeed * delta;
    this.pitch = THREE.MathUtils.clamp(this.pitch - lookY * this.lookSpeed * delta, -1.48, 1.48);

    const resetDown = this.button(gamepad, 9);
    if (resetDown && !this.resetWasDown) this.reset();
    this.resetWasDown = resetDown;
    this.applyRotation();
    this.move.set(this.axis(gamepad, 0), 0, this.axis(gamepad, 1));
    if (this.button(gamepad, 5)) this.move.y += 1;
    if (this.button(gamepad, 4)) this.move.y -= 1;
    if (this.move.lengthSq() === 0) return;
    this.move.normalize();
    this.forward.set(0, 0, -1).applyEuler(this.camera.rotation);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    const speed = this.speed * (this.button(gamepad, 7) ? 4 : 1) * delta;
    this.camera.position.addScaledVector(this.forward, -this.move.z * speed);
    this.camera.position.addScaledVector(this.right, this.move.x * speed);
    this.camera.position.y += this.move.y * speed;
  }
}
