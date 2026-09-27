export class TouchJoystick {
  constructor() {
    this.vector = { x: 0, y: 0, power: 0 };

    // Mindre joystick
    this.radius = 40;

    this.pointerId = null;
    this.centerX = 0;
    this.centerY = 0;

    this.root = document.createElement("div");
    this.root.className = "mobile-joystick";

    this.base = document.createElement("div");
    this.base.className = "mobile-joystick__base";

    this.knob = document.createElement("div");
    this.knob.className = "mobile-joystick__knob";

    this.base.append(this.knob);
    this.root.append(this.base);
    document.body.append(this.root);

    this.root.addEventListener(
      "pointerdown",
      event => this.begin(event)
    );

    this.root.addEventListener(
      "pointermove",
      event => this.move(event)
    );

    this.root.addEventListener(
      "pointerup",
      event => this.end(event)
    );

    this.root.addEventListener(
      "pointercancel",
      event => this.end(event)
    );

    this.root.classList.add("is-active");

    // Bra startposition direkt när spelet laddas
    this.placeDefault();

    window.addEventListener(
      "resize",
      () => {
        if (this.pointerId === null)
          this.placeDefault();
      }
    );
  }

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

  begin(event) {
    if (
      this.pointerId !== null ||
      event.pointerType === "mouse"
    ) return;

    const margin = 16;

    // Begränsa joysticken till vänstra delen av skärmen
    const maxX =
      Math.min(
        window.innerWidth * 0.35,
        window.innerWidth -
        this.radius -
        margin
      );

    this.centerX =
      THREE.MathUtils
        ? Math.max(
            this.radius + margin,
            Math.min(event.clientX, maxX)
          )
        : Math.max(
            this.radius + margin,
            Math.min(event.clientX, maxX)
          );

    this.centerY =
      Math.max(
        window.innerHeight * 0.52,
        Math.min(
          event.clientY,
          window.innerHeight -
          this.radius -
          margin
        )
      );

    this.pointerId =
      event.pointerId;

    this.root.setPointerCapture?.(
      event.pointerId
    );

    this.base.style.left =
      `${this.centerX}px`;

    this.base.style.top =
      `${this.centerY}px`;

    this.move(event);

    event.preventDefault();
  }

  move(event) {
    if (
      event.pointerId !==
      this.pointerId
    ) return;

    const dx =
      event.clientX -
      this.centerX;

    const dy =
      event.clientY -
      this.centerY;

    const distance =
      Math.hypot(dx, dy);

    const amount =
      Math.min(
        1,
        distance / this.radius
      );

    const x =
      distance
        ? dx / distance * amount
        : 0;

    const y =
      distance
        ? -dy / distance * amount
        : 0;

    this.vector.x = x;
    this.vector.y = y;
    this.vector.power = amount;

    this.knob.style.transform =
      `translate(
        calc(-50% + ${x * this.radius}px),
        calc(-50% + ${-y * this.radius}px)
      )`;

    event.preventDefault();
  }

  end(event) {
    if (
      event.pointerId !==
      this.pointerId
    ) return;

    this.pointerId = null;

    this.vector.x = 0;
    this.vector.y = 0;
    this.vector.power = 0;

    this.knob.style.transform =
      "translate(-50%, -50%)";
  }

  getVector() {
    return this.vector;
  }
}