import * as THREE from "three";
import { createEnvironmentUniforms, ENVIRONMENT_GLSL } from "../engine/EnvironmentShader.js";

export function createGrassMaterial(far = false) {
  return new THREE.ShaderMaterial({
    name: far ? "Far grass" : "NextWorld grass tufts", side: THREE.DoubleSide,
    uniforms: {
      ...createEnvironmentUniforms(),
      uTime: { value: 0 }, uWind: { value: 1 }, uWindSpeed: { value: 1 }, uScale: { value: .32 },
      uVariation: { value: .65 }, uNear: { value: 30 }, uFar: { value: 80 }, uMax: { value: 150 },
      uTransition: { value: 6 }, uBase: { value: new THREE.Vector3() }, uTip: { value: new THREE.Vector3() },
    },
    vertexShader: `
      attribute vec4 grassRoot, grassData;
      ${far ? "" : "attribute vec3 shape1, shape2, shape3, shape4;"}
      uniform float uTime, uWind, uWindSpeed, uScale, uVariation, uNear, uFar, uMax, uTransition;
      varying vec3 vWorld;
      varying float vTip, vColor, vLod, vDensity;
      void main() {
        float type = floor(grassData.w);
        float random = fract(grassData.w);
        vec3 blade = position;
        ${far ? `
          vec2 profile = vec2(.95, 1.0);
          if (type == 1.0) profile = vec2(1.7, .55);
          else if (type == 2.0) profile = vec2(.7, 1.42);
          else if (type == 3.0) profile = vec2(1.55, .8);
          else if (type == 4.0) profile = vec2(.63, 1.12);
          blade.xy *= profile;
        ` : `
          if (type == 1.0) blade = shape1;
          else if (type == 2.0) blade = shape2;
          else if (type == 3.0) blade = shape3;
          else if (type == 4.0) blade = shape4;
        `}
        float d = distance(grassRoot.xz, cameraPosition.xz);
        vLod = smoothstep(uNear-uTransition*.5, uNear+uTransition*.5, d);
        float density = 1.0 - smoothstep(uFar, uMax, d);
        vDensity = density;
        // Sorted random ranks permit CPU instance-count reduction on distant
        // cells. This per-root test gives an exact circular maximum range.
        float shrink = smoothstep(random-.035, random+.035, density);
        float lodVisible = ${far ? "step(.00001, vLod)" : "1.0-step(.99999, vLod)"};
        vTip = clamp(blade.y / 3.0, 0.0, 1.0);
        vColor = grassData.z;
        blade.xz *= uScale * mix(1.0, grassRoot.w, uVariation);
        blade.y *= uScale * mix(1.0, grassData.y, uVariation) * shrink * lodVisible;
        float c = cos(grassData.x), s = sin(grassData.x);
        blade.xz = mat2(c, -s, s, c) * blade.xz;
        // NextWorld's phase and quadratic tip response, bounded for culling.
        float phase = grassRoot.x*.35 + grassRoot.z*.28 + position.x*17.3 + uTime*uWindSpeed*1.6;
        float wind = sin(phase) * .12 * vTip*vTip * uWind * uScale;
        blade.xz += vec2(wind, wind*.4);
        vec3 world = grassRoot.xyz + blade;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      ${ENVIRONMENT_GLSL}
      uniform vec3 uBase, uTip;
      uniform float uVariation;
      varying vec3 vWorld;
      varying float vTip, vColor, vLod, vDensity;
      void main() {
        // Opaque complementary dithering in a narrow overlap. No alpha
        // blending, sorting, textures or shadow maps. No temporal randomness.
        float pixel = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
        if (${far ? "pixel >= vLod" : "pixel < vLod"} || vDensity <= 0.0) discard;
        vec3 color = mix(uBase, uTip, vTip);
        color *= mix(vec3(1.0), vec3(.78+.34*vColor, .84+.25*vColor, .68+.30*vColor), uVariation);
        color *= environmentGroundLight(vec3(0,1,0));
        gl_FragColor = vec4(environmentFog(environmentLightDisplayColor(color), vWorld, false), 1.0);
      }`,
  });
}
