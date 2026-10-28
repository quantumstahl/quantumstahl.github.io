import * as THREE from "three";
import { createEnvironmentUniforms, ENVIRONMENT_GLSL } from "../engine/EnvironmentShader.js";
import {sampleWaterfall} from "./WaterfallPath.js";
import {buildWaterfallEffects,updateWaterfallEffects,createWaterfallEffectsMaterial} from "./WaterfallEffects.js";
import {WATERFALL_FADE_START,WATERFALL_DRAW_DISTANCE} from "./WaterfallVisibility.js";

export function buildWaterfallGeometry(body) {
  const path=sampleWaterfall(body),columns=Math.max(2,Math.min(12,Math.ceil(body.fall.width/1.5)));
  const position=[],uv=[],shape=[],normals=[],index=[];
  for(let row=0;row<path.samples.length;row++) {
    const p=path.samples[row];
    for(let col=0;col<=columns;col++) {
      const u=col/columns,across=(u-.5)*p.width;
      const ripple=Math.sin(u*Math.PI)*Math.sin(p.distance*.55+path.phase)*.035*Math.sin(Math.PI*p.progress);
      position.push(p.x+path.side.x*across+path.direction.x*ripple,p.y,p.z+path.side.z*across+path.direction.z*ripple);
      uv.push((u-.5)*body.fall.width,p.distance);shape.push(p.progress,body.fall.width,path.drop,u);normals.push(path.direction.x,0,path.direction.z);
      if(row<path.samples.length-1&&col<columns){const a=row*(columns+1)+col,b=a+columns+1;index.push(a,b,a+1,a+1,b,b+1);}
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute("fallShape",new THREE.Float32BufferAttribute(shape,4));geometry.setAttribute("fallNormal",new THREE.Float32BufferAttribute(normals,3));geometry.setIndex(index);
  geometry.computeBoundingBox();geometry.boundingBox.expandByScalar(.2);geometry.boundingSphere=new THREE.Sphere();geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
  geometry.userData.path=path;return geometry;
}

export function updateWaterfallStyle(geometry,body) {
  const count=geometry.getAttribute("position").count,color=new THREE.Color(body.style.color);
  for(const [name,size] of [["fallColor",3],["fallStyle",4]])if(!geometry.getAttribute(name))geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(count*size),size));
  const colors=geometry.getAttribute("fallColor"),style=geometry.getAttribute("fallStyle");
  for(let i=0;i<count;i++){colors.setXYZ(i,color.r,color.g,color.b);style.setXYZW(i,body.style.opacity,body.style.waveStrength,body.style.flowSpeed,body.fall.turbulence);}
  colors.needsUpdate=style.needsUpdate=true;
}

export class WaterfallRenderer {
  constructor(root) {
    this.root=root;this.records=new Map();this.time={value:0};
    this.effectsMaterial=createWaterfallEffectsMaterial(this.time);
    this.material=new THREE.ShaderMaterial({name:"MaxWorld flowing waterfall",side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthWrite:false,
      uniforms:{...createEnvironmentUniforms(),uTime:this.time},
      vertexShader:`
        attribute vec4 fallShape; attribute vec3 fallNormal; attribute vec3 fallColor; attribute vec4 fallStyle;
        varying vec2 vFlow; varying vec4 vShape; varying vec3 vColor; varying vec4 vStyle; varying vec3 vWorld;
        uniform float uTime;
        void main(){
          float window=sin(3.14159265*fallShape.x);
          float motion=sin(uv.y*.7-uTime*fallStyle.z*2.0+uv.x*.8)*.055*fallStyle.y*window;
          vec3 p=position+fallNormal*motion;
          vWorld=p;vFlow=uv;vShape=fallShape;vColor=fallColor;vStyle=fallStyle;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
        }`,
      fragmentShader:`
        ${ENVIRONMENT_GLSL}
        uniform float uTime;
        varying vec2 vFlow; varying vec4 vShape; varying vec3 vColor; varying vec4 vStyle; varying vec3 vWorld;
        void main(){
          float t=uTime*vStyle.z, u=vFlow.x, v=vFlow.y;
          float distortion=.15*sin(v*.33-t*1.7)+.06*sin(u*2.1+v*.16-t*.6);
          float lanes=pow(.5+.5*sin(u*5.2+distortion),3.0);
          float pulses=.5+.5*sin(v*1.7-t*8.0+u*1.9);
          float fine=smoothstep(.5,.95,sin(u*9.4+v*.23-t*.6))*smoothstep(-.4,.8,sin(v*2.8-t*12.0+u*2.1));
          float energy=smoothstep(.62,1.0,vShape.x)*vStyle.w;
          float white=clamp(.16+lanes*(.3+pulses*.24)+fine*.2+energy*(.15+.12*sin(v*3.0-t*9.0)),0.0,.88);
          vec3 color=mix(vColor*vec3(.62,.9,.98),vec3(.87,.97,.95),white);
          float edge=min(vShape.w,1.0-vShape.w);
          float broken=.012*sin(v*1.1-t*2.0+u*1.7)+.008*sin(v*2.7-t*3.0);
          float alpha=smoothstep(.002,.05+fwidth(edge),edge+broken)*vStyle.x*(.9+.1*lanes);
          float distanceToCamera=distance(cameraPosition,vWorld);
          color *= uEnvironmentTint;
          if (!uSkyFadeEnabled) color=mix(color,vec3(.39,.51,.59),smoothstep(1800.0,4000.0,distanceToCamera)*.42);
          color = environmentFog(color, vWorld, true);
          alpha*=1.0-smoothstep(${WATERFALL_FADE_START.toFixed(1)},${WATERFALL_DRAW_DISTANCE.toFixed(1)},distanceToCamera);
          if(alpha<.003)discard;
          gl_FragColor=vec4(color,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }
  sync(body,mesh){
    let record=this.records.get(body.id);
    if(!record){
      const geometry=buildWaterfallEffects(body,mesh.geometry.userData.path),effects=new THREE.Mesh(geometry,this.effectsMaterial);
      effects.name=`${body.name} impact`;effects.renderOrder=1;this.root.add(effects);record={mesh,effects};this.records.set(body.id,record);
    }
    updateWaterfallEffects(record.effects.geometry,body);
    record.hasEffects=body.style.foam>0||body.fall.mist>0||body.fall.spray>0;record.effects.visible=record.hasEffects;
  }
  remove(id){const record=this.records.get(id);if(record){record.effects.removeFromParent();record.effects.geometry.dispose();this.records.delete(id);}}
  update(delta,camera) {
    this.time.value+=delta;
    if(camera)for(const {mesh,effects,hasEffects} of this.records.values()){
      const sphere=mesh.geometry.boundingSphere;mesh.visible=camera.position.distanceToSquared(sphere.center)<=(WATERFALL_DRAW_DISTANCE+sphere.radius)**2;
      const impact=effects.geometry.boundingSphere;effects.visible=hasEffects&&camera.position.distanceToSquared(impact.center)<=(WATERFALL_DRAW_DISTANCE+impact.radius)**2;
    }
  }
  getStats(){return {falls:this.records.size,effectTriangles:this.records.size*26,visibleSheets:[...this.records.values()].filter(r=>r.mesh.visible).length,visibleEffects:[...this.records.values()].filter(r=>r.effects.visible).length};}
  dispose(){for(const id of this.records.keys())this.remove(id);this.material.dispose();this.effectsMaterial.dispose();}
}
