class PrimSelectTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;

        if (!input.mouse.justPressed) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        const obj = hit.object;

        if (!obj || !obj.isMesh) return;
        if (obj.userData?.isPivotMarker) return;

        app.setSelected(obj);
    }

    getMouseHit() {
        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();

        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouseNdc, app.camera.camera);

        const meshes = [];

        for (const root of app.objects) {
            root.traverse(obj => {
                if (obj.isMesh && !obj.userData?.isPivotMarker) {
                    meshes.push(obj);
                }
            });
        }

        const hits = raycaster.intersectObjects(meshes, true);
        return hits.length > 0 ? hits[0] : null;
    }
    exit(){
        this.app.exitPrimSelectMode();
        
        
    }
}