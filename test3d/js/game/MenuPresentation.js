import { Vector3 } from "three";
import { CameraCollision } from "./CameraCollision.js";

// A separate camera owns the title shot. The gameplay rig is never edited.
export class MenuPresentation {
  constructor(runtime, camera) {
    this.runtime = runtime; this.camera = camera.clone(); this.active = false;
    this.collision = runtime.physics ? new CameraCollision(runtime.physics) : null;
  }
  enter() {
    if (this.active) return;
    const r = this.runtime, sleep = r.animation.sleep;
    if (!sleep) throw new Error("The cat model is missing the sleeping animation (Animation 5).");
    this.active = true;
    r.combat.cancel(); r.mixer.stopAllAction();
    sleep.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    r.mixer.update(0);
    const target = r.body.position.clone().add(new Vector3(0, .3, 0));
    const up = new Vector3(0, 1, 0), candidate = new Vector3(), best = new Vector3();
    let bestDistance = -1;
    // Solve the shot once on entry, including placed trees around the bed.
    // No cinematic collision queries or camera motion in the frame path.
    for (const turn of [0, .6, -.6, 1.2, -1.2, Math.PI]) {
      const offset = new Vector3(1.6, 1.1, -1.8).applyAxisAngle(up, r.body.yaw + turn);
      candidate.copy(target).add(offset);
      const length = offset.length(), distance = this.collision?.sweep(target, candidate, .14, .14, .12) ?? length;
      if (distance > bestDistance) { bestDistance = distance; best.copy(target).addScaledVector(offset, distance / length); }
      if (distance >= length - .01) break;
    }
    this.camera.position.copy(best); this.camera.lookAt(target);
  }
  update(delta) { if (this.active) this.runtime.mixer.update(delta); }
  exit() {
    if (!this.active) return;
    this.active = false;
    const r = this.runtime;
    r.mixer.stopAllAction();
    r.animation.current = r.animation.locomotion;
    r.animation.locomotion?.reset().setEffectiveWeight(1).play();
    r.animation.setLocomotion(r.body); r.mixer.update(0);
  }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
