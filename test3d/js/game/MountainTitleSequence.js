import { Vector3, Quaternion, Euler, MathUtils } from 'three';
import { CharacterBody } from '../physics/CharacterBody.js';
import { CameraCollision } from './CameraCollision.js';
import { overlapsTrigger } from '../triggers/TriggerSystem.js';
import { MUSIC_STOP_CHECKPOINT, TITLE_CHECKPOINT, TITLE_MUSIC, TITLE_IMAGE, MOUNTAIN_TITLE_DEFAULTS, mountainTitleConfig, mountainTitleDestination } from './MountainTitleConfig.js';

const ease = value => { const t = MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
// The gameplay rig already supplied a valid near-wall pose. A wide rectangle
// perpendicular to the NEW travel direction can overlap the wall at t=0 even
// when this camera can move out safely. Use a small position clearance here.
const CAMERA_CLEARANCE = .02;

// Gameplay cinematic, independent of the menu presentation and gameplay rig.
export class MountainTitleSequence {
  constructor(runtime, audio, { documentTarget = globalThis.document, eventTarget = globalThis.window, onError = console.warn } = {}) {
    Object.assign(this, { runtime, audio, document: documentTarget, events: eventTarget, onError });
    this.camera = runtime.camera.clone(false); this.active = false; this.completedIds = new Set();
    this.probe = new CharacterBody(runtime.physics, {}, runtime.body.config);
    this.footProbe = new CharacterBody(runtime.physics, {}, { radius: .08, height: .16 });
    this.collision = new CameraCollision(runtime.physics);
    this.startPosition = new Vector3(); this.startRotation = new Quaternion(); this.endRotation = new Quaternion();
    this.goal = new Vector3(); this.forward = new Vector3(); this.destination = new Vector3(); this.lastSafe = new Vector3();
    this.returnPosition = new Vector3(); this.returnRotation = new Quaternion();
    this.cameraDestination = new Vector3(); this.hasCameraCheckpoint = false;
    this.cameraExit = new Vector3(); this.runForward = new Vector3();
    this.isGameplayActive = () => true;
    this.keydown = event => {
      if (!this.active || event.repeat || !this.isGameplayActive() || !['Escape', 'Space', 'Enter'].includes(event.code)) return;
      if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.skip();
    };
    eventTarget?.addEventListener('keydown', this.keydown, true);
    if (documentTarget) {
      this.overlay = documentTarget.createElement('div'); this.overlay.className = 'mountain-title'; this.overlay.hidden = true;
      this.overlay.setAttribute('aria-hidden', 'true');
      const image = documentTarget.createElement('img'); image.src = TITLE_IMAGE; image.alt = 'CatAdventure'; this.overlay.append(image);
      this.skipButton = documentTarget.createElement('button'); this.skipButton.type = 'button';
      this.skipButton.className = 'game-settings mountain-title-skip'; this.skipButton.hidden = true;
      this.skipButton.textContent = 'Skip · Esc / A'; this.skipButton.setAttribute('aria-label', 'Skip title cinematic');
      this.skipButton.onclick = () => { if (this.isGameplayActive()) this.skip(); };
      documentTarget.body.append(this.overlay, this.skipButton);
    }
    runtime.cinematic = this;
  }
  onCheckpoint(volume) {
    if (volume.type !== 'Checkpoint') return;
    if (volume.id === MUSIC_STOP_CHECKPOINT && !this.active && !this.completedIds.has(MUSIC_STOP_CHECKPOINT) && !this.completedIds.has(TITLE_CHECKPOINT)) {
      this.completedIds.add(MUSIC_STOP_CHECKPOINT);
      this.audio.setMusicElementEnabled(false, { fade: MOUNTAIN_TITLE_DEFAULTS.musicFade });
    }
    if (volume.id === TITLE_CHECKPOINT && !this.active && !this.completedIds.has(TITLE_CHECKPOINT)) this.start(volume);
  }
  settings(checkpoint = this.runtime.triggers?.data.volumes.get(TITLE_CHECKPOINT)) {
    this.config = mountainTitleConfig(checkpoint?.titleReveal);
    this.destination.fromArray(mountainTitleDestination(checkpoint, this.runtime.triggers?.data.volumes, this.config, this.runtime.body.position.toArray(), this.runtime.body.yaw));
    const cameraCheckpoint = this.runtime.triggers?.data.volumes.get(this.config.cameraCheckpointId);
    this.hasCameraCheckpoint = cameraCheckpoint?.type === 'Checkpoint';
    if (this.hasCameraCheckpoint) this.cameraDestination.fromArray(cameraCheckpoint.position);
  }
  start(volume) {
    if (this.active || this.completedIds.has(TITLE_CHECKPOINT)) return;
    this.settings(volume); this.active = true; this.elapsed = 0; this.returning = false; this.arrived = false;
    this.completedIds.add(MUSIC_STOP_CHECKPOINT);
    const r = this.runtime;
    this.lastSafe.copy(r.body.position);
    this.startPosition.copy(r.camera.position); this.startRotation.copy(r.camera.quaternion);
    r.camera.getWorldDirection(this.forward); this.forward.y = 0; this.forward.normalize();
    this.runForward.subVectors(this.destination, r.body.position).setY(0);
    if (this.runForward.lengthSq() < .0001) this.runForward.copy(this.forward);
    this.runForward.normalize();
    this.prepareCameraExit();
    this.endRotation.copy(this.startRotation).multiply(new Quaternion().setFromEuler(new Euler(this.config.cameraTilt, this.config.cameraYaw, 0)));
    this.camera.position.copy(this.startPosition); this.camera.quaternion.copy(this.startRotation);
    r.combat?.cancel(); r.body.setMovement(0, 0); r.body.jumpRequested = false; r.body.velocity.set(0, 0, 0);
    r.input.setMenuBlocked(true);
    this.document?.body.classList.add('mountain-title-active');
    if (this.skipButton) this.skipButton.hidden = false;
    // Cancel the outgoing element ramp now. The new buffered music voice is
    // on its normal music bus, outside the legacy element's dedicated gain.
    this.audio.setMusicElementEnabled(false);
    this.audio.playMusic(TITLE_MUSIC, { loop: false, preserveOnPause: true });
    this.paintTitle();
  }
  prepareCameraExit() {
    this.cameraExit.copy(this.startPosition);
    this.cameraClearanceDistance = 0;
    if (!this.hasCameraCheckpoint) return;
    // Find where the rising route clears the roof, then travel the configured
    // EXTRA distance outside. The cave search limit never caps that extra leg.
    const c = this.config;
    for (let sample = 0; sample <= 20; sample++) {
      const distance = c.cameraExitMaxDistance * sample / 20;
      this.goal.copy(this.startPosition).addScaledVector(this.runForward, distance);
      const allowed = this.collision.sweep(this.startPosition, this.goal, CAMERA_CLEARANCE, CAMERA_CLEARANCE, CAMERA_CLEARANCE);
      if (allowed < distance - .001) {
        this.cameraClearanceDistance = allowed;
        break;
      }
      this.cameraClearanceDistance = distance;
      this.cameraExit.copy(this.goal);
      const legLength = this.cameraExit.distanceTo(this.cameraDestination);
      if (this.collision.sweep(this.cameraExit, this.cameraDestination, CAMERA_CLEARANCE, CAMERA_CLEARANCE, CAMERA_CLEARANCE) >= legLength - .001) break;
      if (c.cameraExitMaxDistance === 0) break;
    }
    this.goal.copy(this.startPosition).addScaledVector(this.runForward, this.cameraClearanceDistance + c.cameraExitDistance);
    const requested = this.startPosition.distanceTo(this.goal);
    const allowed = this.collision.sweep(this.startPosition, this.goal, CAMERA_CLEARANCE, CAMERA_CLEARANCE, CAMERA_CLEARANCE);
    this.cameraExit.lerpVectors(this.startPosition, this.goal, requested > 0 ? Math.min(1, allowed / requested) : 1);
  }
  validateDestination() {
    const b = this.probe, r = this.runtime;
    b.teleport(this.destination.x, this.destination.y, this.destination.z, r.body.yaw);
    b.setBounds(.5);
    for (const collider of r.physics.colliders) if (collider.prepare && !collider.prepare(b.bounds)) return false;
    if (!b.probeGround(.35, .35)) return false;
    b.position.y += b.groundCorrection; b.updateCapsule();
    if (b.findCollision()) return false;
    for (const volume of r.triggers?.data.volumes.values() ?? []) if (volume.enabled && volume.type === 'KillZone' && overlapsTrigger(b, volume)) return false;
    this.destination.copy(b.position); return true;
  }
  drive() {
    const b = this.runtime.body, dx = this.destination.x - b.position.x, dz = this.destination.z - b.position.z;
    const distance = Math.hypot(dx, dz);
    if (this.arrived || this.returning || distance <= this.config.arrivalRadius) {
      this.arrived = true; b.setMovement(0, 0); b.velocity.x = b.velocity.z = 0; return;
    }
    if (!b.grounded) { b.setMovement(0, 0); return; }
    // A tiny leading-foot probe stops the cat BEFORE its body overhangs a rim.
    const foot = this.footProbe, lead = b.config.radius + b.halfSegment + .12 + b.config.runSpeed * this.runtime.physics.fixedDelta;
    foot.teleport(b.position.x + dx / distance * lead, b.position.y, b.position.z + dz / distance * lead);
    foot.setBounds(.4);
    for (const collider of this.runtime.physics.colliders) if (collider.prepare && !collider.prepare(foot.bounds)) { b.setMovement(0, 0); return; }
    if (!foot.probeGround(this.config.maxStepDrop, b.config.stepHeight)) {
      this.arrived = true; b.setMovement(0, 0); b.velocity.x = b.velocity.z = 0; return;
    }
    const scale = Math.min(1, distance / (b.config.runSpeed * this.runtime.physics.fixedDelta));
    b.setYaw(Math.atan2(-dx, -dz)); b.setMovement(dx / distance * scale, dz / distance * scale, true);
  }
  stepPlayer(delta) {
    const r = this.runtime, b = r.body;
    let supported = b.grounded;
    this.drive();
    r.physics.update(delta, () => {
      // Never accept a cinematic step off supported ground, including during
      // capped catch-up. Normal solver wall, slope and step behavior stays intact.
      if (supported && (!b.grounded || b.position.y < this.lastSafe.y - this.config.maxStepDrop)) {
        b.teleport(this.lastSafe.x, this.lastSafe.y, this.lastSafe.z, b.yaw); b.grounded = true;
        this.arrived = true; return false;
      }
      if (b.grounded) this.lastSafe.copy(b.position);
      supported = b.grounded; this.drive(); return true;
    });
    r.syncVisual(r.physics.alpha, Math.min(delta, .1), false, false);
  }
  shot(time) {
    const c = this.config, t = ease(time / (c.duration - c.returnDuration)) * ease(time / Math.max(.01, c.transitionDuration));
    let origin = this.startPosition;
    if (this.hasCameraCheckpoint) {
      if (time <= c.cameraExitDuration) this.goal.lerpVectors(this.startPosition, this.cameraExit, ease(time / c.cameraExitDuration));
      else {
        origin = this.cameraExit;
        // Reach the landscape shot independently of the title/music hold time.
        this.goal.lerpVectors(this.cameraExit, this.cameraDestination, ease((time - c.cameraExitDuration) / c.cameraTravelDuration));
      }
    } else { this.goal.copy(this.startPosition).addScaledVector(this.forward, c.cameraDrift * t); this.goal.y += c.cameraRise * t; }
    const length = origin.distanceTo(this.goal);
    const safe = this.collision.sweep(origin, this.goal, CAMERA_CLEARANCE, CAMERA_CLEARANCE, CAMERA_CLEARANCE);
    this.camera.position.lerpVectors(origin, this.goal, length > 0 ? Math.min(1, safe / length) : 1);
    this.camera.quaternion.slerpQuaternions(this.startRotation, this.endRotation, t);
  }
  prepareReturn() {
    this.returning = true; this.runtime.body.setMovement(0, 0);
    this.shot(this.config.duration - this.config.returnDuration);
    this.returnPosition.copy(this.camera.position); this.returnRotation.copy(this.camera.quaternion);
    const r = this.runtime;
    r.smartCamera.initialized = false;
    // Ask the unchanged gameplay rig for its normal safe pose while input is neutral.
    r.smartCamera.update(r.body.position, r.body, r.input, 0);
  }
  update(delta) {
    if (!this.active) return;
    delta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    this.elapsed += delta;
    const returnAt = this.config.duration - this.config.returnDuration;
    if (this.elapsed >= returnAt && !this.returning) this.prepareReturn();
    this.stepPlayer(delta);
    if (this.returning) {
      const t = ease((this.elapsed - returnAt) / this.config.returnDuration), normal = this.runtime.camera;
      this.camera.position.lerpVectors(this.returnPosition, normal.position, t);
      this.camera.quaternion.slerpQuaternions(this.returnRotation, normal.quaternion, t);
    } else this.shot(this.elapsed);
    this.paintTitle();
    if (this.elapsed >= this.config.duration - 1e-8) this.finish(false);
  }
  paintTitle() {
    if (!this.overlay) return;
    const c = this.config, fade = MathUtils.clamp((this.elapsed - c.titleAt) / c.titleFadeIn, 0, 1);
    const out = MathUtils.clamp((c.duration - this.elapsed) / c.titleFadeOut, 0, 1);
    this.overlay.hidden = !this.active || this.elapsed < c.titleAt - 1e-8;
    this.overlay.style.opacity = String(Math.min(fade, out));
  }
  finish(placeAtDestination) {
    const r = this.runtime;
    if (placeAtDestination && this.validateDestination()) {
      r.body.teleport(this.destination.x, this.destination.y, this.destination.z, r.body.yaw); r.body.grounded = true;
    } else if (placeAtDestination) this.onError('Title cinematic destination is unsupported, blocked, loading, or in a KillZone; keeping the last safe player position.');
    r.body.setMovement(0, 0); r.body.velocity.set(0, 0, 0); r.body.jumpRequested = false;
    this.completedIds.add(TITLE_CHECKPOINT); this.close();
    if (placeAtDestination) { r.smartCamera.initialized = false; r.syncVisual(1, 0); }
  }
  skip() { if (this.active) this.finish(true); }
  close() {
    this.active = false;
    if (this.overlay) { this.overlay.hidden = true; this.overlay.style.opacity = '0'; }
    if (this.skipButton) this.skipButton.hidden = true;
    this.document?.body.classList.remove('mountain-title-active');
    this.runtime.input.setMenuBlocked(!this.isGameplayActive());
  }
  snapshot() { return { version: 1, completedIds: [...this.completedIds].sort(), inProgress: this.active }; }
  restore(state, validateOnly = false) {
    state ??= { version: 1, completedIds: [], inProgress: false };
    if (state.version !== 1 || !Array.isArray(state.completedIds) || new Set(state.completedIds).size !== state.completedIds.length
      || state.completedIds.some(id => ![MUSIC_STOP_CHECKPOINT, TITLE_CHECKPOINT].includes(id)) || typeof state.inProgress !== 'boolean'
      || ((state.inProgress || state.completedIds.includes(TITLE_CHECKPOINT)) && !state.completedIds.includes(MUSIC_STOP_CHECKPOINT))
      || (state.inProgress && state.completedIds.includes(TITLE_CHECKPOINT))) throw new Error('Invalid saved mountain title state.');
    if (validateOnly) return;
    this.close(); this.audio.stop(TITLE_MUSIC);
    this.completedIds = new Set(state.completedIds);
    this.audio.setMusicElementEnabled(!this.completedIds.has(MUSIC_STOP_CHECKPOINT));
    if (state.inProgress) { this.settings(); this.finish(true); }
  }
  resetSession() { this.restore(null); }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  dispose() {
    this.close(); this.events?.removeEventListener('keydown', this.keydown, true);
    this.overlay?.remove(); this.skipButton?.remove(); this.audio.stop(TITLE_MUSIC);
    if (this.runtime.cinematic === this) this.runtime.cinematic = null;
  }
}
