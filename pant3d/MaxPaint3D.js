

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

        // ta bort från scen
        this.scene.remove(this.selected);

        // ta bort från array
        const i = this.objects.indexOf(this.selected);
        if (i !== -1) {
            this.objects.splice(i, 1);
        }

        // nollställ selection
        this.setSelected(null);
    }
    duplicateSelected() {
        if (!this.selected) return;

        const clone = this.selected.clone();

        // offset så den inte ligger exakt i samma position
        clone.position.x += 1;
        clone.position.z += 1;
        clone.material = clone.material.clone();
        this.scene.add(clone);
        this.objects.push(clone);

        this.setSelected(clone);
    }
    setColor(hex) {
        if (!this.selected) return;

        this.selected.material.color.setHex(hex);
    }
}