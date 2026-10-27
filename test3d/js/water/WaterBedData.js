// Sparse original heights and water-owned target heights. Compact tuples are
// persisted alongside (not inside) terrain tiles; no derived meshes are saved.
export const bedKey=(x,z)=>`${x},${z}`;
const invalid=()=>{throw new Error("Invalid waterbed restoration data.");};
const finite=n=>typeof n==="number"&&Number.isFinite(n)&&Math.fround(n)===n;
export class WaterBedData {
  constructor(){this.records=new Map();this.settings=new Map();this.ownerKeys=new Map();this.contributionCount=0;this.listeners=new Set();this.cachedSignature=null;this.savedSignature=this.signature();}
  static fromJSON(value,water) {
    const data=new WaterBedData();if(value===undefined)return data;
    if(!value||value.version!==1||!Array.isArray(value.samples)||value.samples.length>1000000||!Array.isArray(value.beds)||value.beds.length>2048)invalid();
    for(const b of value.beds) {
      if(!b||!water.get(b.id)||water.get(b.id).type==="waterfall"||data.settings.has(b.id)||!Number.isFinite(b.depth)||b.depth<.25||b.depth>32||!Number.isFinite(b.bankWidth)||b.bankWidth<2||b.bankWidth>100)invalid();
      if(b.allowRockify!==undefined&&typeof b.allowRockify!=="boolean")invalid();
      data.settings.set(b.id,Object.freeze({depth:b.depth,bankWidth:b.bankWidth,...(b.allowRockify?{allowRockify:true}:{})}));
    }
    let contributions=0;
    for(const row of value.samples) {
      if(!Array.isArray(row)||row.length!==5||!Number.isInteger(row[0]/2)||!Number.isInteger(row[1]/2)||Math.abs(row[0])>20000||Math.abs(row[1])>20000||!finite(row[2])||!finite(row[3])||!Array.isArray(row[4])||!row[4].length||row[4].length>2048)invalid();
      const ids=new Set();
      for(const owner of row[4]) {
        if(!Array.isArray(owner)||owner.length!==2||!data.settings.has(owner[0])||ids.has(owner[0])||!finite(owner[1])||owner[1]>=row[2])invalid();
        ids.add(owner[0]);
      }
      if((contributions+=row[4].length)>2000000||row[3]!==Math.min(row[2],...row[4].map(p=>p[1])))invalid();
      const key=bedKey(row[0],row[1]);if(data.records.has(key))invalid();
      data.put(key,row);
    }
    data.cachedSignature=null;data.savedSignature=data.signature();return data;
  }
  put(key,row) {
    const old=this.records.get(key);
    this.contributionCount+=(row?.[4].length??0)-(old?.[4].length??0);
    if(old)for(const [id] of old[4]){this.ownerKeys.get(id)?.delete(key);if(!this.ownerKeys.get(id)?.size)this.ownerKeys.delete(id);}
    if(row){
      const next=Object.freeze([row[0],row[1],row[2],row[3],Object.freeze(row[4].map(p=>Object.freeze([...p])))]);
      this.records.set(key,next);
      for(const [id] of next[4]){if(!this.ownerKeys.has(id))this.ownerKeys.set(id,new Set());this.ownerKeys.get(id).add(key);}
    }else this.records.delete(key);
  }
  apply(step,property) {
    for(const patch of step.samples)this.put(patch.key,patch[property]);
    const setting=step.settings[property];
    if(setting)this.settings.set(step.id,Object.freeze({...setting}));else this.settings.delete(step.id);
    this.cachedSignature=null;for(const listener of this.listeners)listener();
  }
  onChanged(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  toJSON(){return {version:1,beds:[...this.settings].sort(([a],[b])=>a.localeCompare(b)).map(([id,s])=>({id,...s})),samples:[...this.records.values()].sort((a,b)=>a[1]-b[1]||a[0]-b[0])};}
  signature(){return this.cachedSignature??=JSON.stringify(this.toJSON());}
  get hasUnsavedChanges(){return this.signature()!==this.savedSignature;}
  snapshot(){return {value:this.toJSON(),signature:this.signature()};}
  commit(snapshot){this.savedSignature=snapshot.signature;}
}
