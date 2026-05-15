class EditorCamera {
    constructor(game) {
        this.game = game;

        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

        this.target = new THREE.Vector3(0, 0, 0);

        this.yaw = 0.6;
        this.pitch = 0.45;
        this.distance = 14;

        this.minDistance = 2;
        this.maxDistance = 120;

      //  this.updateCameraPosition();
    }

    update(input, scale) {
        this.rotate(input);
        this.zoom(input);
        const allowCameraMove =!this.game.tools ||this.game.tools.currentName === "select" ||this.game.tools.currentName === "move"||this.game.tools.currentName === "stack";

        if (allowCameraMove) {
            this.moveTarget(input, scale);
        }

        this.updateCameraPosition(input);
    }

    rotate(input) {
        if (!input.mouse.rightDown) return;
        const rotSpeed = 0.005;
        this.target.y+=input.mouse.dy * rotSpeed;
            this.yaw -= input.mouse.dx * rotSpeed;
            const limit = Math.PI / 2 - 0.05;
            this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    }

    zoom(input) {
        if (!input.mouse.wheel) return;

        const zoomSpeed = 0.0015;

        this.distance += input.mouse.wheel * this.distance * zoomSpeed;
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
    }

    moveTarget(input, scale) {
        let speed = 0.12 * scale * Math.max(0.5, this.distance / 14);

        if (input.keys["shift"]) {
            speed *= 3;
        }

        const forward = new THREE.Vector3(
            Math.sin(this.yaw),
            0,
            Math.cos(this.yaw)
        );

        const right = new THREE.Vector3(
            Math.cos(this.yaw),
            0,
            -Math.sin(this.yaw)
        );

        if (input.keys["w"]) this.target.addScaledVector(forward, -speed);
        if (input.keys["s"]) this.target.addScaledVector(forward, speed);
        if (input.keys["a"]) this.target.addScaledVector(right, -speed);
        if (input.keys["d"]) this.target.addScaledVector(right, speed);

        if (input.keys["q"]) this.target.y -= speed;
        if (input.keys["e"]) this.target.y += speed;
    }

    updateCameraPosition(input) {
        const x = Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
        const y = Math.sin(this.pitch) * this.distance;
        const z = Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;

        this.camera.position.set(
            this.target.x + x,
            this.target.y + y,
            this.target.z + z
        );

        this.camera.lookAt(this.target);
    }

    resize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
}
window.EditorCamera = EditorCamera;