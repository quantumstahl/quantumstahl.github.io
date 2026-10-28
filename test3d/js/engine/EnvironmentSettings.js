// A fraction of a day: 0 = midnight, .25 = sunrise, .5 = noon.
export function normalizeEnvironmentSettings(value = {}) {
  const time = value?.timeOfDay;
  const duration = value?.dayDuration;
  return {
    timeOfDay: Number.isFinite(time) ? (time >= 0 && time < 1 ? time : ((time % 1) + 1) % 1) : .35,
    dayDuration: Number.isFinite(duration) ? Math.max(30, Math.min(86400, duration)) : 360,
    cycleEnabled: value?.cycleEnabled !== false,
  };
}

export function environmentSettingsEqual(a, b) {
  const left = normalizeEnvironmentSettings(a), right = normalizeEnvironmentSettings(b);
  return left.timeOfDay === right.timeOfDay && left.dayDuration === right.dayDuration && left.cycleEnabled === right.cycleEnabled;
}
