import * as THREE from "three";

// A camera-following, procedural cloud ceiling.  It is deliberately a single
// low-poly dome and draw call: the detail comes from the fragment shader, not
// from lots of transparent cards or particles.
export class Clouds {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.mesh = this.createMesh();
    this.scene.add(this.mesh);
  }

  createMesh() {
    const material = new THREE.ShaderMaterial({
      // Clouds are a final atmosphere layer. Keeping them transparent makes
      // Three render them after the opaque, fog-faded world materials. They
      // still need the depth buffer, however: a mountain in front of the
      // horizon must occlude the sky, while the cloud layer remains visible
      // over the distant horizon fade.
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0.2028, 0.0815) },
        uDaylight: { value: 1 },
        uSunset: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uFogFar: { value: 1000 },
        uCameraHeight: { value: 1 },
        uDayColor: { value: new THREE.Color(0.96, 0.98, 1.0) },
        uNightColor: { value: new THREE.Color(0.10, 0.15, 0.25) },
        uSunsetColor: { value: new THREE.Color(1.0, 0.48, 0.25) }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
         
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uWind;
        uniform float uDaylight;
        uniform float uSunset;
        uniform vec3 uSunDirection;
        uniform float uFogFar;
        uniform float uCameraHeight;
        uniform vec3 uDayColor;
        uniform vec3 uNightColor;
        uniform vec3 uSunsetColor;
        varying vec3 vDirection;

        float hash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        // The longitude coordinate repeats at the sphere's mesh seam. Wrap
        // the lattice index too, otherwise makes a visible vertical
        // jump when UV.x switches from 1 back to 0.
        float periodicNoise(vec2 p, float periodX) {
          vec2 i = floor(p), f = fract(p);
          i.x = mod(i.x, periodX);
          // The final cell must blend back into cell zero. Wrapping only 
          // still leaves its +X neighbour outside the period, which creates a
          // hard line that drifts through the cloud field with the wind.
          vec2 next = vec2(mod(i.x + 1.0, periodX), i.y + 1.0);
         
          return mix(mix(hash(i), hash(vec2(next.x, i.y)), f.x),
                     mix(hash(vec2(i.x, next.y)), hash(next), f.x), f.y);
        }
        // Three octaves retain soft, layered shapes without a costly raymarch.
        float cloudNoise(vec2 p) {
          float n = periodicNoise(p, 40.0);
          n += periodicNoise(p * 2.0 + 11.7, 10.0) * 0.48;
          n += periodicNoise(p * 4.0 + 29.4, 20.0) * 0.20;
          return n / 1.60;
        }
        void main() {
          vec3 d = normalize(vDirection);
          // Spherical coordinates avoid clouds sliding with the camera.
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, d.y);
          vec2 drift = uWind * uTime;
          // Use an integer number of longitudinal cells so every octave
          // reaches precisely the same value on both sides of the seam.
          float density = cloudNoise(uv * vec2(80.0, 40.0) + drift);
          float cloud = smoothstep(0.51, 0.67, density);

float densityWidth = max(fwidth(density), 0.0001);

float underside =
    clamp(
        dFdy(density) / densityWidth,
        0.0,
        1.0
    );

// Only affect actual cloud pixels.
underside *= cloud;

          // Beneath the horizon, only render clouds where the ground is at
          // fog.far. This aligns the cloud cutoff with the material fade.
          float horizonFade = 1.0;
          if (d.y < -0.0001) {
            float rayDistance = uCameraHeight / -d.y;
            vec3 cameraRay = normalize((viewMatrix * vec4(d, 0.0)).xyz);
            float groundFogDepth = rayDistance * max(-cameraRay.z, 0.0);
            horizonFade = smoothstep(uFogFar * 0.88, uFogFar, groundFogDepth);
          }
          float overheadFade = 1.0 - smoothstep(0.96, 1.0, d.y) * 0.18;
          float alpha = (cloud) * horizonFade * overheadFade * 0.92;
          if (alpha < 0.003) discard;

          float towardSun = pow(max(dot(d, normalize(uSunDirection)), 0.0), 7.0);
          
          vec3 base = mix(
    uNightColor,
    uDayColor,
    uDaylight
);

base = mix(
    base,
    uSunsetColor,
    uSunset * (0.58 + 0.42 * horizonFade)
);


// ---------------------------------------------
// Darker underside
// ---------------------------------------------



float underside2 =
    clamp(
        dFdy(density) / densityWidth,
        0.0,
        1.0
    );

underside2 *= cloud;

// 0.78 = darkest underside.
// Try 0.85 for more subtle,
// 0.70 for stronger.
base *= mix(
    1.0,
    0.90,
    underside2
);


// ---------------------------------------------
// Sun lighting
// ---------------------------------------------

float towardSun2 =
    pow(
        max(
            dot(d, normalize(uSunDirection)),
            0.0
        ),
        7.0
    );

float sunLight =
    towardSun2 *
    smoothstep(
        -0.08,
        0.25,
        uSunDirection.y
    );

base +=
    vec3(1.0, 0.68, 0.34)
    * sunLight
    * (0.20 + uSunset * 0.42);

base *= mix(
    0.62,
    1.0,
    uDaylight
);

gl_FragColor = vec4(base, alpha);
        }
      `
    });
    // This is a depth surface as well as a sky surface. Keep its geometry at
    // unit size and place it at the fog transition per frame. A fixed 880-unit
    // dome sits behind the whole map (whose fog ends around 70), making all
    // distant terrain hide the clouds.
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    mesh.name = "Procedural clouds";
    mesh.renderOrder = 900;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      mesh.position.copy(camera.position);
      const fogFar = this.scene.fog?.far ?? 1000000;
      material.uniforms.uFogFar.value = fogFar;
      // The fragment fade begins at 88% of fog.far. Put the depth surface a
      // touch nearer, so foreground mountains occlude it while the fully
      // fogged ground beyond the horizon blends beneath the clouds.
      mesh.scale.setScalar(Math.max(1, fogFar * 0.875));
      material.uniforms.uCameraHeight.value = Math.max(camera.position.y, 0.01);
    };
    return mesh;
  }

  setEnvironment({ daylight, sunset, sunDirection }) {
    const uniforms = this.mesh.material.uniforms;
    uniforms.uDaylight.value = THREE.MathUtils.clamp(daylight, 0, 1);
    uniforms.uSunset.value = THREE.MathUtils.clamp(sunset, 0, 1);
    if (sunDirection) uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }

  update(delta) {
    this.time += Math.min(Math.max(delta, 0), 0.1);
    this.mesh.material.uniforms.uTime.value = this.time;
  }
}
