class XboxController {
  constructor(gamepadIndex = 0, deadzone = 0.15) {
    this.gamepadIndex = gamepadIndex;
    this.deadzone = deadzone; // Stick sensitivity threshold
    this.buttonsMap = {
      A: 0, B: 1, X: 2, Y: 3,
    };
    this.dpadMap = {
      up: 12, down: 13, left: 14, right: 15,
    };
    this.axesMap = {
      left: { x: 0, y: 1 },
      right: { x: 2, y: 3 },
    };
  }

  get gamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    return gamepads[this.gamepadIndex];
  }

  // Helper to get direction from stick axes
  _getDirectionFromAxes(x, y) {
    const magnitude = Math.sqrt(x * x + y * y);

    if (magnitude < this.deadzone) {
      return "C"; // Center
    }

    // atan2 gives angle in radians. We negate y because gamepad API typically has -1 as up.
    const angle = Math.atan2(-y, x);
    const pi = Math.PI;

    // Map angle to 8 directions + Center
    if (angle > -pi / 8 && angle <= pi / 8) return "E";
    if (angle > pi / 8 && angle <= 3 * pi / 8) return "NE";
    if (angle > 3 * pi / 8 && angle <= 5 * pi / 8) return "N";
    if (angle > 5 * pi / 8 && angle <= 7 * pi / 8) return "NW";
    if (angle > 7 * pi / 8 || angle <= -7 * pi / 8) return "W";
    if (angle > -7 * pi / 8 && angle <= -5 * pi / 8) return "SW";
    if (angle > -5 * pi / 8 && angle <= -3 * pi / 8) return "S";
    if (angle > -3 * pi / 8 && angle <= -pi / 8) return "SE";

    return "C"; // Should not happen if magnitude > deadzone, but fallback
  }

  update() {
    const pad = this.gamepad;
    if (!pad) {
      throw new Error('Gamepad not connected or index out of range.');
    }

    const buttonsState = {};
    for (const [name, index] of Object.entries(this.buttonsMap)) {
      buttonsState[name] = pad.buttons[index]?.pressed ?? false;
    }

    const dpadState = {};
    for (const [direction, index] of Object.entries(this.dpadMap)) {
      dpadState[direction] = pad.buttons[index]?.pressed ?? false;
    }

    const leftStick = {
      x: pad.axes[this.axesMap.left.x] || 0,
      y: pad.axes[this.axesMap.left.y] || 0,
    };

    const rightStick = {
      x: pad.axes[this.axesMap.right.x] || 0,
      y: pad.axes[this.axesMap.right.y] || 0,
    };

    return {
      buttons: buttonsState,
      dpad: dpadState,
      leftStick,
      rightStick,
      leftStickDirection: this._getDirectionFromAxes(leftStick.x, leftStick.y),
      rightStickDirection: this._getDirectionFromAxes(rightStick.x, rightStick.y),
    };
  }

  isButtonPressed(buttonName) {
    const pad = this.gamepad;
    if (!pad) return false; // Return false instead of throwing error for quick checks
    const index = this.buttonsMap[buttonName];
    return index !== undefined && (pad.buttons[index]?.pressed ?? false);
  }

  getDPadState() {
    const pad = this.gamepad;
    if (!pad) return { up: false, down: false, left: false, right: false };
    const state = {};
    for (const [direction, index] of Object.entries(this.dpadMap)) {
      state[direction] = pad.buttons[index]?.pressed ?? false;
    }
    return state;
  }

  getLeftStick() {
    const pad = this.gamepad;
    if (!pad) return { x: 0, y: 0 };
    return {
      x: pad.axes[this.axesMap.left.x] || 0,
      y: pad.axes[this.axesMap.left.y] || 0,
    };
  }

  getRightStick() {
    const pad = this.gamepad;
    if (!pad) return { x: 0, y: 0 };
    return {
      x: pad.axes[this.axesMap.right.x] || 0,
      y: pad.axes[this.axesMap.right.y] || 0,
    };
  }

  // Get direction for Left Stick (joy1)
  getLeftStickDirection() {
    const stick = this.getLeftStick();
    return this._getDirectionFromAxes(stick.x, stick.y);
  }

  // Get direction for Right Stick (joy2)
  getRightStickDirection() {
    const stick = this.getRightStick();
    return this._getDirectionFromAxes(stick.x, stick.y);
  }
}

// Example usage in a game loop:
let controller = null; // Hold the controller instance

function gameLoop() {
  if (!controller) {
     // Try to initialize if not already done
     try {
        controller = new XboxController(0); // Use gamepad at index 0
        console.log("Controller initialized.");
     } catch (error) {
        console.log("Waiting for controller...");
        requestAnimationFrame(gameLoop); // Keep trying
        return;
     }
  }

  try {
    // Option 1: Get all state at once
    // const state = controller.update();
    // console.log('Left Stick Direction:', state.leftStickDirection);
    // console.log('Right Stick Direction:', state.rightStickDirection);
    // if (state.buttons.A) console.log('A pressed');

    // Option 2: Get specific states as needed
    const leftDir = controller.getLeftStickDirection();
    const rightDir = controller.getRightStickDirection();

    if (leftDir !== 'C') {
        console.log('Left Stick Direction:', leftDir);
    }
     if (rightDir !== 'C') {
        console.log('Right Stick Direction:', rightDir);
    }

    if (controller.isButtonPressed('A')) {
      console.log('Button A pressed');
    }
     if (controller.isButtonPressed('B')) {
      console.log('Button B pressed');
    }
     if (controller.isButtonPressed('X')) {
      console.log('Button X pressed');
    }
     if (controller.isButtonPressed('Y')) {
      console.log('Button Y pressed');
    }

    const dpad = controller.getDPadState();
     if (dpad.up) console.log('D-Pad Up');
     if (dpad.down) console.log('D-Pad Down');
     if (dpad.left) console.log('D-Pad Left');
     if (dpad.right) console.log('D-Pad Right');


  } catch (error) {
    console.error(error.message);
    controller = null; // Reset controller instance on error (e.g., disconnect)
  }

  requestAnimationFrame(gameLoop); // Continue the loop
}

// Start loop only when a gamepad is connected
window.addEventListener('gamepadconnected', (event) => {
  console.log('Gamepad connected:', event.gamepad.id);
  // Check if it's the first controller and the loop isn't running
   if (event.gamepad.index === 0 && !controller) {
       try {
           controller = new XboxController(event.gamepad.index);
           console.log("Controller initialized on connect.");
           requestAnimationFrame(gameLoop); // Start the loop
       } catch(e) {
           console.error("Failed to initialize controller on connect:", e);
           controller = null;
       }
   }
});

window.addEventListener('gamepaddisconnected', (event) => {
  console.log('Gamepad disconnected:', event.gamepad.id);
  if (controller && event.gamepad.index === controller.gamepadIndex) {
    console.log("Active controller disconnected.");
    controller = null; // Reset controller instance
    // Optionally, stop the game loop or show a message
  }
});

// Initial check in case gamepad is already connected before listener is added
const initialGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
if (initialGamepads[0] && !controller) {
     console.log('Gamepad already connected:', initialGamepads[0].id);
     try {
        controller = new XboxController(0);
        console.log("Controller initialized on startup.");
        requestAnimationFrame(gameLoop); // Start the loop
     } catch(e) {
        console.error("Failed to initialize controller on startup:", e);
        controller = null;
     }
} else if (!controller) {
    console.log("No gamepad detected initially. Waiting for connection...");
    // The 'gamepadconnected' event will handle starting the loop
}