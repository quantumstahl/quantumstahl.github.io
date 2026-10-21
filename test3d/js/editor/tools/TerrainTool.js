import * as THREE from "three";

export class TerrainTool {
  constructor(editor) {
    this.editor = editor;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.radius = 3;
    this.flattenHeight = 0;
    this.lastGrassPoint = null;
    this.rockStamp = null;
  }
  update(delta) {
    const { input } = this.editor;
    if (this.editor.terrainMode === "rockify") {
      const inward = input.down("shift");
      const button = document.querySelector("#terrainRockifyButton");
      if (button) {
        button.textContent = inward ? "Rockify In" : "Rockify Out";
        button.title = inward
          ? "Rockify In: carve into the rock face. Release Shift for Rockify Out."
          : "Rockify Out: extrude along the rock face. Hold Shift for Rockify In.";
      }
    }
    const step = delta * (input.down("shift") ? 12 : 3);
    if (input.down("q")) this.setRadius(this.radius - step);
    if (input.down("e")) this.setRadius(this.radius + step);
    if (!input.pointer.primaryDown || input.pointer.secondaryDown) { this.lastGrassPoint = null; this.rockStamp = null; return; }
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
      // Closer dabs make a dragged stroke continuous. Incremental grass-cell
      // updates keep this responsive even on maps with many painted chunks.
      if (!this.lastGrassPoint || hit.point.distanceToSquared(this.lastGrassPoint) >= Math.max(.25, this.radius * .22) ** 2) {
        const changed = this.editor.terrainMode === "grass" ? this.editor.mapLoader.paintGrass(hit.point, this.radius) : this.editor.mapLoader.eraseGrass(hit.point, this.radius);
        if (changed) this.editor.markDirty();
        this.lastGrassPoint = hit.point.clone();
      }
      return;
    }
    if (input.pointer.pressed && this.editor.terrainMode === "flatten") this.flattenHeight = this.editor.mapLoader.terrain.getHeightAt(hit.point);
    if (this.editor.terrainMode === "rockify" && (!this.rockStamp || input.pointer.pressed)) {
      const normal = hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
      const up = Math.abs(normal.y) > 0.95
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);

      const tangent = new THREE.Vector3()
          .crossVectors(up, normal)
          .normalize();

      const bitangent = new THREE.Vector3()
          .crossVectors(normal, tangent)
          .normalize();

      this.rockStamp = {
          center: hit.point.clone(),
          normal,
          tangent,
          bitangent
      };
    }
    // Rockify follows the surface normal. Its default is out of the rock
    // face; Shift turns the same stroke into an inward hollowing stroke.
    const direction = this.editor.terrainMode === "lower" ||
      (this.editor.terrainMode === "rockify" && input.down("shift")) ? -1 : 1;
    const amount = this.editor.terrainMode === "smooth" || this.editor.terrainMode === "flatten" ? delta : direction * delta * 3;
    const rockStamp = this.editor.terrainMode === "rockify" ? this.rockStamp : null;
    const sculptPoint = rockStamp?.center ?? hit.point;
    if (this.editor.mapLoader.sculptTerrain(sculptPoint, this.radius, amount, this.editor.terrainMode, this.flattenHeight, rockStamp)) this.editor.markDirty();
  }
  getHit() {
    const terrain = this.editor.mapLoader.terrain.mesh;
    if (!terrain) return null;
    const { input, canvas, camera } = this.editor;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.intersectObject(terrain, true)[0] ?? null;
  }
  setRadius(value) {
    this.radius = THREE.MathUtils.clamp(value, .25, 50);
    this.editor.setStatus(`Terrain ${this.editor.terrainMode} radius: ${this.radius.toFixed(1)}m`);
  }
}
