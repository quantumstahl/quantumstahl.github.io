import { normalizeMountainTitleOverrides } from '../game/MountainTitleConfig.js';
// Authored volumes. Occupancy and activation history belong to gameplay state.
export const TRIGGER_TYPES = Object.freeze(["Checkpoint", "KillZone", "Arena"]);

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`Invalid trigger ${label}.`);
  return [...value];
}

export function normalizeTrigger(value) {
  if (!value || typeof value.id !== "string" || !value.id.trim() || !TRIGGER_TYPES.includes(value.type)) throw new Error("Invalid trigger ID or type.");
  const position = vector(value.position, "position");
  const size = value.type === 'Arena' ? [1, 1, 1].map(() => (value.radius ?? 20) * 2) : vector(value.size, "size");
  if (size.some(n => n < .01)) throw new Error("Trigger dimensions must be at least 0.01 m.");
  const record = { id: value.id, name: String(value.name ?? value.type).slice(0, 80), type: value.type,
    position, size, enabled: value.enabled !== false, once: value.once === true };
  if (value.type === "Checkpoint") {
    const spawn = value.respawn ?? { position: [position[0], position[1] - size[1] / 2, position[2]], yaw: 0 };
    if (!Number.isFinite(spawn.yaw)) throw new Error("Invalid checkpoint respawn yaw.");
    record.respawn = { position: vector(spawn.position, "respawn position"), yaw: spawn.yaw };
    if (value.titleReveal != null) record.titleReveal = normalizeMountainTitleOverrides(value.titleReveal);
  }
  if (value.type === 'Arena') {
    record.arenaId = String(value.arenaId ?? value.id).trim();
    if (!record.arenaId) throw new Error('Arena ID cannot be empty.');
    record.radius = value.radius ?? 20;
    if (!Number.isFinite(record.radius) || record.radius < .1) throw new Error('Invalid arena radius.');
    record.once = false; record.completed = value.completed === true;
    for (const key of ['minHeight', 'maxHeight']) {
      if (value[key] != null && !Number.isFinite(value[key])) throw new Error('Invalid arena height limit.');
      record[key] = value[key] ?? null;
    }
    if (record.minHeight != null && record.maxHeight != null && record.minHeight > record.maxHeight) throw new Error('Arena height limits are reversed.');
    for (const key of ['enemyIds', 'barrierIds']) {
      const ids = value[key] ?? [];
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Invalid arena links.');
      record[key] = [...ids];
    }
    if (value.reward) {
      if (!['coin', 'heart'].includes(value.reward.type)) throw new Error('Choose a coin or heart reward.');
      record.reward = { type: value.reward.type, position: vector(value.reward.position ?? position, 'reward position') };
    }
  }
  return record;
}

export class TriggerData {
  constructor() { this.volumes = new Map(); this.listeners = new Set(); this.revision = this.savedRevision = 0; }
  static fromJSON(value) {
    const data = new TriggerData();
    if (value === undefined) return data; // Worlds authored before triggers.
    if (!Array.isArray(value)) throw new Error("Invalid trigger volumes.");
    for (const entry of value) {
      const record = normalizeTrigger(entry);
      if (data.volumes.has(record.id)) throw new Error(`Duplicate trigger: ${record.id}`);
      if (record.type === 'Arena' && [...data.volumes.values()].some(v => v.type === 'Arena' && v.arenaId === record.arenaId)) throw new Error('Duplicate arena ID.');
      data.volumes.set(record.id, record);
    }
    return data;
  }
  onChanged(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed(id) { ++this.revision; for (const listener of this.listeners) listener({ id }); }
  get hasUnsavedChanges() { return this.revision !== this.savedRevision; }
  set(value) {
    const record = normalizeTrigger(value);
    if (record.type === 'Arena' && [...this.volumes.values()].some(v => v.id !== record.id && v.type === 'Arena' && v.arenaId === record.arenaId)) throw new Error('Duplicate arena ID.');
    this.volumes.set(record.id, record); this.changed(record.id); return record;
  }
  delete(id) { if (this.volumes.delete(id)) this.changed(id); }
  snapshot() { return { revision: this.revision, value: structuredClone([...this.volumes.values()]) }; }
  commit(snapshot) { this.savedRevision = snapshot.revision; }
}
