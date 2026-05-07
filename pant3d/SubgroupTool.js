class SubgroupTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const input = this.app.input;

        if (!input.mouse.justPressed) return;
        if (!this.app.animatetoggle) return;
        if (!this.app.modelGroup) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        const root = this.getSubgroupCandidateRoot(hit.object);

        if (!root) return;

        this.toggleSelection(root);
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

        const targets = [];
        app.modelGroup.traverse(obj => {
            if (obj.isMesh) targets.push(obj);
        });

        const hits = raycaster.intersectObjects(targets, true);
        return hits.length > 0 ? hits[0] : null;
    }

    getSubgroupCandidateRoot(obj) {
        const app = this.app;

        let current = obj;

        while (current && current.parent && current.parent !== app.modelGroup) {
            if (current.userData && current.userData.isSubgroup) {
                return current;
            }

            current = current.parent;
        }

        return current;
    }
    
    toggleSelection(obj) {
        

        const list = this.app.subgroupSelection;

        const index = list.indexOf(obj);

        if (index >= 0) {
            list.splice(index, 1);
        } else {
            list.push(obj);
        }

        
        
    }
}