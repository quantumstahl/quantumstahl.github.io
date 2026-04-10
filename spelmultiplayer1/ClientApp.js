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
         // 🔥 DELAYA CONNECT


            this.connect();
            this.startInputLoop();

        
    }
    startInputLoop() {
        setInterval(() => this.sendInput(), 100);
    }
    sendInput() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "input",
            left: this.input2.left,
            right: this.input2.right,
            up: this.input2.up,
            down: this.input2.down
        }));
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
        this.ws = new WebSocket("wss://game.quantumstahl.com");
       // const host = window.location.hostname;
       // this.ws = new WebSocket(`ws://${host}:3000`);
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
        };
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

        for (const e of updates) {
            const obj = world.entitiesById.get(e.id);
            if (!obj) continue;

            obj.serverX = e.x;
            obj.serverY = e.y;

            if (e.r !== undefined) obj.r = e.r;
            if (e.hp !== undefined) obj.hp = e.hp;
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
            return;
        }

        if (!clicked.selectable) {
            this.deselectAll();
            return;
        }

     

        this.deselectAll();
        clicked.selected = true;
    }

    handleDragSelect(rect) {
        this.deselectAll();

        for (const ent of this.getAllEntities()) {
 
            
            const cx = ent.x + ent.w / 2;
            const cy = ent.y + ent.h / 2;

            const overlaps =
                cx >= rect.x1 &&
                cx <= rect.x2 &&
                cy >= rect.y1 &&
                cy <= rect.y2;

            if (overlaps) {
                
                ent.selected = true;
            }
        }
        
    }
    applyPrediction(obj) {
        const speed = 3;

        obj.vx = 0;
        obj.vy = 0;

        if (this.input2.left) obj.vx -= speed;
        if (this.input2.right) obj.vx += speed;
        if (this.input2.up) obj.vy -= speed;
        if (this.input2.down) obj.vy += speed;

        obj.x += obj.vx;
        obj.y += obj.vy;

        
    }

    smooth(obj) {
        if (obj.serverX == null || obj.serverY == null) return;

        const lerp = 0.2;
        obj.x += (obj.serverX - obj.x) * lerp;
        obj.y += (obj.serverY - obj.y) * lerp;
    }

    correct(obj) {
        if (obj.serverX == null || obj.serverY == null) return;

        const dx = obj.serverX - obj.x;
        const dy = obj.serverY - obj.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 20) {
            obj.x = obj.serverX;
            obj.y = obj.serverY;
        } else {
            obj.x += dx * 0.2;
            obj.y += dy * 0.2;
        }
    }
    handlePointerRightDown(worldX, worldY) {
        const selected = this.getSelectedMovableEntities();
        if (selected.length === 0) return;

        this.sendMoveCommand(selected, worldX, worldY);
    }

    handleTouchCommand(worldX, worldY) {
        const selected = this.getSelectedMovableEntities();
        if (selected.length === 0) return;

        this.sendMoveCommand(selected, worldX, worldY);
    }

    sendMoveCommand(entities, x, y) {
        const entityIds = entities.map(e => e.id);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: "move_command",
                entityIds,
                x,
                y
            }));
        }

        // Enkel client prediction
        for (const ent of entities) {
            ent.targetX = x;
            ent.targetY = y;
        }
    }

    handlePan(dx, dy, scale = 1) {
        const currentMap = this.game.maps[this.game.currentmap];

        currentMap.camerax += dx * scale;
        currentMap.cameray += dy * scale;

        if (currentMap.cameray > 800) currentMap.cameray = 800;
        if (currentMap.cameray < -2200) currentMap.cameray = -2200;
        if (currentMap.camerax > 200) currentMap.camerax = 200;

        const minCamX = -6000;
        if (currentMap.camerax < minCamX) currentMap.camerax = minCamX;
    }

   update(scale) {
        const world = this.game.world;
        if (!world) return;

        for (const obj of world.dynamic) {
            if (obj.id === this.myId) {
                this.applyPrediction(obj);
                this.correct(obj);
                
            } else {
                this.smooth(obj);
            }
        }
        this.game.updateSolver();
        
        
        const camSpeed = 15*scale;
        const currentMap = this.game.maps[this.game.currentmap];
       // if (this.input2.up) if(currentMap.cameray<800)currentMap.cameray += camSpeed;
      //  if (this.input2.down) if(currentMap.cameray>-2200)currentMap.cameray -= camSpeed;
      //  if (this.input2.left) if(currentMap.camerax<200)currentMap.camerax += camSpeed;
      //  if (this.input2.right) if(currentMap.camerax>-6000)currentMap.camerax -= camSpeed;
        
        
        
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