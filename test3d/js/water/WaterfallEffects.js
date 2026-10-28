import * as THREE from "three";
import {WATERFALL_FADE_START,WATERFALL_DRAW_DISTANCE} from "./WaterfallVisibility.js";

// One tiny batch per impact: a ground foam patch, three splash glints,
// three mist puffs and six optional spray drops. Animation is entirely GPU-side.
export function buildWaterfallEffects(body,path) {
  const endpoint=body.points.at(-1),position=[],corners=[],data=[],flow=[],index=[];
  const scale=THREE.MathUtils.clamp(Math.sqrt(body.fall.width*path.drop)/12,.45,2.6);
  const sizes=[body.fall.width*.65+Math.min(path.drop*.035,2),.18*scale,(.9+scale),.045+.04*scale];
  const kinds=[0,1,1,1,2,2,2,3,3,3,3,3,3];
  for(let quad=0;quad<kinds.length;quad++) {
    const kind=kinds[quad],seed=(quad*.61803398875+path.phase/(Math.PI*2))%1;
    for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      position.push(endpoint.x,body.elevation+endpoint.y+.04,endpoint.z);
      corners.push(x,y);data.push(kind,seed,sizes[kind],0);flow.push(path.direction.x,path.direction.z,body.fall.width,scale);
    }
    const i=quad*4;index.push(i,i+1,i+2,i,i+2,i+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(position,3));geometry.setAttribute("fxCorner",new THREE.Float32BufferAttribute(corners,2));
  geometry.setAttribute("fxData",new THREE.Float32BufferAttribute(data,4));geometry.setAttribute("fxFlow",new THREE.Float32BufferAttribute(flow,4));geometry.setIndex(index);
  const radius=body.fall.width*1.4+12;
  geometry.boundingBox=new THREE.Box3(new THREE.Vector3(endpoint.x-radius,body.elevation+endpoint.y-4,endpoint.z-radius),new THREE.Vector3(endpoint.x+radius,body.elevation+endpoint.y+18,endpoint.z+radius));
  geometry.boundingSphere=new THREE.Sphere();geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
  return geometry;
}
export function updateWaterfallEffects(geometry,body) {
  const attribute=geometry.getAttribute("fxData"),scale=geometry.getAttribute("fxFlow").getW(0);
  const intensity=Math.min(1.5,.5+scale*.5);
  for(let i=0;i<attribute.count;i++) {const kind=attribute.getX(i);attribute.setW(i,(kind<1.5?body.style.foam:kind<2.5?body.fall.mist:body.fall.spray)*intensity);}
  attribute.needsUpdate=true;
}
export function createWaterfallEffectsMaterial(time) {
  return new THREE.ShaderMaterial({name:"MaxWorld waterfall impact",transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,uniforms:{uTime:time},
    vertexShader:`
      attribute vec2 fxCorner; attribute vec4 fxData; attribute vec4 fxFlow;
      uniform float uTime;
      varying vec2 vUv; varying float vKind; varying float vAge; varying float vAmount;
      void main(){
        float kind=fxData.x, seed=fxData.y, size=fxData.z, scale=fxFlow.w;
        vec3 direction=vec3(fxFlow.x,0.0,fxFlow.y), side=vec3(fxFlow.y,0.0,-fxFlow.x);
        vec3 center=position, p;
        vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
        vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
        float age=fract(uTime*(kind<1.5?.65:kind<2.5?.17:.55)+seed*3.73);
        float cutoff=kind<1.5?500.0:kind<2.5?240.0:180.0;
        float viewDistance=distance(cameraPosition,position);
        // The impact foam remains with the distant sheet. Small animated
        // mist/spray/glints retain their existing local detail ranges.
        float visible=kind<.5
          ?1.0-smoothstep(${WATERFALL_FADE_START.toFixed(1)},${WATERFALL_DRAW_DISTANCE.toFixed(1)},viewDistance)
          :1.0-smoothstep(cutoff*.6,cutoff,viewDistance);
        if(kind<.5){
          p=center+direction*max(.15,fxFlow.z*.1)+side*fxCorner.x*size+direction*fxCorner.y*size*.75;
          age=0.0;
        }else{
          float lateral=(seed-.5)*fxFlow.z;
          if(kind<1.5){center+=side*lateral*.7+direction*age*(.5+scale);center.y+=sin(age*3.14159265)*1.3*scale;}
          else if(kind<2.5){center+=side*lateral*.7+direction*age*scale*2.2;center.y+=(.25+age*3.0)*scale;size*=.6+age*.8;}
          else {center+=side*lateral*(.3+age*.3)+direction*age*(1.0+scale)*(.5+seed);center.y+=4.0*age*(1.0-age)*(.7+scale)*(.6+seed);}
          vec2 aspect=kind<1.5?vec2(1.7,.45):kind<2.5?vec2(1.0):vec2(.65,1.8);
          p=center+(right*fxCorner.x*aspect.x+up*fxCorner.y*aspect.y)*size;
        }
        vUv=fxCorner;vKind=kind;vAge=age;vAmount=fxData.w*visible;
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
        if(vAmount<.001)gl_Position=vec4(2.0,2.0,2.0,1.0);
      }`,
    fragmentShader:`
      uniform float uTime;
      varying vec2 vUv; varying float vKind; varying float vAge; varying float vAmount;
      void main(){
        float radius=length(vUv),alpha;
        vec3 color=vec3(.82,.94,.92);
        if(vKind<.5){
          float angle=atan(vUv.y,vUv.x);
          float edge=1.0-smoothstep(.62,1.0,radius+.035*sin(angle*7.0+uTime));
          float core=exp(-dot(vUv,vUv)*7.0);
          float ring=smoothstep(.6,.98,sin(radius*21.0-uTime*4.0+sin(angle*3.0)*1.3));
          float foamMask=smoothstep(-.35,.65,sin(angle*5.0+radius*7.0-uTime*.7));
          alpha=(core*.7+ring*foamMask*.4)*edge*vAmount;
          color=mix(vec3(.43,.73,.74),vec3(.9,.98,.93),min(1.0,core+ring*.4));
        }else if(vKind<1.5){alpha=(1.0-smoothstep(.1,1.0,radius))*sin(vAge*3.14159265)*vAmount*.8;}
        else if(vKind<2.5){
          float cloud=max(0.0,1.0-dot(vUv,vUv));
          cloud*=cloud*(.8+.2*sin(vUv.x*5.7+sin(vUv.y*4.1)+vAge*2.0));
          alpha=cloud*sin(vAge*3.14159265)*vAmount*.16;
        }else{alpha=(1.0-smoothstep(.15,1.0,radius))*sin(vAge*3.14159265)*vAmount*.8;}
        if(alpha<.003)discard;
        gl_FragColor=vec4(color,min(.95,alpha));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
