class InputManager {
    constructor(app,game) {
        this.app=app;
        this.game=game;
        this.cursorScreenX = 0;
        this.cursorScreenY = 0;

        this.dragStartWorld = null;
        this.dragEndWorld = null;
        this.dragMoved = false;

        this.lastPanCanvasX = null;
        this.lastPanCanvasY = null;

        this.tapTimeout = null;
        this.allowSingleTap = false;

        this.bindEvents();
    }

    bindEvents() {
        canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
        canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
        canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        canvas.addEventListener("touchstart", (e) => this.onTouchStart(e), { passive: false });
        canvas.addEventListener("touchmove", (e) => this.onTouchMove(e), { passive: false });
        canvas.addEventListener("touchend", (e) => this.onTouchEnd(e), { passive: false });
    }

    getCanvasPos(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    getScreenPos(clientX, clientY) {
        const p = this.getCanvasPos(clientX, clientY);
        return {
            x: p.x / this.game.getZoom(),
            y: p.y / this.game.getZoom()
        };
    }

    getWorldPos(clientX, clientY) {
        const p = this.getScreenPos(clientX, clientY);
    
        return {
            x: p.x - this.game.getCameraX(),
            y: p.y - this.game.getCameraY()
        };
    }

    updateCursor(clientX, clientY) {
        const p = this.getScreenPos(clientX, clientY);
        this.cursorScreenX = p.x;
        this.cursorScreenY = p.y;
        this.game.cursorX = p.x;
        this.game.cursorY = p.y;
    }

    beginDrag(worldX, worldY) {
     
        this.dragStartWorld = { x: worldX, y: worldY };
        this.dragEndWorld = null;
        this.dragMoved = false;

        this.app.dragSelectStart = { x: worldX, y: worldY };
        this.app.dragSelectEnd = null;
    }

    updateDrag(worldX, worldY) {
        if (!this.dragStartWorld) return;

        this.dragEndWorld = { x: worldX, y: worldY };
        this.dragMoved = true;

        this.app.dragSelectEnd = { x: worldX, y: worldY };
    }

    clearDrag() {
        this.dragStartWorld = null;
        this.dragEndWorld = null;
        this.dragMoved = false;

        this.app.dragSelectStart = null;
        this.app.dragSelectEnd = null;
    }

    onMouseDown(e) {
        e.preventDefault();
        this.updateCursor(e.clientX, e.clientY);
    
        const world = this.getWorldPos(e.clientX, e.clientY);
  
        if (e.button === 0) {
            this.app.handlePointerLeftDown(world.x, world.y);
            this.beginDrag(world.x, world.y);
        } else if (e.button === 2) {
            this.app.handlePointerRightDown(world.x, world.y);
        }
    }

    onMouseMove(e) {
        this.updateCursor(e.clientX, e.clientY);

        if (this.dragStartWorld) {
            const world = this.getWorldPos(e.clientX, e.clientY);
            this.updateDrag(world.x, world.y);
        }
    }

    onMouseUp(e) {
        e.preventDefault();

        if (e.button === 0) {
            if (this.dragStartWorld && this.dragEndWorld && this.dragMoved) {
                this.app.handleDragSelect({
                    x1: Math.min(this.dragStartWorld.x, this.dragEndWorld.x),
                    y1: Math.min(this.dragStartWorld.y, this.dragEndWorld.y),
                    x2: Math.max(this.dragStartWorld.x, this.dragEndWorld.x),
                    y2: Math.max(this.dragStartWorld.y, this.dragEndWorld.y)
                });
            }

            this.clearDrag();
        }
    }

    onTouchStart(e) {
    e.preventDefault();

    if (e.touches.length === 1) {
        const t = e.touches[0];
        this.updateCursor(t.clientX, t.clientY);

        const world = this.getWorldPos(t.clientX, t.clientY);
        this.beginDrag(world.x, world.y);

        this.allowSingleTap = true;

        if (this.tapTimeout !== null) {
            clearTimeout(this.tapTimeout);
        }

        this.tapTimeout = setTimeout(() => {
            this.tapTimeout = null;
        }, 150);
    } else {
        this.allowSingleTap = false;

        if (this.tapTimeout !== null) {
            clearTimeout(this.tapTimeout);
            this.tapTimeout = null;
        }
    }

    if (e.touches.length === 2) {
        const p = this.getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
        this.lastPanCanvasX = p.x;
        this.lastPanCanvasY = p.y;
    }
}

    onTouchMove(e) {
        e.preventDefault();

        if (e.touches.length === 1 && this.dragStartWorld) {
            const t = e.touches[0];
            this.updateCursor(t.clientX, t.clientY);

            const world = this.getWorldPos(t.clientX, t.clientY);
            this.updateDrag(world.x, world.y);
        }

        if (e.touches.length === 2 && this.lastPanCanvasX !== null && this.lastPanCanvasY !== null) {
            const p = this.getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
            const dx = p.x - this.lastPanCanvasX;
            const dy = p.y - this.lastPanCanvasY;

            this.app.handlePan(dx, dy);

            this.lastPanCanvasX = p.x;
            this.lastPanCanvasY = p.y;
        }
    }

    onTouchEnd(e) {
    e.preventDefault();

    if (this.dragStartWorld && this.dragEndWorld && this.dragMoved) {
        this.app.handleDragSelect({
            x1: Math.min(this.dragStartWorld.x, this.dragEndWorld.x),
            y1: Math.min(this.dragStartWorld.y, this.dragEndWorld.y),
            x2: Math.max(this.dragStartWorld.x, this.dragEndWorld.x),
            y2: Math.max(this.dragStartWorld.y, this.dragEndWorld.y)
        });
        this.clearDrag();
    } else if (e.changedTouches.length === 1 && this.allowSingleTap) {
        const t = e.changedTouches[0];
        const world = this.getWorldPos(t.clientX, t.clientY);

        const clicked = this.app.getEntityAt(world.x, world.y);
        const selected = this.app.getSelectedMovableEntities();

        if (clicked && clicked.selectable) {
            this.app.handlePointerLeftDown(world.x, world.y);
        } else if (selected.length > 0) {
            this.app.handleTouchCommand(world.x, world.y);
        } else {
            this.app.deselectAll();
            this.app.sendSelectCommand([]);
        }

        this.clearDrag();
    } else {
        this.clearDrag();
    }

    if (e.touches.length < 2) {
        this.lastPanCanvasX = null;
        this.lastPanCanvasY = null;
    }
}
}