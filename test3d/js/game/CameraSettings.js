// Runtime-only settings. World files and character physics are unaffected.
export const CAMERA_DEFAULTS = Object.freeze({
  distance: 5, pitch: .3, minPitch: -.1, maxPitch: 1.2,
  targetHeight: .8, verticalOffset: .7, minDistance: .8,
  yawInputSpeed: 2.5, pitchInputSpeed: 1.5,
  autoFollow: true, followDelay: .6, followStrength: .45,
  followMaxStrength: 1.6, followFullAngle: Math.PI / 2, followMaxSpeed: .6,
  angularDeadzone: .1, angularHysteresis: .02,
  oppositeAngleTolerance: .05,
  movementInputThreshold: .12, movingThreshold: .25, movingHysteresis: .1,
  touchBackwardThreshold: .25,
  verticalTracking: 10, teleportDistance: 8,
  radius: .24, surfaceMargin: .05,
  recoverySpeed: 3, recoveryDelay: .15, recoveryHysteresis: .06,
  sweepIterations: 12, overlapIterations: 6,
});

// NextWorld/js/game/PlayerController.js camera tuning. Collision uses the same
// MaxWorld defaults above; the shorter anchor keeps the cat safe under roofs.
export const NEXTWORLD_CAMERA_DEFAULTS = Object.freeze({
  distance: 3, cameraHeight: 0.5, pitch: Math.atan2(3, 10), verticalOffset: 0,
  targetHeight: 1.0, collisionAnchorHeight: .8,
  horizontalTracking: 12, verticalTracking: 4, positionTracking: 7,
  followStrength: .7,
  recoverOnlyAfterCollision: true,
});
