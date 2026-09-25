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
        // Preserve the appearance of the r140 editor while using the current
        // color-management API.
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.renderer.setClearColor(0x1e1f33);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

        // Kept here (rather than in UI code) so this is the exact value from
        // the renderer that just drew the editor frame.
        this.lastRenderInfo = {
            calls: this.renderer.info.render.calls,
            triangles: this.renderer.info.render.triangles,
            frame: this.renderer.info.render.frame
        };
        return this.lastRenderInfo;
    }

    renderCallMeasurement(label = "frame") {
        const info = this.render();
        const result = { label, ...info };
        console.table([result]);
        return result;
    }
}
