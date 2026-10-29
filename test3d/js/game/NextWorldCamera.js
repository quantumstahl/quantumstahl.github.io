import { Vector3, MathUtils } from "three";
import { ThirdPersonCamera, angleDifference } from "./ThirdPersonCamera.js";
import { NEXTWORLD_CAMERA_DEFAULTS } from "./CameraSettings.js";

// Camera behavior ported from NextWorld's PlayerController, with MaxWorld's
// input adapter, physics interpolation and shared collision response.
export class NextWorldCamera extends ThirdPersonCamera {
  constructor(camera, world, settings = {}) {
    const config = { ...NEXTWORLD_CAMERA_DEFAULTS, ...settings };
    if (settings.pitch === undefined) config.pitch = Math.atan2(config.cameraHeight, config.distance);
    super(camera, world, config);
    this.viewForward = new Vector3(); this.orbitGoal = new Vector3();
    this.movementReferenceMode = "view"; this.mode = "nextworld";
  }
  applyInput(input, delta) {
    const dt = Number.isFinite(delta) ? MathUtils.clamp(delta, 0, .1) : 0, s = this.settings;
    this.manualActive = Boolean(input.lookX || input.lookY || input.dragX || input.dragY || input.cameraHeld);
    const yawDelta = -input.lookX * s.yawInputSpeed * dt - input.dragX;
    // NextWorld reads the actual rendered view for movement, not its desired
    // orbit yaw and not a captured gesture reference. Account for manual yaw
    // immediately so all existing look inputs remain responsive in this frame.
    this.camera.getWorldDirection(this.viewForward);
    const viewYaw = Math.atan2(-this.viewForward.x, -this.viewForward.z);
    this.movementYaw = input.movementHeld || input.moveX || input.moveZ ? angleDifference(viewYaw + yawDelta, 0) : null;
    this.yaw = angleDifference((this.manualActive ? viewYaw : this.yaw) + yawDelta, 0);
    this.pitch = MathUtils.clamp(this.pitch + input.lookY * s.pitchInputSpeed * dt + input.dragY, s.minPitch, s.maxPitch);
  }
  follow(body, input, dt) {
    const s = this.settings, previousAge = this.manualAge;
    this.manualAge = this.manualActive ? 0 : this.manualAge + dt;
    this.moving = Math.hypot(body.velocity.x, body.velocity.z) > s.movingThreshold;
    this.travelHeading = this.moving ? Math.atan2(-body.velocity.x, -body.velocity.z) : body.yaw;
    this.heading = body.yaw; this.autoFollowing = false;
    if (!s.autoFollow || this.manualActive) return;
    const activeDt = Math.min(dt, Math.max(0, this.manualAge - Math.max(previousAge, s.followDelay)));
    const difference = angleDifference(this.heading, this.yaw);
    this.yaw = angleDifference(this.yaw + difference * (1 - Math.exp(-s.followStrength * activeDt)), 0);
    this.autoFollowing = activeDt > 0 && Math.abs(difference) > .001;
  }
  trackTarget(position, dt, reset) {
    const s = this.settings;
    if (reset) this.target.set(position.x, position.y + s.targetHeight, position.z);
    else {
      const horizontal = 1 - Math.exp(-s.horizontalTracking * dt), vertical = 1 - Math.exp(-s.verticalTracking * dt);
      this.target.x += (position.x - this.target.x) * horizontal;
      this.target.z += (position.z - this.target.z) * horizontal;
      this.target.y += (position.y + s.targetHeight - this.target.y) * vertical;
    }
  }
  placeOrbit(dt, reset) {
    const s = this.settings, radius = Math.hypot(s.distance, s.cameraHeight), horizontal = Math.cos(this.pitch) * radius;
    this.orbitGoal.set(this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * radius, this.target.z + Math.cos(this.yaw) * horizontal);
    // Smooth the unobstructed goal first. Resolve collision afterward so easing
    // can never move the actual camera back through a newly encountered wall.
    if (reset || this.manualActive) this.desired.copy(this.orbitGoal);
    else this.desired.lerp(this.orbitGoal, 1 - Math.exp(-s.positionTracking * dt));
  }
}
