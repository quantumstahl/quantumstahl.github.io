import * as THREE from "three";

// Adapted from CatAdventure's MoveTool. It has no knowledge of the map JSON;
// the Editor is the one place that synchronizes mesh transforms back to data.
export class MoveTool {
  constructor(editor) {
    this.editor = editor;
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.dragging = false;
    this.changedDuringDrag = false;
    this.hitPoint = new THREE.Vector3();
    this.box = new THREE.Box3();
  }
  update(delta) {
    const { input, selected } = this.editor;
    if (!selected) return;
    if (input.pointer.pressed && !input.pointer.secondaryDown) {
      this.dragging = true; this.changedDuringDrag = false;
    }
    if (this.dragging && input.pointer.primaryDown && this.moveToPointer()) this.changedDuringDrag = true;
    if (input.pointer.released && this.dragging) {
      this.dragging = false;
      if (this.changedDuringDrag) this.editor.commitTransform();
    }
    this.moveWithKeyboard(delta);
  }
  moveToPointer() {
    const { input, canvas, camera, selected } = this.editor;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    const terrainHit = this.editor.mapLoader.terrain.mesh && this.raycaster.intersectObject(this.editor.mapLoader.terrain.mesh, true)[0];
    if (terrainHit) this.hitPoint.copy(terrainHit.point);
    else if (!this.raycaster.ray.intersectPlane(this.ground, this.hitPoint)) return false;
    this.box.setFromObject(selected);
    const bottomCenter = new THREE.Vector3((this.box.min.x + this.box.max.x) / 2, this.box.min.y, (this.box.min.z + this.box.max.z) / 2);
    selected.position.add(this.hitPoint.clone().sub(bottomCenter));
    this.editor.previewTransform();
    return true;
  }
  moveWithKeyboard(delta) {
    const { input, selected } = this.editor;
    const speed = delta * (input.down("shift") ? 8 : 2);
    const movement = new THREE.Vector3();
    if (input.down("arrowleft")) movement.x -= speed;
    if (input.down("arrowright")) movement.x += speed;
    if (input.down("arrowup")) movement.z -= speed;
    if (input.down("arrowdown")) movement.z += speed;
    if (input.down("r")) movement.y += speed;
    if (input.down("f")) movement.y -= speed;
    if (!movement.lengthSq()) return;
    selected.position.add(movement);
    this.editor.previewTransform();
    this.editor.commitTransform();
  }
}
