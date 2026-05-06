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
        
        
        const isLandscape = this.app.canvas.width > this.app.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, this.app.canvas.height * 0.18)
            : Math.min(150, this.app.canvas.width * 0.20);
        
        
        
        if (input.mouse.down&&(input.mouse.y<this.app.canvas.height-btnSize*1.5 ||input.mouse.x>btnSize*6.5 )) {
            const hit = this.getMouseHit();
            if (!hit) return;

            marker.position.copy(hit.point);
            this.app.applyPivotToSelectedSubgroup();
        }
    }

    getMouseHit() {
        const app = this.app;
        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();

        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        
        
        raycaster.setFromCamera(mouseNdc, app.camera.camera);

        const targets = [];

        if (app.modelGroup) {
            app.modelGroup.traverse(obj => {
                if (obj.isMesh) targets.push(obj);
            });
        }

        targets.push(app.ground);

        const hits = raycaster.intersectObjects(targets, true);
        return hits.length > 0 ? hits[0] : null;
    }
}