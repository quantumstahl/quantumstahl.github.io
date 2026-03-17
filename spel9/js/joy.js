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

    // NEW
    var floating = (typeof parameters.floating === "undefined" ? true : parameters.floating);
    var floatingLeftZone = (typeof parameters.floatingLeftZone === "undefined" ? 0.45 : parameters.floatingLeftZone);

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
            defaultCenterY = canvas.height * 0.78;
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

    function isInsideActivationZone(pos) {
        const dx = pos.x - centerX;
        const dy = pos.y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= externalRadius + internalRadius + 30;
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
            centerY = clamp(pos.y, canvas.height * 0.62, canvas.height * 0.90);
        } else {
            centerX = clamp(pos.x, margin, canvas.width * 0.28);
            centerY = clamp(pos.y, canvas.height * 0.60, canvas.height * 0.92);
        }

        movedX = centerX;
        movedY = centerY;
        showBase = true;
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

    function redraw() {
        updateGeometry();
        updateDefaultCenter();
        
        if(centerX<300){centerX = defaultCenterX; centerY = defaultCenterY;}
        
        

        if (!floating) {
            drawExternal();
            drawInternal();
            return;
        }

       // if (!showBase) return;

        drawExternal();
        drawInternal();
    }

    function getCardinalDirection() {
        let result = "C";
        let horizontal = movedX - centerX;
        let vertical = movedY - centerY;

        if (vertical < directionVerticalLimitNeg) result = "N";
        else if (vertical > directionVerticalLimitPos) result = "S";

        if (horizontal < directionHorizontalLimitNeg) {
            result = (result === "C") ? "W" : result + "W";
        } else if (horizontal > directionHorizontalLimitPos) {
            result = (result === "C") ? "E" : result + "E";
        }

        return result;
    }

    function updateStatus() {
        let nx = 0;
        let ny = 0;

        if (maxMoveStick > 0) {
            nx = Math.round(((movedX - centerX) / maxMoveStick) * 100);
            ny = Math.round((((movedY - centerY) / maxMoveStick) * -100));
        }

        StickStatus.xPosition = movedX;
        StickStatus.yPosition = movedY;
        StickStatus.x = isFinite(nx) ? nx : 0;
        StickStatus.y = isFinite(ny) ? ny : 0;
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

    // Init
    updateGeometry();
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
        return Math.round(((movedX - centerX) / maxMoveStick) * 100) || 0;
    };

    this.GetY = function () {
        return Math.round((((movedY - centerY) / maxMoveStick) * -100)) || 0;
    };

    this.GetDir = function () {
        return getCardinalDirection();
    };
});