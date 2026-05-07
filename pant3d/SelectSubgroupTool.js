class SelectSubgroupTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const app = this.app;
        const input = app.input;

        if (!input.mouse.justPressed) return;
        if (!app.animatetoggle) return;
        if (!app.modelGroup) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        const subgroup = this.findSubgroupRoot(hit.object);
        if (!subgroup) return;

        app.selectedSubgroup = subgroup;
        app.setSelected(subgroup);

        app.subgroupSelection = [];

        console.log("Selected subgroup:", subgroup.name);
    }

    getMouseHit() {
        const app = this.app;
        
        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();
        const raycaster = new THREE.Raycaster();
        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );
        
        
        raycaster.setFromCamera(mouseNdc, app.camera.camera);

        const targets = [];
        app.modelGroup.traverse(obj => {
            if (obj.isMesh && !obj.userData.isPivotMarker) {
                targets.push(obj);
            }
        });

        const hits = raycaster.intersectObjects(targets, true);
        return hits.length > 0 ? hits[0] : null;
    }

    findSubgroupRoot(obj) {
        const app = this.app;

        let current = obj;

        while (current && current !== app.modelGroup) {
            if (current.userData && current.userData.isSubgroup) {
                return current;
            }

            current = current.parent;
        }

        return null;
    }
}