// Closed corner-cutting curve: deterministic, bounded, shared by rendering
// and lakebed authoring. Authored control points remain editable and saved.
export function lakeBoundary(body) {
  let points=body.points.map(p=>({x:p.x,z:p.z}));
  const cut=(body.roundness??0)*.25;
  if(!cut)return points;
  for(let pass=0;pass<3;pass++) {
    const next=[];
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length];
      next.push({x:a.x*(1-cut)+b.x*cut,z:a.z*(1-cut)+b.z*cut},{x:a.x*cut+b.x*(1-cut),z:a.z*cut+b.z*(1-cut)});
    }
    points=next;
  }
  return points;
}
