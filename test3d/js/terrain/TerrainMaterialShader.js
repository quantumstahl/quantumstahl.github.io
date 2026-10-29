export const TERRAIN_MATERIAL_GLSL = `
uniform bool uMaterialEnabled;
uniform highp sampler2DArray uMaterialMasks, uMaterialMaps;
uniform sampler2D uMaterialOverview, uMaterialLookup;
uniform vec2 uMaterialLookupOrigin;
uniform int uMaterialLookupSize, uMaterialOverviewColumns, uMaterialDetailLayers;
uniform float uMaterialReady[8], uMaterialRepeat[8];

// The existing custom terrain/rock shader outputs display RGB directly.
// Material images are sRGB textures, so the GPU samples them in linear RGB.
// Blend in linear space, then return to the terrain's display-color contract
// before its existing stylized lighting, rock coverage and atmosphere.
vec3 materialDisplayToLinear(vec3 color) {
  return mix(pow((color + .055) / 1.055, vec3(2.4)), color / 12.92, lessThanEqual(color, vec3(.04045)));
}

vec3 materialLinearToDisplay(vec3 color) {
  color = max(color, vec3(0.0));
  return mix(1.055 * pow(color, vec3(1.0 / 2.4)) - .055, color * 12.92, lessThanEqual(color, vec3(.0031308)));
}

vec2 materialTileLayers(ivec2 tile) {
  ivec2 cell = tile - ivec2(uMaterialLookupOrigin);
  if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(uMaterialLookupSize)))) return vec2(-1.0);
  return texelFetch(uMaterialLookup, cell, 0).rg - 1.0;
}

void materialMasks(vec2 source, out vec4 weights0, out vec4 weights1) {
  vec2 position = source / 256.0;
  ivec2 tile = ivec2(floor(position));
  vec2 local = fract(position);
  vec2 layers = materialTileLayers(tile);
  weights0 = vec4(0.0); weights1 = vec4(0.0);
  if (layers.y >= 0.0) {
    float columns = float(uMaterialOverviewColumns);
    vec2 slot = vec2(mod(layers.y, columns), floor(layers.y / columns));
    vec2 uv = (slot * 17.0 + local * 16.0 + .5) / vec2(columns * 17.0, columns * 34.0);
    weights0 = texture(uMaterialOverview, uv);
    weights1 = texture(uMaterialOverview, uv + vec2(0.0, .5));
  }
  if (layers.x >= 0.0) {
    vec2 uv = (local * 128.0 + .5) / 129.0;
    vec4 detail0 = texture(uMaterialMasks, vec3(uv, layers.x));
    vec4 detail1 = texture(uMaterialMasks, vec3(uv, layers.x + float(uMaterialDetailLayers)));
    // A detailed edge meets its neighbour's overview continuously. Full/full
    // edges retain 2 m paint detail; only mixed-residency boundaries fade.
    float edgeDistance = 8.0;
    if (materialTileLayers(tile + ivec2(-1, 0)).x < 0.0) edgeDistance = min(edgeDistance, local.x * 256.0);
    if (materialTileLayers(tile + ivec2(1, 0)).x < 0.0) edgeDistance = min(edgeDistance, (1.0-local.x) * 256.0);
    if (materialTileLayers(tile + ivec2(0, -1)).x < 0.0) edgeDistance = min(edgeDistance, local.y * 256.0);
    if (materialTileLayers(tile + ivec2(0, 1)).x < 0.0) edgeDistance = min(edgeDistance, (1.0-local.y) * 256.0);
    float detailMix = layers.y >= 0.0 ? smoothstep(0.0, 8.0, edgeDistance) : 1.0;
    weights0 = mix(weights0, detail0, detailMix); weights1 = mix(weights1, detail1, detailMix);
  }
}

vec3 terrainPaintColor(vec2 source, vec3 baseColor) {
  if (!uMaterialEnabled) return baseColor;
  vec4 weights0, weights1;
  materialMasks(source, weights0, weights1);
  vec3 paint = vec3(0.0);
  float coverage = 0.0;
  vec2 dx = dFdx(source), dy = dFdy(source);
  ${Array.from({ length: 8 }, (_, i) => `
  float weight${i} = ${i < 4 ? "weights0" : "weights1"}[${i % 4}] * uMaterialReady[${i}];
  if (weight${i} > 0.00001) {
    paint += textureGrad(uMaterialMaps, vec3(source / uMaterialRepeat[${i}], ${i}.0), dx / uMaterialRepeat[${i}], dy / uMaterialRepeat[${i}]).rgb * weight${i};
    coverage += weight${i};
  }`).join("\n")}
  if (coverage <= 0.0) return baseColor;
  vec3 linearColor = materialDisplayToLinear(baseColor) * max(0.0, 1.0-coverage) + paint / max(1.0, coverage);
  return materialLinearToDisplay(linearColor);
}
`;
