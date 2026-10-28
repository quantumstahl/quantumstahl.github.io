const vector = (value, fallback, positive = false) => {
  const result = value ?? fallback;
  if (!Array.isArray(result) || result.length !== 3 || !result.every(n => Number.isFinite(n) && (!positive || n > 0))) throw new Error("Invalid collider dimensions/offset.");
  return [...result];
};
export function normalizeCollision(value) {
  const mode = value?.mode ?? "none";
  if (mode === "none") return { mode };
  if (mode === "mesh") {
    if (value.sourceId != null && (typeof value.sourceId !== "string" || !value.sourceId)) throw new Error("Invalid collision mesh source.");
    return { mode, ...(value.sourceId ? { sourceId: value.sourceId } : {}) };
  }
  if (mode !== "simple") throw new Error("Choose None, Simple or Mesh collision.");
  const shape = value.shape ?? "box";
  if (!["box", "cylinder", "capsule"].includes(shape)) throw new Error("Invalid simple collider shape.");
  const result = { mode, shape, offset: vector(value.offset, [0, .5, 0]) };
  if (shape === "box") result.size = vector(value.size, [1, 1, 1], true);
  else {
    result.radius = value.radius ?? .5; result.height = value.height ?? 1;
    if (![result.radius, result.height].every(n => Number.isFinite(n) && n > 0) || (shape === "capsule" && result.height < 2 * result.radius)) throw new Error("Capsule height must include both caps and be at least twice its radius.");
  }
  return result;
}
export function fitSimpleCollider(asset, shape = "box") {
  const min = asset?.bounds?.min ?? [-.5, 0, -.5], max = asset?.bounds?.max ?? [.5, 1, .5];
  const size = max.map((n, i) => Math.max(.01, n - min[i]));
  const radius = Math.max(size[0], size[2]) / 2;
  return normalizeCollision({ mode: "simple", shape, size, radius, height: shape === "capsule" ? Math.max(size[1], radius * 2) : size[1], offset: min.map((n, i) => (n + max[i]) / 2) });
}
