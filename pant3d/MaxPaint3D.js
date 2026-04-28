

class MaxPaint3D {
    constructor(canvas,canvas2) {
       
        this.canvas = canvas;
        this.selected = null;
        this.scene = new THREE.Scene();
         this.objects = [];
        this.camera = new EditorCamera(this.selected);
        this.renderer = new EditorRenderer(canvas,canvas2, this.scene, this.camera.camera);
        const ambient = new THREE.AmbientLight(0xffffff, 1);
        this.scene.add(ambient);
        this.input = new InputManager(canvas2);
        this.tools = new ToolManager(this);
        this.createGround();
        this.tools.setTool("move");
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
        this.camera.update(this.input, dt,this.selected);
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

        const mat = new THREE.MeshStandardMaterial({ color: 0x66aa55 });
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.copy(this.camera.target);

        // sätt på marken
        const box = new THREE.Box3().setFromObject(mesh);
        mesh.position.y -= box.min.y;

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

}