import { copyAsset, normalizeAsset } from "../objects/ObjectData.js";
import { lodWarnings } from "../objects/ObjectLOD.js";
import { meshColliderFromSource } from "../physics/ColliderAssets.js";

function checkTarget(data, id) {
  const asset = data.assets.get(id);
  if (!asset) throw new Error("The asset to replace no longer exists.");
  // Old projects may use another logical asset directly as an LOD/collider
  // source. Changing those models too would violate a local replacement.
  const dependent = [...data.assets.values()].find(other => other.id !== id &&
    (other.collision?.sourceId === id || other.lod?.levels.some(level => level.resourceId === id)));
  if (dependent) throw new Error(`“${dependent.name}” also uses this GLB as an LOD or collision source. Assign it a separate source before replacing “${asset.name}”.`);
  return asset;
}

export function replacementWarnings(before, after, getResource) {
  const warnings = [];
  if (before.bounds && after.bounds) {
    const size = b => b.max.map((n, i) => n - b.min[i]);
    const a = size(before.bounds), b = size(after.bounds);
    const epsilon = Math.max(.00001, Math.hypot(...a) * .00001);
    if (a.some((n, i) => Math.abs(n - b[i]) > epsilon)) warnings.push("Model dimensions changed; instance scales were preserved without rescaling.");
    if (before.bounds.min.some((n, i) => Math.abs((n + before.bounds.max[i] - after.bounds.min[i] - after.bounds.max[i]) / 2) > epsilon)) {
      warnings.push("Model bounds/origin alignment changed; the new authored pivot is used without recentering.");
    }
  } else warnings.push("Previous model bounds are unavailable; check the new model's size and pivot.");
  if (before.clips?.some(name => !after.clips?.includes(name))) warnings.push("Some previous animation clips are missing. Stored clip choices are preserved; unavailable clips use the engine's first-clip fallback.");
  if (after.collision?.mode === "simple") warnings.push("Simple collider dimensions and offset were preserved. Check their fit against the new model.");
  if (after.collision?.mode === "mesh" && after.collision.sourceId && after.collision.sourceId !== after.id) warnings.push("The assigned separate collision GLB is preserved.");
  if (after.lod) {
    warnings.push("Assigned LOD files and distances were preserved. Check all levels against the new model.");
    if (after.lod.levels[0]?.resourceId !== after.id) warnings.push("LOD 0 uses a separate GLB; replacing the original does not replace that assigned file.");
    warnings.push(...lodWarnings(after, id => id === after.id ? after : getResource(id)));
  }
  return warnings;
}

// One existing objectAsset history entry; immutable payload strings are shared
// with ObjectData/history, never copied per placement or retained as GPU models.
export async function replaceGLB(data, library, id, file, { beforeCommit = () => {} } = {}) {
  const original = checkTarget(data, id);
  // Always decode independently: a cached source may belong to another asset.
  const prepared = await library.prepareFile(file, { reuse: false });
  let committed = false;
  try {
    if (library.disposed) throw new Error("Asset library is closed.");
    if (checkTarget(data, id) !== original) throw new Error("The asset changed while the replacement was loading. Try again.");
    const source = prepared.source;
    if (!source.meshes.length || !source.triangles) throw new Error("The replacement has no visible mesh triangles.");
    const before = copyAsset(original);
    // Keep the library name, identity, LOD and authored collision configuration.
    const after = normalizeAsset({ ...before, data: prepared.resource.data, bounds: prepared.resource.bounds,
      triangles: prepared.resource.triangles, clips: prepared.resource.clips });
    if (![...after.bounds.min, ...after.bounds.max].every(Number.isFinite)) throw new Error("The replacement has invalid model bounds.");
    if (after.data === before.data) return { unchanged: true, name: before.name, warnings: [] };
    // A failed collider bake must leave the old asset/geometry fully intact.
    if (after.collision?.mode === "mesh" && (!after.collision.sourceId || after.collision.sourceId === id)) meshColliderFromSource(source);
    const warnings = replacementWarnings(before, after, key => data.getResource(key));
    beforeCommit();
    // No awaits between this check, publication, and the caller recording history.
    if (checkTarget(data, id) !== original) throw new Error("The asset changed before replacement could commit. Try again.");
    library.commitSource(after, source); committed = true;
    return { name: before.name, warnings, entries: { id, before, after: copyAsset(data.assets.get(id)) } };
  } finally {
    if (!committed) library.disposeSource(prepared.source);
  }
}
