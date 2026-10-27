// Pure derived path; no terrain queries or Three.js dependency.
export function sampleWaterfall(body) {
  const controls=body.points.map(p=>({...p,y:body.elevation+p.y})),first=controls[0],last=controls.at(-1),f=body.fall;
  let dx=last.x-first.x,dz=last.z-first.z,hlen=Math.hypot(dx,dz);
  if(hlen<.01){dx=Math.sin(f.heading*Math.PI/180);dz=Math.cos(f.heading*Math.PI/180);hlen=1;}
  const direction={x:dx/hlen,z:dz/hlen},side={x:direction.z,z:-direction.x};
  const lengths=controls.slice(1).map((p,i)=>Math.hypot(p.x-controls[i].x,p.y-controls[i].y,p.z-controls[i].z));
  const wanted=lengths.map(n=>Math.max(12,Math.ceil(n/.75))),total=wanted.reduce((a,b)=>a+b,0);
  const counts=total<=512?wanted:wanted.map(n=>4+Math.floor((n-4)*(512-4*wanted.length)/(total-4*wanted.length)));
  const samples=[];
  const tangentAt=index=>{
    const a=controls[index-1],b=controls[index+1],length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    return {x:(b.x-a.x)/length,y:(b.y-a.y)/length,z:(b.z-a.z)/length};
  };
  const add=p=>{const previous=samples.at(-1);p.distance=previous?previous.distance+Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z):0;samples.push(p);};
  if(f.overlap>0)add({x:first.x-direction.x*f.overlap,y:first.y,z:first.z-direction.z*f.overlap});
  for(let segment=0;segment<controls.length-1;segment++) {
    const a=controls[segment],b=controls[segment+1],drop=a.y-b.y,horizontal=Math.hypot(b.x-a.x,b.z-a.z);
    const local=horizontal>.01?{x:(b.x-a.x)/horizontal,z:(b.z-a.z)/horizontal}:direction;
    const reach=horizontal/3*(1-f.curvature)+Math.min(20,Math.max(horizontal*.45,drop*.12,f.width*.25))*f.curvature;
    const tail=horizontal/3*(1-f.curvature)+horizontal*.2*f.curvature;
    const p1={x:a.x+local.x*reach,y:a.y-drop*(1-f.curvature)/3,z:a.z+local.z*reach};
    const p2={x:b.x-local.x*tail,y:b.y+drop*(1-f.curvature)/3,z:b.z-local.z*tail};
    // Interior controls share a tangent instead of creating a new lip at
    // every interval. Limit handle lengths to preserve descending heights.
    const handle=t=>Math.min(lengths[segment]/3,drop/(3*Math.max(1e-6,-t.y)));
    if(segment>0){const t=tangentAt(segment),h=handle(t);for(const key of ["x","y","z"])p1[key]=a[key]+t[key]*h;}
    if(segment<controls.length-2){const t=tangentAt(segment+1),h=handle(t);for(const key of ["x","y","z"])p2[key]=b[key]-t[key]*h;}
    for(let j=segment?1:0;j<=counts[segment];j++) {
      const t=j/counts[segment],s=1-t;
      const at=key=>s*s*s*a[key]+3*s*s*t*p1[key]+3*s*t*t*p2[key]+t*t*t*b[key];
      add({x:at("x"),y:at("y"),z:at("z")});
    }
  }
  if(f.overlap>0)add({x:last.x+direction.x*f.overlap,y:last.y,z:last.z+direction.z*f.overlap});
  const length=samples.at(-1).distance;
  let hash=0;for(const c of body.id)hash=(Math.imul(hash,31)+c.charCodeAt(0))|0;
  const phase=(hash>>>0)/4294967296*Math.PI*2;
  for(const p of samples){p.progress=p.distance/length;const fade=Math.sin(Math.PI*p.progress);p.width=f.width*(1+(.025*Math.sin(p.distance*.43+phase)+.015*Math.sin(p.distance*.91-phase))*fade);}
  return {samples,direction,side,length,drop:first.y-last.y,phase};
}
