import * as THREE from "three";

export class SelectTool {
  constructor(editor) { this.editor = editor; this.raycaster = new THREE.Raycaster(); this.ndc = new THREE.Vector2(); }
  update() {
    const { input, canvas, camera, mapLoader } = this.editor;
    if (this.editor.activeTool !== "select") return;
    if (!input.pointer.pressed || input.pointer.secondaryDown) return;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    const hit = this.raycaster.intersectObjects(mapLoader.objects, true)[0];
    this.editor.setSelected(hit ? this.findRoot(hit.object) : null);
  }
  findRoot(object) { while (object.parent && !object.userData.mapObject) object = object.parent; return object.userData.mapObject ? object : null; }
}
