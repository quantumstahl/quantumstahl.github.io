// World configuration only; generated instances are never serialized.
export const DEFAULT_GRASS_SETTINGS = Object.freeze({
  enabled: true, seed: 17031, density: .45, cellSize: 32,
  nearDistance: 30, farDistance: 80, maxDistance: 150, transition: 6,
  scale: .32, variation: .65, windStrength: 1, windSpeed: 1,
  baseColor: "#294d1d", tipColor: "#91b94f",
  baseCoverage: 1, materialCoverage: Object.freeze([1, 0, 0, 0, 0, 0, 0, 0]),
  maxSlope: 42, rockThreshold: .05, waterClearance: .25,
  buildBudgetMs: 1.5, samplesPerFrame: 192, cellsPerFrame: 2,
  releasesPerFrame: 2, cacheCells: 192,
});
const limits = {
  seed: [0, 4294967295], density: [0, 2], nearDistance: [4, 80],
  farDistance: [8, 180], maxDistance: [12, 250], transition: [1, 16],
  scale: [.05, 2], variation: [0, 1], windStrength: [0, 3], windSpeed: [0, 4],
  baseCoverage: [0, 1], maxSlope: [0, 60], rockThreshold: [.001, 1], waterClearance: [0, 2],
  buildBudgetMs: [.1, 8], samplesPerFrame: [8, 2048], cellsPerFrame: [1, 8],
  releasesPerFrame: [1, 8], cacheCells: [64, 1024],
};
export function normalizeGrassSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid grass settings.");
  const settings = { ...DEFAULT_GRASS_SETTINGS };
  for (const [key, [min, max]] of Object.entries(limits)) {
    const n = value[key] ?? settings[key];
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid grass ${key}.`);
    settings[key] = n;
  }
  for (const key of ["seed", "samplesPerFrame", "cellsPerFrame", "releasesPerFrame", "cacheCells"]) {
    if (!Number.isInteger(settings[key])) throw new Error(`Invalid grass ${key}.`);
  }
  settings.enabled = value.enabled ?? settings.enabled;
  if (typeof settings.enabled !== "boolean") throw new Error("Invalid grass enabled flag.");
  settings.cellSize = value.cellSize ?? settings.cellSize;
  if (![16, 32].includes(settings.cellSize)) throw new Error("Grass cells must be 16 or 32 metres.");
  settings.farDistance = Math.max(settings.nearDistance + 2, settings.farDistance);
  settings.maxDistance = Math.max(settings.farDistance + 2, settings.maxDistance);
  settings.transition = Math.min(settings.transition, settings.nearDistance * .5);
  for (const key of ["baseColor", "tipColor"]) {
    settings[key] = value[key] ?? settings[key];
    if (typeof settings[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(settings[key])) throw new Error(`Invalid grass ${key}.`);
  }
  const coverage = value.materialCoverage ?? settings.materialCoverage;
  if (!Array.isArray(coverage) || coverage.length !== 8 || coverage.some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error("Grass requires eight material coverage rules.");
  settings.materialCoverage = Object.freeze([...coverage]);
  return Object.freeze(settings);
}
export function grassSettingsEqual(a, b) {
  return JSON.stringify(normalizeGrassSettings(a)) === JSON.stringify(normalizeGrassSettings(b));
}
export function grassHash(seed, x, z, index = 0, stream = 0) {
  let n = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(index + 1, 1274126177) ^ Math.imul(stream, 1597334677)) >>> 0;
  n = Math.imul(n ^ n >>> 16, 2246822507);
  n = Math.imul(n ^ n >>> 13, 3266489909);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
export function grassLod(distance, settings) {
  const smooth = (a, b, d) => { const t = Math.max(0, Math.min(1, (d - a) / (b - a))); return t * t * (3 - 2 * t); };
  const far = smooth(settings.nearDistance - settings.transition / 2, settings.nearDistance + settings.transition / 2, distance);
  return { near: 1 - far, far, density: 1 - smooth(settings.farDistance, settings.maxDistance, distance) };
}
