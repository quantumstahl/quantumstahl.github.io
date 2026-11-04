import { Box3, Group, Vector3 } from "three";
import { GhostCollision } from "../physics/GhostCollision.js";
import { PickupLanding } from "../physics/PickupLanding.js";
import { createHeartAsset } from "./HeartAsset.js";

export const PICKUP_COIN_ASSET = "maxworld:pickup-coin";
const TYPES = new Set(["coin", "heart"]), RADIUS = .32;
const matchesAsset = (asset, name) => [asset?.name, asset?.id].some(value => typeof value === "string" && new RegExp(`(?:^|[/\\\\])${name}(?:\\.glb)?$`, "i").test(value));
export const isDropBox = asset => matchesAsset(asset, "box");
export function rollBoxDrop(random = Math.random) {
  const roll = random();
  return roll < .5 ? null : roll < .85 ? "coin" : "heart";
}

// Authored placements and box rewards have distinct IDs and lifecycles. Neither
// collection nor random drops modify ObjectData or a saved editor world file.
export class PickupSystem {
  constructor(scene, { assets, data = null, objects = null, collider = null, surfaces = [], body = null,
    audio = null, terrain = null, random = Math.random, onChange = () => {}, onHeal = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { assets, data, objects, collider, body, audio, random, onChange, onHeal, onError });
    this.root = new Group(); this.root.name = "Ghost pickups"; scene.add(this.root);
    this.ghosts = new GhostCollision(); this.landing = new PickupLanding(surfaces, collider);
    this.pickups = new Map(); this.collected = new Set(); this.boxDrops = new Map(); this.authored = new Map();
    this.encounterRewards = new Map();
    this.falling = new Set(); this.supports = new Map(); this.visible = new Set(); this.visibleNext = new Set();
    this.coinCount = 0; this.heartsCollected = 0; this.time = 0; this.bounds = {}; this.disposed = false;
    this.heart = createHeartAsset(); this.coinTemplate = null;
    this.collectOverlap = pickup => this.collect(pickup.id);
    this.show = entry => {
      const pickup = entry.object;
      if (!pickup.visual) {
        const template = pickup.type === "heart" ? this.heart.mesh : this.coinTemplate;
        if (template) { pickup.visual = template.clone(true); this.root.add(pickup.visual); }
      }
      if (!pickup.visual) return;
      this.visibleNext.add(pickup); pickup.visual.visible = true;
      pickup.visual.position.copy(pickup.position); pickup.visual.position.y += Math.sin(this.time * 2.4 + pickup.phase) * .07;
      pickup.visual.rotation.y = this.time * .9 + pickup.phase;
    };
    if (assets) {
      this.coinLease = assets.acquire(PICKUP_COIN_ASSET);
      this.coinReady = this.coinLease.promise.then(source => {
        if (this.disposed) return;
        const model = assets.clone(source), box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
        const scale = .48 / Math.max(size.x, size.y, size.z, 1e-6);
        const wrapper = new Group(); wrapper.scale.setScalar(scale);
        model.position.sub(box.getCenter(new Vector3())); wrapper.add(model); this.coinTemplate = wrapper;
        model.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = false; } });
      }).catch(error => { if (!this.disposed) this.onError(`Pickups: ${error.message}`); });
    }
    if (data) {
      for (const record of data.objects.values()) {
        const asset = data.assets.get(record.assetId), config = record.properties.pickup;
        const type = config === false ? null : config?.type ?? (matchesAsset(asset, "coin") ? "coin" : matchesAsset(asset, "heart") ? "heart" : null);
        if (!TYPES.has(type)) continue;
        this.authored.set(`authored:${record.id}`, { id: `authored:${record.id}`, type, position: [...record.position], source: "authored", objectId: record.id });
        // The visual is owned here so an authored coin cannot remain a solid
        // collider or reappear when ObjectSystem streams its cell back in.
        objects?.setExcluded(record.id, true); collider?.setExcluded(record.id, true);
      }
    }
    this.resetSession();
    this.unsubscribeTerrain = terrain?.onTileChanged((_tile, channels) => { if (channels & 15) this.wakeAll(); });
  }
  add(spec) {
    if (!TYPES.has(spec.type) || typeof spec.id !== "string" || !spec.id || !Array.isArray(spec.position)
      || spec.position.length !== 3 || !spec.position.every(Number.isFinite)) throw new Error("Invalid pickup.");
    if (this.collected.has(spec.id) || this.pickups.has(spec.id)) return null;
    const pickup = { ...spec, position: new Vector3(...spec.position), velocityY: spec.velocityY ?? 0,
      phase: this.pickups.size * 2.39996, visual: null, landing: null, retryAt: 0 };
    this.pickups.set(pickup.id, pickup); this.ghosts.set(pickup.id, pickup.position, RADIUS, pickup);
    if (pickup.source === "box") this.falling.add(pickup);
    return pickup;
  }
  onBoxDestroyed(target) {
    this.wakeSupport(target.id);
    if (!isDropBox(this.data?.assets.get(target.record.assetId)) || this.boxDrops.has(target.id)) return null;
    // Exactly one runtime roll, synchronously at destruction, even if the
    // coin GLB/debris is still loading. Persist the no-drop result as well.
    const type = rollBoxDrop(this.random); this.boxDrops.set(target.id, type);
    return type ? this.add({ id: `box:${target.id}`, type, position: target.position.toArray(), source: "box", boxId: target.id }) : null;
  }
  registerEncounterReward(arenaId, reward) {
    const id = `arena:${arenaId}:reward`;
    this.encounterRewards.set(id, { id, type: reward.type, position: [...reward.position], source: 'encounter' });
  }
  spawnEncounterReward(arenaId) {
    const spec = this.encounterRewards.get(`arena:${arenaId}:reward`);
    return spec ? this.add(spec) : null;
  }
  collect(id) {
    const pickup = this.pickups.get(id);
    if (!pickup || this.collected.has(id)) return false;
    // Consume before sound/hooks: callbacks, repeated physics steps and late
    // model loads cannot grant a second reward.
    this.collected.add(id); this.remove(pickup);
    if (pickup.type === "coin") this.coinCount++; else this.heartsCollected++;
    this.audio?.play(pickup.type === "coin" ? "coin" : "pickup");
    if (pickup.type === "heart") this.onHeal(1, pickup);
    this.onChange(this); return true;
  }
  checkOverlaps(body = this.body) { if (body) this.ghosts.query(body, this.collectOverlap); }
  unlink(pickup) {
    const set = this.supports.get(pickup.landing?.supportId); set?.delete(pickup);
    if (set && !set.size) this.supports.delete(pickup.landing.supportId);
  }
  wakeSupport(id) {
    const set = this.supports.get(id); if (!set) return;
    for (const pickup of set) { pickup.landing = null; pickup.retryAt = 0; this.falling.add(pickup); }
    this.supports.delete(id);
  }
  wakeAll() { for (const id of [...this.supports.keys()]) this.wakeSupport(id); }
  remove(pickup) {
    this.unlink(pickup); this.ghosts.delete(pickup.id); this.pickups.delete(pickup.id); this.falling.delete(pickup);
    this.visible.delete(pickup); this.visibleNext.delete(pickup); pickup.visual?.removeFromParent();
  }
  update(delta, focus = this.body?.position) {
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0; this.time += dt;
    for (const pickup of this.falling) {
      if (!pickup.landing) {
        if (this.time < pickup.retryAt) continue;
        pickup.landing = this.landing.find(pickup.position, this.body?.position);
        if (!pickup.landing) { pickup.retryAt = this.time + .25; continue; }
        const supportId = pickup.landing.supportId;
        if (!this.supports.has(supportId)) this.supports.set(supportId, new Set());
        this.supports.get(supportId).add(pickup);
        pickup.position.x = pickup.landing.position[0]; pickup.position.z = pickup.landing.position[2];
      }
      pickup.velocityY -= 12 * dt;
      pickup.position.y = Math.max(pickup.landing.position[1], pickup.position.y + pickup.velocityY * dt);
      if (pickup.position.y === pickup.landing.position[1]) { pickup.velocityY = 0; this.falling.delete(pickup); }
      this.ghosts.set(pickup.id, pickup.position, RADIUS, pickup);
    }
    if (!focus) return;
    // Animation and lazy visual creation are local to the player. The sphere
    // includes the small visual bob, so no spatial reinsertion for animation.
    const b = this.bounds, distance = 60;
    b.minX = focus.x - distance; b.maxX = focus.x + distance; b.minZ = focus.z - distance; b.maxZ = focus.z + distance;
    b.minY = focus.y - distance; b.maxY = focus.y + distance;
    this.visibleNext.clear(); this.ghosts.index.query(b, this.show);
    for (const pickup of this.visible) if (!this.visibleNext.has(pickup)) pickup.visual.visible = false;
    const previous = this.visible; this.visible = this.visibleNext; this.visibleNext = previous;
  }
  snapshot() {
    return { version: 1, coinCount: this.coinCount, heartsCollected: this.heartsCollected, collectedIds: [...this.collected],
      boxDrops: [...this.boxDrops].map(([boxId, type]) => ({ boxId, type })),
      pickups: [...this.pickups.values()].map(p => ({ id: p.id, type: p.type, source: p.source, ...(p.boxId ? { boxId: p.boxId } : {}),
        position: p.position.toArray(), velocityY: p.velocityY })) };
  }
  restore(snapshot, validateOnly = false) {
    // Validate everything before replacing a live session. Supports and meshes
    // are derived again; saved random outcomes are never rerolled.
    const validId = id => typeof id === "string" && id.length > 0;
    if (snapshot?.version !== 1 || ![snapshot.coinCount, snapshot.heartsCollected].every(n => Number.isSafeInteger(n) && n >= 0)
      || !Array.isArray(snapshot.collectedIds) || !snapshot.collectedIds.every(validId) || new Set(snapshot.collectedIds).size !== snapshot.collectedIds.length
      || !Array.isArray(snapshot.boxDrops) || !Array.isArray(snapshot.pickups)) throw new Error("Invalid pickup save.");
    const rolls = new Map(), ids = new Set(snapshot.collectedIds);
    for (const drop of snapshot.boxDrops) {
      if (!validId(drop.boxId) || rolls.has(drop.boxId) || (drop.type !== null && !TYPES.has(drop.type))) throw new Error("Invalid saved box drop.");
      rolls.set(drop.boxId, drop.type);
    }
    for (const p of snapshot.pickups) {
      if (!validId(p.id) || ids.has(p.id) || !TYPES.has(p.type) || !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(Number.isFinite)
        || !Number.isFinite(p.velocityY) || p.velocityY > 0
        || (p.source === "box" ? p.id !== `box:${p.boxId}` || rolls.get(p.boxId) !== p.type
          : p.source === 'encounter' ? this.encounterRewards.get(p.id)?.type !== p.type
          : p.source !== "authored" || this.authored.get(p.id)?.type !== p.type)) throw new Error("Invalid saved pickup.");
      ids.add(p.id);
    }
    // Every authored pickup and rolled reward must be either alive or consumed.
    for (const id of snapshot.collectedIds) if (!this.authored.has(id) && !this.encounterRewards.has(id) && ![...rolls].some(([boxId, type]) => type && id === `box:${boxId}`)) throw new Error("Unknown collected pickup ID.");
    for (const id of this.authored.keys()) if (!ids.has(id)) throw new Error("Missing authored pickup state.");
    for (const [id, type] of rolls) if (type && !ids.has(`box:${id}`)) throw new Error("Missing box pickup state.");
    if (validateOnly) return;
    this.clear(); this.collected = new Set(snapshot.collectedIds); this.boxDrops = rolls;
    this.coinCount = snapshot.coinCount; this.heartsCollected = snapshot.heartsCollected;
    for (const p of snapshot.pickups) this.add(p);
    this.onChange(this);
  }
  clear() { for (const pickup of this.pickups.values()) this.remove(pickup); this.ghosts.clear(); this.time = 0; }
  resetSession() {
    this.clear(); this.collected.clear(); this.boxDrops.clear(); this.coinCount = this.heartsCollected = 0;
    for (const spec of this.authored.values()) this.add(spec);
    this.onChange(this);
  }
  dispose() {
    this.disposed = true; this.unsubscribeTerrain?.(); this.clear(); this.coinLease?.release(); this.heart.dispose(); this.root.removeFromParent();
    for (const spec of this.authored.values()) { this.objects?.setExcluded(spec.objectId, false); this.collider?.setExcluded(spec.objectId, false); }
  }
}
