class ScaleTool {
    constructor(app) {
        this.app = app;
        this.wasScaling = false;
    }

    update(scale) {
        const selected = this.app.selected;
        const input = this.app.input;

        if (!selected) return;

        const speed = 0.008 * scale;
        const minScale = 0.05;

        const isScaling =
            input.keys["w"] ||
            input.keys["a"] ||
            input.keys["s"] ||
            input.keys["d"];

        if (isScaling && !this.wasScaling) {
            this.app.beginEdit();
        }

        if (isScaling) {
            if (this.app.Yblue) {
                this.scaleY(selected, input, speed, minScale);
            } else {
                this.scaleCameraRelativeXZ(selected, input, speed, minScale);
            }

            this.keepAboveGround(selected);
        }

        if (!isScaling && this.wasScaling) {
            this.app.endEdit();
        }

        this.wasScaling = isScaling;
    }

    scaleY(selected, input, speed, minScale) {
        if (input.keys["w"]) selected.scale.y += speed;
        if (input.keys["s"]) selected.scale.y -= speed;

        selected.scale.y = Math.max(minScale, selected.scale.y);
    }

    scaleCameraRelativeXZ(selected, input, speed, minScale) {
        const camera = this.app.camera.camera; 
       

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);

        forward.y = 0;

        if (forward.lengthSq() === 0) return;

        forward.normalize();

        const absX = Math.abs(forward.x);
        const absZ = Math.abs(forward.z);

        // Om kameran tittar mest längs X, då W/S påverkar X-scale.
        // Annars påverkar W/S Z-scale.
        if (absX > absZ) {
            if (input.keys["w"]) selected.scale.x += speed;
            if (input.keys["s"]) selected.scale.x -= speed;

            if (input.keys["d"]) selected.scale.z += speed;
            if (input.keys["a"]) selected.scale.z -= speed;
        } else {
            if (input.keys["w"]) selected.scale.z += speed;
            if (input.keys["s"]) selected.scale.z -= speed;

            if (input.keys["d"]) selected.scale.x += speed;
            if (input.keys["a"]) selected.scale.x -= speed;
        }

        selected.scale.x = Math.max(minScale, selected.scale.x);
        selected.scale.z = Math.max(minScale, selected.scale.z);
    }

    keepAboveGround(selected) {
        selected.updateWorldMatrix(true, true);

        const box = new THREE.Box3().setFromObject(selected);

        if (box.min.y < 0) {
            selected.position.y -= box.min.y;
            selected.updateWorldMatrix(true, true);
        }
    }
}