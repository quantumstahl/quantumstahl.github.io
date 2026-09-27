import * as THREE from "three";

// Soft contact shadows for asset types that should avoid costly shadow-map
// rendering. All fake shadows share one alpha texture and one InstancedMesh.
export class FakeShadows {
  constructor(scene) {
    this.scene = scene; this.root = new THREE.Group(); this.root.name = "Fake contact shadows";
    this.geometry = new THREE.PlaneGeometry(1, 1); this.material = this.createMaterial(); this.mesh = null; this.entries = [];
    this.bounds = new THREE.Box3(); this.center = new THREE.Vector3(); this.objectPosition = new THREE.Vector3(); this.objectQuaternion = new THREE.Quaternion(); this.localCenter = new THREE.Vector3(); this.dummy = new THREE.Object3D(); this.yawQuaternion = new THREE.Quaternion(); this.yAxis = new THREE.Vector3(0, 1, 0); this.planeRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  }
  createMaterial() {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d"), gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.72)"); gradient.addColorStop(.55, "rgba(255,255,255,0.32)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    const alphaMap = new THREE.CanvasTexture(canvas); alphaMap.colorSpace = THREE.NoColorSpace;
    // Keep normal depth testing so the caster (and other objects) can cover
    // the shadow. The small vertical/polygon offset keeps it above terrain
    // without z-fighting.
    return new THREE.MeshBasicMaterial({ color: 0x1d160e, alphaMap, transparent: true, opacity: .42, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -150, polygonOffsetUnits: -150, side: THREE.DoubleSide });
  }
  rebuild(objects, terrain) {
    this.root.clear(); this.mesh = null;
    const entries = [];
    for (const object of objects) {
      if (object.userData.assetType?.render?.shadowMode !== "fake") continue;
      object.updateWorldMatrix(true, true); this.bounds.setFromObject(object);
      if (this.bounds.isEmpty()) continue;
      this.bounds.getCenter(this.center); object.getWorldPosition(this.objectPosition); object.getWorldQuaternion(this.objectQuaternion);
      this.localCenter.copy(this.center).sub(this.objectPosition).applyQuaternion(this.objectQuaternion.clone().invert());
      entries.push({ object, localCenter: this.localCenter.clone(), width: Math.max(.35, this.bounds.max.x - this.bounds.min.x + .16), depth: Math.max(.35, this.bounds.max.z - this.bounds.min.z + .16) });
    }
    this.entries = entries;
    if (!entries.length) { this.root.removeFromParent(); return; }
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, entries.length); this.mesh.name = "Instanced fake contact shadows"; this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.frustumCulled = false; this.mesh.renderOrder = -1;
    entries.forEach((entry, index) => this.setMatrix(index, entry, terrain, 0));
    this.mesh.instanceMatrix.needsUpdate = true; this.root.add(this.mesh); this.scene.add(this.root);
  }
  setMatrix(index, entry, terrain, delta = 0) {
    entry.object.updateWorldMatrix(true, true); entry.object.getWorldPosition(this.objectPosition); entry.object.getWorldQuaternion(this.objectQuaternion);
    this.center.copy(entry.localCenter).applyQuaternion(this.objectQuaternion).add(this.objectPosition);
    const yaw = Math.atan2(2 * (this.objectQuaternion.w * this.objectQuaternion.y + this.objectQuaternion.x * this.objectQuaternion.z), 1 - 2 * (this.objectQuaternion.y * this.objectQuaternion.y + this.objectQuaternion.z * this.objectQuaternion.z));
    this.yawQuaternion.setFromAxisAngle(this.yAxis, yaw);
    const terrainHeight = terrain.getHeightAt(this.center) + .018;
    // Moving objects cross discrete terrain-height samples. Smooth the fake
    // shadow's vertical contact point to avoid a visible snapping shadow.
    entry.shadowHeight = Number.isFinite(entry.shadowHeight)
      ? THREE.MathUtils.lerp(entry.shadowHeight, terrainHeight, 1 - Math.exp(-14 * delta))
      : terrainHeight;
    this.dummy.position.set(this.center.x, entry.shadowHeight, this.center.z); this.dummy.quaternion.copy(this.yawQuaternion).multiply(this.planeRotation); this.dummy.scale.set(entry.width, entry.depth, 1); this.dummy.updateMatrix(); this.mesh.setMatrixAt(index, this.dummy.matrix);
  }
  update(terrain, delta) { if (!this.mesh) return; this.entries.forEach((entry, index) => this.setMatrix(index, entry, terrain, delta)); this.mesh.instanceMatrix.needsUpdate = true; }
  clear() { this.root.removeFromParent(); this.root.clear(); this.mesh = null; this.entries = []; }
}
