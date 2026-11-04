export const SETTINGS_KEY = "catadventure:settings:v1";
export const QUALITY_PRESETS = Object.freeze({
  low: { renderScale: .65, grass: false, flowers: false },
  balanced: { renderScale: 1, grass: true, flowers: true },
  high: { renderScale: 1.5, grass: true, flowers: true },
});
const defaults = () => ({ version: 1, quality: "balanced", renderScale: 1, grass: true, flowers: true,
  master: 1, music: .5, ambient: .6, sfx: 1 });
export class PlayerSettings {
  constructor({ storage = () => globalThis.localStorage, apply = () => {} } = {}) {
    Object.assign(this, { storage, apply }); this.value = defaults();
    try {
      const saved = JSON.parse(storage().getItem(SETTINGS_KEY));
      if (saved?.version === 1) this.value = this.normalize(saved);
    } catch { /* Browsers with disabled storage still allow settings this session. */ }
    this.apply(this.value);
  }
  normalize(value) {
    const result = defaults();
    if (Object.hasOwn(QUALITY_PRESETS, value.quality)) result.quality = value.quality;
    if ([.5, .65, .75, 1, 1.25, 1.5, 2].includes(value.renderScale)) result.renderScale = value.renderScale;
    for (const key of ["grass", "flowers"]) if (typeof value[key] === "boolean") result[key] = value[key];
    for (const key of ["master", "music", "ambient", "sfx"]) if (Number.isFinite(value[key])) result[key] = Math.max(0, Math.min(1, value[key]));
    return result;
  }
  set(key, value) {
    const changes = key === "quality" ? { quality: value, ...QUALITY_PRESETS[value] } : { [key]: value };
    this.value = this.normalize({ ...this.value, ...changes }); this.apply(this.value);
    try { this.storage().setItem(SETTINGS_KEY, JSON.stringify(this.value)); return true; }
    catch { return false; }
  }
}
