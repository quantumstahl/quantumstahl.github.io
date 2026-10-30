import { TouchJoystick } from "./TouchJoystick.js";

// Gameplay only. Pointer handlers fill persistent input state; they never run physics.
export class TouchControls {
  static supported() {
    return navigator.maxTouchPoints > 0 && (window.matchMedia("(any-pointer: coarse)").matches
      || /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel");
  }
  constructor(canvas) {
    this.enabled = false; this.disposed = false; this.landscape = null;
    this.jumpDown = false; this.clawDown = false;
    this.jumpPressed = false; this.clawPressed = false;
    this.jumpId = null; this.clawId = null; this.cameraId = null;
    this.lookX = 0; this.lookY = 0;
    this.root = document.createElement("div"); this.root.className = "touch-controls"; this.root.hidden = true;
    this.root.innerHTML = `<div class="touch-actions">
      <button type="button" class="touch-action touch-action--claw" data-action="claw" aria-label="Claw">
        <svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="43" rx="17" ry="13"/><ellipse cx="12" cy="27" rx="7" ry="10" transform="rotate(-25 12 27)"/><ellipse cx="25" cy="15" rx="7" ry="10"/><ellipse cx="41" cy="15" rx="7" ry="10"/><ellipse cx="54" cy="27" rx="7" ry="10" transform="rotate(25 54 27)"/></svg>
        <span>Claw</span>
      </button>
      <button type="button" class="touch-action" data-action="jump" aria-label="Jump"><span class="touch-jump-icon" aria-hidden="true">↑</span><span>Jump</span></button>
    </div>`;
    this.joystick = new TouchJoystick(this.root);
    this.jumpButton = this.root.querySelector('[data-action="jump"]');
    this.clawButton = this.root.querySelector('[data-action="claw"]');
    document.body.append(this.root);
    this.canvas = canvas;
    this.down = event => this.begin(event);
    this.move = event => this.drag(event);
    this.up = event => this.end(event);
    this.cancel = event => this.end(event, true);
    this.preventMenu = event => event.preventDefault();
    // Safari can still recognize double-tap zoom despite touch-action: none.
    // Cancel native touch gestures too; pointer events continue to own game input.
    this.preventTouchGesture = event => {
      if (this.enabled && event.cancelable) event.preventDefault();
    };
    for (const target of [this.root, canvas]) {
      target.addEventListener("touchstart", this.preventTouchGesture, { passive: false });
      target.addEventListener("touchend", this.preventTouchGesture, { passive: false });
      target.addEventListener("pointerdown", this.down);
      target.addEventListener("pointermove", this.move);
      target.addEventListener("pointerup", this.up);
      target.addEventListener("pointercancel", this.cancel);
      target.addEventListener("lostpointercapture", this.cancel);
      target.addEventListener("contextmenu", this.preventMenu);
    }
    this.resize = () => { if (this.enabled) { this.reset(); this.updateLayout(); } };
    this.rotate = () => { this.landscape = null; this.resize(); };
    window.addEventListener("resize", this.resize);
    window.addEventListener("orientationchange", this.rotate);
    window.visualViewport?.addEventListener("resize", this.resize);
  }
  updateLayout() {
    const landscape = window.innerWidth > window.innerHeight;
    if (this.landscape === null || this.landscape !== landscape) this.joystick.placeDefault();
    else this.joystick.refreshBounds();
    this.landscape = landscape;
  }
  setEnabled(enabled) {
    if (this.disposed || enabled === this.enabled) return;
    this.enabled = enabled;
    // Gamepad polling can detect an iOS controller mid-frame. Apply UI changes
    // after that frame, once per transition; there is no touch rendering loop.
    queueMicrotask(() => {
      if (this.disposed) return;
      this.reset();
      this.root.hidden = !this.enabled;
      if (this.enabled) this.updateLayout();
    });
  }
  begin(event) {
    if (!this.enabled || event.pointerType !== "touch") return;
    const button = event.target.closest?.("[data-action]");
    let owner;
    if (button) {
      const action = button.dataset.action;
      if (this[`${action}Id`] !== null) return;
      this[`${action}Id`] = event.pointerId;
      this[`${action}Down`] = true; this[`${action}Pressed`] = true;
      button.classList.add("is-down"); owner = button;
    } else if (this.joystick.root.contains(event.target)) {
      if (!this.joystick.begin(event)) return;
      owner = this.joystick.root;
    } else if (event.currentTarget === this.canvas && event.clientX >= window.innerWidth * .38 && this.cameraId === null) {
      this.cameraId = event.pointerId; this.cameraX = event.clientX; this.cameraY = event.clientY;
      owner = this.canvas;
    } else return;
    event.preventDefault(); owner.setPointerCapture(event.pointerId);
  }
  drag(event) {
    if (!this.enabled || event.pointerType !== "touch") return;
    if (event.pointerId === this.joystick.pointerId) this.joystick.move(event);
    else if (event.pointerId === this.cameraId) {
      this.lookX += (event.clientX - this.cameraX) * .005;
      this.lookY += (event.clientY - this.cameraY) * .005;
      this.cameraX = event.clientX; this.cameraY = event.clientY;
    } else return;
    event.preventDefault();
  }
  end(event, cancelled = false) {
    const id = event.pointerId;
    if (id === this.joystick.pointerId) this.joystick.reset();
    else if (id === this.cameraId) { this.cameraId = null; if (cancelled) this.lookX = this.lookY = 0; }
    else if (id === this.jumpId) {
      this.jumpId = null; this.jumpDown = false; this.jumpButton.classList.remove("is-down");
      if (cancelled) this.jumpPressed = false;
    } else if (id === this.clawId) {
      this.clawId = null; this.clawDown = false; this.clawButton.classList.remove("is-down");
      if (cancelled) this.clawPressed = false;
    } else return;
    // Clear ownership before releasing: lostpointercapture may fire synchronously.
    if (event.target.hasPointerCapture?.(id)) event.target.releasePointerCapture(id);
  }
  reset() {
    const joystickId = this.joystick.pointerId, jumpId = this.jumpId, clawId = this.clawId, cameraId = this.cameraId;
    this.joystick.reset(); this.jumpId = this.clawId = this.cameraId = null;
    this.jumpDown = this.clawDown = this.jumpPressed = this.clawPressed = false;
    this.lookX = this.lookY = 0;
    this.jumpButton.classList.remove("is-down"); this.clawButton.classList.remove("is-down");
    this.release(this.joystick.root, joystickId); this.release(this.jumpButton, jumpId);
    this.release(this.clawButton, clawId); this.release(this.canvas, cameraId);
  }
  release(target, id) { if (id !== null && target.hasPointerCapture(id)) target.releasePointerCapture(id); }
  endFrame() { this.lookX = this.lookY = 0; this.jumpPressed = this.clawPressed = false; }
  dispose() {
    this.reset(); this.disposed = true;
    for (const target of [this.root, this.canvas]) {
      target.removeEventListener("touchstart", this.preventTouchGesture);
      target.removeEventListener("touchend", this.preventTouchGesture);
      target.removeEventListener("pointerdown", this.down); target.removeEventListener("pointermove", this.move);
      target.removeEventListener("pointerup", this.up); target.removeEventListener("pointercancel", this.cancel);
      target.removeEventListener("lostpointercapture", this.cancel); target.removeEventListener("contextmenu", this.preventMenu);
    }
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("orientationchange", this.rotate);
    window.visualViewport?.removeEventListener("resize", this.resize);
    this.root.remove();
  }
}
