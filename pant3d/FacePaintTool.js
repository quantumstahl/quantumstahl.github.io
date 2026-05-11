class FacePaintTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;
        if(this.app.selected!==null)this.app.setSelected(null);
        if (!input.mouse.justPressed) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        app.paintHitFace(hit, app.UI.activeColor || 0xffffff);
        app.pushUndoState?.();
    }

    getMouseHit() {
        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();
        const app = this.app;
        const raycaster = new THREE.Raycaster();
        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );

        raycaster.setFromCamera(mouseNdc, app.camera.camera);

        const meshes = [];

        for (const root of app.objects || []) {
            root.traverse(obj => {
                if (
                    obj.isMesh &&
                    !obj.userData?.isPivotMarker &&
                    !obj.userData?.isEditorHelper
                ) {
                    meshes.push(obj);
                }
            });
        }

        const hits = raycaster.intersectObjects(meshes, true);
        return hits.length > 0 ? hits[0] : null;
    }
}