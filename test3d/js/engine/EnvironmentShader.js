import * as THREE from "three";

// Defaults preserve the standalone material previews. EnvironmentSystem binds
// the same live uniform objects to terrain, rocks, water and waterfall effects.
export function createEnvironmentUniforms() {
  return {
    uEnvironmentTint: { value: new THREE.Color(1, 1, 1) },
    uLightDirection: { value: new THREE.Vector3(-.45, .78, .42).normalize() },
    uSkyBackground: { value: null },
    uSkyResolution: { value: new THREE.Vector2(1, 1) },
    uSkyFadeEnabled: { value: false },
    uSkyFadeStart: { value: 3000 },
    uSkyFadeEnd: { value: 5200 },
    uSkyFadeStrength: { value: 1.00 },
  };
}

export const ENVIRONMENT_GLSL = `
  uniform vec3 uEnvironmentTint, uLightDirection;
  uniform sampler2D uSkyBackground;
  uniform vec2 uSkyResolution;
  uniform bool uSkyFadeEnabled;
  uniform float uSkyFadeStart, uSkyFadeEnd, uSkyFadeStrength;

  vec3 environmentToLinear(vec3 color) {
    return mix(pow((color + .055) / 1.055, vec3(2.4)), color / 12.92, lessThanEqual(color, vec3(.04045)));
  }

  vec3 environmentLightDisplayColor(vec3 color) {
    // Terrain and rocks output display RGB, whereas the environment tint is
    // linear illumination. Multiplying display RGB directly crushed nights.
    vec3 lit = max(environmentToLinear(color) * uEnvironmentTint, vec3(0.0));
    return mix(1.055 * pow(lit, vec3(1.0 / 2.4)) - .055, lit * 12.92, lessThanEqual(lit, vec3(.0031308)));
  }

  vec3 environmentFog(vec3 color, vec3 worldPosition, bool linearColor) {
    if (!uSkyFadeEnabled) return color;
    // Blend strongly into the live sky, retaining a little terrain contrast
    // at the horizon instead of the original full sky replacement.
    float fade = smoothstep(uSkyFadeStart, uSkyFadeEnd, distance(cameraPosition, worldPosition)) * uSkyFadeStrength;
    if (fade <= .0001) return color;
    // The ported sky and MaxWorld terrain output display RGB. Water's shader
    // converts its linear output to sRGB, so decode the captured sky there.
    vec3 sky = texture2D(uSkyBackground, gl_FragCoord.xy / uSkyResolution).rgb;
    if (linearColor) sky = environmentToLinear(sky);
    return mix(color, sky, fade);
  }
`;
