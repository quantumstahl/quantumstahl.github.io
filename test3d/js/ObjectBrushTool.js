class ObjectBrushTool {
    constructor(game) {
        this.game = game;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();
        this.lastPlaced = null;
        this.busy = false;
        this.spacing = 0.85;
    }

    enter() {
        this.lastPlaced = null;
    }

    exit() {
        this.lastPlaced = null;
    }

    update() {
        const input = this.game.input;
        if (input.mouse.rightDown) return;
        if (!input.mouse.down && !input.mouse.justPressed) {
            this.lastPlaced = null;
            return;
        }

        const type = this.getBrushType();
        if (!type) return;
        const hit = this.getGroundHit();
        if (!hit) return;

        if (this.lastPlaced &&
            this.lastPlaced.distanceToSquared(hit.point) < this.spacing * this.spacing) return;
        this.place(type, hit.point);
    }

    getBrushType() {
        const node = this.game.editorTree?.selectedNode;
        if (node?.kind === "assetType") return node.data;
        if (node?.kind === "instance") return node.type;
        return this.game.selected?.userData?.assetType || null;
    }

    getGroundHit() {
        const input = this.game.input;
        const canvas = this.game.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.mouseNdc.set(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(this.mouseNdc, this.game.camera);
        return this.raycaster.intersectObject(this.game.ground, true)[0] || null;
    }

    async place(type, point) {
        if (this.busy) return;
        this.busy = true;
        // Reserve the spacing immediately, so an asynchronous GLB clone does
        // not create a pile of identical instances at one cursor position.
        this.lastPlaced = point.clone();
        try {
            await this.game.addBrushInstance(type, point);
        } catch (error) {
            console.warn("Could not place brush instance:", error);
        } finally {
            this.busy = false;
        }
    }
}
window.ObjectBrushTool = ObjectBrushTool;
