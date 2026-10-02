import * as THREE from "three";

// A camera-following cloud ceiling. The cloud silhouettes and their soft
// shading live in one alpha texture, avoiding procedural work for every cloud
// on every rendered pixel.
export class Clouds {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.cloudMap = new THREE.TextureLoader().load("assets/cloud-map.png");
    this.cloudMap.colorSpace = THREE.SRGBColorSpace;
    this.cloudMap.wrapS = THREE.RepeatWrapping;
    this.cloudMap.wrapT = THREE.ClampToEdgeWrapping;
    this.cloudMap.minFilter = THREE.LinearFilter;
    this.cloudMap.magFilter = THREE.LinearFilter;
    this.cloudMap.generateMipmaps = false;
    this.mesh = this.createMesh();
    this.scene.add(this.mesh);
  }

  createMesh() {
    const material = new THREE.ShaderMaterial({
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
        uSunsetColor: { value: new THREE.Color(1.0, 0.48, 0.25) },
        uCloudMap: { value: this.cloudMap }
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
        uniform vec3 uSunsetColor;
        uniform sampler2D uCloudMap;
        varying vec3 vDirection;

        void main() {
          vec3 d = normalize(vDirection);
          vec2 uv = vec2(
            atan(d.z, d.x) * 0.15915494 + 0.5,
            d.y * 0.5 + 0.5
          );

          // One filtered texture lookup replaces all individual procedural
          // cloud-bank, puff, and noise calculations.
          float horizon = 0.502;

// 2.0 = molnen blir ungefär hälften så breda.
// Heltal är bra här eftersom X wrappar sömlöst.
float cloudScaleX = 3.0;

// > 1.0 pressar molnen mot horisonten
// och gör dem samtidigt lägre/mindre.
float cloudScaleY = 6.2;

float cloudY =
    horizon +
    (uv.y - horizon) * cloudScaleY;

vec2 mapUv = vec2(
    fract(
        uv.x * cloudScaleX
        - uWind.x * uTime * 0.0118
    ),
    clamp(cloudY, 0.0, 1.0)
);

vec4 cloudSample = texture2D(
    uCloudMap,
    mapUv
);
         
          float cloud = cloudSample.a;

    

          // Soften clouds as they meet the horizon instead of leaving a hard
          // texture edge. Raise the second value for a broader fade band.
          float horizonCloudFade = smoothstep(
              horizon - 0.043,
              horizon + 0.020,
              uv.y
          );
          float alpha = cloud * 0.70 * horizonCloudFade;


          
          if (alpha < 0.003) discard;

          // The texture supplies puff shading; environment values still tint
          // it consistently with the existing day/night and sunset system.
vec3 cloudColor = cloudSample.rgb;

// lite mindre blågrått
float brightness = dot(
    cloudColor,
    vec3(0.199, 0.487, 0.114)
);

cloudColor = mix(
    cloudColor,
    vec3(brightness),
    0.95
);

cloudColor *= 1.95;

          vec3 base = cloudColor * mix(0.18, 1.0, uDaylight);




          base = mix(base, uSunsetColor, uSunset * 0.32);
          float towardSun = pow(max(dot(d, normalize(uSunDirection)), 0.0), 7.0);
          float sunLight = towardSun * smoothstep(-0.08, 0.25, uSunDirection.y);



          
          base += vec3(1.0, 0.68, 0.34) * sunLight * (0.16 + uSunset * 0.30);

          gl_FragColor = vec4(base, alpha);
        }
      `
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    mesh.name = "Textured clouds";
    mesh.renderOrder = 900;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      mesh.position.copy(camera.position);
      const fogFar = this.scene.fog?.far ?? 1000000;
      material.uniforms.uFogFar.value = fogFar;
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
