// Port of NextWorld/js/game/TouchJoystick.js: the same semi-floating base,
// radial clamping and red thumb pad, using captured pointers instead of touch lists.
export class TouchJoystick {
  constructor(parent) {
    this.vector = { x: 0, y: 0, power: 0 };
    this.rawX = this.rawZ = 0;
    this.radius = 32;
    this.pointerId = null;
    this.centerX = this.centerY = 0;
    this.root = document.createElement("div"); this.root.className = "mobile-joystick";
    this.base = document.createElement("div"); this.base.className = "mobile-joystick__base";
    this.knob = document.createElement("div"); this.knob.className = "mobile-joystick__knob";
    this.base.append(this.knob); this.root.append(this.base); parent.append(this.root);
  }
  // Read layout on activation/resize/pointerdown, never on movement or in update().
  refreshBounds() {
    const rect = this.root.getBoundingClientRect();
    this.originX = rect.left; this.bottom = rect.bottom;
    this.minX = rect.left + this.radius + 12;
    this.maxX = Math.max(this.minX, rect.right - this.radius - 12);
    this.minY = rect.top + this.radius + 12;
    this.maxY = Math.max(this.minY, rect.bottom - this.radius - 16);
  }
  placeDefault() {
    this.refreshBounds();
    this.centerX = this.minX + 10;
    this.centerY = this.maxY - 10;
    // CSS anchors the resting base to its region, so late iOS viewport/safe-area
    // changes cannot strand it at the old portrait screen coordinates.
    this.base.style.left = ""; this.base.style.top = "";
  }
  placeBase() {
    this.base.style.left = `${this.centerX - this.originX}px`;
    // Keep the last base location anchored from the bottom as the viewport
    // settles, even when iOS delivers rotation/resize events before layout.
    this.base.style.top = `calc(100% - ${this.bottom - this.centerY}px)`;
  }
  begin(event) {
    if (this.pointerId !== null) return false;
    // Refresh once per gesture in case rotation settled after its resize event.
    this.refreshBounds();
    this.pointerId = event.pointerId;
    this.centerX = Math.max(this.minX, Math.min(event.clientX, this.maxX));
    this.centerY = Math.max(this.minY, Math.min(event.clientY, this.maxY));
    this.placeBase(); this.move(event);
    return true;
  }
  move(event) {
    if (event.pointerId !== this.pointerId) return;
    const dx = event.clientX - this.centerX, dy = event.clientY - this.centerY;
    const distance = Math.hypot(dx, dy), amount = Math.min(1, distance / this.radius);
    const x = distance ? dx / distance * amount : 0, y = distance ? -dy / distance * amount : 0;
    // Diagnostic values before radial deadzone/rescaling, in gameplay X/Z.
    this.rawX = x; this.rawZ = -y;
    // Radial deadzone, rescaled so full deflection still reaches exactly 1.
    const power = Math.max(0, (amount - .14) / .86);
    this.vector.x = amount ? x / amount * power : 0;
    this.vector.y = amount ? y / amount * power : 0;
    this.vector.power = power;
    // Only a compositor transform changes while dragging. No transitions or layout.
    this.knob.style.transform = `translate3d(calc(-50% + ${x * this.radius}px), calc(-50% + ${-y * this.radius}px), 0)`;
  }
  reset() {
    this.pointerId = null; this.vector.x = 0; this.vector.y = 0; this.vector.power = 0;
    this.rawX = this.rawZ = 0;
    // Releasing/cancelling input centers only the knob, preserving the base.
    this.knob.style.transform = "translate3d(-50%, -50%, 0)";
  }
  getVector() { return this.vector; }
}
