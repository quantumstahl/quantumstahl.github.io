// Evaluate the SAME source-grid triangles as WarpSurfacePicker, including XZ
// displacement. Source anchors remain unambiguous even on folded overhangs.
export function sampleObjectSurface(provider, sourceX, sourceZ) {
  const spacing = provider.sampleSpacing;
  const x = Math.floor(sourceX / spacing) * spacing, z = Math.floor(sourceZ / spacing) * spacing;
  const u = (sourceX - x) / spacing, v = (sourceZ - z) / spacing;
  const samples = u + v <= 1
    ? [[x, z, 1 - u - v], [x + spacing, z, u], [x, z + spacing, v]]
    : [[x + spacing, z + spacing, u + v - 1], [x, z + spacing, 1 - u], [x + spacing, z, 1 - v]];
  const point = [0, 0, 0], warp = { x: 0, z: 0 };
  for (const [sx, sz, weight] of samples) {
    provider.sampleWarp(sx, sz, warp);
    point[0] += (sx + warp.x) * weight;
    point[1] += provider.sampleHeight(sx, sz) * weight;
    point[2] += (sz + warp.z) * weight;
  }
  return point;
}
export function refreshTerrainAnchors(data, provider, tile) {
  // Include adjacent source tiles for anchors whose interpolation touches a seam.
  const tx = Math.round(tile.x / provider.tileSize), tz = Math.round(tile.z / provider.tileSize);
  const ids = new Set();
  for (let z = tz - 1; z <= tz + 1; z++) for (let x = tx - 1; x <= tx + 1; x++) {
    for (const id of data.anchors.get(`${x},${z}`) ?? []) ids.add(id);
  }
  for (const id of ids) {
    const object = data.objects.get(id), a = object.anchor;
    const position = sampleObjectSurface(provider, a.sourceX, a.sourceZ); position[1] += a.offset;
    if (position.some((n, i) => Math.abs(n - object.position[i]) > 1e-5)) data.setObject({ ...object, position });
  }
}
