import * as THREE from "three";

// Dense near-camera grass: one generated crossed-card blade mesh, rendered as
// an InstancedMesh. The old gras.glb remains available for medium-distance
// vegetation and is deliberately not used here.
export class Grass {
  constructor(scene) {
    this.scene = scene; this.root = new THREE.Group(); this.root.name = "Near painted grass"; this.scene.add(this.root);
    // This is the near-camera layer. Keep it genuinely near: the existing
    // medium-distance vegetation covers the rest of the view much cheaper.
    this.mobileProfile = window.matchMedia?.("(pointer: coarse)").matches;
    this.radius = 42; this.fadeStart = 30; this.fadeEnd = 40; this.maxVisible = 6000;
    this.matrix = new THREE.Matrix4(); this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion(); this.scale = new THREE.Vector3(); this.lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity); this.lastCameraDirection = new THREE.Vector3(); this.cameraDirection = new THREE.Vector3(); this.viewPoint = new THREE.Vector3(); this.viewProjection = new THREE.Matrix4(); this.frustum = new THREE.Frustum(); this.hasCameraDirection = false; this.dirty = true; this.sunDirection = new THREE.Vector3(.4, .8, .2).normalize(); this.sunPosition = new THREE.Vector3(); this.sunTargetPosition = new THREE.Vector3();
    this.geometry = this.createBladeGeometry(); this.material = this.createMaterial(); this.mesh = null;
  }
createBladeGeometry() {
  const positions = [];
  const colors = [];
  const indices = [];

  // Five two-segment ribbons are enough for a dense tuft at gameplay range,
  // while cutting the per-instance triangle count from 54 to 20.
  const blades = 5;
  const segments = 2;

  const baseColor = new THREE.Color(0x245321);
  const tipColor  = new THREE.Color(0x6f9b3f);

  for (let blade = 0; blade < blades; blade++) {

    const angle = blade * 2.399963; // golden angle

    const radial =
      blade === 0
        ? 0
        : 0.04 + (blade % 4) * 0.025;

    const cx = Math.cos(angle) * radial;
    const cz = Math.sin(angle) * radial;

    const height =
       0.32 + (blade % 5) * 0.04;

    const baseWidth =
      0.010 + (blade % 3) * 0.003;

    const lean =
      0.05 + (blade % 4) * 0.012;

    const leanX = Math.cos(angle) * lean;
    const leanZ = Math.sin(angle) * lean;

    // Ribbon direction
    const rightX = Math.cos(angle + Math.PI * 0.5);
    const rightZ = Math.sin(angle + Math.PI * 0.5);

    const startIndex = positions.length / 3;

    for (let s = 0; s <= segments; s++) {

      const t = s / segments;

      // taper to a point
      const width =
        baseWidth *
        (1.0 - t * 0.92);

      // increasingly bent toward tip
      const bend =
        t * t;

      const centerX =
        cx + leanX * bend;

      const centerZ =
        cz + leanZ * bend;

      const y =
        height * t;

      const leftX =
        centerX - rightX * width;

      const leftZ =
        centerZ - rightZ * width;

      const rightPX =
        centerX + rightX * width;

      const rightPZ =
        centerZ + rightZ * width;

      positions.push(
        leftX, y, leftZ,
        rightPX, y, rightPZ
      );

      const c =
        baseColor.clone().lerp(
          tipColor,
          t
        );

      colors.push(
        c.r, c.g, c.b,
        c.r, c.g, c.b
      );
    }

    for (let s = 0; s < segments; s++) {

      const a = startIndex + s * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;

      indices.push(
        a, b, d,
        a, d, c
      );
    }
  }

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      colors,
      3
    )
  );

  geometry.setIndex(indices);

  geometry.computeVertexNormals();

  return geometry;
}
createMaterial() {
  const material = new THREE.MeshLambertMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,

  emissive: 0x102b0e,
  emissiveIntensity: 2.35
});
  material.onBeforeCompile = shader => {
    shader.uniforms.uGrassSunDirection = { value: this.sunDirection.clone() };
    shader.uniforms.uGrassTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
  .replace(
    "#include <common>",
    "#include <common>\nuniform float uGrassTime;\nvarying float vGrassBladeHeight;"
  )
  .replace(
    "#include <begin_vertex>",
    "vGrassBladeHeight = clamp( position.y / 0.6, 0.0, 1.0 );\n#include <begin_vertex>\nfloat bladePhase = position.x * 17.3 + position.z * 23.7;\nfloat windPhase = instanceMatrix[3].x * 0.73 + instanceMatrix[3].z * 0.91 + bladePhase + uGrassTime * 1.4;\nfloat gust = sin( instanceMatrix[3].x * 0.08 + instanceMatrix[3].z * 0.06 + uGrassTime * 0.45 );\nfloat windSway = ( sin( windPhase ) * 0.032 + sin( windPhase * 0.47 + uGrassTime * 0.7 ) * 0.018 );\nwindSway *= ( 0.75 + gust * 0.25 ) * vGrassBladeHeight * vGrassBladeHeight;\ntransformed.x += windSway;\ntransformed.z += windSway * 0.45;"
  );
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uGrassSunDirection;\nvarying float vGrassBladeHeight;").replace("#include <lights_fragment_begin>","\nfloat bladeHeight = vGrassBladeHeight;\ndiffuseColor.rgb *= mix( 0.65, 1.0, bladeHeight );\n#include <lights_fragment_begin>");
    material.userData.grassShader = shader;
  };
  material.customProgramCacheKey = () => "next-world-grass-sun-height-wind-v2";
  return material;
}
  async apply(config, terrain) { this.config = config; this.terrain = terrain; this.root.visible = Boolean(config?.enabled); this.dirty = true; }
  setSunDirection(sun) {
    if (!sun?.isDirectionalLight || !sun.target) return false;
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false); sun.getWorldPosition(this.sunPosition); sun.target.getWorldPosition(this.sunTargetPosition);
    const direction = this.sunPosition.sub(this.sunTargetPosition); if (direction.lengthSq() < 1e-8) return false;
    this.sunDirection.copy(direction.normalize()); return true;
  }
  paint(config, terrain, point, radius) {
    if (!config?.enabled || radius <= 0) return false;
    const count = Math.max(3, Math.round(radius * radius * config.density));
    for (let i = 0; i < count; i++) { const angle = Math.random() * Math.PI * 2, distance = Math.sqrt(Math.random()) * radius; config.points.push({ x: point.x + Math.cos(angle) * distance, z: point.z + Math.sin(angle) * distance, scale: .7 + Math.random() * .6, height: .75 + Math.random() * .35, rotation: Math.random() * Math.PI * 2 }); }
    this.config = config; this.terrain = terrain; this.dirty = true; return true;
  }
  erase(config, point, radius) {
    if (!config?.enabled || radius <= 0) return false;
    const radiusSq = radius ** 2, before = config.points.length;
    config.points = config.points.filter(blade => (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq);
    if (config.points.length === before) return false;
    this.config = config; this.dirty = true; return true;
  }
  update(delta, camera) {
    if (!this.config?.enabled || !camera) return;
    const shader = this.material.userData.grassShader;
    if (shader) { shader.uniforms.uGrassSunDirection.value.copy(this.sunDirection).transformDirection(camera.matrixWorldInverse); shader.uniforms.uGrassTime.value += delta; }
   
    camera.getWorldDirection(this.cameraDirection);
    const cameraStill = this.lastCamera.distanceToSquared(camera.position) < 1;
const viewStill = this.hasCameraDirection && this.lastCameraDirection.dot(this.cameraDirection) > 1;
    if (!this.dirty && cameraStill && viewStill) return;
    this.lastCamera.copy(camera.position); this.lastCameraDirection.copy(this.cameraDirection); this.hasCameraDirection = true; this.dirty = false;
    // InstancedMesh cannot frustum-cull individual blades itself. Cull each
    // painted point against the current camera frustum before filling it.
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    const radiusSq = this.radius ** 2, nearby = [];
    for (const blade of this.config.points) {
      if ((blade.x - camera.position.x) ** 2 + (blade.z - camera.position.z) ** 2 >= radiusSq) continue;
      const groundY = this.terrain?.getHeightAt({ x: blade.x, z: blade.z }) ?? 0;
      this.viewPoint.set(blade.x, groundY + .25, blade.z);
      if (!this.frustum.containsPoint(this.viewPoint)) continue;
      nearby.push({ blade, groundY });
      if (nearby.length >= this.maxVisible) break;
    }
    if (!this.mesh || this.mesh.instanceMatrix.count < nearby.length) { this.mesh?.removeFromParent(); this.mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(nearby.length, 1)); this.mesh.name = "Near-camera procedural grass"; this.mesh.castShadow = false; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.root.add(this.mesh); }
    this.mesh.count = nearby.length;
    for (let i = 0; i < nearby.length; i++) { const { blade, groundY } = nearby[i]; this.position.set(blade.x, groundY, blade.z); this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, blade.rotation); this.scale.set(blade.scale, blade.scale * (blade.height ?? 1), blade.scale); this.matrix.compose(this.position, this.rotation, this.scale); this.mesh.setMatrixAt(i, this.matrix); }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
