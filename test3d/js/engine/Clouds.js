import * as THREE from "three";

// A camera-following, procedural cloud ceiling. It is deliberately a single
// low-poly dome and draw call: the shader composes seven pleasing cloud banks,
// then gives their individual puffs a little irregularity.
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
        vec2 longitudeDelta(vec2 a, vec2 b) {
          vec2 delta = a - b;
          delta.x = fract(delta.x + 0.5) - 0.5;
          return delta;
        }

        // A small, deliberately arranged collection of soft puffs. The
        // random values only vary the puffs within the silhouette, so this
        // reads as a cloud rather than a field of unrelated noise.
        float cloudBank(
    vec2 point,
    vec2 centre,
    vec2 size,
    float seed,
    float fluffHeight,
    out float undersideShade
) {
    vec2 local = longitudeDelta(point, centre) / size;
    float mass = 0.0;



    for (int i = 0; i < 9; i++) {
        float index = float(i);
        float angle = hash(vec2(seed, index)) * 6.2831853;
        float spread = mix(
            0.18,
            0.78,
            hash(vec2(index, seed + 3.1))
        );

        vec2 puffCentre =
    vec2(
        cos(angle) * spread,
        sin(angle) * spread * fluffHeight
    );

        puffCentre.y += mix(
    -0.10,
     0.26,
    hash(vec2(seed + 8.7, index))
);

        float radius = mix(
            0.32,
            0.54,
            hash(vec2(seed + 5.4, index))
        );

        if (i == 0) {
    puffCentre = vec2(0.0, 0.08);
    radius = 0.64;
}

        float puff =
            1.0 -
            smoothstep(
                radius * 0.62,
                radius,
                length(local - puffCentre)
            );

        mass = max(mass, puff);
    }

    float edgeDetail =
        periodicNoise(local * 5.0 + seed, 10.0) - 0.5;

    float shape =
        smoothstep(
            0.28,
            0.56,
            mass + edgeDetail * 0.13
        );

    // Lower part of THIS cloud.
    float lower =
    1.0 - smoothstep(-0.45, 0.38, local.y);

    // Make the shadow slightly irregular rather than a straight line.
    float shadowNoise =
        periodicNoise(
            local * 3.0 + seed * 1.37,
            10.0
        );

    lower *= mix(
        0.78,
        1.12,
        shadowNoise
    );

    undersideShade =
        shape *
        clamp(lower, 0.0, 1.0);
float shadeStrength = mix(0.65, 1.0, hash(vec2(seed, 9.3)));
undersideShade *= shadeStrength;
    return shape;
}
        void main() {
          vec3 d = normalize(vDirection);
          // Spherical coordinates avoid clouds sliding with the camera.
          vec2 uv = vec2(
            atan(d.z, d.x) * 0.15915494 + 0.5,
            d.y * 0.5 + 0.5
          );
          // Move seven composed formations very slowly, preserving their shape
          // while allowing the sky to evolve over a long session.
          vec2 drift = uWind * uTime * 0.009;
          // Each bank is one tenth of the original formation size. Their
          // different seeds keep the small silhouettes distinct without
          // turning the sky back into fully random cloud noise.
float shadeA;
float shadeB;
float shadeC;
float shadeD;
float shadeE;
float shadeF;
float shadeG;

float shadeA2;
float shadeB2;
float shadeC2;
float shadeD2;
float shadeE2;
float shadeF2;
float shadeG2;

float shadeA3;
float shadeB3;
float shadeC3;
float shadeD3;
float shadeE3;
float shadeF3;
float shadeG3;

float shadeA4;
float shadeB4;
float shadeC4;
float shadeD4;
float shadeE4;
float shadeF4;
float shadeG4;

float shadeA5;
float shadeB5;
float shadeC5;
float shadeD5;
float shadeE5;
float shadeF5;
float shadeG5;

float shadeA6;
float shadeB6;
float shadeC6;
float shadeD6;
float shadeE6;
float shadeF6;
float shadeG6;

float shadeA7;
float shadeB7;
float shadeC7;
float shadeD7;
float shadeE7;
float shadeF7;
float shadeG7;

float shadeA8;
float shadeB8;
float shadeC8;
float shadeD8;
float shadeE8;
float shadeF8;
float shadeG8;

float shadeA9;
float shadeB9;
float shadeC9;
float shadeD9;
float shadeE9;
float shadeF9;
float shadeG9;

float shadeA10;
float shadeB10;
float shadeC10;
float shadeD10;
float shadeE10;
float shadeF10;
float shadeG10;

// ----------------------------------------------------
// RAD 1 - precis vid horisonten
// Små och ganska platta moln.
// Horizon = uv.y ~ 0.50
// ----------------------------------------------------

float bankA = cloudBank(
    uv - drift * 0.62,
    vec2(0.03, 0.468), vec2(0.018, 0.0048),
    14.0,0.38,
    shadeA
);

float bankB = cloudBank(
    uv - drift * 0.68,
    vec2(0.17, 0.471), vec2(0.014, 0.0045),
    41.0, 0.40,
    shadeB
);

float bankC = cloudBank(
    uv - drift * 0.58,
    vec2(0.31, 0.467), vec2(0.020, 0.0052),
    73.0,0.38,
    shadeC
);

float bankD = cloudBank(
    uv - drift * 0.73,
    vec2(0.45, 0.473), vec2(0.015, 0.0048),
    96.0, 0.50,
    shadeD
);

float bankE = cloudBank(
    uv - drift * 0.64,
   vec2(0.59, 0.469), vec2(0.021, 0.0052),
    122.0,0.41,
    shadeE
);

float bankF = cloudBank(
    uv - drift * 0.70,
    vec2(0.73, 0.472), vec2(0.016, 0.0047),
    157.0,0.39,
    shadeF
);

float bankG = cloudBank(
    uv - drift * 0.60,
    vec2(0.88, 0.468), vec2(0.019, 0.0050),
    189.0,0.41,
    shadeG
);


// ----------------------------------------------------
// RAD 2 - lite ovanför horisonten
// Fortfarande många moln.
// ----------------------------------------------------

float bankA2 = cloudBank(
    uv - drift * 0.74,
    vec2(0.10, 0.476), vec2(0.020, 0.0070),
    211.0,0.60,
    shadeA2
);

float bankB2 = cloudBank(
    uv - drift * 0.66,
    vec2(0.24, 0.481), vec2(0.016, 0.0065),
    237.0,0.52,
    shadeB2
);

float bankC2 = cloudBank(
    uv - drift * 0.79,
    vec2(0.38, 0.473), vec2(0.022, 0.0075),
    269.0,0.48,
    shadeC2
);

float bankD2 = cloudBank(
    uv - drift * 0.69,
    vec2(0.52, 0.473), vec2(0.017, 0.0070),
    293.0,0.64,
    shadeD2
);

float bankE2 = cloudBank(
    uv - drift * 0.76,
    vec2(0.66, 0.477), vec2(0.021, 0.0075),
    317.0,0.50,
    shadeE2
);

float bankF2 = cloudBank(
    uv - drift * 0.63,
    vec2(0.80, 0.475), vec2(0.015, 0.0065),
    349.0,0.53,
    shadeF2
);

float bankG2 = cloudBank(
    uv - drift * 0.72,
    vec2(0.95, 0.475), vec2(0.019, 0.0070),
    373.0,0.60,
    shadeG2
);


// ----------------------------------------------------
// RAD 3 - mellanavstånd
// Lite större och luftigare.
// ----------------------------------------------------

float bankA3 = cloudBank(
    uv - drift * 0.81,
    vec2(0.05, 0.49),
    vec2(0.020, 0.010),
    401.0,0.70,
    shadeA3
);

float bankB3 = cloudBank(
    uv - drift * 0.75,
    vec2(0.21, 0.49),
    vec2(0.017, 0.010),
    431.0,0.70,
    shadeB3
);

float bankC3 = cloudBank(
    uv - drift * 0.86,
    vec2(0.35, 0.49),
    vec2(0.023, 0.011),
    463.0,0.70,
    shadeC3
);

float bankD3 = cloudBank(
    uv - drift * 0.78,
    vec2(0.50, 0.49),
    vec2(0.018, 0.010),
    491.0,0.70,
    shadeD3
);

float bankE3 = cloudBank(
    uv - drift * 0.83,
    vec2(0.64, 0.49),
    vec2(0.021, 0.011),
    521.0,0.70,
    shadeE3
);

float bankF3 = cloudBank(
    uv - drift * 0.72,
    vec2(0.79, 0.49),
    vec2(0.017, 0.009),
    557.0,0.70,
    shadeF3
);

float bankG3 = cloudBank(
    uv - drift * 0.88,
    vec2(0.92, 0.49),
    vec2(0.022, 0.011),
    587.0,0.70,
    shadeG3
);


// ----------------------------------------------------
// RAD 4 - högt på himlen
// Betydligt färre visuellt, större luckor.
// ----------------------------------------------------

float bankA4 = cloudBank(
    uv - drift * 0.92,
    vec2(0.08, 0.50),
    vec2(0.022, 0.014),
    617.0,0.80,
    shadeA4
);

float bankB4 = cloudBank(
    uv - drift * 0.84,
    vec2(0.26, 0.50),
    vec2(0.018, 0.013),
    647.0,0.80,
    shadeB4
);

float bankC4 = cloudBank(
    uv - drift * 0.96,
    vec2(0.42, 0.50),
    vec2(0.024, 0.015),
    673.0,0.80,
    shadeC4
);

float bankD4 = cloudBank(
    uv - drift * 0.88,
    vec2(0.58, 0.50),
    vec2(0.020, 0.014),
    701.0,0.80,
    shadeD4
);

float bankE4 = cloudBank(
    uv - drift * 0.94,
    vec2(0.71, 0.50),
    vec2(0.023, 0.015),
    733.0,0.80,
    shadeE4
);

float bankF4 = cloudBank(
    uv - drift * 0.82,
    vec2(0.84, 0.50),
    vec2(0.018, 0.013),
    761.0,0.80,
    shadeF4
);

float bankG4 = cloudBank(
    uv - drift * 0.90,
    vec2(0.96, 0.50),
    vec2(0.021, 0.014),
    797.0,0.80,
    shadeG4
);
// ----------------------------------------------------
// RAD 5 - högt på himlen
// Betydligt färre visuellt, större luckor.
// ----------------------------------------------------

float bankA5 = cloudBank(
    uv - drift * 0.92,
    vec2(0.18, 0.55),
    vec2(0.022, 0.014),
    617.0,0.80,
    shadeA5
);

float bankB5 = cloudBank(
    uv - drift * 0.84,
    vec2(0.36, 0.55),
    vec2(0.018, 0.013),
    647.0,0.80,
    shadeB5
);

float bankC5 = cloudBank(
    uv - drift * 0.96,
    vec2(0.52, 0.55),
    vec2(0.024, 0.015),
    673.0,0.80,
    shadeC5
);

float bankD5 = cloudBank(
    uv - drift * 0.88,
    vec2(0.68, 0.55),
    vec2(0.020, 0.014),
    701.0,0.80,
    shadeD5
);

float bankE5 = cloudBank(
    uv - drift * 0.94,
    vec2(0.81, 0.55),
    vec2(0.023, 0.015),
    733.0,0.80,
    shadeE5
);

float bankF5 = cloudBank(
    uv - drift * 0.82,
    vec2(0.94, 0.55),
    vec2(0.018, 0.013),
    761.0,0.80,
    shadeF5
);

float bankG5 = cloudBank(
    uv - drift * 0.90,
    vec2(0.99, 0.55),
    vec2(0.021, 0.014),
    797.0,0.80,
    shadeG5
    
);


float cloud1 = max(
    max(max(bankA, bankB), max(bankC, bankD)),
    max(max(bankE, bankF), bankG)
);

float cloud2 = max(
    max(max(bankA2, bankB2), max(bankC2, bankD2)),
    max(max(bankE2, bankF2), bankG2)
);

float cloud3 = max(
    max(max(bankA3, bankB3), max(bankC3, bankD3)),
    max(max(bankE3, bankF3), bankG3)
);

float cloud4 = max(
    max(max(bankA4, bankB4), max(bankC4, bankD4)),
    max(max(bankE4, bankF4), bankG4)
);
float cloud5 = max(
    max(max(bankA5, bankB5), max(bankC5, bankD5)),
    max(max(bankE5, bankF5), bankG5)
);

float cloud = max(
    max(max(cloud1, cloud2), max(cloud3, cloud4)),
    cloud5
);

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


float underside1 = max(
    max(max(shadeA, shadeB), max(shadeC, shadeD)),
    max(max(shadeE, shadeF), shadeG)
);

float underside2 = max(
    max(max(shadeA2, shadeB2), max(shadeC2, shadeD2)),
    max(max(shadeE2, shadeF2), shadeG2)
);

float underside3 = max(
    max(max(shadeA3, shadeB3), max(shadeC3, shadeD3)),
    max(max(shadeE3, shadeF3), shadeG3)
);

float underside4 = max(
    max(max(shadeA4, shadeB4), max(shadeC4, shadeD4)),
    max(max(shadeE4, shadeF4), shadeG4)
);
float underside5 = max(
    max(max(shadeA5, shadeB5), max(shadeC5, shadeD5)),
    max(max(shadeE5, shadeF5), shadeG5)
);


float underside = max(max(
    max(underside1, underside2),
    max(underside3, underside4)),underside5
);

float shadowStrength =
    mix(0.10, 0.30, uDaylight)
    + uSunset * 0.04;

base *=
    1.0 -
    underside * shadowStrength;

          float sunLight = towardSun * smoothstep(-0.08, 0.25, uSunDirection.y);
          base += vec3(1.0, 0.68, 0.34)
    * sunLight
    * (0.20 + uSunset * 0.42)
    * (1.0 - underside * 0.65);
          base *= mix(0.62, 1.0, uDaylight);

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
