

class MaxPaint3D {
    constructor(canvas,canvas2) {
       
        this.canvas = canvas;
        this.selected = null;
        this.scene = new THREE.Scene();
         this.objects = [];
        this.addTestCube();
        this.camera = new EditorCamera(this.selected);
        this.renderer = new EditorRenderer(canvas,canvas2, this.scene, this.camera.camera);
        const ambient = new THREE.AmbientLight(0xffffff, 1);
        this.scene.add(ambient);
        this.input = new InputManager(canvas2);
        this.tools = new ToolManager(this);
        this.createGround();
        this.tools.setTool("move");
        

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

        this.input.update();
        this.camera.update(this.input, dt);
        this.tools.update(dt);

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

    addTestCube() {
        const geo = new THREE.BoxGeometry(2, 2, 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0x66aa55 });
        const cube = new THREE.Mesh(geo, mat);

        this.scene.add(cube);
        this.objects.push(cube);
        this.selected = cube;
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

}