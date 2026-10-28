import * as THREE from "three";

// Constructed only on explicit request. Debug resources never enter save data.
export class PhysicsDebug {
  constructor(scene, body, terrain) {
    this.body = body; this.terrain = terrain;
    this.root = new THREE.Group(); this.root.name = "Physics debug"; scene.add(this.root);
    this.capsule = new THREE.Mesh(new THREE.CapsuleGeometry(body.config.radius, body.halfSegment * 2, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, depthTest: false, transparent: true, opacity: .6 }));
    this.root.add(this.capsule);
    this.normal = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), .7, 0xffff00);
    this.root.add(this.normal);
    this.point = new THREE.Mesh(new THREE.SphereGeometry(.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false }));
    this.root.add(this.point);
    this.normals = [];
    for (let i = 0; i < 6; i++) {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), .5, 0xff4466);
      this.normals.push(arrow); this.root.add(arrow);
    }
    this.direction = new THREE.Vector3();
    this.capsuleAxis = new THREE.Vector3(0, 1, 0);
    this.bounds = this.makeLines(0xffaa33); this.cells = this.makeLines(0x44cc66);
    this.rockLines = this.makeMeshLines(0xff9955); this.objectLines = this.makeMeshLines(0xdd77ff);
    this.colliderBounds = this.makeLines(0xeeeeaa); this.debugBounds = {};
    this.drawTriangle = this.drawMeshTriangle.bind(this); this.drawEntry = this.drawColliderBounds.bind(this);
  }
  makeMeshLines(color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2048 * 18), 3)); geometry.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.55}));
    lines.frustumCulled = false; this.root.add(lines); return lines;
  }
  drawMeshTriangle(a, b, c, object) {
    const rock = object.type === "rock", glb = object.colliderKind === "object";
    if (!rock && !glb) return;
    const attribute = (rock ? this.rockLines : this.objectLines).geometry.attributes.position;
    let offset = rock ? this.rockOffset : this.objectOffset;
    if (offset + 18 > attribute.array.length) return;
    const v = attribute.array;
    v[offset++]=a.x;v[offset++]=a.y;v[offset++]=a.z;v[offset++]=b.x;v[offset++]=b.y;v[offset++]=b.z;
    v[offset++]=b.x;v[offset++]=b.y;v[offset++]=b.z;v[offset++]=c.x;v[offset++]=c.y;v[offset++]=c.z;
    v[offset++]=c.x;v[offset++]=c.y;v[offset++]=c.z;v[offset++]=a.x;v[offset++]=a.y;v[offset++]=a.z;
    if (rock) this.rockOffset = offset; else this.objectOffset = offset;
  }
  drawColliderBounds(entry) {
    const attribute = this.colliderBounds.geometry.attributes.position, b = entry.bounds;
    if (!entry.mesh || this.colliderBoundsOffset + 72 > attribute.array.length) return;
    this.colliderBoundsOffset = this.box(attribute.array,this.colliderBoundsOffset,b.minX,b.minY,b.minZ,b.maxX,b.maxY,b.maxZ);
  }
  makeLines(color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.terrain.maxCachedBlocks * 72), 3));
    geometry.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .5 }));
    lines.frustumCulled = false; this.root.add(lines); return lines;
  }
  box(array, offset, x0, y0, z0, x1, y1, z1) {
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < 4; i++) {
      const a = i & 1, b = (i >> 1) & 1;
      const x = axis === 0 ? x0 : a ? x1 : x0;
      const y = axis === 1 ? y0 : (axis === 0 ? a : b) ? y1 : y0;
      const z = axis === 2 ? z0 : b ? z1 : z0;
      array[offset++] = x; array[offset++] = y; array[offset++] = z;
      array[offset++] = axis === 0 ? x1 : x; array[offset++] = axis === 1 ? y1 : y; array[offset++] = axis === 2 ? z1 : z;
    }
    return offset;
  }
  update() {
    const body = this.body;
    body.updateCapsule();
    this.capsule.position.copy(body.capsuleStart).add(body.capsuleEnd).multiplyScalar(.5);
    this.direction.subVectors(body.capsuleEnd, body.capsuleStart);
    if (this.direction.lengthSq() < 1e-12) this.direction.copy(this.capsuleAxis);
    else this.direction.normalize();
    this.capsule.quaternion.setFromUnitVectors(this.capsuleAxis, this.direction);
    this.normal.visible = this.point.visible = body.grounded;
    this.normal.position.copy(body.groundPoint); this.normal.setDirection(body.groundNormal); this.point.position.copy(body.groundPoint);
    for (let i = 0; i < 6; i++) {
      const arrow = this.normals[i]; this.direction.fromArray(body.contactNormals, i * 3);
      arrow.visible = this.direction.lengthSq() > 0;
      if (arrow.visible) { arrow.position.copy(this.capsule.position); arrow.setDirection(this.direction); }
    }
    const bounds = this.bounds.geometry.attributes.position, cells = this.cells.geometry.attributes.position;
    let offset = 0;
    for (const block of this.terrain.blocks.values()) {
      if (block.stamp !== this.terrain.stamp || offset + 72 > bounds.array.length) continue;
      this.box(bounds.array, offset, block.minX, block.minY, block.minZ, block.maxX, block.maxY, block.maxZ);
      const x = block.x * this.terrain.blockSize, z = block.z * this.terrain.blockSize;
      offset = this.box(cells.array, offset, x, body.position.y, z, x + this.terrain.blockSize, body.position.y + .02, z + this.terrain.blockSize);
    }
    bounds.needsUpdate = cells.needsUpdate = true;
    this.bounds.geometry.setDrawRange(0, offset / 3); this.cells.geometry.setDrawRange(0, offset / 3);
    body.setBounds(8); Object.assign(this.debugBounds, body.bounds);
    this.rockOffset = 0; this.objectOffset = 0; this.colliderBoundsOffset = 0;
    body.world.query(this.debugBounds, this.drawTriangle);
    for (const collider of body.world.colliders) if (collider.index) collider.index.query(this.debugBounds, this.drawEntry);
    this.rockLines.geometry.attributes.position.needsUpdate = true; this.rockLines.geometry.setDrawRange(0,this.rockOffset/3);
    this.objectLines.geometry.attributes.position.needsUpdate = true; this.objectLines.geometry.setDrawRange(0,this.objectOffset/3);
    this.colliderBounds.geometry.attributes.position.needsUpdate = true; this.colliderBounds.geometry.setDrawRange(0,this.colliderBoundsOffset/3);
  }
  dispose() {
    this.root.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); }); this.root.removeFromParent();
  }
}
