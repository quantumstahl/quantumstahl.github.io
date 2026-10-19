import * as THREE from "three";

// Click a support object (or empty editor ground) to put the selected object's
// real bounding-box bottom at that point. This is the cleaned shared version
// of CatAdventure's StackTool.
export class StackTool {
  constructor(editor) {
    this.editor = editor;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.point = new THREE.Vector3();
    this.bounds = new THREE.Box3();
  }
  update() {
    const { input, selected } = this.editor;
    if (!selected || !input.pointer.pressed || input.pointer.secondaryDown) return;
    const hit = this.getHit();
    if (!hit) return;
    this.placeOnHit(selected, hit);
    this.editor.commitTransform();
  }
  getHit() {
    const { input, canvas, camera, mapLoader, selected } = this.editor;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    const targets = mapLoader.objects.filter(object => object !== selected);
    if (mapLoader.terrain.mesh) targets.push(mapLoader.terrain.mesh);
    const objectHit = this.raycaster.intersectObjects(targets, true)[0];
    if (objectHit) return objectHit.point;
    return this.raycaster.ray.intersectPlane(this.ground, this.point) ? this.point : null;
  }
  placeOnHit(selected, point) {
    selected.updateWorldMatrix(true, true);
    this.bounds.setFromObject(selected);
    const bottomCenter = new THREE.Vector3(
      (this.bounds.min.x + this.bounds.max.x) / 2,
      this.bounds.min.y,
      (this.bounds.min.z + this.bounds.max.z) / 2
    );
    selected.position.add(point.clone().sub(bottomCenter));
    this.editor.previewTransform();
  }
}
