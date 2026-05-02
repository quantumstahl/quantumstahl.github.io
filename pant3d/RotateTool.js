class RotateTool {
    constructor(app) {
        this.app = app;
        this.wasRotating = false;
        this.wasSnapping = false;
    }

    update(scale) {
        const selected = this.app.selected;
        const input = this.app.input;
        if (!selected) return;

        const rotSpeed = 0.005 * scale;

        const isRotating =
            input.keys["w"] ||
            input.keys["a"] ||
            input.keys["s"] ||
            input.keys["d"];

        if (isRotating && !this.wasRotating) {
            this.app.beginEdit();
        }

        if (isRotating) {
            if (this.app.Yblue) {
                if (input.keys["w"]) selected.rotation.y += rotSpeed;
                if (input.keys["s"]) selected.rotation.y -= rotSpeed;
            } else {
                if (input.keys["a"]) selected.rotation.z += rotSpeed;
                if (input.keys["d"]) selected.rotation.z -= rotSpeed;
                if (input.keys["w"]) selected.rotation.x += rotSpeed;
                if (input.keys["s"]) selected.rotation.x -= rotSpeed;
            }
        }

        if (!isRotating && this.wasRotating) {
            this.app.endEdit();
        }

        this.wasRotating = isRotating;

        // Snap bara en gång per space-tryck, annars snappar den varje frame
        if (input.keys[" "] && !this.wasSnapping) {
            this.app.beginEdit();
            this.snapRotation(selected, Math.PI / 4);
            this.app.endEdit();
        }

        this.wasSnapping = !!input.keys[" "];
    }

    snapRotation(obj, step) {
        obj.rotation.x = Math.round(obj.rotation.x / step) * step;
        obj.rotation.y = Math.round(obj.rotation.y / step) * step;
        obj.rotation.z = Math.round(obj.rotation.z / step) * step;
    }
}