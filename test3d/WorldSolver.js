class WorldSolver {
    constructor(game) {
        this.game = game;

        this.playerRadius = 0.35;
        this.groundY = 0;
        this.snapDistance = 0.25;

        this.lastGroundObject = null;
        this.groundRaycaster = new THREE.Raycaster();
        this.down = new THREE.Vector3(0, -1, 0);
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

            const box = this.getRealBox(obj);
            const isWater = this.isWater(obj);

            // Avoid raycasting every lake each frame; the exact ray test below
            // handles the irregular shoreline once the player is in its bounds.
            if (isWater && (px < box.min.x || px > box.max.x || pz < box.min.z || pz > box.max.z)) continue;

            // A water GLB can be an irregular shoreline. Its bounding box
            // reaches over dry ground, so use the rendered surface itself for
            // its footprint and height instead of treating that box as water.
            const waterY = isWater ? this.getWaterSurfaceY(player, obj, box) : null;
            if (isWater && waterY === null) continue;

            const insideX =
                isWater
                    ? true
                    : px + this.playerRadius > box.min.x && px - this.playerRadius < box.max.x;

            const insideZ =
                pz + this.playerRadius > box.min.z &&
                pz - this.playerRadius < box.max.z;

            if (!insideX || (!isWater && !insideZ)) continue;

            const topY = waterY ?? box.max.y;

            if (topY > bestY && topY <= playerBottomY + this.snapDistance) {
                bestY = topY;
                bestObj = obj;
            }
        }

        this.lastGroundObject = bestObj;
        return bestY;
    }
    getWaterSurfaceY(player, water, box) {
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

        for (const hit of this.groundRaycaster.intersectObject(water, true)) {
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

        return c === "solid" || c === "floor" || c === "ground";
    }

    isWater(obj) {
        const type = obj.userData.assetType || {};
        return /water/i.test(type.id || "") || /water/i.test(type.name || "");
    }

    isSolid(obj) {
        const c = this.getCollisionType(obj);

        if (c === "none") return false;
        if (c === "ghost") return false;
        if (c === "trigger") return false;
        if (c === "floor") return false;
        if (c === "ground") return false;

        return c === "solid" || c === "wall";
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
        const px = player.position.x;
        const pz = player.position.z;

        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;
        const playerTopY = playerBottomY + this.getPlayerHeight(player);

        const box = this.getRealBox(obj);

        const verticalOverlap =
            playerTopY > box.min.y &&
            playerBottomY < box.max.y;

        if (!verticalOverlap) return false;

        const closestX = this.clamp(px, box.min.x, box.max.x);
        const closestZ = this.clamp(pz, box.min.z, box.max.z);

        const dx = px - closestX;
        const dz = pz - closestZ;

        return dx * dx + dz * dz <= this.playerRadius * this.playerRadius;
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
    resolveHorizontal(player) {
        if (!player) return;

        for (const obj of this.game.mapObjects) {
            if (obj === player) continue;
            if (!this.isSolid(obj)) continue;

            const collision = this.getCollisionType(obj);

            if (collision === "wall") {
                this.resolveHorizontalOBB(player, obj);
            } else {
                this.resolveHorizontalAABB(player, obj);
            }
        }
    }
    clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    getPlayerHeight(player) {
        if (this.game.playerHeight) return this.game.playerHeight;

        const box = this.getRealBox(player);
        return Math.max(0.1, box.max.y - box.min.y);
    }
    playerOverlapsOBB(player, obj) {
        const r = this.playerRadius;

        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;
        const playerTopY = playerBottomY + this.getPlayerHeight(player);

        const localBox = this.getLocalBox(obj);
        if (!localBox) return null;

        obj.updateWorldMatrix(true, true);

        const localCenter = obj.worldToLocal(
            new THREE.Vector3(player.position.x, player.position.y, player.position.z).clone()
        );

        const localBottom = obj.worldToLocal(
            new THREE.Vector3(player.position.x, playerBottomY, player.position.z).clone()
        );

        const localTop = obj.worldToLocal(
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

        const distSq = dx * dx + dz * dz;

        if (distSq >= r * r) return null;

        return {
            localCenter,
            localBox,
            dx,
            dz,
            distSq
        };
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
    resolveHorizontalOBB(player, obj) {
        const hit = this.playerOverlapsOBB(player, obj);
        if (!hit) return;

        const r = this.playerRadius;
        const { localCenter, localBox, dx, dz, distSq } = hit;

        let newLocal = localCenter.clone();

        if (distSq < 0.000001) {
            const pushLeft  = Math.abs(localCenter.x - localBox.min.x);
            const pushRight = Math.abs(localBox.max.x - localCenter.x);
            const pushBack  = Math.abs(localCenter.z - localBox.min.z);
            const pushFront = Math.abs(localBox.max.z - localCenter.z);

            const minPush = Math.min(pushLeft, pushRight, pushBack, pushFront);

            if (minPush === pushLeft) {
                newLocal.x = localBox.min.x - r;
            } else if (minPush === pushRight) {
                newLocal.x = localBox.max.x + r;
            } else if (minPush === pushBack) {
                newLocal.z = localBox.min.z - r;
            } else {
                newLocal.z = localBox.max.z + r;
            }
        } else {
            const dist = Math.sqrt(distSq);
            const push = r - dist;

            newLocal.x += (dx / dist) * push;
            newLocal.z += (dz / dist) * push;
        }

        const oldWorld = obj.localToWorld(localCenter.clone());
        const newWorld = obj.localToWorld(newLocal.clone());

        const pushX = newWorld.x - oldWorld.x;
        const pushZ = newWorld.z - oldWorld.z;

        player.position.x += pushX;
        player.position.z += pushZ;

        this.setSolidSideContact(player, obj, pushX, pushZ);
    }
}
