import { Vector3 } from "three";

export const MOVEMENT_TRACE_FIELDS = Object.freeze([
  "time", "rawX", "rawZ", "joystickX", "joystickZ", "pointerId", "inputPointerId", "touchEnabled",
  "inputX", "inputZ", "held", "referenceActive", "referenceYaw", "cameraYaw", "facingYaw", "visualYaw",
  "worldX", "worldZ", "intentX", "intentZ", "velocityX", "velocityZ", "viewVelocityX", "viewVelocityZ",
  "autoEnabled", "autoActive", "targetHeading", "travelHeading", "backwardTouch", "manualActive", "lookX", "dragX",
  "grounded", "positionX", "positionZ", "worldError", "viewOpposesInput", "unexpectedReferenceChanges",
  "viewYaw", "cameraDistance", "collisionHit", "physicsWaiting", "physicsSteps",
  "liveCameraReference",
]);

// Opt-in numeric ring buffer. Captures every frame without per-frame objects;
// serialization and DOM updates are separate from collection.
export class MovementTrace {
  constructor(capacity = 1800) {
    this.capacity = capacity; this.count = this.cursor = 0;
    this.data = new Float64Array(capacity * MOVEMENT_TRACE_FIELDS.length);
    this.sample = Object.fromEntries(MOVEMENT_TRACE_FIELDS.map(key => [key, 0]));
    this.forward = new Vector3(); this.previousPointer = -1; this.previousReference = NaN;
    this.unexpectedReferenceChanges = 0;
  }
  capture(runtime, now) {
    const input = runtime.input, rig = runtime.smartCamera, body = runtime.body;
    const joystick = input.touch?.joystick, v = joystick?.vector, s = this.sample;
    const reference = rig.movementYaw, yaw = reference ?? rig.yaw;
    const sin = Math.sin(yaw), cos = Math.cos(yaw), scale = Math.max(1, Math.hypot(input.moveX, input.moveZ));
    s.time = now; s.rawX = joystick?.rawX ?? 0; s.rawZ = joystick?.rawZ ?? 0;
    s.joystickX = v?.x ?? 0; s.joystickZ = -(v?.y ?? 0);
    s.pointerId = joystick?.pointerId ?? -1; s.inputPointerId = input.movementPointerId ?? -1;
    s.touchEnabled = Number(!!input.touch?.enabled); s.inputX = input.moveX; s.inputZ = input.moveZ;
    s.held = Number(input.movementHeld); s.referenceActive = Number(reference !== null);
    s.referenceYaw = reference ?? NaN; s.cameraYaw = rig.yaw; s.facingYaw = body.yaw; s.visualYaw = runtime.root.rotation.y;
    s.worldX = (input.moveX * cos + input.moveZ * sin) / scale;
    s.worldZ = (input.moveZ * cos - input.moveX * sin) / scale;
    s.intentX = body.intent.x; s.intentZ = body.intent.z;
    s.velocityX = body.velocity.x; s.velocityZ = body.velocity.z;
    runtime.camera.getWorldDirection(this.forward);
    const horizontal = Math.max(1e-10, Math.hypot(this.forward.x, this.forward.z));
    s.viewYaw = Math.atan2(-this.forward.x, -this.forward.z);
    s.viewVelocityX = (-body.velocity.x * this.forward.z + body.velocity.z * this.forward.x) / horizontal;
    s.viewVelocityZ = (-body.velocity.x * this.forward.x - body.velocity.z * this.forward.z) / horizontal;
    s.autoEnabled = Number(rig.settings.autoFollow); s.autoActive = Number(rig.autoFollowing);
    s.targetHeading = rig.heading; s.travelHeading = rig.travelHeading; s.backwardTouch = Number(rig.backwardTouch);
    s.manualActive = Number(rig.manualActive); s.lookX = input.lookX; s.dragX = input.dragX;
    s.grounded = Number(body.grounded); s.positionX = body.position.x; s.positionZ = body.position.z;
    s.cameraDistance = rig.distance; s.collisionHit = Number(rig.collision.hit);
    s.physicsWaiting = Number(runtime.physics.stats.waitingForColliders); s.physicsSteps = runtime.physics.stats.steps;
    s.liveCameraReference = Number(rig.movementReferenceMode === "view");
    s.worldError = Math.hypot(s.worldX - s.intentX, s.worldZ - s.intentZ);
    s.viewOpposesInput = Number(s.inputX * s.viewVelocityX + s.inputZ * s.viewVelocityZ < -.05);
    const referenceDelta = s.referenceYaw - this.previousReference;
    if (!s.liveCameraReference && s.pointerId >= 0 && s.pointerId === this.previousPointer && !rig.manualActive
      && (Number.isFinite(s.referenceYaw) !== Number.isFinite(this.previousReference)
        || Math.abs(Math.atan2(Math.sin(referenceDelta), Math.cos(referenceDelta))) > 1e-5)) this.unexpectedReferenceChanges++;
    s.unexpectedReferenceChanges = this.unexpectedReferenceChanges;
    this.previousPointer = s.pointerId; this.previousReference = s.referenceYaw;
    const offset = this.cursor * MOVEMENT_TRACE_FIELDS.length;
    for (let i = 0; i < MOVEMENT_TRACE_FIELDS.length; i++) this.data[offset + i] = s[MOVEMENT_TRACE_FIELDS[i]];
    this.cursor = (this.cursor + 1) % this.capacity; this.count = Math.min(this.capacity, this.count + 1);
    return s;
  }
  export(runtime) {
    const width = MOVEMENT_TRACE_FIELDS.length, samples = [];
    const start = (this.cursor - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const offset = (start + i) % this.capacity * width;
      samples.push(Array.from(this.data.subarray(offset, offset + width)));
    }
    return { version: "movement-debug-v2", cameraMode: runtime.smartCamera.mode, userAgent: globalThis.navigator?.userAgent ?? "unknown",
      settings: { ...runtime.smartCamera.settings }, columns: MOVEMENT_TRACE_FIELDS, samples };
  }
}

const number = value => Number.isFinite(value) ? value.toFixed(3) : "none";
const degrees = value => Number.isFinite(value) ? `${(Math.atan2(Math.sin(value), Math.cos(value)) * 180 / Math.PI).toFixed(1)}°` : "none";

// Only imported with ?movementDebug. Normal gameplay has no overlay or trace.
export class MovementDebug {
  constructor(runtime) {
    this.runtime = runtime; this.trace = new MovementTrace(); this.lastDraw = -Infinity;
    this.root = document.createElement("aside"); this.root.className = "panel movement-debug";
    this.root.dataset.version = "movement-debug-v2";
    this.controls = document.createElement("div"); this.controls.className = "movement-debug__controls";
    this.toggle = this.button("Hide (F8)", () => this.setExpanded(this.output.hidden));
    this.auto = this.button("Auto-follow", () => {
      const settings = runtime.smartCamera.settings; settings.autoFollow = !settings.autoFollow; this.lastDraw = -Infinity;
    });
    this.save = this.button("Save trace", () => this.download());
    this.output = document.createElement("pre"); this.output.className = "movement-debug__output";
    this.root.append(this.controls, this.output); document.body.append(this.root);
    this.key = event => { if (event.code === "F8" && !event.repeat) { event.preventDefault(); this.setExpanded(this.output.hidden); } };
    window.addEventListener("keydown", this.key);
  }
  button(label, action) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", action); this.controls.append(button); return button;
  }
  setExpanded(expanded) { this.output.hidden = !expanded; this.toggle.textContent = expanded ? "Hide (F8)" : "Show (F8)"; }
  update(now = performance.now()) {
    const s = this.trace.capture(this.runtime, now);
    if (now - this.lastDraw < 200) return;
    this.lastDraw = now; this.auto.textContent = `Auto: ${s.autoEnabled ? "on" : "off"}`;
    if (this.output.hidden) return;
    this.output.textContent = [
      "Movement debug v2 · X right / Z backward",
      `Camera ${this.runtime.smartCamera.mode} · basis ${s.liveCameraReference ? "live view" : "gesture"}`,
      `Raw joystick  X ${number(s.rawX)}  Z ${number(s.rawZ)}`,
      `Joystick out  X ${number(s.joystickX)}  Z ${number(s.joystickZ)}`,
      `Pointer ${s.pointerId} · input pointer ${s.inputPointerId} · touch ${s.touchEnabled ? "on" : "off"}`,
      `Gesture ${s.held ? "held" : "idle"} · reference ${s.referenceActive ? "active" : "inactive"}`,
      `Reference yaw ${degrees(s.referenceYaw)}${s.liveCameraReference ? " (live view)" : ""}`,
      `Camera yaw    ${degrees(s.cameraYaw)} · view ${degrees(s.viewYaw)}`,
      `Cat facing    ${degrees(s.facingYaw)} · visual ${degrees(s.visualYaw)}`,
      `World calc    X ${number(s.worldX)}  Z ${number(s.worldZ)}`,
      `Body intent   X ${number(s.intentX)}  Z ${number(s.intentZ)}`,
      `Velocity      X ${number(s.velocityX)}  Z ${number(s.velocityZ)}`,
      `View velocity X ${number(s.viewVelocityX)}  Z ${number(s.viewVelocityZ)}`,
      `Auto ${s.autoEnabled ? (s.autoActive ? "active" : "idle") : "off"} · target ${degrees(s.targetHeading)}`,
      `Travel ${degrees(s.travelHeading)} · backward touch ${s.backwardTouch ? "yes" : "no"}`,
      `Manual ${s.manualActive ? "active" : "idle"} · stick ${number(s.lookX)} · drag ${number(s.dragX)}`,
      `Transform error ${number(s.worldError)} · ref changes ${s.unexpectedReferenceChanges}`,
      `Input/view ${s.viewOpposesInput ? "OPPOSED" : "consistent"} · ${s.grounded ? "grounded" : "airborne"}`,
      `Collision ${s.collisionHit ? "hit" : "clear"} · distance ${number(s.cameraDistance)}`,
      `Physics steps ${s.physicsSteps}${s.physicsWaiting ? " · waiting for collision" : ""}`,
    ].join("\n");
  }
  download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.trace.export(this.runtime))], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "maxworld-movement-trace.json";
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  dispose() { window.removeEventListener("keydown", this.key); this.root.remove(); }
}
