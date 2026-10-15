class ScaleTool {
    constructor(game) {
        this.game = game;
        this.dragging = false;
        this.startScale = 1;
        this.startMouseY = 0;

        this.minScale = 0.05;
        this.maxScale = 100;
    }

    update(scale) {
        const input = this.game.input;
        const selected = this.game.selected;

        if (!selected) return;

        if (input.mouse.justPressed && !input.mouse.rightDown) {
            this.dragging = true;
            this.startScale = selected.scale.x || 1;
            this.startMouseY = input.mouse.y;
        }

        if (input.mouse.justReleased) {
            if (this.dragging) {
                this.syncSelectedDataFromMesh();
                this.game.markUnsaved?.();
            }

            this.dragging = false;
        }

        if (this.dragging && input.mouse.down) {
            const dy = input.mouse.y - this.startMouseY;

            // Dra upp = större, dra ner = mindre
            let newScale = this.startScale * (1 - dy * 0.01);
            newScale = this.clampScale(newScale);

            selected.scale.set(newScale, newScale, newScale);

            this.syncSelectedDataFromMesh();
            this.game.updateSelectionBox?.();
            this.game.editorTree?.renderProperties?.();
        }

        this.scaleWithKeyboard(scale);
    }

    scaleWithKeyboard(scale) {
        const selected = this.game.selected;
        const input = this.game.input;
        if (!selected) return;

        let speed = 0.005 * scale;

        if (input.keys["shift"]) {
            speed *= 4;
        }

        let s = selected.scale.x || 1;
        let changed = false;

        if (input.keys["w"] || input.keys["+"] || input.keys["="]) {
            s += speed;
            changed = true;
        }

        if (input.keys["s"] || input.keys["-"]) {
            s -= speed;
            changed = true;
        }

        if (input.keys["r"]) {
            s = 1;
            changed = true;
            input.keys["r"] = false;
        }

        if (!changed) return;

        s = this.clampScale(s);
        selected.scale.set(s, s, s);

        this.syncSelectedDataFromMesh();
        this.game.updateSelectionBox?.();
        this.game.editorTree?.renderProperties?.();
        this.game.markUnsaved?.();
    }

    clampScale(s) {
        return Math.max(this.minScale, Math.min(this.maxScale, s));
    }

    syncSelectedDataFromMesh() {
        const obj = this.game.selected;
        if (!obj) return;

        const inst = obj.userData.mapObject;
        if (!inst) return;

        inst.scale = Number(obj.scale.x.toFixed(3));
    }
}