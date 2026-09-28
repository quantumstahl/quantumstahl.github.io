// Semi-floating left-thumb joystick, adapted from CatAdventure's touch
// controls. It intentionally has no Three.js dependency.
export class TouchJoystick {
  constructor() {
    this.vector = { x: 0, y: 0, power: 0 };
    this.radius = 20; this.touchId = null; this.centerX = 0; this.centerY = 0;
    this.root = document.createElement("div"); this.root.className = "mobile-joystick";
    this.base = document.createElement("div"); this.base.className = "mobile-joystick__base";
    this.knob = document.createElement("div"); this.knob.className = "mobile-joystick__knob";
    this.base.append(this.knob); this.root.append(this.base); document.body.append(this.root);

    this.root.addEventListener("touchstart", event => this.begin(event), { passive: false });
    this.root.addEventListener("touchmove", event => this.move(event), { passive: false });
    this.root.addEventListener("touchend", event => this.end(event), { passive: false });
    this.root.addEventListener("touchcancel", event => this.end(event), { passive: false });
    this.root.classList.add("is-active");
    
    this.placeDefault();
  }
  begin(event) {
    if (this.touchId !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    event.preventDefault();
    const maxX = Math.min(window.innerWidth * .35, window.innerWidth - this.radius - 12);
    this.centerX = Math.max(this.radius + 12, Math.min(touch.clientX, maxX));
    this.centerY = Math.max(window.innerHeight * .52, Math.min(touch.clientY, window.innerHeight - this.radius - 16));
    this.touchId = touch.identifier;
    this.base.style.left = `${this.centerX}px`; this.base.style.top = `${this.centerY}px`; //this.root.classList.add("is-active");
    this.updateTouch(touch);
  }
  move(event) {
    const touch = [...event.touches].find(item => item.identifier === this.touchId);
    if (!touch) return;
    event.preventDefault();
    this.updateTouch(touch);
  }
  updateTouch(touch) {
    const dx = touch.clientX - this.centerX, dy = touch.clientY - this.centerY;
    const distance = Math.hypot(dx, dy), amount = Math.min(1, distance / this.radius);
    const x = distance ? dx / distance * amount : 0, y = distance ? -dy / distance * amount : 0;
    this.vector.x = x; this.vector.y = y; this.vector.power = amount;
    this.knob.style.transform = `translate(calc(-50% + ${x * this.radius}px), calc(-50% + ${-y * this.radius}px))`;
  }
  end(event) {
    const ended = [...event.changedTouches].some(touch => touch.identifier === this.touchId);
    if (!ended) return;
    event.preventDefault();
    this.touchId = null; this.vector.x = 0; this.vector.y = 0; this.vector.power = 0;
    this.knob.style.transform = "translate(-50%, -50%)"; //this.root.classList.remove("is-active");
  }
  getVector() { return this.vector; }
  placeDefault() {
    const marginLeft = 34;
    const marginBottom = 38;

    this.centerX =
      this.radius + marginLeft;

    this.centerY =
      window.innerHeight -
      this.radius -
      marginBottom;

    this.base.style.left =
      `${this.centerX}px`;

    this.base.style.top =
      `${this.centerY}px`;

    this.knob.style.transform =
      "translate(-50%, -50%)";
  }
}
