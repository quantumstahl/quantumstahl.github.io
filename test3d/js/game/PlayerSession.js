const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
function validateAuthored(value) {
  if (value?.version !== 1 || !Array.isArray(value.boxes) || !Array.isArray(value.pickupIds)
    || value.boxes.some(b => typeof b?.id !== 'string' || !b.id || !vector(b.position))
    || new Set(value.boxes.map(b => b.id)).size !== value.boxes.length
    || value.pickupIds.some(id => typeof id !== 'string' || !id) || new Set(value.pickupIds).size !== value.pickupIds.length) throw new Error('Invalid authored save manifest.');
}

// Adapter around existing runtime snapshots. Menus never own gameplay state.
export class PlayerSession {
  constructor({ runtime, pickups, boxes, destructibles, environment }) {
    Object.assign(this, { runtime, pickups, boxes, destructibles, environment });
    this.playTime = 0;
    this.authored = { version: 1, boxes: boxes.snapshot().boxes.map(box => ({ id: box.id,
      position: [...(boxes.data?.objects.get(box.id)?.position ?? box.position)] })), pickupIds: [...(pickups.authored?.keys() ?? [])] };
    this.initial = this.capture();
  }
  get canSave() { return !this.runtime.deathSequence?.active && this.runtime.health.current > 0; }
  capture() {
    const r = this.runtime;
    return { version: 1, player: { position: r.body.position.toArray(), yaw: r.body.yaw,
      velocity: r.body.velocity.toArray(), grounded: r.body.grounded, health: r.health.snapshot() },
      triggers: r.triggers.snapshotState(), pickups: this.pickups.snapshot(), boxes: this.boxes.snapshot(),
      destruction: this.destructibles.snapshot(), timeOfDay: this.environment.timeOfDay, playTime: this.playTime,
      authored: structuredClone(this.authored),
      ...(r.enemies ? { enemies: r.enemies.snapshot() } : {}),
      ...(r.cinematic ? { mountainTitle: r.cinematic.snapshot() } : {}),
      ...(r.encounters ? { encounters: r.encounters.snapshot() } : {}) };
  }
  validate(state) {
    const p = state?.player;
    if (state?.version !== 1 || !p || !vector(p.position) || !vector(p.velocity) || !Number.isFinite(p.yaw)
      || typeof p.grounded !== "boolean" || !(p.health?.current > 0)
      || !Number.isFinite(state.timeOfDay) || state.timeOfDay < 0 || state.timeOfDay >= 1
      || !Number.isFinite(state.playTime) || state.playTime < 0) throw new Error("Invalid adventure save.");
    if (state.authored != null) validateAuthored(state.authored);
    this.runtime.health.restore(p.health, true);
    this.runtime.triggers.restoreState(state.triggers, true);
    this.pickups.restore(state.pickups, true); this.boxes.restore(state.boxes, true);
    this.destructibles.validateSnapshot(state.destruction);
    this.runtime.enemies?.restore(state.enemies, true);
    this.runtime.cinematic?.restore(state.mountainTitle, true);
    this.runtime.encounters?.validate(state.encounters, state.enemies, state.pickups);
    const destroyed = new Set(state.destruction.destroyed), boxes = new Set(state.boxes.boxes.map(box => box.id));
    const expected = this.initial.boxes.boxes.filter(box => !destroyed.has(box.id));
    if (boxes.size !== expected.length || expected.some(box => !boxes.has(box.id))) throw new Error("Incomplete saved crate state.");
    if (state.pickups.boxDrops.some(drop => !destroyed.has(drop.boxId))) throw new Error("Saved reward has no destroyed source.");
  }
  compatibleState(state) {
    const result = structuredClone(state);
    if (result?.encounters && this.runtime.encounters?.compatibleState) result.encounters = this.runtime.encounters.compatibleState(result.encounters);
    // Old v1 saves remain readable. Without an authoring manifest, retain strict
    // validation rather than guessing which missing records are new additions.
    if (result?.authored == null) return result;
    validateAuthored(result.authored);
    if (!Array.isArray(result.boxes?.boxes) || !Array.isArray(result.destruction?.destroyed)) throw new Error('Invalid saved world state.');
    const oldBoxes = new Map(result.authored.boxes.map(b => [b.id, b]));
    const currentBoxes = new Map(this.authored.boxes.map(b => [b.id, b]));
    const savedIds = new Set(), destroyed = new Set(result.destruction.destroyed);
    for (const box of result.boxes.boxes) {
      if (typeof box?.id !== 'string' || savedIds.has(box.id) || !vector(box.position)
        || !Number.isFinite(box.velocityY) || box.velocityY > 0 || typeof box.sleeping !== 'boolean') throw new Error('Invalid saved box state.');
      savedIds.add(box.id);
      const before = oldBoxes.get(box.id), after = currentBoxes.get(box.id);
      if (!before || !after) continue;
      if (box.position[0] !== before.position[0] || box.position[2] !== before.position[2]) throw new Error('Saved crate position disagrees with its authored manifest.');
      if (before.position.some((n, i) => n !== after.position[i])) {
        box.position = [after.position[0], box.position[1] + after.position[1] - before.position[1], after.position[2]];
        box.velocityY = 0; box.sleeping = false; // Recompute support after an editor move.
      }
    }
    for (const box of this.initial.boxes.boxes) if (!oldBoxes.has(box.id) && !savedIds.has(box.id) && !destroyed.has(box.id)) result.boxes.boxes.push(structuredClone(box));
    if (!Array.isArray(result.pickups?.pickups) || !Array.isArray(result.pickups.collectedIds)) throw new Error('Invalid pickup save.');
    const oldPickups = new Set(result.authored.pickupIds), seen = new Set(result.pickups.collectedIds);
    for (const pickup of result.pickups.pickups) seen.add(pickup.id);
    for (const pickup of this.initial.pickups.pickups) if (pickup.source === 'authored' && !oldPickups.has(pickup.id) && !seen.has(pickup.id)) result.pickups.pickups.push(structuredClone(pickup));
    result.authored = structuredClone(this.authored);
    return result;
  }
  matchesLegacy(state) {
    const data = this.boxes.data ?? this.runtime.objectCollider?.data;
    const known = new Set([...(data?.objects?.keys() ?? []), ...(this.runtime.triggers?.data?.volumes?.keys() ?? []),
      ...this.authored.boxes.map(b => b.id), ...this.authored.pickupIds, ...(this.runtime.enemies?.entries?.keys() ?? [])]);
    const ids = [];
    const add = values => { if (Array.isArray(values)) ids.push(...values); };
    ids.push(state?.triggers?.activeCheckpointId);
    add(state?.triggers?.activatedOnceIds); add(state?.pickups?.collectedIds); add(state?.destruction?.destroyed);
    add(state?.enemies?.defeatedIds); add(state?.encounters?.completedIds); add(state?.encounters?.activeIds);
    if (Array.isArray(state?.boxes?.boxes)) ids.push(...state.boxes.boxes.map(b => b?.id));
    if (Array.isArray(state?.pickups?.pickups)) ids.push(...state.pickups.pickups.flatMap(p => [p?.id, p?.boxId]));
    return ids.some(id => typeof id === 'string' && known.has(id));
  }
  async restore(state) {
    state = this.compatibleState(state);
    this.validate(state);
    // Resolve required animated solids before touching the live session.
    await this.destructibles.prepareRestore(state.destruction);
    const previous = this.capture();
    try { this.apply(state); }
    catch (error) { this.apply(previous); throw error; }
  }
  apply(state) {
    const r = this.runtime, p = state.player;
    r.deathSequence?.cancel(); r.combat?.cancel();
    this.destructibles.resetSession();
    this.boxes.restore(state.boxes);
    // Box offsets must exist before recreating animated fallen-tree colliders.
    this.destructibles.restore(state.destruction);
    for (const id of state.destruction.destroyed) this.boxes.remove(id);
    this.pickups.restore(state.pickups);
    r.triggers.restoreState(state.triggers); r.health.restore(p.health);
    r.body.teleport(...p.position, p.yaw); r.body.velocity.fromArray(p.velocity); r.body.grounded = p.grounded;
    r.body.setMovement(0, 0); r.input.reset(); r.physics.accumulator = 0;
    r.damageInvulnerability = 0;
    // Persist defeat/completion. Living enemies restart at home/full health;
    // arena active/closed state is restored without replaying victory rewards.
    r.enemies?.restore(state.enemies);
    r.encounters?.restore(state.encounters);
    r.cinematic?.restore(state.mountainTitle);
    this.environment.timeOfDay = state.timeOfDay; this.environment.update(0); this.playTime = state.playTime;
    r.smartCamera.initialized = false; r.syncVisual(1, 0);
  }
  async reset() { await this.restore(structuredClone(this.initial)); }
  update(delta) { this.playTime += delta; }
}
