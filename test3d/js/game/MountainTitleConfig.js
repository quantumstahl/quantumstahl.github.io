export const MUSIC_STOP_CHECKPOINT = '7a567672-9678-4522-ad60-b46a5db38d48';
export const TITLE_CHECKPOINT = '06e3c71d-b7da-4572-9b22-9afab1e74115';
export const TITLE_CAMERA_CHECKPOINT = 'ed66b9eb-575e-4877-946f-3cd2e67022ff';
export const TITLE_MUSIC = 'mountain_title';
export const TITLE_IMAGE = new URL('../../assets/CatAdventureTitlescreen.png', import.meta.url).href;

export const MOUNTAIN_TITLE_DEFAULTS = Object.freeze({
  duration: 50, titleAt: 8, titleFadeIn: 1, titleFadeOut: 1, musicFade: 2,
  cameraRise: 4, cameraTilt: .22, cameraYaw: 0, cameraDrift: 0,
  transitionDuration: 2, returnDuration: 2, arrivalRadius: .08, maxStepDrop: .15,
  cameraCheckpointId: TITLE_CAMERA_CHECKPOINT,
  runDistance: 24, cameraExitDistance: 5, cameraExitDuration: 2, cameraExitMaxDistance: 10,
  cameraTravelDuration: 6,
});
export const TITLE_TUNING = Object.freeze({
  duration: 'Total duration (s)', cameraRise: 'Camera rise (m)', cameraTilt: 'Tilt up (radians)',
  cameraYaw: 'Camera yaw offset (radians)', cameraDrift: 'Forward camera drift (m)',
  transitionDuration: 'Entry ease (s)', returnDuration: 'Return to gameplay (s)',
  runDistance: 'Automatic cat run distance (m)', cameraExitDistance: 'Travel past cave clearance (m)', cameraExitDuration: 'Camera forward leg time (s)',
  cameraExitMaxDistance: 'Maximum cave exit search (m)',
  cameraTravelDuration: 'Camera travel to checkpoint (s)',
});
export function mountainTitleConfig(value = {}) {
  const result = { ...MOUNTAIN_TITLE_DEFAULTS };
  for (const key of Object.keys(result)) if (Number.isFinite(value[key]) && (key.startsWith('camera') || value[key] >= 0)) result[key] = value[key];
  // The title cue stays fixed at eight seconds. Reserve a readable title hold.
  result.titleAt = 8; result.titleFadeIn = 1; result.returnDuration = Math.max(.1, result.returnDuration);
  result.titleFadeOut = Math.max(.01, result.titleFadeOut);
  result.duration = Math.max(result.duration, result.titleAt + result.titleFadeIn + result.returnDuration + 1);
  result.cameraExitDistance = Math.max(0, result.cameraExitDistance);
  result.cameraExitMaxDistance = Math.max(0, result.cameraExitMaxDistance);
  result.cameraExitDuration = Math.max(.1, Math.min(result.cameraExitDuration, result.duration - result.returnDuration - 1));
  result.cameraTravelDuration = Math.max(.1, Math.min(result.cameraTravelDuration, result.duration - result.returnDuration - result.cameraExitDuration));
  if (value.cameraCheckpointId != null) {
    if (typeof value.cameraCheckpointId !== 'string') throw new Error('Invalid cinematic camera checkpoint ID.');
    result.cameraCheckpointId = value.cameraCheckpointId.trim();
  }
  if (value.destination != null) {
    if (!Array.isArray(value.destination) || value.destination.length !== 3 || !value.destination.every(Number.isFinite)) throw new Error('Invalid cinematic destination.');
    result.destination = [...value.destination];
  }
  return result;
}

// Persist explicit author choices only. Baking resolved defaults into every
// checkpoint masks later edits to MOUNTAIN_TITLE_DEFAULTS on editor save.
export function normalizeMountainTitleOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid title cinematic settings.');
  const checked = mountainTitleConfig(value), overrides = {};
  for (const key of Object.keys(MOUNTAIN_TITLE_DEFAULTS)) {
    if (Number.isFinite(value[key]) && (key.startsWith('camera') || value[key] >= 0)) overrides[key] = value[key];
  }
  if (value.cameraCheckpointId != null) overrides.cameraCheckpointId = checked.cameraCheckpointId;
  if (value.destination != null) overrides.destination = checked.destination;
  return overrides;
}

// Missing metadata must still produce a forward run, not the starting point.
// Marker XZ defines the exit direction; the previous checkpoint is a fallback.
export function mountainTitleDestination(checkpoint, volumes, config = mountainTitleConfig(checkpoint?.titleReveal), fallback = [0, 0, 0], yaw = 0) {
  if (config.destination) return [...config.destination];
  const start = checkpoint?.respawn?.position ?? fallback;
  const camera = volumes?.get(config.cameraCheckpointId), previous = volumes?.get(MUSIC_STOP_CHECKPOINT);
  let dx = camera?.type === 'Checkpoint' ? camera.position[0] - start[0] : 0;
  let dz = camera?.type === 'Checkpoint' ? camera.position[2] - start[2] : 0;
  if (Math.hypot(dx, dz) < .01 && previous?.respawn) { dx = start[0] - previous.respawn.position[0]; dz = start[2] - previous.respawn.position[2]; }
  if (Math.hypot(dx, dz) < .01) { dx = -Math.sin(yaw); dz = -Math.cos(yaw); }
  const scale = config.runDistance / Math.hypot(dx, dz);
  return [start[0] + dx * scale, start[1], start[2] + dz * scale];
}
