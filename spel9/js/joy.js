/*
 * BirdKnight-friendly joystick
 * Rewritten to work correctly when the game canvas/internal resolution changes.
 *
 * Main fixes:
 * - Uses getBoundingClientRect() to map touch/mouse from screen space to canvas space
 * - No hardcoded pageX/pageY thresholds like pageX<500
 * - No impossible center values like canvas.height-350 on a 300px canvas
 * - Clamps stick movement to the joystick radius
 * - Safer multitouch handling via touch identifier
 */

let StickStatus = {
    xPosition: 0,
    yPosition: 0,
    x: 0,
    y: 0,
    cardinalDirection: "C"
};

var JoyStick = (function (container, parameters, callback) {
    parameters = parameters || {};

    var title = (typeof parameters.title === "undefined" ? "joystick" : parameters.title);
    var width = (typeof parameters.width === "undefined" ? 300 : parameters.width);
    var height = (typeof parameters.height === "undefined" ? 300 : parameters.height);
    var internalFillColor = (typeof parameters.internalFillColor === "undefined" ? "#AA0000" : parameters.internalFillColor);
    var internalLineWidth = (typeof parameters.internalLineWidth === "undefined" ? 2 : parameters.internalLineWidth);
    var internalStrokeColor = (typeof parameters.internalStrokeColor === "undefined" ? "#330000" : parameters.internalStrokeColor);
    var externalLineWidth = (typeof parameters.externalLineWidth === "undefined" ? 2 : parameters.externalLineWidth);
    var externalStrokeColor = (typeof parameters.externalStrokeColor === "undefined" ? "#800000" : parameters.externalStrokeColor);
    var autoReturnToCenter = (typeof parameters.autoReturnToCenter === "undefined" ? true : parameters.autoReturnToCenter);

    callback = callback || function () {};

    var canvas = document.getElementById("myCanvas");
    if (!canvas) {
        throw new Error("JoyStick: canvas not found for container/id: " + container);
    }

    canvas.id = title;
    canvas.width = width;
    canvas.height = height;

    var context = canvas.getContext("2d");
    var pressed = 0;
    var circumference = 2 * Math.PI;

    // Geometry
    var centerX = 200;
    var centerY = canvas.height-350;
    var externalRadius = Math.min(canvas.width, canvas.height) * 0.30;
    var internalRadius = externalRadius * 0.50;
    var maxMoveStick = externalRadius - internalRadius;

    var directionHorizontalLimitPos = maxMoveStick * 0.35;
    var directionHorizontalLimitNeg = -directionHorizontalLimitPos;
    var directionVerticalLimitPos = maxMoveStick * 0.35;
    var directionVerticalLimitNeg = -directionVerticalLimitPos;

    var movedX = centerX;
    var movedY = centerY;
    var activeTouchId = null;

    function getCanvasPos(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
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

    function redraw() {
       // context.clearRect(0, 0, canvas.width, canvas.height);
        drawExternal();
        drawInternal();
    }

    function updateStatus() {
        StickStatus.xPosition = movedX;
        StickStatus.yPosition = movedY;
        StickStatus.x = Math.round(((movedX - centerX) / maxMoveStick) * 100);
        StickStatus.y = Math.round((((movedY - centerY) / maxMoveStick) * -100));
        StickStatus.cardinalDirection = getCardinalDirection();
        callback(StickStatus);
    }

    function resetStick() {
        movedX = centerX;
        movedY = centerY;
        redraw();
        updateStatus();
    }

    function drawExternal() {
        context.beginPath();
        context.arc(centerX, centerY, externalRadius, 0, circumference, false);
        context.lineWidth = externalLineWidth;
        context.strokeStyle = externalStrokeColor;
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
        context.lineWidth = internalLineWidth;
        context.strokeStyle = internalStrokeColor;
        context.stroke();
    }

    function getCardinalDirection() {
        let result = "";
        let horizontal = movedX - centerX;
        let vertical = movedY - centerY;

        if (vertical >= directionVerticalLimitNeg && vertical <= directionVerticalLimitPos) {
            result = "C";
        }
        if (vertical < directionVerticalLimitNeg) {
            result = "N";
        }
        if (vertical > directionVerticalLimitPos) {
            result = "S";
        }

        if (horizontal < directionHorizontalLimitNeg) {
            result = (result === "C") ? "W" : result + "W";
        }
        if (horizontal > directionHorizontalLimitPos) {
            result = (result === "C") ? "E" : result + "E";
        }

        return result;
    }

    function isInsideActivationZone(pos) {
        const dx = pos.x - centerX;
        const dy = pos.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= externalRadius + internalRadius + 30;
    }

    function onTouchStart(event) {
        for (let i = 0; i < event.changedTouches.length; i++) {
            const t = event.changedTouches[i];
            const pos = getCanvasPos(t.clientX, t.clientY);

            if (isInsideActivationZone(pos)) {
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

    if ("ontouchstart" in document.documentElement) {
        canvas.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: true });
        document.addEventListener("touchend", onTouchEnd, { passive: true });
        document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    } else {
        canvas.addEventListener("mousedown", onMouseDown, false);
        document.addEventListener("mousemove", onMouseMove, false);
        document.addEventListener("mouseup", onMouseUp, false);
    }

    redraw();
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
        return Math.round(((movedX - centerX) / maxMoveStick) * 100);
    };

    this.GetY = function () {
        return Math.round((((movedY - centerY) / maxMoveStick) * -100));
    };

    this.GetDir = function () {
        return getCardinalDirection();
    };
});
