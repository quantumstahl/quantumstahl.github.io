

class MaxPaint3D {
    constructor(canvas,canvas2) {
        this.Yblue=false;
        this.canvas = canvas;
        this.selected = null;
        this.scene = new THREE.Scene();
         this.objects = [];
        this.camera = new EditorCamera(this);
        this.renderer = new EditorRenderer(canvas,canvas2, this.scene, this.camera.camera);
        
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        const light = new THREE.DirectionalLight(0xffffff, 1.2);
        light.position.set(5, 10, 5);
        light.castShadow = true;

        // viktig tweak (shadow quality)
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;

        light.shadow.camera.near = 1;
        light.shadow.camera.far = 50;
        
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
    }

    init() {
        
        requestAnimationFrame(t => this.loop(t));
    }

    loop(time) {
        const dt = this.getDelta(time);

        this.updateSelectionBox();
        this.camera.update(this.input, dt);
        this.tools.update(dt);
        this.UI.update();
        this.renderer.render();
        this.input.update();
        this.updateGroupHelpers();
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
        let geo;

        if (type === "cube") {
            geo = new THREE.BoxGeometry(2, 2, 2);
        } 
        else if (type === "cone") {
            geo = new THREE.ConeGeometry(1, 2, 16);
        } 
        else if (type === "cylinder") {
            geo = new THREE.CylinderGeometry(1, 1, 2, 16);
        } 
        else if (type === "sphere") {
            geo = new THREE.SphereGeometry(1, 16, 12);
        } 
        else if (type === "plane") {
            geo = new THREE.BoxGeometry(2, 0.1, 2);
        }

        if (!geo) return;

        const mat = new THREE.MeshStandardMaterial({color: 0x66aa55,roughness: 0.7,metalness: 0.0});
        
        
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.copy(this.camera.target);

        // sätt på marken
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.position.y -= box.min.y;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        
        
        this.scene.add(mesh);
        this.objects.push(mesh);
        
        if(this.selected!==null)this.setSelected(null);
        this.selected = mesh;
        this.setSelected(mesh);
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
    }
    setColor(hex) {
        if (!this.selected) return;

        this.selected.material.color.setHex(hex);
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
}