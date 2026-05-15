class SelectTool {
    constructor(game) {
        this.game = game;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();
    }

    update(scale) {
        const input = this.game.input;
        if (!input.mouse.justPressed) return;

        // Ignorera om höger mus används till kamera
        if (input.mouse.rightDown) return;

        const hit = this.getObjectHit();
        if (!hit) {
            // Du kan välja om klick på tom yta ska deselecta eller ej
            // this.game.setSelected(null);
            return;
        }

        const root = this.game.getSelectableRoot(hit.object);
        if (!root) return;

        this.game.setSelected(root);
    }

    getObjectHit() {
        const input = this.game.input;
        const canvas = this.game.renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.mouseNdc.x = (input.mouse.x / rect.width) * 2 - 1;
        this.mouseNdc.y = -(input.mouse.y / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouseNdc, this.game.camera);

        const hits = this.raycaster.intersectObjects(this.game.mapObjects, true);
        return hits.length ? hits[0] : null;
    }
}
window.SelectTool = SelectTool;