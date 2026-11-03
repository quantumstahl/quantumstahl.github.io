import { Vector3 } from "three";

// Pockets are blocked at their approach, not escaped by replaying player
// movement. A settled, unsupported capsule can request one ordinary-strength
// jump; only genuine walkable grounding replenishes that allowance.
export class CharacterEscape {
  constructor(body) {
    this.body = body;
    this.angles = [];
    this.saved = new Vector3(); this.velocity = new Vector3();
    this.sample = new Vector3(); this.lastPosition = new Vector3();
    this.reset();
  }
  reset() {
    this.pending = false; this.searchPrepared = false;
    this.trapped = false; this.settledTime = 0; this.supportTime = 0;
    this.recoveryUsed = false; this.jumpCeiling = Infinity; this.groundY = null;
    this.preventedEntries = 0; this.lastPosition.copy(this.body.position);
  }
  get scanDrop() { return this.body.config.radius * 24 + this.body.config.stepHeight; }
  get guardDistance() { return this.pending ? this.scanDrop + this.body.config.radius * 2 : 0; }
  get canRecoverJump() { return this.trapped && this.settledTime >= .15 && !this.recoveryUsed; }

  closedContacts() {
    const body = this.body;
    if (body.recovery.contacts.some(p => p.walkable)) return false;
    this.angles.length = 0;
    for (const contact of body.recovery.contacts) {
      const n = contact.normal;
      if (n.y > 1e-4 && n.x * n.x + n.z * n.z > 1e-8) this.angles.push(Math.atan2(n.z, n.x));
    }
    if (this.angles.length < 3) return false;
    this.angles.sort((a, b) => a - b);
    let gap = this.angles[0] + Math.PI * 2 - this.angles[this.angles.length - 1];
    for (let i = 1; i < this.angles.length; i++) gap = Math.max(gap, this.angles[i] - this.angles[i - 1]);
    // Open valleys, walls and corridors leave a horizontal slide direction.
    return gap < Math.PI - 1e-3;
  }
  enclosed() {
    const body = this.body;
    if (body.grounded || Math.abs(body.velocity.y) > .1) return false;
    body.recovery.collect(body.config.skin * 4 + 2e-6);
    return this.closedContacts();
  }
  update(delta) {
    const body = this.body, c = body.config;
    if (body.grounded) {
      this.supportTime += delta; this.groundY = body.position.y;
      if (this.supportTime >= .12) { this.recoveryUsed = false; this.jumpCeiling = Infinity; }
      this.trapped = false; this.settledTime = 0;
    } else {
      this.supportTime = 0;
      this.trapped = this.enclosed() && !body.probeGround(c.groundSnap, c.skin * 4);
      const stationary = body.position.distanceToSquared(this.lastPosition) <= (c.skin * 4 + delta * .05) ** 2;
      this.settledTime = this.trapped && stationary ? this.settledTime + delta : 0;
    }
    this.lastPosition.copy(body.position);
  }
  normalJump() {
    // A later recovery hop remains tied to real ground, so wedging farther
    // up a mountainside cannot provide a higher launch.
    this.groundY = this.body.position.y; this.jumpCeiling = Infinity; this.settledTime = 0;
  }
  recoveryJump() {
    const body = this.body, c = body.config;
    if (!(c.gravity > 0 && c.jumpSpeed > 0) ) return false;
    const rise = c.jumpSpeed * c.jumpSpeed / (2 * c.gravity);
    this.jumpCeiling = Math.min(body.position.y + rise, (this.groundY ?? body.position.y) + rise);
    if (this.jumpCeiling <= body.position.y + c.skin * 4) return false;
    this.recoveryUsed = true; this.trapped = false; this.settledTime = 0;
    return true;
  }
  jumpSpeed() {
    const body = this.body, c = body.config;
    return Math.min(c.jumpSpeed, Math.sqrt(Math.max(0, 2 * c.gravity * (this.jumpCeiling - body.position.y))));
  }

  preventEntry() {
    if (!this.pending) { this.pending = true; this.searchPrepared = false; }
    // Stop at the lip for the asset preparation pass instead of testing
    // unavailable geometry during a catch-up step.
    if (!this.searchPrepared) return true;
    const trapped = this.predictPocket();
    if (trapped) this.preventedEntries++;
    else this.pending = false;
    return trapped;
  }
  predictPocket() {
    const body = this.body, c = body.config;
    this.saved.copy(body.position); this.velocity.copy(body.velocity);
    const floorResponse = body.floorResponse;
    body.position.addScaledVector(body.intent, c.radius);
    body.velocity.set(0, 0, 0);
    let blocked = false;
    // Settle a temporary capsule below the proposed footprint. This catches
    // deep narrow depressions before entry without filling real cliffs or
    // changing terrain/rock meshes.
    for (let i = 0; i < 64; i++) {
      this.sample.copy(body.position); body.position.y -= c.radius * .4;
      if (this.saved.y - body.position.y > this.scanDrop) break;
      if (body.findCollision()) {
        if (!body.recovery.recover()) break;
        body.recovery.collect(c.skin * 4 + 2e-6);
        if (body.recovery.contacts.some(p => p.walkable)) break;
        if (this.closedContacts()) { blocked = true; break; }
        if (body.position.distanceToSquared(this.sample) < c.skin * c.skin) break;
      }
      if (Math.hypot(body.position.x - this.saved.x, body.position.z - this.saved.z) > c.radius * 8) break;
    }
    body.position.copy(this.saved); body.velocity.copy(this.velocity); body.floorResponse = floorResponse; body.updateCapsule();
    return blocked;
  }
}
