// Explicit source-grid edit. Input samples come from the same river path used
// by the water mesh. This module owns no terrain, shader or world-file state.
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const gridKey = (x, z) => `${x},${z}`;
const MAX_SAMPLES = 300000, MAX_VISITS = 8000000;
import {lakeBoundary} from "../water/LakeBoundary.js";

function decodeFloats(text) {
  if (!text) return null;
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
  return new Float32Array(bytes.buffer);
}

export class RiverbedCarver {
  constructor(sculptor) { this.sculptor = sculptor; this.provider = sculptor.provider; this.protectionCache = new Map(); }

  protectedRegions() {
    const provider = this.provider, keys = new Set([...provider.persistedTileKeys, ...provider.cache.keys()]), regions = [];
    for (const key of keys) {
      const tile = provider.cache.get(key), serialized = tile ? null : provider.store?.read(key);
      const token = tile ? `${tile.revision}` : serialized;
      let cached = this.protectionCache.get(key);
      if (!cached || cached.tileRef?.deref() !== tile || cached.token !== token) {
        // Inspect serialized warp/exposure channels without decoding heights or
        // allocating CPU terrain owners, including remote displaced overhangs.
        let warp, rock, originX, originZ;
        if (tile) { warp = tile.warp; rock = tile.rockExposure; originX = tile.x; originZ = tile.z; }
        else if (serialized && !(serialized.includes('"warp":null') && serialized.includes('"rockExposure":null'))) {
          const record = JSON.parse(serialized);
          warp = decodeFloats(record.warp); rock = decodeFloats(record.rockExposure); originX = record.x; originZ = record.z;
        }
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        // Stable across CPU cache eviction/reload and height-only revisions.
        // Both hashes cover exact channel bytes, including exposure strength.
        let hashA=2166136261,hashB=0x9e3779b9;
        for(const channel of [warp,rock])if(channel)for(const byte of new Uint8Array(channel.buffer,channel.byteOffset,channel.byteLength)) {
          hashA=Math.imul(hashA^byte,16777619);hashB=Math.imul(hashB^byte,0x5bd1e995);
        }
        const shapeSignature=`${hashA>>>0},${hashB>>>0}`;
        const cells = new Set(), warped = [], spacing = provider.sampleSpacing, guard = spacing * 2;
        const cover = (x,z) => {
          minX=Math.min(minX,x-guard);maxX=Math.max(maxX,x+guard);
          minZ=Math.min(minZ,z-guard);maxZ=Math.max(maxZ,z+guard);
          for(let gz=Math.floor((z-guard)/spacing);gz<=Math.floor((z+guard)/spacing);gz++)
            for(let gx=Math.floor((x-guard)/spacing);gx<=Math.floor((x+guard)/spacing);gx++)cells.add(gridKey(gx,gz));
        };
        if (warp || rock) for (let i = 0; i < (provider.tileSegments + 1) ** 2; i++) {
          const wx = warp?.[i * 2] ?? 0, wz = warp?.[i * 2 + 1] ?? 0;
          if (Math.abs(wx) < .001 && Math.abs(wz) < .001 && Math.abs(rock?.[i] ?? 0) < .001) continue;
          const x = originX + (i % (provider.tileSegments + 1)) * provider.sampleSpacing;
          const z = originZ + Math.floor(i / (provider.tileSegments + 1)) * provider.sampleSpacing;
          cover(x,z);cover(x+wx,z+wz);
          if(wx!==0||wz!==0)warped.push({x,z,worldX:x+wx,worldZ:z+wz});
        }
        cached = { tileRef: tile ? new WeakRef(tile) : null, token, region: minX === Infinity ? null : { key, minX, maxX, minZ, maxZ, cells, warped, shapeSignature } };
        this.protectionCache.set(key, cached);
      }
      if (cached.region) regions.push(cached.region);
    }
    for (const key of this.protectionCache.keys()) if (!keys.has(key)) this.protectionCache.delete(key);
    return regions;
  }

  isProtected(x,z,regions) {
    const key=gridKey(Math.floor(x/this.provider.sampleSpacing),Math.floor(z/this.provider.sampleSpacing));
    return regions.some(r=>x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ&&r.cells.has(key));
  }
  snapshotRockify(regions) {
    // History needs stale-plan signatures, not copies of local masks/vertices.
    return regions.map(({key,shapeSignature})=>({key,shapeSignature}));
  }
  assertRockifyUnchanged(snapshot) {
    const current=this.protectedRegions(),previous=new Map(snapshot.map(r=>[r.key,r.shapeSignature]));
    if(current.length!==snapshot.length||current.some(r=>r.shapeSignature!==previous.get(r.key)))throw new Error("Rockify/warp changed after preview. Preview or carve the waterbed again.");
  }

  plan(samples, { depth = 3, bankWidth = 12, allowRockify = false, sampleHeight = (x,z)=>this.provider.sampleHeight(x,z) } = {}) {
    const started = performance.now(), provider = this.provider, spacing = provider.sampleSpacing;
    if (!Number.isFinite(depth) || depth < .25 || depth > 32 || !Number.isFinite(bankWidth) || bankWidth < 2 || bankWidth > 100) throw new Error("River depth must be 0.25–32 m and bank width 2–100 m.");
    if (!Array.isArray(samples) || samples.length < 2 || samples.some(p => ![p.x,p.y,p.z,p.width,p.nx,p.nz].every(Number.isFinite) || p.width <= 0)) throw new Error("Choose a valid river before carving.");
    const targets = new Map(), segmentBins = new Map(), binSize=64;
    const targetAt = (a,b,x,z) => {
      const dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length2));
      const px=a.x+dx*t,pz=a.z+dz*t,distance=Math.hypot(x-px,z-pz);
      const side=(x-px)*(a.nx+(b.nx-a.nx)*t)+(z-pz)*(a.nz+(b.nz-a.nz)*t);
      const sideWidth=p=>side<0?(p.leftWidth??p.width/2):(p.rightWidth??p.width/2);
      const half=sideWidth(a)*(1-t)+sideWidth(b)*t;
      if(distance>=half+bankWidth)return null;
      const waterY=a.y+(b.y-a.y)*t,wetHalf=Math.max(.25,half-spacing*.5),lip=.25;
      const u=(distance-wetHalf)/(half+bankWidth-wetHalf);
      const target=distance<=wetHalf?waterY-depth+(depth+lip)*smooth((distance/wetHalf-.2)/.8):waterY+lip+(depth+lip)*(u/(1-u))**2;
      return {target,waterY,edge:Math.abs(distance-half)<spacing};
    };
    let visits = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      if (length2 < 1e-9) continue;
      const radius = Math.max(a.leftWidth ?? a.width/2, a.rightWidth ?? a.width/2, b.leftWidth ?? b.width/2, b.rightWidth ?? b.width/2) + bankWidth;
      const minX = Math.ceil((Math.min(a.x,b.x)-radius)/spacing), maxX = Math.floor((Math.max(a.x,b.x)+radius)/spacing);
      const minZ = Math.ceil((Math.min(a.z,b.z)-radius)/spacing), maxZ = Math.floor((Math.max(a.z,b.z)+radius)/spacing);
      for(let bz=Math.floor(minZ*spacing/binSize);bz<=Math.floor(maxZ*spacing/binSize);bz++)for(let bx=Math.floor(minX*spacing/binSize);bx<=Math.floor(maxX*spacing/binSize);bx++) {
        const key=gridKey(bx,bz);if(!segmentBins.has(key))segmentBins.set(key,[]);segmentBins.get(key).push([a,b]);
      }
      visits += (maxX-minX+1)*(maxZ-minZ+1);
      if (visits > MAX_VISITS) throw new Error("Carving area is too large for one action. Split the river or reduce bank/river width.");
      for (let gz = minZ; gz <= maxZ; gz++) for (let gx = minX; gx <= maxX; gx++) {
        const x = gx*spacing, z = gz*spacing;
        const p=targetAt(a,b,x,z);if(!p)continue;
        const key = gridKey(gx,gz), previous = targets.get(key);
        if (!previous || p.target < previous.target) targets.set(key,{x,z,...p});
      }
      if (targets.size > MAX_SAMPLES) throw new Error("Carving exceeds 300,000 source samples. Split the river into smaller sections.");
    }
    const evaluate=(x,z)=>{
      let best=null;
      for(const [a,b] of segmentBins.get(gridKey(Math.floor(x/binSize),Math.floor(z/binSize)))??[]) {
        if(++visits>MAX_VISITS)throw new Error("Warped carving area is too large for one action. Split the river.");
        const p=targetAt(a,b,x,z);if(p&&(!best||p.target<best.target))best=p;
      }
      return best;
    };
    return this.finishPlan(targets,{started,getVisits:()=>visits,sampleHeight,allowRockify,evaluate});
  }

  planLake(body,{depth=3,bankWidth=12,allowRockify=false,sampleHeight=(x,z)=>this.provider.sampleHeight(x,z)}={}) {
    const started=performance.now(),spacing=this.provider.sampleSpacing;
    if(!Number.isFinite(depth)||depth<.25||depth>32||!Number.isFinite(bankWidth)||bankWidth<2||bankWidth>100)throw new Error("Waterbed depth must be 0.25–32 m and bank width 2–100 m.");
    const points=lakeBoundary(body),xs=points.map(p=>p.x),zs=points.map(p=>p.z),targets=new Map();
    const minX=Math.ceil((Math.min(...xs)-bankWidth)/spacing),maxX=Math.floor((Math.max(...xs)+bankWidth)/spacing);
    const minZ=Math.ceil((Math.min(...zs)-bankWidth)/spacing),maxZ=Math.floor((Math.max(...zs)+bankWidth)/spacing);
    const cells=(maxX-minX+1)*(maxZ-minZ+1);let visits=0;
    if(cells>MAX_SAMPLES||cells*points.length>MAX_VISITS)throw new Error("Lakebed area is too large for one action. Reduce the lake/bank size or number of control points.");
    const innerWidth=Math.max(4,bankWidth*.75),overlap=spacing*.5,lip=.25;
    const evaluate=(x,z)=> {
      if(x<minX*spacing||x>maxX*spacing||z<minZ*spacing||z>maxZ*spacing)return null;
      visits+=points.length;if(visits>MAX_VISITS)throw new Error("Warped lakebed area is too large for one action. Reduce the lake/bank size.");
      let inside=false,distance2=Infinity;
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[j],b=points[i],dx=b.x-a.x,dz=b.z-a.z;
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
        distance2=Math.min(distance2,(x-a.x-dx*t)**2+(z-a.z-dz*t)**2);
        if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
      }
      const distance=Math.sqrt(distance2),signed=inside?-distance:distance;
      if(signed>=bankWidth)return null;
      let target;
      if(signed<=-overlap)target=body.elevation-depth+(depth+lip)*smooth(1-(-signed-overlap)/innerWidth);
      else {const u=(signed+overlap)/(bankWidth+overlap);target=body.elevation+lip+(depth+lip)*(u/(1-u))**2;}
      return {target,waterY:body.elevation,edge:distance<spacing};
    };
    for(let gz=minZ;gz<=maxZ;gz++)for(let gx=minX;gx<=maxX;gx++) {
      const x=gx*spacing,z=gz*spacing,p=evaluate(x,z);
      if(p)targets.set(gridKey(gx,gz),{x,z,...p});
    }
    return this.finishPlan(targets,{started,getVisits:()=>visits,sampleHeight,allowRockify,evaluate});
  }

  finishPlan(targets,{started,getVisits,sampleHeight,allowRockify,evaluate}) {
    const provider=this.provider,regions=this.protectedRegions();
    let warpedSamples=0;
    {
      // Evaluate the bed at each warped vertex's visible XZ, but own its height
      // in source space. Never erase warp/exposure or choose an inverse branch
      // of a folded heightfield. Several folded layers may be lowered.
      const seen=new Set(),spacing=provider.sampleSpacing;
      for(const r of regions)for(const p of r.warped) {
        const key=gridKey(p.x/spacing,p.z/spacing);if(seen.has(key))continue;seen.add(key);
        targets.delete(key);
        const target=evaluate(p.worldX,p.worldZ);
        if(target){targets.set(key,{x:p.x,z:p.z,...target});warpedSamples++;}
      }
      if(targets.size>MAX_SAMPLES)throw new Error("Carving exceeds 300,000 source samples. Split the waterbed.");
    }
    const entries = [];
    // Check just the local protected candidates first. A bank influence whose
    // target is above the existing ground is harmless and must not block a bed.
    if(!allowRockify)for(const p of targets.values())if(this.isProtected(p.x,p.z,regions)&&Math.fround(p.target)<sampleHeight(p.x,p.z))
      throw new Error("Carving intersects protected Rockify/warped terrain. Enable Allow carving into Rockify to cut this bed; rock may deform. No heights were changed.");
    let lowBanks = 0,rockSamples=0;
    for (const p of targets.values()) {
      const before = sampleHeight(p.x,p.z);
      if (p.edge && before < p.waterY-.05) lowBanks++;
      const after = Math.fround(Math.min(before,p.target));
      if (after < before) {
        if(this.isProtected(p.x,p.z,regions)) {
          rockSamples++;
        }
        entries.push({type:"height",x:p.x,z:p.z,before,after});
      }
    }
    // Canonical source order keeps operations/history independent of segment
    // visitation order and avoids repeated tile-cache traversal along bends.
    entries.sort((a,b)=>Math.floor(a.z/provider.tileSize)-Math.floor(b.z/provider.tileSize)||Math.floor(a.x/provider.tileSize)-Math.floor(b.x/provider.tileSize)||a.z-b.z||a.x-b.x);
    return { provider, entries, targets, rockifyState:this.snapshotRockify(regions), stats: { sampled:targets.size, changed:entries.length, lowBanks, rockSamples, warpedSamples, visits:getVisits(), planMs:performance.now()-started } };
  }

  apply(plan) {
    const started = performance.now(), sculptor = this.sculptor, provider = this.provider;
    if (plan.provider !== provider) throw new Error("Riverbed preview belongs to another terrain provider.");
    if (sculptor.strokeChanges) throw new Error("Finish the current sculpt stroke before carving.");
    this.assertRockifyUnchanged(plan.rockifyState);
    // Never apply a stale preview. UI recomputes on every explicit Carve click;
    // other callers receive a non-destructive error if terrain has changed.
    for (const p of plan.entries) if (provider.sampleHeight(p.x,p.z) !== p.before) throw new Error("Terrain changed after preview. Preview or carve the riverbed again.");
    sculptor.beginStroke(); provider.beginChanges();
    try {
      for (const p of plan.entries) { sculptor.rememberHeight(p.x,p.z,p.before,p.after); provider.setHeightSample(p.x,p.z,p.after); }
    } finally { provider.endChanges(); }
    const entries = sculptor.endStroke();
    return { entries, stats:{...plan.stats,applyMs:performance.now()-started} };
  }
}
