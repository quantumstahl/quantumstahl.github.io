// A constrained source-grid collapse. Every coarse face is an original face
// with its vertex IDs remapped; at morph=1 discarded faces are degenerate.
// Thus the index switch changes neither the surface nor its lighting.
export const ROCK_LOD_DEFAULTS = Object.freeze({
  enabled: true, enterDistance: 240, exitDistance: 190, transitionSeconds: .4,
  maxError: .08, maxNormalAngle: 12, buildBudgetMs: 2,
});

export function rockLodOptions(options = {}) {
  const result = { ...ROCK_LOD_DEFAULTS, ...options };
  for (const key of ["enterDistance", "exitDistance", "transitionSeconds", "maxError", "maxNormalAngle", "buildBudgetMs"]) {
    if (!Number.isFinite(result[key]) || result[key] <= 0) throw new Error(`Invalid Rockify LOD ${key}`);
  }
  if (result.exitDistance >= result.enterDistance || result.maxNormalAngle >= 90) throw new Error("Invalid Rockify LOD hysteresis/normal angle");
  return result;
}

// No world XZ projection: vertical cliffs and undersides are tested in 3D.
export function* createRockLodBuild(positions, indices, sourceIndices, coverage, segments, options = ROCK_LOD_DEFAULTS) {
  const width = segments + 1, blocks = Math.floor(segments / 2);
  const lookup = new Int32Array(width * width); lookup.fill(-1);
  for (let i = 0; i < sourceIndices.length; i++) lookup[sourceIndices[i]] = i;
  const accepted = new Uint8Array(blocks * blocks);
  const cosine = Math.cos(options.maxNormalAngle * Math.PI / 180), error2 = options.maxError ** 2;
  const normals = new Float64Array(6), reference = new Float64Array(3);
  const normal = (a, b, c, target, offset = 0) => {
    a *= 3; b *= 3; c *= 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-8) return false; // Preserve collapsed/folded authoring.
    nx /= length; ny /= length; nz /= length;
    target[offset] = nx; target[offset + 1] = ny; target[offset + 2] = nz;
    return true;
  };
  const nearMidpoint = (a, b, mid) => {
    let distance2 = 0;
    for (let axis = 0; axis < 3; axis++) {
      const delta = positions[mid * 3 + axis] - (positions[a * 3 + axis] + positions[b * 3 + axis]) * .5;
      distance2 += delta * delta;
    }
    return distance2 <= error2;
  };
  for (let bz = 0; bz < blocks; bz++) for (let bx = 0; bx < blocks; bx++) {
    if ((bz * blocks + bx) % 64 === 0) yield;
    const x = bx * 2, z = bz * 2, cell = z * segments + x;
    if (!coverage[cell] || !coverage[cell + 1] || !coverage[cell + segments] || !coverage[cell + segments + 1]) continue;
    // Preserve whole cells in the terrain cutout's one-cell overlap guard,
    // not just its outer edge. Also retain a full-detail patch border band.
    if (x === 0 || z === 0 || x + 2 >= segments || z + 2 >= segments) continue;
    let interior = true;
    for (let dz = -1; dz <= 2 && interior; dz++) for (let dx = -1; dx <= 2; dx++) {
      if (!coverage[cell + dz * segments + dx]) { interior = false; break; }
    }
    if (!interior) continue;
    const a = z * width + x;
    const tl = lookup[a], tr = lookup[a + 2], bl = lookup[a + width * 2], br = lookup[a + width * 2 + 2];
    if (!nearMidpoint(tl, tr, lookup[a + 1]) || !nearMidpoint(bl, br, lookup[a + width * 2 + 1])
      || !nearMidpoint(tl, bl, lookup[a + width]) || !nearMidpoint(tr, br, lookup[a + width + 2])
      || !nearMidpoint(tr, bl, lookup[a + width + 1])) continue;
    if (!normal(tl, bl, tr, normals) || !normal(tr, bl, br, normals, 3)) continue;
    let smooth = true;
    for (let dz = 0; dz < 2 && smooth; dz++) for (let dx = 0; dx < 2 && smooth; dx++) {
      const sample = a + dz * width + dx;
      for (let face = 0; face < 2 && smooth; face++) {
        if (!normal(lookup[sample + face], lookup[sample + width], lookup[sample + 1 + face * width], reference)) { smooth = false; break; }
        for (let n = 0; n < 6; n += 3) {
          if (reference[0] * normals[n] + reference[1] * normals[n + 1] + reference[2] * normals[n + 2] < cosine) smooth = false;
        }
      }
    }
    if (smooth) accepted[bz * blocks + bx] = 1;
  }
  const remap = new Uint32Array(sourceIndices.length);
  for (let i = 0; i < remap.length; i++) remap[i] = i;
  for (let bz = 0; bz < blocks; bz++) for (let bx = 0; bx < blocks; bx++) {
    if ((bz * blocks + bx) % 256 === 0) yield;
    if (!accepted[bz * blocks + bx]) continue;
    const a = bz * 2 * width + bx * 2;
    remap[lookup[a + width + 1]] = lookup[a + 2];
    // Keep every patch/coverage boundary sample. A shared midpoint moves
    // only when BOTH complete incident blocks passed the shape tests.
    if (bz > 0 && accepted[(bz - 1) * blocks + bx]) remap[lookup[a + 1]] = lookup[a];
    if (bz + 1 < blocks && accepted[(bz + 1) * blocks + bx]) remap[lookup[a + width * 2 + 1]] = lookup[a + width * 2];
    if (bx > 0 && accepted[bz * blocks + bx - 1]) remap[lookup[a + width]] = lookup[a];
    if (bx + 1 < blocks && accepted[bz * blocks + bx + 1]) remap[lookup[a + width + 2]] = lookup[a + 2];
  }
  const coarse = [];
  for (let i = 0; i < indices.length; i += 3) {
    if (i % 6144 === 0) yield;
    const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
    if (a !== b && b !== c && c !== a) coarse.push(a, b, c);
  }
  const targets = new Float32Array(positions.length);
  for (let i = 0; i < remap.length; i++) {
    if (i % 2048 === 0) yield;
    const target = remap[i] * 3;
    targets[i * 3] = positions[target];
    targets[i * 3 + 1] = positions[target + 1];
    targets[i * 3 + 2] = positions[target + 2];
  }
  const IndexArray = sourceIndices.length <= 65535 ? Uint16Array : Uint32Array;
  return { positions: targets, indices: new IndexArray(coarse) };
}

// Pure state update makes reversal and endpoint ordering testable. Entering
// coarse uses fine indices until the collapse is complete; leaving coarse
// restores fine indices before the first vertex moves.
export function advanceRockLod(state, distance, delta, options) {
  state.target = options.enabled && (state.target ? distance >= options.exitDistance : distance > options.enterDistance) ? 1 : 0;
  // A stalled frame/tab resume must not jump across the entire morph.
  const step = Math.min(.05, Math.max(0, Number.isFinite(delta) ? delta : 0)) / options.transitionSeconds;
  state.morph = state.target ? Math.min(1, state.morph + step) : Math.max(0, state.morph - step);
  state.level = state.morph === 1 ? 1 : 0;
}
