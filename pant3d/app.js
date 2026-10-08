import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = selector => document.querySelector(selector);
const canvas=$("#canvas"), viewport=$("#viewport"), outliner=$("#outliner"), status=$("#status");
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x59758d); scene.fog=new THREE.Fog(0x59758d,40,110);
const camera=new THREE.PerspectiveCamera(55,1,.1,500); camera.position.set(9,7,10);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const orbit=new OrbitControls(camera,canvas); orbit.target.set(0,1,0); orbit.enableDamping=true; orbit.maxDistance=80; orbit.mouseButtons.LEFT=null; orbit.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
const transform=new TransformControls(camera,canvas); transform.addEventListener("mouseDown",()=>{if(selected)gizmoStartTransform={object:selected,position:selected.position.clone(),rotation:selected.rotation.clone(),scale:selected.scale.clone()};}); transform.addEventListener("dragging-changed",e=>{orbit.enabled=!e.value;if(!e.value){gizmoScaleDrag=null;commit();}}); transform.addEventListener("objectChange",()=>{if(!selected)return;if(activeTool==="scale"&&transform.axis==="XYZ"&&gizmoScaleDrag){const factor=THREE.MathUtils.clamp(1+(gizmoScaleDrag.startY-gizmoScaleDrag.lastY)*.01,.05,20);selected.scale.copy(gizmoScaleDrag.scale).multiplyScalar(factor);}keepAboveGround(selected);updateSelectionHelper();updateInspector();}); scene.add(transform.getHelper());
const selectionHelper=new THREE.BoxHelper(new THREE.Object3D(),0x00e5ff);selectionHelper.material.depthTest=false;selectionHelper.material.transparent=true;selectionHelper.material.opacity=.9;selectionHelper.renderOrder=10;selectionHelper.visible=false;selectionHelper.userData.editorOnly=true;scene.add(selectionHelper);
const groupSelectionHelper=new THREE.Box3Helper(new THREE.Box3(),0xff9f1c);groupSelectionHelper.material.depthTest=false;groupSelectionHelper.material.transparent=true;groupSelectionHelper.material.opacity=.95;groupSelectionHelper.renderOrder=12;groupSelectionHelper.visible=false;groupSelectionHelper.userData.editorOnly=true;scene.add(groupSelectionHelper);
const groupMemberHelpers=new Map();
const snapPointHelper=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0xffd34f,size:6,sizeAttenuation:false,depthTest:false,depthWrite:false,transparent:true,opacity:.9}));snapPointHelper.renderOrder=11;snapPointHelper.visible=false;snapPointHelper.userData.editorOnly=true;scene.add(snapPointHelper);
const activeSnapPointHelper=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0x00e5ff,size:11,sizeAttenuation:false,depthTest:false,depthWrite:false}));activeSnapPointHelper.renderOrder=12;activeSnapPointHelper.visible=false;activeSnapPointHelper.userData.editorOnly=true;scene.add(activeSnapPointHelper);
const middleSnapPointHelper=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0xff8a24,size:9,sizeAttenuation:false,depthTest:false,depthWrite:false}));middleSnapPointHelper.renderOrder=12;middleSnapPointHelper.visible=false;middleSnapPointHelper.userData.editorOnly=true;scene.add(middleSnapPointHelper);
scene.add(new THREE.HemisphereLight(0xe9f5ff,0x24382b,2.5)); const sun=new THREE.DirectionalLight(0xffffff,3); sun.position.set(18,28,16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-42;sun.shadow.camera.right=42;sun.shadow.camera.top=42;sun.shadow.camera.bottom=-42;sun.shadow.camera.near=.5;sun.shadow.camera.far=80;sun.shadow.bias=-0.00002;sun.shadow.normalBias=.04;sun.target.position.set(0,0,0);scene.add(sun);scene.add(sun.target);
const grid=new THREE.GridHelper(80,80,0x58796a,0x425a50);scene.add(grid);const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.ShadowMaterial({color:0x14202a,opacity:.3}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.userData.editorOnly=true;scene.add(ground);
const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2(), animationClock=new THREE.Clock(), movementKeys=new Set(); let roots=[],selected=null,selection=new Set(),sequence=1,groupSequence=1,subgroupSequence=1,nextId=1,undoStack=[],redoStack=[],editing=false,activeTool="select",snapEnabled=false,animations=[{id:"animation-1",name:"Animation 1",duration:2,playback:"loop",keyframes:[]}],activeAnimationId="animation-1",animation=animations[0],animationIdSequence=2,animationTime=0,playbackDirection=1,isPlaying=false,animationMode=false,animationBasePose=null,objectDrag=null,gizmoStartTransform=null,gizmoScaleDrag=null;
function addUniqueAxis(list, axis) {
    if (axis.lengthSq() < 1e-10) return;

    const n = axis.clone().normalize();

    for (const existing of list) {
        if (Math.abs(existing.dot(n)) > 0.9999) return;
    }

    list.push(n);
}


function convexWorldData(object) {
    object.updateWorldMatrix(true, true);

    const vertices = new Map();
    const normals = [];
    const edgeMap = new Map();

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();

    const keyFor = v => {
        const q = 100000;
        return (
            Math.round(v.x * q) + "," +
            Math.round(v.y * q) + "," +
            Math.round(v.z * q)
        );
    };

    object.traverse(node => {
        if (!node.isMesh || !node.geometry?.attributes.position) return;

        const pos = node.geometry.attributes.position;
        const index = node.geometry.index;

        const triangle = (ia, ib, ic) => {
            a.fromBufferAttribute(pos, ia).applyMatrix4(node.matrixWorld);
            b.fromBufferAttribute(pos, ib).applyMatrix4(node.matrixWorld);
            c.fromBufferAttribute(pos, ic).applyMatrix4(node.matrixWorld);

            const points = [a.clone(), b.clone(), c.clone()];
            const keys = points.map(keyFor);

            for (let i = 0; i < 3; i++) {
                if (!vertices.has(keys[i]))
                    vertices.set(keys[i], points[i]);
            }

            const normal = b.clone()
                .sub(a)
                .cross(c.clone().sub(a));

            if (normal.lengthSq() < 1e-10) return;

            normal.normalize();
            addUniqueAxis(normals, normal);

            const addEdge = (i, j) => {
                const k1 = keys[i];
                const k2 = keys[j];

                const edgeKey =
                    k1 < k2
                        ? k1 + "|" + k2
                        : k2 + "|" + k1;

                let edge = edgeMap.get(edgeKey);

                if (!edge) {
                    edge = {
                        a: points[i].clone(),
                        b: points[j].clone(),
                        normals: []
                    };

                    edgeMap.set(edgeKey, edge);
                }

                edge.normals.push(normal.clone());
            };

            addEdge(0, 1);
            addEdge(1, 2);
            addEdge(2, 0);
        };

        if (index) {
            for (let i = 0; i < index.count; i += 3) {
                triangle(
                    index.getX(i),
                    index.getX(i + 1),
                    index.getX(i + 2)
                );
            }
        } else {
            for (let i = 0; i < pos.count; i += 3)
                triangle(i, i + 1, i + 2);
        }
    });


    // Bara riktiga polygonkanter.
    // Trianguleringsdiagonaler på platta ytor ignoreras.
    const edges = [];

    for (const edge of edgeMap.values()) {
        let realEdge = edge.normals.length < 2;

        if (!realEdge) {
            for (let i = 0; i < edge.normals.length && !realEdge; i++) {
                for (let j = i + 1; j < edge.normals.length; j++) {
                    if (
                        Math.abs(
                            edge.normals[i].dot(edge.normals[j])
                        ) < 0.9999
                    ) {
                        realEdge = true;
                        break;
                    }
                }
            }
        }

        if (realEdge)
            addUniqueAxis(
                edges,
                edge.b.clone().sub(edge.a)
            );
    }

    return {
        vertices: [...vertices.values()],
        normals,
        edges
    };
}


function projectionRange(vertices, axis) {
    let min = Infinity;
    let max = -Infinity;

    for (const vertex of vertices) {
        const p = vertex.dot(axis);
        min = Math.min(min, p);
        max = Math.max(max, p);
    }

    return { min, max };
}
function sweepToContact(target, moving, moveDirection) {
    const A = convexWorldData(target);
    const B = convexWorldData(moving);

    const direction = moveDirection.clone().normalize();

    const axes = [];

    for (const n of A.normals) addUniqueAxis(axes, n);
    for (const n of B.normals) addUniqueAxis(axes, n);

    const cross = new THREE.Vector3();

    for (const ea of A.edges) {
        for (const eb of B.edges) {
            cross.crossVectors(ea, eb);
            addUniqueAxis(axes, cross);
        }
    }

    let enter = -Infinity;
    let exit = Infinity;

    const EPS = 1e-7;

    for (const axis of axes) {
        const ar = projectionRange(A.vertices, axis);
        const br = projectionRange(B.vertices, axis);

        const speed = direction.dot(axis);

        // Ingen rörelse längs denna SAT-axel.
        if (Math.abs(speed) < EPS) {
            if (
                br.max < ar.min - EPS ||
                ar.max < br.min - EPS
            ) {
                // De är separerade på en axel som vår rörelse
                // aldrig kan stänga.
                return null;
            }

            continue;
        }

        const t1 = (ar.min - br.max) / speed;
        const t2 = (ar.max - br.min) / speed;

        const axisEnter = Math.min(t1, t2);
        const axisExit = Math.max(t1, t2);

        enter = Math.max(enter, axisEnter);
        exit = Math.min(exit, axisExit);

        if (enter > exit + EPS)
            return null;
    }

    if (exit < 0)
        return null;

    return Math.max(0, enter);
}
function moveObjectWorld(object, delta) {
    const worldPosition =
        object.getWorldPosition(new THREE.Vector3());

    worldPosition.add(delta);

    if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        object.parent.worldToLocal(worldPosition);
    }

    object.position.copy(worldPosition);
    object.updateWorldMatrix(true, true);
}
function closeAabbSnapGap(object, target) {
    const movingCenter = new THREE.Box3()
        .setFromObject(object)
        .getCenter(new THREE.Vector3());
    const targetCenter = new THREE.Box3()
        .setFromObject(target)
        .getCenter(new THREE.Vector3());
    const direction = targetCenter.sub(movingCenter);
    if (direction.lengthSq() < 1e-10) return;

    // Keep the dot's height meaning: resolve in the ground plane first.
    // Only fall back to Y movement where an X/Z approach cannot touch.
    const planarDirection = direction.clone().setY(0);
    let approach = planarDirection.lengthSq() > 1e-10
        ? planarDirection
        : direction;
    let distance = sweepToContact(target, object, approach);

    if (distance == null && approach === planarDirection) {
        approach = direction;
        distance = sweepToContact(target, object, approach);
    }

    if (distance != null && distance > 1e-7) {
        moveObjectWorld(
            object,
            approach.normalize().multiplyScalar(distance)
        );
    }
}
function finishSurfaceSnap(object, target, surfaceNormal) {
    object.updateWorldMatrix(true, true);
    target.updateWorldMatrix(true, true);

    const normal = surfaceNormal.clone().normalize();

    // Först försöker vi ENDAST mot ytan.
    //
    // Exempel:
    // cylindersida -> endast radiellt
    // kubsida      -> endast X/Z
    // ovansida     -> endast nedåt
    //
    // Därmed förstör vi INTE högsta punktens Y=100%.
    const inward = normal.clone().negate();

    let distance =
        sweepToContact(
            target,
            object,
            inward
        );

    if (distance != null) {
        moveObjectWorld(
            object,
            inward.multiplyScalar(distance)
        );
    } else if (Math.abs(normal.y) > 0.7) {
        // Specialfall som fortfarande är generellt:
        //
        // På en nästan horisontell yta kan t.ex. sphere ligga
        // vid yttersta cap-punkten. Att flytta nedåt kan då
        // aldrig skapa kontakt eftersom den är för långt ut.
        //
        // Flytta då bara i ytans plan mot target.
        // Y ÄNDRAS INTE.

        const objectCenter =
            new THREE.Box3()
                .setFromObject(object)
                .getCenter(new THREE.Vector3());

        const targetCenter =
            new THREE.Box3()
                .setFromObject(target)
                .getCenter(new THREE.Vector3());

        const planar =
            targetCenter
                .clone()
                .sub(objectCenter);

        // Ta bort normal-komponenten.
        planar.addScaledVector(
            normal,
            -planar.dot(normal)
        );

        if (planar.lengthSq() > 1e-8) {
            planar.normalize();

            distance =
                sweepToContact(
                    target,
                    object,
                    planar
                );

            if (distance != null) {
                moveObjectWorld(
                    object,
                    planar.multiplyScalar(distance)
                );
            }
        }
    }


    // ===========================================
    // ALDRIG UNDER RUTNÄTET
    // ===========================================

    object.updateWorldMatrix(true, true);

    const finalBox =
        new THREE.Box3().setFromObject(object);

    if (finalBox.min.y < 0) {
        moveObjectWorld(
            object,
            new THREE.Vector3(
                0,
                -finalBox.min.y,
                0
            )
        );
    }


    updateSelectionHelper();
    updateInspector();
}
function createPrimitive(type,resolution="medium") { let geometry;const seg=resolution==="low"?4:resolution==="high"?16:6;
  if(type==="cube")geometry=new THREE.BoxGeometry(2,2,2);if(type==="sphere")geometry=new THREE.SphereGeometry(1,seg,Math.max(3,Math.round(seg*.66)));if(type==="cylinder")geometry=new THREE.CylinderGeometry(1,1,2,seg);if(type==="cone")geometry=new THREE.ConeGeometry(1,2,seg,2);if(type==="plane")geometry=new THREE.BoxGeometry(2,.1,2);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x66aa55,roughness:.7}));mesh.name=`${type[0].toUpperCase()+type.slice(1)} ${sequence++}`;mesh.userData.type=type;mesh.userData.resolution=resolution;ensureId(mesh);mesh.castShadow=mesh.receiveShadow=true;return mesh;
}
function ensureId(object){if(!object.userData.assetId)object.userData.assetId=`node-${nextId++}`;return object.userData.assetId;}
function assignFreshIds(object){object.traverse(node=>{if(node.isMesh||node.userData.isGroup){delete node.userData.assetId;ensureId(node);}});}
function allMeshes() { const meshes=[]; roots.forEach(root=>root.traverse(node=>{if(node.isMesh)meshes.push(node);}));return meshes; }
function rootFor(object) { let current=object;while(current.parent&&current.parent!==scene)current=current.parent;return current; }
function add(type) { const mesh=createPrimitive(type,$("#primitiveResolution").value);mesh.position.set((roots.length%4)*2.5-3.75,1,Math.floor(roots.length/4)*2.5);scene.add(mesh);roots.push(mesh);select(mesh);commit(); }
function updateSnapping(){const step=Number($("#snapStep").value);transform.setTranslationSnap(snapEnabled?step:null);transform.setRotationSnap(snapEnabled?Math.PI/12:null);transform.setScaleSnap(snapEnabled?step/10:null);$("#snapButton").classList.toggle("is-active",snapEnabled);$("#snapButton").textContent=snapEnabled?`Snap ${step}`:"Snap";}
function keepAboveGround(object){object.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(object);if(box.min.y<0)object.position.y-=box.min.y;}
function resetSelected(){if(!selected||gizmoStartTransform?.object!==selected){status.value="No transform-gizmo change to reset.";return;}selected.position.copy(gizmoStartTransform.position);selected.rotation.copy(gizmoStartTransform.rotation);selected.scale.copy(gizmoStartTransform.scale);gizmoStartTransform=null;updateSelectionHelper();updateInspector();commit();status.value=`Reset gizmo change on ${selected.name}`;}
function updateGroupMemberHelpers(){const paintMode=activeTool==="paint"||activeTool==="paintPrimitive";for(const [object,helper] of groupMemberHelpers){const visible=!paintMode&&selection.size>1&&selection.has(object);helper.visible=visible;if(visible)helper.setFromObject(object);}if(paintMode||selection.size<2)return;selection.forEach(object=>{if(groupMemberHelpers.has(object))return;const helper=new THREE.BoxHelper(object,0xff9f1c);helper.material.depthTest=false;helper.material.transparent=true;helper.material.opacity=.98;helper.renderOrder=13;helper.userData.editorOnly=true;scene.add(helper);groupMemberHelpers.set(object,helper);});}
function updateSelectionHelper(){if(!selected||activeTool==="paint"||activeTool==="paintPrimitive"){selectionHelper.visible=false;groupSelectionHelper.visible=false;updateGroupMemberHelpers();return;}selected.updateWorldMatrix(true,true);selectionHelper.setFromObject(selected);selectionHelper.visible=true;groupSelectionHelper.visible=false;updateGroupMemberHelpers();}
function select(object, additive=false) {if(animationMode&&object&&!object.userData.isGroup)object=animationTargetFor(object);if(!additive)selection.clear();if(additive&&selection.has(object)){selection.delete(object);if(selected===object)selected=[...selection].at(-1)||null;}else {selection.add(object);selected=object;}if(["translate","rotate","scale"].includes(activeTool)&&selected)transform.attach(selected);else transform.detach();updateSelectionHelper();updateOutliner();updateInspector(); }
function clearSelection() { selected=null;selection.clear();transform.detach();updateSelectionHelper();updateOutliner();updateInspector(); }
function addOutlinerNode(object,depth=0) { const item=document.createElement("button");item.textContent=object.name;item.style.paddingLeft=`${9+depth*16}px`;item.classList.toggle("is-group",!!object.userData.isGroup);item.classList.toggle("is-selected",object===selected);item.classList.toggle("is-secondary",object!==selected&&selection.has(object));item.onclick=e=>select(object,e.ctrlKey||e.metaKey||e.shiftKey);outliner.append(item);object.children.filter(child=>child.isMesh||child.userData.isGroup).forEach(child=>addOutlinerNode(child,depth+1)); }
function updateOutliner() { outliner.replaceChildren();if(!roots.length){outliner.textContent="No objects yet.";outliner.className="outliner empty-state";return;}outliner.className="outliner";roots.forEach(root=>addOutlinerNode(root)); }
function updateInspector() { const enabled=!!selected;$("#emptyInspector").hidden=enabled;$("#inspector").hidden=!enabled;if(!enabled){updateAnimationUI();return;}$("#objectName").value=selected.name;$("#materialFields").hidden=!!selected.userData.isGroup;if(selected.isMesh){$("#objectColor").value="#"+selected.material.color.getHexString();$("#objectRoughness").value=selected.material.roughness;$("#objectOpacity").value=selected.material.opacity;$("#flatShading").checked=selected.material.flatShading;$("#textureName").textContent=selected.userData.textureName||"No texture";$("#clearTextureButton").disabled=!selected.userData.textureDataURL;}document.querySelectorAll("[data-property]").forEach(input=>{const[group,axis]=input.dataset.property.split(".");const value=group==="rotation"?THREE.MathUtils.radToDeg(selected[group][axis]):selected[group][axis];input.value=Number(value.toFixed(3));});updateAnimationUI(); }
function applyInspector() {if(!selected)return;selected.name=$("#objectName").value.trim()||selected.name;if(selected.isMesh){const material=selected.material;material.color.set($("#objectColor").value);material.roughness=Number($("#objectRoughness").value);material.opacity=Number($("#objectOpacity").value);material.transparent=material.opacity<1;material.depthWrite=material.opacity>=1;material.flatShading=$("#flatShading").checked;material.needsUpdate=true;}document.querySelectorAll("[data-property]").forEach(input=>{const[group,axis]=input.dataset.property.split(".");const value=Number(input.value);selected[group][axis]=group==="rotation"?THREE.MathUtils.degToRad(value):value;});keepAboveGround(selected);updateOutliner();}
function serialize(object) {const base={nodeType:object.userData.isGroup?"group":"primitive",assetId:ensureId(object),name:object.name,position:object.position.toArray(),rotation:object.rotation.toArray(),scale:object.scale.toArray()};if(object.userData.isGroup)return {...base,children:object.children.filter(child=>child.isMesh||child.userData.isGroup).map(serialize)};return {...base,primitiveType:object.userData.type,resolution:object.userData.resolution,color:object.material.color.getHex(),roughness:object.material.roughness,opacity:object.material.opacity,flatShading:object.material.flatShading,vertexColors:object.geometry.attributes.color?Array.from(object.geometry.attributes.color.array):null,textureDataURL:object.userData.textureDataURL||null,textureName:object.userData.textureName||null};}
function snapshot(){return {version:4,objects:roots.map(serialize),animations,activeAnimationId,animation};}
function commit(){if(editing)return;const state=JSON.stringify(snapshot());if(undoStack.at(-1)===state)return;undoStack.push(state);if(undoStack.length>50)undoStack.shift();redoStack=[];status.value="Unsaved changes";}
function deserialize(saved) {if(saved.nodeType==="group"){const group=new THREE.Group();group.userData.isGroup=true;group.userData.assetId=saved.assetId||saved.id||ensureId(group);group.name=saved.name||`Group ${groupSequence++}`;(saved.children||[]).map(deserialize).forEach(child=>group.add(child));applyTransform(group,saved);return group;}const mesh=createPrimitive(saved.primitiveType||saved.type||"cube",saved.resolution);mesh.userData.assetId=saved.assetId||saved.id||mesh.userData.assetId;mesh.name=saved.name||mesh.name;if(saved.color!=null)mesh.material.color.setHex(saved.color);if(saved.roughness!=null)mesh.material.roughness=saved.roughness;if(saved.opacity!=null){mesh.material.opacity=saved.opacity;mesh.material.transparent=saved.opacity<1;mesh.material.depthWrite=saved.opacity>=1;}if(saved.flatShading!=null){mesh.material.flatShading=saved.flatShading;mesh.material.needsUpdate=true;}if(saved.vertexColors){mesh.geometry=mesh.geometry.toNonIndexed();mesh.geometry.setAttribute("color",new THREE.Float32BufferAttribute(saved.vertexColors,3));mesh.material.vertexColors=true;}if(saved.textureDataURL)applyTexture(mesh,saved.textureDataURL,saved.textureName);applyTransform(mesh,saved);return mesh;}
function values(value,fallback){return Array.isArray(value)?value:[value?.x??fallback[0],value?.y??fallback[1],value?.z??fallback[2]];}
function applyTransform(object,saved){object.position.fromArray(values(saved.position,[0,0,0]));object.rotation.fromArray(values(saved.rotation,[0,0,0]));object.scale.fromArray(values(saved.scale,[1,1,1]));}
function ensureVertexColors(mesh){if(mesh.geometry.attributes.color){mesh.material.vertexColors=true;mesh.material.color.set(0xffffff);mesh.material.needsUpdate=true;return;}mesh.geometry=mesh.geometry.toNonIndexed();const colors=[],baseColor=mesh.material.color.clone();for(let i=0;i<mesh.geometry.attributes.position.count;i++)colors.push(baseColor.r,baseColor.g,baseColor.b);mesh.geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));mesh.material=mesh.material.clone();mesh.material.color.set(0xffffff);mesh.material.vertexColors=true;mesh.material.needsUpdate=true;}
function paintFace(mesh,faceIndex){if(!mesh?.isMesh||faceIndex==null)return;ensureVertexColors(mesh);const color=new THREE.Color($("#paintColor").value),attribute=mesh.geometry.attributes.color,start=faceIndex*3;for(let index=start;index<start+3;index++)attribute.setXYZ(index,color.r,color.g,color.b);attribute.needsUpdate=true;select(mesh);commit();status.value=`Painted face on ${mesh.name}`;}
function paintPrimitive(mesh){if(!mesh?.isMesh)return;const color=new THREE.Color($("#paintColor").value);mesh.material=mesh.material.clone();if(mesh.geometry.attributes.color){const attribute=mesh.geometry.attributes.color;for(let index=0;index<attribute.count;index++)attribute.setXYZ(index,color.r,color.g,color.b);attribute.needsUpdate=true;mesh.material.color.set(0xffffff);mesh.material.vertexColors=true;}else{mesh.material.color.copy(color);mesh.material.vertexColors=false;}mesh.material.needsUpdate=true;select(mesh);commit();status.value=`Painted ${mesh.name}`;}
function applyTexture(mesh,dataURL,name="Texture",record=false){const loader=new THREE.TextureLoader();loader.load(dataURL,texture=>{texture.colorSpace=THREE.SRGBColorSpace;mesh.material.map=texture;mesh.material.needsUpdate=true;mesh.userData.textureDataURL=dataURL;mesh.userData.textureName=name;updateInspector();if(record){commit();status.value="Texture applied";}});}
function removeTexture(){if(!selected?.isMesh)return;selected.material.map?.dispose();selected.material.map=null;selected.material.needsUpdate=true;delete selected.userData.textureDataURL;delete selected.userData.textureName;updateInspector();commit();status.value="Texture removed";}
function animationNode(id){let match=null;roots.forEach(root=>root.traverse(node=>{if(node.userData.assetId===id)match=node;}));return match;}
function animationTargetFor(object){let node=object.parent;while(node&&node!==scene){if(node.userData.isGroup)return node;node=node.parent;}return object;}
function captureAnimationBasePose(){const pose=new Map();roots.forEach(root=>root.traverse(node=>{if(node.isMesh||node.userData.isGroup)pose.set(ensureId(node),{position:node.position.toArray(),rotation:node.rotation.toArray(),scale:node.scale.toArray()});}));return pose;}
function restoreAnimationBasePose(){if(!animationBasePose)return;animationBasePose.forEach((transform,id)=>{const node=animationNode(id);if(node)applyTransform(node,transform);});}
function updateAnimationUI(){animation=animations.find(item=>item.id===activeAnimationId)||animations[0];if(!animation){animation={id:"animation-1",name:"Animation 1",duration:2,playback:"loop",keyframes:[]};animations=[animation];activeAnimationId=animation.id;}const duration=Math.max(.1,Number(animation.duration)||2),select=$("#animationSelect");select.replaceChildren(...animations.map(item=>{const option=document.createElement("option");option.value=item.id;option.textContent=item.name;return option;}));select.value=animation.id;$("#animationName").value=animation.name;$("#timeline").max=duration;$("#timeline").value=Math.min(animationTime,duration);$("#animationTime").value=`${animationTime.toFixed(1)}s`;$("#animationDuration").value=duration;$("#playbackMode").value=animation.playback==="pingpong"?"pingpong":"loop";$("#playButton").textContent=isPlaying?"Pause":"Play";const targets=new Set(animation.keyframes.map(frame=>frame.target));$("#keyframeSummary").textContent=animation.keyframes.length?`${animation.keyframes.length} keys / ${targets.size} target${targets.size===1?"":"s"}`:"No keyframes";}
function selectAnimation(id){const next=animations.find(item=>item.id===id);if(!next)return;isPlaying=false;playbackDirection=1;activeAnimationId=next.id;animation=next;animationTime=0;if(animationMode){restoreAnimationBasePose();setAnimationTime(0);}updateAnimationUI();}
function newAnimation(){const item={id:`animation-${animationIdSequence++}`,name:`Animation ${animations.length+1}`,duration:2,playback:"loop",keyframes:[]};animations.push(item);activeAnimationId=item.id;animation=item;animationTime=0;commit();updateAnimationUI();status.value=`Created ${item.name}`;}
function saveActiveAnimation(){animation.name=$("#animationName").value.trim()||"Untitled animation";animation.duration=Math.max(.1,Number($("#animationDuration").value)||2);commit();updateAnimationUI();status.value=`Saved ${animation.name}`;}
function deleteAnimation(){if(!animation)return;const name=animation.name;animations=animations.filter(item=>item!==animation);if(!animations.length){animations=[{id:`animation-${animationIdSequence++}`,name:"Animation 1",duration:2,playback:"loop",keyframes:[]}];}activeAnimationId=animations[0].id;animation=animations[0];animationTime=0;playbackDirection=1;isPlaying=false;commit();updateAnimationUI();status.value=`Deleted ${name}`;}
function setAnimationTime(time){animationTime=Math.max(0,Math.min(Number(time)||0,animation.duration));const tracks=new Map();animation.keyframes.forEach(frame=>{if(!tracks.has(frame.target))tracks.set(frame.target,[]);tracks.get(frame.target).push(frame);});tracks.forEach((frames,target)=>{const object=animationNode(target);if(!object)return;frames.sort((a,b)=>a.time-b.time);const after=frames.find(frame=>frame.time>=animationTime)||frames.at(-1),before=[...frames].reverse().find(frame=>frame.time<=animationTime)||frames[0],mix=before===after?0:(animationTime-before.time)/(after.time-before.time);["position","scale"].forEach(property=>object[property].fromArray(before[property]).lerp(new THREE.Vector3().fromArray(after[property]),mix));object.rotation.set(THREE.MathUtils.lerp(before.rotation[0],after.rotation[0],mix),THREE.MathUtils.lerp(before.rotation[1],after.rotation[1],mix),THREE.MathUtils.lerp(before.rotation[2],after.rotation[2],mix));});updateInspector();updateAnimationUI();}
function setKeyframe(){if(!animationMode){status.value="Enter Animation mode before setting a keyframe.";return;}if(!selected?.isMesh&&!selected?.userData.isGroup){status.value="Select a primitive or subgroup before setting a keyframe.";return;}const target=ensureId(selected),frame={target,time:Number(animationTime.toFixed(2)),position:selected.position.toArray(),rotation:selected.rotation.toArray(),scale:selected.scale.toArray()};animation.keyframes=animation.keyframes.filter(existing=>!(existing.target===target&&Math.abs(existing.time-frame.time)<.001));animation.keyframes.push(frame);animation.keyframes.sort((a,b)=>a.time-b.time);commit();updateAnimationUI();status.value=`Keyframe set for ${selected.name} at ${frame.time.toFixed(1)}s`;}
function togglePlayback(){if(!animation.keyframes.length){status.value="Set a keyframe first.";return;}if(animationTime<=0)playbackDirection=1;else if(animationTime>=animation.duration)playbackDirection=-1;isPlaying=!isPlaying;animationClock.getDelta();updateAnimationUI();}
function clearAnimation(){if(!animation.keyframes.length)return;animation.keyframes=[];isPlaying=false;animationTime=0;commit();updateAnimationUI();status.value=`Cleared ${animation.name}`;}
function setAnimationMode(enabled=!animationMode){animationMode=enabled;isPlaying=false;$("#animationDock").hidden=!enabled;document.body.classList.toggle("animation-mode",enabled);if(enabled){animationBasePose=captureAnimationBasePose();activeTool="translate";transform.setMode("translate");if(selected&&(selected.isMesh||selected.userData.isGroup))transform.attach(selected);else transform.detach();document.querySelectorAll("[data-tool]").forEach(button=>button.classList.toggle("is-active",button.dataset.tool==="translate"));status.value="Animation mode: pose a primitive, or its nearest subgroup, then set a keyframe.";}else{transform.detach();activeTool="select";restoreAnimationBasePose();animationBasePose=null;document.querySelectorAll("[data-tool]").forEach(button=>button.classList.toggle("is-active",button.dataset.tool==="select"));status.value="Animation mode closed; original model placement restored.";}updateSelectionHelper();updateAnimationUI();}
function load(data,record=true){if(!data?.objects||!Array.isArray(data.objects))throw new Error("This is not a MaxPaint project.");clearSelection();roots.forEach(root=>scene.remove(root));groupSequence=1;subgroupSequence=1;roots=data.objects.map(deserialize);roots.forEach(root=>scene.add(root));animations=Array.isArray(data.animations)&&data.animations.length?data.animations:data.animation?.keyframes?[{id:"animation-1",name:"Animation 1",duration:data.animation.duration||2,playback:"loop",keyframes:data.animation.keyframes}]:[{id:"animation-1",name:"Animation 1",duration:2,playback:"loop",keyframes:[]}];animations.forEach((item,index)=>{item.id=item.id||`animation-${index+1}`;item.name=item.name||`Animation ${index+1}`;item.duration=Math.max(.1,Number(item.duration)||2);item.playback=item.playback==="pingpong"?"pingpong":"loop";item.keyframes=Array.isArray(item.keyframes)?item.keyframes:[];});activeAnimationId=animations.some(item=>item.id===data.activeAnimationId)?data.activeAnimationId:animations[0].id;animation=animations.find(item=>item.id===activeAnimationId);animationIdSequence=animations.length+1;animationTime=0;playbackDirection=1;isPlaying=false;sequence=allMeshes().length+1;const loadedGroups=[];roots.forEach(root=>root.traverse(node=>{if(node.userData.isGroup)loadedGroups.push(node);}));groupSequence=loadedGroups.filter(node=>node.parent===scene).length+1;subgroupSequence=loadedGroups.filter(node=>node.parent!==scene).length+1;updateOutliner();updateAnimationUI();if(record){undoStack=[JSON.stringify(snapshot())];redoStack=[];}status.value=`Loaded ${allMeshes().length} object${allMeshes().length===1?"":"s"}`;}
function undo(){if(undoStack.length<2)return;redoStack.push(undoStack.pop());load(JSON.parse(undoStack.at(-1)),false);status.value="Undone";}function redo(){if(!redoStack.length)return;const state=redoStack.pop();undoStack.push(state);load(JSON.parse(state),false);status.value="Redone";}
function groupSelection(){if(animationMode){status.value="Exit Animation mode before changing subgroup structure.";return;}if(selection.size<2){status.value="Select two or more sibling objects with Ctrl/⌘-click or Shift-click, then press Group.";return;}const members=[...selection],parent=members[0].parent;if(members.some(member=>member.parent!==parent)){status.value="Subgroups can only contain objects at the same hierarchy level.";return;}const group=new THREE.Group();group.userData.isGroup=true;ensureId(group);group.name=parent===scene?`Group ${groupSequence++}`:`Subgroup ${subgroupSequence++}`;parent.add(group);members.forEach(member=>group.attach(member));if(parent===scene){roots=roots.filter(root=>!selection.has(root));roots.push(group);}select(group);commit();status.value=`Created ${parent===scene?"group":"subgroup"} with ${members.length} objects`;}
function ungroupSelected(){if(!selected?.userData.isGroup){status.value="Select a group to ungroup.";return;}const group=selected,parent=group.parent,children=group.children.filter(child=>child.isMesh||child.userData.isGroup);children.forEach(child=>parent.attach(child));parent.remove(group);if(parent===scene){const index=roots.indexOf(group);roots.splice(index,1,...children);}clearSelection();children.forEach(child=>selection.add(child));selected=children[0]||null;updateSelectionHelper();updateOutliner();updateInspector();commit();status.value="Group ungrouped";}
function duplicateSelected(){if(!selected)return;const copy=selected.clone(true);assignFreshIds(copy);copy.name=`${selected.name} Copy`;copy.position.x+=1;copy.position.z+=1;scene.add(copy);roots.push(copy);select(copy);commit();status.value="Object duplicated";}
function frameSelected(){if(!selected){status.value="Select an object to frame.";return;}const box=new THREE.Box3().setFromObject(selected),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),distance=Math.max(4,size.length()*1.4),direction=camera.position.clone().sub(orbit.target).normalize();orbit.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);camera.near=Math.max(.01,distance/100);camera.far=Math.max(500,distance*20);camera.updateProjectionMatrix();orbit.update();status.value=`Framed ${selected.name}`;}
function moveCamera(delta){if(!movementKeys.size)return;const forward=camera.getWorldDirection(new THREE.Vector3());forward.y=0;if(forward.lengthSq()===0)return;forward.normalize();const right=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize(),move=new THREE.Vector3(),speed=(movementKeys.has("shift")?18:7)*Math.min(delta,.05);if(movementKeys.has("w"))move.add(forward);if(movementKeys.has("s"))move.sub(forward);if(movementKeys.has("d"))move.add(right);if(movementKeys.has("a"))move.sub(right);if(!move.lengthSq())return;move.normalize().multiplyScalar(speed);camera.position.add(move);orbit.target.add(move);}
function deleteSelected(){if(!selected)return;const target=selected;const parent=target.parent;parent.remove(target);if(parent===scene)roots=roots.filter(root=>root!==target);clearSelection();commit();}
function download(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function save(){const text=JSON.stringify(snapshot(),null,2);if(window.showSaveFilePicker){try{const handle=await showSaveFilePicker({suggestedName:"model.mp3d",types:[{description:"MaxPaint project",accept:{"application/json":[".mp3d"]}}]});const file=await handle.createWritable();await file.write(text);await file.close();status.value="Project saved";return;}catch(e){if(e.name==="AbortError")return;}}download(new Blob([text],{type:"application/json"}),"model.mp3d");status.value="Project downloaded";}
function buildAnimationClip(exportRoot,clipAnimation){if(!clipAnimation?.keyframes.length)return null;const tracks=[],byTarget=new Map(),nodes=new Map();exportRoot.traverse(node=>{if(node.userData.assetId)nodes.set(node.userData.assetId,node);});clipAnimation.keyframes.forEach(frame=>{if(!byTarget.has(frame.target))byTarget.set(frame.target,[]);byTarget.get(frame.target).push(frame);});byTarget.forEach((frames,target)=>{frames.sort((a,b)=>a.time-b.time);const node=nodes.get(target);if(!node)return;const times=frames.map(frame=>frame.time),positions=frames.flatMap(frame=>frame.position),scales=frames.flatMap(frame=>frame.scale),quaternions=[];frames.forEach(frame=>quaternions.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(frame.rotation)).toArray()));tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`,times,positions),new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`,times,quaternions),new THREE.VectorKeyframeTrack(`${node.name}.scale`,times,scales));});return tracks.length?new THREE.AnimationClip(clipAnimation.name||"Animation",clipAnimation.duration,tracks):null;}
function exportMaterialKey(material){return [material.type,material.map?.uuid||"",material.color?.getHexString?.()||"",material.roughness??"",material.metalness??"",material.opacity,material.transparent,material.alphaTest,material.side,material.flatShading,material.vertexColors].join("|");}
function animatedExportNodes(){return new Set(animations.flatMap(item=>item.keyframes.map(frame=>frame.target)));}
function isAnimatedForExport(mesh,root,animated){let node=mesh;while(node&&node!==root){if(animated.has(node.name))return true;node=node.parent;}return false;}
function optimizeExportDrawCalls(root){const animated=animatedExportNodes(),groups=new Map();root.updateMatrixWorld(true);root.traverse(mesh=>{if(!mesh.isMesh||Array.isArray(mesh.material)||!mesh.geometry||mesh.isSkinnedMesh||mesh.morphTargetInfluences||isAnimatedForExport(mesh,root,animated)||mesh.matrixWorld.determinant()<0)return;const key=exportMaterialKey(mesh.material);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);});let sourceMeshes=0,mergedMeshes=0;for(const meshes of groups.values()){if(meshes.length<2)continue;const geometries=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)),mergedGeometry=mergeGeometries(geometries,false);if(!mergedGeometry){geometries.forEach(geometry=>geometry.dispose());continue;}const merged=new THREE.Mesh(mergedGeometry,meshes[0].material);merged.name=`Merged static batch ${mergedMeshes+1}`;root.add(merged);meshes.forEach(mesh=>mesh.parent?.remove(mesh));sourceMeshes+=meshes.length;mergedMeshes++;}return {sourceMeshes,mergedMeshes};}
async function exportGLB(){const root=new THREE.Group();roots.forEach(object=>root.add(object.clone(true)));root.traverse(node=>{if(node.userData.assetId)node.name=node.userData.assetId;});const clips=animations.map(item=>buildAnimationClip(root,item)).filter(Boolean),optimization=optimizeExportDrawCalls(root),options={binary:true,onlyVisible:true};if(clips.length)options.animations=clips;const result=await new GLTFExporter().parseAsync(root,options);download(new Blob([result],{type:"model/gltf-binary"}),"maxpaint3d-model.glb");const batching=optimization.sourceMeshes?`${optimization.sourceMeshes} meshes batched into ${optimization.mergedMeshes}`:"no compatible static batches";const animationLabel=clips.length?"; "+clips.length+" animation"+(clips.length===1?"":"s")+" preserved":"";status.value=`GLB exported: ${batching}${animationLabel}`;}
function resize(){const width=viewport.clientWidth,height=viewport.clientHeight;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(viewport);
function rayFromPointer(event){const box=canvas.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);raycaster.setFromCamera(pointer,camera);return raycaster;}
function visibleGizmoHandleHit(ray){const helper=transform.getHelper(),controlGizmo=helper.children.find(child=>child.gizmo?.[transform.mode]),visuals=controlGizmo?.gizmo?.[transform.mode];if(!visuals)return false;return ray.intersectObject(visuals,true).some(hit=>hit.object.visible&&hit.object.material?.visible!==false);}
function belongsTo(object,container){let current=object;while(current){if(current===container)return true;current=current.parent;}return false;}
function moveSurfaceHit(ray,object){return ray.intersectObjects(allMeshes()).find(hit=>!belongsTo(hit.object,object));}
function snapFrom(origin,value,step){return origin+Math.round((value-origin)/step)*step;}
function oddCount(value,min=3){const count=Math.max(min,Math.round(value));return count%2?count:count-1;}
function evenIntervals(value,min=2){const count=Math.max(min,Math.round(value));return count%2?count:count+1;}
function snapValues(min,max,step){const count=oddCount((max-min)/step+1),values=[];for(let index=0;index<count;index++)values.push(min+(max-min)*index/(count-1));return values;}
function sphereSnapConfig(target){const box=new THREE.Box3().setFromObject(target),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=new THREE.Vector3(size.x/2,size.y/2,size.z/2),step=Number($("#snapStep").value)/4,baseRadius=Math.max(.01,Math.max(radius.x,radius.y,radius.z));return {center,radius,rings:Math.max(4,Math.min(16,evenIntervals(Math.PI*baseRadius/step))),segments:Math.max(7,Math.min(31,oddCount(2*Math.PI*baseRadius/step)))};}
function sphereSurfaceHit(target,point){const config=sphereSnapConfig(target),local=point.clone().sub(config.center),unit=new THREE.Vector3(local.x/config.radius.x,local.y/config.radius.y,local.z/config.radius.z).normalize(),theta=Math.round(Math.acos(THREE.MathUtils.clamp(unit.y,-1,1))/Math.PI*config.rings)/config.rings*Math.PI,phi=Math.round(Math.atan2(unit.z,unit.x)/(2*Math.PI)*config.segments)/config.segments*2*Math.PI,ideal=new THREE.Vector3(config.center.x+config.radius.x*Math.sin(theta)*Math.cos(phi),config.center.y+config.radius.y*Math.cos(theta),config.center.z+config.radius.z*Math.sin(theta)*Math.sin(phi)),direction=ideal.clone().sub(config.center).normalize(),ray=new THREE.Ray(config.center.clone(),direction),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),intersection=new THREE.Vector3();let closest=null,closestDistance=Infinity,normal=direction.clone();target.updateWorldMatrix(true,true);target.traverse(node=>{if(!node.isMesh||!node.geometry?.attributes.position)return;const positions=node.geometry.attributes.position,index=node.geometry.index;const testTriangle=(ia,ib,ic)=>{a.fromBufferAttribute(positions,ia).applyMatrix4(node.matrixWorld);b.fromBufferAttribute(positions,ib).applyMatrix4(node.matrixWorld);c.fromBufferAttribute(positions,ic).applyMatrix4(node.matrixWorld);if(!ray.intersectTriangle(a,b,c,false,intersection))return;const distance=intersection.clone().sub(config.center).dot(direction);if(distance<=.0001||distance>=closestDistance)return;closestDistance=distance;closest=intersection.clone();normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();if(normal.dot(direction)<0)normal.negate();};if(index){for(let i=0;i<index.count;i+=3)testTriangle(index.getX(i),index.getX(i+1),index.getX(i+2));}else{for(let i=0;i<positions.count;i+=3)testTriangle(i,i+1,i+2);}});return {point:closest||ideal,normal};}
function sphereSurfacePoint(target,point){return sphereSurfaceHit(target,point).point;}
function cylinderSnapConfig(target){target.updateWorldMatrix(true,false);target.geometry.computeBoundingBox();const box=target.geometry.boundingBox,center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),scale=new THREE.Vector3();target.matrixWorld.decompose(new THREE.Vector3(),new THREE.Quaternion(),scale);const worldStep=Number($("#snapStep").value)/4,radialScale=Math.max(.0001,(Math.abs(scale.x)+Math.abs(scale.z))/2),verticalScale=Math.max(.0001,Math.abs(scale.y)),radius=Math.max(.01,Math.min(size.x,size.z)/2),step=worldStep/radialScale,yStep=worldStep/verticalScale,worldRadius=radius*radialScale;return {box,center,radius,step,yStep,axis:new THREE.Vector3(0,1,0).transformDirection(target.matrixWorld),rings:Math.max(2,evenIntervals(worldRadius/worldStep)),segments:Math.max(7,Math.min(31,oddCount(2*Math.PI*worldRadius/worldStep))),ys:snapValues(box.min.y,box.max.y,yStep)};}
function cylinderSurfaceHit(target,point,faceNormal=null){const config=cylinderSnapConfig(target),local=target.worldToLocal(point.clone()),cap=faceNormal?Math.abs(faceNormal.dot(config.axis))>.5:Math.abs(local.y-config.center.y)>Math.abs(config.box.max.y-config.box.min.y)*.35,offset=local.clone().sub(config.center),theta=Math.round(Math.atan2(offset.z,offset.x)/(2*Math.PI)*config.segments)/config.segments*2*Math.PI;let idealLocal,originLocal,directionLocal;if(cap){const radial=Math.min(config.radius,Math.round(Math.hypot(offset.x,offset.z)/config.step)*config.step),top=offset.y>=0;idealLocal=new THREE.Vector3(config.center.x+Math.cos(theta)*radial,top?config.box.max.y:config.box.min.y,config.center.z+Math.sin(theta)*radial);originLocal=idealLocal.clone().add(new THREE.Vector3(0,top?1:-1,0));directionLocal=new THREE.Vector3(0,top?-1:1,0);}else{const y=snapFrom(config.box.min.y,local.y,config.yStep);idealLocal=new THREE.Vector3(config.center.x+Math.cos(theta)*config.radius,y,config.center.z+Math.sin(theta)*config.radius);originLocal=new THREE.Vector3(config.center.x,y,config.center.z);directionLocal=idealLocal.clone().sub(originLocal).normalize();}const ideal=target.localToWorld(idealLocal.clone()),origin=target.localToWorld(originLocal.clone()),direction=directionLocal.transformDirection(target.matrixWorld),ray=new THREE.Ray(origin,direction),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),intersection=new THREE.Vector3();let closest=null,closestDistance=Infinity,normal=direction.clone();target.traverse(node=>{if(!node.isMesh||!node.geometry?.attributes.position)return;const positions=node.geometry.attributes.position,index=node.geometry.index,testTriangle=(ia,ib,ic)=>{a.fromBufferAttribute(positions,ia).applyMatrix4(node.matrixWorld);b.fromBufferAttribute(positions,ib).applyMatrix4(node.matrixWorld);c.fromBufferAttribute(positions,ic).applyMatrix4(node.matrixWorld);if(!ray.intersectTriangle(a,b,c,false,intersection))return;const distance=intersection.clone().sub(origin).dot(direction);if(distance<=.0001||distance>=closestDistance)return;closestDistance=distance;closest=intersection.clone();normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();};if(index){for(let i=0;i<index.count;i+=3)testTriangle(index.getX(i),index.getX(i+1),index.getX(i+2));}else{for(let i=0;i<positions.count;i+=3)testTriangle(i,i+1,i+2);}});const centerWorld=target.localToWorld(config.center.clone());if(closest&&(!cap&&normal.dot(closest.clone().sub(centerWorld))<0||cap&&normal.dot(direction)>0))normal.negate();return {point:closest||ideal,normal};}
function coneSnapConfig(target){const box=new THREE.Box3().setFromObject(target),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),step=Number($("#snapStep").value)/4,radius=Math.max(.01,Math.min(size.x,size.z)/2);return {box,center,radius,step,rings:Math.max(2,evenIntervals(radius/step)),segments:Math.max(7,Math.min(31,oddCount(2*Math.PI*radius/step))),ys:snapValues(box.min.y,box.max.y,step)};}
function coneSurfaceHit(target,point,faceNormal=null){const config=coneSnapConfig(target),cap=faceNormal?faceNormal.y<-.5:Math.abs(point.y-config.box.min.y)<config.step*.6,local=point.clone().sub(config.center),theta=Math.round(Math.atan2(local.z,local.x)/(2*Math.PI)*config.segments)/config.segments*2*Math.PI;let ideal,origin,direction;if(cap){const radial=Math.min(config.radius,Math.round(Math.hypot(local.x,local.z)/config.step)*config.step);ideal=new THREE.Vector3(config.center.x+Math.cos(theta)*radial,config.box.min.y,config.center.z+Math.sin(theta)*radial);origin=ideal.clone().add(new THREE.Vector3(0,-1,0));direction=new THREE.Vector3(0,1,0);}else{const y=snapFrom(config.box.min.y,point.y,config.step),radius=Math.max(0,config.radius*(config.box.max.y-y)/(config.box.max.y-config.box.min.y));ideal=new THREE.Vector3(config.center.x+Math.cos(theta)*radius,y,config.center.z+Math.sin(theta)*radius);origin=new THREE.Vector3(config.center.x,y,config.center.z);direction=ideal.clone().sub(origin).normalize();}const ray=new THREE.Ray(origin,direction),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),intersection=new THREE.Vector3();let closest=null,closestDistance=Infinity,normal=direction.clone();target.updateWorldMatrix(true,true);target.traverse(node=>{if(!node.isMesh||!node.geometry?.attributes.position)return;const positions=node.geometry.attributes.position,index=node.geometry.index,testTriangle=(ia,ib,ic)=>{a.fromBufferAttribute(positions,ia).applyMatrix4(node.matrixWorld);b.fromBufferAttribute(positions,ib).applyMatrix4(node.matrixWorld);c.fromBufferAttribute(positions,ic).applyMatrix4(node.matrixWorld);if(!ray.intersectTriangle(a,b,c,false,intersection))return;const distance=intersection.clone().sub(origin).dot(direction);if(distance<=.0001||distance>=closestDistance)return;closestDistance=distance;closest=intersection.clone();normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();};if(index){for(let i=0;i<index.count;i+=3)testTriangle(index.getX(i),index.getX(i+1),index.getX(i+2));}else{for(let i=0;i<positions.count;i+=3)testTriangle(i,i+1,i+2);}});if(closest&&normal.dot(closest.clone().sub(config.center))<0)normal.negate();return {point:closest||ideal,normal};}
function showMiddleSnapPoints(surfaces){const positions=[];for(const surface of surfaces)if(camera.position.clone().sub(surface.point).dot(surface.normal)>0)positions.push(...surface.point.toArray());middleSnapPointHelper.geometry.dispose();middleSnapPointHelper.geometry=new THREE.BufferGeometry();middleSnapPointHelper.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));middleSnapPointHelper.visible=positions.length>0;return positions;}
function showSnapPoints(target){
  if(!target){snapPointHelper.visible=false;middleSnapPointHelper.visible=false;return;}
  if(target.userData.type==="sphere"){
    const config=sphereSnapConfig(target),positions=[];
    for(let ring=0;ring<=config.rings;ring++)for(let segment=0;segment<config.segments;segment++){const theta=ring/config.rings*Math.PI,phi=segment/config.segments*2*Math.PI,ideal=new THREE.Vector3(config.center.x+config.radius.x*Math.sin(theta)*Math.cos(phi),config.center.y+config.radius.y*Math.cos(theta),config.center.z+config.radius.z*Math.sin(theta)*Math.sin(phi)),surface=sphereSurfaceHit(target,ideal);if(camera.position.clone().sub(surface.point).dot(surface.normal)>0)positions.push(...surface.point.toArray());}
    positions.push(...showMiddleSnapPoints([new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)].map(direction=>sphereSurfaceHit(target,config.center.clone().add(new THREE.Vector3(direction.x*config.radius.x,direction.y*config.radius.y,direction.z*config.radius.z))))));snapPointHelper.geometry.dispose();snapPointHelper.geometry=new THREE.BufferGeometry();snapPointHelper.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));snapPointHelper.visible=true;return;
  }
  if(target.userData.type==="cylinder"){
    const config=cylinderSnapConfig(target),positions=[],world=local=>target.localToWorld(local),add=surface=>{if(camera.position.clone().sub(surface.point).dot(surface.normal)>0)positions.push(...surface.point.toArray());};
    for(const y of [config.box.min.y,config.box.max.y])for(let ring=0;ring<=config.rings;ring++)for(let segment=0;segment<config.segments;segment++){const radius=ring/config.rings*config.radius,angle=segment/config.segments*2*Math.PI,top=y>config.center.y;add(cylinderSurfaceHit(target,world(new THREE.Vector3(config.center.x+Math.cos(angle)*radius,y,config.center.z+Math.sin(angle)*radius)),config.axis.clone().multiplyScalar(top?1:-1)));}
    for(const y of config.ys)for(let segment=0;segment<config.segments;segment++){const angle=segment/config.segments*2*Math.PI;add(cylinderSurfaceHit(target,world(new THREE.Vector3(config.center.x+Math.cos(angle)*config.radius,y,config.center.z+Math.sin(angle)*config.radius)),new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)).transformDirection(target.matrixWorld)));}
    const middles=[cylinderSurfaceHit(target,world(config.center.clone().setY(config.box.min.y)),config.axis.clone().negate()),cylinderSurfaceHit(target,world(config.center.clone().setY(config.box.max.y)),config.axis.clone())];for(let segment=0;segment<config.segments;segment++){const angle=segment/config.segments*2*Math.PI;middles.push(cylinderSurfaceHit(target,world(new THREE.Vector3(config.center.x+Math.cos(angle)*config.radius,config.center.y,config.center.z+Math.sin(angle)*config.radius)),new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)).transformDirection(target.matrixWorld)));}positions.push(...showMiddleSnapPoints(middles));snapPointHelper.geometry.dispose();snapPointHelper.geometry=new THREE.BufferGeometry();snapPointHelper.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));snapPointHelper.visible=true;return;
  }
  if(target.userData.type==="cone"){
    const config=coneSnapConfig(target),positions=[],add=surface=>{if(camera.position.clone().sub(surface.point).dot(surface.normal)>0)positions.push(...surface.point.toArray());};
    for(let ring=0;ring<=config.rings;ring++)for(let segment=0;segment<config.segments;segment++){const radius=ring/config.rings*config.radius,angle=segment/config.segments*2*Math.PI;add(coneSurfaceHit(target,new THREE.Vector3(config.center.x+Math.cos(angle)*radius,config.box.min.y,config.center.z+Math.sin(angle)*radius),new THREE.Vector3(0,-1,0)));}
    for(const y of config.ys){const radius=Math.max(0,config.radius*(config.box.max.y-y)/(config.box.max.y-config.box.min.y));if(radius<.0001){add({point:new THREE.Vector3(config.center.x,config.box.max.y,config.center.z),normal:new THREE.Vector3(0,1,0)});continue;}for(let segment=0;segment<config.segments;segment++){const angle=segment/config.segments*2*Math.PI;add(coneSurfaceHit(target,new THREE.Vector3(config.center.x+Math.cos(angle)*radius,y,config.center.z+Math.sin(angle)*radius),new THREE.Vector3(Math.cos(angle),0,Math.sin(angle))));}}
    const middles=[coneSurfaceHit(target,new THREE.Vector3(config.center.x,config.box.min.y,config.center.z),new THREE.Vector3(0,-1,0))],middleY=(config.box.min.y+config.box.max.y)/2,middleRadius=config.radius*.5;for(let segment=0;segment<config.segments;segment++){const angle=segment/config.segments*2*Math.PI;middles.push(coneSurfaceHit(target,new THREE.Vector3(config.center.x+Math.cos(angle)*middleRadius,middleY,config.center.z+Math.sin(angle)*middleRadius),new THREE.Vector3(Math.cos(angle),0,Math.sin(angle))));}positions.push(...showMiddleSnapPoints(middles));snapPointHelper.geometry.dispose();snapPointHelper.geometry=new THREE.BufferGeometry();snapPointHelper.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));snapPointHelper.visible=true;return;
  }
  const box=new THREE.Box3().setFromObject(target),step=Number($("#snapStep").value)/4,xs=snapValues(box.min.x,box.max.x,step),ys=snapValues(box.min.y,box.max.y,step),zs=snapValues(box.min.z,box.max.z,step),positions=[];
  const visible=(center,normal)=>camera.position.clone().sub(center).dot(normal)>0;
  const addXZ=(y,normal)=>{if(!visible(new THREE.Vector3((box.min.x+box.max.x)/2,y,(box.min.z+box.max.z)/2),normal))return;for(const x of xs)for(const z of zs)positions.push(x,y,z);};
  const addYZ=(x,normal)=>{if(!visible(new THREE.Vector3(x,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2),normal))return;for(const y of ys)for(const z of zs)positions.push(x,y,z);};
  const addXY=(z,normal)=>{if(!visible(new THREE.Vector3((box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,z),normal))return;for(const x of xs)for(const y of ys)positions.push(x,y,z);};
  addXZ(box.min.y,new THREE.Vector3(0,-1,0));addXZ(box.max.y,new THREE.Vector3(0,1,0));addYZ(box.min.x,new THREE.Vector3(-1,0,0));addYZ(box.max.x,new THREE.Vector3(1,0,0));addXY(box.min.z,new THREE.Vector3(0,0,-1));addXY(box.max.z,new THREE.Vector3(0,0,1));
  const center=new THREE.Vector3((box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2);positions.push(...showMiddleSnapPoints([{point:new THREE.Vector3(center.x,box.min.y,center.z),normal:new THREE.Vector3(0,-1,0)},{point:new THREE.Vector3(center.x,box.max.y,center.z),normal:new THREE.Vector3(0,1,0)},{point:new THREE.Vector3(box.min.x,center.y,center.z),normal:new THREE.Vector3(-1,0,0)},{point:new THREE.Vector3(box.max.x,center.y,center.z),normal:new THREE.Vector3(1,0,0)},{point:new THREE.Vector3(center.x,center.y,box.min.z),normal:new THREE.Vector3(0,0,-1)},{point:new THREE.Vector3(center.x,center.y,box.max.z),normal:new THREE.Vector3(0,0,1)}]));snapPointHelper.geometry.dispose();snapPointHelper.geometry=new THREE.BufferGeometry();snapPointHelper.geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));snapPointHelper.visible=true;
}
function surfaceSnapPoint(hit){if(!hit?.face)return null;const hitNormal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);if(hit.object.userData.type==="sphere")return sphereSurfacePoint(hit.object,hit.point);if(hit.object.userData.type==="cylinder")return cylinderSurfaceHit(hit.object,hit.point,hitNormal).point;if(hit.object.userData.type==="cone")return coneSurfaceHit(hit.object,hit.point,hitNormal).point;const box=new THREE.Box3().setFromObject(hit.object),step=Number($("#snapStep").value)/4,normal=hitNormal,point=hit.point.clone();if(normal.y>.5)point.set(snapFrom(box.min.x,point.x,step),box.max.y,snapFrom(box.min.z,point.z,step));else if(normal.y<-.5)point.set(snapFrom(box.min.x,point.x,step),box.min.y,snapFrom(box.min.z,point.z,step));else if(Math.abs(normal.x)>.5)point.set(normal.x>0?box.max.x:box.min.x,snapFrom(box.min.y,point.y,step),snapFrom(box.min.z,point.z,step));else point.set(snapFrom(box.min.x,point.x,step),snapFrom(box.min.y,point.y,step),normal.z>0?box.max.z:box.min.z);return point;}
function snapObjectToSurface(object,surface){const normal=surface.normal,center=new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());object.updateWorldMatrix(true,true);let minimumRelativeProjection=Infinity;object.traverse(node=>{if(!node.isMesh||!node.geometry?.attributes.position)return;const position=node.geometry.attributes.position,vertex=new THREE.Vector3();for(let index=0;index<position.count;index++){vertex.fromBufferAttribute(position,index).applyMatrix4(node.matrixWorld);minimumRelativeProjection=Math.min(minimumRelativeProjection,vertex.sub(center).dot(normal));}});if(!Number.isFinite(minimumRelativeProjection))return;const desiredCenter=surface.point.clone().addScaledVector(normal,-minimumRelativeProjection);object.position.add(desiredCenter.sub(center));keepAboveGround(object);updateSelectionHelper();updateInspector();}
function showActiveSnapPoint(hit){const point=surfaceSnapPoint(hit);if(!point){activeSnapPointHelper.visible=false;return;}activeSnapPointHelper.geometry.dispose();activeSnapPointHelper.geometry=new THREE.BufferGeometry();activeSnapPointHelper.geometry.setAttribute("position",new THREE.Float32BufferAttribute(point.toArray(),3));activeSnapPointHelper.visible=true;}
function moveObjectToPlanePoint(object,point,surfaceHit=null){
  const currentBox=new THREE.Box3().setFromObject(object),size=currentBox.getSize(new THREE.Vector3()),center=currentBox.getCenter(new THREE.Vector3()),step=Number($("#snapStep").value),threshold=Math.max(.3,step*.75);
  let x=Math.round(point.x/step)*step,z=Math.round(point.z/step)*step,y=0;
  if(surfaceHit?.face){
    const target=surfaceHit.object,box=new THREE.Box3().setFromObject(target),targetSize=box.getSize(new THREE.Vector3()),targetCenter=box.getCenter(new THREE.Vector3()),normal=surfaceHit.face.normal.clone().transformDirection(surfaceHit.object.matrixWorld),snapPoint=surfaceSnapPoint(surfaceHit),ratio=(value,min,length)=>Math.min(1,Math.max(0,(value-min)/length));    
    if(target.userData.type==="cone"){const config=coneSnapConfig(target),apex=new THREE.Vector3(config.center.x,config.box.max.y,config.center.z);if(snapPoint.distanceTo(apex)<config.step*.75){snapObjectToSurface(object,{point:apex,normal:new THREE.Vector3(0,1,0)});return;}}
    if(normal.y>.5){
      const u=ratio(snapPoint.x,box.min.x,targetSize.x),v=ratio(snapPoint.z,box.min.z,targetSize.z);
      x=targetCenter.x+(u-.5)*(targetSize.x+size.x);z=targetCenter.z+(v-.5)*(targetSize.z+size.z);y=box.max.y;
    }else if(normal.y<-.5){
      const u=ratio(snapPoint.x,box.min.x,targetSize.x),v=ratio(snapPoint.z,box.min.z,targetSize.z);
      x=targetCenter.x+(u-.5)*(targetSize.x+size.x);z=targetCenter.z+(v-.5)*(targetSize.z+size.z);y=Math.max(0,box.min.y-size.y);
    }else if(Math.abs(normal.x)>.5){
      const u=ratio(snapPoint.y,box.min.y,targetSize.y),v=ratio(snapPoint.z,box.min.z,targetSize.z);
      x=normal.x>0?box.max.x+size.x/2:box.min.x-size.x/2;y=Math.max(0,targetCenter.y+(u-.5)*(targetSize.y+size.y)-size.y/2);z=targetCenter.z+(v-.5)*(targetSize.z+size.z);
    }else if(Math.abs(normal.z)>.5){
      const u=ratio(snapPoint.x,box.min.x,targetSize.x),v=ratio(snapPoint.y,box.min.y,targetSize.y);
      z=normal.z>0?box.max.z+size.z/2:box.min.z-size.z/2;x=targetCenter.x+(u-.5)*(targetSize.x+size.x);y=Math.max(0,targetCenter.y+(v-.5)*(targetSize.y+size.y)-size.y/2);
    }
  }
 moveObjectWorld(object,new THREE.Vector3(x-center.x,y-currentBox.min.y,z-center.z));
  if(surfaceHit?.face){
    const target=surfaceHit.object,hitNormal=surfaceHit.face.normal.clone().transformDirection(target.matrixWorld),snapPoint=surfaceSnapPoint(surfaceHit),surface=target.userData.type==="sphere"?sphereSurfaceHit(target,snapPoint):target.userData.type==="cylinder"?cylinderSurfaceHit(target,surfaceHit.point,hitNormal):{point:snapPoint,normal:hitNormal};
    closeAabbSnapGap(object,target);
  }
  
  updateSelectionHelper();updateInspector();
}
canvas.addEventListener("pointerdown",event=>{if(event.button!==0||transform.dragging)return;const ray=rayFromPointer(event);if(activeTool==="translate"&&!animationMode){if(event.ctrlKey||event.metaKey){const hit=ray.intersectObjects(allMeshes())[0];if(hit)select(rootFor(hit.object),true);return;}const object=selected;if(!object){status.value="Select an object before using Move.";return;}const plane=new THREE.Plane(new THREE.Vector3(0,1,0));const point=ray.ray.intersectPlane(plane,new THREE.Vector3());const surfaceHit=moveSurfaceHit(ray,object);if(!point)return;if(visibleGizmoHandleHit(ray))return;event.stopImmediatePropagation();showSnapPoints(surfaceHit?.object);showActiveSnapPoint(surfaceHit);moveObjectToPlanePoint(object,point,surfaceHit);objectDrag={object,plane};canvas.setPointerCapture(event.pointerId);status.value=`Moving ${object.name}`;return;}if((activeTool==="rotate"||activeTool==="scale")&&transform.axis){if(activeTool==="scale"&&transform.axis==="XYZ"&&selected)gizmoScaleDrag={startY:event.clientY,lastY:event.clientY,scale:selected.scale.clone()};return;}const hit=ray.intersectObjects(allMeshes())[0];if(activeTool==="paint"&&hit){paintFace(hit.object,hit.faceIndex);return;}if(activeTool==="paintPrimitive"&&hit){paintPrimitive(hit.object);return;}if(!hit){clearSelection();return;}select(animationMode?hit.object:rootFor(hit.object),event.ctrlKey||event.metaKey||event.shiftKey);},true);
canvas.addEventListener("pointermove",event=>{if(activeTool==="scale"&&transform.dragging&&gizmoScaleDrag)gizmoScaleDrag.lastY=event.clientY;if(activeTool!=="translate"||!selected||(event.buttons&2))return;const ray=rayFromPointer(event);if(transform.dragging){snapPointHelper.visible=false;middleSnapPointHelper.visible=false;activeSnapPointHelper.visible=false;return;}if(!visibleGizmoHandleHit(ray)){transform.axis=null;event.stopImmediatePropagation();}const surfaceHit=moveSurfaceHit(ray,objectDrag?.object||selected);showSnapPoints(surfaceHit?.object);showActiveSnapPoint(surfaceHit);if(!objectDrag||event.ctrlKey||event.metaKey)return;const point=ray.ray.intersectPlane(objectDrag.plane,new THREE.Vector3());if(!point)return;moveObjectToPlanePoint(objectDrag.object,point,surfaceHit);},true);
canvas.addEventListener("pointerup",event=>{if(!objectDrag)return;objectDrag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);commit();});
$("#addMenuButton").onclick=()=>$("#addMenu").hidden=!$("#addMenu").hidden;document.querySelectorAll("[data-primitive]").forEach(button=>button.onclick=()=>{add(button.dataset.primitive);$("#addMenu").hidden=true;});document.querySelectorAll("[data-tool]").forEach(button=>button.onclick=()=>{const mode=button.dataset.tool;activeTool=mode;snapPointHelper.visible=false;middleSnapPointHelper.visible=false;activeSnapPointHelper.visible=false;$("#paintControls").hidden=mode!=="paint"&&mode!=="paintPrimitive";document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("is-active",b===button));const transformTool=["translate","rotate","scale"].includes(mode);if(transformTool&&selected)transform.attach(selected);else transform.detach();transform.setMode(mode==="select"||mode==="paint"||mode==="paintPrimitive"?"translate":mode);updateSelectionHelper();status.value=mode==="paint"?"Paint Face: click a face":mode==="paintPrimitive"?"Paint Primitive: click a mesh":mode==="translate"?"Move: drag gizmo axes or click surfaces for dot placement":animationMode&&transformTool?`Animation pose tool: ${mode}`:"Tool: "+mode;});
$("#frameButton").onclick=frameSelected;
$("#newButton").onclick=()=>{if(roots.length&&!confirm("Start a new empty project?"))return;load({objects:[]});undoStack=[JSON.stringify(snapshot())];status.value="New project";};$("#saveButton").onclick=save;$("#exportButton").onclick=exportGLB;$("#animationModeButton").onclick=()=>setAnimationMode();$("#openButton").onclick=()=>$("#fileInput").click();$("#fileInput").onchange=async e=>{try{load(JSON.parse(await e.target.files[0].text()));}catch(error){status.value=error.message;}e.target.value="";};$("#undoButton").onclick=undo;$("#redoButton").onclick=redo;$("#duplicateButton").onclick=duplicateSelected;$("#groupButton").onclick=groupSelection;$("#ungroupButton").onclick=ungroupSelected;$("#deleteButton").onclick=deleteSelected;$("#inspector").addEventListener("input",event=>{applyInspector();editing=true;});$("#inspector").addEventListener("change",event=>{applyInspector();editing=false;commit();});
$("#resetButton").onclick=resetSelected;
$("#textureInput").onchange=async event=>{const file=event.target.files[0];if(!file||!selected?.isMesh)return;applyTexture(selected,await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);}),file.name,true);event.target.value="";};$("#clearTextureButton").onclick=removeTexture;
$("#snapButton").onclick=()=>{snapEnabled=!snapEnabled;updateSnapping();status.value=snapEnabled?"Transform snap enabled":"Transform snap disabled";};$("#snapStep").onchange=updateSnapping;
$("#timeline").oninput=event=>{isPlaying=false;setAnimationTime(event.target.value);};$("#animationDuration").onchange=event=>{animation.duration=Math.max(.1,Number(event.target.value)||2);setAnimationTime(animationTime);commit();};$("#playbackMode").onchange=event=>{animation.playback=event.target.value;playbackDirection=1;commit();updateAnimationUI();};$("#animationSelect").onchange=event=>selectAnimation(event.target.value);$("#newAnimationButton").onclick=newAnimation;$("#saveAnimationButton").onclick=saveActiveAnimation;$("#deleteAnimationButton").onclick=deleteAnimation;$("#keyframeButton").onclick=setKeyframe;$("#playButton").onclick=togglePlayback;$("#clearAnimationButton").onclick=clearAnimation;
window.addEventListener("keydown",event=>{if(event.target.matches("input"))return;const key=event.key.toLowerCase();if(["w","a","s","d","shift"].includes(key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey){movementKeys.add(key);event.preventDefault();}if(event.key==="Delete")deleteSelected();if(key==="f")frameSelected();if(event.ctrlKey&&key==="d"){event.preventDefault();duplicateSelected();}if(event.ctrlKey&&key==="g"){event.preventDefault();event.shiftKey?ungroupSelected():groupSelection();}if(event.ctrlKey&&key==="z"){event.preventDefault();event.shiftKey?redo():undo();}if(event.ctrlKey&&key==="y"){event.preventDefault();redo();}});window.addEventListener("keyup",event=>movementKeys.delete(event.key.toLowerCase()));window.addEventListener("blur",()=>movementKeys.clear());
function animate(){requestAnimationFrame(animate);const delta=animationClock.getDelta();if(isPlaying){if(animation.playback==="pingpong"){animationTime+=delta*playbackDirection;if(animationTime>=animation.duration){animationTime=animation.duration;playbackDirection=-1;}else if(animationTime<=0){animationTime=0;playbackDirection=1;}}else animationTime=(animationTime+delta)%animation.duration;setAnimationTime(animationTime);}moveCamera(delta);orbit.update();updateSelectionHelper();renderer.render(scene,camera);}resize();updateSnapping();updateOutliner();updateAnimationUI();undoStack=[JSON.stringify(snapshot())];animate();
