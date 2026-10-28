import * as THREE from "three";

// A camera-following cloud ceiling. The cloud silhouettes and their soft
// shading live in one alpha texture, avoiding procedural work for every cloud
// on every rendered pixel.
export class Clouds {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.cloudMap = new THREE.TextureLoader().load(new URL("../../assets/sky/cloud-map.png", import.meta.url).href);
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
      // The vertex shader places this layer at the far plane, behind terrain.
      depthTest: true,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(0.2028, 0.0815) },
        uDaylight: { value: 1 },
        uSunset: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uHorizonOffset: { value: 0 },
        uSunsetColor: { value: new THREE.Color(1.0, 0.48, 0.25) },
        uCloudMap: { value: this.cloudMap }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vec4(clip.xy, clip.w * .999999, clip.w);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uWind;
        uniform float uDaylight, uSunset, uHorizonOffset;
        uniform vec3 uSunDirection, uSunsetColor;
        uniform sampler2D uCloudMap;
        varying vec3 vDirection;

        void main() {
          vec3 d = normalize(vDirection + vec3(0.0, uHorizonOffset, 0.0));
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, d.y * 0.5 + 0.5);
          // Keep this sampling transform in sync with Sky.cloudStarOcclusion.
          const float horizon = 0.55;
          float cloudY = horizon + (uv.y - horizon) * 6.2;
          vec2 mapUv = vec2(fract(uv.x * 3.0 - uWind.x * uTime * 0.0118), clamp(cloudY, 0.0, 1.0));
          vec4 cloudSample = texture2D(uCloudMap, mapUv);
          float horizonCloudFade = smoothstep(horizon - 0.046, horizon + 0.020, uv.y);
          float alpha = cloudSample.a * 0.8 * horizonCloudFade;
          if (alpha < 0.003) discard;

          vec3 cloudColor = mix(cloudSample.rgb, vec3(1.0), 0.1) * 1.95;
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
    // Draw behind water and effects; the far-plane depth keeps opaque
    // terrain in front even though transparent clouds render afterwards.
    mesh.renderOrder = -900;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      mesh.position.copy(camera.position);
      mesh.updateMatrixWorld(true);
      material.uniforms.uHorizonOffset.value = THREE.MathUtils.clamp(camera.position.y / 5200, -.3, .3);
    };
    return mesh;
  }

  setEnvironment({ daylight, sunset, sunDirection }) {
    const uniforms = this.mesh.material.uniforms;
    uniforms.uDaylight.value = THREE.MathUtils.clamp(daylight, 0, 1);
    uniforms.uSunset.value = THREE.MathUtils.clamp(sunset, 0, 1);
    if (sunDirection) uniforms.uSunDirection.value.copy(sunDirection).normalize();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.cloudMap.dispose();
  }

  update(delta) {
    this.time += Math.min(Math.max(delta, 0), 0.1);
    this.mesh.material.uniforms.uTime.value = this.time;
  }
}
