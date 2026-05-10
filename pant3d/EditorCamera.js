class EditorCamera {
    constructor(app) {
        this.app=app;
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

        // Vi använder bara target nu för att hålla det rent
        this.target = new THREE.Vector3(0, 0, 0); 

        this.yaw = 0.6;
        this.pitch = 0.35;
        this.distance = 8;

        this.updateCameraPosition();
    }

    update(input, scale) {
        const rotSpeed = 0.005;

        if (input.mouse.rightDown) {

            this.target.y+=input.mouse.dy * rotSpeed;
            this.yaw -= input.mouse.dx * rotSpeed;
            const limit = Math.PI / 2 - 0.05;
            this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
        }
        if(this.app?.tools?.current !== this.app?.tools?.tools.move && this.app?.tools?.current !== this.app?.tools?.tools.rotate && this.app?.tools?.current !== this.app?.tools?.tools.scale && this.app?.tools?.current !== this.app?.tools?.tools.uniscale && this.app?.tools?.current !== this.app?.tools?.tools.anirot&& this.app?.tools?.current !== this.app?.tools?.tools.animove&& this.app?.tools?.current !== this.app?.tools?.tools.aniscale)this.moveTarget(input, scale);
       // if(this.app?.tools?.current === this.app?.tools?.tools.primselect||this.app?.tools?.current === this.app?.tools?.tools.select || this.app?.tools?.current === this.app?.tools?.tools.group || (this.app.UI.animatetoggle && (this.app?.tools?.current !== this.app?.tools?.tools.anirot && this.app?.tools?.current !== this.app?.tools?.tools.animove&& this.app?.tools?.current !== this.app?.tools?.tools.aniscale)))this.moveTarget(input, scale);
        this.updateCameraPosition();
    }

    moveTarget(input, scale) {
        const speed = 0.06 * scale;

        // "Forward" baserat på din yaw (vinkeln runt Y-axeln)
        // Vi vill gå mot target, så vi använder negativa värden för 'W'
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

        // Uppdatera target direkt istället för en separat pan-vektor
        if (input.keys["w"]) {this.target.addScaledVector(forward, -speed);}
        if (input.keys["s"]) {this.target.addScaledVector(forward, speed);}
        if (input.keys["a"]) this.target.addScaledVector(right, -speed);
        if (input.keys["d"]) this.target.addScaledVector(right, speed);

        if (input.keys["q"]) this.target.y -= speed;
        if (input.keys["e"]) this.target.y += speed;
    }

    updateCameraPosition() {
        // Räkna ut offset från target baserat på rotation och distans
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
}