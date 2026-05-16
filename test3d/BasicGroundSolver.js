class BasicGroundSolver {
    constructor(game) {
        this.game = game;

        this.playerRadius = 0.35;
        this.groundY = 0;

        // Hur långt ovanför en yta katten får vara och ändå landa/snappa
        this.snapDistance = 0.25;
    }

    updatePlayer(player, scale) {
        if (!player) return;

        // gravity
        this.game.playerVelY += this.game.gravity * scale;
        player.position.y += this.game.playerVelY * scale;

        const groundY = this.findGroundYUnderPlayer(player);

        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;

        // landa endast när katten faller
        if (this.game.playerVelY <= 0 && playerBottomY <= groundY + this.snapDistance) {
            player.position.y = groundY + bottomOffset;
            this.game.playerVelY = 0;
            this.game.onGround = true;
        } else {
            this.game.onGround = false;
        }
    }

    findGroundYUnderPlayer(player) {
        const px = player.position.x;
        const py = player.position.y;
        const pz = player.position.z;

        let bestY = this.groundY;

        for (const obj of this.game.mapObjects) {
            if (obj === player) continue;

            const type = obj.userData.assetType;

            // Senare kan du sätta collision: "none" på blommor/träd osv
            if (type?.collision === "none") continue;

            const box = this.getRealBox(obj);

            const insideX =
                px + this.playerRadius > box.min.x &&
                px - this.playerRadius < box.max.x;

            const insideZ =
                pz + this.playerRadius > box.min.z &&
                pz - this.playerRadius < box.max.z;

            if (!insideX || !insideZ) continue;

            const topY = box.max.y;

            // Ytan måste vara under eller nära katten, inte långt ovanför
            if (topY > bestY && topY <= py + this.snapDistance) {
                bestY = topY;
            }
        }

        return bestY;
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

        const px = player.position.x;
        const pz = player.position.z;

        const bottomOffset = this.game.playerBottomOffset || 0;
        const playerBottomY = player.position.y - bottomOffset;
        const playerTopY = playerBottomY + this.getPlayerHeight(player);

        for (const obj of this.game.mapObjects) {
            if (obj === player) continue;

            const type = obj.userData.assetType;
            if (type?.collision === "none") continue;
            if (type?.collision === "floor") continue; // senare om du vill ha bara golv

            const box = this.getRealBox(obj);

            // Om katten är helt ovanför/under objektet, ingen sidokollision
            const verticalOverlap =
                playerTopY > box.min.y + 0.05 &&
                playerBottomY < box.max.y - 0.05;

            if (!verticalOverlap) continue;

            // Circle-vs-AABB i X/Z
            const closestX = this.clamp(px, box.min.x, box.max.x);
            const closestZ = this.clamp(pz, box.min.z, box.max.z);

            const dx = px - closestX;
            const dz = pz - closestZ;

            const distSq = dx * dx + dz * dz;
            const r = this.playerRadius;

            if (distSq >= r * r) continue;

            // Om centrum är exakt inne i boxen kan dx/dz bli 0.
            // Då väljer vi minsta väg ut.
            if (distSq < 0.000001) {
                this.pushOutFromInsideBox(player, box);
                continue;
            }

            const dist = Math.sqrt(distSq);
            const push = r - dist;

            player.position.x += (dx / dist) * push;
            player.position.z += (dz / dist) * push;
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

    pushOutFromInsideBox(player, box) {
        const px = player.position.x;
        const pz = player.position.z;
        const r = this.playerRadius;

        const pushLeft  = Math.abs(px - box.min.x);
        const pushRight = Math.abs(box.max.x - px);
        const pushBack  = Math.abs(pz - box.min.z);
        const pushFront = Math.abs(box.max.z - pz);

        const minPush = Math.min(pushLeft, pushRight, pushBack, pushFront);

        if (minPush === pushLeft) {
            player.position.x = box.min.x - r;
        } else if (minPush === pushRight) {
            player.position.x = box.max.x + r;
        } else if (minPush === pushBack) {
            player.position.z = box.min.z - r;
        } else {
            player.position.z = box.max.z + r;
        }
    }
}