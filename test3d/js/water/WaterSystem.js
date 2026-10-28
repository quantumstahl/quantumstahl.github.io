import * as THREE from "three";
import { createEnvironmentUniforms, ENVIRONMENT_GLSL } from "../engine/EnvironmentShader.js";
import { applyRiverShoreProfile } from "./RiverShoreProfile.js";
import {lakeBoundary} from "./LakeBoundary.js";
import {WaterfallRenderer,buildWaterfallGeometry,updateWaterfallStyle} from "./Waterfall.js";

export function buildLakeGeometry(body) {
  body={...body,points:lakeBoundary(body)};
  const points = body.points.map(p => new THREE.Vector2(p.x, p.z));
  const faces = THREE.ShapeUtils.triangulateShape(points, []);
  const positions = [], uvs = [], shores = [];
  const isBoundary = (a, b) => {
    if (Math.abs(a-b) === 1 || Math.abs(a-b) === points.length-1) return true;
    // Earcut may skip a collinear authored point. That larger edge is still
    // shoreline if all skipped points lie on the same boundary segment.
    const p = points[a], q = points[b], length = p.distanceTo(q);
    for (const direction of [-1,1]) {
      let i = (a+direction+points.length)%points.length;
      while (i !== b) {
        const r = points[i], dot = (r.x-p.x)*(q.x-p.x)+(r.y-p.y)*(q.y-p.y);
        if (Math.abs((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x)) > 1e-6*length || dot < 0 || dot > length*length) break;
        i = (i+direction+points.length)%points.length;
      }
      if (i === b) return true;
    }
    return false;
  };
  for (const face of faces) {
    const p = face.map(i => body.points[i]);
    const twiceArea = Math.abs((p[1].x-p[0].x)*(p[2].z-p[0].z)-(p[1].z-p[0].z)*(p[2].x-p[0].x));
    const altitude = p.map((_, i) => {
      const a = p[(i+1)%3], b = p[(i+2)%3];
      return isBoundary(face[(i+1)%3], face[(i+2)%3]) ? twiceArea / Math.max(.0001, Math.hypot(b.x-a.x,b.z-a.z)) : -1;
    });
    for (let i = 0; i < 3; i++) {
      positions.push(p[i].x, body.elevation, p[i].z); uvs.push(p[i].x,p[i].z);
      // Interpolated distances to this triangle's authored boundary edges.
      // Internal triangulation edges never receive foam.
      shores.push(...altitude.map((a,j) => a < 0 ? 10000 : i === j ? a : 0));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("waterShore", new THREE.Float32BufferAttribute(shores, 3));
  geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
  geometry.computeBoundingSphere();
  return geometry;
}

// The same sampled centerline can later drive waterfalls, explicit carving or
// gameplay queries. Sampling happens only on definition changes, never in RAF.
export function sampleRiver(body, spacing = 6) {
  const controls = body.points.map(p => new THREE.Vector3(p.x, body.elevation + p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(controls, false, "centripetal");
  const counts = controls.slice(1).map((p,i) => Math.max(8,Math.ceil(p.distanceTo(controls[i])/spacing)));
  const desired = counts.reduce((a,b)=>a+b,0), budget = 8192-2*counts.length;
  if (desired > 8192) for(let i=0;i<counts.length;i++) counts[i]=2+Math.floor((counts[i]-2)*budget/(desired-2*counts.length));
  // Allocate samples by each segment's length, so one long interval among
  // short control-point intervals still receives the full spatial resolution.
  const parameters = [0];
  for(let segment=0;segment<counts.length;segment++) for(let j=1;j<=counts[segment];j++) parameters.push((segment+j/counts[segment])/counts.length);
  const samples = [], point = new THREE.Vector3(), tangent = new THREE.Vector3();
  let distance = 0;
  for (const t of parameters) {
    const controlT = t * (body.points.length - 1), segment = Math.min(body.points.length - 2, Math.floor(controlT));
    const f = controlT - segment, smooth = f * f * (3 - 2 * f);
    curve.getPoint(t, point); curve.getTangent(t, tangent);
    if (Math.hypot(tangent.x, tangent.z) < 1e-6) tangent.subVectors(controls[segment+1], controls[segment]);
    const horizontalLength = Math.hypot(tangent.x, tangent.z);
    const previous = samples.at(-1);
    if (previous) distance += Math.hypot(point.x-previous.x,point.y-previous.y,point.z-previous.z);
    samples.push({ x: point.x, y: point.y, z: point.z, nx: -tangent.z / horizontalLength, nz: tangent.x / horizontalLength,
      width: body.points[segment].width * (1 - smooth) + body.points[segment+1].width * smooth, distance });
  }
  // A ribbon wider than a bend's inner radius folds over itself. Limit just
  // those sections, preserving the authored widths and exposing a UI warning.
  applyRiverShoreProfile(samples,body.id);
  for (let i = 1; i < samples.length - 1; i++) {
    const p = samples[i], a = samples[i-1], b = samples[i+1];
    const angle = Math.acos(Math.max(-1, Math.min(1, a.nx*b.nx+a.nz*b.nz)));
    const radius = angle > 1e-5 ? (Math.hypot(p.x-a.x,p.z-a.z)+Math.hypot(b.x-p.x,b.z-p.z)) / angle : Infinity;
    p.authoredWidth = p.width; p.width = Math.min(p.width, Math.max(.25, radius * 1.5));
    const scale=p.width/p.authoredWidth;p.leftWidth*=scale;p.rightWidth*=scale;
  }
  return samples;
}
export function buildRiverGeometry(body) {
  const samples = sampleRiver(body), positions = [], uvs = [], shores = [], flowInfo = [], indices = [];
  const length = samples.at(-1).distance;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const previous=samples[Math.max(0,i-1)],next=samples[Math.min(samples.length-1,i+1)];
    const arc=Math.max(.01,next.distance-previous.distance);
    const turn=Math.atan2(previous.nx*next.nz-previous.nz*next.nx,previous.nx*next.nx+previous.nz*next.nz);
    const bend=Math.min(1,Math.abs(turn)*p.width/arc),slope=Math.min(1,Math.abs(next.y-previous.y)/arc*4);
    for (const side of [-1, 1]) {
      const offset=side<0?-p.leftWidth:p.rightWidth;
      positions.push(p.x + p.nx * offset, p.y, p.z + p.nz * offset);
      // Metres along the curve and across its width; never reset at tile edges.
      uvs.push(p.distance, offset);
      shores.push(side < 0 ? 0 : p.width, side < 0 ? p.width : 0, Math.min(p.distance, length-p.distance));
      // Flow axis follows the actual curve. Sparse foam gets a stronger cue
      // on steeper reaches and the outside of a bend, without terrain reads.
      flowInfo.push(p.nz,-p.nx,1,Math.min(1,.1+slope*.6+bend*(side*turn<0?.9:.15)));
    }
    if (i < samples.length - 1) { const a = i * 2; indices.push(a,a+2,a+1,a+1,a+2,a+3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute("waterShore", new THREE.Float32BufferAttribute(shores,3));
  geometry.setAttribute("waterFlowInfo",new THREE.Float32BufferAttribute(flowInfo,4));
  geometry.userData.narrowedSections = samples.filter(p => p.authoredWidth > p.width + .01).length;
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}
function addStyle(geometry, body) {
  const count = geometry.getAttribute("position").count;
  const color = new THREE.Color(body.style.color);
  const attribute = (name, size) => {
    let result = geometry.getAttribute(name);
    if (!result) { result = new THREE.BufferAttribute(new Float32Array(count * size), size); geometry.setAttribute(name, result); }
    result.needsUpdate = true; return result.array;
  };
  const colors = attribute("waterColor", 3), styles = attribute("waterStyle", 4);
  for (let i = 0; i < count; i++) {
    colors.set([color.r, color.g, color.b], i * 3);
    styles.set([body.style.opacity, body.style.waveStrength, body.style.flowSpeed * (body.flowDirection ?? 1), body.style.foam], i * 4);
  }
  attribute("waterDepthTint", 1).fill(body.style.depthTint);
  if (!geometry.getAttribute("waterFlowInfo")) {
    const flow=attribute("waterFlowInfo",4);
    for(let i=0;i<count;i++)flow.set([1,0,0,.15],i*4);
  }
}
export class WaterSystem {
  constructor(scene, data) {
    this.data = data;
    this.root = new THREE.Group(); this.root.name = "Authored water"; scene.add(this.root);
    this.waterfall=new WaterfallRenderer(this.root);
    this.meshes = new Map();
    this.stats = { bodies: 0, triangles: 0, rebuilds: 0, buildMs: 0, updateMs: 0 };
    // Reuses NextWorld's wave-slope, Fresnel and analytic sky ideas, without
    // its chunk ownership, background texture or environment dependencies.
    this.material = new THREE.ShaderMaterial({
      name: "MaxWorld stylized water", transparent: true, depthWrite: false,
      side: THREE.DoubleSide, forceSinglePass: true,
      uniforms: { ...createEnvironmentUniforms(), uTime: { value: 0 } },
      vertexShader: `
        attribute vec3 waterColor; attribute vec4 waterStyle; attribute vec3 waterShore; attribute float waterDepthTint; attribute vec4 waterFlowInfo;
        varying vec3 vWorld; varying vec2 vFlow; varying vec3 vColor; varying vec4 vStyle; varying vec3 vShore; varying float vDepthTint; varying vec4 vFlowInfo;
        void main() {
          vWorld = position; vFlow = uv; vColor = waterColor; vStyle = waterStyle; vShore = waterShore; vDepthTint = waterDepthTint; vFlowInfo = waterFlowInfo;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        ${ENVIRONMENT_GLSL}
        uniform float uTime;
        varying vec3 vWorld; varying vec2 vFlow; varying vec3 vColor; varying vec4 vStyle; varying vec3 vShore; varying float vDepthTint; varying vec4 vFlowInfo;
        void main() {
          float t = uTime * vStyle.z;
          vec2 p = vFlow;
          float viewDistance = distance(cameraPosition, vWorld);
          float waveFade = 1.0 - smoothstep(300.0, 1600.0, viewDistance);
          float a = p.x * .11 + p.y * .18 - t * .60;
          float b = p.x * .47 - p.y * .32 - t * 1.10 + sin(p.x * .039) * .25;
          float waveA = sin(a), waveB = sin(b);
          vec2 slope = (vec2(.11,.18) * cos(a) * .22 + vec2(.47,-.32) * cos(b) * .065) * vStyle.y * waveFade;
          vec2 axis = normalize(vFlowInfo.xy);
          vec2 worldSlope = axis * slope.x + vec2(-axis.y,axis.x) * slope.y;
          vec3 surfaceNormal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          if(surfaceNormal.y < 0.0) surfaceNormal = -surfaceNormal;
          vec3 normal = normalize(surfaceNormal + vec3(-worldSlope.x, 0.0, -worldSlope.y));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 4.0);
          float brightness = .91 + (.025 * waveA + .016 * waveB) * vStyle.y * waveFade;
          float edgeDistance = min(vShore.x, min(vShore.y, vShore.z));
          float riverDepth = smoothstep(.08,.85,2.0*min(vShore.x,vShore.y)/max(.1,vShore.x+vShore.y));
          float depth = mix(smoothstep(.5,12.0,edgeDistance),riverDepth,vFlowInfo.z);
          float colorDrift = .025 * sin(p.x * .023 + .3 * sin(p.x * .071));
          vec3 shallowColor = vColor * vec3(1.06,1.13,1.05);
          vec3 deepColor = vColor * (1.0 - vDepthTint * .9) * vec3(.87,.98,1.0);
          vec3 color = mix(shallowColor,deepColor,depth) * (brightness + colorDrift);
          color = mix(color, vec3(.49,.74,.85), .045 + fresnel * .28);
          vec3 halfDir = normalize(viewDir + normalize(uLightDirection));
          float specular = pow(max(dot(normal, halfDir), 0.0), 100.0);
          color += vec3(1.0,.94,.74) * specular * .20;
          float streak = smoothstep(.88,1.0,sin(p.y*.65+waveA*.25)) * smoothstep(.35,.85,sin(p.x*.17-t*.4));
          color += vec3(.013,.025,.025) * streak * vStyle.y * waveFade;
          float pixelWidth = max(.04, fwidth(edgeDistance));
          float foamPatch = smoothstep(.45,.88,sin(p.x*.085+.7*sin(p.x*.027)+p.y*.13));
          float foam = (1.0-smoothstep(.08,.65+pixelWidth,edgeDistance)) * foamPatch * vStyle.w * mix(.2,1.0,vFlowInfo.w);
          foam *= .85+.15*sin(t*.65+p.x*.3);
          color = mix(color,vec3(.65,.82,.78),foam*.75);
          float distanceFade = smoothstep(3000.0, 5200.0, viewDistance) * .42;
          color *= uEnvironmentTint;
          if (!uSkyFadeEnabled) color = mix(color, vec3(.39,.51,.59), distanceFade);
          color = environmentFog(color, vWorld, true);
          float alpha = vStyle.x * (.86+.12*depth+colorDrift*.3) + foam*.04;
          gl_FragColor = vec4(color,clamp(alpha,0.0,1.0)*smoothstep(0.0,max(.12,pixelWidth*.5),edgeDistance));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    for (const body of data.bodies) this.rebuild(body.id);
    this.unsubscribe = data.onChanged(id => this.rebuild(id));
  }
  rebuild(id) {
    const started = performance.now(), previous = this.meshes.get(id);
    const body = this.data.get(id);
    const geometryKey = body && JSON.stringify([body.type, body.elevation, body.points,body.roundness??0,...(body.type==="waterfall"?[body.fall.width,body.fall.curvature,body.fall.heading,body.fall.overlap]:[])]);
    if (previous && previous.userData.geometryKey === geometryKey) {
      if(body.type==="waterfall"){updateWaterfallStyle(previous.geometry,body);this.waterfall.sync(body,previous);}else addStyle(previous.geometry, body);
      previous.name = body.name; return;
    }
    // Build before disposing the previous mesh so a failed edit stays visible.
    const geometry = body ? (body.type==="waterfall"?buildWaterfallGeometry(body):body.type === "river" ? buildRiverGeometry(body) : buildLakeGeometry(body)) : null;
    this.waterfall.remove(id);
    if (previous) { this.stats.triangles -= previous.geometry.index.count / 3; previous.removeFromParent(); previous.geometry.dispose(); this.meshes.delete(id); }
    if (body) {
      if(body.type==="waterfall")updateWaterfallStyle(geometry,body);else addStyle(geometry, body);
      const mesh = new THREE.Mesh(geometry, body.type==="waterfall"?this.waterfall.material:this.material);
      mesh.name = body.name; mesh.userData.waterId = id;
      mesh.userData.geometryKey = geometryKey;
      this.root.add(mesh); this.meshes.set(id, mesh);
      if(body.type==="waterfall")this.waterfall.sync(body,mesh);
      this.stats.triangles += geometry.index.count / 3;
    }
    this.stats.bodies = this.meshes.size; this.stats.rebuilds++;
    this.stats.buildMs = performance.now() - started;
  }
  update(delta,camera) {
    const started = performance.now();
    this.material.uniforms.uTime.value += delta;
    this.waterfall.update(delta,camera);
    this.stats.updateMs = performance.now() - started;
  }
  dispose() {
    this.unsubscribe(); for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear(); this.root.removeFromParent(); this.material.dispose();
    this.waterfall.dispose();this.root.clear();
  }
}
