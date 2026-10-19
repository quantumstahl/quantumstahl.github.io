import * as THREE from "three";

// A single-click terrain tool for map-boundary authoring. Keeping it separate
// from the sculpt tool prevents an accidental drag from changing many chunks.
export class ChunkTool {
  constructor(editor) {
    this.editor = editor;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.busy = false;
  }
  update() {
    const { input, canvas, camera, mapLoader } = this.editor;
    if (this.busy || this.editor.activeTool !== "chunk" || !input.pointer.pressed || input.pointer.secondaryDown) return;
    const terrain = mapLoader.terrain.mesh;
    if (!terrain) return;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    const hit = this.raycaster.intersectObject(terrain, true)[0];
    if (!hit) return;
    this.busy = true;
    const action = this.editor.chunkAction === "delete"
      ? this.editor.deleteChunkAtPoint(hit.point)
      : this.editor.toggleChunkDecorativeAtPoint(hit.point);
    void action.finally(() => { this.busy = false; });
  }
}
