class InputManager {
    constructor(canvas) {
        this.canvas = canvas;

        this.keys = {};

        this.mouse = {
            x: 0,
            y: 0,
            dx: 0,
            dy: 0,
            down: false,
            rightDown: false,
            justPressed: false,
            justReleased: false,
            wheel: 0
        };

        this._setupKeyboard();
        this._setupMouse();
    }

    update() {
        this.mouse.dx = 0;
        this.mouse.dy = 0;
        this.mouse.justPressed = false;
        this.mouse.justReleased = false;
        this.mouse.wheel = 0;
    }

    _setupKeyboard() {
        window.addEventListener("keydown", e => {
            this.keys[e.key.toLowerCase()] = true;

            // Förhindra att Ctrl+S öppnar browser-save
            if (e.ctrlKey && e.key.toLowerCase() === "s") {
                e.preventDefault();
            }
        });

        window.addEventListener("keyup", e => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    _setupMouse() {
        this.canvas.addEventListener("mousedown", e => {
            if (e.button === 0) {
                this.mouse.down = true;
                this.mouse.justPressed = true;
            }

            if (e.button === 2) {
                this.mouse.rightDown = true;
            }
        });

        window.addEventListener("mouseup", e => {
            if (e.button === 0) {
                this.mouse.down = false;
                this.mouse.justReleased = true;
            }

            if (e.button === 2) {
                this.mouse.rightDown = false;
            }
        });

        this.canvas.addEventListener("mousemove", e => {
            const rect = this.canvas.getBoundingClientRect();

            const newX = e.clientX - rect.left;
            const newY = e.clientY - rect.top;

            this.mouse.dx += newX - this.mouse.x;
            this.mouse.dy += newY - this.mouse.y;

            this.mouse.x = newX;
            this.mouse.y = newY;
        });

        this.canvas.addEventListener("wheel", e => {
            e.preventDefault();
            this.mouse.wheel += e.deltaY;
        }, { passive: false });

        this.canvas.addEventListener("contextmenu", e => {
            e.preventDefault();
        });
    }

    isKeyDown(key) {
        return !!this.keys[key.toLowerCase()];
    }
}
window.InputManager = InputManager;