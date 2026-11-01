import * as THREE from "three";

// Only created with ?cameraDebug. Green target = auto-follow, cyan = manual/idle.
export class CameraDebug {
  constructor(scene, controller) {
    this.controller = controller;
    this.root = new THREE.Group(); this.root.name = "Camera debug"; scene.add(this.root);
    this.target = this.marker(.07, 0x00ffff);
    this.desired = this.marker(.09, 0xffcc00);
    this.actual = this.marker(.06, 0x4488ff);
    this.hit = this.marker(.07, 0xff3355);
    this.nearCorners = Array.from({ length: 4 }, () => new THREE.Vector3());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(36), 3));
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: false }));
    this.lines.frustumCulled = false; this.root.add(this.lines);
  }
  marker(radius, color, wireframe = false) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8),
      new THREE.MeshBasicMaterial({ color, wireframe, depthTest: false, transparent: true, opacity: .7 }));
    this.root.add(mesh); return mesh;
  }
  update() {
    const c = this.controller;
    this.target.position.copy(c.target); this.target.material.color.setHex(c.autoFollowing ? 0x44ff66 : 0x00ffff);
    this.desired.position.copy(c.desired); this.actual.position.copy(c.camera.position);
    this.hit.visible = c.collision.hit; this.hit.position.copy(c.collision.hitPoint);
    const a = this.lines.geometry.attributes.position;
    c.pivot.toArray(a.array, 0); c.desired.toArray(a.array, 3);
    c.pivot.toArray(a.array, 6); c.camera.position.toArray(a.array, 9);
    this.updateNearPlane();
    for (let i = 0; i < 4; i++) {
      this.nearCorners[i].toArray(a.array, 12 + i * 6);
      this.nearCorners[(i + 1) % 4].toArray(a.array, 15 + i * 6);
    }
    a.needsUpdate = true;
  }
  updateNearPlane() {
    const camera = this.controller.camera; camera.updateMatrixWorld();
    for (let i = 0; i < 4; i++) this.nearCorners[i].set(i === 0 || i === 3 ? -1 : 1, i < 2 ? -1 : 1, -1).unproject(camera);
  }
  snapshot() {
    const c = this.controller; this.updateNearPlane();
    return { target: c.target.toArray(), pivot: c.pivot.toArray(), desired: c.desired.toArray(), actual: c.camera.position.toArray(),
      nearPlane: this.nearCorners.map(corner => corner.toArray()), distance: c.distance, collisionEnabled: c.settings.collisionEnabled,
      limited: c.collisionLimited, hit: c.collision.hit, ...c.collision.stats };
  }
  dispose() {
    this.root.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); }); this.root.removeFromParent();
  }
}
