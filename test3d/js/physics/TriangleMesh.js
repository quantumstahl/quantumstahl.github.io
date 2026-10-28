import { Vector3 } from "three";
import { overlaps } from "./SpatialIndex.js";

// Immutable triangle soup + median BVH, shared by all instances of an asset.
export class TriangleMesh {
  constructor(vertices) {
    this.vertices = vertices instanceof Float64Array ? vertices : new Float64Array(vertices);
    if (this.vertices.length % 9 || this.vertices.some(n => !Number.isFinite(n))) throw new Error("Invalid collision triangles.");
    const count = this.vertices.length / 9;
    this.order = Uint32Array.from({ length: count }, (_, i) => i); this.triangleBounds = new Float64Array(count * 6);
    this.nodes = []; this.tests = 0;
    this.a = new Vector3(); this.b = new Vector3(); this.c = new Vector3();
    for (let i = 0; i < count; i++) {
      const p = i * 9, b = i * 6, v = this.vertices, bounds = this.triangleBounds;
      bounds[b] = Math.min(v[p], v[p + 3], v[p + 6]); bounds[b + 3] = Math.max(v[p], v[p + 3], v[p + 6]);
      bounds[b + 1] = Math.min(v[p + 1], v[p + 4], v[p + 7]); bounds[b + 4] = Math.max(v[p + 1], v[p + 4], v[p + 7]);
      bounds[b + 2] = Math.min(v[p + 2], v[p + 5], v[p + 8]); bounds[b + 5] = Math.max(v[p + 2], v[p + 5], v[p + 8]);
    }
    this.build(0, count); this.bounds = this.nodes[0]; this.stack = new Int32Array(this.nodes.length);
  }
  build(start, count) {
    const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, start, count, left: -1, right: -1 };
    const id = this.nodes.length; this.nodes.push(bounds);
    for (let i = start; i < start + count; i++) {
      const b = this.order[i] * 6, values = this.triangleBounds;
      bounds.minX = Math.min(bounds.minX, values[b]); bounds.minY = Math.min(bounds.minY, values[b + 1]); bounds.minZ = Math.min(bounds.minZ, values[b + 2]);
      bounds.maxX = Math.max(bounds.maxX, values[b + 3]); bounds.maxY = Math.max(bounds.maxY, values[b + 4]); bounds.maxZ = Math.max(bounds.maxZ, values[b + 5]);
    }
    if (count > 8) {
      const x = bounds.maxX - bounds.minX, y = bounds.maxY - bounds.minY, z = bounds.maxZ - bounds.minZ;
      const axis = x >= y && x >= z ? 0 : y >= z ? 1 : 2, values = this.triangleBounds;
      this.order.subarray(start, start + count).sort((a, b) => values[a * 6 + axis] + values[a * 6 + axis + 3] - values[b * 6 + axis] - values[b * 6 + axis + 3] || a - b);
      const half = count >> 1;
      bounds.left = this.build(start, half); bounds.right = this.build(start + half, count - half); bounds.count = 0;
    }
    return id;
  }
  query(bounds, visit) {
    let size = 1; this.stack[0] = 0; this.tests = 0;
    while (size) {
      const node = this.nodes[this.stack[--size]];
      if (!overlaps(node, bounds)) continue;
      if (!node.count) { if (node.left >= 0) { this.stack[size++] = node.right; this.stack[size++] = node.left; } continue; }
      for (let i = node.start; i < node.start + node.count; i++) {
        const id = this.order[i], b = id * 6, values = this.triangleBounds;
        if (values[b] > bounds.maxX || values[b + 3] < bounds.minX || values[b + 1] > bounds.maxY || values[b + 4] < bounds.minY || values[b + 2] > bounds.maxZ || values[b + 5] < bounds.minZ) continue;
        this.tests++; const p = id * 9;
        this.a.fromArray(this.vertices, p); this.b.fromArray(this.vertices, p + 3); this.c.fromArray(this.vertices, p + 6);
        visit(this.a, this.b, this.c, id);
      }
    }
  }
  static fromGeometry(geometry, matrix = null) {
    const p = geometry.attributes.position, index = geometry.index, count = index?.count ?? p.count;
    const vertices = new Float64Array(Math.floor(count / 3) * 9), point = new Vector3();
    const mirrored = matrix && matrix.determinant() < 0;
    for (let i = 0; i < vertices.length / 3; i++) {
      const corner = i % 3, source = mirrored && corner ? i + (corner === 1 ? 1 : -1) : i;
      point.fromBufferAttribute(p, index ? index.getX(source) : source); if (matrix) point.applyMatrix4(matrix); point.toArray(vertices, i * 3);
    }
    return new TriangleMesh(vertices);
  }
}
