import { CharacterBody } from "./CharacterBody.js";
import { touching } from "./Contacts.js";

export class PhysicsWorld {
  constructor({ fixedDelta = 1 / 60, maxCatchUpSteps = 5 } = {}) {
    if (!(fixedDelta > 0) || !Number.isFinite(fixedDelta) || !Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 1) throw new Error("Invalid physics timestep.");
    this.fixedDelta = fixedDelta; this.maxCatchUpSteps = maxCatchUpSteps;
    this.accumulator = 0; this.colliders = []; this.bodies = [];
    this.stats = { updateMs: 0, peakMs: 0, steps: 0, droppedSeconds: 0, triangleTests: 0, waitingForColliders: false };
  }
  addCollider(collider) { if (!this.colliders.includes(collider)) this.colliders.push(collider); return collider; }
  removeCollider(collider) { const i = this.colliders.indexOf(collider); if (i >= 0) this.colliders.splice(i, 1); }
  createCharacter(object = {}, options = {}) {
    const body = new CharacterBody(this, object, options); this.bodies.push(body); return body;
  }
  removeBody(body) { const i = this.bodies.indexOf(body); if (i >= 0) this.bodies.splice(i, 1); }
  touching(object, type = "any", mode = "ghost", dir = "any") { return touching(object, type, mode, dir); }
  query(bounds, visitor) { for (const collider of this.colliders) collider.query(bounds, visitor); }
  update(delta) {
    const started = performance.now();
    this.stats.steps = 0; this.stats.triangleTests = 0;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    const maximum = this.fixedDelta * this.maxCatchUpSteps;
    const total = this.accumulator + delta;
    this.accumulator = Math.min(total, maximum);
    this.stats.droppedSeconds += Math.max(0, total - maximum);
    this.stats.waitingForColliders = false;
    for (const collider of this.colliders) if (collider.prepare) for (const body of this.bodies) {
      const c = body.config;
      const guard = Math.min((body.velocity.length() + c.runSpeed) * maximum, c.radius * .4 * c.maxMotionSubsteps * this.maxCatchUpSteps) + c.stepHeight + c.groundSnap + body.rotationReach * 2;
      body.setBounds(guard);
      if (!collider.prepare(body.bounds)) this.stats.waitingForColliders = true;
    }
    if (this.stats.waitingForColliders) {
      this.stats.updateMs = performance.now() - started; this.stats.peakMs = Math.max(this.stats.peakMs, this.stats.updateMs); return 0;
    }
    while (this.accumulator + 1e-12 >= this.fixedDelta && this.stats.steps < this.maxCatchUpSteps) {
      for (const body of this.bodies) body.step(this.fixedDelta);
      this.accumulator = Math.max(0, this.accumulator - this.fixedDelta);
      this.stats.steps++;
    }
    this.stats.updateMs = performance.now() - started;
    this.stats.peakMs = Math.max(this.stats.peakMs, this.stats.updateMs);
    return this.stats.steps;
  }
  get alpha() { return this.accumulator / this.fixedDelta; }
  dispose() {
    for (const body of this.bodies) body.clearContacts();
    this.bodies.length = 0;
    for (const collider of this.colliders) collider.dispose?.();
    this.colliders.length = 0;
  }
}
