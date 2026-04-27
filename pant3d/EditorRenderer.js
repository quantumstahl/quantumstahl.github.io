class EditorRenderer {
    constructor(canvas,canvas2, scene, camera) {
        this.canvas = canvas;
        this.canvas2 = canvas2;
        this.scene = scene;
        this.camera = camera;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
        this.resize();
    }

    resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (this.canvas.width === w && this.canvas.height === h) {
            return false;
        }

        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas2.width = w;
        this.canvas2.height = h;

        this.renderer.setSize(w, h, false);

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();

        return true;
    }

    render() {
        this.resize();
        this.renderer.render(this.scene, this.camera);
    }
}