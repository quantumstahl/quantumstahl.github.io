// Whole-heart runtime health. Independent of authored world/pickup history.
export class CatHealth {
  constructor() { this.max = 3; this.current = this.max; this.listeners = new Set(); }
  onChanged(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(value) {
    if (value === this.current) return 0;
    const change = value - this.current; this.current = value;
    for (const listener of this.listeners) listener(this);
    return change;
  }
  heal(amount = 1) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || this.current === 0) return 0;
    return this.set(Math.min(this.max, this.current + amount));
  }
  damage(amount = 1) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
    return Math.max(0, -this.set(Math.max(0, this.current - amount)));
  }
  kill() { return this.damage(this.max); }
  reset() { this.set(this.max); }
  snapshot() { return { version: 1, current: this.current }; }
  restore(state, validateOnly = false) {
    if (state?.version !== 1 || !Number.isInteger(state.current) || state.current < 0 || state.current > this.max) throw new Error("Invalid cat health save.");
    if (!validateOnly) this.set(state.current);
  }
}
