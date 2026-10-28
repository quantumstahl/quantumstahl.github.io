import * as THREE from "three";
import { normalizeGrassSettings, grassHash } from "./GrassSettings.js";
import { createGrassGeometries } from "./GrassGeometry.js";
import { createGrassMaterial } from "./GrassMaterial.js";
import { GrassSurface } from "./GrassSurface.js";
import { GrassWaterMask } from "./GrassWaterMask.js";
import { GrassMaterialSampler } from "./GrassMaterialSampler.js";

const distanceSq = (x,z,b) => Math.max(b.min.x-x,0,x-b.max.x)**2 + Math.max(b.min.z-z,0,z-b.max.z)**2;
export class GrassSystem {
  constructor(scene, provider, materials, { settings, water = null, diagnostics = false } = {}) {
    Object.assign(this, { provider, materials, diagnostics });
    this.settings = normalizeGrassSettings(settings);
    this.root = new THREE.Group(); this.root.name = "Streamed grass"; scene.add(this.root);
    this.shapes = createGrassGeometries();
    this.nearMaterial = createGrassMaterial(); this.farMaterial = createGrassMaterial(true);
    this.cells = new Map(); this.pool = []; this.wanted = []; this.wantedKeys = new Set();
    this.materialSampler=new GrassMaterialSampler(materials);
    this.planX = NaN; this.planZ = NaN; this.job = null; this.disposed = false;
    this.frustum = new THREE.Frustum(); this.projection = new THREE.Matrix4();
    this.stats = { activeCells: 0, visibleCells: 0, nearInstances: 0, farInstances: 0, triangles: 0, drawCalls: 0,
      updateMs: 0, peakUpdateMs: 0, rebuilds: 0, maxCellUpdateMs: 0, maxCellBuildMs: 0, workUnits: 0, pendingCells: 0,
      slowestUnit: {ms:0,stage:"",cell:"",grid:0,candidate:0} };
    this.waterMask = new GrassWaterMask(water, bounds => this.invalidateWorld(bounds));
    this.unsubTerrain = provider.onTileChanged((tile, channels, bounds) => this.invalidateSource(tile,bounds));
    this.unsubMaterials = materials.onChanged(event => { if (event.type === "tile") this.invalidateSource(event.tile,event.bounds); });
    this.syncUniforms();
  }
  syncUniforms() {
    const s = this.settings;
    const color = (target, hex) => { const n = parseInt(hex.slice(1),16); target.set((n>>16&255)/255,(n>>8&255)/255,(n&255)/255); };
    for (const material of [this.nearMaterial, this.farMaterial]) {
      const u = material.uniforms;
      u.uWind.value=s.windStrength; u.uWindSpeed.value=s.windSpeed; u.uScale.value=s.scale; u.uVariation.value=s.variation;
      u.uNear.value=s.nearDistance; u.uFar.value=s.farDistance; u.uMax.value=s.maxDistance; u.uTransition.value=s.transition;
      color(u.uBase.value,s.baseColor); color(u.uTip.value,s.tipColor);
    }
  }
  configure(changes) {
    const before=this.settings, next=normalizeGrassSettings({ ...before, ...changes });
    this.settings=next; this.syncUniforms();
    // Appearance/range changes affect uniforms and conservative culling only.
    // Placement changes rebuild cached cells incrementally with the same seed.
    const keys=["seed","density","cellSize","baseCoverage","materialCoverage","maxSlope","rockThreshold","waterClearance"];
    if (keys.some(key => JSON.stringify(before[key]) !== JSON.stringify(next[key]))) {
      for (const cell of this.cells.values()) this.dirty(cell);
    }
    this.planX=NaN;
    return next;
  }
  dirty(cell) {
    cell.dirty=true; cell.version++;
    cell.near.visible=cell.far.visible=false;
  }
  invalidateSource(tile, bounds) {
    if (tile.warp) this.planX=NaN;
    const size=tile.size ?? this.provider.tileSize, guard=this.provider.sampleSpacing;
    const minX=bounds?.minX ?? tile.x, maxX=bounds?.maxX ?? tile.x+size;
    const minZ=bounds?.minZ ?? tile.z, maxZ=bounds?.maxZ ?? tile.z+size;
    for (const cell of this.cells.values()) {
      if (cell.x+cell.size < minX-guard || cell.x > maxX+guard || cell.z+cell.size < minZ-guard || cell.z > maxZ+guard) continue;
      this.dirty(cell);
    }
  }
  invalidateWorld(b) {
    for (const cell of this.cells.values()) {
      if (cell.box.max.x < b.minX || cell.box.min.x > b.maxX || cell.box.max.z < b.minZ || cell.box.min.z > b.maxZ) continue;
      this.dirty(cell);
    }
  }
  plan(x,z) {
    const s=this.settings, cx=Math.floor(x/s.cellSize), cz=Math.floor(z/s.cellSize);
    if (cx === this.planX && cz === this.planZ) return;
    this.planX=cx; this.planZ=cz; this.wanted.length=0; this.wantedKeys.clear();
    const radius=Math.ceil(s.maxDistance/s.cellSize)+1;
    for (let dz=-radius; dz<=radius; dz++) for (let dx=-radius; dx<=radius; dx++) {
      // Include a full camera cell of hysteresis. Planning runs only on cell
      // crossings, and rotation never creates or repacks instance buffers.
      const nearestX=Math.max(0,Math.abs(dx)-1)*s.cellSize, nearestZ=Math.max(0,Math.abs(dz)-1)*s.cellSize;
      if (nearestX*nearestX+nearestZ*nearestZ > s.maxDistance*s.maxDistance) continue;
      const ix=cx+dx, iz=cz+dz, key=`${s.cellSize}:${ix},${iz}`;
      const wanted={key,ix,iz,x:ix*s.cellSize,z:iz*s.cellSize,size:s.cellSize,distance:dx*dx+dz*dz};
      this.wanted.push(wanted); this.wantedKeys.add(key);
      const cell=this.cells.get(key); if (cell) cell.lastUsed=performance.now();
    }
    // Large forward warps can bring a source cell into view from outside the
    // ordinary camera circle. Reuse the provider's retained warp metadata;
    // never walk or materialize the surrounding 256 m terrain tiles here.
    for (const summary of this.provider.warpSummaries.values()) {
      const guard=this.provider.sampleSpacing;
      const minX=summary.sourceMinX-guard+summary.minWarpX, maxX=summary.sourceMaxX+guard+summary.maxWarpX;
      const minZ=summary.sourceMinZ-guard+summary.minWarpZ, maxZ=summary.sourceMaxZ+guard+summary.maxWarpZ;
      if (maxX<x-s.maxDistance || minX>x+s.maxDistance || maxZ<z-s.maxDistance || minZ>z+s.maxDistance) continue;
      const firstX=Math.floor((summary.sourceMinX-guard)/s.cellSize), lastX=Math.floor((summary.sourceMaxX+guard)/s.cellSize);
      const firstZ=Math.floor((summary.sourceMinZ-guard)/s.cellSize), lastZ=Math.floor((summary.sourceMaxZ+guard)/s.cellSize);
      for (let iz=firstZ;iz<=lastZ;iz++) for (let ix=firstX;ix<=lastX;ix++) {
        const key=`${s.cellSize}:${ix},${iz}`;
        if (this.wantedKeys.has(key)) continue;
        const left=ix*s.cellSize+summary.minWarpX, right=(ix+1)*s.cellSize+summary.maxWarpX;
        const top=iz*s.cellSize+summary.minWarpZ, bottom=(iz+1)*s.cellSize+summary.maxWarpZ;
        const dx=Math.max(left-x,0,x-right),dz=Math.max(top-z,0,z-bottom);
        if (dx*dx+dz*dz>s.maxDistance*s.maxDistance) continue;
        this.wanted.push({key,ix,iz,x:ix*s.cellSize,z:iz*s.cellSize,size:s.cellSize,distance:(dx*dx+dz*dz)/s.cellSize**2});
        this.wantedKeys.add(key);
      }
    }
    this.wanted.sort((a,b)=>a.distance-b.distance);
    // Pathological folded regions can span many source cells. Prioritize
    // nearby footprints while keeping residency bounded on mobile.
    if (this.wanted.length>1024) {
      for (let i=1024;i<this.wanted.length;i++) this.wantedKeys.delete(this.wanted[i].key);
      this.wanted.length=1024;
    }
    if (this.job && !this.wantedKeys.has(this.job.cell.key)) this.job=null;
  }
  createCell(wanted) {
    let cell;
    const pooled=this.pool.findIndex(c=>c.size===wanted.size);
    if (pooled>=0) cell=this.pool.splice(pooled,1)[0];
    else {
      const capacity=Math.ceil(2*wanted.size*wanted.size);
      const roots=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(THREE.DynamicDrawUsage);
      const data=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(THREE.DynamicDrawUsage);
      const mesh=(shape,material)=>{
        const geometry=new THREE.InstancedBufferGeometry();
        for (const [key,attribute] of Object.entries(shape.attributes)) geometry.setAttribute(key,attribute);
        if (shape.index) geometry.setIndex(shape.index);
        geometry.setAttribute("grassRoot",roots); geometry.setAttribute("grassData",data); geometry.instanceCount=0;
        const mesh=new THREE.Mesh(geometry,material);
        mesh.frustumCulled=false; mesh.castShadow=false; mesh.receiveShadow=false; mesh.visible=false;
        this.root.add(mesh); return mesh;
      };
      cell={roots,data,near:mesh(this.shapes.near,this.nearMaterial),far:mesh(this.shapes.far,this.farMaterial),
        surface:new GrassSurface(this.provider,this.materials,wanted.size,this.materialSampler),box:new THREE.Box3(),version:0};
    }
    Object.assign(cell,wanted,{count:0,dirty:true,lastUsed:performance.now()});
    cell.version++; cell.near.visible=cell.far.visible=false;
    cell.box.min.set(cell.x,-1e4,cell.z); cell.box.max.set(cell.x+cell.size,1e4,cell.z+cell.size);
    this.cells.set(cell.key,cell); return cell;
  }
  startJob() {
    for (const wanted of this.wanted) {
      let cell=this.cells.get(wanted.key);
      if (!cell) cell=this.createCell(wanted);
      if (!cell.dirty) continue;
      cell.count=0; cell.box.makeEmpty();
      this.job={cell,version:cell.version,grid:0,candidate:0,candidates:Math.floor(cell.size**2*this.settings.density),cpuMs:0};
      return true;
    }
    return false;
  }
  step() {
    const j=this.job, cell=j.cell, s=this.settings;
    if (cell.version !== j.version) { this.job=null; return; }
    if (j.grid < cell.surface.side**2) {
      cell.surface.fill(j.grid++,cell.x,cell.z,s); return;
    }
    j.waitingForWater=false;
    if (j.candidate < j.candidates) {
      const i=j.candidate++, random=stream=>grassHash(s.seed,cell.ix,cell.iz,i,stream);
      const localX=random(0)*cell.size, localZ=random(1)*cell.size;
      const p=cell.surface.sample(localX,localZ);
      if (p.normalY < Math.cos(s.maxSlope*Math.PI/180) || p.rock >= s.rockThreshold) return;
      // Broad deterministic patches break the regular appearance of uniform
      // white-noise placement without a repeating jittered lattice.
      const patch=.65+.35*grassHash(s.seed,Math.floor((cell.x+localX)/7),Math.floor((cell.z+localZ)/7));
      const slope=Math.max(0,Math.min(1,(p.normalY-Math.cos(s.maxSlope*Math.PI/180))/.15));
      if (random(2) >= p.coverage*patch*slope) return;
      // Only an accepted root can request water work. This also handles a
      // source cell warped beyond the ordinary camera-focused index window.
      if (!this.waterMask.readyAt(p.x,p.z,true)) {
        j.waitingForWater=true;j.waitX=p.x;j.waitZ=p.z;j.candidate--;return;
      }
      if (this.waterMask.covered(p.x,p.y,p.z,s.waterClearance)) return;
      const offset=cell.count++*4;
      cell.roots.array[offset]=p.x; cell.roots.array[offset+1]=p.y-.025; cell.roots.array[offset+2]=p.z;
      cell.roots.array[offset+3]=.76+random(3)*.48;
      cell.data.array[offset]=random(4)*Math.PI*2; cell.data.array[offset+1]=.90+random(5)*.20;
      cell.data.array[offset+2]=random(6);
      // Increasing rank, independent of acceptance, permits prefix submission
      // in far cells. All near and far tufts share identical roots and seeds.
      cell.data.array[offset+3]=Math.floor(random(7)*5)+(i+.5)/Math.max(1,j.candidates)*.999;
      cell.box.min.x=Math.min(cell.box.min.x,p.x); cell.box.min.y=Math.min(cell.box.min.y,p.y); cell.box.min.z=Math.min(cell.box.min.z,p.z);
      cell.box.max.x=Math.max(cell.box.max.x,p.x); cell.box.max.y=Math.max(cell.box.max.y,p.y); cell.box.max.z=Math.max(cell.box.max.z,p.z);
      return;
    }
    if (!cell.count) { cell.box.min.set(cell.x,0,cell.z); cell.box.max.set(cell.x+cell.size,0,cell.z+cell.size); }
    // Keep raw root bounds; scale/wind margins are applied at culling time.
    for (const attribute of [cell.roots,cell.data]) {
      attribute.clearUpdateRanges();
      if (cell.count) { attribute.addUpdateRange(0,cell.count*4); attribute.needsUpdate=true; }
    }
    cell.near.geometry.instanceCount=cell.far.geometry.instanceCount=cell.count;
    cell.dirty=false; this.stats.rebuilds++; this.job=null;
  }
  releaseCell(cell, pool=true) {
    this.cells.delete(cell.key); cell.near.visible=cell.far.visible=false;
    if (pool && this.pool.length<4) this.pool.push(cell);
    else {
      cell.near.removeFromParent(); cell.far.removeFromParent(); cell.near.geometry.dispose(); cell.far.geometry.dispose();
    }
  }
  trim() {
    const limit=Math.max(this.settings.cacheCells,this.wanted.length+8);
    for (let n=0; n<this.settings.releasesPerFrame && this.cells.size>limit; n++) {
      let oldest=null;
      for (const cell of this.cells.values()) {
        if (!this.wantedKeys.has(cell.key) && (!oldest || cell.lastUsed<oldest.lastUsed)) oldest=cell;
      }
      if (!oldest) break;
      this.releaseCell(oldest);
    }
    // Changing cell size retires mismatched buffers with the same small cap.
    let released=0;
    for (const cell of this.cells.values()) if (cell.size!==this.settings.cellSize && released++<this.settings.releasesPerFrame) this.releaseCell(cell,false);
  }
  update(camera, delta=0) {
    if (this.disposed) return;
    const s=this.settings, stats=this.stats, started=performance.now();
    const u=this.nearMaterial.uniforms;
    u.uTime.value=(u.uTime.value+Math.max(0,delta))%10000;
    this.farMaterial.uniforms.uTime.value=u.uTime.value;
    this.root.visible=s.enabled;
    stats.visibleCells=stats.nearInstances=stats.farInstances=stats.triangles=stats.drawCalls=stats.workUnits=0;
    if (!s.enabled) { stats.updateMs=this.diagnostics?performance.now()-started:0; return; }
    const x=camera.position.x,z=camera.position.z;
    this.waterMask.setFocus(x,z,s.maxDistance+s.cellSize);
    this.plan(x,z); this.trim();
    const deadline=started+s.buildBudgetMs;
    let completed=0,work=0,cellWorkMs=0;
    while (work<s.samplesPerFrame && completed<s.cellsPerFrame && performance.now()<deadline) {
      const stepStart=this.diagnostics?performance.now():0;
      if (!this.waterMask.ready && (work%3===0 || (this.job?.waitingForWater && !this.waterMask.readyAt(this.job.waitX,this.job.waitZ)))) this.waterMask.step();
      else {
        if (!this.job && !this.startJob()) break;
        const job=this.job;
        const stage=this.diagnostics?(job.grid<job.cell.surface.side**2?"surface":job.candidate<job.candidates?"placement":"commit"):null;
        this.step();
        if (this.diagnostics) {
          const elapsed=performance.now()-stepStart;
          job.cpuMs+=elapsed; cellWorkMs+=elapsed;
          if (elapsed>stats.slowestUnit.ms) Object.assign(stats.slowestUnit,{ms:elapsed,stage,cell:job.cell.key,grid:job.grid,candidate:job.candidate});
          if (!this.job) stats.maxCellBuildMs=Math.max(stats.maxCellBuildMs,job.cpuMs);
        }
        if (!this.job) completed++;
      }
      work++;
    }
    stats.workUnits=work;
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    const margin=s.scale*(3+s.windStrength*.2), height=s.scale*6;
    for (const cell of this.cells.values()) {
      cell.near.visible=cell.far.visible=false;
      if (cell.dirty || !cell.count) continue;
      const b=cell.box;
      // Expand/restore in place: no temporary Box3/Vector3 allocations in RAF.
      b.min.x-=margin; b.min.z-=margin; b.min.y-=.05;
      b.max.x+=margin; b.max.z+=margin; b.max.y+=height;
      const d2=distanceSq(x,z,b), inView=d2<=s.maxDistance**2 && this.frustum.intersectsBox(b);
      b.min.x+=margin; b.min.z+=margin; b.min.y+=.05;
      b.max.x-=margin; b.max.z-=margin; b.max.y-=height;
      if (!inView) continue;
      const nearest=Math.sqrt(d2);
      const farthest=Math.hypot(Math.max(Math.abs(b.min.x-x),Math.abs(b.max.x-x)),Math.max(Math.abs(b.min.z-z),Math.abs(b.max.z-z)));
      const near=nearest<s.nearDistance+s.transition*.5, far=farthest>s.nearDistance-s.transition*.5;
      cell.near.visible=near; cell.far.visible=far;
      // Rank prefix culls distant instances before vertex shading. The shader
      // independently applies exact per-root density and a smooth tip shrink.
      let farCount=cell.count;
      if (nearest>s.farDistance) {
        const t=Math.min(1,(nearest-s.farDistance)/(s.maxDistance-s.farDistance)), density=1-t*t*(3-2*t)+.035;
        let lo=0,hi=cell.count;
        while (lo<hi) { const mid=(lo+hi)>>>1, value=cell.data.array[mid*4+3]; if (value-Math.floor(value)<density) lo=mid+1; else hi=mid; }
        farCount=lo;
      }
      cell.far.geometry.instanceCount=farCount;
      if (far && !farCount) cell.far.visible=false;
      stats.visibleCells++;
      if (near) { stats.nearInstances+=cell.count; stats.drawCalls++; }
      if (cell.far.visible) { stats.farInstances+=farCount; stats.drawCalls++; }
    }
    stats.activeCells=this.cells.size;
    stats.triangles=stats.nearInstances*54+stats.farInstances*3;
    if (this.diagnostics) {
      stats.pendingCells=0;
      for (const wanted of this.wanted) if (!this.cells.has(wanted.key) || this.cells.get(wanted.key).dirty) stats.pendingCells++;
      stats.updateMs=performance.now()-started; stats.peakUpdateMs=Math.max(stats.peakUpdateMs,stats.updateMs);
      stats.maxCellUpdateMs=Math.max(stats.maxCellUpdateMs,cellWorkMs);
    }
  }
  diagnosticLines() {
    if (!this.diagnostics) return [];
    const s=this.stats;
    return [`Grass ${s.visibleCells}/${s.activeCells} cells · ${s.pendingCells} pending · ${s.nearInstances} near / ${s.farInstances} far`,
      `Grass ${s.triangles} submitted tris · ${s.drawCalls} calls · CPU ${s.updateMs.toFixed(2)} p${s.peakUpdateMs.toFixed(2)} ms`,
      `Grass rebuilt ${s.rebuilds} · max cell work/frame ${s.maxCellUpdateMs.toFixed(3)} ms · full build ${s.maxCellBuildMs.toFixed(2)} ms`];
  }
  dispose() {
    if (this.disposed) return;
    this.disposed=true; this.unsubTerrain(); this.unsubMaterials(); this.waterMask.dispose(); this.job=null;
    this.materialSampler.dispose();
    for (const cell of this.cells.values()) this.releaseCell(cell,false);
    for (const cell of this.pool) { cell.near.geometry.dispose(); cell.far.geometry.dispose(); }
    this.pool.length=0; this.root.clear(); this.root.removeFromParent();
    this.shapes.near.dispose(); this.shapes.far.dispose(); this.nearMaterial.dispose(); this.farMaterial.dispose();
  }
}
