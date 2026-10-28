import * as THREE from "three";

export const FLOWER_VARIANTS = Object.freeze(["yellow", "purple", "white"]);
export const MAX_FLOWER_DENSITY = .25;
// NextWorld flower.glb / lilaflower.glb: five flat petals, a raised gold
// center, a narrow stem and two broad pointed leaves. Rebuild that silhouette
// in 32 opaque triangles, without the reference's 904 tris or 2.4 MB atlas.
export function createFlowerGeometry() {
  const positions=[],colors=[],petals=[];
  const triangle=(a,b,c,color,petal=0)=>{
    positions.push(...a,...b,...c);
    for(let i=0;i<3;i++){colors.push(...color);petals.push(petal);}
  };
  const stem=[.23,.43,.09],leaf=[.30,.52,.12],leafShade=[.18,.36,.07];
  const ring=[];
  for(let i=0;i<3;i++){const angle=i*Math.PI*2/3;ring.push([Math.cos(angle)*.022,0,Math.sin(angle)*.022]);}
  const top=ring.map(p=>[p[0]+.045,.86,p[2]+.02]);
  for(let i=0;i<3;i++){const j=(i+1)%3;triangle(ring[i],ring[j],top[i],stem);triangle(top[i],ring[j],top[j],stem);}
  // Folded diamond leaves retain a light central ridge like the reference.
  for(const [angle,y]of[[.2,.23],[Math.PI+.8,.40]]){
    const dx=Math.cos(angle),dz=Math.sin(angle),rx=-dz,rz=dx;
    const base=[.045*y/.86,y,.02*y/.86],tip=[base[0]+dx*.30,y+.26,base[2]+dz*.30];
    const left=[base[0]+dx*.14+rx*.095,y+.10,base[2]+dz*.14+rz*.095];
    const right=[base[0]+dx*.14-rx*.095,y+.10,base[2]+dz*.14-rz*.095];
    triangle(base,left,tip,leaf);triangle(base,tip,right,leafShade);
  }
  const center=[.045,.91,.02];
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5,dx=Math.cos(a),dz=Math.sin(a),rx=-dz,rz=dx;
    const inner=[center[0]+dx*.035,.865,center[2]+dz*.035];
    const left=[center[0]+dx*.16+rx*.12,.875,center[2]+dz*.16+rz*.12];
    const right=[center[0]+dx*.16-rx*.12,.875,center[2]+dz*.16-rz*.12];
    const tip=[center[0]+dx*.285,.895,center[2]+dz*.285];
    triangle(inner,left,tip,[1,1,1],1);triangle(inner,tip,right,[.88,.88,.88],1);
    const b=(i+1)*Math.PI*2/5;
    triangle(center,[center[0]+dx*.075,.865,center[2]+dz*.075],[center[0]+Math.cos(b)*.075,.865,center[2]+Math.sin(b)*.075],[1,.66,.08]);
  }
  // The five-petal head also has a low underside, readable from below on hills.
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5,b=(i+1)*Math.PI*2/5;
    triangle([.045,.855,.02],[.045+Math.cos(a)*.075,.865,.02+Math.sin(a)*.075],[.045+Math.cos(b)*.075,.865,.02+Math.sin(b)*.075],[.38,.48,.08]);
  }
  triangle(top[0],top[1],top[2],stem);triangle(ring[2],ring[1],ring[0],stem);
  const geometry=new THREE.BufferGeometry();
  geometry.name="NextWorld meadow flower silhouette";
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute("flowerPetal",new THREE.Float32BufferAttribute(petals,1));
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
