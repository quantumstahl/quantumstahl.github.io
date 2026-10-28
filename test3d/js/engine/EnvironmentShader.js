import * as THREE from "three";

// Defaults preserve the standalone material previews. EnvironmentSystem binds
// the same live uniform objects to terrain, rocks, water and waterfall effects.
export function createEnvironmentUniforms() {
  return {
    uEnvironmentTint: { value: new THREE.Color(1, 1, 1) },
    uLightDirection: { value: new THREE.Vector3(-.45, .78, .42).normalize() },
    uMoonLightDirection: { value: new THREE.Vector3(.45, -.78, -.42).normalize() },
    uDaylight: { value: 1 },
    uSkyBackground: { value: null },
    uSkyResolution: { value: new THREE.Vector2(1, 1) },
    uSkyFadeEnabled: { value: false },
    uSkyFadeStart: { value: 3000 },
    uSkyFadeEnd: { value: 5200 },
    uSkyFadeStrength: { value: 1.00 },
  };
}

export const ENVIRONMENT_GLSL = `
  uniform vec3 uEnvironmentTint, uLightDirection, uMoonLightDirection;
  uniform float uDaylight;
  uniform sampler2D uSkyBackground;
  uniform vec2 uSkyResolution;
  uniform bool uSkyFadeEnabled;
  uniform float uSkyFadeStart, uSkyFadeEnd, uSkyFadeStrength;

  // Blend the illumination from both lights. Switching between opposite
  // directions at twilight caused terrain and water to change in one frame.
  float environmentDiffuse(vec3 normal) {
    float sun = max(dot(normal, uLightDirection), 0.0);
    float moon = max(dot(normal, uMoonLightDirection), 0.0);
    return mix(moon, sun, uDaylight);
  }

  float environmentGroundLight(vec3 normal) {
    float sun = clamp(dot(normal, uLightDirection) * .42 + .58, .30, 1.0);
    float moon = clamp(dot(normal, uMoonLightDirection) * .42 + .58, .30, 1.0);
    return mix(moon, sun, uDaylight);
  }

  float environmentSpecular(vec3 normal, vec3 viewDirection, float shininess) {
    vec3 sunHalf = viewDirection + uLightDirection;
    vec3 moonHalf = viewDirection + uMoonLightDirection;
    sunHalf *= inversesqrt(max(dot(sunHalf, sunHalf), .000001));
    moonHalf *= inversesqrt(max(dot(moonHalf, moonHalf), .000001));
    float sun = pow(max(dot(normal, sunHalf), 0.0), shininess);
    float moon = pow(max(dot(normal, moonHalf), 0.0), shininess);
    return mix(moon, sun, uDaylight);
  }

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
