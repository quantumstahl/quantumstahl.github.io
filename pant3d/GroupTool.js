class GroupTool {
    constructor(app) {
        this.app = app;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();
    }

    update(scale) {
        const input = this.app.input;

        if (!input.mouse.justPressed) return;

        const hit = this.getObjectHit();
        if (!hit) return;

        this.toggleObject(hit.object);
    }

    toggleObject(obj) {
        const list = this.app.groupSelection;
        const i = list.indexOf(obj);

        if (i === -1) {
            list.push(obj);
        } else {
            list.splice(i, 1);
        }
    }

    getObjectHit() {
        const input = this.app.input;
        const canvas = this.app.renderer.canvas;
        const rect = canvas.getBoundingClientRect();

        this.mouseNdc.x = (input.mouse.x / rect.width) * 2 - 1;
        this.mouseNdc.y = -(input.mouse.y / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouseNdc, this.app.camera.camera);

        const hits = this.raycaster.intersectObjects(this.app.objects, true);
        return hits.length ? hits[0] : null;
    }
}