// Temporary flat fallback used while validating editor placement. Persistent
// height tiles and explicit sculpt edits remain intact; only terrain that has
// not been authored now starts from this level surface.
function fract(value) {
  return value - Math.floor(value);
}

function hash(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}

export function proceduralHeight(x, z) {
  return 0;
}

export const TERRAIN_HEIGHT_GLSL = `
  float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float terrainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(terrainHash(i), terrainHash(i + vec2(1., 0.)), f.x), mix(terrainHash(i + vec2(0., 1.)), terrainHash(i + vec2(1., 1.)), f.x), f.y);
  }
  float terrainHeight(vec2 p) {
    return 0.0;
  }`;
