const isMobile = {
    Android: function() { return navigator.userAgent.match(/Android/i); },
    BlackBerry: function() { return navigator.userAgent.match(/BlackBerry/i); },
    iOS: function() { return navigator.userAgent.match(/iPhone|iPod/i); },
    Opera: function() { return navigator.userAgent.match(/Opera Mini/i); },
    Windows: function() { return navigator.userAgent.match(/IEMobile/i) || navigator.userAgent.match(/WPDesktop/i); },
    any: function() {
        return (
            isMobile.Android() ||
            isMobile.BlackBerry() ||
            isMobile.iOS() ||
            isMobile.Opera() ||
            isMobile.Windows() ||
            (navigator.userAgent.toLowerCase().indexOf("macintosh") > -1 &&
             navigator.maxTouchPoints &&
             navigator.maxTouchPoints > 1)
        );
    }
};

function mobileAndTabletCheck() {
    return isMobile.any();
}


class ClientApp {
    constructor() {
        this.game = new GameClient(); 
        this.ws = null;
        this.myId = null;
        this.dragSelectStart = null;
        this.dragSelectEnd = null;
        this.input = new InputManager(this,this.game);
        this.input2 = {
            left: false,
            right: false,
            up: false,
            down: false
        };
        this.lastTime = 0;
    }
    async init() {
        await this.game.loadGame(); // 🔥 laddar map + world
        this.setupInput();
        requestAnimationFrame((t) => this.gameLoop(t));
        this.connect();
    }

    // ---------------- NETWORK ----------------
    handleServerMessage(data) {
        if (data.type === "init") {
            this.myId = data.id;
            console.log("My ID:", this.myId);
            return;
        }

        if (data.type === "state") {
            this.applyServerState(data);
        }
    }
    connect() {
        //this.ws = new WebSocket("wss://game.quantumstahl.com");
        this.ws = new WebSocket(`ws://${window.location.hostname}:3000`);
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
            
        };
    }
    sendSelectCommand(entityIds) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "select_command",
            entityIds
        }));
    }
    sendMoveCommand(x, y) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: "move_command",
                x,
                y
            }));
        }
    }

    setupInput() {
        window.addEventListener("keydown", (e) => {
            if (e.key === "a" || e.key === "ArrowLeft") this.input2.left = true;
            if (e.key === "d" || e.key === "ArrowRight") this.input2.right = true;
            if (e.key === "w" || e.key === "ArrowUp") this.input2.up = true;
            if (e.key === "s" || e.key === "ArrowDown") this.input2.down = true;
        });

        window.addEventListener("keyup", (e) => {
            if (e.key === "a" || e.key === "ArrowLeft") this.input2.left = false;
            if (e.key === "d" || e.key === "ArrowRight") this.input2.right = false;
            if (e.key === "w" || e.key === "ArrowUp") this.input2.up = false;
            if (e.key === "s" || e.key === "ArrowDown") this.input2.down = false;
        });
    }
    
    
    applyServerState(data) {
        this.applyServerSpawns(data.spawn || []);
        this.applyServerUpdates(data.update || []);
        this.applyServerRemoves(data.remove || []);
    }
    applyServerSpawns(spawns) {
        const world = this.game.world;

        for (const e of spawns) {
            let obj = world.entitiesById.get(e.id);

            if (!obj) {
                obj = this.game.addObject(
                    e.x,
                    e.y,
                    e.w,
                    e.h,
                    e.r || 0,
                    e.flipped || false,
                    e.kind || "dynamic",
                    e.type || "hus"
                );

                const oldId = obj.id;
                obj.id = e.id;

                world.entitiesById.delete(oldId);
                world.entitiesById.set(obj.id, obj);
            }

            obj.x = e.x;
            obj.y = e.y;

            obj.serverX = e.x;
            obj.serverY = e.y;

            obj.renderX = e.x;
            obj.renderY = e.y;

            obj.snapshots = obj.snapshots || [];
            obj.netKind = "active";

            obj.w = e.w;
            obj.h = e.h;
            obj.r = e.r || 0;
            obj.kind = e.kind || "dynamic";
            obj.type = e.type || obj.type;
            obj.flipped = e.flipped || false;
            obj.hp = e.hp ?? obj.hp;
        }
    }
    applyServerUpdates(updates) {
        const world = this.game.world;
        const now = performance.now();

        for (const e of updates) {
            const obj = world.entitiesById.get(e.id);
            if (!obj) continue;

            obj.x = e.x;
            obj.y = e.y;
            obj.direction=e.dir;
            obj.snapshots = obj.snapshots || [];
            obj.snapshots.push({
                time: now,
                x: e.x,
                y: e.y
            });

            if (obj.snapshots.length > 20) {
                obj.snapshots.shift();
            }

            if (e.r !== undefined) obj.r = e.r;
            if (e.hp !== undefined) obj.hp = e.hp;
        }
    }

    interpolateObject(obj, renderTime) {
        if (!obj.snapshots || obj.snapshots.length === 0) {
            if (obj.serverX != null) obj.renderX = obj.serverX;
            if (obj.serverY != null) obj.renderY = obj.serverY;
            return;
        }

        const snaps = obj.snapshots;

        while (snaps.length >= 2 && snaps[1].time <= renderTime) {
            snaps.shift();
        }

        if (snaps.length === 1) {
            obj.renderX = snaps[0].x;
            obj.renderY = snaps[0].y;
            return;
        }

        const a = snaps[0];
        const b = snaps[1];

        const span = b.time - a.time;
        let alpha = 0;

        if (span > 0) {
            alpha = (renderTime - a.time) / span;
        }

        if (alpha < 0) alpha = 0;
        if (alpha > 1) alpha = 1;

        obj.renderX = a.x + (b.x - a.x) * alpha;
        obj.renderY = a.y + (b.y - a.y) * alpha;
    }

    updateNetworkRendering() {
        const renderDelay = 100;
        const renderTime = performance.now() - renderDelay;

        const world = this.game.world;
        if (!world) return;

        for (const obj of world.dynamic) {

                this.interpolateObject(obj, renderTime);

        }
    }
    applyServerRemoves(removes) {
        for (const id of removes) {
            this.game.removeObject(id);
        }
    }
    getAllEntities() {
        return this.game.world.selectable;
    }

    getMyEntities() {
        return this.getAllEntities().filter(e => e.ownerId === this.myId);
    }

    getSelectedEntities() {
        return this.getAllEntities().filter(e => e.selected);
    }

    getSelectedMovableEntities() {
        return this.getAllEntities().filter(e =>
            e.selected
        );
    }

    deselectAll() {
        for (const e of this.getAllEntities()) {
            e.selected = false;
        }
    }

    getEntityAt(worldX, worldY) {
        const entities = this.getAllEntities();

        for (let i = entities.length - 1; i >= 0; i--) {
            const ent = entities[i];
            if (this.containsPoint(ent,worldX, worldY)) {
                return ent;
            }
        }

        return null;
    }
    containsPoint(ent, worldX, worldY) {
        const x = ent.x ;
        const y = ent.y ;
        const w = ent.w ;
        const h = ent.h ;
        const r = (ent.r ?? 0) * Math.PI / 180;

        if (!r) {
            return (
                worldX >= x &&
                worldX <= x + w &&
                worldY >= y &&
                worldY <= y + h
            );
        }

        const cx = x + w / 2;
        const cy = y + h / 2;

        const dx = worldX - cx;
        const dy = worldY - cy;

        const cos = Math.cos(-r);
        const sin = Math.sin(-r);

        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        return (
            localX >= -w / 2 &&
            localX <=  w / 2 &&
            localY >= -h / 2 &&
            localY <=  h / 2
        );
    }
    handlePointerLeftDown(worldX, worldY) {
        const clicked = this.getEntityAt(worldX, worldY);

        if (!clicked) {
            this.deselectAll();
            this.sendSelectCommand([]);
            return;
        }

        if (!clicked.selectable ) {
            this.deselectAll();
            this.sendSelectCommand([]);
            return;
        }

        this.deselectAll();
        clicked.selected = true;
        this.sendSelectCommand([clicked.id]);
    }

    handleDragSelect(rect) {
    this.deselectAll();

    const selectedIds = [];

    for (const ent of this.getAllEntities()) {
        const cx = (ent.renderX ?? ent.x) + ent.w / 2;
        const cy = (ent.renderY ?? ent.y) + ent.h / 2;

        const overlaps =
            cx >= rect.x1 &&
            cx <= rect.x2 &&
            cy >= rect.y1 &&
            cy <= rect.y2;

        if (overlaps) {
            ent.selected = true;
            selectedIds.push(ent.id);
        }
    }

    this.sendSelectCommand(selectedIds);
}



    handlePointerRightDown(worldX, worldY) {
        const selected = this.getSelectedEntities();
        if (selected.length === 0) return;

        this.sendMoveCommand(worldX, worldY);

        for (const ent of selected) {
            ent.targetX = worldX;
            ent.targetY = worldY;
        }
    }

    handleTouchCommand(worldX, worldY) {
        const selected = this.getSelectedMovableEntities();
        if (selected.length === 0) return;

        this.sendMoveCommand(selected, worldX, worldY);
    }

    sendMoveCommand(x, y) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

            this.ws.send(JSON.stringify({
                type: "move_command",
                x: Number(x),
                y: Number(y)
            }));
        }

    handlePan(dx, dy, scale = 1) {
        const currentMap = this.game.maps[this.game.currentmap];

        currentMap.camerax += dx * scale;
        currentMap.cameray += dy * scale;

        if (currentMap.cameray > 800) currentMap.cameray = 800;
        if (currentMap.cameray < -2200) currentMap.cameray = -2200;
        if (currentMap.camerax > 200) currentMap.camerax = 200;
        if (currentMap.camerax < -6000) currentMap.camerax = -6000;
    }

update(scale) {


    const camSpeed = 15*scale; 
    const currentMap = this.game.maps[this.game.currentmap]; 
    if (this.input2.up) if(currentMap.cameray<800)currentMap.cameray += camSpeed;
    if (this.input2.down) if(currentMap.cameray>-2200)currentMap.cameray -= camSpeed;
    if (this.input2.left) if(currentMap.camerax<200)currentMap.camerax += camSpeed; 
    if (this.input2.right) if(currentMap.camerax>-6000)currentMap.camerax -= camSpeed;
    
    
    
    this.updateNetworkRendering();
}

    draw(scale) {
       
        this.updateCanvasSize();
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.game.draw(scale);
       
      
        
        ctx.save();
        ctx.scale(this.game.getZoom(), this.game.getZoom());
        ctx.translate(this.game.getCameraX(), this.game.getCameraY());

    

        if (this.dragSelectStart && this.dragSelectEnd) {
            
            const x = Math.min(this.dragSelectStart.x, this.dragSelectEnd.x);
            const y = Math.min(this.dragSelectStart.y, this.dragSelectEnd.y);
            const w = Math.abs(this.dragSelectEnd.x - this.dragSelectStart.x);
            const h = Math.abs(this.dragSelectEnd.y - this.dragSelectStart.y);
            ctx.strokeRect(x, y, w, h);
        }

        ctx.restore();
    }

    gameLoop(time) {
        if (!this.lastTime) this.lastTime = time;

        let deltaMs = time - this.lastTime;
        this.lastTime = time;

        if (deltaMs > 50) deltaMs = 50;

        const scale = deltaMs / (1000 / 60);

        this.update(scale);
        this.draw(scale);

        requestAnimationFrame((t) => this.gameLoop(t));
    }
    updateCanvasSize() {
        if (!mobileAndTabletCheck()) {
            if (canvas.style.width === document.body.clientWidth + "px") return;
            
            canvas.width = 1920 * 1.25;
            canvas.height = 1080 * 1.25;
            canvas.style.position = "absolute";
            canvas.style.width = window.innerWidth + "px";
            canvas.style.height = window.innerHeight + "px";
     
        } else {
            if (canvas.style.width === document.body.clientWidth + "px") return;

            if (window.innerHeight > window.innerWidth) {
                canvas.width = 1100;
                canvas.height = 1600;
            } else {
                canvas.width = 1600 * 1.2;
                canvas.height = 1100 * 1.2;
            }

            canvas.style.position = "absolute";
            canvas.style.width = document.body.clientWidth + "px";
            canvas.style.height = document.body.clientHeight + "px";
        }
    }
    
    
    
}


