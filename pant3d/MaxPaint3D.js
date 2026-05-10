

class MaxPaint3D {
    constructor(canvas,canvas2) {
        this.nextObjectId = 1;
        this.Yblue=false;
        this.canvas = canvas;
        this.canvas2=canvas2;
        this.ctx=this.canvas2.getContext("2d");
        this.selected = null;
        this.scene = new THREE.Scene();
         this.objects = [];
        this.camera = new EditorCamera(this);
        this.renderer = new EditorRenderer(canvas,canvas2, this.scene, this.camera.camera);
        
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        const light = new THREE.DirectionalLight(0xffffff, 1.2);
        light.position.set(60, 120, 60);
        light.castShadow = true;

        // viktig tweak (shadow quality)
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        light.shadow.camera.near = 1;
        light.shadow.camera.left = -160;
        light.shadow.camera.right = 160;
        light.shadow.camera.top = 160;
        light.shadow.camera.bottom = -160;
        light.shadow.camera.far = 300;
        
        
        this.scene.add(light);
        const light2 = new THREE.DirectionalLight(0xffffff, 0.4);
        light2.position.set(-5, 5, -5);
        this.scene.add(light2);
        
        this.input = new InputManager(canvas2,this);
        this.tools = new ToolManager(this);
        this.createGround();
        this.tools.setTool("select");
        this.UI= new UI(canvas2,this.input,this);
        this.createSelectionBox();
        this.groupSelection = [];
        this.groups = [];
        
        this.groupSelection = [];
        this.groupHelpers = [];

        this.clock = {
            lastTime: 0,
            scale: 1
        };
        this.setupLoadInput();
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndo = 30;
        this.isRestoringUndo = false;
        this.scene.background = this.createGradientBackground();
        this.pushUndoState();
        
        this.selectedSubgroup = null;
        this.subgroups = [];
        this.subgroupSelection = [];
        this.selectedSubgroup = null;
        this.poses = [];
        
        this.poseAIndex = 0;
        this.poseBIndex = 1;
        this.poseT = 0;
        this.isPlayingPose = false;
        this.posePlaySpeed = 0.005;
        
        this.animations = [];
        this.selectedAnimation = null;
        this.poseChangedSubgroups = new Set();
        this.currentSegmentDuration = 0.3; // sekunder
        this.poseSegmentDurations = [];
        
        this.suppressSelectionBox=false;
        
    }

    init() {
        
        requestAnimationFrame(t => this.loop(t));
    }

    loop(time) {
        const dt = this.getDelta(time);
        
        this.ctx.clearRect(0,0,canvas2.width,canvas2.height);
        this.updatePosePlayback(this.getDeltaSeconds(time));
        this.updateSelectionBox();
        this.camera.update(this.input, dt);
        this.tools.update(dt);
        this.UI.update();
       
        this.input.update();
        this.updateGroupHelpers();
        
        
        
         this.renderer.render();
        
        
        requestAnimationFrame(t => this.loop(t));
    }

    getDelta(time) {
        if (!this.clock.lastTime) this.clock.lastTime = time;
        let deltaMs = time - this.clock.lastTime;
        this.clock.lastTime = time;

        if (deltaMs > 50) deltaMs = 50;
        return deltaMs / (1000 / 60);
    }
    getDeltaSeconds(time) {
        if (!this.clock.lastTimeSeconds) this.clock.lastTimeSeconds = time;

        let deltaMs = time - this.clock.lastTimeSeconds;
        this.clock.lastTimeSeconds = time;

        if (deltaMs > 50) deltaMs = 50;

        return deltaMs / 1000;
    }

    createGround() {
        const size = 40;
        const divisions = 40;

        const grid = new THREE.GridHelper(size, divisions);
        this.scene.add(grid);

        const geo = new THREE.PlaneGeometry(size, size);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 1
        });

        const ground = new THREE.Mesh(geo, mat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.01; // lite under grid
        ground.name = "ground";
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;
    }
    snapToGrid(value, gridSize = 1) {
        return Math.round(value / gridSize) * gridSize;
    }
    snapPositionToGrid(pos, gridSize = 1) {
        pos.x = this.snapToGrid(pos.x, gridSize);
        pos.z = this.snapToGrid(pos.z, gridSize);
    }
    addPrimitive(type) {
         const mesh = this.createPrimitive(type);
         if (!mesh) return;

        mesh.position.copy(this.camera.target);

        // sätt på marken
      //  const box = new THREE.Box3().setFromObject(mesh);
      //  mesh.position.y -= box.min.y;
        
         if (this.selected) {
            this.placeNewObjectOnTopOfSelected(mesh);
        } else {
            this.placeNewObjectWithOffset(mesh);
            this.placeObjectBottomAtY(mesh, 0);
        }
        
        
        
        
        
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        
        
        this.scene.add(mesh);
        this.objects.push(mesh);
        
        if(this.selected!==null)this.setSelected(null);
        this.selected = mesh;
        this.setSelected(mesh);
        this.pushUndoState();
    }
    placeNewObjectWithOffset(obj) {
        if (!this.lastAddPosition) {
            this.lastAddPosition = new THREE.Vector3(0, 0, 0);
        }

        this.lastAddPosition.x += 1;
        this.lastAddPosition.z += 1;

        obj.position.copy(this.lastAddPosition);
    }
    placeNewObjectOnTopOfSelected(obj) {
        const selected = this.selected;

        const selBox = new THREE.Box3().setFromObject(selected);
        const selCenter = new THREE.Vector3();
        selBox.getCenter(selCenter);

        obj.position.x = selCenter.x;
        obj.position.z = selCenter.z;

        this.placeObjectBottomAtY(obj, selBox.max.y);
    }
    placeObjectBottomAtY(obj, y) {
        const box = new THREE.Box3().setFromObject(obj);

        const bottom = box.min.y;
        const delta = y - bottom;

        obj.position.y += delta;
    }
    setSelected(obj) {
        if (this.selected && this.selected.material) {
            this.selected.material.emissive?.setHex(0x000000);
        }

        this.selected = obj;

        if (this.selected && this.selected.material) {
            this.selected.material.emissive?.setHex(0x333333);
        }
    }
    createSelectionBox() {
        this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x00ffff);
        this.selectionBox.visible = false;
        this.scene.add(this.selectionBox);
    }
    updateSelectionBox() {
        if (!this.selected) {
            this.selectionBox.visible = false;
            return;
        }

        if(!this.suppressSelectionBox)this.selectionBox.visible = true;
        this.selectionBox.setFromObject(this.selected);
    }
    deleteSelected() {
        if (!this.selected) return;

        const obj = this.selected;

        this.setSelected(null);

        if (obj.parent) {
            obj.parent.remove(obj);
        }

        this.objects = this.objects.filter(o => o !== obj);

        if (this.groups) {
            this.groups = this.groups.filter(g => g !== obj);
        }
        this.pushUndoState();
    }
    duplicateSelected() {
        if (!this.selected) return;

        this.selected.updateMatrixWorld(true);

        const clone = this.selected.clone(true);

        clone.traverse(child => {
            child.uuid = THREE.MathUtils.generateUUID();

            if (child.isMesh) {
                if (child.material) child.material = child.material.clone();
                if (child.geometry) child.geometry = child.geometry.clone();
            }
        });

        clone.name = (this.selected.name || "Object") + "_copy";

        clone.position.x += 1;
        clone.position.z += 1;

        this.scene.add(clone);
        clone.updateMatrixWorld(true);

        this.objects.push(clone);
        this.setSelected(clone);
        this.pushUndoState();
    }
    setColor(hex) {
        const obj = this.selected;
        if (!obj) return;

        // Färga inte grupper i V1
        if (!obj.isMesh) return;

        if (!obj.material || !obj.material.color) return;

        // Undvik att ändra andra objekt som delar samma material
        obj.material = obj.material.clone();
        obj.material.color.setHex(hex);
        this.pushUndoState();
    }
    createGroup() {
        if (!this.groupSelection || this.groupSelection.length < 2) return;

        const selectedObjects = [...this.groupSelection];
        if (selectedObjects.length === 0) return;

        const group = new THREE.Group();

  
            group.name = "Group " + (this.groups.length + 1);
            group.userData.isBuildGroup = true;
        

        this.scene.add(group);
        this.scene.updateMatrixWorld(true);

        for (const obj of selectedObjects) {
            group.attach(obj);
        }

        this.objects = this.objects.filter(o => !selectedObjects.includes(o));
        this.objects.push(group);

        this.groups.push(group);
        this.groupSelection = [];

        this.setSelected(group);
        this.ensureObjectId(group);
        this.pushUndoState();
    }
    updateGroupHelpers() {
        // ta bort gamla helpers
        for (const h of this.groupHelpers) {
            this.scene.remove(h);
        }
        this.groupHelpers = [];

        // skapa nya helpers
        for (const obj of this.groupSelection) {
            const helper = new THREE.BoxHelper(obj, 0xffff00);
            this.scene.add(helper);
            this.groupHelpers.push(helper);
        }
        // skapa nya helpers
        for (const obj of this.subgroupSelection) {
            const helper = new THREE.BoxHelper(obj, 0xffff00);
            this.scene.add(helper);
            this.groupHelpers.push(helper);
        
        }
    }
    clearGroupSelection() {
        this.groupSelection = [];

        for (const h of this.groupHelpers) {
            this.scene.remove(h);
        }

        this.groupHelpers = [];
        
    }
    
    
    
    
    
    
    
    getSelectableRoot(obj) {
        let current = obj;

        while (current.parent && current.parent !== this.scene) {
            if (this.objects.includes(current.parent)) {
                return current.parent;
            }

            current = current.parent;
        }

        return current;
    }
    saveToDownload(filename, data) {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });

        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename.endsWith(".mp3d") ? filename : filename + ".mp3d";
        a.click();

        URL.revokeObjectURL(url);
    }
    async saveWithPicker(filename, data) {
        const handle = await window.showSaveFilePicker({
            suggestedName: filename.endsWith(".mp3d") ? filename : filename + ".mp3d",
            types: [{
                description: "MaxPaint3D Model",
                accept: {
                    "application/json": [".mp3d"]
                }
            }]
        });

        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    }
    async saveProject() {
        const data = this.serializeScene();

        try {
            if (window.showSaveFilePicker) {
                await this.saveWithPicker("model.mp3d", data);
            } else {
                this.saveToDownload("model.mp3d", data);
            }
        } catch (err) {
            console.warn("Save cancelled or failed:", err);
        }
    }
    setupLoadInput() {
        this.loadFileInput = document.getElementById("loadFileInput");

        this.loadFileInput.addEventListener("change", async e => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                this.loadProjectData(data);
            } catch (err) {
                console.error("Could not load file:", err);
                alert("Could not load file");
            }

            // gör att samma fil kan öppnas igen
            e.target.value = "";
        });
    }

    openLoadDialog() {
            this.loadFileInput.click();
        }
        async loadWithPicker() {
        const [handle] = await window.showOpenFilePicker({
            types: [{
                description: "MaxPaint3D Model",
                accept: {
                    "application/json": [".mp3d"]
                }
            }],
            multiple: false
        });

        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);

        this.loadProjectData(data);
    }
    async loadProject() {
        // iPhone/Safari fallback
        if (!window.showOpenFilePicker) {
            this.loadFileInput.click();
            return;
        }

        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: "MaxPaint3D Model",
                    accept: {
                        "application/json": [".mp3d", ".json"]
                    }
                }],
                multiple: false
            });

            const file = await handle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);

            this.loadProjectData(data);
            this.pushUndoState();
        } catch (err) {
            console.warn("Load cancelled or failed:", err);
        }
    }
    serializeScene() {
        return {
            version: 2,
            objects: (this.objects || [])
            .filter(obj => !obj.userData?.isPivotMarker)
            .filter(obj => !obj.userData?.isEditorHelper)
            .map(obj => this.serializeNode(obj)),
            animation: this.getAnimationSaveData()
        };
    }

    serializeNode(obj) {
        // Grupp
        if (obj.isGroup) {
            return {
                nodeType: "group",
                id: this.ensureObjectId(obj),
                name: obj.name || "Group",
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                children: obj.children
                    .filter(child => child.isMesh || child.isGroup).filter(child => !child.userData?.isPivotMarker)
                    .map(child => this.serializeNode(child))
            };
        }

        // Primitive / mesh
        if (obj.isMesh) {
            return {
                nodeType: "primitive",
                id: this.ensureObjectId(obj),
                primitiveType: obj.userData.type || "cube",
                name: obj.name || obj.userData.type || "primitive",
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                color: obj.material?.color ? obj.material.color.getHex() : 0xffffff
            };
        }

        return null;
    }
    loadProjectData(data) {
        if (!data || !Array.isArray(data.objects)) {
            console.warn("Invalid file");
            return;
        }

        this.clearSceneObjects();

        for (const saved of data.objects) {
            const obj = this.deserializeNode(saved);
            if (!obj) continue;

            this.scene.add(obj);
            this.objects.push(obj);
        }
        this.loadAnimationSaveData(data.animation);
        this.setSelected(null);
    }
    deserializeNode(saved) {
        if (!saved) return null;

        let obj = null;

        // Grupp
        if (saved.nodeType === "group") {
            obj = new THREE.Group();
            obj.name = saved.name || "Group";
            obj.userData.isGroup = true;
            if (saved.id) {
                obj.userData.id = saved.id;
                this.nextObjectId = Math.max(this.nextObjectId, saved.id + 1);
            }
            obj.position.set(
                saved.position?.x || 0,
                saved.position?.y || 0,
                saved.position?.z || 0
            );

            obj.rotation.set(
                saved.rotation?.x || 0,
                saved.rotation?.y || 0,
                saved.rotation?.z || 0
            );

            obj.scale.set(
                saved.scale?.x ?? 1,
                saved.scale?.y ?? 1,
                saved.scale?.z ?? 1
            );

            if (Array.isArray(saved.children)) {
                for (const childSaved of saved.children) {
                    const child = this.deserializeNode(childSaved);
                    if (child) obj.add(child);
                }
            }

            return obj;
        }

        // Primitive
        if (saved.nodeType === "primitive") {
            obj = this.createPrimitive(saved.primitiveType);
            if (!obj) return null;

            obj.name = saved.name || saved.primitiveType;
            obj.userData.type = saved.primitiveType;
            if (saved.id) {
                obj.userData.id = saved.id;
                this.nextObjectId = Math.max(this.nextObjectId, saved.id + 1);
            }
            obj.position.set(
                saved.position?.x || 0,
                saved.position?.y || 0,
                saved.position?.z || 0
            );

            obj.rotation.set(
                saved.rotation?.x || 0,
                saved.rotation?.y || 0,
                saved.rotation?.z || 0
            );

            obj.scale.set(
                saved.scale?.x ?? 1,
                saved.scale?.y ?? 1,
                saved.scale?.z ?? 1
            );

            if (saved.color != null && obj.material?.color) {
                obj.material = obj.material.clone();
                obj.material.color.setHex(saved.color);
            }

            return obj;
        }

        console.warn("Unknown nodeType:", saved.nodeType);
        return null;
    }
    createPrimitive(type) {
        let geo;

        if (type === "cube") {
            geo = new THREE.BoxGeometry(2, 2, 2);
        }
        else if (type === "cone") {
            geo = new THREE.ConeGeometry(1, 2, 8);
        }
        else if (type === "cylinder") {
            geo = new THREE.CylinderGeometry(1, 1, 2, 8);
        }
        else if (type === "sphere") {
            geo = new THREE.SphereGeometry(1, 8, 6);
        }
        else if (type === "plane") {
            geo = new THREE.BoxGeometry(2, 0.1, 2);
        }

        if (!geo) {
            console.warn("Unknown primitive type:", type);
            return null;
        }

        const mat = new THREE.MeshStandardMaterial({color: 0x66aa55,roughness: 0.7,metalness: 0.0});
        const obj = new THREE.Mesh(geo, mat);
        obj.userData.type = type;
        obj.name = type;
            // viktigt för både add och load
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.ensureObjectId(obj);
        return obj;
    }
    clearSceneObjects() {
        for (const obj of this.objects) {
            this.scene.remove(obj);
            this.disposeNode(obj);
        }

        this.objects = [];
        this.selected = null;
    }
    disposeNode(obj) {
        if (obj.isGroup) {
            for (const child of obj.children) {
                this.disposeNode(child);
            }
        }

        if (obj.geometry) obj.geometry.dispose();

        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
            } else {
                obj.material.dispose();
            }
        }
    }
    getSceneSnapshot() {
        return JSON.stringify({
            scene: this.serializeScene(),
            selectedId: this.selected ? this.ensureObjectId(this.selected) : null
        });
    }
    pushUndoState() {
        if (this.isRestoringUndo) return;

        const snapshot = this.getSceneSnapshot();

        // undvik dubbletter
        if (this.undoStack.length > 0) {
            const last = this.undoStack[this.undoStack.length - 1];
            if (last === snapshot) return;
        }

        this.undoStack.push(snapshot);

        if (this.undoStack.length > this.maxUndo) {
            this.undoStack.shift();
        }

        // ny ändring gör redo ogiltig
        this.redoStack = [];
    }
    undo() {
        if (this.undoStack.length <= 1) return;

        this.isRestoringUndo = true;

        const current = this.undoStack.pop();
        this.redoStack.push(current);

        const previous = this.undoStack[this.undoStack.length - 1];
        this.restoreSnapshot(previous);

        this.isRestoringUndo = false;
    }
    redo() {
        if (this.redoStack.length === 0) return;

        this.isRestoringUndo = true;

        const snapshot = this.redoStack.pop();

        this.restoreSnapshot(snapshot);
        this.undoStack.push(snapshot);

        this.isRestoringUndo = false;
    }
    beginEdit() {
        if (this.editing) return;

        this.editing = true;
        this.editStartSnapshot = this.getSceneSnapshot();
    }
    endEdit() {
        if (!this.editing) return;

        const before = this.editStartSnapshot;
        const after = this.getSceneSnapshot();

        this.editing = false;
        this.editStartSnapshot = null;

        if (before !== after) {
            this.pushUndoState();
        }
    }
    ensureObjectId(obj) {
        if (!obj.userData.id) {
            obj.userData.id = this.nextObjectId++;
        }

        return obj.userData.id;
    }
    findObjectById(id) {
        if (!id) return null;

        for (const root of this.objects) {
            let found = null;

            root.traverse(obj => {
                if (found) return;
                if (obj.userData?.id === id) {
                    found = obj;
                }
            });

            if (found) return found;
        }

        return null;
    }
    restoreSnapshot(snapshotText) {
        const snapshot = JSON.parse(snapshotText);

        this.loadProjectData(snapshot.scene);

        const selected = this.findObjectById(snapshot.selectedId);
        this.setSelected(selected || null);
    }
    createGradientBackground() {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 512;

        const ctx = canvas.getContext("2d");

        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0.0, "#3346c9");   // mörk topp
        grad.addColorStop(0.5, "#add8e6");   // mellanblå
        grad.addColorStop(1.0, "#ffffff");   // ljusare nere

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;

        return tex;
    }
    exportGLB() {
        this.ensureUniqueObjectNames();

        const clips = this.createAnimationClipsForExport();

        console.log("Exporting animation clips:", clips.map(c => c.name));

        const exporter = new THREE.GLTFExporter();

        const exportRoot = new THREE.Group();
        exportRoot.name = "MaxPaint3D_Model";
        this.removeEditorObjectsFromClone(exportRoot);
        for (const obj of this.objects) {
            const clone = obj.clone(true);

            clone.traverse(child => {
                // Ta bort editor/pivot markers om någon råkar ligga i modellen
                if (child.userData?.isPivotMarker) {
                    child.visible = false;
                }

                if (child.isMesh) {
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material = child.material.map(m => m.clone());
                        } else {
                            child.material = child.material.clone();
                        }
                    }

                    child.castShadow = false;
                    child.receiveShadow = false;
                }
            });

            exportRoot.add(clone);
        }




        exporter.parse(
            exportRoot,
            async (result) => {
                const blob = new Blob([result], {
                    type: "model/gltf-binary"
                });

                await this.saveBlob(
                    blob,
                    "maxpaint3d_model.glb",
                    "model/gltf-binary",
                    ".glb",
                    "GLB 3D Model"
                );
            },
            (error) => {
                console.error("GLB export failed:", error);
                alert("Export failed");
            },
            {
                binary: true,
                onlyVisible: false,
                trs: true,
                animations: clips
            }
        );
    }
    async saveBlob(blob, filename, mimeType, extension, description) {
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: description,
                        accept: {
                            [mimeType]: [extension]
                        }
                    }]
                });

                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else {
                this.downloadBlob(blob, filename);
            }
        } catch (err) {
            console.warn("Save cancelled or failed:", err);
        }
    }
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
    }
    countTriangles() {
        let triangles = 0;
        let meshes = 0;
        let groups = 0;

        for (const root of this.objects) {
            
            root.traverse(obj => {
                if(obj.userData?.isPivotMarker) return;
                if (obj.userData?.isEditorHelper) return;
                if (obj.userData?.ignoreTriangleCount) return;
                if (obj.isGroup) groups++;

                if (obj.isMesh && obj.geometry) {
                    meshes++;

                    const geo = obj.geometry;

                    if (geo.index) {
                        triangles += geo.index.count / 3;
                    } else if (geo.attributes.position) {
                        triangles += geo.attributes.position.count / 3;
                    }
                }
            });
        }

        return {
            triangles: Math.floor(triangles),
            meshes,
            groups
        };
    }
    enterAnimateMode() {
        if (!this.modelGroup) {
            this.createModelGroupFromAllObjects();
        }
        this.setPivotMarkersVisible(true);
        this.animatetoggle = true;
        this.currentTool = "anim_select";
        this.selected = this.modelGroup;
    }

    exitAnimateMode() {
        this.animatetoggle = false;

        this.selectedSubgroup = null;
        this.subgroupSelection = [];
        this.poseChangedSubgroups?.clear?.();

        this.setPivotMarkersVisible(false);
        this.clearGroupHelpers?.();

        // Viktigt: välj modelGroup eller inget, inte subgroup
        if (this.modelGroup) {
            this.setSelected(this.modelGroup);
        } else {
            this.setSelected(null);
        }

        this.tools.setTool("select");
    }
    exitPrimSelectMode() {
        const selected = this.selected;

        if (!selected) return;

        // Om selected är en mesh inuti en group/model
        if (selected.isMesh && selected.parent) {
            const root = this.getBuildSelectableRoot(selected);
            this.setSelected(root);
        }
    }
    getBuildSelectableRoot(obj) {
        let current = obj;

        while (
            current.parent &&
            current.parent !== this.scene &&
            current.parent !== this.modelGroup
        ) {
            current = current.parent;
        }

        return current;
    }
    createModelGroupFromAllObjects() {
        if (this.modelGroup) return this.modelGroup;

        this.scene.updateMatrixWorld(true);

        const primitives = [];

        // Samla från this.objects, men gå igenom barn också
        for (const root of this.objects || []) {
            if (!root || root === this.ground) continue;

            root.traverse(obj => {
                if (
                    obj.isMesh &&
                    !obj.userData?.isPivotMarker &&
                    obj !== this.ground
                ) {
                    primitives.push(obj);
                }
            });
        }

        // Fallback om objects-listan är fel
        if (primitives.length === 0) {
            this.scene.traverse(obj => {
                if (
                    obj.isMesh &&
                    !obj.userData?.isPivotMarker &&
                    obj !== this.ground
                ) {
                    primitives.push(obj);
                }
            });
        }

        if (primitives.length === 0) {
            console.warn("No primitives found for ModelGroup");
            return null;
        }

        const model = new THREE.Group();
        model.name = "Model";
        model.userData.isModelGroup = true;

        this.scene.add(model);
        this.scene.updateMatrixWorld(true);

        for (const obj of primitives) {
            this.ensureObjectId(obj);
            model.attach(obj);
        }

        this.removeEmptyGroups(this.scene);

        this.objects = [model];
        this.groups = [];
        this.modelGroup = model;

        this.groupSelection = [];
        this.subgroupSelection = [];
        this.selectedSubgroup = null;

        this.setSelected(model);
        this.ensureObjectId(model);

        this.scene.updateMatrixWorld(true);
        this.pushUndoState?.();

        console.log("Created ModelGroup with primitives:", primitives.length);

        return model;
    }
    createSubgroup() {
        if (!this.modelGroup) return;
        if (!this.subgroupSelection || this.subgroupSelection.length === 0) return;

        let name = prompt("Subgroup name:", "Subgroup " + (this.subgroups.length + 1));
        if (!name) name = "Subgroup " + (this.subgroups.length + 1);

        const selectedObjects = [...this.subgroupSelection];

        const subgroup = new THREE.Group();
        subgroup.name = name;
        subgroup.userData.isSubgroup = true;

        this.modelGroup.add(subgroup);
        this.scene.updateMatrixWorld(true);

        for (const obj of selectedObjects) {
            subgroup.attach(obj);
        }

        this.subgroups.push(subgroup);

        this.subgroupSelection = [];
        this.selectedSubgroup = subgroup;
        this.setSelected(subgroup);

        this.createPivotMarker?.(subgroup);
        this.saveSubgroupRestTransform?.(subgroup);

        this.ensureObjectId(subgroup);
        this.pushUndoState();
    }
    deleteSelectedSubgroup() {
        const subgroup = this.selectedSubgroup;

        if (!subgroup) return;
        if (!subgroup.userData?.isSubgroup) return;
        if (!this.modelGroup) return;

        this.scene.updateMatrixWorld(true);

        const children = [...subgroup.children];

        for (const child of children) {
            this.modelGroup.attach(child);
        }

        this.modelGroup.remove(subgroup);

        this.subgroups = this.subgroups.filter(sg => sg !== subgroup);

        if (this.selected === subgroup) {
            this.setSelected(null);
        }

        this.selectedSubgroup = null;
        this.subgroupSelection = [];
        this.updateGroupHelpers?.();

        this.pushUndoState();
    }
    renameSelectedSubgroup() {
        const subgroup = this.selectedSubgroup;
        if (!subgroup) return;

        const name = prompt("Rename subgroup:", subgroup.name);
        if (!name) return;

        subgroup.name = name;
        this.pushUndoState();
    }
    createPivotMarker(subgroup) {
        const geo = new THREE.SphereGeometry(0.12, 12, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000,depthTest: false });

        const marker = new THREE.Mesh(geo, mat);
        marker.name = subgroup.name + "_pivot";
        marker.userData.isPivotMarker = true;

        this.scene.add(marker);

        subgroup.userData.pivotMarker = marker;
        // starta vid subgroupens bounding box-center
        const box = new THREE.Box3().setFromObject(subgroup);
        const center = box.getCenter(new THREE.Vector3());

        marker.position.copy(center);
    }
    rotateObjectAroundWorldPoint(obj, point, axis, angle) {
        const q = new THREE.Quaternion();
        q.setFromAxisAngle(axis.normalize(), angle);

        obj.position.sub(point);
        obj.position.applyQuaternion(q);
        obj.position.add(point);

        obj.quaternion.premultiply(q);

        obj.updateMatrixWorld(true);
    }
    resetSelectedSubgroupTransform() {
        const sg = this.selectedSubgroup;
        if (!sg) return;

        const restPos = sg.userData.restPosition;
        const restQuat = sg.userData.restQuaternion;
        const restScale = sg.userData.restScale;

        if (!restPos || !restQuat || !restScale) return;

        this.beginEdit?.();

        sg.position.copy(restPos);
        sg.quaternion.copy(restQuat);
        sg.scale.copy(restScale);

        sg.updateMatrixWorld(true);
        this.markSubgroupChanged(sg);
        this.endEdit?.();
        this.pushUndoState?.();
    }
    saveSubgroupRestTransform(subgroup) {
        subgroup.userData.restPosition = subgroup.position.clone();
        subgroup.userData.restQuaternion = subgroup.quaternion.clone();
        subgroup.userData.restScale = subgroup.scale.clone();
    }
    savePose() {
        const groupsToSave = this.getPoseSubgroupsToSave();

        if (groupsToSave.length === 0) {
            alert("Move/rotate one or more subgroups first.");
            return;
        }

        let name = prompt("Pose name:", "Pose " + (this.poses.length + 1));
        if (!name) name = "Pose " + (this.poses.length + 1);

        const pose = {
            name,
            groups: {}
        };

        for (const sg of groupsToSave) {
            this.ensureObjectId(sg);

            pose.groups[sg.userData.id] = {
                name: sg.name,
                position: {
                    x: sg.position.x,
                    y: sg.position.y,
                    z: sg.position.z
                },
                quaternion: {
                    x: sg.quaternion.x,
                    y: sg.quaternion.y,
                    z: sg.quaternion.z,
                    w: sg.quaternion.w
                },
                scale: {
                    x: sg.scale.x,
                    y: sg.scale.y,
                    z: sg.scale.z
                }
            };
        }

        // Om det redan finns minst 1 pose,
        // då skapas ett nytt segment från förra posen till denna
        if (this.poses.length >= 1) {
            this.poseSegmentDurations.push(this.currentSegmentDuration);
        }

        this.poses.push(pose);

        console.log("Saved pose:", pose);
        console.log("Segment speeds:", this.poseSegmentSpeeds);
    }
    loadPose(pose) {
        if (!pose) return;

        for (const sg of this.subgroups) {
            const id = sg.userData.id;
            const data = pose.groups[id];

            if (!data) continue;

            sg.position.set(
                data.position.x,
                data.position.y,
                data.position.z
            );

            sg.quaternion.set(
                data.quaternion.x,
                data.quaternion.y,
                data.quaternion.z,
                data.quaternion.w
            );

            sg.scale.set(
                data.scale.x,
                data.scale.y,
                data.scale.z
            );

            sg.updateMatrixWorld(true);
        }

        this.updateGroupHelpers?.();
    }
    loadLastPose() {
        if (!this.poses || this.poses.length === 0) return;

        this.loadPose(this.poses[this.poses.length - 1]);
    }
    interpolatePoses(poseA, poseB, t) {
        if (!poseA || !poseB) return;

        t = Math.max(0, Math.min(1, t));

        for (const sg of this.subgroups) {
            const id = sg.userData.id;

            const a = poseA.groups[id];
            const b = poseB.groups[id];

            // Om animationen inte innehåller denna subgroup:
            // lämna den helt orörd.
            if (!a || !b) continue;

            sg.position.set(
                THREE.MathUtils.lerp(a.position.x, b.position.x, t),
                THREE.MathUtils.lerp(a.position.y, b.position.y, t),
                THREE.MathUtils.lerp(a.position.z, b.position.z, t)
            );

            sg.scale.set(
                THREE.MathUtils.lerp(a.scale.x, b.scale.x, t),
                THREE.MathUtils.lerp(a.scale.y, b.scale.y, t),
                THREE.MathUtils.lerp(a.scale.z, b.scale.z, t)
            );

            const qa = new THREE.Quaternion(
                a.quaternion.x,
                a.quaternion.y,
                a.quaternion.z,
                a.quaternion.w
            );

            const qb = new THREE.Quaternion(
                b.quaternion.x,
                b.quaternion.y,
                b.quaternion.z,
                b.quaternion.w
            );

            sg.quaternion.copy(qa).slerp(qb, t);
            sg.updateMatrixWorld(true);
        }
    }
    togglePosePlay() {
        if (!this.poses || this.poses.length < 2) return;

        this.poseAIndex = 0;
        this.poseBIndex = 1;
         this.resetAllSubgroups();
        this.isPlayingPose = !this.isPlayingPose;
    }
    setSubgroupPivot(subgroup, pivotWorld) {
        if (!subgroup || !this.modelGroup) return;

        this.scene.updateMatrixWorld(true);
        this.modelGroup.updateMatrixWorld(true);
        subgroup.updateMatrixWorld(true);

        const children = [...subgroup.children];

        // Ta inte med pivotMarker om den råkar ligga i subgroupen
        const realChildren = children.filter(child => !child.userData?.isPivotMarker);

        // Flytta ut barnen temporärt till modelGroup, behåll world transform
        for (const child of realChildren) {
            this.modelGroup.attach(child);
        }

        // World pivot -> local pivot i modelGroup
        const pivotLocal = this.modelGroup.worldToLocal(pivotWorld.clone());

        // Sätt subgroupens origin till pivoten
        subgroup.position.copy(pivotLocal);
        subgroup.quaternion.identity();
        subgroup.scale.set(1, 1, 1);

        if (subgroup.parent !== this.modelGroup) {
            this.modelGroup.add(subgroup);
        }

        subgroup.updateMatrixWorld(true);
        this.modelGroup.updateMatrixWorld(true);

        // Flytta tillbaka barnen in i subgroupen, behåll world transform
        for (const child of realChildren) {
            subgroup.attach(child);
        }

        // Spara pivot local
        subgroup.userData.pivotLocal = pivotLocal.clone();

        // Valfritt debug/säkerhet
        subgroup.userData.pivot = pivotWorld.clone();

        // Flytta marker till samma local-position i modelGroup
        if (subgroup.userData.pivotMarker) {
            const marker = subgroup.userData.pivotMarker;

            if (marker.parent !== this.modelGroup) {
                this.modelGroup.attach(marker);
            }

            marker.position.copy(pivotLocal);
        }

        subgroup.userData.restPosition = subgroup.position.clone();
        subgroup.userData.restQuaternion = subgroup.quaternion.clone();
        subgroup.userData.restScale = subgroup.scale.clone();

        subgroup.updateMatrixWorld(true);
    }
    applyPivotToSelectedSubgroup() {
        const sg = this.selectedSubgroup;
        if (!sg) return;

        const marker = sg.userData.pivotMarker;
        if (!marker) return;

        const pivotWorld = marker.getWorldPosition(new THREE.Vector3());

        this.setSubgroupPivot(sg, pivotWorld);
    }
    createPivotMarker(subgroup) {
        if (!this.modelGroup) return;

        const geo = new THREE.SphereGeometry(0.12, 6, 4);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            depthTest: false
        });

        const marker = new THREE.Mesh(geo, mat);
        marker.name = subgroup.name + "_pivot";
        marker.userData.isPivotMarker = true;
        marker.renderOrder = 999;

        this.scene.updateMatrixWorld(true);
        subgroup.updateMatrixWorld(true);
        this.modelGroup.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(subgroup);
        const centerWorld = box.getCenter(new THREE.Vector3());

        // gör world-position till local-position i modelGroup
        const centerLocal = this.modelGroup.worldToLocal(centerWorld.clone());

        marker.position.copy(centerLocal);

        this.modelGroup.add(marker);

        subgroup.userData.pivotMarker = marker;
        subgroup.userData.pivotLocal = centerLocal.clone();
    }
    
    
    createAnimation() {
        if (!this.poses || this.poses.length < 2) {
            alert("Need at least 2 poses.");
            return;
        }

        let name = prompt("Animation name:", "Animation " + (this.animations.length + 1));
        if (!name) name = "Animation " + (this.animations.length + 1);

        const anim = {
            name,
            poses: JSON.parse(JSON.stringify(this.poses)),
            segmentDurations: [...this.poseSegmentDurations],
            mode: "loop",
            playing: false,
            segmentIndex: 0,
            segmentT: 0,
            direction: 1,
            speedPercent: 100
        };

        this.animations.push(anim);
        this.selectedAnimation = anim;

        // reset draft
        this.poses = [];
        this.poseSegmentSpeeds = [];
        this.currentSegmentSpeed = 0.005;
        this.poseChangedSubgroups.clear?.();

        console.log("Created animation:", anim);
    }
    playSelectedAnimation() {
        if (!this.selectedAnimation) {
            if (this.animations.length > 0) {
                this.selectedAnimation = this.animations[0];
            } else {
                return;
            }
        }

        this.poseAIndex = this.selectedAnimation.poseAIndex;
        this.poseBIndex = this.selectedAnimation.poseBIndex;
        this.posePlaySpeed = this.selectedAnimation.speed;

        this.isPlayingPose = true;
    }
    toggleAnimationPlay(anim) {
        if (anim.playing) {
            anim.playing = false;
            anim.time = 0;
            anim.segmentIndex = 0;
            anim.segmentT = 0;
            anim.direction = 1;

            
            this.selectedAnimation = anim;
         //   if(this.animations.filter(e => e.playing === true).length===0)this.resetAllSubgroups();
            
           this.resetAllSubgroups();
            
            return;
        }

        this.playAnimation(anim);
    }

    changeAnimationSpeedPercent(deltaPercent) {
        const anim = this.selectedAnimation;

        if (!anim) {
            alert("Select an animation first.");
            return;
        }

        if (anim.speedPercent === undefined) {
            anim.speedPercent = 100;
        }

        anim.speedPercent += deltaPercent;

        if (anim.speedPercent < 10) {
            anim.speedPercent = 10;
        }

        if (anim.speedPercent > 400) {
            anim.speedPercent = 400;
        }

        console.log(anim.name + " speed:", anim.speedPercent + "%");
    }
    playAnimation(anim) {
        if (!anim || !anim.poses || anim.poses.length < 2) return;

        this.selectedAnimation = anim;
        anim.playing = true;
        this.poseTime = 0;
        this.isPlayingPose = true;
     // För once: play ska alltid starta om från början
    if (anim.mode === "once") {
        this.startAnimation(anim);
        return;
    }
        
    }
    startAnimation(anim) {
        if (!anim) return;

        this.selectedAnimation = anim;

        anim.playing = true;

        // nolla playback state
        anim.time = 0;
        anim.segmentIndex = 0;
        anim.segmentT = 0;
        anim.direction = 1;

        anim.playOrder = ++this.animationPlayCounter;
    }
    
    deleteAnimation(anim) {
        if (!anim) return;

        const ok = confirm("Delete animation '" + anim.name + "'?");
        if (!ok) return;

        this.animations = this.animations.filter(a => a !== anim);

        if (this.selectedAnimation === anim) {
            this.selectedAnimation = null;
        }

        if (this.currentPlayingAnimation === anim) {
            this.currentPlayingAnimation = null;
            this.isPlayingPose = false;
        }
    }
    resetAllSubgroups() {
        for (const sg of this.subgroups) {
            if (!sg.userData.restPosition) continue;

            sg.position.copy(sg.userData.restPosition);
            sg.quaternion.copy(sg.userData.restQuaternion);
            sg.scale.copy(sg.userData.restScale);

            sg.updateMatrixWorld(true);
        }
    }
    getPoseSubgroupsToSave() {
        if (this.poseChangedSubgroups && this.poseChangedSubgroups.size > 0) {
            return [...this.poseChangedSubgroups];
        }

        if (this.selectedSubgroup) {
            return [this.selectedSubgroup];
        }

        return [];
    }
    markSubgroupChanged(sg) {
        if (!sg) return;
        if (!this.poseChangedSubgroups) this.poseChangedSubgroups = new Set();

        this.poseChangedSubgroups.add(sg);
    }
    updateAnimation(anim, dt) {
        if (!anim.poses || anim.poses.length < 2) return;

        if (anim.segmentIndex === undefined) anim.segmentIndex = 0;
        if (anim.segmentT === undefined) anim.segmentT = 0;
        if (anim.direction === undefined) anim.direction = 1;
        if (!anim.mode) anim.mode = "loop";

        const lastSegment = anim.poses.length - 2;

        if (!anim.segmentDurations || anim.segmentDurations.length === 0) {
            anim.segmentDurations = new Array(anim.poses.length - 1).fill(0.3);
        }

        anim.segmentIndex = Math.max(0, Math.min(anim.segmentIndex, lastSegment));

        const duration = anim.segmentDurations[anim.segmentIndex] ?? 0.3;
        const speedMultiplier = (anim.speedPercent ?? 100) / 100;

        anim.segmentT += (dt * speedMultiplier) / duration;

        while (anim.segmentT >= 1) {
            anim.segmentT -= 1;

            if (anim.mode === "loop") {
                anim.segmentIndex++;

                if (anim.segmentIndex > lastSegment) {
                    anim.segmentIndex = 0;
                }
            }

            else if (anim.mode === "once") {
                anim.segmentIndex++;

                if (anim.segmentIndex > lastSegment) {
                    anim.segmentIndex = lastSegment;
                    anim.segmentT = 1;
                    anim.playing = false;
                    break;
                }
            }

            else if (anim.mode === "pingpong") {
                if (anim.direction === 1) {
                    if (anim.segmentIndex < lastSegment) {
                        anim.segmentIndex++;
                    } else {
                        anim.direction = -1;
                    }
                } else {
                    if (anim.segmentIndex > 0) {
                        anim.segmentIndex--;
                    } else {
                        anim.direction = 1;
                    }
                }
            }
        }

        let poseA;
        let poseB;
        let t = anim.segmentT;

        if (anim.mode === "pingpong" && anim.direction === -1) {
            poseA = anim.poses[anim.segmentIndex + 1];
            poseB = anim.poses[anim.segmentIndex];
        } else {
            poseA = anim.poses[anim.segmentIndex];
            poseB = anim.poses[anim.segmentIndex + 1];
        }


        if (!poseA || !poseB) return;

        this.interpolatePoses(poseA, poseB, t);
    }
    updatePosePlayback(dt) {
        const playingAnimations = this.animations.filter(e => e.playing === true);

        for (const anim of playingAnimations) {
            this.updateAnimation(anim, dt);
        }

        if (playingAnimations.length > 0) {
            return;
        }

        // Preview-läge för osparade poses
        if (!this.isPlayingPose) return;
        if (!this.poses || this.poses.length < 2) return;

        if (!this.previewAnim) {
            this.previewAnim = {
                poses: JSON.parse(JSON.stringify(this.poses)),
                segmentDurations: [...this.poseSegmentDurations],
                mode: "loop",
                playing: false,
                segmentIndex: 0,
                segmentT: 0,
                direction: 1,
                speedPercent: 100
            };
        }

 
            
       


        this.previewAnim.poses = this.poses;


        this.updateAnimation(this.previewAnim, dt);
    }

    changeCurrentSegmentDuration(delta) {
        this.currentSegmentDuration += delta;

        if (this.currentSegmentDuration < 0.05) {
            this.currentSegmentDuration = 0.05;
        }

        if (this.currentSegmentDuration > 5.0) {
            this.currentSegmentDuration = 5.0;
        }

        console.log("Current segment duration:", this.currentSegmentDuration);
    }
    scaleSubgroupKeepCenter(sg, scaleFunc) {
        if (!sg) return;

        this.scene.updateMatrixWorld(true);

        const beforeBox = new THREE.Box3().setFromObject(sg);
        const beforeCenter = beforeBox.getCenter(new THREE.Vector3());

        // ändra scale
        scaleFunc();

        // skydda mot för liten/negativ scale
        sg.scale.x = Math.max(0.05, sg.scale.x);
        sg.scale.y = Math.max(0.05, sg.scale.y);
        sg.scale.z = Math.max(0.05, sg.scale.z);

        sg.updateMatrixWorld(true);
        this.scene.updateMatrixWorld(true);

        const afterBox = new THREE.Box3().setFromObject(sg);
        const afterCenter = afterBox.getCenter(new THREE.Vector3());

        // world-delta som behövs för att flytta tillbaka centret
        const deltaWorld = beforeCenter.sub(afterCenter);

        // konvertera world-delta till parent-local delta
        const parent = sg.parent;
        if (parent) {
            const parentQuat = new THREE.Quaternion();
            parent.getWorldQuaternion(parentQuat);

            const parentScale = new THREE.Vector3();
            parent.getWorldScale(parentScale);

            deltaWorld.applyQuaternion(parentQuat.invert());

            deltaWorld.x /= parentScale.x;
            deltaWorld.y /= parentScale.y;
            deltaWorld.z /= parentScale.z;
        }

        sg.position.add(deltaWorld);

        sg.updateMatrixWorld(true);
        this.markSubgroupChanged?.(sg);
    }
    getAnimationModeLabel(anim) {
        if (!anim.mode) anim.mode = "loop";

        if (anim.mode === "loop") return "L";
        if (anim.mode === "once") return "O";
        if (anim.mode === "pingpong") return "P";

        return "?";
    }
    cycleAnimationMode(anim) {
        if (!anim) return;

        if (!anim.mode) anim.mode = "loop";

        if (anim.mode === "loop") {
            anim.mode = "once";
        } else if (anim.mode === "once") {
            anim.mode = "pingpong";
        } else {
            anim.mode = "loop";
        }

        console.log(anim.name + " mode:", anim.mode);
    }
    getAnimationSaveData() {
        const subgroups = this.subgroups || [];
        const animations = this.animations || [];

        return {
            version: 2,

            modelGroupId: this.modelGroup ? this.ensureObjectId(this.modelGroup) : null,

            subgroups: subgroups.map(sg => {
                this.ensureObjectId(sg);

                const pivot = sg.userData.pivotMarker
                    ? sg.userData.pivotMarker.position
                    : (sg.userData.pivot || sg.position);

                return {
                    id: sg.userData.id,
                    name: sg.name,

                    childIds: sg.children.map(child => this.ensureObjectId(child)),

                    pivot: {
                        x: pivot.x,
                        y: pivot.y,
                        z: pivot.z
                    },

                    restPosition: sg.userData.restPosition ? {
                        x: sg.userData.restPosition.x,
                        y: sg.userData.restPosition.y,
                        z: sg.userData.restPosition.z
                    } : null,

                    restQuaternion: sg.userData.restQuaternion ? {
                        x: sg.userData.restQuaternion.x,
                        y: sg.userData.restQuaternion.y,
                        z: sg.userData.restQuaternion.z,
                        w: sg.userData.restQuaternion.w
                    } : null,

                    restScale: sg.userData.restScale ? {
                        x: sg.userData.restScale.x,
                        y: sg.userData.restScale.y,
                        z: sg.userData.restScale.z
                    } : null
                };
            }),

            animations: animations.map(anim => ({
                name: anim.name,
                poses: anim.poses || [],
                segmentDurations: anim.segmentDurations || [],
                mode: anim.mode || "loop",
                speedPercent: anim.speedPercent ?? 100
            }))
        };
    }
    loadAnimationSaveData(data) {
        if (!data) return;

        this.subgroups = [];
        this.animations = [];
        this.selectedSubgroup = null;
        this.selectedAnimation = null;
        this.subgroupSelection = [];
        this.poseChangedSubgroups = new Set();

        const objectMap = this.buildObjectMap();

        this.modelGroup = data.modelGroupId
            ? objectMap.get(data.modelGroupId)
            : null;

        if (!this.modelGroup) {
            console.warn("No modelGroup found in animation data");
            return;
        }

        // återskapa subgroups
        for (const sgData of data.subgroups || []) {
            const subgroup = objectMap.get(sgData.id);

            if (!subgroup) {
                console.warn("Missing subgroup:", sgData.name, sgData.id);
                continue;
            }

            subgroup.name = sgData.name;
            subgroup.userData.isSubgroup = true;

            if (sgData.restPosition) {
                subgroup.userData.restPosition = new THREE.Vector3(
                    sgData.restPosition.x,
                    sgData.restPosition.y,
                    sgData.restPosition.z
                );
            }

            if (sgData.restQuaternion) {
                subgroup.userData.restQuaternion = new THREE.Quaternion(
                    sgData.restQuaternion.x,
                    sgData.restQuaternion.y,
                    sgData.restQuaternion.z,
                    sgData.restQuaternion.w
                );
            }

            if (sgData.restScale) {
                subgroup.userData.restScale = new THREE.Vector3(
                    sgData.restScale.x,
                    sgData.restScale.y,
                    sgData.restScale.z
                );
            }

            this.subgroups.push(subgroup);

            // pivot marker
            if (sgData.pivot) {
                this.createPivotMarker(subgroup);

                const marker = subgroup.userData.pivotMarker;
                if (marker) {
                    marker.position.set(
                        sgData.pivot.x,
                        sgData.pivot.y,
                        sgData.pivot.z
                    );
                }

                subgroup.userData.pivot = new THREE.Vector3(
                    sgData.pivot.x,
                    sgData.pivot.y,
                    sgData.pivot.z
                );
            }
        }

        // animations
        this.animations = (data.animations || []).map(anim => {
            const loaded = {
                name: anim.name,
                poses: anim.poses || [],
                segmentDurations: anim.segmentDurations || [],
                mode: anim.mode || "loop",
                speedPercent: anim.speedPercent ?? 100
            };

            this.restoreAnimationRuntimeState(loaded);

            return loaded;
        });
    }
    buildObjectMap() {
        const map = new Map();

        this.scene.traverse(obj => {
            if (obj.userData && obj.userData.id) {
                map.set(obj.userData.id, obj);
            }
        });

        return map;
    }
    restoreAnimationRuntimeState(anim) {
        if (!anim) return;

        anim.playing = false;
        anim.time = 0;

        // om du fortfarande använder dessa någonstans
        anim.segmentIndex = 0;
        anim.segmentT = 0;
        anim.direction = 1;

        anim.playOrder = 0;

        if (anim.speedPercent === undefined) {
            anim.speedPercent = 100;
        }

        if (!anim.mode) {
            anim.mode = "loop";
        }

        if (!anim.poses) {
            anim.poses = [];
        }

        if (!anim.segmentDurations) {
            anim.segmentDurations = [];
        }
    }
    ensureUniqueObjectNames() {
        const used = new Set();

        this.scene.traverse(obj => {
            if (obj.userData?.isPivotMarker) return;

            if (!obj.name || obj.name.trim() === "") {
                obj.name = obj.type || "Object";
            }

            let base = obj.name.replace(/\s+/g, "_");
            let name = base;
            let i = 1;

            while (used.has(name)) {
                name = base + "_" + i;
                i++;
            }

            obj.name = name;
            used.add(name);
        });
    }
    createClipFromAnimation(anim) {
        if (!anim || !anim.poses || anim.poses.length < 2) return null;

        const exportData = this.getExportPosesAndDurations(anim);
        const poses = exportData.poses;
        const durations = exportData.durations;

        if (!poses || poses.length < 2) return null;

        const tracks = [];

        const speedMultiplier = (anim.speedPercent ?? 100) / 100;

        const times = [0];
        let totalTime = 0;

        for (let i = 0; i < poses.length - 1; i++) {
            let d = durations?.[i] ?? 0.3;

            // Baka in speedPercent
            d = d / speedMultiplier;

            totalTime += d;
            times.push(totalTime);
        }

        const subgroupIds = new Set();

        for (const pose of poses) {
            if (!pose.groups) continue;

            for (const id in pose.groups) {
                subgroupIds.add(id);
            }
        }

        for (const id of subgroupIds) {
            const sg = this.subgroups.find(s => String(s.userData.id) === String(id));

            if (!sg) {
                console.warn("Export animation: missing subgroup", id);
                continue;
            }

            const positionValues = [];
            const quaternionValues = [];
            const scaleValues = [];

            let valid = true;

            for (const pose of poses) {
                const g = pose.groups[id];

                if (!g) {
                    valid = false;
                    break;
                }

                positionValues.push(
                    g.position.x,
                    g.position.y,
                    g.position.z
                );

                quaternionValues.push(
                    g.quaternion.x,
                    g.quaternion.y,
                    g.quaternion.z,
                    g.quaternion.w
                );

                scaleValues.push(
                    g.scale.x,
                    g.scale.y,
                    g.scale.z
                );
            }

            if (!valid) {
                console.warn("Skipping incomplete subgroup track:", sg.name);
                continue;
            }

            const path = sg.name;

            tracks.push(
                new THREE.VectorKeyframeTrack(
                    path + ".position",
                    times,
                    positionValues
                )
            );

            tracks.push(
                new THREE.QuaternionKeyframeTrack(
                    path + ".quaternion",
                    times,
                    quaternionValues
                )
            );

            tracks.push(
                new THREE.VectorKeyframeTrack(
                    path + ".scale",
                    times,
                    scaleValues
                )
            );
        }

        if (tracks.length === 0) return null;

        return new THREE.AnimationClip(
            anim.name || "Animation",
            totalTime,
            tracks
        );
    }
    createAnimationClipsForExport() {
        const clips = [];

        if (!this.animations) return clips;

        for (const anim of this.animations) {
            const clip = this.createClipFromAnimation(anim);

            if (clip) {
                clips.push(clip);
            }
        }

        return clips;
    }
    setEditorHelpersVisible(visible) {
        if (this.groupHelpers) {
            for (const h of this.groupHelpers) {
                h.visible = visible;
            }
        }

        if (this.subgroups) {
            for (const sg of this.subgroups) {
                if (sg.userData.pivotMarker) {
                    sg.userData.pivotMarker.visible = visible;
                }

                if (sg.userData.pivotAxes) {
                    sg.userData.pivotAxes.visible = visible;
                }
            }
        }
    }
    getExportPosesAndDurations(anim) {
        let poses = anim.poses || [];
        let durations = anim.segmentDurations || [];

        if (poses.length < 2) {
            return { poses, durations };
        }

        // Säkerställ durationer
        if (durations.length !== poses.length - 1) {
            durations = new Array(poses.length - 1).fill(0.3);
        }

        // Vanlig loop/once exporteras som den är
        if (anim.mode !== "pingpong") {
            return {
                poses,
                durations
            };
        }

        // Pingpong:
        // Framåt: pose0, pose1, pose2
        // Bakåt:  pose1, pose0
        const exportPoses = [...poses];
        const exportDurations = [...durations];

        // Lägg till bakåt-poser, men hoppa över sista posen
        // så vi inte får pose2 → pose2
        for (let i = poses.length - 2; i >= 0; i--) {
            exportPoses.push(poses[i]);
        }

        // Lägg till bakåt-durationer
        // durations[i] hör till pose i -> pose i+1
        // Bakåt från pose2 -> pose1 använder durations[1]
        // Bakåt från pose1 -> pose0 använder durations[0]
        for (let i = durations.length - 1; i >= 0; i--) {
            exportDurations.push(durations[i]);
        }

        return {
            poses: exportPoses,
            durations: exportDurations
        };
    }
    async exportGifPreview(seconds = 3, fps = 20) {
        const src = this.canvas;
        const maxWidth = 640;
        const scale = Math.min(1, maxWidth / src.width);

        const w = Math.floor(src.width * scale);
        const h = Math.floor(src.height * scale);

        const capture = document.createElement("canvas");
        capture.width = w;
        capture.height = h;
        const ctx = capture.getContext("2d");
        
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width: w,
            height: h
        });

        const frameCount = seconds * fps;
        const delay = 1000 / fps;
         this.setEditorVisualsVisible(false);
        for (let i = 0; i < frameCount; i++) {
            // uppdatera animationer med fast dt
            this.updatePosePlayback(1 / fps);

            this.renderer.render(this.scene, this.camera);

            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(src, 0, 0, w, h);

            gif.addFrame(capture, {
                copy: true,
                delay
            });

            await new Promise(r => setTimeout(r, 0));
        }
     
        gif.on("finished", async (blob) => {
            this.setEditorVisualsVisible(true);
            
            this.lastGifBlob = blob;

            await this.saveBlob(
                blob,
                "maxpaint3d_preview.gif",
                "image/gif",
                ".gif",
                "GIF Preview"
            );
        });

    gif.render();
    }
    async shareLastGif() {
        if (!this.lastGifBlob) {
            alert("No GIF created yet.");
            return;
        }

        const file = new File(
            [this.lastGifBlob],
            "maxpaint3d_preview.gif",
            { type: "image/gif" }
        );

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: "MaxPaint3D GIF Preview",
                text: "Made with MaxPaint3D",
                files: [file]
            });
        } else {
            await this.saveBlob(
                this.lastGifBlob,
                "maxpaint3d_preview.gif",
                "image/gif",
                ".gif",
                "GIF Preview"
            );
        }
    }
    ungroupAllToPrimitives() {
        const ok = confirm(
            "Ungroup all? This will remove groups, subgroups and animations, but keep all primitives."
        );
        if (!ok) return;

        this.scene.updateMatrixWorld(true);

        // 1. Samla ALLA riktiga meshes i hela scenen
        const primitives = [];

        this.scene.traverse(obj => {
            if (
                obj.isMesh &&
                !obj.userData?.isPivotMarker &&
                obj.name !== "ground" &&
                obj !== this.ground
            ) {
                primitives.push(obj);
            }
        });

        if (primitives.length === 0) return;

        // 2. Ta bort pivot markers/helpers
        for (const sg of this.subgroups || []) {
            if (sg.userData.pivotMarker) {
                sg.userData.pivotMarker.parent?.remove(sg.userData.pivotMarker);
            }
            if (sg.userData.pivotAxes) {
                sg.userData.pivotAxes.parent?.remove(sg.userData.pivotAxes);
            }
        }

        if (this.groupHelpers) {
            for (const h of this.groupHelpers) {
                h.parent?.remove(h);
            }
            this.groupHelpers = [];
        }

        // 3. Flytta alla meshes direkt till scene, behåll world transform
        for (const mesh of primitives) {
            this.ensureObjectId(mesh);
            this.scene.attach(mesh);

            mesh.userData.isSubgroup = false;
            mesh.userData.isBuildGroup = false;
            mesh.userData.isModelGroup = false;
        }

        // 4. Ta bort alla tomma grupper rekursivt
        this.removeEmptyGroups(this.scene);

        // 5. Nollställ all grupp/animations-state
        this.objects = primitives;
        this.groups = [];
        this.modelGroup = null;

        this.subgroups = [];
        this.subgroupSelection = [];
        this.groupSelection = [];
        this.selectedSubgroup = null;

        this.poses = [];
        this.animations = [];
        this.poseSegmentDurations = [];
        this.poseChangedSubgroups = new Set();

        this.setSelected(null);

        this.scene.updateMatrixWorld(true);
        this.pushUndoState?.();

        console.log("Ungroup all complete. Primitives:", primitives.map(p => p.name || p.type));
    }
    removeEmptyGroups(root) {
        for (const child of [...root.children]) {
            this.removeEmptyGroups(child);

            if (
                child.type === "Group" &&
                child.children.length === 0 &&
                child !== this.ground
            ) {
                root.remove(child);
            }
        }
    }
    setPivotMarkersVisible(visible) {
        for (const sg of this.subgroups || []) {
            if (sg.userData.pivotMarker) {
                sg.userData.pivotMarker.visible = visible;
            }

            if (sg.userData.pivotAxes) {
                sg.userData.pivotAxes.visible = visible;
            }
        }
    }
    setEditorVisualsVisible(visible) {
        this.setPivotMarkersVisible(visible);
        
        this.selectionBox.visible=visible;
        this.suppressSelectionBox =!visible;
        
        for (const h of this.groupHelpers || []) {
            h.visible = visible;
        }
    }
    removeEditorObjectsFromClone(root) {
        const toRemove = [];

        root.traverse(obj => {
            if (
                obj.userData?.isPivotMarker ||
                obj.userData?.isEditorHelper ||
                obj.userData?.ignoreSave ||
                obj.userData?.ignoreExport
            ) {
                toRemove.push(obj);
            }
        });

        for (const obj of toRemove) {
            if (obj.parent) {
                obj.parent.remove(obj);
            }
        }
    }
    
}