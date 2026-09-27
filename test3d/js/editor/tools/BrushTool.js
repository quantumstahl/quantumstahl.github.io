import * as THREE from "three";

// Paints circular clusters of the asset type chosen in the tree. Loading a GLB
// is asynchronous, so each brush stamp is intentionally serialized.
export class BrushTool {
  constructor(editor) {
    this.editor = editor;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.heightRaycaster = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.point = new THREE.Vector3();
    this.lastPoint = null;
    this.busy = false;
    this.radius = .65;
    this.minRadius = .2;
    this.maxRadius = 8;
  }
  enter() { this.lastPoint = null; }
  exit() { this.lastPoint = null; }
  update(delta) {
    const { input } = this.editor;
    const radiusStep = delta * (input.down("shift") ? 4 : 1);
    if (input.down("q")) this.setRadius(this.radius - radiusStep);
    if (input.down("e")) this.setRadius(this.radius + radiusStep);
    if (input.pointer.secondaryDown || !input.pointer.primaryDown) { this.lastPoint = null; return; }
    const type = this.editor.brushType ?? this.editor.selected?.userData.assetType;
    if (!type || this.busy) return;
    const point = this.getGroundPoint();
    const spacing = Math.max(.35, this.radius * .55);
    if (!point || (this.lastPoint && point.distanceToSquared(this.lastPoint) < spacing ** 2)) return;
    this.busy = true;
    this.lastPoint = point.clone();
    this.editor.placeBrushInstances(type, this.makeStampPoints(point)).catch(error => console.error("Brush placement failed", error)).finally(() => { this.busy = false; });
  }
  getGroundPoint() {
    const { input, canvas, camera } = this.editor;
    const rect = canvas.getBoundingClientRect();
    this.ndc.set(input.pointer.x / rect.width * 2 - 1, -(input.pointer.y / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    const terrain = this.editor.mapLoader.terrain.mesh;
    const hit = terrain && this.raycaster.intersectObject(terrain, false)[0];
    return hit ? hit.point.clone() : (this.raycaster.ray.intersectPlane(this.ground, this.point) ? this.point.clone() : null);
  }
  makeStampPoints(center) {
    const count = this.instanceCount();
    const points = [this.getTerrainPoint(center.x, center.z, center.y)];
    for (let index = 1; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * this.radius;
      points.push(this.getTerrainPoint(center.x + Math.cos(angle) * distance, center.z + Math.sin(angle) * distance, center.y));
    }
    return points;
  }
  getTerrainPoint(x, z, fallbackY) {
    const terrain = this.editor.mapLoader.terrain.mesh;
    if (!terrain) return new THREE.Vector3(x, fallbackY, z);
    this.heightRaycaster.set(new THREE.Vector3(x, 10000, z), this.down);
    const hit = this.heightRaycaster.intersectObject(terrain, false)[0];
    return new THREE.Vector3(x, hit?.point.y ?? fallbackY, z);
  }
  instanceCount() { return Math.max(1, Math.round(this.radius * this.radius * 1.5)); }
  setRadius(radius) {
    this.radius = THREE.MathUtils.clamp(radius, this.minRadius, this.maxRadius);
    this.editor.setStatus(`Brush radius: ${this.radius.toFixed(2)} · ${this.instanceCount()} objects per stamp`);
  }
}
