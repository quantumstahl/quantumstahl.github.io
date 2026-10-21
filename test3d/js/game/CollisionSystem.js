import * as THREE from "three";

// Static-prop collision adapted from CatAdventure's WorldSolver. Terrain is
// intentionally excluded: ChunkedTerrain already provides a fast, seamless
// height query across loaded chunk borders. Props use compound oriented boxes
// so a GLB's doorway is not filled by the bounds of its whole scene root.
export class CollisionSystem {
  constructor({ mapLoader }) {
    this.mapLoader = mapLoader;
    this.geometryCollisionBoxes = new WeakMap();
    this.maxHorizontalCorrection = 0.6;
  }

  resolvePlayer(player, radius, bottomOffset, height) {
    if (!player) return;
    const bottom = player.position.y - bottomOffset;
    const top = bottom + height;

    // Objects outside the active chunk window have no scene instance. The
    // player is constrained to gameplay chunks separately, so testing only
    // streamed objects gives correct collision without loading the world.
    for (const object of this.mapLoader.objects) {
      if (object === player || !this.isSolid(object)) continue;
      object.updateWorldMatrix(true, true);
      if (!this.playerTouchesBounds(player, radius, bottom, top, object)) continue;
      for (const part of this.getSolidParts(object)) {
        this.resolvePart(player, radius, bottom, top, part);
      }
    }
  }

  collisionType(object) { return object.userData.assetType?.collision ?? "solid"; }
  isSolid(object) {
    return ["solid", "wall", "floor-posts"].includes(this.collisionType(object));
  }

  playerTouchesBounds(player, radius, bottom, top, object) {
    if (!object.userData.collisionBounds) object.userData.collisionBounds = this.getLocalBox(object, true);
    const localBounds = object.userData.collisionBounds;
    if (!localBounds) return false;
    const box = localBounds.clone().applyMatrix4(object.matrixWorld);
    return player.position.x + radius >= box.min.x && player.position.x - radius <= box.max.x &&
      player.position.z + radius >= box.min.z && player.position.z - radius <= box.max.z &&
      top > box.min.y + .05 && bottom < box.max.y - .12;
  }

  getSolidParts(object) {
    if (object.userData.assetType?.collisionShape === "full") {
      if (!object.userData.fullCollisionPart) {
        const box = this.getLocalBox(object);
        object.userData.fullCollisionPart = box ? { object, localBox: box } : null;
      }
      return object.userData.fullCollisionPart ? [object.userData.fullCollisionPart] : [];
    }
    const parts = this.getCollisionParts(object);
    if (this.collisionType(object) !== "floor-posts") return parts;
    return parts.filter(part => {
      const box = part.localBox.clone().applyMatrix4(part.object.matrixWorld);
      return box.max.y - box.min.y > Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.25;
    });
  }

  getCollisionParts(object) {
    if (object.userData.compoundCollisionParts) return object.userData.compoundCollisionParts;
    const parts = [], proxyParts = [];
    object.traverse(child => {
      if (child.userData?.ignoreSnap || this.isFoliage(child) || child.isBoxHelper || child.isLine || child.isLineSegments || !child.isMesh || !child.geometry) return;
      const isProxy = /^(?:collider|collision|col)[ _.-]/i.test(child.name || "") || child.userData?.collisionProxy === true;
      const localBoxes = isProxy ? this.getFullGeometryBox(child.geometry) : this.getGeometryCollisionBoxes(child.geometry);
      for (const localBox of localBoxes) {
        const part = { object: child, localBox };
        parts.push(part);
        if (isProxy) proxyParts.push(part);
      }
    });
    object.userData.compoundCollisionParts = proxyParts.length ? proxyParts : parts;
    return object.userData.compoundCollisionParts;
  }

  isFoliage(object) {
    // Foliage may contain thousands of disconnected leaf cards. It must never
    // become a set of colliders; authors can add a COL_* proxy if a canopy or
    // hedge needs a deliberate solid volume.
    return object.userData?.maxPaintLeafBatch || /(?:^|[_ .-])(leaf|leaves|foliage|canopy)(?:$|[_ .-])/i.test(object.name || "");
  }

  getFullGeometryBox(geometry) {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.isEmpty() ? [] : [geometry.boundingBox.clone()];
  }

  getGeometryCollisionBoxes(geometry) {
    const cached = this.geometryCollisionBoxes.get(geometry);
    if (cached) return cached;
    const position = geometry.getAttribute("position");
    if (!position) return [];
    const index = geometry.getIndex();
    const triangleCount = Math.floor((index ? index.count : position.count) / 3);
    const parent = Array.from({ length: triangleCount }, (_, triangle) => triangle);
    const find = triangle => {
      while (parent[triangle] !== triangle) {
        parent[triangle] = parent[parent[triangle]];
        triangle = parent[triangle];
      }
      return triangle;
    };
    const join = (a, b) => {
      a = find(a); b = find(b);
      if (a !== b) parent[b] = a;
    };

    // Exporters often merge a whole model into one mesh while retaining its
    // disconnected components. Group only triangles that touch, so leaves,
    // gaps, doorways, and other empty areas remain walkable.
    const owners = new Map();
    const vertex = new THREE.Vector3();
    const keyFor = vertexIndex => {
      vertex.fromBufferAttribute(position, vertexIndex);
      return `${vertex.x.toFixed(5)},${vertex.y.toFixed(5)},${vertex.z.toFixed(5)}`;
    };
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      for (let corner = 0; corner < 3; corner++) {
        const element = triangle * 3 + corner;
        const vertexIndex = index ? index.getX(element) : element;
        const key = keyFor(vertexIndex);
        const owner = owners.get(key);
        if (owner === undefined) owners.set(key, triangle);
        else join(triangle, owner);
      }
    }

    const boxes = new Map();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const root = find(triangle);
      let box = boxes.get(root);
      if (!box) { box = new THREE.Box3(); boxes.set(root, box); }
      for (let corner = 0; corner < 3; corner++) {
        const element = triangle * 3 + corner;
        vertex.fromBufferAttribute(position, index ? index.getX(element) : element);
        box.expandByPoint(vertex);
      }
    }
    // A tree trunk and its branches are usually one connected component. Its
    // full bounds would therefore make the cat collide with branches many
    // metres above the ground. Keep only the lower portion of every component
    // for automatic collision. Purpose-built COL_* proxies remain exact and
    // bypass this fallback shape entirely.
    const groundBoxes = new Map();
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const root = find(triangle);
      const component = boxes.get(root);
      const cutoffY = component.min.y + Math.min(2.5, Math.max(.75, (component.max.y - component.min.y) * .70));
      let groundBox = groundBoxes.get(root);
      for (let corner = 0; corner < 3; corner++) {
        const element = triangle * 3 + corner;
        vertex.fromBufferAttribute(position, index ? index.getX(element) : element);
        if (vertex.y > cutoffY) continue;
        if (!groundBox) { groundBox = new THREE.Box3(); groundBoxes.set(root, groundBox); }
        groundBox.expandByPoint(vertex);
      }
    }
    const result = [...groundBoxes.values()];
    this.geometryCollisionBoxes.set(geometry, result);
    return result;
  }

  getLocalBox(object, includeFoliage = false) {
    const box = new THREE.Box3(), inverse = object.matrixWorld.clone().invert();
    let hasBox = false;
    object.traverse(child => {
      if (!child.isMesh || !child.geometry || child.userData?.ignoreSnap || (!includeFoliage && this.isFoliage(child))) return;
      child.geometry.computeBoundingBox();
      if (!child.geometry.boundingBox) return;
      const childBox = child.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld));
      if (hasBox) box.union(childBox); else { box.copy(childBox); hasBox = true; }
    });
    return hasBox ? box : null;
  }

  resolvePart(player, radius, playerBottom, playerTop, part) {
    const collider = part.object, box = part.localBox;
    const matrix = collider.matrixWorld.elements;
    const scaleX = Math.max(.0001, Math.hypot(matrix[0], matrix[1], matrix[2]));
    const scaleZ = Math.max(.0001, Math.hypot(matrix[8], matrix[9], matrix[10]));
    const center = collider.worldToLocal(player.position.clone());
    const localBottom = collider.worldToLocal(new THREE.Vector3(player.position.x, playerBottom, player.position.z));
    const localTop = collider.worldToLocal(new THREE.Vector3(player.position.x, playerTop, player.position.z));
    if (localTop.y <= box.min.y + .05 || localBottom.y >= box.max.y - .12) return;

    const closestX = THREE.MathUtils.clamp(center.x, box.min.x, box.max.x);
    const closestZ = THREE.MathUtils.clamp(center.z, box.min.z, box.max.z);
    const dx = center.x - closestX, dz = center.z - closestZ;
    const worldDX = dx * scaleX, worldDZ = dz * scaleZ;
    const distanceSquared = worldDX * worldDX + worldDZ * worldDZ;
    if (distanceSquared >= radius * radius) return;

    const adjusted = center.clone();
    if (distanceSquared < .000001) {
      const distances = [Math.abs(center.x - box.min.x) * scaleX, Math.abs(box.max.x - center.x) * scaleX, Math.abs(center.z - box.min.z) * scaleZ, Math.abs(box.max.z - center.z) * scaleZ];
      const side = distances.indexOf(Math.min(...distances));
      if (side === 0) adjusted.x = box.min.x - radius / scaleX;
      else if (side === 1) adjusted.x = box.max.x + radius / scaleX;
      else if (side === 2) adjusted.z = box.min.z - radius / scaleZ;
      else adjusted.z = box.max.z + radius / scaleZ;
    } else {
      const distance = Math.sqrt(distanceSquared), push = radius - distance;
      adjusted.x += worldDX / distance * push / scaleX;
      adjusted.z += worldDZ / distance * push / scaleZ;
    }

    const oldWorld = collider.localToWorld(center.clone());
    const newWorld = collider.localToWorld(adjusted);
    let pushX = newWorld.x - oldWorld.x, pushZ = newWorld.z - oldWorld.z;
    const pushLength = Math.hypot(pushX, pushZ);
    if (pushLength > this.maxHorizontalCorrection) {
      const factor = this.maxHorizontalCorrection / pushLength;
      pushX *= factor; pushZ *= factor;
    }
    player.position.x += pushX;
    player.position.z += pushZ;
  }
}
