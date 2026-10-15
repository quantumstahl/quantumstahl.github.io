class RotateTool {
    constructor(game) {
        this.game = game;
        this.dragging = false;
        this.startRotY = 0;
        this.startMouseX = 0;
    }

    update(scale) {
        const input = this.game.input;
        const selected = this.game.selected;

        if (!selected) return;

        if (input.mouse.justPressed && !input.mouse.rightDown) {
            this.dragging = true;
            this.startRotY = selected.rotation.y;
            this.startMouseX = input.mouse.x;
        }

        if (input.mouse.justReleased) {
            if (this.dragging) {
                this.syncSelectedDataFromMesh();
                this.game.markUnsaved?.();
            }

            this.dragging = false;
        }

        if (this.dragging && input.mouse.down) {
            const dx = input.mouse.x - this.startMouseX;
            selected.rotation.y = this.startRotY + dx * 0.01;

            this.syncSelectedDataFromMesh();
            this.game.updateSelectionBox?.();
            this.game.editorTree?.renderProperties?.();
        }

        this.rotateWithKeyboard(scale);
    }

    rotateWithKeyboard(scale) {
        const selected = this.game.selected;
        const input = this.game.input;
        if (!selected) return;

        let speed = 0.008 * scale;

        if (input.keys["shift"]) {
            speed *= 4;
        }

        let changed = false;

        if (input.keys["a"]) {
            selected.rotation.y += speed;
            changed = true;
        }

        if (input.keys["d"]) {
            selected.rotation.y -= speed;
            changed = true;
        }

        if (input.keys["q"]) {
            selected.rotation.y -= Math.PI / 2;
            changed = true;
            input.keys["q"] = false;
        }

        if (input.keys["e"]) {
            selected.rotation.y += Math.PI / 2;
            changed = true;
            input.keys["e"] = false;
        }

        if (!changed) return;

        this.syncSelectedDataFromMesh();
        this.game.updateSelectionBox?.();
        this.game.editorTree?.renderProperties?.();
        this.game.markUnsaved?.();
    }

    syncSelectedDataFromMesh() {
        const obj = this.game.selected;
        if (!obj) return;

        const inst = obj.userData.mapObject;
        if (!inst) return;

        inst.rotX = Number(obj.rotation.x.toFixed(3));
        inst.rotY = Number(obj.rotation.y.toFixed(3));
        inst.rotZ = Number(obj.rotation.z.toFixed(3));
    }
}