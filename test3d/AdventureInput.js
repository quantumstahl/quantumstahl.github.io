class AdventureInput {
    constructor(canvas) {
        this.canvas = canvas;

        this.keys = {};

        this.pointer = {
            x: 0,
            y: 0,
            down: false,
            justPressed: false,
            justReleased: false,
            id: null
        };

        this.jumpDown = false;
        this.jumpJustPressed = false;
        this.jumpJustReleased = false;
        this.jumpPointerId = null;

        this.jumpButton = {
            x: 0,
            y: 0,
            r: 50
        };

        this._setupKeyboard();
        this._setupPointer();
    }

    update() {
        this.pointer.justPressed = false;
        this.pointer.justReleased = false;

        this.jumpJustPressed = false;
        this.jumpJustReleased = false;
    }

    setJumpButton(x, y, r) {
        this.jumpButton.x = x;
        this.jumpButton.y = y;
        this.jumpButton.r = r;
    }

    isInsideJumpButton(x, y) {
        const dx = x - this.jumpButton.x;
        const dy = y - this.jumpButton.y;
        return dx * dx + dy * dy <= this.jumpButton.r * this.jumpButton.r;
    }

    _setupKeyboard() {
        window.addEventListener("keydown", e => {
            const key = e.key.toLowerCase();

            this.keys[key] = true;

            if (key === " ") {
                if (!this.jumpDown) {
                    this.jumpJustPressed = true;
                }

                this.jumpDown = true;
                e.preventDefault();
            }
        });

        window.addEventListener("keyup", e => {
            const key = e.key.toLowerCase();

            this.keys[key] = false;

            if (key === " ") {
                this.jumpDown = false;
                this.jumpJustReleased = true;
                e.preventDefault();
            }
        });
    }

    _setupPointer() {
        this.canvas.addEventListener("pointerdown", e => {
            const pos = this.getCanvasPos(e);

            // Jump-knapp får egen pointer,
            // så den inte stör joysticken.
            if (this.isInsideJumpButton(pos.x, pos.y)) {
                this.jumpPointerId = e.pointerId;

                if (!this.jumpDown) {
                    this.jumpJustPressed = true;
                }

                this.jumpDown = true;

                this.canvas.setPointerCapture?.(e.pointerId);
                e.preventDefault();
                return;
            }

            // Vanlig pointer för annat, t.ex. framtida kamera/touch.
            if (this.pointer.id === null) {
                this.pointer.id = e.pointerId;
                this.pointer.x = pos.x;
                this.pointer.y = pos.y;
                this.pointer.down = true;
                this.pointer.justPressed = true;

                this.canvas.setPointerCapture?.(e.pointerId);
            }

            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener("pointermove", e => {
            const pos = this.getCanvasPos(e);

            if (e.pointerId === this.pointer.id) {
                this.pointer.x = pos.x;
                this.pointer.y = pos.y;
            }

            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener("pointerup", e => {
            if (e.pointerId === this.jumpPointerId) {
                this.jumpPointerId = null;

                if (this.jumpDown) {
                    this.jumpDown = false;
                    this.jumpJustReleased = true;
                }

                e.preventDefault();
                return;
            }

            if (e.pointerId === this.pointer.id) {
                const pos = this.getCanvasPos(e);

                this.pointer.x = pos.x;
                this.pointer.y = pos.y;
                this.pointer.down = false;
                this.pointer.justReleased = true;
                this.pointer.id = null;
            }

            e.preventDefault();
        }, { passive: false });

        this.canvas.addEventListener("pointercancel", e => {
            if (e.pointerId === this.jumpPointerId) {
                this.jumpPointerId = null;

                if (this.jumpDown) {
                    this.jumpDown = false;
                    this.jumpJustReleased = true;
                }
            }

            if (e.pointerId === this.pointer.id) {
                this.pointer.down = false;
                this.pointer.justReleased = true;
                this.pointer.id = null;
            }

            e.preventDefault();
        }, { passive: false });
    }

    getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();

        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    isJumpPressed() {
        return this.jumpDown || !!this.keys[" "];
    }

    isJumpJustPressed() {
        return this.jumpJustPressed;
    }
}