const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hash = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

// Source-anchored polygonal slabs. Jitter belongs to whole slab sites, never
// individual vertices. An occasional omitted site joins small blocks into a
// larger face and interrupts the ledges. No continuous horizontal row joints.
export function createRockBlockField(scale, spacing) {
  const width = scale, height = scale * 1.15;
  const bevel = Math.max(spacing * 2, scale * .16);
  const sites = new Map();
  function site(column, row) {
    const id = `${column},${row}`;
    if (!sites.has(id)) {
      // Only isolated even/even sites can be omitted: surrounding sites are
      // always present, keeping the local nearest-site search bounded.
      const omit = column % 2 === 0 && row % 2 === 0 && hash(column + 53, row + 17) < .45;
      sites.set(id, omit ? null : {
        u: column + .5 + (hash(column, row) - .5) * .56,
        v: row + .5 + (hash(column + 11, row - 7) - .5) * .56,
        depth: .85 + hash(column + 19, row) * .3,
        tiltU: (hash(column, row + 31) - .5) * .4,
        tiltV: (hash(column + 7, row) - .5) * .3,
      });
    }
    return sites.get(id);
  }
  return (u, y) => {
    const x = u / width, z = y / height;
    const column = Math.floor(x), row = Math.floor(z);
    const nearby = [];
    let owner, nearest = Infinity;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const p = site(column + dx, row + dz);
      if (!p) continue;
      const distance = (x - p.u) ** 2 + (z - p.v) ** 2;
      nearby.push({ p, distance });
      if (distance < nearest) { nearest = distance; owner = p; }
    }
    // Exact distance to each Voronoi bisector, in metres. Both sides of a
    // fracture reach the same recessed depth, even when face tilts differ.
    let edge = Infinity;
    for (const { p, distance } of nearby) {
      if (p === owner) continue;
      const gradient = 2 * Math.hypot((p.u - owner.u) / width, (p.v - owner.v) / height);
      edge = Math.min(edge, Math.max(0, distance - nearest) / gradient);
    }
    const face = owner.depth + owner.tiltU * (x - owner.u) + owner.tiltV * (z - owner.v);
    return -.35 + (face + .35) * clamp(edge / bevel, 0, 1);
  };
}

export const rockBlockProfile = (u, height, scale, spacing) => createRockBlockField(scale, spacing)(u, height);

const cross = (a, b, c) => {
  const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
  const u = c.x - a.x, v = c.y - a.y, w = c.z - a.z;
  return { x: y * w - z * v, y: z * u - x * w, z: x * v - y * u };
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = a => Math.hypot(a.x, a.y, a.z);
const key = (x, z) => `${x},${z}`;

export function sculptRockBlocks(sculptor, worldX, worldZ, delta, { rockifyIn, rockNormal, rockStamp, rockifyCandidates }) {
  const provider = sculptor.provider, spacing = provider.sampleSpacing;
  const center = rockStamp?.center ?? { x: worldX, y: provider.sampleHeight(worldX, worldZ), z: worldZ };
  const radius = sculptor.radius;
  if (!(radius > 0) || !(delta > 0) || !(sculptor.strength > 0)
    || ![radius, delta, sculptor.strength, worldX, worldZ, center.x, center.y, center.z].every(Number.isFinite)) return 0;
  let frame = sculptor.rockifyFrame;
  if (!frame) {
    const normal = rockStamp?.normal ?? rockNormal;
    const magnitude = Math.hypot(normal?.x ?? 0, normal?.y ?? 0, normal?.z ?? 0);
    const horizontal = Math.hypot(normal?.x ?? 0, normal?.z ?? 0);
    if (!Number.isFinite(magnitude) || horizontal < magnitude * .15 || !magnitude) return 0;
    const nx = normal.x / horizontal, nz = normal.z / horizontal;
    const ny = (normal.y ?? 0) / horizontal;
    frame = { nx, nz, ny, tx: nz, tz: -nx,
      plane: nx * center.x + nz * center.z + ny * center.y,
      // Use a fixed source projection for block identity. Small changes of
      // picked face angle between strokes must not rotate a world-size grid.
      patternX: Math.abs(nx) < Math.abs(nz) ? 1 : 0,
      patternZ: Math.abs(nx) >= Math.abs(nz) ? 1 : 0,
      radius, scale: Math.max(spacing * 10, radius * 1.1), sources: new Map(), orientation: 0 };
    frame.blockProfile = createRockBlockField(frame.scale, spacing);
    // Calls outside a UI stroke must not leave a stale frame for a later edit.
    if (sculptor.strokeChanges) sculptor.rockifyFrame = frame;
  }
  const points = new Map(), candidates = new Map();
  function read(gx, gz) {
    const id = key(gx, gz);
    if (points.has(id)) return points.get(id);
    const x = gx * spacing, z = gz * spacing;
    const warp = provider.sampleWarp(x, z);
    const p = { id, gx, gz, sourceX: x, sourceZ: z, wx: warp.x, wz: warp.z,
      x: x + warp.x, y: provider.sampleHeight(x, z), z: z + warp.z };
    points.set(id, p);
    return p;
  }
  const add = (gx, gz) => {
    const p = read(gx, gz);
    if (Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z) >= radius) return;
    const w = read(gx - 1, gz), e = read(gx + 1, gz), n = read(gx, gz - 1), s = read(gx, gz + 1);
    const ne = read(gx + 1, gz - 1), sw = read(gx - 1, gz + 1);
    const faces = [[p, s, e], [n, w, p], [n, p, ne], [ne, p, e], [w, sw, p], [p, sw, s]];
    const normals = faces.map(face => cross(...face)), areas = normals.map(length);
    if (areas.some(area => area < 1e-6)) return;
    // Classify the original sheet once per stroke. Newly formed bevels must
    // not become protected halfway toward their target and freeze as ridges.
    let original = frame.sources.get(p.id);
    if (!original) {
      let protectedLip = false;
      for (let i = 0; i < 6; i++) for (let j = 0; j < i; j++) {
        if (dot(normals[i], normals[j]) < areas[i] * areas[j] * -.35) protectedLip = true;
      }
      const average = normals.reduce((sum, n) => ({ x: sum.x + n.x, y: sum.y + n.y, z: sum.z + n.z }), { x: 0, y: 0, z: 0 });
      original = { ...p, protectedLip, facing: (average.x * frame.nx + average.z * frame.nz) / length(average) };
      frame.sources.set(p.id, original);
    }
    if (original.protectedLip) return;
    const facing = original.facing;
    if (Math.abs(facing) < .15) return;
    candidates.set(p.id, { p, faces, normals, areas, facing });
  };
  // The picker supplies remote source owners of warped/folded surfaces. The
  // local range also supports a first stamp on an ordinary authored slope.
  const minX = Math.ceil((worldX - radius) / spacing), maxX = Math.floor((worldX + radius) / spacing);
  const minZ = Math.ceil((worldZ - radius) / spacing), maxZ = Math.floor((worldZ + radius) / spacing);
  const inspected = new Set();
  const inspect = (x, z) => { const id = key(x, z); if (!inspected.has(id)) { inspected.add(id); add(x, z); } };
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) inspect(x, z);
  for (const p of rockifyCandidates) inspect(Math.round(p.x / spacing), Math.round(p.z / spacing));
  sculptor.profile.rockifySourceSamples += inspected.size;
  let seed, distance = Infinity;
  for (const item of candidates.values()) {
    const d = Math.hypot(item.p.sourceX - (rockStamp?.sourceX ?? worldX), item.p.sourceZ - (rockStamp?.sourceZ ?? worldZ));
    if (d < distance) { seed = item; distance = d; }
  }
  if (!seed || distance > spacing * 3) return 0;
  frame.orientation ||= Math.sign(seed.facing);
  if (seed.facing * frame.orientation < .15) return 0;
  const queue = [seed], visited = new Set([seed.p.id]);
  for (let i = 0; i < queue.length; i++) for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const item = candidates.get(key(queue[i].p.gx + x, queue[i].p.gz + z));
    if (item && !visited.has(item.p.id) && item.facing * frame.orientation >= .15) { visited.add(item.p.id); queue.push(item); }
  }
  const proposals = new Map(), intent = rockifyIn ? -1 : 1;
  const blend = 1 - Math.exp(-sculptor.strength * Math.min(delta, .08) * .22);
  for (const item of queue) {
    const p = item.p;
    const original = frame.sources.get(p.id);
    const u = (original.x - center.x) * frame.tx + (original.z - center.z) * frame.tz;
    const v = original.y - center.y;
    const edge = Math.max(Math.abs(u) / (radius * .95), Math.abs(v) / (radius * .85), (Math.abs(u) + Math.abs(v)) / (radius * 1.5));
    const t = clamp((edge - .55) / .45, 0, 1), weight = 1 - t * t * (3 - 2 * t);
    if (!weight) continue;
    // The profile is fixed for this source sample throughout a stroke. Cache
    // it once instead of repeating the slab search on every display frame.
    original.shape ??= frame.blockProfile(original.sourceX * frame.patternX + original.sourceZ * frame.patternZ, original.y);
    const shape = original.shape;
    const target = frame.plane + intent * frame.radius * (.14 + .12 * shape);
    const originalDepth = frame.nx * original.x + frame.nz * original.z + frame.ny * original.y;
    const depth = frame.nx * p.x + frame.nz * p.z + frame.ny * p.y;
    // A target, not another additive stamp: repeated frames converge. Keep
    // distant portions of a curved cliff within a bounded original offset.
    const bounded = originalDepth + clamp(target - originalDepth, -frame.radius * .35, frame.radius * .35);
    const desired = originalDepth + (bounded - originalDepth) * weight;
    const amount = clamp((desired - depth) * blend, -spacing * .18, spacing * .18);
    if (Math.abs(amount) > 1e-5) proposals.set(p.id, { ...item, amount });
  }
  const moved = (p, scale) => {
    const amount = (proposals.get(p.id)?.amount ?? 0) * scale;
    return { x: p.sourceX + Math.fround(p.wx + frame.nx * amount), y: p.y, z: p.sourceZ + Math.fround(p.wz + frame.nz * amount) };
  };
  // Test the simultaneous move of every incident triangle. Do not create
  // new collapsed faces or reverse folds while pursuing a block target.
  let scale = 1, safe = false;
  for (let attempt = 0; attempt < 7; attempt++, scale *= .5) {
    safe = true;
    for (const item of proposals.values()) {
      for (let i = 0; i < 6; i++) {
        const n = cross(...item.faces[i].map(p => moved(p, scale))), area = length(n);
        if (area < item.areas[i] * .7 || dot(n, item.normals[i]) < area * item.areas[i] * .94) { safe = false; break; }
      }
      if (!safe) break;
    }
    if (safe) break;
  }
  if (!safe || !proposals.size) return 0;
  let changed = 0;
  provider.beginChanges();
  try {
    for (const { p, amount } of proposals.values()) {
      const next = moved(p, scale), wx = Math.fround(next.x - p.sourceX), wz = Math.fround(next.z - p.sourceZ);
      if (wx === p.wx && wz === p.wz) continue;
      sculptor.rememberWarp(p.sourceX, p.sourceZ, { x: p.wx, z: p.wz }, { x: wx, z: wz });
      provider.setWarpSample(p.sourceX, p.sourceZ, wx, wz);
      const exposure = provider.sampleRockExposure(p.sourceX, p.sourceZ);
      // Once converted, keep ownership while shaping inward or outward.
      // Geometry correction can have either sign within one block face.
      const nextExposure = (Math.sign(exposure) || intent) * Math.max(Math.abs(exposure), Math.min(1, .05 + Math.abs(amount * scale) / 10));
      if (exposure !== nextExposure) {
        sculptor.rememberRockExposure(p.sourceX, p.sourceZ, exposure, nextExposure);
        provider.setRockExposureSample(p.sourceX, p.sourceZ, nextExposure);
      }
      changed++;
    }
  } finally {
    for (const tile of provider.changedTiles) provider.activeEditTileKeys.add(provider.tileKey(Math.round(tile.x / tile.size), Math.round(tile.z / tile.size)));
    provider.endChanges();
  }
  return changed;
}
