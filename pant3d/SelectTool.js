class SelectTool {
    constructor(app) {
        this.app = app;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();
    }

    update(scale) {
        const input = this.app.input;
        
        const isLandscape = this.app.canvas.width > this.app.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, this.app.canvas.height * 0.18)
            : Math.min(150, this.app.canvas.width * 0.20);
        
        if (!input.mouse.justPressed||input.mouse.y<btnSize*0.5) return;

        const canvas = this.app.renderer.canvas;
        const rect = canvas.getBoundingClientRect();

        this.mouseNdc.x = (input.mouse.x / rect.width) * 2 - 1;
        this.mouseNdc.y = -(input.mouse.y / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(
            this.mouseNdc,
            this.app.camera.camera
        );

        const hits = this.raycaster.intersectObjects(this.app.objects, true);

        if (hits.length > 0) {
            const root = this.app.getSelectableRoot(hits[0].object);
            this.app.setSelected(root);
        } else {
            //this.app.selected = null;
            
        }
    }
}