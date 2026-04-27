class SelectTool {
    constructor(app) {
        this.app = app;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();
    }

    update(scale) {
        const input = this.app.input;

        if (!input.mouse.justPressed) return;

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
            this.app.selected = hits[0].object;
            console.log("Selected:", this.app.selected.name || this.app.selected);
        } else {
            this.app.selected = null;
            console.log("Selected: none");
        }
    }
}