class MoveTool {
    constructor(game) {
        this.game = game;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();

        this.dragging = false;
    }

    update(scale) {
        const input = this.game.input;
        const selected = this.game.selected;

        if (!selected) return;

        if (input.mouse.justPressed && !input.mouse.rightDown) {
            this.dragging = true;
        }

        if (input.mouse.justReleased) {
            if (this.dragging) {
                this.syncSelectedDataFromMesh();
                this.game.markUnsaved?.();
            }

            this.dragging = false;
        }

        if (this.dragging && input.mouse.down) {
            this.moveSelectedToGround();
            this.syncSelectedDataFromMesh();
            this.game.updateSelectionBox();
            this.game.editorTree?.renderProperties?.();
        }

        this.moveSelectedWithKeyboard(scale);
    }

    moveSelectedToGround() {
        const selected = this.game.selected;
        if (!selected) return;

        const hit = this.getGroundHit();
        if (!hit) return;

        this.placeObjectBottomCenterAt(selected, hit.point);
    }

    getGroundHit() {
        const input = this.game.input;
        const canvas = this.game.renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.mouseNdc.x = (input.mouse.x / rect.width) * 2 - 1;
        this.mouseNdc.y = -(input.mouse.y / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouseNdc, this.game.camera);

        const hits = this.raycaster.intersectObject(this.game.ground, true);
        return hits.length ? hits[0] : null;
    }

    placeObjectBottomCenterAt(obj, point) {
        obj.updateWorldMatrix(true, true);

        const box = this.getRealBox(obj);

        const bottomCenter = new THREE.Vector3(
            (box.min.x + box.max.x) / 2,
            box.min.y,
            (box.min.z + box.max.z) / 2
        );

        const delta = new THREE.Vector3(
            point.x - bottomCenter.x,
            point.y - bottomCenter.y,
            point.z - bottomCenter.z
        );

        obj.position.add(delta);
        obj.updateWorldMatrix(true, true);
    }

    getRealBox(obj) {
        const box = new THREE.Box3();
        let hasBox = false;

        obj.updateWorldMatrix(true, true);

        obj.traverse(child => {
            if (child.userData?.ignoreSnap) return;
            if (child.isBoxHelper) return;
            if (child.isLine || child.isLineSegments) return;
            if (!child.isMesh || !child.geometry) return;

            child.geometry.computeBoundingBox();

            const childBox = child.geometry.boundingBox.clone();
            childBox.applyMatrix4(child.matrixWorld);

            if (!hasBox) {
                box.copy(childBox);
                hasBox = true;
            } else {
                box.union(childBox);
            }
        });

        if (!hasBox) {
            box.setFromObject(obj);
        }

        return box;
    }

    moveSelectedWithKeyboard(scale) {
        const selected = this.game.selected;
        const input = this.game.input;
        if (!selected) return;

        let speed = 0.05 * scale;
        if (input.keys["shift"]) speed *= 4;

        const move = new THREE.Vector3();

        if (input.keys["arrowup"]) move.z -= speed;
        if (input.keys["arrowdown"]) move.z += speed;
        if (input.keys["arrowleft"]) move.x -= speed;
        if (input.keys["arrowright"]) move.x += speed;

        if (input.keys["r"]) move.y += speed;
        if (input.keys["f"]) move.y -= speed;

        if (move.lengthSq() > 0) {
            selected.position.add(move);
            this.syncSelectedDataFromMesh();
            this.game.updateSelectionBox();
            this.game.editorTree?.renderProperties?.();
            this.game.markUnsaved?.();
        }
    }

    syncSelectedDataFromMesh() {
        const obj = this.game.selected;
        if (!obj) return;

        const inst = obj.userData.mapObject;
        if (!inst) return;

        inst.x = Number(obj.position.x.toFixed(3));
        inst.y = Number(obj.position.y.toFixed(3));
        inst.z = Number(obj.position.z.toFixed(3));

        inst.rotX = Number(obj.rotation.x.toFixed(3));
        inst.rotY = Number(obj.rotation.y.toFixed(3));
        inst.rotZ = Number(obj.rotation.z.toFixed(3));

        inst.scale = Number(obj.scale.x.toFixed(3));
    }
}
window.MoveTool = MoveTool;