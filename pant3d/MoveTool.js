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
        const moveSpeed = 0.005 * scale;
        
        if (this.app.Yblue) {
            if (input.keys["w"]) selected.position.y += moveSpeed;
            if (input.keys["s"]) selected.position.y -= moveSpeed;

            // 👉 stoppa genom marken
            const box = new THREE.Box3().setFromObject(selected);

            if (box.min.y < 0) {
                selected.position.y -= box.min.y;
            }
        }
        else{
            if (input.keys["a"])  selected.position.z += moveSpeed;
            if (input.keys["d"]) selected.position.z -= moveSpeed;
            if (input.keys["w"])    selected.position.x -= moveSpeed;
            if (input.keys["s"])  selected.position.x += moveSpeed;
        }
        
    }

    moveSelectedToMouse() {
        const selected = this.app.selected;
        if (!selected) return;

        const hit = this.getMouseHit();
        if (!hit) return;

        const snap = this.findBestSnapPoint(hit);

        if (snap) {
            this.placeObjectBottomCenterAt(selected, snap);
        } else if (hit.object === this.app.ground) {
            this.snapToGround(selected, hit.point);
        } else {
            this.placeObjectBottomCenterAt(selected, hit.point);
        }
    }
    snapToObjectSurface(obj, hit) {
        const p = hit.point.clone();

        const n = hit.face.normal.clone();
        n.transformDirection(hit.object.matrixWorld);

        const objBox = this.getRealBox(obj);
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

        const box = this.getRealBox(obj);
        obj.position.y -= box.min.y;
    }
    getSnapPointsForObject(o) {
        const box = new THREE.Box3().setFromObject(o);
        const c = box.getCenter(new THREE.Vector3());

        return [
            // center
            c.clone(),

            // top / bottom
            new THREE.Vector3(c.x, box.max.y, c.z),
            new THREE.Vector3(c.x, box.min.y, c.z),

            // sidor
            new THREE.Vector3(box.min.x, c.y, c.z),
            new THREE.Vector3(box.max.x, c.y, c.z),
            new THREE.Vector3(c.x, c.y, box.min.z),
            new THREE.Vector3(c.x, c.y, box.max.z),

            // hörn uppe
            new THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
    }
    getAirSnapPoints(objects, maxDist = 30.0) {
        const points = [];

        for (let i = 0; i < objects.length; i++) {
            for (let j = i + 1; j < objects.length; j++) {
                const a = objects[i];
                const b = objects[j];

                if (a === this.app.selected || b === this.app.selected) continue;
                if (a === this.app.ground || b === this.app.ground) continue;

                const boxA = new THREE.Box3().setFromObject(a);
                const boxB = new THREE.Box3().setFromObject(b);

                const ca = boxA.getCenter(new THREE.Vector3());
                const cb = boxB.getCenter(new THREE.Vector3());

                const flatDist = Math.hypot(ca.x - cb.x, ca.z - cb.z);
                if (flatDist > maxDist) continue;

                points.push(new THREE.Vector3(
                    (ca.x + cb.x) * 0.5,
                    Math.max(boxA.max.y, boxB.max.y),
                    (ca.z + cb.z) * 0.5
                ));
            }
        }

        return points;
    }
    findBestSnapPoint(hit) {
        const selected = this.app.selected;

        const objects = this.app.objects.filter(o =>
            o !== selected && o !== this.app.ground
        );

        const airPoints = this.getAirSnapPoints(objects, 30.0);

        // 1. Testa luft-punkter först
        const bestAir = this.findClosestScreenPoint(airPoints, 50);
        if (bestAir) return bestAir;

        // 2. Annars vanliga objekt-punkter
        const objectPoints = [];

        for (const o of objects) {
            objectPoints.push(...this.getSnapPointsForObject(o));
        }

        const bestObject = this.findClosestScreenPoint(objectPoints, 1);
        if (bestObject) return bestObject;

        return null;
    }
    placeObjectBottomCenterAt(obj, point) {
        const box = this.getRealBox(obj);

        const center = box.getCenter(new THREE.Vector3());
        const bottomY = box.min.y;
        const dx = point.x - center.x;
        const dz = point.z - center.z;
        const dy = point.y - bottomY;

        obj.position.x += dx;
        obj.position.y += dy;
        obj.position.z += dz;

      
    }
    findClosestScreenPoint(points, maxPixels) {
        let best = null;
        let bestDist = Infinity;

        const input = this.app.input;
        const rect = this.app.renderer.canvas.getBoundingClientRect();
        const camera = this.app.camera.camera;

        for (const p of points) {
            const screen = p.clone().project(camera);

            const sx = (screen.x * 0.5 + 0.5) * rect.width;
            const sy = (-screen.y * 0.5 + 0.5) * rect.height;

            const d = Math.hypot(sx - input.mouse.x, sy - input.mouse.y);

            if (d < bestDist) {
                bestDist = d;
                best = p;
            }
        }

        if (best && bestDist <= maxPixels) return best;

        return null;
    }
    getRealBox(obj) {
        const box = new THREE.Box3();
        let hasBox = false;

        obj.updateWorldMatrix(true, true);

        obj.traverse(child => {
            // ignorera helpers / selection boxes / linjer
            if (child.userData && child.userData.ignoreSnap) return;
            if (child.isBoxHelper) return;
            if (child.isLine || child.isLineSegments) return;

            if (!child.isMesh) return;
            if (!child.geometry) return;

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
    placeObjectOnTopOfObject(obj, target) {
        const objBox = this.getRealBox(obj);
        const targetBox = this.getRealBox(target);

        const objCenter = objBox.getCenter(new THREE.Vector3());
        const targetCenter = targetBox.getCenter(new THREE.Vector3());

        obj.position.x += targetCenter.x - objCenter.x;
        obj.position.z += targetCenter.z - objCenter.z;

        obj.position.y += targetBox.max.y - objBox.min.y;

        // Ingen Math.round här
    }
}