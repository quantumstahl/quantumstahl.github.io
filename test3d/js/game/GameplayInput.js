// Shared gameplay actions. No Three.js, DOM rendering or physics in the frame path.
export class GameplayInput {
  constructor({ clawKey = "KeyF", clawButton = 2 } = {}) {
    this.clawKey = clawKey; this.clawButton = clawButton;
    this.keys = new Set(); this.gamepad = null; this.gamepadConnected = false;
    this.lastSeen = -Infinity; this.padIndex = null; this.touch = null;
    this.moveX = this.moveZ = this.lookX = this.lookY = this.dragX = this.dragY = 0; this.running = false;
    this.cameraHeld = this.movementHeld = false;
    this.movementPointerId = null;
    this.jump = { down: false, pressed: false, released: false };
    this.claw = { down: false, pressed: false, released: false };
    this.keyClawPressed = false;
    this.padJump = this.padClaw = false;
    this.suspended = false;
    this.keyDown = event => {
      if (event.target?.closest?.("input,textarea,select,[contenteditable='true']")) return;
      if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
      if (event.code === this.clawKey && !event.repeat && !this.keys.has(event.code)) this.keyClawPressed = true;
      this.keys.add(event.code);
    };
    this.keyUp = event => this.keys.delete(event.code);
    this.connected = event => { this.gamepad = event.gamepad; this.padIndex = event.gamepad.index; this.lastSeen = performance.now(); this.setConnected(true); };
    this.disconnected = event => {
      if (event.gamepad.index !== this.padIndex) return;
      this.gamepad = null; this.lastSeen = -Infinity; this.padIndex = null; this.padJump = this.padClaw = false;
      this.poll(performance.now(), event.gamepad.index);
    };
    this.blur = () => { this.suspended = true; this.reset(); };
    this.focus = () => { this.suspended = false; };
    this.visibility = () => { if (document.hidden) this.blur(); else this.focus(); };
    window.addEventListener("keydown", this.keyDown); window.addEventListener("keyup", this.keyUp);
    window.addEventListener("gamepadconnected", this.connected); window.addEventListener("gamepaddisconnected", this.disconnected);
    window.addEventListener("blur", this.blur); window.addEventListener("focus", this.focus);
    window.addEventListener("pagehide", this.blur); window.addEventListener("pageshow", this.focus);
    globalThis.document?.addEventListener("visibilitychange", this.visibility);
  }
  attachTouch(touch) { this.touch = touch; this.poll(); touch.setEnabled(!this.gamepadConnected); }
  setConnected(connected) {
    if (this.gamepadConnected === connected) return;
    this.gamepadConnected = connected;
    this.touch?.setEnabled(!connected);
  }
  poll(now = performance.now(), disconnectedIndex = null) {
    let found = null;
    try {
      const pads = navigator.getGamepads?.();
      if (pads) for (let i = 0; i < pads.length; i++) if (pads[i]?.connected && pads[i].index !== disconnectedIndex) { found = pads[i]; break; }
    } catch { /* Safari may restrict access until the first controller interaction. */ }
    this.gamepad = found;
    if (found) { this.lastSeen = now; this.padIndex = found.index; this.setConnected(true); }
    else if (now - this.lastSeen >= 1500) {
      this.padIndex = null; this.padJump = this.padClaw = false; this.setConnected(false);
    }
  }
  axis(index) {
    const value = this.gamepad?.axes[index] ?? 0, deadzone = .16;
    return Math.abs(value) <= deadzone ? 0 : (value - Math.sign(value) * deadzone) / (1 - deadzone);
  }
  button(index) { return Boolean(this.gamepad?.buttons[index]?.pressed); }
  action(state, down, pressed) {
    state.pressed = (!state.down && down) || pressed;
    state.released = (state.down || state.pressed) && !down; state.down = down;
  }
  update() {
    this.poll();
    if (this.suspended) return;
    const keys = this.keys, touch = this.touch?.enabled ? this.touch : null;
    const vector = touch?.joystick.getVector();
    const padX = this.axis(0), padZ = this.axis(1);
    this.moveX = padX + Number(keys.has("KeyD")) - Number(keys.has("KeyA")) + (vector?.x ?? 0);
    this.moveZ = padZ + Number(keys.has("KeyS")) - Number(keys.has("KeyW")) - (vector?.y ?? 0);
    // A captured joystick remains the same gesture while crossing its center
    // or deadzone. Zero/weak output is not a finger release. Other controls
    // retain their reference for any nonzero processed movement input.
    this.movementPointerId = touch?.joystick.pointerId ?? null;
    this.movementHeld = this.movementPointerId !== null || this.moveX !== 0 || this.moveZ !== 0;
    // Both sticks use run speed scaled by analog magnitude (0..6 m/s).
    // Light deflection walks; full deflection runs without a gamepad modifier.
    this.running = padX !== 0 || padZ !== 0 || (vector?.power ?? 0) > 0 || keys.has("ShiftLeft") || keys.has("ShiftRight");
    this.lookX = this.axis(2) + Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
    this.lookY = this.axis(3) + Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
    this.dragX = touch?.lookX ?? 0; this.dragY = touch?.lookY ?? 0;
    this.cameraHeld = touch?.cameraId != null;
    // Keep held action edges across a brief missing gamepad sample, but never
    // retain stale movement or camera axes. Disconnect releases the actions.
    if (this.gamepad) { this.padJump = this.button(0); this.padClaw = this.button(this.clawButton); }
    this.action(this.jump, this.padJump || keys.has("Space") || !!touch?.jumpDown, !!touch?.jumpPressed);
    this.action(this.claw, this.padClaw || keys.has(this.clawKey) || !!touch?.clawDown,
      !!touch?.clawPressed || this.keyClawPressed);
    this.keyClawPressed = false;
    touch?.endFrame();
  }
  reset() {
    this.keys.clear(); this.touch?.reset();
    this.moveX = this.moveZ = this.lookX = this.lookY = this.dragX = this.dragY = 0;
    this.running = false; this.padJump = this.padClaw = false;
    this.keyClawPressed = false;
    this.cameraHeld = this.movementHeld = false;
    this.movementPointerId = null;
    this.jump.down = this.jump.pressed = this.jump.released = false;
    this.claw.down = this.claw.pressed = this.claw.released = false;
  }
  dispose() {
    this.reset(); this.touch?.dispose();
    window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("gamepadconnected", this.connected); window.removeEventListener("gamepaddisconnected", this.disconnected);
    window.removeEventListener("blur", this.blur); window.removeEventListener("focus", this.focus);
    window.removeEventListener("pagehide", this.blur); window.removeEventListener("pageshow", this.focus);
    globalThis.document?.removeEventListener("visibilitychange", this.visibility);
  }
}
