import { LoopOnce, PropertyBinding } from "three";

export const CLAW_CLIP_NAMES = Object.freeze(["Animation 2", "Animation 3", "Animation 4"]);

const hasPounceRoot = clip => ["position", "quaternion"].every(property => clip?.tracks.some(track => track.name === `export-node-1.${property}`));
export function catClipsNeedRefresh(clips) {
  return CLAW_CLIP_NAMES.some(name => !clips.some(clip => clip.name === name))
    || !hasPounceRoot(clips.find(clip => clip.name === "Animation 4"));
}

function sameTrack(a, b) {
  return a.name === b?.name && a.ValueTypeName === b.ValueTypeName
    && a.times.length === b.times.length && a.values.length === b.values.length
    && a.times.every((value, i) => value === b.times[i])
    && a.values.every((value, i) => value === b.values[i]);
}

// Old worlds embed the same cat with only locomotion. Borrow missing clips only
// when every animated node has the same local bind transform and parent name.
// Both input clip arrays and their tracks remain untouched.
export function compatibleCatClips(model, reference, clips, extras) {
  const missing = extras.filter(clip => CLAW_CLIP_NAMES.includes(clip.name) && !clips.some(existing => existing.name === clip.name));
  const oldPounce = clips.find(clip => clip.name === "Animation 4"), repaired = extras.find(clip => clip.name === "Animation 4");
  // Also repair the known older complete export. Never replace customized paw
  // motion: its duration and every existing track must match the reference.
  const replacePounce = oldPounce && !hasPounceRoot(oldPounce) && hasPounceRoot(repaired)
    && oldPounce.duration === repaired.duration && oldPounce.tracks.length > 0
    && repaired.tracks.length === oldPounce.tracks.length + 3
    && oldPounce.tracks.every(track => sameTrack(track, repaired.tracks.find(candidate => candidate.name === track.name)));
  const candidates = replacePounce ? [...missing, repaired] : missing;
  for (const clip of candidates) for (const track of clip.tracks) {
    const name = PropertyBinding.parseTrackName(track.name).nodeName;
    const node = PropertyBinding.findNode(model, name), expected = PropertyBinding.findNode(reference, name);
    if (!node || !expected || node.parent?.name !== expected.parent?.name
      || node.position.distanceToSquared(expected.position) > 1e-10
      || node.scale.distanceToSquared(expected.scale) > 1e-10
      || 1 - Math.abs(node.quaternion.dot(expected.quaternion)) > 1e-8) return clips;
  }
  return [...clips.map(clip => replacePounce && clip === oldPounce ? repaired : clip), ...missing];
}

// Locomotion retains the existing frozen idle/airborne pose and run speed.
// The mixer drives only the model hierarchy, never the character root/body.
export class CatAnimationController {
  constructor(mixer, clips, locomotionClip, { crossFade = .06 } = {}) {
    this.mixer = mixer; this.crossFade = crossFade;
    this.locomotion = locomotionClip ? mixer.clipAction(locomotionClip) : null;
    this.attacks = CLAW_CLIP_NAMES.map(name => {
      const clip = clips.find(clip => clip.name === name);
      if (!clip) return null;
      const action = mixer.clipAction(clip);
      action.setLoop(LoopOnce, 1); action.clampWhenFinished = true;
      return action;
    });
    this.durations = this.attacks.map(action => action?.getClip().duration ?? 0);
    this.current = this.locomotion; this.attacking = false;
    this.locomotion?.play();
  }
  get available() { return this.attacks.every(action => action && action.getClip().duration > 0); }
  setLocomotion(body) {
    if (!this.locomotion) return;
    this.locomotion.paused = !body.grounded || body.intent.lengthSq() < .01;
    this.locomotion.timeScale = body.running ? 1.7 : 1;
  }
  transition(action, restart = false) {
    if (this.current === action && !restart) return;
    this.current?.fadeOut(this.crossFade);
    if (action) {
      if (restart) action.reset();
      action.enabled = true;
      action.setEffectiveWeight(1).fadeIn(this.crossFade).play();
    }
    this.current = action;
  }
  playAttack(index) {
    this.attacking = true;
    this.transition(this.attacks[index], true);
    this.current.setEffectiveTimeScale(1);
  }
  finishAttack() { this.attacking = false; this.transition(this.locomotion); }
  update(delta) { this.mixer.update(delta); }
}
