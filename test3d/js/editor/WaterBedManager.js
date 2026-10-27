import {bedKey} from "../water/WaterBedData.js";

// Replaces one owner's bed as a single transaction. Overlapping water bodies
// share an original height; removing one preserves all other contributions.
export class WaterBedManager {
  constructor(sculptor,data,carver){Object.assign(this,{sculptor,data,carver,provider:sculptor.provider});}
  heightWithout(id,x,z) {
    const current=this.provider.sampleHeight(x,z),row=this.data.records.get(bedKey(x,z));
    if(!row||current!==row[3])return current;
    return Math.min(row[2],...row[4].filter(([owner])=>owner!==id).map(([,h])=>h));
  }
  plan(id,options,builder=null) {
    const started=performance.now();
    const raw=builder?builder((x,z)=>this.heightWithout(id,x,z)):null;
    const targets=new Map([...(raw?.targets?.values()??[])].map(p=>[bedKey(p.x,p.z),p]));
    const keys=new Set([...(this.data.ownerKeys.get(id)??[]),...targets.keys()]);
    const regions=keys.size?this.carver.protectedRegions():[],samples=[],heights=[];
    const previousSettings=this.data.settings.get(id)??null;
    const allowRockify=Boolean(options?.allowRockify||previousSettings?.allowRockify);
    let preserved=0,restored=0;
    for(const key of keys) {
      const old=this.data.records.get(key)??null,p=targets.get(key);
      const x=p?.x??old[0],z=p?.z??old[1],current=this.provider.sampleHeight(x,z);
      const protectedPoint=!allowRockify&&this.carver.isProtected(x,z,regions);
      const edited=old&&current!==old[3];
      let after=null,height=current;
      if(protectedPoint)preserved++;
      else {
        if(edited)preserved++;
        const active=edited?null:old,base=active?.[2]??current;
        const owners=(active?.[4]??[]).filter(([owner])=>owner!==id).map(pair=>[...pair]);
        if(p&&Math.fround(p.target)<base)owners.push([id,Math.fround(p.target)]);
        owners.sort(([a],[b])=>a.localeCompare(b));
        height=Math.min(base,...owners.map(([,h])=>h));
        if(owners.length)after=[x,z,base,height,owners];
      }
      if(JSON.stringify(old)!==JSON.stringify(after))samples.push({key,before:old,after});
      if(height!==current){heights.push({type:"height",x,z,before:current,after:height});if(height>current)restored++;}
    }
    const settings={before:previousSettings,after:options?{depth:options.depth,bankWidth:options.bankWidth,...(options.allowRockify?{allowRockify:true}:{})}:null};
    const recordCount=this.data.records.size+samples.reduce((n,p)=>n+Number(Boolean(p.after))-Number(Boolean(p.before)),0);
    const contributions=this.data.contributionCount+samples.reduce((n,p)=>n+(p.after?.[4].length??0)-(p.before?.[4].length??0),0);
    if(recordCount>1000000||contributions>2000000)throw new Error("Waterbed restoration data exceeds its sample limit. Use smaller beds.");
    return {id,samples,heights,settings,rockifyState:this.carver.snapshotRockify(regions),stats:{...raw?.stats,changed:heights.length,restored,preserved,planMs:performance.now()-started}};
  }
  applyHistory(step,property) {
    this.sculptor.applyHistory(step.heights,property);
    this.data.apply(step,property);
  }
  apply(step) {
    const started=performance.now();
    for(const patch of step.samples)if(JSON.stringify(this.data.records.get(patch.key)??null)!==JSON.stringify(patch.before))throw new Error("Waterbeds changed. Preview or apply the bed again.");
    if(JSON.stringify(this.data.settings.get(step.id)??null)!==JSON.stringify(step.settings.before))throw new Error("Waterbed settings changed. Preview or apply the bed again.");
    if(step.heights.length)this.carver.assertRockifyUnchanged(step.rockifyState);
    for(const e of step.heights)if(this.provider.sampleHeight(e.x,e.z)!==e.before)throw new Error("Terrain changed. Preview or apply the waterbed again.");
    this.applyHistory(step,"after");
    return {...step.stats,applyMs:performance.now()-started};
  }
  hasChanges(step){return step.samples.length>0||step.heights.length>0||JSON.stringify(step.settings.before)!==JSON.stringify(step.settings.after);}
}
