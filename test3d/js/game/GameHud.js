// DOM changes only when coins or health change; no canvas/render-loop work.
export class GameHud {
  constructor(root, health) {
    this.root = root; this.coins = root.querySelector("[data-coin-count]");
    this.hearts = root.querySelector("[data-health]"); this.slots = [...this.hearts.querySelectorAll("svg")];
    this.unsubscribe = health.onChanged(state => this.setHealth(state));
    this.setCoins(0); this.setHealth(health); root.hidden = false;
  }
  setCoins(count) { this.coins.textContent = String(count); this.coins.setAttribute("aria-label", `${count} coins`); }
  setHealth(health) {
    this.hearts.setAttribute("aria-label", `${health.current} of ${health.max} hearts`);
    for (let i = 0; i < this.slots.length; i++) this.slots[i].classList.toggle("is-empty", i >= health.current);
  }
  dispose() { this.unsubscribe(); this.root.hidden = true; }
}
