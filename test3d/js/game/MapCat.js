// Use a placed cat, not merely an imported but unplaced library asset.
// Map insertion order makes the first matching instance deterministic.
export function findMapCat(data) {
  const isCat = value => typeof value === "string" && /^cat(?:\.glb)?$/i.test(value.trim());
  for (const object of data.objects.values()) {
    const asset = data.assets.get(object.assetId);
    if (asset && (isCat(asset.name) || isCat(object.properties?.name) || isCat(object.properties?.type))) return object;
  }
  return null;
}
