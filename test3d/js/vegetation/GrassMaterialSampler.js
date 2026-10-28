import { TERRAIN_TILE_SIZE, TERRAIN_TILE_SEGMENTS } from "../terrain/TerrainDataProvider.js";

// Grass reads fixed source-grid vertices. Hydrating a complete 129x129x8
// Float32 material owner for its first eight weights caused measurable cold
// stalls. Read just those eight already-validated packed bytes when an owner
// is not resident; live/unsaved Float32 owners always take precedence.
export class GrassMaterialSampler {
  constructor(data) {this.data=data;this.records=new Map();}
  sample(x,z,target) {
    const tx=Math.floor(x/TERRAIN_TILE_SIZE),tz=Math.floor(z/TERRAIN_TILE_SIZE),key=`${tx},${tz}`;
    const spacing=TERRAIN_TILE_SIZE/TERRAIN_TILE_SEGMENTS;
    const gx=Math.round((x-tx*TERRAIN_TILE_SIZE)/spacing),gz=Math.round((z-tz*TERRAIN_TILE_SIZE)/spacing);
    const offset=(gz*(TERRAIN_TILE_SEGMENTS+1)+gx)*8;
    const tile=this.data.cache.get(key);
    if(tile) {for(let i=0;i<8;i++)target[i]=tile.weights[offset+i];return target;}
    const serialized=this.data.records.get(key);
    if(!serialized) {target.fill(0);return target;}
    let record=this.records.get(key);
    if(!record || record.serialized!==serialized) {
      record={serialized,weights:JSON.parse(serialized).weights};
      this.records.delete(key);this.records.set(key,record);
      if(this.records.size>16)this.records.delete(this.records.keys().next().value);
    }
    const first=Math.floor(offset/3),skip=offset-first*3;
    const binary=atob(record.weights.slice(first*4,(first+Math.ceil((skip+8)/3))*4));
    for(let i=0;i<8;i++)target[i]=binary.charCodeAt(skip+i)/255;
    return target;
  }
  dispose(){this.records.clear();}
}
