// Player saves never write authored world files or development scenario data.
export function fingerprint(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function worldSaveKey(session) {
  const id = session.worldId ?? session.store?.worldId;
  if (typeof id !== 'string' || !id) throw new Error('The world needs a persistent ID before player saves can be used.');
  return `player-${encodeURIComponent(id)}`;
}

const SAVE_PREFIX = 'catadventure:save:';
const legacyKey = key => /^(?:player-[\da-f]+-[\da-f]+|development-[\da-f]+-[\da-f]+-[\da-f]+-[\da-f]+)$/i.test(key ?? '');

export class PlayerSaves {
  constructor({ storage = () => globalThis.localStorage, worldKey, worldId = worldKey, validate = () => {}, prepare = state => state, matchesLegacy = () => false, now = () => Date.now(),
    id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }) {
    Object.assign(this, { storage, worldKey, worldId, validate, prepare, matchesLegacy, now, id });
    this.prefix = `catadventure:save:v1:${worldKey}:`;
    this.unavailable = [];
  }
  read(key) {
    const save = JSON.parse(this.getRaw(key));
    if (save?.format === 'catadventure-player' && save.version !== 1) throw new Error(`Unsupported player save version: ${save.version}. Original preserved.`);
    if (save?.format !== "catadventure-player" || save.version !== 1 || typeof save.worldKey !== 'string'
      || typeof save.id !== "string" || key !== `${SAVE_PREFIX}v1:${save.worldKey}:${save.id}` || !Number.isFinite(save.createdAt)
      || typeof save.name !== "string") throw new Error("Invalid player save.");
    const legacy = save.worldKey !== this.worldKey && save.worldId == null && legacyKey(save.worldKey);
    if (legacy && !this.matchesLegacy(save.state)) throw new Error('Legacy save could not be matched to this world’s stable IDs. Original preserved.');
    if (!legacy && (save.worldKey !== this.worldKey || (save.worldId != null && save.worldId !== this.worldId))) throw new Error('This save belongs to another world. Original preserved.');
    const state = this.prepare(save.state);
    this.validate(state);
    return { ...save, state, key, legacy };
  }
  getRaw(key) {
    if (typeof key !== 'string' || !key.startsWith(SAVE_PREFIX)) throw new Error('Not a CatAdventure player save.');
    const raw = this.storage().getItem(key);
    if (raw === null) throw new Error('This save is no longer in browser storage.');
    return raw;
  }
  list() {
    const storage = this.storage(), saves = [];
    this.invalidCount = 0;
    this.unavailable = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(SAVE_PREFIX)) continue;
      try { saves.push(this.read(key)); } catch (error) {
        let metadata; try { metadata = JSON.parse(storage.getItem(key)); } catch {}
        const own = key.startsWith(this.prefix);
        if (own) this.invalidCount++;
        this.unavailable.push({ key, name: typeof metadata?.name === 'string' ? metadata.name : key,
          reason: error.message, worldKey: metadata?.worldKey ?? null, createdAt: metadata?.createdAt ?? 0 });
      }
    }
    return saves.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }
  create(state) {
    this.validate(state);
    const storage = this.storage(), id = this.id(), key = this.prefix + id;
    // Refuse a collision; no slot is ever silently replaced or deleted.
    if (storage.getItem(key) !== null) throw new Error("Save ID collision. Please save again.");
    const createdAt = this.now();
    const save = { format: "catadventure-player", version: 1, worldKey: this.worldKey, worldId: this.worldId, id, createdAt,
      name: `Adventure · ${new Date(createdAt).toLocaleString()}`, state };
    try { storage.setItem(key, JSON.stringify(save)); }
    catch { throw new Error("Could not save. Browser storage is full or unavailable; existing saves are unchanged."); }
    return { ...save, key };
  }
}
