// Shared by the detailed shell and retained terrain at every residency tier.
// Matte, world-anchored albedo variation leaves the authored slabs readable.
// No normal perturbation, specular, textures or displacement. Filter colour
// detail by world-space pixel footprint so it cannot glitter at distance.
export const ROCK_APPEARANCE_GLSL = `
  float rockHash(vec3 cell) {
    vec3 p = fract(cell * vec3(.1031, .11369, .13787));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float rockValueNoise(vec3 position) {
    vec3 cell = floor(position);
    vec3 f = fract(position);
    f = f * f * (3.0 - 2.0 * f);
    float low = mix(
      mix(rockHash(cell), rockHash(cell + vec3(1, 0, 0)), f.x),
      mix(rockHash(cell + vec3(0, 1, 0)), rockHash(cell + vec3(1, 1, 0)), f.x), f.y);
    float high = mix(
      mix(rockHash(cell + vec3(0, 0, 1)), rockHash(cell + vec3(1, 0, 1)), f.x),
      mix(rockHash(cell + vec3(0, 1, 1)), rockHash(cell + vec3(1, 1, 1)), f.x), f.y);
    return mix(low, high, f.z);
  }
  float rockMottle(vec3 position, float frequency, float pixelSpan) {
    float fade = 1.0 - smoothstep(.25, .75, pixelSpan * frequency);
    if (fade < .001) return .5;
    return mix(.5, rockValueNoise(position * frequency), fade);
  }
  vec3 shadeRock(vec3 worldPosition, vec3 normal, float directLight) {
    float pixelSpan = max(length(dFdx(worldPosition)), length(dFdy(worldPosition)));
    float macro = rockMottle(worldPosition + vec3(31, 7, -19), .055, pixelSpan);
    float mottle = rockMottle(worldPosition + vec3(-13, 23, 5), .32, pixelSpan);
    float grain = rockMottle(worldPosition, 1.4, pixelSpan);
    vec3 stone = mix(vec3(.48, .47, .45), vec3(.60, .585, .55), macro);
    stone *= 1.0 + (mottle - .5) * .14 + (grain - .5) * .07;
    // Neutral, broad fill and a smaller diffuse key soften the bright/dark
    // facet bands without smoothing away authored planes or fold geometry.
    float sky = normal.y * .5 + .5;
    vec3 ambient = mix(vec3(.44, .435, .42), vec3(.70, .695, .675), sky);
    vec3 illumination = ambient + vec3(.25, .24, .22) * directLight;
    return stone * illumination;
  }
`;
