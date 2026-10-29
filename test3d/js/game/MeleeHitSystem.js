import { Vector3 } from "three";

// Explicit registration avoids scene traversals. A target provides a world-space
// position (sphere center), radius, and receiveHit(hit). Mutate position in place.
export class MeleeHitSystem {
  constructor(source, { onHit = null, hitSound = null } = {}) {
    this.source = source; this.onHit = onHit; this.hitSound = hitSound;
    this.targets = new Set(); this.hitTargets = new Set();
    this.center = new Vector3(); this.direction = new Vector3();
  }
  register(target) {
    if (!target.position || !(target.radius >= 0) || typeof target.receiveHit !== "function") throw new Error("Invalid melee target.");
    this.targets.add(target);
    return () => this.targets.delete(target);
  }
  beginSwing() { this.hitTargets.clear(); }
  strike(body, attack, attackIndex) {
    this.direction.set(-Math.sin(body.yaw), 0, -Math.cos(body.yaw));
    // Range is the far edge of the sphere, measured from the foot datum.
    this.center.copy(body.position).addScaledVector(this.direction, attack.range - attack.radius);
    this.center.y += attack.height;
    for (const target of this.targets) {
      if (target.enabled === false || target === this.source || this.hitTargets.has(target)) continue;
      const radius = attack.radius + target.radius;
      if (this.center.distanceToSquared(target.position) > radius * radius) continue;
      this.hitTargets.add(target);
      // Allocate only on a successful hit. Recipients may retain the payload.
      const hit = { damage: attack.damage, direction: this.direction.clone(), source: this.source, attackIndex,
        position: target.position.clone() };
      target.receiveHit(hit);
      this.onHit?.(hit, target); this.hitSound?.(hit, target);
    }
  }
  dispose() { this.targets.clear(); this.hitTargets.clear(); }
}
