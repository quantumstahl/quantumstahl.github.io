import * as THREE from "three";

// Painted grass rendered in two instanced LOD tiers. A paint point represents
// a clump, not one blade: close clumps are rich and varied, while medium
// distance clumps use a small card cluster and cross-fade into the terrain.
export class Grass {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = "Procedural painted grass";
    scene.add(this.root);

    this.mobileProfile = window.matchMedia?.("(pointer: coarse)").matches;
    this.nearRadius = this.mobileProfile ? 12 : 12;
    this.midRadius = this.mobileProfile ? 92 : 92;
    this.nearMax = this.mobileProfile ? 3400 : 3400;
    this.midMax = this.mobileProfile ? 8000 : 8000;
    this.cullInterval = this.mobileProfile ? .25 : .1;
    this.cullTimer = Infinity;
    this.dirty = true;
    this.hasCameraDirection = false;
    this.lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.lastCameraDirection = new THREE.Vector3();
    this.cameraDirection = new THREE.Vector3();
    this.viewPoint = new THREE.Vector3();
    this.viewProjection = new THREE.Matrix4();
    this.frustum = new THREE.Frustum();
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
    this.sunDirection = new THREE.Vector3(.4, .8, .2).normalize();
    this.sunPosition = new THREE.Vector3();
    this.sunTargetPosition = new THREE.Vector3();
    this.grassSphere = new THREE.Sphere();
    this.nearGeometry = this.createClusterGeometry({
    blades: 90, segments: 1, spread: .29, width: .055
});
    this.midGeometry = this.createClusterGeometry({ blades: 5, segments: 1, spread: .29, width: .3 },true);
    this.nearMaterial = this.createMaterial({ fadeInStart: 0, fadeInEnd: 0, fadeOutStart: this.nearRadius-4, fadeOutEnd: this.nearRadius });
    this.midMaterial = this.createMaterial({ fadeInStart: this.nearRadius-4, fadeInEnd: this.nearRadius, fadeOutStart: this.midRadius - 6, fadeOutEnd: this.midRadius });
    this.nearMesh = null;
    this.midMesh = null;
    this.ko=0;
  }

  createClusterGeometry({ blades, segments, spread, width },back) {
    const positions = [], colors = [], indices = [];
    let baseColor = new THREE.Color(0x174b1d);

    let red="#729d3e";
    let midColor = new THREE.Color(0x0e1f0a);
    const tipColor = new THREE.Color(0x729d3e);

    if(back){midColor = new THREE.Color(0x729d3e);baseColor = new THREE.Color(0x729d3e);}

    for (let blade = 0; blade < blades; blade++) {
      const angle = blade * 2.399963 + (blade % 3) * .31;
      const radial = blade === 0 ? 0 : Math.sqrt((blade + .35) / blades) * spread;
      const cx = Math.cos(angle) * radial, cz = Math.sin(angle) * radial;
      const height = 0.64 + ((blade * 37) % 7) * .055;
      const bladeWidth = width * (.72 + ((blade * 17) % 5) * .11);
      const lean = .07 + ((blade * 11) % 6) * .018;
      const leanX = Math.cos(angle + .38) * lean, leanZ = Math.sin(angle + .38) * lean;
      const rightX = Math.cos(angle + Math.PI * .5), rightZ = Math.sin(angle + Math.PI * .5);
      const start = positions.length / 3;

      for (let segment = 0; segment <= segments; segment++) {
        const t = segment / segments;
        const bend = t * t;
        const halfWidth = bladeWidth * (1 - t * .91);
        const x = cx + leanX * bend, z = cz + leanZ * bend, y = height * t;
        positions.push(x - rightX * halfWidth, y, z - rightZ * halfWidth, x + rightX * halfWidth, y, z + rightZ * halfWidth);
        const color = baseColor.clone().lerp(midColor, Math.min(1, t * 1.5)).lerp(tipColor, Math.max(0, t * 1.45 - .45));
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      for (let segment = 0; segment < segments; segment++) {
        const a = start + segment * 2, b = a + 1, c = a + 2, d = a + 3;
        // Two-sided material makes this ribbon visible from either direction.
        indices.push(a, b, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  createMaterial(lod) {
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
    });
    material.onBeforeCompile = shader => {
      shader.uniforms.uGrassTime = { value: 0 };
      shader.uniforms.uGrassSunDirection = { value: this.sunDirection.clone() };
      shader.uniforms.uGrassCameraPosition = { value: new THREE.Vector3() };
      shader.uniforms.uGrassFadeInStart = { value: lod.fadeInStart };
      shader.uniforms.uGrassFadeInEnd = { value: lod.fadeInEnd };
      shader.uniforms.uGrassFadeOutStart = { value: lod.fadeOutStart };
      shader.uniforms.uGrassFadeOutEnd = { value: lod.fadeOutEnd };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uGrassTime;\nuniform vec3 uGrassCameraPosition;\nuniform float uGrassFadeInStart;\nuniform float uGrassFadeInEnd;\nuniform float uGrassFadeOutStart;\nuniform float uGrassFadeOutEnd;\nvarying float vGrassBladeHeight;\nvarying float vGrassFade;")
        .replace("#include <begin_vertex>", `vGrassBladeHeight = clamp(position.y / .7, 0.0, 1.0);
vec3 grassOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float grassDistance = distance(grassOrigin.xz, uGrassCameraPosition.xz);
float fadeIn = uGrassFadeInEnd <= uGrassFadeInStart ? 1.0 : smoothstep(uGrassFadeInStart, uGrassFadeInEnd, grassDistance);
float fadeOut = 1.0 - smoothstep(uGrassFadeOutStart, uGrassFadeOutEnd, grassDistance);
vGrassFade = fadeIn * fadeOut;
#include <begin_vertex>
float bladePhase = position.x * 19.7 + position.z * 27.1;
float windPhase = instanceMatrix[3].x * .67 + instanceMatrix[3].z * .81 + bladePhase + uGrassTime * 1.55;
float gust = sin(instanceMatrix[3].x * .075 + instanceMatrix[3].z * .052 + uGrassTime * .38);
float windSway = (sin(windPhase) * .036 + sin(windPhase * .51 + uGrassTime * .73) * .019);
windSway *= (.78 + gust * .22) * vGrassBladeHeight * vGrassBladeHeight;
transformed.x += windSway;
transformed.z += windSway * .56;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uGrassSunDirection;\nvarying float vGrassBladeHeight;\nvarying float vGrassFade;")
        .replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb *= mix(.62, 1.08, vGrassBladeHeight);
diffuseColor.a *= vGrassFade;
if (diffuseColor.a < .015) discard;`)
        .replace("#include <lights_fragment_begin>", `float sunAmount = max(dot(normal, normalize(uGrassSunDirection)), 0.0);
diffuseColor.rgb *= .65 + sunAmount * .35;
#include <lights_fragment_begin>`);
      material.userData.grassShader = shader;
    };
    material.customProgramCacheKey = () => `next-world-cluster-grass-${lod.fadeInStart}-${lod.fadeOutEnd}`;
    return material;
  }

  async apply(config, terrain) {
    this.config = config;
    this.terrain = terrain;
    this.root.visible = Boolean(config?.enabled);
    this.dirty = true;
  }

  setSunDirection(sun) {
    if (!sun?.isDirectionalLight || !sun.target) return false;
    sun.updateWorldMatrix(true, false);
    sun.target.updateWorldMatrix(true, false);
    sun.getWorldPosition(this.sunPosition);
    sun.target.getWorldPosition(this.sunTargetPosition);
    const direction = this.sunPosition.sub(this.sunTargetPosition);
    if (direction.lengthSq() < 1e-8) return false;
    this.sunDirection.copy(direction.normalize());
    return true;
  }

  paint(config, terrain, point, radius) {
    if (!config?.enabled || radius <= 0) return false;
    const count = Math.max(3, Math.round(radius * radius * config.density));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, distance = Math.sqrt(Math.random()) * radius;
      config.points.push({ x: point.x + Math.cos(angle) * distance, z: point.z + Math.sin(angle) * distance, scale: .72 + Math.random() * .55, height: .78 + Math.random() * .42, rotation: Math.random() * Math.PI * 2 });
    }
    this.config = config;
    this.terrain = terrain;
    this.dirty = true;
    return true;
  }

  erase(config, point, radius) {
    if (!config?.enabled || radius <= 0) return false;
    const radiusSq = radius ** 2, before = config.points.length;
    config.points = config.points.filter(clump => (clump.x - point.x) ** 2 + (clump.z - point.z) ** 2 > radiusSq);
    if (config.points.length === before) return false;
    this.config = config;
    this.dirty = true;
    return true;
  }

  updateMesh(name, geometry, material, entries, key) {
  let mesh = this[key];
  const count = entries.length;

  // Bara skapa om den inte finns eller är för liten
  if (!mesh || mesh.instanceMatrix.count < count) {
    mesh?.removeFromParent();
    mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;          // behåll om du verkligen behöver det
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // viktigt
    this.root.add(mesh);
    this[key] = mesh;
  }

  mesh.count = count;

  // Temp-objekt (återanvänd samma)
  const pos = this.position;
  const rot = this.rotation;
  const scl = this.scale;
  const mat = this.matrix;

  for (let i = 0; i < count; i++) {
    const { clump, groundY } = entries[i];

    pos.set(clump.x, groundY, clump.z);
    rot.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, clump.rotation);
    const s = clump.scale;
    scl.set(s, s * (clump.height ?? 1), s);

    mat.compose(pos, rot, scl);
    mesh.setMatrixAt(i, mat);
  }

  mesh.instanceMatrix.needsUpdate = true;
}

  update(delta, camera) {
    if(this.ko===1)return;
    if (!this.config?.enabled || !camera) return;
    for (const material of [this.nearMaterial, this.midMaterial]) {
      const shader = material.userData.grassShader;
      if (!shader) continue;
      shader.uniforms.uGrassTime.value += delta;
      shader.uniforms.uGrassCameraPosition.value.copy(camera.position);
      shader.uniforms.uGrassSunDirection.value.copy(this.sunDirection).transformDirection(camera.matrixWorldInverse);
    }

  
    camera.getWorldDirection(this.cameraDirection);
    const cameraStill = this.lastCamera.distanceToSquared(camera.position) < 1;
    const viewStill = this.hasCameraDirection && this.lastCameraDirection.dot(this.cameraDirection) > .9999999999999999999;
    //if (!this.dirty && ((cameraStill && viewStill))) return;
    this.lastCamera.copy(camera.position);
    this.lastCameraDirection.copy(this.cameraDirection);
    this.hasCameraDirection = true;

    this.dirty = false;

    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);

    
const nearCandidates = [];
const midCandidates = [];

for (const clump of this.config.points) {
    
    const dx = clump.x - camera.position.x;
    const dz = clump.z - camera.position.z;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq > this.midRadius ** 2) continue;

    const groundY =
        this.terrain?.getHeightAt({
            x: clump.x,
            z: clump.z
        }) ?? 0;

    // generous grass bounds
    const size = clump.scale ?? 1;
    const heightScale = clump.height ?? 1;

    const grassHeight = 0.7 * size * heightScale;

    this.grassSphere.center.set(
        clump.x,
        groundY + grassHeight * 0.5,
        clump.z
    );

    this.grassSphere.radius =
        Math.max(1.5, grassHeight + 0.75);

    if (!this.frustum.intersectsSphere(this.grassSphere))
        continue;

    const entry = {
        clump,
        groundY,
        distanceSq
    };

    if (distanceSq < this.nearRadius ** 2)
        nearCandidates.push(entry);

    if (distanceSq >= 13 ** 2)
        midCandidates.push(entry);
}

const byDistance = (a, b) =>
    a.distanceSq - b.distanceSq;

nearCandidates.sort(byDistance);
midCandidates.sort(byDistance);

const near =
    nearCandidates.slice(0, this.nearMax);

const mid =
    midCandidates.slice(0, this.midMax);

this.updateMesh(
    "Near dense grass clumps",
    this.nearGeometry,
    this.nearMaterial,
    near,
    "nearMesh"
);

this.updateMesh(
    "Medium grass card clumps",
    this.midGeometry,
    this.midMaterial,
    mid,
    "midMesh"
);
this.ko=0;
  }
}
