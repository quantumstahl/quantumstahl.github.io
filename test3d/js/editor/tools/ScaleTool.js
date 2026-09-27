import * as THREE from "three";

// Uniform scale keeps imported GLBs proportional and works naturally with the
// centered pivot wrapper used by MapLoader.
export class ScaleTool {
  constructor(editor) {
    this.editor = editor;
    this.dragging = false;
    this.startScale = 1;
    this.startPointerY = 0;
    this.changedDuringDrag = false;
    this.minScale = .05;
    this.maxScale = 100;
    this.bounds = new THREE.Box3();
  }
  update(delta) {
    const { input, selected } = this.editor;
    if (!selected) return;
    if (input.pointer.pressed && !input.pointer.secondaryDown) {
      this.dragging = true;
      this.changedDuringDrag = false;
      this.startScale = selected.scale.x || 1;
      this.startPointerY = input.pointer.y;
    }
    if (this.dragging && input.pointer.primaryDown) {
      // Up grows, down shrinks. Multiplication makes it feel consistent at
      // small and large scales.
      const scale = this.clamp(this.startScale * (1 - (input.pointer.y - this.startPointerY) * .01));
      this.setUniformScale(scale); this.changedDuringDrag = true;
    }
    if (input.pointer.released && this.dragging) {
      this.dragging = false;
      if (this.changedDuringDrag) this.editor.commitTransform();
    }
    const amount = delta * (input.down("shift") ? 2 : .5);
    if (input.down("q")) { this.setUniformScale(selected.scale.x - amount); this.editor.commitTransform(); }
    if (input.down("e")) { this.setUniformScale(selected.scale.x + amount); this.editor.commitTransform(); }
    if (input.down("r")) { this.setUniformScale(1); this.editor.commitTransform(); }
  }
  setUniformScale(value) {
    const selected = this.editor.selected;
    // Scaling happens around the asset's centre pivot. Preserve the bottom of
    // its actual geometry so a prop stays on its floor/platform instead of
    // rising when it grows or sinking when it shrinks.
    selected.updateWorldMatrix(true, true);
    this.bounds.setFromObject(selected);
    const bottomY = this.bounds.min.y;
    selected.scale.setScalar(this.clamp(value));
    selected.updateWorldMatrix(true, true);
    this.bounds.setFromObject(selected);
    selected.position.y += bottomY - this.bounds.min.y;
    this.editor.previewTransform();
  }
  clamp(value) { return THREE.MathUtils.clamp(value, this.minScale, this.maxScale); }
}
