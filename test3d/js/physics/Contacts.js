export const DIRECTIONS = Object.freeze(["left", "right", "front", "back", "up", "down"]);
const MODES = ["ghost", "trigger", "solid", "dyn"];
const GROUPS = { solid: "contactsSolid", dyn: "contactsDyn", ghost: "contactsGhost", trigger: "contactsTrigger" };
const ALIASES = { top: "up", bottom: "down", forward: "front", backward: "back" };

// Non-enumerable runtime properties never enter JSON/world snapshots.
export function initializeContacts(object) {
  for (const mode of MODES) {
    const group = mode === "ghost" ? { ghost1: null, ghost2: null, ghost3: null }
      : mode === "trigger" ? { trigger1: null, trigger2: null, trigger3: null }
        : { left: null, right: null, front: null, back: null, up: null, down: null };
    Object.defineProperty(object, GROUPS[mode], { value: group, configurable: true });
  }
  return object;
}

export function clearContacts(object) {
  for (const mode of MODES) {
    const group = object[GROUPS[mode]];
    for (const key in group) group[key] = null;
  }
}

function match(group, type, dir) {
  if (!group) return null;
  if (dir !== "any") {
    const ref = group[dir];
    return ref && (type === "any" || ref.name === type) ? ref : null;
  }
  for (const key in group) {
    const ref = group[key];
    if (ref && (type === "any" || ref.name === type)) return ref;
  }
  return null;
}

export function touching(object, type = "any", mode = "ghost", dir = "any") {
  object = object?.userData?.mapObject ?? object;
  if (!object) return null;
  dir = ALIASES[dir] ?? dir;
  if (mode !== "any") return match(object[GROUPS[mode]], type, dir);
  for (const candidate of MODES) {
    const hit = match(object[GROUPS[candidate]], type, dir);
    if (hit) return hit;
  }
  return null;
}
