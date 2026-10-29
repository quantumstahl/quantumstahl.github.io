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
    this.radius = this.marker(1, 0x4488ff, true);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
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
    this.radius.position.copy(c.camera.position); this.radius.scale.setScalar(c.collisionRadius + c.settings.surfaceMargin);
    this.hit.visible = c.collision.hit; this.hit.position.copy(c.collision.hitPoint);
    const a = this.lines.geometry.attributes.position;
    c.pivot.toArray(a.array, 0); c.desired.toArray(a.array, 3);
    c.pivot.toArray(a.array, 6); c.camera.position.toArray(a.array, 9); a.needsUpdate = true;
  }
  dispose() {
    this.root.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); }); this.root.removeFromParent();
  }
}
