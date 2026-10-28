import { Box3, Vector3 } from "three";
import { SpatialIndex } from "./SpatialIndex.js";

export const boxBounds = (box, target = {}) => {
  target.minX = box.min.x; target.minY = box.min.y; target.minZ = box.min.z;
  target.maxX = box.max.x; target.maxY = box.max.y; target.maxZ = box.max.z; return target;
};
export class StaticColliders {
  constructor() {
    this.index = new SpatialIndex(); this.localBox = new Box3(); this.localBounds = {};
    this.a = new Vector3(); this.b = new Vector3(); this.c = new Vector3();
    this.visitEntry = this.testEntry.bind(this); this.visitTriangle = this.testTriangle.bind(this);
    this.stats = { builds: 0, instances: 0, candidates: 0, triangles: 0 };
  }
  set(id, mesh, matrix, object) {
    const b = mesh.bounds;
    const box = new Box3(new Vector3(b.minX, b.minY, b.minZ), new Vector3(b.maxX, b.maxY, b.maxZ)).applyMatrix4(matrix);
    const determinant = matrix.determinant(); if (Math.abs(determinant) < 1e-12) throw new Error("Singular collider transform.");
    const entry = { mesh, matrix: matrix.clone(), inverse: matrix.clone().invert(), mirrored: determinant < 0, object, bounds: boxBounds(box) };
    this.index.set(id, entry); this.stats.instances = this.index.entries.size; return entry;
  }
  delete(id) { this.index.delete(id); this.stats.instances = this.index.entries.size; }
  query(bounds, visit) {
    this.visitor = visit; this.queryBounds = bounds; this.stats.triangles = 0;
    this.index.query(bounds, this.visitEntry); this.stats.candidates = this.index.candidates;
  }
  testEntry(entry) {
    if (!entry.mesh) return;
    this.active = entry;
    const b = this.queryBounds;
    // Intersect first: placement rays may use infinite Y, and multiplying
    // infinite Box3 corners by a matrix would produce NaNs (0 * Infinity).
    this.localBox.min.set(Math.max(b.minX, entry.bounds.minX), Math.max(b.minY, entry.bounds.minY), Math.max(b.minZ, entry.bounds.minZ));
    this.localBox.max.set(Math.min(b.maxX, entry.bounds.maxX), Math.min(b.maxY, entry.bounds.maxY), Math.min(b.maxZ, entry.bounds.maxZ));
    this.localBox.applyMatrix4(entry.inverse); boxBounds(this.localBox, this.localBounds);
    entry.mesh.query(this.localBounds, this.visitTriangle);
  }
  testTriangle(a, b, c, id) {
    const entry = this.active;
    this.a.copy(a).applyMatrix4(entry.matrix); this.b.copy(entry.mirrored ? c : b).applyMatrix4(entry.matrix); this.c.copy(entry.mirrored ? b : c).applyMatrix4(entry.matrix);
    // Static surfaces are solid from both sides. Present walkable faces upward
    // to the existing ground probe; separation still uses the occupied side.
    // A character below a bridge gets a downward separation normal, never a
    // support normal, even when its underside uses reversed authored winding.
    const ny = (this.b.z - this.a.z) * (this.c.x - this.a.x) - (this.b.x - this.a.x) * (this.c.z - this.a.z);
    if (ny < 0) { const x = this.b.x, y = this.b.y, z = this.b.z; this.b.copy(this.c); this.c.set(x, y, z); }
    this.stats.triangles++; this.visitor(this.a, this.b, this.c, entry.object, id);
  }
  dispose() { this.index.clear(); }
}
