export const DEATH_TIMING = Object.freeze({ tumble: .7, fadeOut: .18, fadeIn: .32 });

// A visual pose and one opacity value; no timers, extra physics or render pass.
export class DeathRespawnSequence {
  constructor(root, { onBlack, onFade = () => {} }) {
    this.root = root; this.onBlack = onBlack; this.onFade = onFade;
    this.origin = root.position.clone(); this.rotation = root.rotation.clone();
    this.active = false; this.respawning = false; this.elapsed = 0; this.respawned = false;
  }
  start() {
    if (this.active) return false;
    this.origin.copy(this.root.position); this.rotation.copy(this.root.rotation);
    this.active = true; this.elapsed = 0; this.respawned = false; this.onFade(0);
    return true;
  }
  resetPose() { this.root.position.copy(this.origin); this.root.rotation.copy(this.rotation); }
  update(delta) {
    if (!this.active) return;
    // Safari can resume with a huge frame delta. Keep the reveal visible.
    this.elapsed += Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
    const blackAt = DEATH_TIMING.tumble + DEATH_TIMING.fadeOut;
    if (!this.respawned) {
      const t = Math.min(1, this.elapsed / DEATH_TIMING.tumble);
      this.root.position.copy(this.origin);
      this.root.position.y += .25 * Math.sin(t * Math.PI) - .8 * t * t;
      this.root.rotation.set(this.rotation.x + .3 * Math.sin(t * Math.PI), this.rotation.y,
        this.rotation.z + 1.9 * t + .18 * Math.sin(t * Math.PI * 3));
      this.onFade(Math.max(0, Math.min(1, (this.elapsed - DEATH_TIMING.tumble) / DEATH_TIMING.fadeOut)));
      if (this.elapsed + 1e-9 >= blackAt) {
        this.onFade(1); this.resetPose();
        this.respawning = true;
        try { this.onBlack(); } finally { this.respawning = false; }
        this.respawned = true; this.elapsed = blackAt;
        return; // Render one completely black frame before starting the reveal.
      }
    } else {
      const reveal = Math.min(1, (this.elapsed - blackAt) / DEATH_TIMING.fadeIn);
      this.onFade(1 - reveal);
      if (reveal >= 1 - 1e-9) { this.active = false; this.onFade(0); }
    }
  }
  cancel() {
    if (!this.active) return;
    if (!this.respawned) this.resetPose();
    this.active = false; this.onFade(0);
  }
}
