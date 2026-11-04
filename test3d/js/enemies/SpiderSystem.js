import { SpiderEnemy } from './SpiderEnemy.js';
import { isSpider, spiderConfig, spiderType } from './SpiderConfig.js';

export class SpiderSystem {
  constructor(scene, runtime, data, assets, objects, { onError = () => {} } = {}) {
    Object.assign(this, { scene, runtime, data, assets, objects, onError });
    this.entries = new Map(); this.generation = 0; this.disposed = false;
    this.defeated = new Set(); this.onDefeated = null;
    for (const record of data.objects.values()) if (isSpider(record, data.assets.get(record.assetId))) this.add(record);
    runtime.enemies = this;
  }
  add(record) {
    if (this.entries.has(record.id)) return;
    const config = spiderConfig(record.properties?.enemy, spiderType(record, this.data.assets.get(record.assetId)) ?? 'spider');
    this.entries.set(record.id, { record, config, enemy: null, pending: false, failed: false, active: true,
      persistent: config.type === 'spiderbig', generation: 0 });
    // The enemy owns its visual and overlap sphere. Do not leave a static GLB
    // or static collider behind at its original authored position.
    if (this.data.objects.has(record.id)) {
      this.objects.setExcluded(record.id, true);
      this.runtime.objectCollider?.setExcluded(record.id, true);
    }
  }
  async load(entry) {
    entry.pending = true;
    const generation = this.generation, entryGeneration = entry.generation, { record, config } = entry;
    const lease = this.assets.acquire(record.assetId);
    let enemy;
    try {
      const source = await lease.promise;
      if (this.disposed || generation !== this.generation || entryGeneration !== entry.generation || this.defeated.has(record.id)) { lease.release(); return; }
      enemy = new SpiderEnemy(this.scene, this.runtime.physics, this.runtime.melee, record, config);
      enemy.lease = lease;
      enemy.setModel(this.assets.clone(source), source.animations);
      enemy.enabled = entry.active;
      enemy.onDeath = () => {
        if (entry.persistent) this.defeated.add(record.id);
        this.onDefeated?.(record.id);
      };
      entry.enemy = enemy;
    } catch (error) {
      if (enemy) enemy.dispose(); else lease.release();
      if (this.disposed || generation !== this.generation || entryGeneration !== entry.generation) return;
      entry.failed = true; this.onError(`Spider: ${error.message}`);
    } finally { if (generation === this.generation && entryGeneration === entry.generation) entry.pending = false; }
  }
  nearby(entry) {
    const point = entry.enemy?.body.position;
    const p = this.runtime.body.position, home = entry.record.position;
    const distance = Math.hypot(p.x - (point?.x ?? home[0]), p.z - (point?.z ?? home[2]));
    return distance <= Math.max(24, entry.config.leashRadius * 2 + 4);
  }
  // Called after each fixed player physics step, before the cat's claw window.
  step(delta) {
    if (this.runtime.health.current <= 0 || this.runtime.deathSequence?.active) return;
    for (const entry of this.entries.values()) {
      if (entry.active && entry.enemy?.enabled && (this.nearby(entry) || entry.enemy.returning || entry.enemy.state !== 'idle')) entry.enemy.step(delta, this.runtime);
      if (this.runtime.health.current <= 0) break;
    }
  }
  update(delta) {
    delta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
    for (const entry of this.entries.values()) {
      const nearby = this.nearby(entry);
      if (nearby && !entry.enemy && !entry.pending && !entry.failed && !this.defeated.has(entry.record.id)) void this.load(entry);
      if (!entry.enemy) continue;
      if (entry.enemy.state !== 'dead') entry.enemy.root.visible = nearby;
      // Finish death reactions even when leaving the activation area.
      if (nearby || entry.enemy.state === 'dead') entry.enemy.updateVisual(delta);
    }
  }
  resetSession() {
    this.defeated.clear();
    this.restart();
  }
  restart() {
    ++this.generation;
    for (const entry of this.entries.values()) {
      entry.enemy?.dispose(); entry.enemy = null; entry.pending = false; entry.failed = false;
    }
    this.update(0);
  }
  setActive(id, active) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.active = active;
    // Waiting arena bosses are visible, but cannot take pre-encounter claw hits.
    if (entry.enemy?.health > 0) entry.enemy.enabled = active;
  }
  resetEnemy(id) {
    const entry = this.entries.get(id); if (!entry) return;
    ++entry.generation; entry.enemy?.dispose(); entry.enemy = null; entry.pending = false; entry.failed = false;
  }
  snapshot() { return { version: 1, defeatedIds: [...this.defeated].sort() }; }
  restore(state, validateOnly = false) {
    state ??= { version: 1, defeatedIds: [] }; // Saves made before minibosses.
    if (state.version !== 1 || !Array.isArray(state.defeatedIds) || new Set(state.defeatedIds).size !== state.defeatedIds.length
      || state.defeatedIds.some(id => !this.entries.get(id)?.persistent)) throw new Error('Invalid saved spider defeat state.');
    if (validateOnly) return;
    this.defeated = new Set(state.defeatedIds); this.restart();
  }
  dispose() {
    this.disposed = true; ++this.generation;
    for (const entry of this.entries.values()) entry.enemy?.dispose();
    this.entries.clear();
    if (this.runtime.enemies === this) this.runtime.enemies = null;
  }
}
