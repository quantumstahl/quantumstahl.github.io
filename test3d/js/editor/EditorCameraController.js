import * as THREE from "three";

export class EditorCameraController {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = -0.55;
    this.speed = 180;
    this.lookSpeed = 0.003;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.move = new THREE.Vector3();
    camera.position.set(0, 520, 800);
    this.applyRotation();
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener("keydown", event => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest?.("input, textarea, select, [contenteditable='true']")) this.keys.add(event.code);
    });
    window.addEventListener("keyup", event => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());
    this.canvas.addEventListener("pointerdown", event => {
      if (event.button !== 2 && event.button !== 1) return;
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", event => {
      if (!this.dragging) return;
      this.yaw -= (event.clientX - this.lastX) * this.lookSpeed;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.lastY) * this.lookSpeed, -1.48, 1.48);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });
    const stopDrag = event => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    };
    this.canvas.addEventListener("pointerup", stopDrag);
    this.canvas.addEventListener("pointercancel", stopDrag);
  }

  applyRotation() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  update(delta) {
    this.applyRotation();
    this.move.set(0, 0, 0);
    if (this.keys.has("KeyW")) this.move.z -= 1;
    if (this.keys.has("KeyS")) this.move.z += 1;
    if (this.keys.has("KeyA")) this.move.x -= 1;
    if (this.keys.has("KeyD")) this.move.x += 1;
    if (this.keys.has("KeyE")) this.move.y += 1;
    if (this.keys.has("KeyQ")) this.move.y -= 1;
    if (this.move.lengthSq() === 0) return;
    this.move.normalize();
    this.forward.set(0, 0, -1).applyEuler(this.camera.rotation);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.camera.up).normalize();
    const speed = this.speed * (this.keys.has("ShiftLeft") ? 4 : 1) * delta;
    this.camera.position.addScaledVector(this.forward, -this.move.z * speed);
    this.camera.position.addScaledVector(this.right, this.move.x * speed);
    this.camera.position.y += this.move.y * speed;
  }
}
