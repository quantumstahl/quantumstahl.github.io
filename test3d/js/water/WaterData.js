// Authored definitions only. No terrain owners, GPU objects or derived meshes.
import {lakeBoundary} from "./LakeBoundary.js";
const fail = message => { throw new Error(`Invalid water data: ${message}`); };
const number = (value, min, max, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(name);
  return value;
};
export const DEFAULT_WATER_STYLE = Object.freeze({ color: "#238fa3", opacity: .82, waveStrength: .65, flowSpeed: .7, foam: .35, depthTint: .25 });
export const DEFAULT_WATERFALL = Object.freeze({width:6,curvature:.65,heading:0,turbulence:.6,mist:.2,spray:.25,overlap:.35});
export const DEFAULT_WATERFALL_STYLE=Object.freeze({...DEFAULT_WATER_STYLE,color:"#66bac6",opacity:.9,flowSpeed:1.2,foam:.65});
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
function touches(a, b, c, d) {
  const on = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-7 && r.x >= Math.min(p.x, q.x) - 1e-7 && r.x <= Math.max(p.x, q.x) + 1e-7 && r.z >= Math.min(p.z, q.z) - 1e-7 && r.z <= Math.max(p.z, q.z) + 1e-7;
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
export function validateLakeBoundary(points, minSpacing=.1) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) < minSpacing) fail("boundary points must be at least 0.1 m apart");
    area += a.x * b.z - b.x * a.z;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (touches(a, b, points[j], points[(j + 1) % points.length])) fail("lake boundary crosses itself");
    }
  }
  if (Math.abs(area) < 1) fail("lake boundary has no usable area");
}
export function normalizeWaterBody(value) {
  if (!value || typeof value.id !== "string" || !/^[\w-]{1,80}$/.test(value.id)) fail("body id");
  if (!["lake", "river", "waterfall"].includes(value.type)) fail("unsupported body type");
  const river = value.type === "river";
  const waterfall=value.type==="waterfall";
  if (!Array.isArray(value.points) || value.points.length < (river||waterfall ? 2 : 3) || value.points.length > (waterfall?32:256)) fail(`${value.type} has an invalid control point count`);
  const points = value.points.map(p => Object.freeze({ x: number(p?.x, -10000, 10000, "point X"), z: number(p?.z, -10000, 10000, "point Z"),
    ...(river||waterfall ? { y: number(p.y ?? 0, -1000, 1000, "point height offset"),...(river?{width: number(p.width ?? 16, 1, 512, "river width")}: {}) } : {}) }));
  let fall;
  if(waterfall) {
    fall={...DEFAULT_WATERFALL,...value.fall};
    for(const [key,min,max] of [["width",.5,64],["curvature",0,1],["heading",0,360],["turbulence",0,1],["mist",0,1],["spray",0,1],["overlap",0,2]])number(fall[key],min,max,`waterfall ${key}`);
    fall=Object.freeze(Object.fromEntries(Object.keys(DEFAULT_WATERFALL).map(key=>[key,fall[key]])));
    for(let i=1;i<points.length;i++)if(points[i-1].y-points[i].y<.1)fail("waterfall points must descend from upper to lower (at least 0.1 m per interval)");
    if(points[0].y-points.at(-1).y<.25||points[0].y-points.at(-1).y>1000)fail("waterfall drop must be 0.25–1000 m");
  } else if (river) {
    for (let i = 0; i < points.length - 1; i++) {
      if (Math.hypot(points[i+1].x - points[i].x, points[i+1].z - points[i].z) < 1) fail("river points must be at least 1 m apart");
      for (let j = i + 2; j < points.length - 1; j++) if (touches(points[i], points[i+1], points[j], points[j+1])) fail("river centerline crosses itself");
    }
  } else {
    validateLakeBoundary(points);
    if(value.roundness!==undefined) {
      number(value.roundness,0,1,"shore roundness");
      if(value.roundness>0)validateLakeBoundary(lakeBoundary({points,roundness:value.roundness}),1e-7);
    }
  }
  const style = { ...(waterfall?DEFAULT_WATERFALL_STYLE:DEFAULT_WATER_STYLE), ...value.style };
  if (typeof style.color !== "string" || !/^#[0-9a-f]{6}$/i.test(style.color)) fail("color");
  for (const [key, max] of [["opacity", 1], ["waveStrength", 2], ["flowSpeed", 10], ["foam", 1], ["depthTint", 1]]) number(style[key], 0, max, key);
  const flowDirection = value.flowDirection ?? 1;
  if (river && ![1, -1].includes(flowDirection)) fail("flow direction");
  return Object.freeze({ id: value.id, type: value.type, name: String(value.name ?? (waterfall?"Waterfall":river ? "River" : "Lake")).slice(0, 80), elevation: number(value.elevation, -1000, 4000, "elevation"), points: Object.freeze(points), ...(waterfall?{fall}:river ? { flowDirection } : value.roundness!==undefined?{roundness:value.roundness}:{}), style: Object.freeze(Object.fromEntries(Object.keys(DEFAULT_WATER_STYLE).map(key => [key, style[key]]))) });
}
export class WaterData {
  constructor(bodies = []) {
    if (bodies.length > 2048) fail("too many bodies");
    this.records = new Map();
    this.listeners = new Set();
    this.cachedSignature = null;
    for (const body of bodies) {
      const record = normalizeWaterBody(body);
      if (this.records.has(record.id)) fail("duplicate body id");
      this.records.set(record.id, record);
    }
    this.savedSignature = this.signature();
  }
  static fromJSON(value) {
    if (value === undefined) return new WaterData();
    if (!value || value.version !== 1 || !Array.isArray(value.bodies) || value.bodies.length > 2048) fail("unsupported collection");
    return new WaterData(value.bodies);
  }
  get bodies() { return [...this.records.values()]; }
  get(id) { return this.records.get(id) ?? null; }
  set(id, body) {
    const next = body === null ? null : normalizeWaterBody({ ...body, id });
    if (JSON.stringify(next) === JSON.stringify(this.get(id))) return false;
    if (next) {
      if (!this.records.has(id) && this.records.size >= 2048) fail("too many bodies");
      this.records.set(id, next);
    } else this.records.delete(id);
    this.cachedSignature = null;
    for (const listener of this.listeners) listener(id);
    return true;
  }
  onChanged(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  toJSON() { return { version: 1, bodies: this.bodies }; }
  signature() { return this.cachedSignature ??= JSON.stringify(this.bodies.sort((a, b) => a.id.localeCompare(b.id))); }
  get hasUnsavedChanges() { return this.signature() !== this.savedSignature; }
  snapshot() { return { value: this.toJSON(), signature: this.signature() }; }
  commit(snapshot) { this.savedSignature = snapshot.signature; }
}
