import * as THREE from "three";

// NextWorld/Grass.js profiles and LCG, including its shader profile deformations.
// Each instance submits at most 54 blades, rather than processing all 171
// blades and discarding four complete profiles in the vertex shader.
export const GRASS_PROFILES = Object.freeze([
  { blades: 26, radius: .45, height: [2.1, 4.05], width: [.105, .24], lean: [.06, .26], sx: .95, sy: 1, bend: 0 },
  { blades: 46, radius: .75, height: [1.14, 2.64], width: [.15, .375], lean: [.08, .36], sx: 1.35, sy: .72, bend: .05 },
  { blades: 15, radius: .39, height: [1.875, 3.225], width: [.06, .15], lean: [.02, .18], sx: .76, sy: 1.45, bend: .18 },
  { blades: 30, radius: 1.02, height: [1.8, 2.28], width: [.09, .285], lean: [.22, .62], sx: 1.08, sy: 1.02, bend: .42 },
  { blades: 54, radius: .57, height: [1.65, 3.36], width: [.042, .126], lean: [.03, .20], sx: .58, sy: 1.2, bend: -.12 },
]);
export function createGrassGeometries() {
  const near = new THREE.BufferGeometry();
  let seed = 0x9e3779b9;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const between = ([a, b]) => a + random() * (b - a);
  GRASS_PROFILES.forEach((p, type) => {
    const vertices = new Float32Array(54 * 9);
    for (let blade = 0; blade < p.blades; blade++) {
      const angle = random() * Math.PI * 2, radial = blade === 0 ? 0 : Math.sqrt(random()) * p.radius;
      const cx = Math.cos(angle) * radial, cz = Math.sin(angle) * radial;
      const height = between(p.height), width = between(p.width);
      const leanAngle = angle + (random() - .5) * 1.8, lean = between(p.lean);
      const rx = Math.cos(angle + Math.PI / 2), rz = Math.sin(angle + Math.PI / 2);
      const tip = Math.min(1, height / 1.9), bend = p.bend * tip * tip;
      vertices.set([
        (cx - rx * width) * p.sx, 0, (cz - rz * width) * p.sx,
        (cx + rx * width) * p.sx, 0, (cz + rz * width) * p.sx,
        (cx + Math.cos(leanAngle) * lean) * p.sx + .22 * bend, height * p.sy,
        (cz + Math.sin(leanAngle) * lean) * p.sx + .08 * bend,
      ], blade * 9);
    }
    near.setAttribute(type === 0 ? "position" : `shape${type}`, new THREE.BufferAttribute(vertices, 3));
  });
  // A broad tapered blade with asymmetric shoulders and a bent tip: 3 tris.
  const far = new THREE.BufferGeometry();
  far.setAttribute("position", new THREE.Float32BufferAttribute([-.36,0,0, .36,0,0, .27,1.45,0, .09,2.9,0, -.22,1.8,0], 3));
  far.setIndex([0,1,2, 0,2,4, 4,2,3]);
  return { near, far };
}
