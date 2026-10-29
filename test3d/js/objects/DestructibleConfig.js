// Opt-in, per-placement authoring settings. Runtime health never lives here.
export const DESTRUCTIBLE_DEFAULTS = Object.freeze({
  enabled: true, health: 3, destroyedAsset: "box2.glb", debrisLifetime: 4,
  impulseStrength: 1, outwardImpulse: 2.4, upwardImpulse: 3.2,
  gravity: 12, angularVelocity: 2.5, bounce: .22, damping: .8,
});

export function normalizeDestructible(value) {
  if (value == null || value === false) return null;
  if (value !== true && (typeof value !== "object" || Array.isArray(value))) throw new Error("Invalid destructible settings.");
  const config = { ...DESTRUCTIBLE_DEFAULTS, ...(value === true ? {} : value) };
  if (typeof config.enabled !== "boolean" || typeof config.destroyedAsset !== "string" || !config.destroyedAsset.trim()) throw new Error("Choose a destroyed GLB asset.");
  for (const key of ["health", "debrisLifetime", "impulseStrength", "outwardImpulse", "upwardImpulse", "gravity", "angularVelocity", "bounce", "damping"]) {
    const n = config[key], positive = key === "health" || key === "debrisLifetime";
    if (!Number.isFinite(n) || (positive ? n <= 0 : n < 0) || n > (key === "bounce" ? 1 : 1000000)) throw new Error(`Invalid destructible ${key}.`);
  }
  return config;
}
