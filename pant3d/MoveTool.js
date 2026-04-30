class MoveTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const input = this.app.input;
        const selected = this.app.selected;

        if (!selected) return;
        
        
        const isLandscape = this.app.canvas.width > this.app.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, this.app.canvas.height * 0.18)
            : Math.min(150, this.app.canvas.width * 0.20);
        
        if (input.mouse.down&&input.mouse.y<this.app.canvas.height-btnSize*1.5) {
            this.moveSelectedToMouse();
        }
    }

    moveSelectedToMouse() {
        const selected = this.app.selected;
        if (!selected) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        if (hit.object !== this.app.ground) {
            this.snapToObjectSurface(selected, hit);
        } else {
            this.snapToGround(selected, hit.point);
        }
    }
    snapToObjectSurface(obj, hit) {
        const p = hit.point.clone();

        const n = hit.face.normal.clone();
        n.transformDirection(hit.object.matrixWorld);

        const objBox = new THREE.Box3().setFromObject(obj);
        const objSize = new THREE.Vector3();
        objBox.getSize(objSize);

        const offset = new THREE.Vector3(
            Math.abs(n.x) * objSize.x / 2,
            Math.abs(n.y) * objSize.y / 2,
            Math.abs(n.z) * objSize.z / 2
        );

        obj.position.set(
            p.x + n.x * offset.x,
            p.y + n.y * offset.y,
            p.z + n.z * offset.z
        );

        obj.position.x = Math.round(obj.position.x);
        obj.position.y = Math.round(obj.position.y);
        obj.position.z = Math.round(obj.position.z);
    }
    getMouseHit() {
        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();

        const mouseNdc = new THREE.Vector2(
            (input.mouse.x / rect.width) * 2 - 1,
            -(input.mouse.y / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouseNdc, this.app.camera.camera);

        const targets = this.app.objects.filter(o => o !== this.app.selected);

        const hitsObjects = raycaster.intersectObjects(targets, true);
        if (hitsObjects.length) return hitsObjects[0];

        const hitsGround = raycaster.intersectObject(this.app.ground);
        if (hitsGround.length) return hitsGround[0];

        return null;
    }
    snapToGround(obj, p) {
        obj.position.x = Math.round(p.x);
        obj.position.z = Math.round(p.z);

        const box = new THREE.Box3().setFromObject(obj);
        obj.position.y -= box.min.y;
    }
    

}