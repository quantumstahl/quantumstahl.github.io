class WorldSolver {
    constructor(game) {
        this.game = game;

        this.playerRadius = 0.35;
        this.groundY = 0;
        this.snapDistance = 0.25;
        this.maxHorizontalCorrection = 0.6;

        this.lastGroundObject = null;
        this.groundRaycaster = new THREE.Raycaster();
        this.down = new THREE.Vector3(0, -1, 0);
        this.geometryCollisionBoxes = new WeakMap();
    }

    beginFrame() {
        this.resetContactsForActiveObjects();
        this.lastGroundObject = null;
    }

    resetContactsForActiveObjects() {
        for (const mesh of this.game.mapObjects) {
            const mapObj = mesh.userData.mapObject;
            if (mapObj?.resetContacts) {
                mapObj.resetContacts();
            }
        }
    }

    updatePlayerY(player, scale) {
        if (!player) return;

        this.game.playerVelY += this.game.gravity * scale;
        player.position.y += this.game.playerVelY * scale;

        const groundY = this.findGroundYUnderPlayer(player);

        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;

        if (this.game.playerVelY <= 0 && playerBottomY <= groundY + this.snapDistance) {
            player.position.y = groundY + bottomOffset;
            this.game.playerVelY = 0;
            this.game.onGround = true;

            const playerObj = player.userData.mapObject;
            const groundObj = this.lastGroundObject?.userData?.mapObject || null;

            if (playerObj) {
                playerObj.contactsSolid.down = groundObj;
            }
        } else {
            this.game.onGround = false;
        }
    }
    findGroundYUnderPlayer(player) {
        const px = player.position.x;
        const pz = player.position.z;
        // The player's visual root can be offset (for example, when wading).
        // Ground snapping must use the collision bottom, not that visual root.
        const playerBottomY = player.position.y - (this.game.playerBottomOffset || 0);

        let bestY = this.groundY;
        let bestObj = null;

        for (const obj of this.game.mapObjects) {
            if (obj === player) continue;
            if (!this.isGround(obj)) continue;

            const isWater = this.isWater(obj);
            const objectBox = this.getRealBox(obj);

            const exactSurface = isWater || this.isFloorOnly(obj);
            // Floors such as bridge decks and farms are often exported as one
            // merged mesh. Their AABB reaches from the dirt to crop tips, so
            // use the triangles below the cat to find a real walkable surface.
            if (exactSurface && (px < objectBox.min.x || px > objectBox.max.x || pz < objectBox.min.z || pz > objectBox.max.z)) continue;
            const surfaceY = exactSurface ? this.getMeshSurfaceY(player, obj, objectBox) : null;
            if (exactSurface && surfaceY === null) continue;

            // A GLB is a compound collider: each mesh supplies its own box.
            // This means a house's wall/roof pieces do not fill in its doorway
            // or interior merely because they share one scene root.
            const parts = exactSurface ? [null] : this.getCollisionParts(obj);
            for (const part of parts) {
                const box = part ? this.getPartWorldBox(part) : objectBox;
                const insideX = exactSurface || (px + this.playerRadius > box.min.x && px - this.playerRadius < box.max.x);
                const insideZ = exactSurface || (pz + this.playerRadius > box.min.z && pz - this.playerRadius < box.max.z);
                if (!insideX || !insideZ) continue;

                const topY = surfaceY ?? box.max.y;
                if (topY > bestY && topY <= playerBottomY + this.snapDistance) {
                    bestY = topY;
                    bestObj = obj;
                }
            }
        }

        this.lastGroundObject = bestObj;
        return bestY;
    }
    getMeshSurfaceY(player, mesh, box) {
        const startY = Math.max(
            player.position.y + this.getPlayerHeight(player) + 1,
            box.max.y + 1
        );
        this.groundRaycaster.set(
            new THREE.Vector3(player.position.x, startY, player.position.z),
            this.down
        );
        this.groundRaycaster.near = 0;
        this.groundRaycaster.far = startY - box.min.y + 0.1;

        for (const hit of this.groundRaycaster.intersectObject(mesh, true)) {
            if (hit.point.y <= player.position.y + this.snapDistance) return hit.point.y;
        }
        return null;
    }
    getCollisionType(obj) {
        return obj.userData.collisionOverride ||
               obj.userData.assetType?.collision ||
               "solid";
    }

    isGround(obj) {
        const c = this.getCollisionType(obj);

        if (c === "none") return false;
        if (c === "ghost") return false;
        if (c === "trigger") return false;
        // Water uses an OBB wall so its shoreline has the right shape, but it
        // still needs to act as a floor to produce the solid/down contact used
        // by the cat's wading effect.
        if (c === "wall") return this.isWater(obj);

        return c === "solid" || c === "floor" || c === "ground" || c === "floor-posts";
    }

    isWater(obj) {
        const type = obj.userData.assetType || {};
        return /water/i.test(type.id || "") || /water/i.test(type.name || "");
    }
    isFloorOnly(obj) {
        const collision = this.getCollisionType(obj);
        return collision === "floor" || collision === "ground" || collision === "floor-posts";
    }

    isSolid(obj) {
        const c = this.getCollisionType(obj);

        if (c === "none") return false;
        if (c === "ghost") return false;
        if (c === "trigger") return false;
        if (c === "floor") return false;
        if (c === "ground") return false;

        return c === "solid" || c === "wall" || c === "floor-posts";
    }

    isGhost(obj) {
        return this.getCollisionType(obj) === "ghost";
    }

    isTrigger(obj) {
        return this.getCollisionType(obj) === "trigger";
    }
    setSolidSideContact(playerMesh, hitMesh, pushX, pushZ) {
        const playerObj = playerMesh.userData.mapObject;
        const hitObj = hitMesh.userData.mapObject;

        if (!playerObj || !hitObj) return;

        if (Math.abs(pushX) > Math.abs(pushZ)) {
            if (pushX > 0) {
                playerObj.contactsSolid.left = hitObj;
            } else {
                playerObj.contactsSolid.right = hitObj;
            }
        } else {
            if (pushZ > 0) {
                playerObj.contactsSolid.back = hitObj;
            } else {
                playerObj.contactsSolid.front = hitObj;
            }
        }
    }
    pushOutFromInsideBox(player, box, obj) {
        const px = player.position.x;
        const pz = player.position.z;
        const r = this.playerRadius;

        const pushLeft  = Math.abs(px - box.min.x);
        const pushRight = Math.abs(box.max.x - px);
        const pushBack  = Math.abs(pz - box.min.z);
        const pushFront = Math.abs(box.max.z - pz);

        const minPush = Math.min(pushLeft, pushRight, pushBack, pushFront);

        const playerObj = player.userData.mapObject;
        const hitObj = obj?.userData?.mapObject || null;

        if (minPush === pushLeft) {
            player.position.x = box.min.x - r;
            if (playerObj) playerObj.contactsSolid.right = hitObj;
        } else if (minPush === pushRight) {
            player.position.x = box.max.x + r;
            if (playerObj) playerObj.contactsSolid.left = hitObj;
        } else if (minPush === pushBack) {
            player.position.z = box.min.z - r;
            if (playerObj) playerObj.contactsSolid.front = hitObj;
        } else {
            player.position.z = box.max.z + r;
            if (playerObj) playerObj.contactsSolid.back = hitObj;
        }
    }
    checkGhostAndTriggerContacts(player) {
        if (!player) return;

        const playerObj = player.userData.mapObject;
        if (!playerObj) return;

        for (const obj of this.game.mapObjects) {
            if (obj === player) continue;

            if (!this.isGhost(obj) && !this.isTrigger(obj)) continue;

            if (!this.playerOverlapsObject(player, obj)) continue;

            const hitObj = obj.userData.mapObject;
            if (!hitObj) continue;

            if (this.isGhost(obj)) {
                playerObj.addGhostContact?.(hitObj);
            }

            if (this.isTrigger(obj)) {
                playerObj.addTriggerContact?.(hitObj);
            }
        }
    }

    playerOverlapsObject(player, obj) {
        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;
        const playerTopY = playerBottomY + this.getPlayerHeight(player);

        obj.updateWorldMatrix(true, true);
        return this.getCollisionParts(obj).some(part =>
            this.playerOverlapsPartOBB(player, part, playerBottomY, playerTopY)
        );
    }
    getCollisionParts(obj) {
        // Geometry bounds do not change when the map object moves, so retain
        // them. MatrixWorld remains live and is applied at query time.
        if (obj.userData.compoundCollisionParts) return obj.userData.compoundCollisionParts;

        const parts = [];
        const proxyParts = [];
        obj.traverse(child => {
            if (child.userData?.ignoreSnap) return;
            if (child.isBoxHelper || child.isLine || child.isLineSegments) return;
            if (!child.isMesh || !child.geometry) return;

            child.geometry.computeBoundingBox();
            if (!child.geometry.boundingBox || child.geometry.boundingBox.isEmpty()) return;

            for (const localBox of this.getGeometryCollisionBoxes(child.geometry)) {
                const part = { object: child, localBox };
                parts.push(part);
                if (this.isCollisionProxy(child)) proxyParts.push(part);
            }
        });

        // Box-only map objects are meshes themselves, so they naturally get a
        // single part. Keep a safe fallback for unusual Object3D assets.
        if (!parts.length && obj.geometry) {
            obj.geometry.computeBoundingBox();
            if (obj.geometry.boundingBox) parts.push({ object: obj, localBox: obj.geometry.boundingBox.clone() });
        }

        // A model may contain purpose-built, invisible box meshes named
        // COLLIDER_* / COLLISION_* / COL_*. When present, those are the whole
        // collision shape; decorative render meshes are deliberately ignored.
        obj.userData.compoundCollisionParts = proxyParts.length ? proxyParts : parts;
        return obj.userData.compoundCollisionParts;
    }
    isCollisionProxy(obj) {
        return /^(?:collider|collision|col)[ _.-]/i.test(obj.name || "") ||
               obj.userData?.collisionProxy === true;
    }
    getGeometryCollisionBoxes(geometry) {
        const cached = this.geometryCollisionBoxes.get(geometry);
        if (cached) return cached;

        const position = geometry.getAttribute("position");
        if (!position) return [];
        const index = geometry.getIndex();
        const triangles = Math.floor((index ? index.count : position.count) / 3);
        const parent = Array.from({ length: triangles }, (_, i) => i);
        const find = i => {
            while (parent[i] !== i) {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            return i;
        };
        const join = (a, b) => {
            a = find(a); b = find(b);
            if (a !== b) parent[b] = a;
        };

        // A merged glTF mesh can contain several disconnected objects. Group
        // triangles by shared positions (including duplicated seam vertices).
        const owners = new Map();
        const vertex = new THREE.Vector3();
        const keyFor = vertexIndex => {
            vertex.fromBufferAttribute(position, vertexIndex);
            return `${vertex.x.toFixed(5)},${vertex.y.toFixed(5)},${vertex.z.toFixed(5)}`;
        };
        for (let triangle = 0; triangle < triangles; triangle++) {
            for (let corner = 0; corner < 3; corner++) {
                const element = triangle * 3 + corner;
                const key = keyFor(index ? index.getX(element) : element);
                const owner = owners.get(key);
                if (owner === undefined) owners.set(key, triangle);
                else join(triangle, owner);
            }
        }

        const boxes = new Map();
        for (let triangle = 0; triangle < triangles; triangle++) {
            const root = find(triangle);
            let box = boxes.get(root);
            if (!box) {
                box = new THREE.Box3();
                boxes.set(root, box);
            }
            for (let corner = 0; corner < 3; corner++) {
                const element = triangle * 3 + corner;
                vertex.fromBufferAttribute(position, index ? index.getX(element) : element);
                box.expandByPoint(vertex);
            }
        }
        const result = [...boxes.values()];
        this.geometryCollisionBoxes.set(geometry, result);
        return result;
    }
    getPartWorldBox(part) {
        return part.localBox.clone().applyMatrix4(part.object.matrixWorld);
    }
    getRealBox(obj) {
        const box = new THREE.Box3();
        let hasBox = false;

        obj.updateWorldMatrix(true, true);

        for (const part of this.getCollisionParts(obj)) {
            const childBox = this.getPartWorldBox(part);

            if (!hasBox) {
                box.copy(childBox);
                hasBox = true;
            } else {
                box.union(childBox);
            }
        }

        if (!hasBox) {
            box.setFromObject(obj);
        }

        return box;
    }
    resolveHorizontal(player) {
        if (!player) return;

        for (const obj of this.game.mapObjects) {
            if (obj === player) continue;
            if (!this.isSolid(obj)) continue;

            obj.updateWorldMatrix(true, true);
            for (const part of this.getSolidCollisionParts(obj)) {
                this.resolveHorizontalOBB(player, obj, part);
            }
        }
    }
    clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }
    getSolidCollisionParts(obj) {
        if (obj.userData.assetType?.collisionShape === "full") {
            if (!obj.userData.fullCollisionPart) {
                const localBox = this.getLocalBox(obj);
                obj.userData.fullCollisionPart = localBox ? { object: obj, localBox } : null;
            }
            return obj.userData.fullCollisionPart ? [obj.userData.fullCollisionPart] : [];
        }

        const parts = this.getCollisionParts(obj);
        if (this.getCollisionType(obj) !== "floor-posts") return parts;

        return parts.filter(part => {
            const box = this.getPartWorldBox(part);
            const width = box.max.x - box.min.x;
            const depth = box.max.z - box.min.z;
            const height = box.max.y - box.min.y;
            return height > Math.max(width, depth) * 1.25;
        });
    }

    getPlayerHeight(player) {
        if (this.game.playerHeight) return this.game.playerHeight;

        const box = this.getRealBox(player);
        return Math.max(0.1, box.max.y - box.min.y);
    }
    playerOverlapsPartOBB(player, part, playerBottomY, playerTopY) {
        const collider = part.object;
        const localBox = part.localBox;
        // Keep the player radius in world units. A non-uniformly scaled mesh
        // maps it to an ellipse in local space; using one "smallest scale"
        // radius here creates a huge false collision halo (notably logs.glb).
        const e = collider.matrixWorld.elements;
        const scaleX = Math.hypot(e[0], e[1], e[2]);
        const scaleZ = Math.hypot(e[8], e[9], e[10]);
        const safeScaleX = Math.max(0.0001, scaleX);
        const safeScaleZ = Math.max(0.0001, scaleZ);

        const localCenter = collider.worldToLocal(
            new THREE.Vector3(player.position.x, player.position.y, player.position.z).clone()
        );

        const localBottom = collider.worldToLocal(
            new THREE.Vector3(player.position.x, playerBottomY, player.position.z).clone()
        );

        const localTop = collider.worldToLocal(
            new THREE.Vector3(player.position.x, playerTopY, player.position.z).clone()
        );

        const verticalOverlap =
            localTop.y > localBox.min.y + 0.05 &&
            localBottom.y < localBox.max.y - 0.12;

        if (!verticalOverlap) return null;

        const closestX = this.clamp(localCenter.x, localBox.min.x, localBox.max.x);
        const closestZ = this.clamp(localCenter.z, localBox.min.z, localBox.max.z);

        const dx = localCenter.x - closestX;
        const dz = localCenter.z - closestZ;

        const worldDX = dx * safeScaleX;
        const worldDZ = dz * safeScaleZ;
        const distSq = worldDX * worldDX + worldDZ * worldDZ;
        const r = this.playerRadius;

        if (distSq >= r * r) return null;

        return {
            localCenter,
            localBox,
            dx,
            dz,
            distSq,
            radius: r,
            worldDX,
            worldDZ,
            scaleX: safeScaleX,
            scaleZ: safeScaleZ
        };
    }
    playerOverlapsOBB(player, obj, part = null) {
        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;
        const playerTopY = playerBottomY + this.getPlayerHeight(player);
        obj.updateWorldMatrix(true, true);
        return part
            ? this.playerOverlapsPartOBB(player, part, playerBottomY, playerTopY)
            : this.getCollisionParts(obj).map(candidate => this.playerOverlapsPartOBB(player, candidate, playerBottomY, playerTopY)).find(Boolean) || null;
    }
    getLocalBox(obj) {
        const box = new THREE.Box3();
        let hasBox = false;

        obj.updateWorldMatrix(true, true);
        const invRoot = obj.matrixWorld.clone().invert();

        obj.traverse(child => {
            if (child.userData?.ignoreSnap) return;
            if (child.isBoxHelper) return;
            if (child.isLine || child.isLineSegments) return;
            if (!child.isMesh || !child.geometry) return;

            child.geometry.computeBoundingBox();

            const childBox = child.geometry.boundingBox.clone();

            // child local -> world -> object local
            const m = new THREE.Matrix4()
                .multiplyMatrices(invRoot, child.matrixWorld);

            childBox.applyMatrix4(m);

            if (!hasBox) {
                box.copy(childBox);
                hasBox = true;
            } else {
                box.union(childBox);
            }
        });

        return hasBox ? box : null;
    }
    resolveHorizontalAABB(player, obj) {
        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;
        const playerTopY = playerBottomY + this.getPlayerHeight(player);

        const box = this.getRealBox(obj);

        const verticalOverlap =
            playerTopY > box.min.y + 0.05 &&
            playerBottomY < box.max.y - 0.12;

        if (!verticalOverlap) return;

        const px = player.position.x;
        const pz = player.position.z;

        const closestX = this.clamp(px, box.min.x, box.max.x);
        const closestZ = this.clamp(pz, box.min.z, box.max.z);

        const dx = px - closestX;
        const dz = pz - closestZ;

        const distSq = dx * dx + dz * dz;
        const r = this.playerRadius;

        if (distSq >= r * r) return;

        if (distSq < 0.000001) {
            this.pushOutFromInsideBox(player, box, obj);
            return;
        }

        const dist = Math.sqrt(distSq);
        const push = r - dist;

        const pushX = (dx / dist) * push;
        const pushZ = (dz / dist) * push;

        player.position.x += pushX;
        player.position.z += pushZ;

        this.setSolidSideContact(player, obj, pushX, pushZ);
    }
    resolveHorizontalOBB(player, obj, part = null) {
        const hit = this.playerOverlapsOBB(player, obj, part);
        if (!hit) return;

        const { localCenter, localBox, distSq, radius: r, worldDX, worldDZ, scaleX, scaleZ } = hit;

        let newLocal = localCenter.clone();

        if (distSq < 0.000001) {
            const pushLeft  = Math.abs(localCenter.x - localBox.min.x) * scaleX;
            const pushRight = Math.abs(localBox.max.x - localCenter.x) * scaleX;
            const pushBack  = Math.abs(localCenter.z - localBox.min.z) * scaleZ;
            const pushFront = Math.abs(localBox.max.z - localCenter.z) * scaleZ;

            const minPush = Math.min(pushLeft, pushRight, pushBack, pushFront);

            if (minPush === pushLeft) {
                newLocal.x = localBox.min.x - r / scaleX;
            } else if (minPush === pushRight) {
                newLocal.x = localBox.max.x + r / scaleX;
            } else if (minPush === pushBack) {
                newLocal.z = localBox.min.z - r / scaleZ;
            } else {
                newLocal.z = localBox.max.z + r / scaleZ;
            }
        } else {
            const dist = Math.sqrt(distSq);
            const push = r - dist;

            newLocal.x += (worldDX / dist) * push / scaleX;
            newLocal.z += (worldDZ / dist) * push / scaleZ;
        }

        const collider = part?.object || obj;
        const oldWorld = collider.localToWorld(localCenter.clone());
        const newWorld = collider.localToWorld(newLocal.clone());

        let pushX = newWorld.x - oldWorld.x;
        let pushZ = newWorld.z - oldWorld.z;
        // Never teleport the cat across a large box when it starts inside an
        // imperfect imported collider (for example an old merged log pile).
        const pushLength = Math.hypot(pushX, pushZ);
        if (pushLength > this.maxHorizontalCorrection) {
            const factor = this.maxHorizontalCorrection / pushLength;
            pushX *= factor;
            pushZ *= factor;
        }

        player.position.x += pushX;
        player.position.z += pushZ;

        this.setSolidSideContact(player, obj, pushX, pushZ);
    }
}
