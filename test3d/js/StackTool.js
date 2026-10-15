class StackTool {
    constructor(game) {
        this.game = game;
        this.raycaster = new THREE.Raycaster();
        this.mouseNdc = new THREE.Vector2();
    }

    update(scale) {
        const input = this.game.input;
        const selected = this.game.selected;

        if (!selected) return;
        if (!input.mouse.justPressed) return;
        if (input.mouse.rightDown) return;

        const hit = this.getHit();
        if (!hit) return;

        this.placeSelectedOnHit(selected, hit);

        this.syncSelectedDataFromMesh();

        this.game.updateSelectionBox?.();
        this.game.editorTree?.renderProperties?.();
        this.game.markUnsaved?.();
    }

    getHit() {
        const input = this.game.input;
        const canvas = this.game.renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        this.mouseNdc.x = (input.mouse.x / rect.width) * 2 - 1;
        this.mouseNdc.y = -(input.mouse.y / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouseNdc, this.game.camera);

        const targets = [];

        for (const obj of this.game.mapObjects) {
            if (obj !== this.game.selected) {
                targets.push(obj);
            }
        }

        if (this.game.ground) {
            targets.push(this.game.ground);
        }

        const hits = this.raycaster.intersectObjects(targets, true);

        return hits.length ? hits[0] : null;
    }

    placeSelectedOnHit(obj, hit) {
        const point = hit.point.clone();

        // Enkel V1:
        // placera objektets botten-center på träffpunkten
        this.placeObjectBottomCenterAt(obj, point);
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