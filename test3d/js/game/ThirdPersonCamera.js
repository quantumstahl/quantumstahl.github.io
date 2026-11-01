import { Vector3, MathUtils } from "three";
import { CAMERA_DEFAULTS } from "./CameraSettings.js";
import { CameraCollision } from "./CameraCollision.js";

export const angleDifference = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export class ThirdPersonCamera {
  constructor(camera, world, { yaw = 0, ...settings } = {}) {
    this.camera = camera; this.settings = { ...CAMERA_DEFAULTS, ...settings };
    this.yaw = yaw; this.pitch = this.settings.pitch;
    this.target = new Vector3(); this.desired = new Vector3(); this.pivot = new Vector3();
    this.offset = new Vector3(); this.lastPosition = new Vector3();
    this.collision = new CameraCollision(world);
    this.initialized = false; this.manualAge = this.settings.followDelay;
    this.heading = yaw; this.autoFollowing = false; this.obstructionFraction = 1;
    this.moving = false; this.turnSign = 1;
    this.movementYaw = null;
    this.backwardTouch = false; this.travelHeading = yaw;
    this.mode = "smart"; this.movementReferenceMode = "gesture";
    this.distance = 0;
  }
  applyInput(input, delta) {
    const dt = Number.isFinite(delta) ? MathUtils.clamp(delta, 0, .1) : 0;
    const s = this.settings;
    const inputPower = Math.hypot(input.moveX, input.moveZ);
    if (input.movementPointerId == null) this.backwardTouch = false;
    else if (inputPower > s.movementInputThreshold) {
      // Keep the camera on the approach side while touch input means backward.
      // Retain the choice through neutral/sideways corrections; only definite
      // forward intent changes it back. This is a follow target, never movement.
      if (input.moveZ > inputPower * s.touchBackwardThreshold) this.backwardTouch = true;
      else if (input.moveZ < -inputPower * s.touchBackwardThreshold) this.backwardTouch = false;
    }
    this.manualActive = Boolean(input.lookX || input.lookY || input.dragX || input.dragY || input.cameraHeld);
    const yawDelta = -input.lookX * s.yawInputSpeed * dt - input.dragX;
    // A continuous movement gesture keeps one reference, including when the
    // player steers. Automatic yaw never feeds back into movement. Manual yaw
    // turns that reference by exactly the player's delta, without rebasing to
    // the accumulated automatic offset. Gesture ownership, not the camera's
    // follow threshold, decides when to release this reference. A held touch
    // may cross zero without adopting the automatically rotated camera heading.
    if (input.movementHeld || input.moveX !== 0 || input.moveZ !== 0) {
      this.movementYaw = angleDifference((this.movementYaw ?? this.yaw) + yawDelta, 0);
    } else this.movementYaw = null;
    // Apply deltas directly: no inertia, extra smoothing, or touch-rate scaling.
    this.yaw += yawDelta;
    this.pitch = MathUtils.clamp(this.pitch + input.lookY * s.pitchInputSpeed * dt + input.dragY, s.minPitch, s.maxPitch);
    this.yaw = angleDifference(this.yaw, 0);
  }
  follow(body, input, dt) {
    const s = this.settings;
    const previousAge = this.manualAge;
    this.manualAge = this.manualActive ? 0 : this.manualAge + dt;
    const wasFollowing = this.autoFollowing;
    this.autoFollowing = false;
    const speed = Math.hypot(body.velocity.x, body.velocity.z);
    // Radial input accepts every direction. Speed hysteresis keeps small
    // variations near the movement threshold from toggling follow on and off.
    const speedThreshold = this.moving ? Math.max(0, s.movingThreshold - s.movingHysteresis) : s.movingThreshold;
    this.moving = Math.hypot(input.moveX, input.moveZ) > s.movementInputThreshold
      && speed >= speedThreshold && speed > 0 && body.grounded;
    if (!this.moving) return;
    // Follow actual world motion, including sliding/turning where facing and
    // velocity differ. Input is only an activity/gesture gate, never a heading.
    this.travelHeading = Math.atan2(-body.velocity.x, -body.velocity.z);
    // A stable world reference alone isn't sufficient: orbiting behind a
    // backward touch reverses its on-screen direction even with correct physics.
    // Follow ahead of backward travel instead; keyboard/gamepad are unchanged.
    const heading = this.backwardTouch ? angleDifference(this.travelHeading + Math.PI, 0) : this.travelHeading;
    this.heading = heading;
    if (!s.autoFollow || this.manualActive) return;
    // Only manual input has a grace period. Normal following has no timer.
    const activeDt = Math.min(dt, Math.max(0, this.manualAge - Math.max(previousAge, s.followDelay)));
    if (!activeDt || s.followStrength <= 0 || s.followMaxSpeed <= 0) return;
    let difference = angleDifference(heading, this.yaw);
    // Near the antipode, retain the previous turn side instead of letting
    // +/-pi representations or tiny heading noise alternate the rotation.
    if (Math.PI - Math.abs(difference) < s.oppositeAngleTolerance) difference = this.turnSign * Math.abs(difference);
    const magnitude = Math.abs(difference);
    if (magnitude <= s.angularDeadzone + (wasFollowing ? .0005 : s.angularHysteresis)) return;
    // Smoothly increase response with angular error. Short small corrections
    // receive little camera motion; long curves build error and more response.
    // Bound only this scalar integration to 120 Hz (at most 12 tiny steps),
    // keeping the adaptive response consistent without extra collision queries.
    const count = Math.max(1, Math.ceil(activeDt * 120)), h = activeDt / count;
    let remaining = magnitude - s.angularDeadzone;
    for (let i = 0; i < count; i++) {
      const t = MathUtils.clamp(remaining / Math.max(.001, s.followFullAngle - s.angularDeadzone), 0, 1);
      const strength = MathUtils.lerp(s.followStrength, s.followMaxStrength, t * t * (3 - 2 * t));
      const linearTime = Math.max(0, (remaining - s.followMaxSpeed / strength) / s.followMaxSpeed);
      remaining = (remaining - s.followMaxSpeed * Math.min(h, linearTime))
        * Math.exp(-strength * Math.max(0, h - linearTime));
    }
    const step = Math.sign(difference) * (magnitude - s.angularDeadzone - remaining);
    if (Math.abs(step) > 1e-10) this.turnSign = Math.sign(step);
    this.yaw = angleDifference(this.yaw + step, 0);
    this.autoFollowing = true;
  }
  update(position, body, input, delta) {
    const dt = Number.isFinite(delta) ? MathUtils.clamp(delta, 0, .1) : 0, s = this.settings;
    this.follow(body, input, dt);
    const reset = !this.initialized || position.distanceToSquared(this.lastPosition) > s.teleportDistance ** 2;
    this.trackTarget(position, dt, reset);
    this.lastPosition.copy(position);
    // Collision never changes the smoothed look target or the orbit goal.
    this.collision.resetStats();
    this.placeOrbit(dt, reset);
    this.resolveCollision(dt, reset);
    this.initialized = true;
  }
  trackTarget(position, dt, reset) {
    const s = this.settings, rawY = position.y + s.targetHeight;
    if (reset || !s.verticalTracking) this.target.y = rawY;
    else if (dt > 0) {
      // Exact first-order response for a linearly moving interpolated target.
      const blend = -Math.expm1(-s.verticalTracking * dt);
      const velocity = (position.y - this.lastPosition.y) / dt;
      this.target.y += (rawY - this.target.y) * blend + velocity * (dt * (1 - blend) - blend / s.verticalTracking);
    }
    this.target.x = position.x; this.target.z = position.z;
  }
  placeOrbit() {
    const s = this.settings;
    const distance = Math.max(s.distance, s.minDistance), horizontal = Math.cos(this.pitch) * distance;
    this.offset.set(Math.sin(this.yaw) * horizontal, Math.sin(this.pitch) * distance + s.verticalOffset,
      Math.cos(this.yaw) * horizontal);
    this.desired.copy(this.target).add(this.offset);
  }
  resolveCollision(dt, reset) {
    const s = this.settings, camera = this.camera;
    this.pivot.copy(this.target);
    this.offset.subVectors(this.desired, this.target);
    const length = this.offset.length();
    const halfHeight = camera.near * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
    const halfWidth = halfHeight * camera.aspect;
    const safeDistance = s.collisionEnabled
      ? this.collision.sweep(this.target, this.desired, halfWidth, halfHeight, s.surfaceMargin) : length;
    // There is no safe camera placement on this boom if a surface intersects
    // the cat's look target. Keep a finite view direction and expose this case
    // in diagnostics; never translate the pivot or push through other faces.
    const minimum = Math.min(length, camera.near + s.surfaceMargin);
    this.collisionLimited = safeDistance < minimum;
    const allowed = length > 1e-8 ? Math.min(1, Math.max(minimum, safeDistance) / length) : 1;
    if (reset || !s.collisionEnabled || allowed < this.obstructionFraction) this.obstructionFraction = allowed;
    else this.obstructionFraction += (allowed - this.obstructionFraction) * (1 - Math.exp(-s.recoverySpeed * dt));
    if (length > 1e-8) this.obstructionFraction = Math.max(minimum / length, this.obstructionFraction);
    if (Math.abs(1 - this.obstructionFraction) < 1e-5) this.obstructionFraction = 1;
    this.distance = length * this.obstructionFraction;
    this.belowMinimum = this.distance < s.minDistance;
    camera.position.lerpVectors(this.target, this.desired, this.obstructionFraction);
    camera.lookAt(this.target);
  }
}
