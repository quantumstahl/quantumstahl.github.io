

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
        
        this.subgroups = [];
        this.subgroupSelection = [];
        this.selectedSubgroup = null;
        this.poses = [];
        
        this.poseAIndex = 0;
        this.poseBIndex = 1;
        this.poseT = 0;
        this.isPlayingPose = false;
        this.posePlaySpeed = 0.005;
        
    }

    init() {
        
        requestAnimationFrame(t => this.loop(t));
    }

    loop(time) {
        const dt = this.getDelta(time);
        
        this.ctx.clearRect(0,0,canvas2.width,canvas2.height);
        this.updatePosePlayback(dt);
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

        this.selectionBox.visible = true;
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

        const group = new THREE.Group();
        group.name = "Group " + (this.groups.length + 1);

        this.scene.add(group);

        for (const obj of selectedObjects) {
            group.attach(obj);
        }

        // ta bort barnen från selectable-listan
        this.objects = this.objects.filter(o => !selectedObjects.includes(o));

        // lägg bara till gruppen
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
            objects: this.objects.map(obj => this.serializeNode(obj))
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
                    .filter(child => child.isMesh || child.isGroup)
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
        const exporter = new THREE.GLTFExporter();

        const exportRoot = new THREE.Group();
        exportRoot.name = "MaxPaint3D_Model";

        for (const obj of this.objects) {
            const clone = obj.clone(true);

            clone.traverse(child => {
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
                trs: true
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

        this.animatetoggle = true;
        this.currentTool = "anim_select";
        this.selected = this.modelGroup;
    }

    exitAnimateMode() {
        this.animatetoggle = false;
        this.currentTool = "select";
    }
    createModelGroupFromAllObjects() {
        if (this.modelGroup) return;

        const selectedObjects = this.objects.filter(o =>
            o &&
            o !== this.ground &&
            o.parent === this.scene
        );

        if (selectedObjects.length === 0) return;

        const group = new THREE.Group();
        group.name = "Model";

        this.scene.add(group);
        this.scene.updateMatrixWorld(true);

        for (const obj of selectedObjects) {
            group.attach(obj);
        }

        this.objects = this.objects.filter(o => !selectedObjects.includes(o));
        this.objects.push(group);

        this.groups.push(group);
        this.modelGroup = group;

        this.setSelected(group);
        this.ensureObjectId(group);
        this.pushUndoState();
    }
    createSubgroup() {
        if (!this.modelGroup) return;
        if (!this.subgroupSelection || this.subgroupSelection.length === 0) return;

        let name = prompt("Subgroup name:", "Subgroup " + (this.subgroups.length + 1));

        if (!name) {
            name = "Subgroup " + (this.subgroups.length + 1);
        }

        const selectedObjects = [...this.subgroupSelection];

        const subgroup = new THREE.Group();
        subgroup.name = name;
        subgroup.userData.isSubgroup = true;

        this.modelGroup.add(subgroup);
        this.modelGroup.updateMatrixWorld(true);

        for (const obj of selectedObjects) {
            subgroup.attach(obj);
        }

        this.subgroups.push(subgroup);
        
        this.subgroupSelection = [];
        this.selectedSubgroup = subgroup;
        this.setSelected(subgroup);
        this.ensureObjectId(subgroup);
        this.createPivotMarker(subgroup);
        this.saveSubgroupRestTransform(subgroup);
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

        this.endEdit?.();
        this.pushUndoState?.();
    }
    saveSubgroupRestTransform(subgroup) {
        subgroup.userData.restPosition = subgroup.position.clone();
        subgroup.userData.restQuaternion = subgroup.quaternion.clone();
        subgroup.userData.restScale = subgroup.scale.clone();
    }
    savePose() {
        if (!this.subgroups || this.subgroups.length === 0) return;

        let name = prompt("Pose name:", "Pose " + (this.poses.length + 1));
        if (!name) name = "Pose " + (this.poses.length + 1);

        const pose = {
            name,
            groups: {}
        };

        for (const sg of this.subgroups) {
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

        this.poses.push(pose);

        console.log("Saved pose:", pose);
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

            if (!a || !b) continue;

            // position
            sg.position.set(
                THREE.MathUtils.lerp(a.position.x, b.position.x, t),
                THREE.MathUtils.lerp(a.position.y, b.position.y, t),
                THREE.MathUtils.lerp(a.position.z, b.position.z, t)
            );

            // scale
            sg.scale.set(
                THREE.MathUtils.lerp(a.scale.x, b.scale.x, t),
                THREE.MathUtils.lerp(a.scale.y, b.scale.y, t),
                THREE.MathUtils.lerp(a.scale.z, b.scale.z, t)
            );

            // rotation via quaternion
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

        this.updateGroupHelpers?.();
    }
    updatePosePlayback(dt) {
        if (!this.isPlayingPose) return;
        if (!this.poses || this.poses.length < 2) return;

        const poseA = this.poses[this.poseAIndex];
        const poseB = this.poses[this.poseBIndex];

        if (!poseA || !poseB) return;

        this.poseT += dt * this.posePlaySpeed;

        // ping-pong-loop 0 → 1 → 0
        const t = (Math.sin(this.poseT * Math.PI * 2) + 1) / 2;

        this.interpolatePoses(poseA, poseB, t);
    }
    togglePosePlay() {
        if (!this.poses || this.poses.length < 2) return;

        this.poseAIndex = 0;
        this.poseBIndex = 1;

        this.isPlayingPose = !this.isPlayingPose;
    }
    setSubgroupPivot(subgroup, pivotWorld) {
        if (!subgroup || !this.modelGroup) return;

        this.scene.updateMatrixWorld(true);
        this.modelGroup.updateMatrixWorld(true);
        subgroup.updateMatrixWorld(true);

        // Spara barnen
        const children = [...subgroup.children];

        // Flytta ut barnen temporärt till modelGroup, men behåll world position
        for (const child of children) {
            this.modelGroup.attach(child);
        }

        // Sätt subgroupens origin till pivoten
        const pivotLocal = this.modelGroup.worldToLocal(pivotWorld.clone());

        subgroup.position.copy(pivotLocal);
        subgroup.quaternion.identity();
        subgroup.scale.set(1, 1, 1);

        this.modelGroup.add(subgroup);
        subgroup.updateMatrixWorld(true);

        // Flytta tillbaka barnen in i subgroupen, men behåll world position
        for (const child of children) {
            subgroup.attach(child);
        }

        // Spara pivot
        subgroup.userData.pivot = pivotWorld.clone();

        // Spara ny rest transform
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

        this.setSubgroupPivot(sg, marker.position);
    }
}