export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pointer = { x: 0, y: 0, dx: 0, dy: 0, primaryDown: false, secondaryDown: false, pressed: false, released: false, wheel: 0 };
    window.addEventListener("keydown", event => this.keys.add(event.key.toLowerCase()));
    window.addEventListener("keyup", event => this.keys.delete(event.key.toLowerCase()));
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", event => {
      canvas.setPointerCapture(event.pointerId);
      this.updatePointer(canvas, event);
      if (event.button === 0) { this.pointer.primaryDown = true; this.pointer.pressed = true; }
      if (event.button === 2) this.pointer.secondaryDown = true;
    });
    canvas.addEventListener("pointermove", event => this.updatePointer(canvas, event));
    const release = event => {
      if (event.button === 0 && this.pointer.primaryDown) { this.pointer.primaryDown = false; this.pointer.released = true; }
      if (event.button === 2) this.pointer.secondaryDown = false;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("wheel", event => { event.preventDefault(); this.pointer.wheel += event.deltaY; }, { passive: false });
  }
  updatePointer(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    this.pointer.dx += x - this.pointer.x; this.pointer.dy += y - this.pointer.y;
    this.pointer.x = x; this.pointer.y = y;
  }
  endFrame() { Object.assign(this.pointer, { dx: 0, dy: 0, pressed: false, released: false, wheel: 0 }); }
  down(key) { return this.keys.has(key.toLowerCase()); }
}
