import * as THREE from "three";

export class TerrainTool {
  constructor(editor) {
    this.editor = editor;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.radius = 3;
    this.flattenHeight = 0;
    this.lastGrassPoint = null;
  }
  update(delta) {
    const { input } = this.editor;
    const step = delta * (input.down("shift") ? 12 : 3);
    if (input.down("q")) this.setRadius(this.radius - step);
    if (input.down("e")) this.setRadius(this.radius + step);
    if (!input.pointer.primaryDown || input.pointer.secondaryDown) { this.lastGrassPoint = null; return; }
    const hit = this.getHit();
    if (!hit) return;
    if (this.editor.terrainMode === "paint") {
      if (this.editor.mapLoader.paintTerrain(hit.point, this.radius, this.editor.terrainPaintColor, delta * 3)) this.editor.markDirty();
      return;
    }
    if (this.editor.terrainMode === "texture") {
      if (this.editor.mapLoader.paintTerrainTexture(hit.point, this.radius, delta * 3)) this.editor.markDirty();
      return;
    }
    if (this.editor.terrainMode === "grass" || this.editor.terrainMode === "eraseGrass") {
      if (!this.lastGrassPoint || hit.point.distanceToSquared(this.lastGrassPoint) >= Math.max(.4, this.radius * .45) ** 2) {
        const changed = this.editor.terrainMode === "grass" ? this.editor.mapLoader.paintGrass(hit.point, this.radius) : this.editor.mapLoader.eraseGrass(hit.point, this.radius);
        if (changed) this.editor.markDirty();
        this.lastGrassPoint = hit.point.clone();
      }
      return;
    }
    if (input.pointer.pressed && this.editor.terrainMode === "flatten") this.flattenHeight = this.editor.mapLoader.terrain.getHeightAt(hit.point);
    const direction = this.editor.terrainMode === "lower" ? -1 : 1;
    const amount = this.editor.terrainMode === "smooth" || this.editor.terrainMode === "flatten" ? delta : direction * delta * 3;
    if (this.editor.mapLoader.sculptTerrain(hit.point, this.radius, amount, this.editor.terrainMode, this.flattenHeight)) this.editor.markDirty();
  }
  getHit() {
    const terrain = this.editor.mapLoader.terrain.mesh;
    if (!terrain) return null;
    const { input, canvas, camera } = this.editor;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.intersectObject(terrain, false)[0] ?? null;
  }
  setRadius(value) {
    this.radius = THREE.MathUtils.clamp(value, .25, 50);
    this.editor.setStatus(`Terrain ${this.editor.terrainMode} radius: ${this.radius.toFixed(1)}m`);
  }
}
