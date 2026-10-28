export const DEFAULT_LOD_DISTANCES = [0, 80, 600, 2000];
export const DEFAULT_LOD_HYSTERESIS = .12;
export const DEFAULT_MAX_DRAW_DISTANCE = 100;
const levelCache = new WeakMap();
const missingLevels = [{ level: 0, distance: 0, resourceId: undefined }];

export function normalizeLOD(value, assetId) {
  if (value == null) return undefined;
  if (!Array.isArray(value.levels) || value.levels.length < 1 || value.levels.length > 4) throw new Error("Configure between one and four LOD levels.");
  let previous = -1;
  const levels = value.levels.map((item, level) => {
    const distance = item.distance ?? DEFAULT_LOD_DISTANCES[level];
    if (!Number.isFinite(distance) || distance < 0 || distance <= previous || (level === 0 && distance !== 0)) throw new Error("LOD distances must start at 0 and strictly increase.");
    previous = distance;
    const resourceId = Object.hasOwn(item, "resourceId") ? item.resourceId : (level === 0 ? assetId : null);
    if (resourceId !== null && (typeof resourceId !== "string" || !resourceId)) throw new Error("Invalid LOD GLB reference.");
    return { distance, enabled: item.enabled !== false, resourceId };
  });
  if (!levels.some(level => level.enabled && level.resourceId)) throw new Error("Keep at least one assigned LOD enabled.");
  const maxDistance = value.maxDistance ?? null, hysteresis = value.hysteresis ?? DEFAULT_LOD_HYSTERESIS;
  if (maxDistance !== null && (!Number.isFinite(maxDistance) || maxDistance <= 0)) throw new Error("Max Draw Distance must be a positive finite number.");
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis > .5) throw new Error("LOD hysteresis must be between 0 and 50%.");
  return { levels, maxDistance, hysteresis };
}
export function defaultLOD(assetId) {
  return { levels: DEFAULT_LOD_DISTANCES.map((distance, i) => ({ distance, enabled: i === 0, resourceId: i === 0 ? assetId : null })), maxDistance: null, hysteresis: DEFAULT_LOD_HYSTERESIS };
}
export function expandLOD(value, assetId) {
  const config = value ? structuredClone(value) : defaultLOD(assetId);
  while (config.levels.length < 4) {
    const index = config.levels.length, previous = config.levels.at(-1)?.distance ?? 0;
    config.levels.push({ distance: Math.max(DEFAULT_LOD_DISTANCES[index], previous + Math.max(1, previous * .5)), enabled: false, resourceId: null });
  }
  return config;
}
export function enabledLODLevels(asset) {
  if (!asset) return missingLevels;
  // ObjectData replaces asset/config records on edits. Cache the four-entry
  // selection table once, avoiding arrays and spread objects per tree/check.
  const key = asset.lod ?? asset;
  if (!levelCache.has(key)) levelCache.set(key, asset.lod
    ? asset.lod.levels.flatMap((item, level) => item.enabled && item.resourceId ? [{ ...item, level }] : [])
    : [{ level: 0, distance: 0, resourceId: asset.id }]);
  return levelCache.get(key);
}
// Pure, deterministic selection. Previous is the requested level, not a
// temporary fallback model. -1 represents optional distance culling.
export function chooseLOD(asset, distance, previous = null) {
  if (!Number.isFinite(distance) || distance < 0) return -1;
  if (!asset?.lod) return 0;
  const { maxDistance, hysteresis: h } = asset.lod;
  if (maxDistance != null && distance > maxDistance * (previous === -1 ? 1 - h : previous == null ? 1 : 1 + h)) return -1;
  const levels = enabledLODLevels(asset);
  if (!levels.length) return 0;
  let index = -1;
  for (let i = 0; i < levels.length; i++) if (levels[i].level === previous) { index = i; break; }
  if (index < 0) {
    index = 0;
    while (index + 1 < levels.length && distance >= levels[index + 1].distance) index++;
  } else {
    while (index + 1 < levels.length && distance >= levels[index + 1].distance * (1 + h)) index++;
    while (index > 0 && distance < levels[index].distance * (1 - h)) index--;
  }
  return levels[index].level;
}
export function lodCandidates(asset, requested) {
  const levels = enabledLODLevels(asset);
  // The first enabled model is also the near fallback, even when its authored
  // start distance is nonzero. Later levels beyond the cutoff are unreachable.
  const reachable = levels.filter((l, i) => i === 0 || asset.lod?.maxDistance == null || l.distance <= asset.lod.maxDistance);
  const result = [...reachable.filter(l => l.level >= requested), ...reachable.filter(l => l.level < requested).reverse()];
  // Keep the original model as a last resort if all configured files fail.
  if (!result.some(l => l.resourceId === asset?.id)) result.push({ level: 0, distance: 0, resourceId: asset?.id });
  return result;
}
export function lodResourceIds(asset) { return new Set([asset?.id, ...(asset?.lod?.levels.map(l => l.resourceId) ?? [])].filter(Boolean)); }
export function lodWarnings(asset, getResource) {
  if (!asset?.lod) return [];
  const levels = enabledLODLevels(asset), base = getResource(levels[0]?.resourceId)?.bounds ?? asset.bounds;
  const warnings = [];
  for (const { level, resourceId } of levels) {
    const resource = getResource(resourceId);
    if (!resource?.data) { warnings.push(`LOD ${level}: missing GLB; another enabled level will be used.`); continue; }
    if (!base || !resource.bounds) continue;
    const size = base.max.map((n, i) => n - base.min[i]), other = resource.bounds.max.map((n, i) => n - resource.bounds.min[i]);
    const extent = Math.max(.001, Math.hypot(...size));
    if (size.some((n, i) => Math.abs(other[i] - n) > Math.max(.001, n * .25))) warnings.push(`LOD ${level}: dimensions differ by more than 25%; check orientation and scale.`);
    const centreDelta = Math.hypot(...base.min.map((n, i) => (n + base.max[i] - resource.bounds.min[i] - resource.bounds.max[i]) / 2));
    if (centreDelta > extent * .1 || Math.abs(base.min[1] - resource.bounds.min[1]) > extent * .1) warnings.push(`LOD ${level}: pivot/bounds offset exceeds 10% of model size. Align origins before export.`);
    const reference = getResource(levels[0]?.resourceId);
    if (reference?.clips?.length && !resource.clips?.length) warnings.push(`LOD ${level}: this variant has no animations.`);
  }
  return warnings;
}
