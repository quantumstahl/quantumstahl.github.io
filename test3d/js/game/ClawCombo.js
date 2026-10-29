export const CLAW_DEFAULTS = Object.freeze({ comboWindow: .5 });
// Active windows are normalized clip time, so re-exported clip durations work.
export const CLAW_ATTACKS = Object.freeze([
  Object.freeze({ range: 1, radius: .35, height: .35, damage: 1, activeStart: .2, activeEnd: .55 }),
  Object.freeze({ range: 1, radius: .35, height: .35, damage: 1, activeStart: .2, activeEnd: .55 }),
  Object.freeze({ range: 1.3, radius: .45, height: .4, damage: 2, activeStart: .25, activeEnd: .65 }),
]);

export class ClawCombo {
  constructor(animation, melee, body, { comboWindow = CLAW_DEFAULTS.comboWindow, attacks = [] } = {}) {
    this.animation = animation; this.melee = melee; this.body = body;
    this.comboWindow = comboWindow;
    this.attacks = CLAW_ATTACKS.map((attack, i) => ({ ...attack, ...attacks[i] }));
    this.attackIndex = -1; this.nextIndex = 0; this.elapsed = 0;
    this.buffered = false; this.idleAge = Infinity;
  }
  get active() { return this.attackIndex >= 0; }
  start(index) {
    this.attackIndex = index; this.elapsed = 0; this.buffered = false;
    this.melee.beginSwing(); this.animation.playAttack(index);
  }
  update(delta, pressed = false) {
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    if (pressed && this.animation.available) {
      if (this.active) this.buffered = true; // One slot; never restart a swing.
      else this.start(this.idleAge <= this.comboWindow ? this.nextIndex : 0);
    }
    let remaining = delta;
    while (this.active) {
      const index = this.attackIndex, duration = this.animation.durations[index], attack = this.attacks[index];
      const step = Math.min(remaining, Math.max(0, duration - this.elapsed));
      const end = this.elapsed + step;
      this.animation.update(step);
      // Interval overlap also detects strikes when a frame spans the window.
      if (end >= duration * attack.activeStart && this.elapsed <= duration * attack.activeEnd) this.melee.strike(this.body, attack, index);
      this.elapsed = end; remaining = Math.max(0, remaining - step);
      if (end < duration - 1e-9) return;
      this.nextIndex = (index + 1) % this.attacks.length;
      if (this.buffered) this.start(this.nextIndex);
      else {
        this.attackIndex = -1; this.idleAge = 0;
        this.animation.finishAttack();
      }
      if (remaining <= 1e-9) return;
    }
    this.idleAge += remaining;
    if (this.idleAge > this.comboWindow) this.nextIndex = 0;
    this.animation.update(remaining);
  }
}
