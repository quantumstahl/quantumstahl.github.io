import { Box3, Vector3 } from "three";
import { resolveDestructible } from "../objects/DestructibleConfig.js";

const STEP = 1 / 60, MAX_STEPS = 6, CONTACT = .002, EPSILON = 1e-7;

// Intact crates only: fixed XZ/heading, swept vertical contact, no rigid bodies.
// Resting crates leave the active set. Support edges wake a whole tower when
// its foundation disappears; no polling of sleeping crates is needed.
export class BoxPhysics {
  constructor(data, objects, collider, surfaces, { terrain = null, onMove = null } = {}) {
    Object.assign(this, { data, objects, collider, surfaces, onMove });
    this.states = new Map(); this.active = new Set(); this.dependents = new Map(); this.moved = new Set();
    this.accumulator = 0; this.bounds = {}; this.removed = new Set();
    this.polygonA = new Float64Array(30); this.polygonB = new Float64Array(30);
    this.visitTriangle = this.testTriangle.bind(this);
    this.stats = { steps: 0, queries: 0, triangleTests: 0, active: 0, sleeping: 0 };
    for (const record of data.objects.values()) this.add(record);
    this.unsubscribe = data.onChanged(event => {
      // Authoring edits are rare. Reconsider supports, preserving other crates'
      // offsets and velocities. Ordinary gameplay motion emits no data events.
      if (event.kind === "object") {
        this.remove(event.id); this.removed.delete(event.id);
        this.objects.setRuntimeY(event.id, 0); this.collider.setRuntimeY(event.id, 0);
        if (event.after) this.add(event.after);
      } else if (event.kind === "asset") {
        for (const record of data.objects.values()) if (record.assetId === event.id && !this.removed.has(record.id)) {
          const offset = this.collider.runtimeY.get(record.id) ?? 0;
          this.remove(record.id); this.removed.delete(record.id); this.add(record);
          const state = this.states.get(record.id);
          if (state) state.offset = offset;
        }
      }
      this.wakeAll();
    });
    this.unsubscribeTerrain = terrain?.onTileChanged((_tile, channels) => { if (channels & 15) this.wakeAll(); });
  }
  add(record) {
    const asset = this.data.assets.get(record.assetId), c = asset?.collision;
    const config = resolveDestructible(asset, record);
    if (!config?.enabled || c?.mode !== "simple" || c.shape !== "box" || this.collider.excludeIds.has(record.id)) return;
    const matrix = this.collider.transform(record).clone(), e = matrix.elements;
    // Preserve authored placements, including intentionally tilted scenery.
    if (Math.abs(e[1]) + Math.abs(e[9]) + Math.abs(e[4]) + Math.abs(e[6]) > 1e-6 || e[5] <= 0) return;
    const local = new Box3(new Vector3(...c.offset), new Vector3(...c.offset));
    const half = new Vector3(...c.size).multiplyScalar(.5); local.min.sub(half); local.max.add(half);
    const box = local.clone().applyMatrix4(matrix);
    const state = { id: record.id, record, local, inverse: matrix.clone().invert(), bounds: {
      minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z,
    }, offset: this.collider.runtimeY.get(record.id) ?? 0, velocityY: 0, gravity: config.gravity,
    sleeping: false, supports: new Set() };
    this.states.set(state.id, state); this.active.add(state);
  }
  unlink(state) {
    for (const id of state.supports) {
      const above = this.dependents.get(id); above?.delete(state.id);
      if (!above?.size) this.dependents.delete(id);
    }
    state.supports.clear();
  }
  wake(id) {
    const pending = [id], seen = new Set();
    while (pending.length) {
      const next = pending.pop(); if (seen.has(next)) continue; seen.add(next);
      for (const above of this.dependents.get(next) ?? []) pending.push(above);
      const state = this.states.get(next); if (!state) continue;
      this.unlink(state); state.sleeping = false; this.active.add(state);
    }
  }
  wakeAll() { for (const state of this.states.values()) { this.unlink(state); state.sleeping = false; this.active.add(state); } }
  remove(id) {
    this.wake(id);
    const state = this.states.get(id);
    if (state) { this.unlink(state); this.active.delete(state); this.states.delete(id); }
    this.dependents.delete(id); this.removed.add(id); this.moved.delete(id);
  }
  move(state, offset) {
    const delta = offset - state.offset; if (!delta) return;
    state.offset = offset; state.bounds.minY += delta; state.bounds.maxY += delta;
    this.collider.setRuntimeY(state.id, offset); this.moved.add(state.id);
  }
  flush() {
    for (const id of this.moved) {
      this.objects.setRuntimeY(id, this.states.get(id).offset); this.onMove?.(id);
    }
    this.moved.clear();
    this.stats.active = this.active.size; this.stats.sleeping = this.states.size - this.active.size;
  }
  // Clip each candidate triangle to the actual yawed crate footprint. The
  // highest point of that polygon is exact for planar terrain, even if a peak
  // lies between the crate's corners. Scratch buffers avoid per-triangle GC.
  testTriangle(a, b, c, object) {
    const state = this.current; if (object?.id === state.id || this.removed.has(object?.id)) return;
    this.stats.triangleTests++;
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(area) < 1e-10) return; // Vertical faces cannot support a box.
    let src = this.polygonA, dst = this.polygonB, count = 3;
    const e = state.inverse.elements;
    let i = 0;
    for (let vertex = 0; vertex < 3; vertex++) {
      const p = vertex === 0 ? a : vertex === 1 ? b : c;
      src[i++] = e[0] * p.x + e[8] * p.z + e[12]; src[i++] = p.y;
      src[i++] = e[2] * p.x + e[10] * p.z + e[14];
    }
    const local = state.local;
    for (let plane = 0; plane < 4 && count; plane++) {
      const axis = plane < 2 ? 0 : 2, lower = plane % 2 === 0;
      const limit = plane === 0 ? local.min.x : plane === 1 ? local.max.x : plane === 2 ? local.min.z : local.max.z;
      let n = 0, previous = (count - 1) * 3;
      for (let vertex = 0; vertex < count; vertex++) {
        const current = vertex * 3, from = src[previous + axis], to = src[current + axis];
        const insideFrom = lower ? from >= limit : from <= limit, insideTo = lower ? to >= limit : to <= limit;
        if (insideFrom !== insideTo) {
          const t = (limit - from) / (to - from);
          for (let k = 0; k < 3; k++) dst[n * 3 + k] = src[previous + k] + (src[current + k] - src[previous + k]) * t;
          n++;
        }
        if (insideTo) { for (let k = 0; k < 3; k++) dst[n * 3 + k] = src[current + k]; n++; }
        previous = current;
      }
      count = n; const swap = src; src = dst; dst = swap;
    }
    if (!count) return;
    // An edge touching another crate's side is not a supporting area.
    let polygonArea = 0;
    for (let vertex = 0; vertex < count; vertex++) {
      const next = (vertex + 1) % count;
      polygonArea += src[vertex * 3] * src[next * 3 + 2] - src[next * 3] * src[vertex * 3 + 2];
    }
    if (Math.abs(polygonArea) < 1e-10) return;
    let height = -Infinity;
    for (let vertex = 0; vertex < count; vertex++) height = Math.max(height, src[vertex * 3 + 1]);
    if (height > state.bounds.minY + CONTACT || height < this.bounds.minY - EPSILON) return;
    if (height > this.height + EPSILON) { this.height = height; this.supports.clear(); }
    if (Math.abs(height - this.height) <= EPSILON) this.supports.add(object?.id ?? "maxworld:terrain");
  }
  stepState(state, dt) {
    const velocity = state.velocityY - state.gravity * dt, bottom = state.bounds.minY;
    const next = bottom + velocity * dt, b = this.bounds;
    b.minX = state.bounds.minX; b.maxX = state.bounds.maxX; b.minZ = state.bounds.minZ; b.maxZ = state.bounds.maxZ;
    b.minY = next - CONTACT; b.maxY = bottom + CONTACT;
    // Pause rather than fall through an asynchronously loading solid asset.
    if (!this.collider.prepare(b)) return;
    this.current = state; this.height = -Infinity; this.supports = this.foundSupports ??= new Set(); this.supports.clear();
    for (const surface of this.surfaces) { surface.query(b, this.visitTriangle); this.stats.queries++; }
    this.collider.query(b, this.visitTriangle); this.stats.queries++;
    this.unlink(state);
    if (this.height >= next - EPSILON) {
      this.move(state, state.offset + this.height - bottom); state.velocityY = 0;
      let stable = true;
      for (const id of this.supports) {
        state.supports.add(id);
        if (!this.dependents.has(id)) this.dependents.set(id, new Set());
        this.dependents.get(id).add(state.id);
        const below = this.states.get(id);
        if (below && !below.sleeping) { stable = false; state.velocityY = Math.min(state.velocityY, below.velocityY); }
      }
      if (stable) { state.sleeping = true; this.active.delete(state); }
    } else { state.velocityY = velocity; this.move(state, state.offset + next - bottom); }
  }
  update(delta) {
    this.stats.steps = this.stats.queries = this.stats.triangleTests = 0;
    if (!this.active.size) { this.accumulator = 0; this.stats.active = 0; this.stats.sleeping = this.states.size; return; }
    this.accumulator = Math.min(this.accumulator + (Number.isFinite(delta) ? Math.max(0, delta) : 0), STEP * MAX_STEPS);
    while (this.accumulator + 1e-12 >= STEP) {
      // Bottom first lets a whole falling tower settle in the same substep.
      const ordered = [...this.active].sort((a, b) => a.bounds.minY - b.bounds.minY || a.id.localeCompare(b.id));
      for (const state of ordered) if (this.active.has(state)) this.stepState(state, STEP);
      this.accumulator = Math.max(0, this.accumulator - STEP); this.stats.steps++;
    }
    this.flush();
  }
  // Explicit runtime saves, separate from editor/WorldFile authoring positions.
  snapshot() {
    return { version: 1, accumulator: this.accumulator, boxes: [...this.states.values()].map(state => ({ id: state.id,
      position: [state.record.position[0], state.record.position[1] + state.offset, state.record.position[2]],
      velocityY: state.velocityY, sleeping: state.sleeping })) };
  }
  restore(snapshot, validateOnly = false) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.boxes)) throw new Error("Invalid box physics save.");
    const accumulator = snapshot.accumulator ?? 0;
    if (!Number.isFinite(accumulator) || accumulator < 0 || accumulator >= STEP) throw new Error("Invalid saved box timestep.");
    const seen = new Set();
    for (const box of snapshot.boxes) {
      const record = this.data.objects.get(box.id);
      if (seen.has(box.id) || !record || !Array.isArray(box.position) || box.position.length !== 3 || !box.position.every(Number.isFinite)
        || box.position[0] !== record.position[0] || box.position[2] !== record.position[2]
        || !Number.isFinite(box.velocityY) || box.velocityY > 0 || typeof box.sleeping !== "boolean") throw new Error("Invalid saved box state.");
      seen.add(box.id);
    }
    if (validateOnly) return;
    this.reset();
    this.accumulator = accumulator;
    for (const box of snapshot.boxes) {
      const state = this.states.get(box.id); if (!state) continue;
      this.move(state, box.position[1] - state.record.position[1]); state.velocityY = box.velocityY;
    }
    // Never trust saved support links. Validate sleepers against loaded solids
    // once, bottom first; missing support becomes an active crate immediately.
    const sleepers = new Set(snapshot.boxes.filter(box => box.sleeping).map(box => box.id));
    for (const state of [...this.active].sort((a, b) => a.bounds.minY - b.bounds.minY)) if (sleepers.has(state.id)) this.stepState(state, 0);
    this.flush();
  }
  reset() {
    for (const id of new Set([...this.states.keys(), ...this.removed])) {
      this.objects.setRuntimeY(id, 0); this.collider.setRuntimeY(id, 0);
    }
    this.states.clear(); this.active.clear(); this.dependents.clear(); this.removed.clear(); this.moved.clear(); this.accumulator = 0;
    for (const record of this.data.objects.values()) this.add(record);
  }
  dispose() { this.unsubscribe(); this.unsubscribeTerrain?.(); this.reset(); this.states.clear(); this.active.clear(); }
}
