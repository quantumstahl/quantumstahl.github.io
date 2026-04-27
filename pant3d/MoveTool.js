class MoveTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const input = this.app.input;
        const selected = this.app.selected;

        if (!selected) return;

        if (input.mouse.down) {
            this.placeSelectedOnGround();
        }
    }

    placeSelectedOnGround() {
        const selected = this.app.selected;
        if (!selected) return;

        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();

        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouseNdc, this.app.camera.camera);

        const hits = raycaster.intersectObject(this.app.ground);

        if (hits.length > 0) {
            const p = hits[0].point;

            selected.position.x = this.app.snapToGrid(p.x, 1);
            selected.position.z = this.app.snapToGrid(p.z, 1);

            selected.position.y = 1;
        }
    }

}