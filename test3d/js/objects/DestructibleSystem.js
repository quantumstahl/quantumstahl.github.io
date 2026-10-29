import * as THREE from "three";
import { normalizeDestructible } from "./DestructibleConfig.js";

const SETTLING = Object.freeze({ linearSpeed: .4, angularSpeed: .6, rotationRate: 9, heightRate: 14,
  angleTolerance: .01, heightTolerance: .005, clearance: .005 });

// Cache static mesh transforms and pivots once per destroyed asset. A pivot
// wrapper preserves the original geometry, material and full affine transform
// (including shear from rotated nodes under non-uniform placement scale).
export function prepareDebris(source) {
  const bounds = new THREE.Box3(), box = new THREE.Box3();
  const parts = source.meshes.filter(({ mesh }) => !mesh.userData.shadowProxy).map(({ mesh, matrix }) => {
    if (mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length || mesh.isInstancedMesh) throw new Error("Debris requires separate static mesh parts.");
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix); bounds.union(box);
    return { mesh, matrix, center: mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(matrix), half: mesh.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5) };
  });
  if (!parts.length) throw new Error("Destroyed GLB has no mesh parts.");
  return { parts, center: bounds.getCenter(new THREE.Vector3()), size: bounds.getSize(new THREE.Vector3()) };
}

export class DestructibleSystem {
  constructor(scene, data, assets, objects, melee, terrain, { collider = null, onDestroy = null, destructionSound = null,
    onError = assets.onError ?? (() => {}), random = Math.random, activationDistance = 24, maxDebrisPieces = 120, spawnBudget = 2 } = {}) {
    Object.assign(this, { scene, data, assets, objects, melee, terrain, collider, onDestroy, destructionSound, onError, random, activationDistance, maxDebrisPieces, spawnBudget });
    this.states = new Map(); this.active = new Map(); this.destroyed = new Set(); this.sources = new Map();
    this.debris = []; this.queue = []; this.generation = 0; this.disposed = false; this.syncAge = Infinity;
    this.root = new THREE.Group(); this.root.name = "Destructible debris"; scene.add(this.root);
    this.matrix = new THREE.Matrix4(); this.box = new THREE.Box3(); this.vector = new THREE.Vector3(); this.axis = new THREE.Vector3();
    this.rotation = new THREE.Quaternion(); this.warp = { x: 0, z: 0 };
    this.unsubscribe = data.onChanged(event => {
      this.syncAge = Infinity;
      if (event.kind === "object") {
        const state = this.states.get(event.id);
        if (state) { this.active.get(event.id)?.(); this.active.delete(event.id); this.states.delete(event.id); }
      }
    });
  }
  preload(id) {
    if (this.sources.has(id)) return this.sources.get(id);
    const lease = this.assets.acquire(id), entry = { lease, template: null, error: null, promise: null };
    entry.promise = lease.promise.then(source => {
      if (this.disposed) return;
      entry.template = prepareDebris(source);
      if (id === "box2.glb" && entry.template.parts.length !== 6) throw new Error("box2.glb must contain six separate mesh parts.");
    }).catch(error => { entry.error = error; entry.template = null; this.onError(`Destruction: ${error.message}`); });
    this.sources.set(id, entry); return entry;
  }
  createTarget(record, config) {
    const asset = this.data.assets.get(record.assetId);
    this.box.min.fromArray(asset?.bounds?.min ?? [-.5, 0, -.5]); this.box.max.fromArray(asset?.bounds?.max ?? [.5, 1, .5]);
    this.box.applyMatrix4(this.objects.recordMatrix(record, this.matrix));
    const state = { id: record.id, record, config, health: config.health, enabled: true,
      position: this.box.getCenter(new THREE.Vector3()), radius: this.box.getSize(new THREE.Vector3()).length() * .5,
      receiveHit: hit => this.receiveHit(record.id, hit) };
    this.states.set(record.id, state); return state;
  }
  syncTargets(focus) {
    const near = new Set();
    // Cull occupied authoring cells, then placements. Far objects never enter
    // the melee target loop. Health survives deactivation and render eviction.
    for (const [key, ids] of this.data.cells) {
      if (this.objects.cellBounds(key).distanceToPoint(focus) > this.activationDistance) continue;
      for (const id of ids) {
        if (this.destroyed.has(id) || this.objects.excludeIds.has(id)) continue;
        const record = this.data.objects.get(id), config = normalizeDestructible(record.properties.destructible);
        if (!config?.enabled) continue;
        const state = this.states.get(id) ?? this.createTarget(record, config);
        if (state.position.distanceTo(focus) > this.activationDistance + state.radius) continue;
        near.add(id);
        if (!this.active.has(id)) this.active.set(id, this.melee.register(state));
        this.preload(config.destroyedAsset);
      }
    }
    for (const [id, unregister] of this.active) if (!near.has(id)) { unregister(); this.active.delete(id); }
  }
  receiveHit(id, hit) {
    const state = this.states.get(id);
    if (!state?.enabled || this.destroyed.has(id) || !Number.isFinite(hit.damage) || hit.damage <= 0) return false;
    state.health = Math.max(0, state.health - hit.damage);
    if (state.health > 0) return true;
    state.enabled = false; this.destroyed.add(id);
    // No authoring mutation: invalidate pending builds and remove ALL visual
    // LODs / batch slots and the physics entry synchronously with the hit.
    this.objects.setExcluded(id, true); this.collider?.setExcluded(id, true);
    this.active.get(id)?.(); this.active.delete(id);
    const direction = new THREE.Vector3(hit.direction?.x ?? 0, 0, hit.direction?.z ?? 0);
    if (direction.lengthSq() > 0) direction.normalize();
    this.queue.push({ id, config: state.config, matrix: this.objects.recordMatrix(state.record, new THREE.Matrix4()),
      direction, source: this.preload(state.config.destroyedAsset), generation: this.generation });
    this.onDestroy?.(hit, state); this.destructionSound?.(hit, state);
    return true;
  }
  spawn(request) {
    const { template } = request.source, { config, matrix, direction } = request;
    if (!template || request.generation !== this.generation) return;
    if (template.parts.length > this.maxDebrisPieces) { this.onError("Destroyed asset exceeds the debris piece budget."); return; }
    while (this.debris.length && this.pieceCount + template.parts.length > this.maxDebrisPieces) this.removeDebris(0);
    const group = { id: request.id, age: 0, config, pieces: [] };
    for (const part of template.parts) {
      const pivot = new THREE.Group(), mesh = new THREE.Mesh(part.mesh.geometry, part.mesh.material);
      pivot.name = part.mesh.name; pivot.position.copy(part.center).applyMatrix4(matrix);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeTranslation(-pivot.position.x, -pivot.position.y, -pivot.position.z).multiply(matrix).multiply(part.matrix);
      mesh.castShadow = false; mesh.receiveShadow = part.mesh.receiveShadow; mesh.layers.mask = part.mesh.layers.mask;
      pivot.add(mesh); this.root.add(pivot);
      const radial = this.vector.copy(part.center).sub(template.center);
      // Classify top/bottom relative to the assembled asset, before placement.
      const vertical = Math.abs(radial.y) / Math.max(template.size.y, .001) > Math.max(Math.abs(radial.x) / Math.max(template.size.x, .001), Math.abs(radial.z) / Math.max(template.size.z, .001));
      const bottom = vertical && radial.y < 0, top = vertical && !bottom;
      radial.y = 0; radial.transformDirection(matrix); radial.y = 0;
      if (radial.lengthSq() > .0001) radial.normalize();
      else radial.set(Math.cos(group.pieces.length * 2.4), 0, Math.sin(group.pieces.length * 2.4));
      const strength = config.impulseStrength, spread = config.outwardImpulse * strength * (.85 + this.random() * .3) * (bottom ? .2 : top ? .35 : 1);
      const velocity = radial.clone().multiplyScalar(spread).addScaledVector(direction, config.outwardImpulse * strength * .25);
      velocity.y = config.upwardImpulse * strength * (bottom ? .15 : top ? 1.25 : .8 + this.random() * .2);
      const angular = new THREE.Vector3(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1).normalize().multiplyScalar(config.angularVelocity * (.65 + this.random() * .35));
      // Three affine half-axes give the vertical support extent for any spin,
      // without vertices, raycasts, or a per-frame bounding-box allocation.
      const e = mesh.matrix.elements, h = part.half;
      const axes = [new THREE.Vector3(e[0], e[1], e[2]).multiplyScalar(h.x), new THREE.Vector3(e[4], e[5], e[6]).multiplyScalar(h.y), new THREE.Vector3(e[8], e[9], e[10]).multiplyScalar(h.z)];
      let thinAxis = 0;
      for (let i = 1; i < 3; i++) if (axes[i].lengthSq() < axes[thinAxis].lengthSq()) thinAxis = i;
      // The broad face normal is perpendicular to the other two half-axes.
      // Unlike transforming a normal as a direction, this also handles shear.
      const faceNormal = new THREE.Vector3().crossVectors(axes[(thinAxis + 1) % 3], axes[(thinAxis + 2) % 3]).normalize();
      group.pieces.push({ pivot, mesh, velocity, angular, axes, faceNormal,
        groundNormal: new THREE.Vector3(), restQuaternion: new THREE.Quaternion(), groundHeight: 0,
        settling: false, sleeping: false, contacts: 0 });
    }
    this.debris.push(group);
  }
  get pieceCount() { let count = 0; for (const group of this.debris) count += group.pieces.length; return count; }
  terrainHeight(x, z) {
    // Same canonical height/warp queries as sampleSurfaceHeight, with scratch
    // storage reused across panels. Independent of visual terrain LOD.
    if (!this.terrain.sampleWarp) return this.terrain.sampleHeight(x, z);
    let sx = x, sz = z;
    for (let i = 0; i < 3; i++) { this.terrain.sampleWarp(sx, sz, this.warp); sx = x - this.warp.x; sz = z - this.warp.z; }
    return this.terrain.sampleHeight(sx, sz);
  }
  supportHeight(piece, normal = null) {
    let extent = 0;
    for (const axis of piece.axes) {
      this.vector.copy(axis).applyQuaternion(piece.pivot.quaternion);
      extent += Math.abs(normal ? this.vector.dot(normal) : this.vector.y);
    }
    // Plane support, expressed as a vertical offset, prevents a panel aligned
    // with a slope from hovering at its former vertical bounding-box height.
    return normal ? extent / normal.y : extent;
  }
  beginSettling(piece, height) {
    const { pivot, groundNormal } = piece, x = pivot.position.x, z = pivot.position.z;
    const probe = .25;
    groundNormal.set(this.terrainHeight(x - probe, z) - this.terrainHeight(x + probe, z), 2 * probe,
      this.terrainHeight(x, z - probe) - this.terrainHeight(x, z + probe)).normalize();
    if (!Number.isFinite(groundNormal.y) || groundNormal.y < .25) groundNormal.set(0, 1, 0);
    this.vector.copy(piece.faceNormal).applyQuaternion(pivot.quaternion);
    if (this.vector.dot(groundNormal) < 0) this.vector.negate(); // Keep the nearest face up, preserving the existing heading.
    this.rotation.setFromUnitVectors(this.vector, groundNormal);
    piece.restQuaternion.copy(pivot.quaternion).premultiply(this.rotation);
    piece.groundHeight = height; piece.settling = true;
    piece.velocity.set(0, 0, 0); piece.angular.set(0, 0, 0);
  }
  settlePiece(piece, dt) {
    const { pivot } = piece;
    pivot.quaternion.slerp(piece.restQuaternion, 1 - Math.exp(-SETTLING.rotationRate * dt));
    const ground = piece.groundHeight + this.supportHeight(piece, piece.groundNormal) + SETTLING.clearance;
    pivot.position.y += (ground - pivot.position.y) * (1 - Math.exp(-SETTLING.heightRate * dt));
    pivot.position.y = Math.max(ground, pivot.position.y);
    if (pivot.quaternion.angleTo(piece.restQuaternion) < SETTLING.angleTolerance && Math.abs(pivot.position.y - ground) < SETTLING.heightTolerance) {
      pivot.quaternion.copy(piece.restQuaternion);
      pivot.position.y = piece.groundHeight + this.supportHeight(piece, piece.groundNormal) + SETTLING.clearance;
      piece.sleeping = true; piece.settling = false;
    }
  }
  stepPiece(piece, config, dt) {
    if (piece.sleeping) return;
    if (piece.settling) { this.settlePiece(piece, dt); return; }
    const { pivot, velocity, angular } = piece, damping = Math.exp(-config.damping * dt);
    velocity.y -= config.gravity * dt; pivot.position.addScaledVector(velocity, dt); velocity.multiplyScalar(damping);
    const speed = angular.length();
    if (speed > .0001) { this.axis.copy(angular).multiplyScalar(1 / speed); this.rotation.setFromAxisAngle(this.axis, speed * dt); pivot.quaternion.premultiply(this.rotation); }
    angular.multiplyScalar(damping);
    const height = this.terrainHeight(pivot.position.x, pivot.position.z);
    const ground = height + this.supportHeight(piece) + SETTLING.clearance;
    if (Number.isFinite(ground) && pivot.position.y <= ground) {
      pivot.position.y = ground; piece.contacts++;
      if (velocity.y < 0) velocity.y = -velocity.y * config.bounce;
      const friction = Math.exp(-8 * dt); velocity.x *= friction; velocity.z *= friction; angular.multiplyScalar(friction);
      if (velocity.y < .25) velocity.y = 0;
      if (velocity.lengthSq() < SETTLING.linearSpeed ** 2 && angular.lengthSq() < SETTLING.angularSpeed ** 2) this.beginSettling(piece, height);
    }
  }
  update(delta, focus = null) {
    if (this.disposed) return;
    const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    this.syncAge += elapsed;
    if (focus && this.syncAge >= .15) { this.syncAge = 0; this.syncTargets(focus); }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const group = this.debris[i]; group.age += elapsed;
      if (group.age >= group.config.debrisLifetime) { this.removeDebris(i); continue; }
      // At most six fixed-size substeps after a stall; lifetime uses real time.
      const time = Math.min(elapsed, .1), steps = Math.ceil(time * 60), dt = steps ? time / steps : 0;
      for (let step = 0; step < steps; step++) for (const piece of group.pieces) this.stepPiece(piece, group.config, dt);
    }
    let budget = this.spawnBudget;
    for (let i = 0; i < this.queue.length && budget > 0;) {
      const request = this.queue[i];
      if (request.source.error || request.generation !== this.generation) { this.queue.splice(i, 1); continue; }
      if (!request.source.template) { i++; continue; }
      this.queue.splice(i, 1); this.spawn(request); budget--;
    }
  }
  removeDebris(index) {
    const group = this.debris[index];
    for (const piece of group.pieces) { piece.pivot.removeFromParent(); piece.pivot.clear(); }
    this.debris.splice(index, 1); // Shared GPU resources belong to cached leases.
  }
  resetSession() {
    this.generation++; this.queue.length = 0;
    while (this.debris.length) this.removeDebris(this.debris.length - 1);
    for (const unregister of this.active.values()) unregister();
    this.active.clear(); this.states.clear();
    for (const id of this.destroyed) { this.objects.setExcluded(id, false); this.collider?.setExcluded(id, false); }
    this.destroyed.clear(); this.syncAge = Infinity;
  }
  dispose() {
    this.resetSession(); this.disposed = true; this.unsubscribe();
    for (const entry of this.sources.values()) entry.lease.release();
    this.sources.clear(); this.root.removeFromParent();
  }
}
