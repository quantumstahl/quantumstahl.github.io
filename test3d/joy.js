/*
 * BirdKnight semi-floating joystick
 * - Spawns where the left thumb first touches
 * - Restricted to left side of screen
 * - Base is clamped to a safe ergonomic zone
 * - Hides when released
 * - Mouse support kept for desktop testing
 */

let StickStatus = {
    xPosition: 0,
    yPosition: 0,

    // gamla procentvärden
    x: 0,
    y: 0,

    // nya 360-värden
    xFloat: 0,
    yFloat: 0,
    power: 0,
    angle: 0,

    cardinalDirection: "C"
};

var JoyStick = (function (container, parameters, callback) {
    parameters = parameters || {};

    var title = (typeof parameters.title === "undefined" ? "joystick" : parameters.title);
   // var width = (typeof parameters.width === "undefined" ? 300 : parameters.width);
   // var height = (typeof parameters.height === "undefined" ? 300 : parameters.height);

    var internalFillColor = (typeof parameters.internalFillColor === "undefined" ? "#f01e2c" : parameters.internalFillColor);
    var internalLineWidth = (typeof parameters.internalLineWidth === "undefined" ? 2 : parameters.internalLineWidth);
    var internalStrokeColor = (typeof parameters.internalStrokeColor === "undefined" ? "#330000" : parameters.internalStrokeColor);

    var externalLineWidth = (typeof parameters.externalLineWidth === "undefined" ? 2 : parameters.externalLineWidth);
    var externalStrokeColor = (typeof parameters.externalStrokeColor === "undefined" ? "#800000" : parameters.externalStrokeColor);

    var autoReturnToCenter = (typeof parameters.autoReturnToCenter === "undefined" ? true : parameters.autoReturnToCenter);

    // NEW
    var floating = (typeof parameters.floating === "undefined" ? true : parameters.floating);
    var floatingLeftZone = (typeof parameters.floatingLeftZone === "undefined" ? 0.45 : parameters.floatingLeftZone);

    callback = callback || function () {};

    var canvas = document.getElementById(container);
    if (!canvas) {
        throw new Error("JoyStick: canvas not found for container/id: " + container);
    }


   
    var context = canvas.getContext("2d");
    var pressed = 0;
    var circumference = 2 * Math.PI;

    // Geometry
    var centerX = 0;
    var centerY = 0;
    var movedX = 0;
    var movedY = 0;

    var defaultCenterX = 0;
    var defaultCenterY = 0;

    var externalRadius = 0;
    var internalRadius = 0;
    var maxMoveStick = 0;

    var directionHorizontalLimitPos = 0;
    var directionHorizontalLimitNeg = 0;
    var directionVerticalLimitPos = 0;
    var directionVerticalLimitNeg = 0;

    var activeTouchId = null;
    var showBase = !floating;
    
    
    var directionMode = (typeof parameters.directionMode === "undefined" ? 8 : parameters.directionMode);
    
    function getCanvasPos(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function updateGeometry() {
        externalRadius = Math.min(canvas.width, canvas.height) * 0.09;
        internalRadius = externalRadius * 0.50;
        maxMoveStick = externalRadius - internalRadius;

        directionHorizontalLimitPos = maxMoveStick * 0.35;
        directionHorizontalLimitNeg = -directionHorizontalLimitPos;
        directionVerticalLimitPos = maxMoveStick * 0.35;
        directionVerticalLimitNeg = -directionVerticalLimitPos;
    }

    function updateDefaultCenter() {
        const isPortrait = canvas.height > canvas.width;

        if (!isPortrait) {
            defaultCenterX = canvas.width * 0.12;
            defaultCenterY = canvas.height * 0.60;
        } else {
            defaultCenterX = canvas.width * 0.18;
            defaultCenterY = canvas.height * 0.79;
        }
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function clampStick(posX, posY) {
        let dx = posX - centerX;
        let dy = posY - centerY;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > maxMoveStick) {
            let angle = Math.atan2(dy, dx);
            movedX = centerX + Math.cos(angle) * maxMoveStick;
            movedY = centerY + Math.sin(angle) * maxMoveStick;
        } else {
            movedX = posX;
            movedY = posY;
        }
    }
    let counter=0;
    let savedisportrait=canvas.height > canvas.width;
    function changedir(){
        const isPortrait = canvas.height > canvas.width;
        
        if(isPortrait!==savedisportrait||counter>0){if(counter==0)counter=10;savedisportrait=isPortrait;counter--;return true;}
        
        return false;
        
    }
    
    
    function isInsideActivationZone(pos) {
        const dx = pos.x - centerX;
        const dy = pos.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= externalRadius + internalRadius ;
    }

    function isInsideLeftZone(pos) {
        return pos.x <= canvas.width * floatingLeftZone;
    }

    function placeFloatingBase(pos) {
        // Semi-floating: låt spelaren starta där de vill på vänster sida,
        // men clampa till ett ergonomiskt område.
        const margin = externalRadius + 20;
        const isPortrait = canvas.height > canvas.width;

        if (isPortrait) {
            centerX = clamp(pos.x, margin, canvas.width * 0.35);
            centerY = clamp(pos.y, canvas.height * 0.52, canvas.height * 0.90);
        } else {
            centerX = clamp(pos.x, margin, canvas.width * 0.28);
            centerY = clamp(pos.y, canvas.height * 0.50, canvas.height * 0.92);
        }

        movedX = centerX;
        movedY = centerY;
        showBase = true;
    }

    function drawExternal() {
        context.beginPath();
        context.arc(centerX, centerY, externalRadius, 0, circumference, false);
        context.lineWidth = externalLineWidth-1;
        //context.strokeStyle = externalStrokeColor;
        context.strokeStyle="white";
        context.stroke();
    }

    function drawInternal() {
        context.beginPath();
        context.arc(movedX, movedY, internalRadius, 0, circumference, false);

        var grd = context.createRadialGradient(centerX, centerY, 5, centerX, centerY, externalRadius * 2);
        grd.addColorStop(0, internalFillColor);
        grd.addColorStop(1, internalStrokeColor);
        
        
        context.fillStyle = grd;
        context.fill();
        context.lineWidth = internalLineWidth-1;
        //context.strokeStyle = internalStrokeColor;
        context.strokeStyle = "white";
        
        context.stroke();
    }

   function redraw() {
   // context.clearRect(centerX-externalRadius/2-internalRadius, centerY-externalRadius/2-internalRadius, externalRadius+internalRadius*2, externalRadius+internalRadius*2);
    context.clearRect(0, 0,canvas.width, canvas.height);
    updateGeometry();
    updateDefaultCenter();

    if (centerY < 10 || changedir()) {
        centerX = defaultCenterX;
        centerY = defaultCenterY;
        movedX = centerX;
        movedY = centerY;
    }

    drawExternal();
    drawInternal();
}

    function getCardinalDirection() {
        const horizontal = movedX - centerX;
        const vertical = movedY - centerY;

        const deadZone = maxMoveStick * 0.25;

        // Ingen riktning om man är nära mitten
        if (Math.abs(horizontal) < deadZone && Math.abs(vertical) < deadZone) {
            return "C";
        }

        // 4-vägs joystick
        if (directionMode === 4) {
            if (Math.abs(horizontal) > Math.abs(vertical)) {
                return horizontal < 0 ? "W" : "E";
            } else {
                return vertical < 0 ? "N" : "S";
            }
        }

        // 8-vägs joystick
        let result = "C";

        if (vertical < -deadZone) result = "N";
        else if (vertical > deadZone) result = "S";

        if (horizontal < -deadZone) {
            result = (result === "C") ? "W" : result + "W";
        } else if (horizontal > deadZone) {
            result = (result === "C") ? "E" : result + "E";
        }

        return result;
    }

    function updateStatus() {
        let nx = 0;
        let ny = 0;
        let fx = 0;
        let fy = 0;
        let power = 0;
        let angle = 0;

        if (maxMoveStick > 0) {
            const dx = movedX - centerX;
            const dy = movedY - centerY;

            fx = dx / maxMoveStick;
            fy = -dy / maxMoveStick; // upp = positiv Y

            // Clampa ifall något blir lite över p.g.a. float
            fx = clamp(fx, -1, 1);
            fy = clamp(fy, -1, 1);

            power = Math.sqrt(fx * fx + fy * fy);
            power = clamp(power, 0, 1);

            // angle i radians.
            // 0 = höger, PI/2 = upp, PI/-2 = ner
            angle = Math.atan2(fy, fx);

            nx = Math.round(fx * 100);
            ny = Math.round(fy * 100);
        }

        const deadZone = 0.12;

        if (power < deadZone) {
            fx = 0;
            fy = 0;
            power = 0;
            angle = 0;
        }

        StickStatus.xPosition = movedX;
        StickStatus.yPosition = movedY;

        StickStatus.x = isFinite(nx) ? nx : 0;
        StickStatus.y = isFinite(ny) ? ny : 0;

        StickStatus.xFloat = isFinite(fx) ? fx : 0;
        StickStatus.yFloat = isFinite(fy) ? fy : 0;
        StickStatus.power = isFinite(power) ? power : 0;
        StickStatus.angle = isFinite(angle) ? angle : 0;

        StickStatus.cardinalDirection = getCardinalDirection();

        callback(StickStatus);
    }

    function resetStick() {
        if (!floating) {
            movedX = centerX;
            movedY = centerY;
            redraw();
            updateStatus();
            return;
        }

        movedX = centerX;
        movedY = centerY;
        showBase = false;

        StickStatus.xPosition = centerX;
        StickStatus.yPosition = centerY;
        StickStatus.x = 0;
        StickStatus.y = 0;
        StickStatus.cardinalDirection = "C";

        callback(StickStatus);
        redraw();
    }

    function onTouchStart(event) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            const t = event.changedTouches[i];
            const pos = getCanvasPos(t.clientX, t.clientY);

            if (floating) {
                if (!isInsideLeftZone(pos)) continue;

                pressed = 1;
                activeTouchId = t.identifier;
                placeFloatingBase(pos);
                redraw();
                updateStatus();
                break;
            } else {
                if (!isInsideActivationZone(pos)) continue;

                pressed = 1;
                activeTouchId = t.identifier;
                clampStick(pos.x, pos.y);
                redraw();
                updateStatus();
                break;
            }
        }
    }

    function onTouchMove(event) {
        if (pressed !== 1 || activeTouchId === null) return;

        let activeTouch = null;
        for (let i = 0; i < event.targetTouches.length; i++) {
            if (event.targetTouches[i].identifier === activeTouchId) {
                activeTouch = event.targetTouches[i];
                break;
            }
        }

        if (!activeTouch) return;

        const pos = getCanvasPos(activeTouch.clientX, activeTouch.clientY);
        clampStick(pos.x, pos.y);
        redraw();
        updateStatus();
    }

    function onTouchEnd(event) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            if (event.changedTouches[i].identifier === activeTouchId) {
                pressed = 0;
                activeTouchId = null;

                if (autoReturnToCenter) {
                    resetStick();
                }
                break;
            }
        }
    }

    function onMouseDown(event) {
        
        const pos = getCanvasPos(event.clientX, event.clientY);

        if (floating) {
            if (!isInsideLeftZone(pos)) return;
            pressed = 1;
            placeFloatingBase(pos);
            redraw();
            updateStatus();
            return;
        }

        if (!isInsideActivationZone(pos)) return;

        pressed = 1;
        clampStick(pos.x, pos.y);
        redraw();
        updateStatus();
    }

    function onMouseMove(event) {
        if (pressed !== 1) return;

        const pos = getCanvasPos(event.clientX, event.clientY);
        clampStick(pos.x, pos.y);
        redraw();
        updateStatus();
    }

    function onMouseUp() {
        pressed = 0;
        if (autoReturnToCenter) {
            resetStick();
        }
    }
    this.SetDirectionMode = function (mode) {
        if (mode !== 4 && mode !== 8) return;

        directionMode = mode;
        updateStatus();
    };

    this.GetDirectionMode = function () {
        return directionMode;
    };
    // Init
  //  updateGeometry();
    updateDefaultCenter();
    centerX = defaultCenterX;
    centerY = defaultCenterY;
    movedX = centerX;
    movedY = centerY;

    if ("ontouchstart" in document.documentElement) {
        canvas.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: true });
        document.addEventListener("touchend", onTouchEnd, { passive: true });
        document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    } else {
       // document.addEventListener("mousedown", onMouseDown, false);
       // document.addEventListener("mousemove", onMouseMove, false);
       // document.addEventListener("mouseup", onMouseUp, false);
    }

    //redraw();
    updateStatus();

    this.redraw = function () {
        redraw();
    };

    this.GetWidth = function () {
        return canvas.width;
    };

    this.GetHeight = function () {
        return canvas.height;
    };

    this.GetPosX = function () {
        return movedX;
    };

    this.GetPosY = function () {
        return movedY;
    };

    this.GetX = function () {
        return Math.round(((movedX - centerX) / maxMoveStick) * 100) || 0;
    };

    this.GetY = function () {
        return Math.round((((movedY - centerY) / maxMoveStick) * -100)) || 0;
    };

    this.GetDir = function () {
        return getCardinalDirection();
    };
    this.GetXFloat = function () {
        if (maxMoveStick <= 0) return 0;

        const x = (movedX - centerX) / maxMoveStick;
        const power = Math.sqrt(x * x + Math.pow((movedY - centerY) / maxMoveStick, 2));

        if (power < 0.12) return 0;

        return clamp(x, -1, 1);
    };

    this.GetYFloat = function () {
        if (maxMoveStick <= 0) return 0;

        const y = -((movedY - centerY) / maxMoveStick);
        const power = Math.sqrt(
            Math.pow((movedX - centerX) / maxMoveStick, 2) +
            Math.pow((movedY - centerY) / maxMoveStick, 2)
        );

        if (power < 0.12) return 0;

        return clamp(y, -1, 1);
    };

    this.GetPower = function () {
        if (maxMoveStick <= 0) return 0;

        const x = (movedX - centerX) / maxMoveStick;
        const y = (movedY - centerY) / maxMoveStick;

        const p = Math.sqrt(x * x + y * y);

        if (p < 0.12) return 0;

        return clamp(p, 0, 1);
    };

    this.GetAngle = function () {
        const x = this.GetXFloat();
        const y = this.GetYFloat();

        if (x === 0 && y === 0) return 0;

        return Math.atan2(y, x);
    };

    this.GetVector = function () {
        const x = this.GetXFloat();
        const y = this.GetYFloat();
        const power = this.GetPower();

        return {
            x,
            y,
            power,
            angle: Math.atan2(y, x)
        };
    };
});