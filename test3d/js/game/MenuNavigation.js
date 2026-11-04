// Standard gamepad mapping; independent of gameplay actions and the DOM.
export class MenuNavigation {
  constructor() { this.previous = {}; this.direction = null; this.repeatAt = 0; this.padId = null; }
  poll(pads, now) {
    const pad = Array.from(pads ?? []).find(p => p?.connected);
    if (!pad) { this.previous = {}; this.direction = null; this.padId = null; return null; }
    const id = `${pad.index}:${pad.id}`;
    const button = i => !!pad.buttons[i]?.pressed;
    const current = { confirm: button(0), back: button(1), start: button(9) };
    const direction = button(12) || pad.axes[1] < -.55 ? "up" : button(13) || pad.axes[1] > .55 ? "down"
      : button(14) || pad.axes[0] < -.55 ? "left" : button(15) || pad.axes[0] > .55 ? "right" : null;
    let action = null;
    if (this.padId === id) {
      action = ["start", "back", "confirm"].find(key => current[key] && !this.previous[key]) ?? null;
      if (!action && direction && (direction !== this.direction || now >= this.repeatAt)) {
        action = direction; this.repeatAt = now + (direction !== this.direction ? 350 : 120);
      }
    }
    this.padId = id; this.previous = current; this.direction = direction;
    return action;
  }
}
