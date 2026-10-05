import * as THREE from "three";

// Builds only water cells below the configured level, then shades the surface
// with inexpensive procedural waves. No external normal map is required.
export class Water {
  constructor(scene) { this.scene = scene; this.mesh = null; this.material = null; this.sunPosition = new THREE.Vector3(); this.sunTargetPosition = new THREE.Vector3(); this.chunkRoot = null; this.chunkMeshes = new Map(); this.chunkConfig = null; }
  setSunDirection(sun, reflectionStrength = 1) {
    if (!this.material || !sun?.isDirectionalLight || !sun.target) return false;
    this.material.uniforms.uSunReflectionStrength.value = THREE.MathUtils.clamp(reflectionStrength, 0, 1);
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false);
    sun.getWorldPosition(this.sunPosition); sun.target.getWorldPosition(this.sunTargetPosition);
    const direction = this.sunPosition.sub(this.sunTargetPosition);
    if (direction.lengthSq() < 1e-8) return false;
    this.material.uniforms.uSunDirection.value.copy(direction.normalize());
    return true;
  }
createMaterial(config) {

  const material = new THREE.ShaderMaterial({

    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,

    uniforms: {
      uTime: {
        value: 0
      },

      uColor: {
        value: new THREE.Color(config.color)
      },

      uOpacity: {
        value: config.opacity
      },

      uCameraPosition: {
        value: new THREE.Vector3()
      },

      uBackgroundTexture: { value: new THREE.Texture() },
      uFogNear: { value: 90 },
      uFogFar: { value: 190 },

      // Ungefär samma riktning som:
      // sun.position.set(15, 24, 10)
      uSunDirection: {
        value: new THREE.Vector3(
          15,
          24,
          10
        ).normalize()
      },
      // The procedural highlight is sunlight only; it must disappear after
      // sunset instead of making water look glossy under a dark sky.
      uSunReflectionStrength: { value: 1 }
    },


    vertexShader: /* glsl */`

      uniform float uTime;

      varying vec3 vWorldPosition;
      varying float vWave;
      varying vec4 vClipPosition;


      float getWaveHeight(
        vec2 p,
        float time
      ) {

        float wave1 =
          sin(
            p.x * 0.34 +
            p.y * 0.18 +
            time * 0.75
          ) * 0.035;

        float wave2 =
          sin(
            p.x * -0.22 +
            p.y * 0.41 +
            time * 0.55
          ) * 0.025;

        float wave3 =
          sin(
            (p.x + p.y) * 0.14 -
            time * 0.38
          ) * 0.018;

        return
          wave1 +
          wave2 +
          wave3;
      }


      void main() {

        vec3 p = position;

        float wave =
          getWaveHeight(
            p.xz,
            uTime
          );

        p.y += wave;

        vWave = wave;

        vec4 worldPosition =
          modelMatrix *
          vec4(p, 1.0);

        vWorldPosition =
          worldPosition.xyz;

        gl_Position =
          projectionMatrix *
          viewMatrix *
          worldPosition;

        vClipPosition = gl_Position;
      }
    `,


    fragmentShader: /* glsl */`

      uniform float uTime;
      uniform float uSunReflectionStrength;

      uniform vec3 uColor;
      uniform float uOpacity;

      uniform vec3 uCameraPosition;
      uniform vec3 uSunDirection;
      uniform sampler2D uBackgroundTexture;
      uniform float uFogNear;
      uniform float uFogFar;


      varying vec3 vWorldPosition;
      varying float vWave;
      varying vec4 vClipPosition;


      // ------------------------------------------------
      // Procedural wave normal
      // ------------------------------------------------

      vec2 waveSlope(
        vec2 p,
        float time
      ) {

        vec2 slope =
          vec2(0.0);


        // Wave 1

        float a1 =
          p.x * 0.72 +
          p.y * 0.38 +
          time * 1.05;

        float c1 =
          cos(a1);

        slope +=
          vec2(
            0.72,
            0.38
          ) *
          c1 *
          0.055;


        // Wave 2

        float a2 =
          p.x * -0.48 +
          p.y * 0.91 -
          time * 0.82;

        float c2 =
          cos(a2);

        slope +=
          vec2(
            -0.48,
            0.91
          ) *
          c2 *
          0.040;


        // Wave 3

        float a3 =
          p.x * 1.37 +
          p.y * 0.24 +
          time * 1.42;

        float c3 =
          cos(a3);

        slope +=
          vec2(
            1.37,
            0.24
          ) *
          c3 *
          0.018;


        // Wave 4

        float a4 =
          p.x * -0.31 +
          p.y * 1.52 -
          time * 1.18;

        float c4 =
          cos(a4);

        slope +=
          vec2(
            -0.31,
            1.52
          ) *
          c4 *
          0.015;


        return slope;
      }


      void main() {

        vec3 viewDirection =
          normalize(
            uCameraPosition -
            vWorldPosition
          );


        // --------------------------------------------
        // Wave normal
        // --------------------------------------------

        vec2 slope =
          waveSlope(
            vWorldPosition.xz,
            uTime
          );


        vec3 normal =
          normalize(
            vec3(
              -slope.x,
              1.0,
              -slope.y
            )
          );


        // --------------------------------------------
        // Fresnel
        // --------------------------------------------

        float facing =
          max(
            dot(
              normal,
              viewDirection
            ),
            0.0
          );


        float fresnel =
          pow(
            1.0 - facing,
            4.0
          );


        fresnel =
          0.08 +
          fresnel * 0.92;


        // --------------------------------------------
        // Base water
        // --------------------------------------------

        vec3 deepWater =
          uColor * 0.56;


        vec3 shallowWater =
          uColor * 1.08;


        float waveBrightness =
          clamp(
            0.48 +
            vWave * 4.0,
            0.0,
            1.0
          );


        vec3 waterColor =
          mix(
            deepWater,
            shallowWater,
            waveBrightness
          );


        // --------------------------------------------
        // Fake sky reflection
        // --------------------------------------------

        vec3 reflectedDirection =
          reflect(
            -viewDirection,
            normal
          );


        float skyAmount =
          smoothstep(
            -0.10,
            0.75,
            reflectedDirection.y
          );


        vec3 horizonSky =
          vec3(
            0.58,
            0.76,
            0.91
          );


        vec3 upperSky =
          vec3(
            0.10,
            0.39,
            0.72
          );


        vec3 skyReflection =
          mix(
            horizonSky,
            upperSky,
            skyAmount
          );


        // --------------------------------------------
        // Mix water + reflection
        // --------------------------------------------

        vec3 color =
          mix(
            waterColor,
            skyReflection,
            fresnel * 0.58
          );


        // --------------------------------------------
        // Sun reflection
        // --------------------------------------------

        vec3 sunDirection =
          normalize(
            uSunDirection
          );


        vec3 halfDirection =
          normalize(
            viewDirection +
            sunDirection
          );


        float specular =
          max(
            dot(
              normal,
              halfDirection
            ),
            0.0
          );


        // Bred glow
        float sunGlow =
          pow(
            specular,
            38.0
          );


        // Liten stark highlight
        float sunSparkle =
          pow(
            specular,
            180.0
          );


        color +=
          vec3(
            1.0,
            0.82,
            0.48
          ) *
          sunGlow *
          0.20 *
          uSunReflectionStrength;


        color +=
          vec3(
            1.0,
            0.94,
            0.75
          ) *
          sunSparkle *
          0.65 *
          uSunReflectionStrength;


        // --------------------------------------------
        // Subtil detaljvariation
        // --------------------------------------------

        float detail =
          sin(
            vWorldPosition.x * 1.7 +
            vWorldPosition.z * 1.1 +
            uTime * 1.2
          );


        color +=
          vec3(0.025, 0.035, 0.045) *
          detail;

        #ifdef USE_BACKGROUND_FADE
          vec2 backgroundUv = vClipPosition.xy / vClipPosition.w * 0.5 + 0.5;
          vec3 backgroundColor = texture2D(uBackgroundTexture, backgroundUv).rgb;
          float backgroundFade = smoothstep(uFogNear, uFogFar, length(uCameraPosition - vWorldPosition));
          color = mix(color, backgroundColor, backgroundFade);
        #endif


        // --------------------------------------------
        // Transparency
        // --------------------------------------------

        float alpha =
          uOpacity *
          mix(
            0.82,
            1.0,
            fresnel
          );


        gl_FragColor =
          vec4(
            color,
            alpha
          );
      }
    `
  });
  material.userData.addBackgroundFade = (backgroundTexture, fog) => {
    material.uniforms.uBackgroundTexture.value = backgroundTexture;
    material.uniforms.uFogNear.value = fog?.near ?? 90;
    material.uniforms.uFogFar.value = fog?.far ?? 190;
    material.defines ??= {};
    material.defines.USE_BACKGROUND_FADE = 1;
    material.needsUpdate = true;
    return material.uniforms;
  };
  return material;
}
  apply(config, terrain) {
    if (!config?.enabled || !terrain?.enabled) { this.mesh?.removeFromParent(); return; }
    if (!this.material) this.material = this.createMaterial(config);
    this.material.uniforms.uColor.value.set(config.color); this.material.uniforms.uOpacity.value = config.opacity;
    const { size, segments, heights } = terrain, width = segments + 1, step = size / segments, vertices = [], uvs = [], indices = [], cellCount = segments * segments, wet = new Uint8Array(cellCount);
    for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) { const h00 = heights[z * width + x], h10 = heights[z * width + x + 1], h01 = heights[(z + 1) * width + x], h11 = heights[(z + 1) * width + x + 1]; wet[z * segments + x] = Math.min(h00, h10, h01, h11) <= config.level ? 1 : 0; }
    // Share vertices between wet cells. Unlike a bounding rectangle this
    // follows the lake or river shoreline and never floods dry ground.
    const vertexIndices = new Map();
    const getVertex = (x, z) => {
      const key = z * width + x;
      if (vertexIndices.has(key)) return vertexIndices.get(key);
      const index = vertices.length / 3;
      vertices.push(-size / 2 + x * step, config.level, -size / 2 + z * step);
      uvs.push(x / segments, z / segments); vertexIndices.set(key, index);
      return index;
    };
    for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
      if (!wet[z * segments + x]) continue;
      const a = getVertex(x, z), b = getVertex(x + 1, z), c = getVertex(x + 1, z + 1), d = getVertex(x, z + 1);
      indices.push(a, b, c, a, c, d);
    }
    this.mesh?.removeFromParent(); this.mesh?.geometry.dispose(); this.mesh = null; if (!indices.length) return;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(geometry, this.material); this.mesh.name = "Water"; this.mesh.userData.isWater = true; this.scene.add(this.mesh);
  }
  beginChunked(config) {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.mesh = null;
    this.chunkConfig = config;
    if (!this.material) this.material = this.createMaterial(config);
    this.material.uniforms.uColor.value.set(config.color);
    this.material.uniforms.uOpacity.value = config.opacity;
    if (!this.chunkRoot) {
      this.chunkRoot = new THREE.Group();
      this.chunkRoot.name = "Streamed water chunks";
      this.scene.add(this.chunkRoot);
    }
  }
  applyChunk(chunk, terrain) {
    if (!this.chunkConfig?.enabled || !terrain?.enabled) return;
    const key = `${chunk.x},${chunk.z}`;
    this.removeChunk(chunk.x, chunk.z);
    const resolution = terrain.resolution ?? 50;
    const width = resolution + 1;
    const step = (terrain.chunkSize ?? 50) / resolution;
    const size = terrain.chunkSize ?? 50;
    const heights = chunk.terrain?.heights ?? [];
    const vertices = [], uvs = [], indices = [], wet = new Uint8Array(resolution * resolution);
    for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
      const index = z * width + x;
      wet[z * resolution + x] = Math.min(heights[index] ?? 0, heights[index + 1] ?? 0, heights[index + width] ?? 0, heights[index + width + 1] ?? 0) <= this.chunkConfig.level ? 1 : 0;
    }
    const vertexIndices = new Map();
    const getVertex = (x, z) => {
      const key = z * width + x;
      if (vertexIndices.has(key)) return vertexIndices.get(key);
      const index = vertices.length / 3;
      vertices.push(chunk.x * size + x * step, this.chunkConfig.level, chunk.z * size + z * step);
      uvs.push(x / resolution, z / resolution);
      vertexIndices.set(key, index);
      return index;
    };
    for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
      if (!wet[z * resolution + x]) continue;
      const a = getVertex(x, z), b = getVertex(x + 1, z), c = getVertex(x + 1, z + 1), d = getVertex(x, z + 1);
      indices.push(a, b, c, a, c, d);
    }
    if (!indices.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `Water ${key}`;
    mesh.userData.isWater = true;
    this.chunkRoot.add(mesh);
    this.chunkMeshes.set(key, mesh);
  }
  removeChunk(x, z) {
    const key = `${x},${z}`;
    const mesh = this.chunkMeshes.get(key);
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    this.chunkMeshes.delete(key);
  }
  clearChunks() {
    for (const mesh of this.chunkMeshes.values()) mesh.geometry.dispose();
    this.chunkMeshes.clear();
    this.chunkRoot?.clear();
  }
  update(delta, camera) { if (!this.material) return; this.material.uniforms.uTime.value += delta; if (camera) this.material.uniforms.uCameraPosition.value.copy(camera.position); }
}
