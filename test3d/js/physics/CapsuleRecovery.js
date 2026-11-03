import { Vector3 } from "three";

// Closest point to the origin in an intersection of contact half-spaces.
// In 3D the closest point has at most three independent active constraints.
function closestTranslation(contacts, target, limit) {
  let best = limit * limit;
  let found = false;
  const consider = (x, y, z) => {
    const length = x * x + y * y + z * z;
    if (length > best) return;
    for (const p of contacts) if (p.normal.x * x + p.normal.y * y + p.normal.z * z < p.depth - 1e-8) return;
    target.set(x, y, z); best = length; found = true;
  };
  consider(0, 0, 0);
  for (let i = 0; i < contacts.length; i++) {
    const a = contacts[i], n = a.normal;
    consider(n.x * a.depth, n.y * a.depth, n.z * a.depth);
    for (let j = 0; j < i; j++) {
      const b = contacts[j], m = b.normal, ab = n.dot(m), det = 1 - ab * ab;
      if (det < 1e-10) continue;
      const u = (a.depth - ab * b.depth) / det, v = (b.depth - ab * a.depth) / det;
      if (u >= 0 && v >= 0) consider(n.x * u + m.x * v, n.y * u + m.y * v, n.z * u + m.z * v);
      for (let k = 0; k < j; k++) {
        const c = contacts[k], l = c.normal, ac = n.dot(l), bc = m.dot(l);
        const determinant = 1 + 2 * ab * ac * bc - ab * ab - ac * ac - bc * bc;
        if (determinant < 1e-10) continue;
        const s = ((1 - bc * bc) * a.depth + (ac * bc - ab) * b.depth + (ab * bc - ac) * c.depth) / determinant;
        const t = ((ac * bc - ab) * a.depth + (1 - ac * ac) * b.depth + (ab * ac - bc) * c.depth) / determinant;
        const w = ((ab * bc - ac) * a.depth + (ab * ac - bc) * b.depth + det * c.depth) / determinant;
        if (s >= 0 && t >= 0 && w >= 0) consider(n.x * s + m.x * t + l.x * w, n.y * s + m.y * t + l.y * w, n.z * s + m.z * t + l.z * w);
      }
    }
  }
  return found;
}

const ESCAPE_DIRECTIONS = [];
for (let y = 1; y >= -1; y--) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) ESCAPE_DIRECTIONS.push(new Vector3(x, y, z).normalize());
}

export class CapsuleRecovery {
  constructor(body) {
    this.body = body;
    this.origin = new Vector3(); this.candidate = new Vector3(); this.best = new Vector3(); this.translation = new Vector3();
    this.contacts = []; this.contactPool = []; this.planes = [];
    this.visit = this.contact.bind(this); this.visitPath = this.pathContact.bind(this); this.visitPlane = this.planeContact.bind(this);
  }
  get maxDistance() { return this.body.config.radius * 2 + this.body.config.stepHeight; }
  contact(a, b, c, object, id) {
    const body = this.body, q = body.query.testSegment(body.capsuleStart, body.capsuleEnd, a, b, c);
    body.world.stats.triangleTests++;
    const depth = body.config.radius + body.config.skin - q.distance;
    if (depth < -this.contactMargin) return;
    const index = this.contacts.length;
    const contact = this.contactPool[index] ??= { normal: new Vector3() };
    contact.object = object; contact.id = id; contact.depth = depth; contact.normal.copy(q.normal);
    contact.walkable = q.normal.y >= body.minGroundY && q.faceNormal.y >= body.minGroundY;
    this.contacts.push(contact);
  }
  collect(margin = 1e-7) {
    const body = this.body;
    this.contactMargin = margin;
    this.contacts.length = 0; body.setBounds(body.config.skin + margin);
    body.world.query(body.bounds, this.visit);
  }
  capturePinch() {
    this.origin.copy(this.body.position); this.collect();
    for (let i = 0; i < this.contacts.length; i++) for (let j = 0; j < i; j++) {
      const a = this.contacts[i].normal, b = this.contacts[j].normal;
      const aa = a.x * a.x + a.z * a.z, bb = b.x * b.x + b.z * b.z;
      if (aa > 1e-8 && bb > 1e-8 && a.x * b.x + a.z * b.z < -.5 * Math.sqrt(aa * bb)) return true;
    }
    return false;
  }
  addPlane(normal, depth) {
    const same = this.planes.find(p => p.normal.dot(normal) > 1 - 1e-8);
    if (same) same.depth = Math.max(same.depth, depth);
    else this.planes.push({ normal: normal.clone(), depth });
  }
  planeContact(a, b, c) {
    const body = this.body, q = body.query.testSegment(body.capsuleStart, body.capsuleEnd, a, b, c);
    body.world.stats.triangleTests++;
    const depth = body.config.radius + body.config.skin - q.distance;
    if (depth <= 1e-7) return;
    const p = body.position, o = this.origin, n = q.normal;
    this.addPlane(n, depth + n.x * (p.x - o.x) + n.y * (p.y - o.y) + n.z * (p.z - o.z) + 1e-6);
  }
  pathContact(a, b, c, object, id) {
    if (!this.pathValid) return;
    const body = this.body, q = body.query.testSegment(body.capsuleStart, body.capsuleEnd, a, b, c);
    body.world.stats.triangleTests++;
    const depth = body.config.radius + body.config.skin - q.distance;
    if (depth <= 1e-7) return;
    const original = this.contacts.find(p => p.object === object && p.id === id);
    // Existing overlaps may only get shallower, on their original side.
    // All other geometry (including bridge undersides) must remain clear.
    if (!original || depth > original.depth + 1e-7 || q.normal.dot(original.normal) < -1e-7) this.pathValid = false;
  }
  reachable(target) {
    const body = this.body, distance = this.origin.distanceTo(target);
    const steps = Math.max(1, Math.ceil(distance / (body.config.radius * .2)));
    this.pathValid = true;
    for (let i = 1; i <= steps && this.pathValid; i++) {
      body.position.lerpVectors(this.origin, target, i / steps); body.setBounds(body.config.skin);
      body.world.query(body.bounds, this.visitPath);
    }
    return this.pathValid;
  }
  recover({ allowSearch = true } = {}) {
    const body = this.body, c = body.config;
    this.origin.copy(body.position); this.collect();
    if (!this.contacts.some(p => p.depth > 1e-7)) return true;
    // Recovery is local. Large holes are real spaces, not a reason to warp
    // through a wall or move the character to a remote spawn point.
    const limit = this.maxDistance;
    this.planes.length = 0;
    for (const contact of this.contacts) this.addPlane(contact.normal, contact.depth + 1e-6);
    let found = false;
    // Add newly encountered faces to the same solve instead of pushing into
    // them in turn. Bound both work and displacement on dense meshes.
    for (let iteration = 0; iteration < 8 && this.planes.length <= 24; iteration++) {
      if (!closestTranslation(this.planes, this.translation, limit)) break;
      this.candidate.copy(this.origin).add(this.translation); body.position.copy(this.candidate);
      if (!body.findCollision()) {
        if (this.reachable(this.candidate)) { this.best.copy(this.candidate); found = true; }
        break;
      }
      body.world.query(body.bounds, this.visitPlane);
    }
    if (!found && allowSearch) {
      // Parallel faces in a finite crack have no feasible plane intersection.
      // Search its nearby rim/ends and refine the closest reachable exit. The
      // full capsule and the path are checked, never just a foot-height ray.
      let bestDistance = limit;
      const increment = c.radius * .25;
      for (const direction of ESCAPE_DIRECTIONS) {
        for (let distance = increment; distance <= bestDistance + increment; distance += increment) {
          const reach = Math.min(distance, bestDistance);
          this.candidate.copy(this.origin).addScaledVector(direction, reach); body.position.copy(this.candidate);
          if (!body.findCollision() && this.reachable(this.candidate)) {
            let low = Math.max(0, reach - increment), high = reach;
            for (let i = 0; i < 12; i++) {
              const mid = (low + high) / 2;
              body.position.copy(this.origin).addScaledVector(direction, mid);
              if (body.findCollision()) low = mid; else high = mid;
            }
            this.candidate.copy(this.origin).addScaledVector(direction, high);
            if (this.reachable(this.candidate)) { this.best.copy(this.candidate); bestDistance = high; found = true; }
            break;
          }
          if (reach === bestDistance) break;
        }
      }
    }
    body.position.copy(found ? this.best : this.origin);
    body.updateCapsule();
    if (found) {
      // Project velocity against the final contacts, preserving jump and
      // tangential speed. Positional escape must not become a launch impulse.
      this.collect(c.skin * 3 + 2e-6); this.planes.length = 0;
      if (this.contacts.some(p => p.walkable)) body.floorResponse = true;
      for (const p of this.contacts) this.planes.push({ normal: p.normal, depth: -body.velocity.dot(p.normal) });
      if (this.planes.length <= 24 && closestTranslation(this.planes, this.translation, body.velocity.length() + 1e-6)) body.velocity.add(this.translation);
    }
    return found;
  }
}
