// Exact capsule/axis-aligned box overlap: squared segment-to-box distance is
// quadratic between the segment's crossings of the six box planes.
export function overlapsTrigger(body, volume) {
  if (volume.type === 'Arena') {
    if ((volume.minHeight != null && body.position.y < volume.minHeight) || (volume.maxHeight != null && body.position.y > volume.maxHeight)) return false;
    const a = body.capsuleStart, b = body.capsuleEnd, p = volume.position;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length = dx * dx + dy * dy + dz * dz;
    const t = length > 0 ? Math.max(0, Math.min(1, ((p[0] - a.x) * dx + (p[1] - a.y) * dy + (p[2] - a.z) * dz) / length)) : 0;
    return (a.x + dx * t - p[0]) ** 2 + (a.y + dy * t - p[1]) ** 2 + (a.z + dz * t - p[2]) ** 2 <= (volume.radius + body.config.radius) ** 2;
  }
  const a = body.capsuleStart, b = body.capsuleEnd, cuts = [0, 1];
  const min = [], max = [], start = [a.x, a.y, a.z], delta = [b.x - a.x, b.y - a.y, b.z - a.z];
  for (let axis = 0; axis < 3; axis++) {
    min[axis] = volume.position[axis] - volume.size[axis] / 2;
    max[axis] = volume.position[axis] + volume.size[axis] / 2;
    if (delta[axis]) for (const plane of [min[axis], max[axis]]) {
      const t = (plane - start[axis]) / delta[axis];
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((x, y) => x - y);
  const distance = t => start.reduce((sum, p, axis) => {
    const x = p + delta[axis] * t;
    return sum + Math.max(min[axis] - x, 0, x - max[axis]) ** 2;
  }, 0);
  const radiusSquared = body.config.radius ** 2;
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1], hi = cuts[i], mid = (lo + hi) / 2;
    let quadratic = 0, linear = 0;
    for (let axis = 0; axis < 3; axis++) {
      const p = start[axis] + delta[axis] * mid;
      const plane = p < min[axis] ? min[axis] : p > max[axis] ? max[axis] : null;
      if (plane === null) continue;
      quadratic += delta[axis] ** 2; linear += delta[axis] * (start[axis] - plane);
    }
    const closest = quadratic ? Math.max(lo, Math.min(hi, -linear / quadratic)) : mid;
    if (Math.min(distance(lo), distance(hi), distance(closest)) <= radiusSquared) return true;
  }
  return false;
}

export class TriggerSystem {
  constructor(data, body, { state = null, onEnter = () => {}, onExit = () => {}, onRespawn = () => {}, onKillZone = null } = {}) {
    Object.assign(this, { data, body, onEnter, onExit, onRespawn, onKillZone });
    this.respawnPending = false;
    this.levelStart = { position: body.position.toArray(), yaw: body.yaw };
    this.inside = new Map(); this.suppressedKills = new Set();
    this.state = { activeCheckpointId: null, respawnPoint: null };
    this.consumed = new Set();
    if (state) this.restoreState(state);
  }
  // JSON-ready seam for a future worldState/save slot. Never serialize occupancy
  // or respawn suppression: those are rebuilt from the destination's overlaps.
  snapshotState() { return { ...structuredClone(this.state), activatedOnceIds: [...this.consumed].sort() }; }
  restoreState(state, validateOnly = false) {
    const checkpoint = this.data.volumes.get(state.activeCheckpointId);
    const spawn = state.respawnPoint;
    if (state.activeCheckpointId != null && (checkpoint?.type !== "Checkpoint" || !spawn
      || !Array.isArray(spawn.position) || spawn.position.length !== 3 || !spawn.position.every(Number.isFinite) || !Number.isFinite(spawn.yaw))) throw new Error("Invalid saved checkpoint state.");
    if (!Array.isArray(state.activatedOnceIds) || !state.activatedOnceIds.every(id => typeof id === "string")) throw new Error("Invalid saved trigger state.");
    if (state.activatedOnceIds.some(id => !this.data.volumes.has(id))) throw new Error("Saved trigger is missing from this world.");
    if (new Set(state.activatedOnceIds).size !== state.activatedOnceIds.length) throw new Error("Duplicate saved trigger ID.");
    if (validateOnly) return;
    this.state = { activeCheckpointId: checkpoint?.id ?? null, respawnPoint: checkpoint ? structuredClone(spawn) : null };
    this.consumed = new Set(state.activatedOnceIds);
    this.respawnPending = false; this.inside.clear(); this.suppressedKills.clear();
  }
  resetSession() {
    this.state = { activeCheckpointId: null, respawnPoint: null }; this.consumed.clear();
    this.respawn();
  }
  overlaps() {
    this.body.updateCapsule();
    const result = new Map();
    // ID order makes simultaneous checkpoint activation independent of file order.
    for (const volume of [...this.data.volumes.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (volume.enabled && overlapsTrigger(this.body, volume)) result.set(volume.id, volume);
    }
    return result;
  }
  update() {
    if (this.respawnPending) return true;
    const current = this.overlaps(), entered = [];
    for (const id of this.suppressedKills) if (!current.has(id)) this.suppressedKills.delete(id);
    for (const [id, volume] of this.inside) if (!current.has(id)) this.onExit(volume, this.body);
    for (const [id, volume] of current) if (!this.inside.has(id) && !(volume.type === "KillZone" && this.suppressedKills.has(id))
      && !(volume.once && this.consumed.has(id))) entered.push(volume);
    this.inside = current;
    // Activate entered checkpoints before evaluating death. Never select by distance.
    for (const volume of entered) if (volume.type === "Checkpoint") {
      this.state.activeCheckpointId = volume.id;
      this.state.respawnPoint = structuredClone(volume.respawn);
    }
    for (const volume of entered) {
      if (volume.once) this.consumed.add(volume.id);
      this.onEnter(volume, this.body);
    }
    if (entered.some(volume => volume.type === "KillZone")) {
      this.respawnPending = true;
      if (this.onKillZone) this.onKillZone(); else this.respawn();
      return true;
    }
    return false;
  }
  respawn() {
    this.respawnPending = false;
    const point = this.state.respawnPoint ?? this.levelStart;
    this.body.teleport(...point.position, point.yaw);
    const destination = this.overlaps();
    for (const [id, volume] of this.inside) if (!destination.has(id)) this.onExit(volume, this.body);
    this.inside = destination;
    this.suppressedKills = new Set([...destination.values()].filter(v => v.type === "KillZone").map(v => v.id));
    this.onRespawn(point, this.body);
  }
}
