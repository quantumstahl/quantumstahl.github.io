// Coordinates encounters; enemy AI, authored triggers, static collision, and
// rewards remain owned by the existing systems. No physical sphere is created.
export class ArenaSystem {
  constructor(data, spiders, objects, collider, pickups, { onComplete = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { data, spiders, objects, collider, pickups, onComplete, onError });
    this.arenas = new Map(); this.completed = new Set(); this.active = new Set(); this.closed = new Set();
    this.enemyArena = new Map(); this.barrierArena = new Map(); this.invalid = new Set();
    for (const arena of data.volumes.values()) if (arena.type === 'Arena') {
      this.arenas.set(arena.id, arena);
      if (arena.completed) this.completed.add(arena.id);
      for (const id of arena.enemyIds) {
        const entry = spiders.entries.get(id);
        if (!entry || this.enemyArena.has(id)) { this.invalid.add(arena.id); onError(`Arena ${arena.name}: missing or shared enemy ${id}.`); continue; }
        this.enemyArena.set(id, arena.id); entry.persistent = true; spiders.setActive(id, false);
        if (arena.completed) spiders.defeated.add(id);
      }
      for (const id of arena.barrierIds) {
        const record = objects.data.objects.get(id), asset = objects.data.assets.get(record?.assetId);
        if (!record || this.barrierArena.has(id) || !asset?.collision || asset.collision.mode === 'none') {
          this.invalid.add(arena.id); onError(`Arena ${arena.name}: barrier ${id} needs a unique placed object with solid collision.`); continue;
        }
        this.barrierArena.set(id, arena.id);
      }
      if (arena.reward) pickups.registerEncounterReward(arena.id, arena.reward);
    }
    spiders.onDefeated = id => this.enemyDefeated(id);
    spiders.runtime.encounters = this;
    this.applyBarriers();
  }
  applyBarriers() {
    this.closed.clear();
    for (const [id, arenaId] of this.barrierArena) {
      const closed = this.active.has(arenaId) && !this.completed.has(arenaId);
      if (closed) this.closed.add(id);
      this.objects.setExcluded(id, !closed); this.collider?.setExcluded(id, !closed);
    }
  }
  enter(volume) {
    const arena = this.arenas.get(volume.id);
    if (!arena || !arena.enabled || this.completed.has(arena.id) || this.active.has(arena.id) || this.invalid.has(arena.id) || !arena.enemyIds.length) return false;
    this.active.add(arena.id);
    for (const id of arena.enemyIds) this.spiders.setActive(id, !this.spiders.defeated.has(id));
    this.applyBarriers();
    this.enemyDefeated(arena.enemyIds[0]);
    return true;
  }
  enemyDefeated(id) {
    const arena = this.arenas.get(this.enemyArena.get(id));
    if (!arena || !this.active.has(arena.id) || this.completed.has(arena.id) || !arena.enemyIds.every(id => this.spiders.defeated.has(id))) return;
    // Consume completion before any external hook or pickup can reenter us.
    this.completed.add(arena.id); this.active.delete(arena.id); this.applyBarriers();
    if (arena.reward) this.pickups.spawnEncounterReward(arena.id);
    this.onComplete(arena);
  }
  snapshot() { return { version: 1, completedIds: [...this.completed].sort(), activeIds: [...this.active].sort(), closedBarrierIds: [...this.closed].sort() }; }
  compatibleState(state) {
    const result = structuredClone(state);
    if (result?.version !== 1 || !['completedIds', 'activeIds', 'closedBarrierIds'].every(key => Array.isArray(result[key])
      && result[key].every(id => typeof id === 'string') && new Set(result[key]).size === result[key].length)) throw new Error('Invalid arena save.');
    const active = new Set(result.activeIds);
    if (result.completedIds.some(id => active.has(id)) || (!active.size && result.closedBarrierIds.length)) throw new Error('Inconsistent saved web barriers.');
    // Only derive known barrier state. Removed references stay subject to strict
    // validation; adding another web to an active arena is safe to reconcile.
    if (result.closedBarrierIds.some(id => !this.barrierArena.has(id))) return result;
    if (result.closedBarrierIds.some(id => !active.has(this.barrierArena.get(id)))) throw new Error('Inconsistent saved web barriers.');
    result.closedBarrierIds = [...this.barrierArena].filter(([, arenaId]) => active.has(arenaId)).map(([id]) => id).sort();
    return result;
  }
  validate(state, enemyState, pickupState) {
    state ??= this.initialState();
    if (state.version !== 1) throw new Error('Invalid arena save.');
    for (const key of ['completedIds', 'activeIds', 'closedBarrierIds']) {
      if (!Array.isArray(state[key]) || new Set(state[key]).size !== state[key].length) throw new Error('Invalid arena save IDs.');
    }
    const completed = new Set(state.completedIds), active = new Set(state.activeIds), defeated = new Set(enemyState?.defeatedIds ?? []);
    for (const id of completed) if (!this.arenas.has(id) || active.has(id)) throw new Error('Invalid completed arena.');
    for (const id of active) if (!this.arenas.has(id) || this.invalid.has(id)) throw new Error('Invalid active arena.');
    const expectedClosed = new Set();
    for (const [id, arenaId] of this.barrierArena) if (active.has(arenaId)) expectedClosed.add(id);
    if (state.closedBarrierIds.length !== expectedClosed.size || state.closedBarrierIds.some(id => !expectedClosed.has(id))) throw new Error('Inconsistent saved web barriers.');
    for (const arena of this.arenas.values()) {
      const allDead = arena.enemyIds.length > 0 && arena.enemyIds.every(id => defeated.has(id));
      if (arena.completed && !completed.has(arena.id)) throw new Error('Authored completed arena cannot be reset by a save.');
      if (allDead !== completed.has(arena.id) && !arena.completed) throw new Error('Arena completion disagrees with enemy defeat state.');
      const rewardId = `arena:${arena.id}:reward`;
      const hasReward = pickupState?.collectedIds.includes(rewardId) || pickupState?.pickups.some(p => p.id === rewardId);
      if (arena.reward && !arena.completed && !!hasReward !== completed.has(arena.id)) throw new Error('Inconsistent encounter reward state.');
    }
  }
  initialState() {
    return { version: 1, completedIds: [...this.arenas.values()].filter(a => a.completed).map(a => a.id), activeIds: [], closedBarrierIds: [] };
  }
  restore(state) {
    state ??= this.initialState();
    this.completed = new Set(state.completedIds); this.active = new Set(state.activeIds);
    for (const arena of this.arenas.values()) if (arena.completed) for (const id of arena.enemyIds) this.spiders.defeated.add(id);
    // Active saves restart living bosses at home/full health; gates stay closed.
    // Restoring completed arenas never calls completion hooks or creates rewards.
    for (const arena of this.arenas.values()) for (const id of arena.enemyIds) this.spiders.setActive(id, this.active.has(arena.id) && !this.completed.has(arena.id));
    this.applyBarriers();
  }
  resetActive() {
    for (const id of this.active) for (const enemyId of this.arenas.get(id).enemyIds) {
      this.spiders.setActive(enemyId, false); this.spiders.resetEnemy(enemyId);
    }
    this.active.clear(); this.applyBarriers();
  }
  dispose() {
    this.spiders.onDefeated = null;
    if (this.spiders.runtime.encounters === this) this.spiders.runtime.encounters = null;
  }
}
