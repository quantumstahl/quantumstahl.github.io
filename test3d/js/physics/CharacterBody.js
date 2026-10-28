import { Vector3 } from "three";
import { CapsuleTriangle } from "./CapsuleTriangle.js";
import { initializeContacts, clearContacts, DIRECTIONS } from "./Contacts.js";

export const CHARACTER_DEFAULTS = Object.freeze({
  radius: .35, height: 1.2, walkSpeed: 3.5, runSpeed: 6,
  jumpSpeed: 6.5, gravity: 18, maxSlopeAngle: 45, stepHeight: .25,
  airControl: 8, groundSnap: .18, skin: .001, maxMotionSubsteps: 16,
  capsuleAxis: "vertical", length: 1.2, groundClearance: 0, offsetX: 0, offsetZ: 0,
});

const precedes = (id, object, previousId, previousObject) => id < previousId
  || (id === previousId && (object.id ?? object.name ?? "") < (previousObject?.id ?? previousObject?.name ?? ""));

export class CharacterBody {
  constructor(world, object, options) {
    this.world = world; this.object = initializeContacts(object);
    this.config = { ...CHARACTER_DEFAULTS, ...options };
    const c = this.config;
    for (const key in CHARACTER_DEFAULTS) {
      if (key === "capsuleAxis") continue;
      if (!Number.isFinite(c[key]) || (c[key] < 0 && key !== "offsetX" && key !== "offsetZ")) throw new Error(`Invalid character ${key}.`);
    }
    this.horizontal = c.capsuleAxis === "horizontal";
    if (!["vertical", "horizontal"].includes(c.capsuleAxis) || c.radius <= 0 || (this.horizontal ? c.length : c.height) < c.radius * 2
      || c.maxSlopeAngle >= 90 || !Number.isInteger(c.maxMotionSubsteps) || c.maxMotionSubsteps < 1) throw new Error("Invalid capsule dimensions or movement limits.");
    // Position is the visual placement/foot datum. Local torso offsets rotate
    // around it; the body never pitches or rolls with terrain or animation.
    this.position = new Vector3(); this.previousPosition = new Vector3();
    this.yaw = 0; this.previousYaw = 0; this.targetYaw = 0; this.turnBlocked = false;
    this.capsuleStart = new Vector3(); this.capsuleEnd = new Vector3();
    this.supportStart = new Vector3(); this.supportEnd = new Vector3();
    this.turnSaved = new Vector3();
    this.turnNormal = new Vector3(); this.turnPoint = new Vector3();
    this.halfSegment = ((this.horizontal ? c.length : c.height) - c.radius * 2) / 2;
    this.rotationReach = Math.hypot(c.offsetX, c.offsetZ) + (this.horizontal ? this.halfSegment : 0);
    this.velocity = new Vector3(); this.intent = new Vector3();
    this.groundNormal = new Vector3(0, 1, 0); this.groundPoint = new Vector3();
    this.grounded = false; this.running = false; this.jumpRequested = false;
    this.floorResponse = false;
    this.landed = false; this.state = "falling";
    this.minGroundY = Math.cos(c.maxSlopeAngle * Math.PI / 180);
    this.bounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    this.query = new CapsuleTriangle();
    this.normal = new Vector3(); this.faceNormal = new Vector3();
    this.saved = new Vector3(); this.stepSaved = new Vector3();
    this.bestPoint = new Vector3(); this.bestNormal = new Vector3();
    this.contactScores = new Float64Array(6); this.contactIds = new Float64Array(6);
    this.contactNormals = new Float64Array(18);
    this.visitCollision = this.testCollision.bind(this);
    this.visitGround = this.testGround.bind(this);
    this.visitContacts = this.testContact.bind(this);
    this.clearContacts();
  }

  setMovement(x, z, running = false) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) { x = 0; z = 0; }
    this.intent.set(x, 0, z);
    if (this.intent.lengthSq() > 1) this.intent.normalize();
    this.running = Boolean(running);
  }
  jump() { this.jumpRequested = true; }
  setYaw(yaw) { if (!Number.isFinite(yaw)) throw new Error("Invalid character yaw."); this.targetYaw = yaw; }
  teleport(x, y, z, yaw = this.yaw) {
    if (![x, y, z, yaw].every(Number.isFinite)) throw new Error("Invalid character position or yaw.");
    this.position.set(x, y, z); this.previousPosition.copy(this.position);
    this.yaw = this.previousYaw = this.targetYaw = yaw; this.turnBlocked = false;
    this.velocity.set(0, 0, 0); this.grounded = false; this.jumpRequested = false;
    this.clearContacts();
    this.updateCapsule();
  }
  clearContacts() {
    clearContacts(this.object); this.contactScores.fill(-Infinity); this.contactIds.fill(Infinity); this.contactNormals.fill(0);
  }
  updateCapsule() {
    const c = this.config, p = this.position, sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const x = p.x + c.offsetX * cos + c.offsetZ * sin, z = p.z + c.offsetZ * cos - c.offsetX * sin;
    if (this.horizontal) {
      this.capsuleStart.set(x - sin * this.halfSegment, p.y + c.radius + c.groundClearance, z - cos * this.halfSegment);
      this.capsuleEnd.set(x + sin * this.halfSegment, this.capsuleStart.y, z + cos * this.halfSegment);
    } else {
      this.capsuleStart.set(x, p.y + c.radius + c.groundClearance, z);
      this.capsuleEnd.set(x, p.y + c.height - c.radius + c.groundClearance, z);
    }
    // Lower support shape follows the same XZ footprint, at the paw/foot datum.
    // It queries only walkable ground; it never acts as a solid torso collider.
    this.supportStart.copy(this.capsuleStart); this.supportStart.y = p.y + c.radius;
    this.supportEnd.copy(this.horizontal ? this.capsuleEnd : this.capsuleStart); this.supportEnd.y = this.supportStart.y;
  }
  setBounds(extra = 0, support = false) {
    this.updateCapsule();
    const a = support ? this.supportStart : this.capsuleStart, c = support ? this.supportEnd : this.capsuleEnd;
    const b = this.bounds, r = this.config.radius + extra;
    b.minX = Math.min(a.x, c.x) - r; b.maxX = Math.max(a.x, c.x) + r;
    b.minZ = Math.min(a.z, c.z) - r; b.maxZ = Math.max(a.z, c.z) + r;
    b.minY = Math.min(a.y, c.y) - r; b.maxY = Math.max(a.y, c.y) + r;
  }
  rotate() {
    this.turnBlocked = false;
    const difference = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
    if (Math.abs(difference) < 1e-10) return;
    if (this.rotationReach === 0) { this.yaw += difference; return; }
    const maxAngle = this.config.radius * .4 / Math.max(this.rotationReach, this.config.radius);
    const count = Math.min(this.config.maxMotionSubsteps, Math.max(1, Math.ceil(Math.abs(difference) / maxAngle)));
    const increment = Math.sign(difference) * Math.min(Math.abs(difference) / count, maxAngle);
    for (let i = 0; i < count; i++) {
      const oldYaw = this.yaw, oldGroundObject = this.groundObject;
      this.turnSaved.copy(this.position); this.turnNormal.copy(this.groundNormal); this.turnPoint.copy(this.groundPoint);
      this.yaw += increment;
      let valid = false;
      for (let iteration = 0; iteration < 8; iteration++) {
        if (!this.findCollision()) { valid = true; break; }
        // Grounded turns may rise over a walkable slope. A wall/ceiling rejects
        // the turn; do not push the cat through a narrow opening to fit its yaw.
        if (!this.grounded || this.normal.y < this.minGroundY || this.faceNormal.y < this.minGroundY) break;
        this.position.y += this.depth / this.normal.y;
      }
      if (valid && this.grounded && this.probeGround(this.config.groundSnap, this.config.stepHeight)) {
        this.position.y += this.groundCorrection;
        this.groundNormal.copy(this.bestNormal); this.groundPoint.copy(this.bestPoint);
        // Ground adjustment must not lift a turning torso into a ceiling/wall.
        valid = !this.findCollision();
      }
      if (!valid) {
        this.yaw = oldYaw; this.position.copy(this.turnSaved);
        this.groundNormal.copy(this.turnNormal); this.groundPoint.copy(this.turnPoint); this.groundObject = oldGroundObject;
        this.turnBlocked = true; break;
      }
    }
  }
  findCollision() {
    this.depth = 0; this.bestId = Infinity; this.bestObject = null; this.setBounds(this.config.skin);
    this.world.query(this.bounds, this.visitCollision);
    return this.depth > 1e-7;
  }
  testCollision(a, b, c, object, id) {
    const q = this.query.testSegment(this.capsuleStart, this.capsuleEnd, a, b, c);
    this.world.stats.triangleTests++;
    const depth = this.config.radius + this.config.skin - q.distance;
    if (depth > this.depth + 1e-10 || (depth > 1e-7 && Math.abs(depth - this.depth) <= 1e-10 && precedes(id, object, this.bestId, this.bestObject))) {
      this.depth = depth; this.normal.copy(q.normal); this.faceNormal.copy(q.faceNormal); this.bestId = id; this.bestObject = object;
    }
  }
  resolve() {
    for (let i = 0; i < 8; i++) {
      if (!this.findCollision()) return true;
      const n = this.normal;
      if (n.y >= this.minGroundY && this.faceNormal.y >= this.minGroundY) {
        this.floorResponse = true;
        this.position.y += this.depth / n.y;
        if (this.velocity.y < 0) this.velocity.y = 0;
      } else if (n.y > 0 && this.faceNormal.y < this.minGroundY) {
        // A steep ramp cannot convert horizontal intent into upward motion.
        const horizontal = n.x * n.x + n.z * n.z;
        if (horizontal < 1e-10) return false;
        this.position.x += n.x * this.depth / horizontal;
        this.position.z += n.z * this.depth / horizontal;
        const inward = this.velocity.x * n.x + this.velocity.z * n.z;
        if (inward < 0) {
          this.velocity.x -= n.x * inward / horizontal; this.velocity.z -= n.z * inward / horizontal;
        }
      } else {
        this.position.addScaledVector(n, this.depth);
        const inward = this.velocity.dot(n);
        if (inward < 0) this.velocity.addScaledVector(n, -inward);
      }
    }
    return !this.findCollision();
  }
  testGround(a, b, c, object, id) {
    const q = this.query.testSegment(this.supportStart, this.supportEnd, a, b, c);
    if (q.faceNormal.y < this.minGroundY) return;
    if (q.normal.y < this.minGroundY) return;
    const correction = (this.config.radius + this.config.skin - q.distance) / q.normal.y;
    if (correction < -this.probeDistance || correction > this.probeRise) return;
    if (correction > this.groundCorrection + 1e-9 || (Math.abs(correction - this.groundCorrection) <= 1e-9 && precedes(id, object, this.groundId, this.groundObject))) {
      this.groundCorrection = correction; this.groundId = id; this.groundObject = object;
      this.bestPoint.copy(q.point); this.bestNormal.copy(q.faceNormal);
    }
  }
  probeGround(distance, rise = this.config.skin * 4) {
    this.probeDistance = distance; this.probeRise = rise;
    this.groundCorrection = -Infinity; this.groundId = Infinity; this.groundObject = null;
    this.setBounds(Math.max(distance, rise) + this.config.skin * 4, true);
    this.world.query(this.bounds, this.visitGround);
    return this.groundObject !== null;
  }
  tryStep() {
    const c = this.config;
    this.stepSaved.copy(this.position);
    this.position.y = this.saved.y + c.stepHeight;
    if (this.findCollision() || !this.probeGround(c.stepHeight + c.skin * 4)) { this.position.copy(this.stepSaved); return false; }
    this.position.y += this.groundCorrection;
    if (this.position.y < this.saved.y - c.skin * 4 || this.position.y > this.saved.y + c.stepHeight + c.skin * 4 || !this.resolve()) {
      this.position.copy(this.stepSaved); return false;
    }
    return true;
  }
  recordContact(object, id, normal, depth) {
    // World-relative: front=-Z, back=+Z, left=-X, right=+X.
    const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    const index = ay >= ax && ay >= az ? (normal.y > 0 ? 5 : 4)
      : ax >= az ? (normal.x > 0 ? 0 : 1) : (normal.z > 0 ? 2 : 3);
    // Favor the most axis-aligned supporting face, then depth, then ID.
    const score = Math.max(ax, ay, az) + Math.max(0, depth) * .01;
    if (score > this.contactScores[index] + 1e-9 || (Math.abs(score - this.contactScores[index]) <= 1e-9
      && precedes(id, object, this.contactIds[index], this.object.contactsSolid[DIRECTIONS[index]]))) {
      this.contactScores[index] = score; this.contactIds[index] = id;
      this.object.contactsSolid[DIRECTIONS[index]] = object;
      normal.toArray(this.contactNormals, index * 3);
    }
  }
  testContact(a, b, c, object, id) {
    const q = this.query.testSegment(this.capsuleStart, this.capsuleEnd, a, b, c);
    if (q.distance <= this.config.radius + this.config.skin * 4) this.recordContact(object, id, q.normal, this.config.radius - q.distance);
  }
  step(delta) {
    const c = this.config, wasGrounded = this.grounded;
    this.previousPosition.copy(this.position); this.previousYaw = this.yaw; this.clearContacts(); this.landed = false;
    this.rotate();
    const speed = this.running ? c.runSpeed : c.walkSpeed;
    const blend = wasGrounded ? 1 : 1 - Math.exp(-c.airControl * delta);
    this.velocity.x += (this.intent.x * speed - this.velocity.x) * blend;
    this.velocity.z += (this.intent.z * speed - this.velocity.z) * blend;
    const jumped = this.jumpRequested && wasGrounded;
    this.jumpRequested = false;
    if (jumped) { this.velocity.y = c.jumpSpeed; this.grounded = false; }
    else if (wasGrounded) this.velocity.y = 0;
    this.velocity.y -= c.gravity * delta;
    const travel = this.velocity.length() * delta;
    const maxTravel = c.radius * .4;
    const substeps = Math.min(c.maxMotionSubsteps, Math.max(1, Math.ceil(travel / maxTravel)));
    // Bound both solver cost and distance. Extreme velocities slow down rather
    // than skipping geometry after exhausting the conservative substep budget.
    const dt = delta * Math.min(1, substeps * maxTravel / Math.max(travel, 1e-12)) / substeps;
    for (let i = 0; i < substeps; i++) {
      this.floorResponse = false;
      this.saved.copy(this.position);
      const dx = this.velocity.x * dt, dz = this.velocity.z * dt;
      // Measure downward travel before slope projection and collision response.
      // The foot probe still needs to recover gravity while walking uphill.
      const fallTravel = Math.max(0, -this.velocity.y * dt);
      this.position.x += dx; this.position.z += dz; this.position.y += this.velocity.y * dt;
      if (this.grounded && !jumped) this.position.y -= (dx * this.groundNormal.x + dz * this.groundNormal.z) / this.groundNormal.y;
      const obstacle = this.findCollision() && this.faceNormal.y < this.minGroundY && this.normal.y >= 0;
      if (!(obstacle && this.grounded && !jumped && c.stepHeight > 0 && this.tryStep()) && !this.resolve()) {
        this.position.copy(this.saved); this.velocity.x = 0; this.velocity.z = 0;
      }
      this.grounded = false;
      // If the torso has actually landed, recover its lower paw probe through
      // the configured leg clearance too. This handles shallow spawn/edit
      // overlaps without selecting an unrelated surface above the character.
      const supportRise = Math.max(fallTravel, this.horizontal && wasGrounded ? c.stepHeight : 0, this.floorResponse ? c.groundClearance + fallTravel : 0) + c.skin * 4;
      if (!jumped && this.velocity.y <= 0 && this.probeGround(wasGrounded ? c.groundSnap : c.skin * 4, supportRise)) {
        this.stepSaved.copy(this.position);
        this.position.y += this.groundCorrection;
        if (this.resolve()) {
          this.grounded = true; this.velocity.y = 0;
          this.groundNormal.copy(this.bestNormal); this.groundPoint.copy(this.bestPoint);
        } else this.position.copy(this.stepSaved);
      }
    }
    // Only final-position contacts escape the solver; old/transient hits clear.
    this.clearContacts(); this.setBounds(c.skin * 4); this.world.query(this.bounds, this.visitContacts);
    if (this.grounded) { this.object.contactsSolid.down = this.groundObject; this.groundNormal.toArray(this.contactNormals, 15); }
    this.landed = !wasGrounded && this.grounded;
    this.state = this.grounded ? (this.intent.lengthSq() > .001 ? (this.running ? "running" : "walking") : "idle")
      : this.velocity.y > 0 ? "jumping" : "falling";
  }
}
