// World units and seconds. Each placement can override these in properties.enemy.
export const SPIDER_DEFAULTS = Object.freeze({
  maxHealth: 3, detectionRadius: 15, leashRadius: 30, moveSpeed: 1.8,
  attackRange: .75, attackCooldown: 1.1, stunDuration: 2.5, hitKnockback: .25,
  attackDamage: 1, detectDuration: .25, attackWindup: .22, hurtDuration: .18,
  stunnedDamageMultiplier: 2, deathDuration: .8, radius: .25, height: .38,
  stompBounce: 3.5, modelYaw: 0,
});

export const BIG_SPIDER_DEFAULTS = Object.freeze({
  ...SPIDER_DEFAULTS, maxHealth: 8, detectionRadius: 20, leashRadius: 30, moveSpeed: 1.4,
  radius: .63, height: 1.07, attackRange: 1.6, attackWindup: .5, attackCooldown: .9,
  stunDuration: .85, hitKnockback: .12, deathDuration: 1.1,
  lungeInterval: 4.5, lungeRange: 7, lungeWindup: .75, lungeSpeed: 7,
  lungeDuration: .55, lungeRecovery: .65, stompCooldown: 2.5,
});

export const SPIDER_TUNING = Object.freeze({
  maxHealth: 'Max health', detectionRadius: 'Detection radius (m)', leashRadius: 'Leash radius (m)',
  moveSpeed: 'Move speed (m/s)', attackRange: 'Attack range (m)', attackCooldown: 'Attack cooldown (s)',
  stunDuration: 'Stun duration (s)', hitKnockback: 'Hit knockback (m)',
});

export const BIG_SPIDER_TUNING = Object.freeze({
  ...SPIDER_TUNING, radius: 'Body radius (m)', height: 'Back height (m)', attackWindup: 'Bite wind-up (s)',
  lungeInterval: 'Lunge cooldown (s)', lungeRange: 'Lunge trigger range (m)', lungeWindup: 'Lunge anticipation (s)',
  lungeSpeed: 'Lunge speed (m/s)', lungeDuration: 'Lunge duration (s)', lungeRecovery: 'Lunge recovery (s)',
  stompCooldown: 'Stomp cooldown (s)',
});

export function spiderType(record, asset) {
  const enemy = record.properties?.enemy;
  if (enemy === false) return null;
  const explicit = typeof enemy === 'string' ? enemy : enemy?.type;
  if (explicit === 'spider' || explicit === 'spiderbig') return explicit;
  const name = asset?.name ?? record.assetId;
  if (/^(?:maxworld:)?spiderbig(?:\.glb)?$/i.test(name)) return 'spiderbig';
  return /^(?:maxworld:)?spider(?:\.glb)?$/i.test(name) ? 'spider' : null;
}

export function isSpider(record, asset) {
  return spiderType(record, asset) !== null;
}

export function spiderConfig(overrides = {}, type = overrides?.type ?? 'spider') {
  overrides ??= {};
  const result = { ...(type === 'spiderbig' ? BIG_SPIDER_DEFAULTS : SPIDER_DEFAULTS) };
  for (const key of Object.keys(result)) {
    const value = overrides[key];
    if (Number.isFinite(value) && (key === 'modelYaw' || value >= 0)) result[key] = value;
  }
  result.maxHealth = Math.max(1, Math.round(result.maxHealth));
  result.attackDamage = Math.max(1, Math.round(result.attackDamage));
  for (const key of ['attackCooldown', 'hurtDuration', 'deathDuration', 'radius', 'height']) result[key] = Math.max(.01, result[key]);
  result.leashRadius = Math.max(result.detectionRadius, result.leashRadius);
  result.type = type;
  return result;
}
