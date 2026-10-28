import { GrassMaterialSampler } from "./GrassMaterialSampler.js";
const STRIDE = 8;
// Zero is an exclusion rule, including blended paint. Ignore only the faintest
// brush fringe; fade out over 0–5% paint to avoid a hard bare strip at its edge.
const EXCLUSION_PAINT_WEIGHT = .05;
// A resumable 2m source grid. Geometry, material weights and Rockify exposure
// are sampled only during cell construction/invalidation, never during culling.
export class GrassSurface {
  constructor(provider, materials, size, materialSampler = new GrassMaterialSampler(materials)) {
    this.provider = provider; this.materials = materials;
    this.materialSampler=materialSampler;
    this.spacing = provider.sampleSpacing;
    this.side = Math.round(size / this.spacing) + 1;
    this.values = new Float32Array(this.side ** 2 * STRIDE);
    this.warp = { x: 0, z: 0 }; this.weights = new Float32Array(8);
    this.result = { x: 0, y: 0, z: 0, normalY: 1, coverage: 0, flowerCoverage: 0, rock: 0 };
    this.bounds = {minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  }
  fill(index, originX, originZ, settings) {
    if (!index) {this.bounds.minX=this.bounds.minZ=Infinity;this.bounds.maxX=this.bounds.maxZ=-Infinity;}
    const x = originX + index % this.side * this.spacing, z = originZ + Math.floor(index / this.side) * this.spacing;
    this.provider.sampleWarp(x, z, this.warp);
    const offset = index * STRIDE;
    this.values[offset] = x + this.warp.x;
    this.values[offset+1] = this.provider.sampleHeight(x,z);
    this.values[offset+2] = z + this.warp.z;
    this.bounds.minX=Math.min(this.bounds.minX,this.values[offset]); this.bounds.maxX=Math.max(this.bounds.maxX,this.values[offset]);
    this.bounds.minZ=Math.min(this.bounds.minZ,this.values[offset+2]); this.bounds.maxZ=Math.max(this.bounds.maxZ,this.values[offset+2]);
    this.values[offset+3] = Math.abs(this.provider.sampleRockExposure(x,z));
    this.materialSampler.sample(x,z,this.weights);
    let total = 0, coverage = 0, excluded = 0, flowerCoverage=0, flowerExcluded=0;
    for (let i=0; i<8; i++) {
      total += this.weights[i]; coverage += this.weights[i]*settings.materialCoverage[i];
      if (settings.materialCoverage[i] === 0) excluded += this.weights[i];
      flowerCoverage+=this.weights[i]*settings.flowerMaterialCoverage[i];
      if (settings.flowerMaterialCoverage[i] === 0) flowerExcluded+=this.weights[i];
    }
    this.values[offset+4] = coverage + Math.max(0,1-total)*settings.baseCoverage;
    this.values[offset+5] = excluded;
    this.values[offset+6] = flowerCoverage+Math.max(0,1-total)*settings.flowerBaseCoverage;
    this.values[offset+7] = flowerExcluded;
  }
  sample(localX, localZ) {
    const x = localX / this.spacing, z = localZ / this.spacing;
    const ix = Math.min(this.side-2,Math.floor(x)), iz = Math.min(this.side-2,Math.floor(z));
    const u = x-ix, v = z-iz, base = iz*this.side+ix;
    let a, b, c, wa, wb, wc;
    if (u+v <= 1) { a=base; b=base+1; c=base+this.side; wa=1-u-v; wb=u; wc=v; }
    else { a=base+this.side+1; b=base+this.side; c=base+1; wa=u+v-1; wb=1-u; wc=1-v; }
    a*=STRIDE; b*=STRIDE; c*=STRIDE;
    const p=this.values, r=this.result;
    r.x=p[a]*wa+p[b]*wb+p[c]*wc; r.y=p[a+1]*wa+p[b+1]*wb+p[c+1]*wc; r.z=p[a+2]*wa+p[b+2]*wb+p[c+2]*wc;
    r.rock=p[a+3]*wa+p[b+3]*wb+p[c+3]*wc;
    // The terrain samples paint bilinearly, independently of its triangle
    // diagonal. Interpolate the raw density and exclusion mask the same way,
    // then apply the exclusion so other materials cannot leak tufts onto paths.
    const q=base*STRIDE, right=q+STRIDE, down=q+this.side*STRIDE, diagonal=down+STRIDE;
    const coverage=(p[q+4]*(1-u)+p[right+4]*u)*(1-v)+(p[down+4]*(1-u)+p[diagonal+4]*u)*v;
    const excluded=(p[q+5]*(1-u)+p[right+5]*u)*(1-v)+(p[down+5]*(1-u)+p[diagonal+5]*u)*v;
    const t=Math.max(0,Math.min(1,excluded/EXCLUSION_PAINT_WEIGHT));
    r.coverage=coverage*(1-t*t*(3-2*t));
    const flowerCoverage=(p[q+6]*(1-u)+p[right+6]*u)*(1-v)+(p[down+6]*(1-u)+p[diagonal+6]*u)*v;
    const flowerExcluded=(p[q+7]*(1-u)+p[right+7]*u)*(1-v)+(p[down+7]*(1-u)+p[diagonal+7]*u)*v;
    const ft=Math.max(0,Math.min(1,flowerExcluded/EXCLUSION_PAINT_WEIGHT));
    r.flowerCoverage=flowerCoverage*(1-ft*ft*(3-2*ft));
    const bx=p[b]-p[a], by=p[b+1]-p[a+1], bz=p[b+2]-p[a+2];
    const cx=p[c]-p[a], cy=p[c+1]-p[a+1], cz=p[c+2]-p[a+2];
    const nx=cy*bz-cz*by, ny=cz*bx-cx*bz, nz=cx*by-cy*bx;
    // Signed upward normal rejects folded undersides as well as steep cliffs.
    r.normalY=ny/Math.max(1e-9,Math.hypot(nx,ny,nz));
    return r;
  }
}
