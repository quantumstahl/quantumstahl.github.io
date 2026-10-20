// Adapted from CatAdventure's RotateTool. Dragging deliberately rotates only
// around Y for a predictable level-editor workflow; Q/E provide fine control.
export class RotateTool {
  constructor(editor) {
    this.editor = editor;
    this.dragging = false;
    this.startRotationY = 0;
    this.startPointerX = 0;
    this.changedDuringDrag = false;
  }
  update(delta) {
    const { input, selected } = this.editor;
    if (!selected) return;
    if (input.pointer.pressed && !input.pointer.secondaryDown) {
      this.dragging = true;
      this.changedDuringDrag = false;
      this.startRotationY = selected.rotation.y;
      this.startPointerX = input.pointer.x;
    }
    if (this.dragging && input.pointer.primaryDown) {
      selected.rotation.y = this.startRotationY + (input.pointer.x - this.startPointerX) * .01;
      this.changedDuringDrag = true;
      this.editor.previewTransform();
    }
    if (input.pointer.released && this.dragging) {
      this.dragging = false;
      if (this.changedDuringDrag) this.editor.commitTransform();
    }
    const turn = delta * (input.down("shift") ? 4 : 1.2);
    if (input.down("q")) { selected.rotation.y += turn; this.editor.commitTransform(); }
    if (input.down("e")) { selected.rotation.y -= turn; this.editor.commitTransform(); }
  }
}
