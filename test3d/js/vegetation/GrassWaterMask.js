// Index the actual rendered lake / river triangles, including rounded shores,
// narrowed river bends and varying elevations. Work is resumable and charged
// to the SAME deadline as cell generation. Waterfall sheets do not own ground.
export class GrassWaterMask {
  constructor(water, invalidate) {
    this.water = water;
    this.invalidate = invalidate;
    this.records = new Map();
    this.pending = new Map();
    this.bins = new Map();
    this.large = new Set();
    this.job = null;
    this.focusX=0; this.focusZ=0; this.focusRadius=Infinity;
    this.requested=new Set();
    if (water) {
      for (const id of water.meshes.keys()) this.queue(id);
      this.unsubscribe = water.data.onChanged(id => this.queue(id));
    }
  }
  queue(id) {
    const old = this.records.get(id);
    const body = this.water.data.get(id), mesh = this.water.meshes.get(id);
    if (mesh && (old?.geometry === mesh.geometry || this.pending.get(id)?.geometry === mesh.geometry || (this.job?.id === id && this.job.record?.geometry === mesh.geometry))) return;
    if (old) this.invalidate(old.bounds);
    if (!mesh || body?.type === "waterfall") { this.pending.set(id, null); return; }
    const sphere = mesh.geometry.boundingSphere;
    const bounds = { minX: sphere.center.x - sphere.radius, maxX: sphere.center.x + sphere.radius,
      minZ: sphere.center.z - sphere.radius, maxZ: sphere.center.z + sphere.radius };
    this.invalidate(bounds);
    this.pending.set(id, { id, geometry: mesh.geometry, bounds, binKeys: new Set(), large: [], valid: true });
  }
  setFocus(x,z,radius) { this.focusX=x; this.focusZ=z; this.focusRadius=radius; }
  distance(bounds) {
    return Math.hypot(Math.max(bounds.minX-this.focusX,0,this.focusX-bounds.maxX),Math.max(bounds.minZ-this.focusZ,0,this.focusZ-bounds.maxZ));
  }
  nextPending() {
    let best=null,distance=Infinity;
    for (const [id,record] of this.pending) {
      const bounds=record?.bounds ?? this.records.get(id)?.bounds;
      const d=this.requested.has(id)?-1:bounds?this.distance(bounds):0;
      if (d<=this.focusRadius && d<distance) {best=[id,record];distance=d;}
    }
    return best;
  }
  get ready() { return !this.job && !this.nextPending(); }
  readyAt(x,z,request=false) {
    const contains=b=>b && x>=b.minX && x<=b.maxX && z>=b.minZ && z<=b.maxZ;
    let ready=true;
    if (this.job && (contains(this.job.record?.bounds) || contains(this.job.old?.bounds))) ready=false;
    for (const [id,record] of this.pending) if (contains(record?.bounds ?? this.records.get(id)?.bounds)) {
      ready=false;if(request)this.requested.add(id);
    }
    return ready;
  }
  step() {
    if (!this.job) {
      const entry = this.nextPending();
      if (!entry) return false;
      const [id, record] = entry;
      this.pending.delete(id);
      const old = this.records.get(id);
      if (old) {
        old.valid = false;
        // Each owner only touches its own occupied bins. No world-wide scan.
        this.job = { id, record, remove: old.binKeys.values(), old, triangle: 0, insert: null };
      } else this.job = { id, record, triangle: 0, insert: null };
    }
    const job = this.job;
    if (job.remove) {
      const next = job.remove.next();
      if (!next.done) {
        const bin = this.bins.get(next.value);
        if (bin) { bin.delete(job.old); if (!bin.size) this.bins.delete(next.value); }
        return true;
      }
      this.large.delete(job.old); this.records.delete(job.id); job.remove = null;
    }
    const record = job.record;
    if (!record) { this.requested.delete(job.id); this.job = null; return true; }
    if (job.insert) {
      const ins = job.insert, key = `${ins.x},${ins.z}`;
      let bin = this.bins.get(key);
      if (!bin) this.bins.set(key, bin = new Map());
      let triangles = bin.get(record);
      if (!triangles) bin.set(record, triangles = []);
      triangles.push(ins.triangle); record.binKeys.add(key);
      if (++ins.x > ins.maxX) { ins.x = ins.minX; ins.z++; }
      if (ins.z > ins.maxZ) job.insert = null;
      return true;
    }
    const geometry = record.geometry, index = geometry.index.array, p = geometry.attributes.position.array;
    if (job.triangle >= index.length) {
      this.records.set(job.id, record);
      // Invalidate once more after the complete replacement is queryable.
      this.invalidate(record.bounds); this.requested.delete(job.id); this.job = null; return true;
    }
    const triangle = job.triangle; job.triangle += 3;
    const a = index[triangle] * 3, b = index[triangle+1] * 3, c = index[triangle+2] * 3;
    const minX = Math.floor(Math.min(p[a],p[b],p[c]) / 64), maxX = Math.floor(Math.max(p[a],p[b],p[c]) / 64);
    const minZ = Math.floor(Math.min(p[a+2],p[b+2],p[c+2]) / 64), maxZ = Math.floor(Math.max(p[a+2],p[b+2],p[c+2]) / 64);
    if ((maxX-minX+1)*(maxZ-minZ+1) > 64) { record.large.push(triangle); this.large.add(record); }
    else job.insert = { triangle, minX, maxX, maxZ, x: minX, z: minZ };
    return true;
  }
  covered(x, y, z, clearance) {
    const bin = this.bins.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`);
    if (bin) for (const [record, triangles] of bin) if (record.valid && this.hit(record, triangles, x,y,z,clearance)) return true;
    for (const record of this.large) if (record.valid && this.hit(record, record.large, x,y,z,clearance)) return true;
    return false;
  }
  hit(record, triangles, x, y, z, clearance) {
    const bounds = record.bounds;
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;
    const p = record.geometry.attributes.position.array, index = record.geometry.index.array;
    for (const triangle of triangles) {
      const a = index[triangle]*3, b = index[triangle+1]*3, c = index[triangle+2]*3;
      const dx = x-p[a], dz = z-p[a+2], bx = p[b]-p[a], bz = p[b+2]-p[a+2], cx = p[c]-p[a], cz = p[c+2]-p[a+2];
      const det = bx*cz-bz*cx;
      if (Math.abs(det) < 1e-9) continue;
      const u = (dx*cz-dz*cx)/det, v = (bx*dz-bz*dx)/det;
      if (u >= -1e-6 && v >= -1e-6 && u+v <= 1.000001 && y <= p[a+1]*(1-u-v)+p[b+1]*u+p[c+1]*v+clearance) return true;
    }
    return false;
  }
  dispose() {
    this.unsubscribe?.(); this.pending.clear(); this.records.clear(); this.bins.clear(); this.large.clear(); this.requested.clear(); this.job = null;
  }
}
