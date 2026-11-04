import * as THREE from 'three';
import { CharacterBody } from '../physics/CharacterBody.js';
import { releaseObject } from '../objects/ObjectSystem.js';
import { spiderConfig } from './SpiderConfig.js';

const WHITE = new THREE.Color(0xffffff);

// One independent state machine per spider. Reuse the ground/wall solver, but
// do not add enemy bodies to the player's list (or block the cat on enemy loads).
export class SpiderEnemy {
  constructor(scene, physics, melee, record, config = {}) {
    this.record = record; this.config = spiderConfig(config); this.scene = scene;
    const c = this.config;
    this.isBoss = c.type === 'spiderbig'; this.attackKind = 'bite';
    this.lungeDirection = new THREE.Vector3(); this.lungeCooldown = c.lungeInterval ?? 0;
    this.stompCooldown = 0; this.stompArmed = true; this.lungeHit = false;
    this.body = new CharacterBody(physics, { id: record.id, type: 'spider' }, {
      radius: c.radius, height: Math.max(c.height, c.radius * 2), walkSpeed: c.moveSpeed,
      runSpeed: c.moveSpeed, stepHeight: .15, groundSnap: .15,
    });
    this.body.teleport(...record.position, record.rotation?.[1] ?? 0);
    this.home = this.body.position.clone(); this.position = new THREE.Vector3(); this.radius = c.radius;
    this.root = new THREE.Group(); this.root.name = `Spider ${record.id}`;
    this.visual = new THREE.Group(); this.root.add(this.visual); scene.add(this.root);
    this.materials = []; this.knockDirection = new THREE.Vector3();
    this.state = 'idle'; this.stateTime = 0; this.health = c.maxHealth; this.enabled = true;
    this.cooldown = 0; this.stunRemaining = 0; this.flash = 0; this.age = 0; this.returning = false;
    this.unregister = melee.register(this); this.syncPosition();
  }

  setModel(model, animations = []) {
    this.model = model;
    model.scale.multiply(new THREE.Vector3().fromArray(this.record.scale ?? [1, 1, 1]));
    model.rotation.y += this.config.modelYaw;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true), center = bounds.getCenter(new THREE.Vector3());
    if (!bounds.isEmpty()) {
      if (this.isBoss) {
        // Measure once in the bind pose, after placement scale. Explicit editor
        // overrides win; normal spiders keep their existing tuned dimensions.
        const size = bounds.getSize(new THREE.Vector3()), overrides = this.record.properties?.enemy ?? {};
        if (overrides.radius == null) this.config.radius = Math.max(.1, Math.max(size.x, size.z) * .35);
        if (overrides.height == null) this.config.height = Math.max(.1, size.y);
        if (overrides.attackRange == null) this.config.attackRange = this.config.radius + .95;
        this.radius = this.config.radius;
        this.body.config.radius = this.radius;
        this.body.config.height = Math.max(this.config.height, this.radius * 2);
        this.body.halfSegment = (this.body.config.height - this.radius * 2) / 2;
      }
      model.position.x -= center.x; model.position.y -= bounds.min.y; model.position.z -= center.z;
      // Preserve authored GLB placement in idle, with a foot-centered runtime pivot.
      center.y = bounds.min.y;
      center.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.body.yaw);
      this.home.add(center); this.body.teleport(...this.home.toArray(), this.body.yaw);
    }
    const materials = new Map();
    model.traverse(node => {
      if (!node.isMesh) return;
      const own = material => {
        if (!materials.has(material)) {
          const clone = material.clone(); materials.set(material, clone);
          this.materials.push({ material: clone, color: clone.color?.clone(), emissive: clone.emissive?.clone(), intensity: clone.emissiveIntensity });
        }
        return materials.get(material);
      };
      node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
    });
    this.visual.add(model);
    if (animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      this.action = this.mixer.clipAction(animations.find(clip => /walk|move/i.test(clip.name)) ?? animations[0]);
      this.action.play();
    }
    this.syncPosition();
  }

  enter(state) { this.state = state; this.stateTime = 0; }
  syncPosition() {
    this.root.position.copy(this.body.position); this.root.rotation.y = this.body.yaw;
    this.position.copy(this.body.position); this.position.y += this.config.height * .5;
  }
  face(point) { this.body.setYaw(Math.atan2(-(point.x - this.body.position.x), -(point.z - this.body.position.z))); }
  distance(point) { return Math.hypot(point.x - this.body.position.x, point.z - this.body.position.z); }

  receiveHit({ damage, direction }) {
    if (!this.enabled || !Number.isFinite(damage) || damage <= 0) return false;
    this.health = Math.max(0, this.health - damage * (this.stunRemaining > 0 ? this.config.stunnedDamageMultiplier : 1));
    this.flash = .12; this.knockDirection.copy(direction ?? this.knockDirection).setY(0).normalize();
    if (this.health === 0) {
      this.enabled = false; this.stunRemaining = 0; this.enter('dead'); this.unregister();
      this.body.setMovement(0, 0); this.body.velocity.set(0, 0, 0);
      this.onDeath?.(this);
    } else this.enter('hurt');
    return true;
  }

  // Test the falling foot segment against the spider top on EVERY fixed step,
  // before any bite. A side touch or an ascending jump cannot stun it.
  tryStomp(player) {
    if (!this.enabled) return false;
    if (this.isBoss && (!this.stompArmed || this.stompCooldown > 0)) return false;
    const body = player.body, previous = body.previousPosition, current = body.position;
    const top = this.body.position.y + this.config.height;
    if (current.y >= previous.y - 1e-6 || previous.y < top - .03 || current.y > top) return false;
    const t = THREE.MathUtils.clamp((previous.y - top) / (previous.y - current.y), 0, 1);
    const x = THREE.MathUtils.lerp(previous.x, current.x, t), z = THREE.MathUtils.lerp(previous.z, current.z, t);
    const r = this.config.radius + body.config.radius * .7;
    if (Math.hypot(x - this.body.position.x, z - this.body.position.z) > r) return false;
    this.stunRemaining = this.config.stunDuration; this.enter('stunned');
    if (this.isBoss) { this.stompArmed = false; this.stompCooldown = this.config.stompCooldown; }
    this.body.setMovement(0, 0); this.body.velocity.set(0, 0, 0);
    // A small bounce prevents repeat contact damage and leaves the cat mobile.
    body.position.y = Math.max(body.position.y, top + .02);
    body.velocity.y = this.config.stompBounce; body.grounded = false;
    body.updateCapsule();
    return true;
  }

  step(delta, player) {
    if (!this.enabled) return;
    const c = this.config, body = this.body, target = player.body.position;
    this.stateTime += delta; this.cooldown = Math.max(0, this.cooldown - delta);
    this.stunRemaining = Math.max(0, this.stunRemaining - delta);
    if (this.isBoss) {
      this.lungeCooldown = Math.max(0, this.lungeCooldown - delta);
      this.stompCooldown = Math.max(0, this.stompCooldown - delta);
      if (this.distance(target) > c.radius + player.body.config.radius + .2) this.stompArmed = true;
    }
    if (this.tryStomp(player)) { this.syncPosition(); return; }
    const distance = this.distance(target), homeDistance = this.distance(this.home);
    const vertical = target.y < body.position.y + c.height && target.y + player.body.config.height > body.position.y;
    if (this.state === 'stunned') {
      if (this.stunRemaining === 0) this.enter('idle');
      else return;
    }
    body.setMovement(0, 0);
    if (this.state === 'hurt') {
      if (this.stateTime < c.hurtDuration) {
        // Use normal collision resolution for knockback too, never teleport through walls.
        body.config.walkSpeed = c.hitKnockback / c.hurtDuration;
        body.setMovement(this.knockDirection.x, this.knockDirection.z);
      } else { this.enter(this.stunRemaining > 0 ? 'stunned' : 'idle'); body.velocity.set(0, 0, 0); }
    } else {
      body.config.walkSpeed = c.moveSpeed;
      if (!this.returning && (distance > c.leashRadius || homeDistance > c.leashRadius)) {
        this.returning = homeDistance > .1; this.enter('idle');
      }
      if (this.returning) {
        if (homeDistance <= .1) { this.returning = false; this.enter('idle'); }
        else { this.face(this.home); body.setMovement((this.home.x - body.position.x) / homeDistance, (this.home.z - body.position.z) / homeDistance); }
      } else if (this.state === 'idle' && distance <= c.detectionRadius && Math.abs(target.y - body.position.y) < 2) {
        this.face(target); this.enter('detect');
      } else if (this.state === 'detect') {
        this.face(target); if (this.stateTime >= c.detectDuration) this.enter('chase');
      } else if (this.state === 'chase') {
        this.face(target);
        if (this.isBoss && this.cooldown === 0 && this.lungeCooldown === 0 && distance > c.attackRange && distance <= c.lungeRange) {
          this.lungeDirection.set(target.x - body.position.x, 0, target.z - body.position.z).normalize();
          this.attackKind = 'lunge'; this.lungeHit = false; this.enter('attack');
        } else if (distance <= c.attackRange && vertical) { if (this.cooldown === 0) { this.attackKind = 'bite'; this.enter('attack'); } }
        else if (distance > .01) body.setMovement((target.x - body.position.x) / distance, (target.z - body.position.z) / distance);
      } else if (this.state === 'attack') {
        if (this.attackKind === 'lunge') {
          if (this.stateTime >= c.lungeWindup) { this.lungeCooldown = c.lungeInterval; this.enter('lunge'); }
        } else {
          this.face(target);
          if (this.stateTime >= c.attackWindup) {
            if (distance <= c.attackRange && vertical) player.takeDamage(c.attackDamage, { combat: true });
            this.cooldown = c.attackCooldown; this.enter('chase');
          }
        }
      } else if (this.state === 'lunge') {
        if (this.stateTime >= c.lungeDuration) { this.cooldown = c.attackCooldown; this.enter('recover'); }
        else { body.config.walkSpeed = c.lungeSpeed; body.setMovement(this.lungeDirection.x, this.lungeDirection.z); }
      } else if (this.state === 'recover' && this.stateTime >= c.lungeRecovery) {
        this.enter('chase');
      }
    }
    // Prepare only this enemy's local solids. A distant asset never stalls the cat.
    body.setBounds(Math.max(c.moveSpeed, this.state === 'lunge' ? c.lungeSpeed : 0) * delta + c.hitKnockback + .4);
    for (const collider of body.world.colliders) if (collider.prepare && !collider.prepare(body.bounds)) return;
    body.escape.searchPrepared = body.escape.pending;
    if (this.state !== 'stunned') body.step(delta);
    if (this.state === 'lunge' && !this.lungeHit && this.distance(target) <= c.radius + player.body.config.radius
      && target.y < body.position.y + c.height * .55 && target.y + player.body.config.height > body.position.y) {
      this.lungeHit = true; player.takeDamage(c.attackDamage, { combat: true });
    }
    this.syncPosition();
  }

  updateVisual(delta) {
    this.age += delta; this.flash = Math.max(0, this.flash - delta);
    if (this.state === 'dead') { this.stateTime += delta; this.root.visible = this.stateTime < this.config.deathDuration; }
    if (!this.root.visible) return;
    const stunned = this.stunRemaining > 0, dead = this.state === 'dead';
    this.visual.rotation.z = dead ? Math.PI * .55 : stunned ? 1.1 + Math.sin(this.age * 14) * .08 : 0;
    const windup = this.attackKind === 'lunge' ? this.config.lungeWindup : this.config.attackWindup;
    this.visual.rotation.x = this.state === 'attack' ? -.25 * Math.sin(Math.PI * Math.min(1, this.stateTime / Math.max(.01, windup))) : 0;
    this.visual.position.y = stunned ? .08 : this.state === 'detect' ? .035 : 0;
    this.visual.scale.y = dead ? Math.max(.25, 1 - this.stateTime * 3) : 1;
    if (this.isBoss && this.state === 'attack' && this.attackKind === 'lunge') this.visual.scale.y = .8;
    const moving = this.body.intent.lengthSq() > .01 && this.enabled && !stunned;
    if (moving) this.mixer?.update(delta);
    for (const { material, color, emissive, intensity } of this.materials) {
      if (color) material.color.copy(color).lerp(WHITE, this.flash > 0 ? 1 : 0);
      if (emissive) { material.emissive.copy(this.flash > 0 ? WHITE : emissive); material.emissiveIntensity = this.flash > 0 ? 1 : intensity; }
    }
  }

  dispose() {
    this.enabled = false; this.unregister(); this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    releaseObject(this.root);
    for (const { material } of this.materials) material.dispose();
    this.lease?.release();
  }
}
