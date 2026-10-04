import * as THREE from "three";

// A single low-resolution terrain proxy. Its density is generated only from
// world-space coordinates, so patches do not move with the camera.
export class GroundMist {
  constructor(scene) {
    this.scene = scene;
    this.mistHeightOffset = 1.0;
    // Deliberately strong defaults for the first visual pass.
    this.mistOpacity = 0.45;
    this.mistNoiseScale = 0.12;
    this.mistNoiseScale2 = 0.45;
    this.mistThreshold = 0.4;
    this.mistSoftness = 0.14;
    this.mistSpeed = 1.0;
    this.baseMistColor = new THREE.Color(0xdbeaf2);
    this.mistColor = this.baseMistColor.clone();
    // Keep the mist predominantly pale; a subtle horizon tint avoids a
    // saturated orange or violet band in the distant fade.
    this.horizonTintStrength = 0.80;
    this.mistNearFadeStart = 25;
    this.mistNearFadeEnd = 35;
    this.mistSegments = 32;
    this.time = 0;
    this.mesh = null;
    this.chunkProxies = new Map();
    this.sourceGeometry = null;
    this.sourcePositionVersion = -1;
    this.material = this.createMaterial();
  }

  createMaterial() {
    const uniforms = {
      mistHeightOffset: { value: this.mistHeightOffset },
      mistOpacity: { value: this.mistOpacity },
      mistNoiseScale: { value: this.mistNoiseScale },
      mistNoiseScale2: { value: this.mistNoiseScale2 },
      mistThreshold: { value: this.mistThreshold },
      mistSoftness: { value: this.mistSoftness },
      mistSpeed: { value: this.mistSpeed },
      mistColor: { value: this.mistColor },
      mistTime: { value: 0 },
      mistCameraPosition: { value: new THREE.Vector3() },
      mistNearFadeStart: { value: this.mistNearFadeStart },
      mistNearFadeEnd: { value: this.mistNearFadeEnd },
      mistFadeStart: { value: 30 },
      mistFadeEnd: { value: 50 }
    };
    return new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      vertexShader: `
        varying vec3 vMistWorldPosition;
        uniform float mistHeightOffset;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          worldPosition.y += mistHeightOffset;
          vMistWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float mistOpacity;
        uniform float mistNoiseScale;
        uniform float mistNoiseScale2;
        uniform float mistThreshold;
        uniform float mistSoftness;
        uniform float mistSpeed;
        uniform float mistTime;
        uniform vec3 mistColor;
        uniform vec3 mistCameraPosition;
        uniform float mistNearFadeStart;
        uniform float mistNearFadeEnd;
        uniform float mistFadeStart;
        uniform float mistFadeEnd;
        varying vec3 vMistWorldPosition;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 cell = floor(p), local = fract(p);
          local = local * local * (3.0 - 2.0 * local);
          return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
                     mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x), local.y);
        }
        void main() {
          vec2 drift = vec2(mistTime * mistSpeed, mistTime * mistSpeed * 0.61);
          vec2 worldXZ = vMistWorldPosition.xz + drift;
          float n1 = noise(worldXZ * mistNoiseScale);
          float n2 = noise(worldXZ * mistNoiseScale2 + 19.7);
          float density = n1 * 0.7 + n2 * 0.3;
          float alpha = smoothstep(mistThreshold - mistSoftness, mistThreshold + mistSoftness, density);
          float cameraDistance = distance(vMistWorldPosition.xz, mistCameraPosition.xz);
          float nearFade = smoothstep(mistNearFadeStart, mistNearFadeEnd, cameraDistance);
          float farFade = 1.0 - smoothstep(mistFadeStart, mistFadeEnd, cameraDistance);
          gl_FragColor = vec4(mistColor, alpha * mistOpacity * nearFade * farFade);
        }
      `
    });
  }

  apply(terrainMesh) {
    this.clearChunkProxies();
    if (!terrainMesh) {
      this.mesh?.removeFromParent();
      return;
    }
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(this.createProxyGeometry(terrainMesh.geometry), this.material);
      this.mesh.name = "GroundMist";
      this.mesh.renderOrder = 1;
      this.mesh.frustumCulled = terrainMesh.frustumCulled;
      this.scene.add(this.mesh);
    } else {
      if (!this.mesh.parent) this.scene.add(this.mesh);
    }
    this.updateProxyGeometry(terrainMesh.geometry);
  }

  applyChunks(terrainMeshes = []) {
    this.mesh?.removeFromParent();
    const wanted = new Set();
    for (const terrainMesh of terrainMeshes) {
      const chunk = terrainMesh.userData.chunk;
      if (!chunk) continue;
      const key = `${chunk.x},${chunk.z}`;
      wanted.add(key);
      let record = this.chunkProxies.get(key);
      if (!record) {
        const state = { sourceGeometry: null, sourcePositionVersion: -1 };
        const mesh = new THREE.Mesh(this.createProxyGeometry(terrainMesh.geometry, state), this.material);
        mesh.name = `GroundMist ${key}`;
        mesh.renderOrder = 1;
        mesh.frustumCulled = terrainMesh.frustumCulled;
        this.scene.add(mesh);
        record = { mesh, state };
        this.chunkProxies.set(key, record);
      }
      record.mesh.position.copy(terrainMesh.position);
      this.updateProxyGeometry(terrainMesh.geometry, record.mesh.geometry, record.state);
      if (!record.mesh.parent) this.scene.add(record.mesh);
    }
    for (const [key, record] of this.chunkProxies) {
      if (wanted.has(key)) continue;
      record.mesh.removeFromParent();
      record.mesh.geometry.dispose();
      this.chunkProxies.delete(key);
    }
  }

  clearChunkProxies() {
    for (const record of this.chunkProxies.values()) {
      record.mesh.removeFromParent();
      record.mesh.geometry.dispose();
    }
    this.chunkProxies.clear();
  }

  // Preserve the pale mist, with enough of the active horizon palette to tie
  // it to the sky without making it a copy of the fog or sky colour. Horizon
  // colours are selected here instead of accepting EnvironmentSystem's
  // composite horizonColor, so dawn and dusk remain distinct mist phases.
  setHorizonColors({ nightHorizonColor, dayHorizonColor, dawnHorizonColor, duskHorizonColor }, timeOfDay) {
    if (!nightHorizonColor || !dayHorizonColor || !dawnHorizonColor || !duskHorizonColor) return;

    const time = THREE.MathUtils.euclideanModulo(timeOfDay, 1);
    const horizonColor = new THREE.Color();
    if (time < 0.18) {
      // Keep mist cool through most of the night, then begin a short,
      // gradual dawn transition as the sun approaches the horizon.
      horizonColor.copy(nightHorizonColor);
    } else if (time < 0.25) {
      horizonColor.lerpColors(
        nightHorizonColor,
        dawnHorizonColor,
        THREE.MathUtils.smoothstep(time, 0.18, 0.25)
      );
    } else if (time < 0.4) {
      horizonColor.lerpColors(
        dawnHorizonColor,
        dayHorizonColor,
        THREE.MathUtils.smoothstep(time, 0.25, 0.4)
      );
    } else if (time < 0.68) {
      horizonColor.copy(dayHorizonColor);
    } else if (time < 0.75) {
      horizonColor.lerpColors(
        dayHorizonColor,
        duskHorizonColor,
        THREE.MathUtils.smoothstep(time, 0.68, 0.75)
      );
    } else if (time < 0.85) {
      horizonColor.lerpColors(
        duskHorizonColor,
        nightHorizonColor,
        THREE.MathUtils.smoothstep(time, 0.75, 0.85)
      );
    } else {
      horizonColor.copy(nightHorizonColor);
    }
    this.mistColor.lerpColors(this.baseMistColor, horizonColor, this.horizonTintStrength);
  }

  createProxyGeometry(sourceGeometry, state = this) {
    const geometry = new THREE.PlaneGeometry(1, 1, this.mistSegments, this.mistSegments);
    geometry.rotateX(-Math.PI / 2);
    state.sourceGeometry = null;
    state.sourcePositionVersion = -1;
    this.updateProxyGeometry(sourceGeometry, geometry, state);
    return geometry;
  }

  updateProxyGeometry(sourceGeometry, proxyGeometry = this.mesh?.geometry, state = this) {
    const source = sourceGeometry?.getAttribute("position");
    const target = proxyGeometry?.getAttribute("position");
    if (!source || !target) return;
    const sourceSegments = Math.round(Math.sqrt(source.count)) - 1;
    if (sourceSegments < 1 || source.count !== (sourceSegments + 1) ** 2) return;
    if (state.sourceGeometry === sourceGeometry && state.sourcePositionVersion === source.version) return;

    const proxySegments = this.mistSegments;
    for (let z = 0; z <= proxySegments; z++) {
      const sourceZ = z / proxySegments * sourceSegments;
      const z0 = Math.floor(sourceZ), z1 = Math.min(sourceSegments, z0 + 1), tz = sourceZ - z0;
      for (let x = 0; x <= proxySegments; x++) {
        const sourceX = x / proxySegments * sourceSegments;
        const x0 = Math.floor(sourceX), x1 = Math.min(sourceSegments, x0 + 1), tx = sourceX - x0;
        const sample = component => {
          const a = source.getComponent(z0 * (sourceSegments + 1) + x0, component);
          const b = source.getComponent(z0 * (sourceSegments + 1) + x1, component);
          const c = source.getComponent(z1 * (sourceSegments + 1) + x0, component);
          const d = source.getComponent(z1 * (sourceSegments + 1) + x1, component);
          return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), tz);
        };
        target.setXYZ(z * (proxySegments + 1) + x, sample(0), sample(1), sample(2));
      }
    }
    target.needsUpdate = true;
    proxyGeometry.computeBoundingSphere();
    state.sourceGeometry = sourceGeometry;
    state.sourcePositionVersion = source.version;
  }

  update(delta, camera) {
    this.time += delta;
    const uniforms = this.material.uniforms;
    uniforms.mistHeightOffset.value = this.mistHeightOffset;
    uniforms.mistOpacity.value = this.mistOpacity;
    uniforms.mistNoiseScale.value = this.mistNoiseScale;
    uniforms.mistNoiseScale2.value = this.mistNoiseScale2;
    uniforms.mistThreshold.value = this.mistThreshold;
    uniforms.mistSoftness.value = this.mistSoftness;
    uniforms.mistSpeed.value = this.mistSpeed;
    uniforms.mistColor.value = this.mistColor;
    uniforms.mistTime.value = this.time;
    if (camera) uniforms.mistCameraPosition.value.copy(camera.position);
    uniforms.mistNearFadeStart.value = this.mistNearFadeStart;
    uniforms.mistNearFadeEnd.value = this.mistNearFadeEnd;
    // Fade out before scene fog begins, without changing the fog itself.
    const fogFar = this.scene.fog?.far ?? 70;
    const fogNear = this.scene.fog?.near ?? 70;
    uniforms.mistFadeEnd.value = fogFar-10;
    uniforms.mistFadeStart.value = Math.max(0, fogNear-20);
  }
}
