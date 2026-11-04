import { BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial, ShapeUtils, Vector2 } from "three";

// Reusable code-native 3D asset: a beveled, faceted candy heart, 68 triangles.
// Shared geometry/material, no textures, lights, or per-pickup GPU allocations.
export function createHeartAsset() {
  const outline = [[0, -.48], [.22, -.28], [.43, -.02], [.46, .19], [.34, .36], [.17, .39], [0, .23],
    [-.17, .39], [-.34, .36], [-.46, .19], [-.43, -.02], [-.22, -.28]];
  const contour = outline.map(([x, y]) => new Vector2(x, y)), vertices = [];
  const vertex = (index, scale, z) => [outline[index][0] * scale, outline[index][1] * scale, z];
  const triangle = (a, b, c) => vertices.push(...a, ...b, ...c);
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
    triangle(vertex(a, .78, .13), vertex(b, .78, .13), vertex(c, .78, .13));
    triangle(vertex(c, .78, -.13), vertex(b, .78, -.13), vertex(a, .78, -.13));
  }
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length;
    for (const side of [-1, 1]) {
      const a = vertex(i, 1, 0), b = vertex(j, 1, 0), c = vertex(j, .78, side * .13), d = vertex(i, .78, side * .13);
      if (side > 0) { triangle(a, b, c); triangle(a, c, d); }
      else { triangle(c, b, a); triangle(d, c, a); }
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = new MeshLambertMaterial({ color: 0xf44b64, flatShading: true });
  const mesh = new Mesh(geometry, material); mesh.name = "Low-poly heart";
  mesh.scale.setScalar(.55);
  return { mesh, dispose() { geometry.dispose(); material.dispose(); } };
}
