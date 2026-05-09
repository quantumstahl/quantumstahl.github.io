class PivotTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;

        const subgroup = app.selectedSubgroup;
        if (!subgroup) return;

        const marker = subgroup.userData.pivotMarker;
        if (!marker) return;

        const isLandscape = app.canvas.width > app.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, app.canvas.height * 0.18)
            : Math.min(150, app.canvas.width * 0.20);

        const overUI = !(input.mouse.y < app.canvas.height - btnSize * 1.5 || input.mouse.x > btnSize * 6.5);
        if (!input.mouse.down || overUI) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        app.scene.updateMatrixWorld(true);
        app.modelGroup.updateMatrixWorld(true);

        // hit.point är world-position
        const pivotWorld = hit.point.clone();

        // marker ligger i modelGroup, så marker.position ska vara lokal
        const pivotLocal = app.modelGroup.worldToLocal(pivotWorld.clone());
        marker.position.copy(pivotLocal);

        marker.updateMatrixWorld(true);
        app.modelGroup.updateMatrixWorld(true);
        app.scene.updateMatrixWorld(true);

        // Använd hit.point direkt, inte marker.getWorldPosition()
        app.setSubgroupPivot(subgroup, pivotWorld);
    }

    getMouseHit() {
        const app = this.app;
        const input = app.input;

        // Om input.mouse.x/y redan är canvas-koordinater:
        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / app.canvas.width) * 2 - 1,
            -(input.mouse.y / app.canvas.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouseNdc, app.camera.camera);

        const targets = [];

        if (app.modelGroup) {
            app.modelGroup.traverse(obj => {
                if (
                    obj.isMesh &&
                    !obj.userData?.isPivotMarker
                ) {
                    targets.push(obj);
                }
            });
        }

        if (app.ground) {
            targets.push(app.ground);
        }

        const hits = raycaster.intersectObjects(targets, true);
        return hits.length > 0 ? hits[0] : null;
    }
}