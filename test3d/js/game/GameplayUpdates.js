// One explicit gate for all gameplay simulation. Streaming/rendering lives in
// main.js and remains available while this gate is closed.
export function updateGameplay(systems, rawDelta) {
  const { menus, boxes, pickups, runtime, destructibles, enemies, combatTarget, environment, ambient } = systems;
  if (menus && !menus.playing) return 0;
  const delta = Math.min(rawDelta, 1 / 20);
  boxes?.update(rawDelta); pickups?.update(rawDelta);
  runtime.update(runtime.physics ? rawDelta : delta);
  enemies?.update(rawDelta);
  destructibles?.update(rawDelta, runtime.body.position);
  combatTarget?.update(delta);
  environment.update(rawDelta); ambient.update(rawDelta, environment.uniforms.uDaylight.value);
  menus?.gameplayAdvanced(rawDelta);
  return delta;
}
