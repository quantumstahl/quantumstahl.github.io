class ClientApp {
    constructor() {
        this.ws = null;
        this.game = new GameClient(); 
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
        this.leftclicked=false;
        this.latestPacketTime = null;
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
            this.game.maps[this.game.currentmap].camerax=data.cx+500;
            this.game.maps[this.game.currentmap].cameray=data.cy+500;
            this.applyServerState(data.data);
            console.log("My ID:", this.myId);
            return;
        }
        else this.applyServerState2(data);
        
    }
    handleBinaryXY(buffer) {
        const view = new DataView(buffer);

        const type = view.getUint8(0);
        if (type !== 3) return;

        const packetTime = view.getUint16(1, true);

        for (let offset = 3; offset + 5 < view.byteLength; offset += 6) {
            const id = view.getInt16(offset + 0, true);
            const x  = view.getInt16(offset + 2, true);
            const y  = view.getInt16(offset + 4, true);

            const obj = this.game.world.entitiesById.get(id);
            if (!obj) continue;

            obj.x = x;
            obj.y = y;

            obj.snapshots ||= [];
            obj.snapshots.push({
                time: packetTime,
                x,
                y
            });

            if (obj.snapshots.length > 10) {
                obj.snapshots.shift();
            }

            if (obj.renderX == null) obj.renderX = x;
            if (obj.renderY == null) obj.renderY = y;
        }

        this.latestPacketTime = packetTime;
        this.latestArrivalTime = performance.now();
    }
    handleBinaryState(buffer) {
        const view = new DataView(buffer);

        for (let off = 1; off < view.byteLength; off += 22) {
            const id = view.getUint16(off + 0, true);
            const hp = view.getUint16(off + 2, true);
            const maxHp = view.getUint16(off + 4, true);
            const r = view.getInt16(off + 6, true);
            const dir=view.getUint8(off + 8, true);
            const ani=view.getUint8(off + 9, true);
            const carry=view.getUint8(off + 10, true);
            const owner=view.getUint8(off + 11, true);
            const trainingQueue=view.getUint8(off + 12, true);
            const trainingTimer=view.getUint8(off + 13, true);
            const trainingTimeMax=view.getUint8(off + 14, true);
            const flashTimer=view.getUint8(off + 15, true);
            const buildProgress=(view.getUint8(off + 16, true))/100;
            const rallyPointX = view.getInt16(off + 17, true);
            const rallyPointY = view.getInt16(off + 19, true);
            const rallymode=view.getUint8(off + 21, true);
            const obj = this.game.world.entitiesById.get(id);
            if (!obj) continue;

            obj.hp = hp;
            obj.maxHp = maxHp;
            obj.r = r;
            if(dir===0)obj.direction="up";
            if(dir===1)obj.direction="right";
            if(dir===2)obj.direction="down";
            if(dir===3)obj.direction="left";
            obj.ani=ani;
            obj.carry=carry;
            obj.owner=owner;
            obj.trainingQueue=trainingQueue;
            obj.trainingTimer=trainingTimer*4;
            obj.trainingTimeMax=trainingTimeMax*4;
            obj.flashTimer=flashTimer;
            obj.buildProgress=buildProgress;
            
            if(rallyPointX!==32767){
                
                if(!obj.rallyPoint){
                    obj.rallyPoint = {
                    x: rallyPointX,
                    y: rallyPointY,
                    mode: rallymode};
                }
                else{
                    obj.rallyPoint.x=rallyPointX;
                    obj.rallyPoint.y=rallyPointY;
                    obj.rallyPoint.mode=rallymode;
                    
                }
            }
            
            
        }
    }
    handleBinaryRemove(buffer) {
        const view = new DataView(buffer);

        for (let off = 1; off < view.byteLength; off += 2) {
            const id = view.getUint16(off, true);
            this.game.removeObject(id);

        }
    }
    handleBinaryResources(buffer){
        const view = new DataView(buffer);
        for (let off = 1; off < view.byteLength; off += 10) {
            const gold = view.getUint16(off+0, true);
            const wood = view.getUint16(off+2, true);
            const stone = view.getUint16(off+4, true);
            const food = view.getUint16(off+6, true);
            const pop = view.getUint8(off+8, true);
            const popMax = view.getUint8(off+9, true);
            
            this.game.playerResources.gold=gold;
            this.game.playerResources.wood=wood;
            this.game.playerResources.stone=stone;
            this.game.playerResources.food=food;
            this.game.playerResources.pop=pop;
            this.game.playerResources.popMax=popMax;
            
            
        }
        
        
    }
    
    
    connect() {
        this.ws = new WebSocket("wss://game.quantumstahl.com");
       // this.ws = new WebSocket(`ws://${window.location.hostname}:3000`);
        this.game.setWS(this.ws);
        this.ws.binaryType = "arraybuffer";

        this.ws.onmessage = (event) => {
            if (typeof event.data === "string") {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data);
                return;
            }

            if (event.data instanceof ArrayBuffer) {
                 const view = new DataView(event.data);
                 const type = view.getUint8(0);
                 if(type===0) this.handleBinaryState(event.data);
                 else if(type===1)this.handleBinaryRemove(event.data);
                 else if(type===2)this.handleBinaryResources(event.data);
                 else if(type===3)this.handleBinaryXY(event.data);

                
                return;
            }

            console.log("Unknown websocket message:", event.data);
        };
    }
    sendSelectCommand(entityIds) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "select_command",
            entityIds
        }));
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
    applyServerState2(data){
        this.applyServerSpawns(data.spawn || []);
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
                
                if(obj.isBuilding){obj.buildProgress=0.0001;}
                
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
            
            
            
            if(e.buildProgress>=0.0001)obj.buildProgress=e.buildProgress;
            obj.x=e.x;
            obj.y=e.y;
            obj.flashTimer=e.flashTimer;
            obj.trainingTimer=e.trainingTimer;
            obj.trainingTimeMax=e.trainingTimeMax;
            obj.trainingQueue=e.trainingQueue;
            obj.owner=e.owner;
            obj.direction=e.dir;
            obj.ani=e.ani;
            obj.carry=e.carry;
            obj.r = e.r;
            obj.hp = e.hp;
        }
    }
    diff16(a, b) {
        let d = a - b;
        if (d > 32768) d -= 65536;
        if (d < -32768) d += 65536;
        return d;
    }
    sub16(a, b) {
        return (a - b + 65536) & 0xFFFF;
    }
    interpolateObject(obj, renderTime) {
        if (!obj.snapshots || obj.snapshots.length === 0) {
            if (obj.serverX != null) obj.renderX = obj.serverX;
            if (obj.serverY != null) obj.renderY = obj.serverY;
            return;
        }

        const snaps = obj.snapshots;

        while (snaps.length >= 2 && this.diff16(renderTime, snaps[1].time) >= 0) {
            snaps.shift();
        }

        if (snaps.length === 1) {
            obj.renderX = snaps[0].x;
            obj.renderY = snaps[0].y;
            return;
        }

        const a = snaps[0];
        const b = snaps[1];

        const span = this.diff16(b.time, a.time);
        let alpha = 0;

        if (span > 0) {
            alpha = this.diff16(renderTime, a.time) / span;
        }

        if (alpha < 0) alpha = 0;
        if (alpha > 1) alpha = 1;

        obj.renderX = a.x + (b.x - a.x) * alpha;
        obj.renderY = a.y + (b.y - a.y) * alpha;
    }

    updateNetworkRendering() {
        const renderDelay = 150;

        if (this.latestPacketTime == null || this.latestArrivalTime == null) return;

        const elapsed = Math.floor(performance.now() - this.latestArrivalTime);
        const estimatedServerNow = (this.latestPacketTime + elapsed) & 0xFFFF;
        const renderTime = (estimatedServerNow - renderDelay + 65536) & 0xFFFF;

        const world = this.game.world;
        if (!world) return;

        for (const obj of world.entities) {
            this.interpolateObject(obj, renderTime);
        }
    }
    applyServerRemoves(removes) {
        for (const id of removes) {
            this.game.removeObject(id);
        }
    }
    getAllEntities() {
        
        
        return this.game.world.selectable.filter(e => e.selectable === true);
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
        const isMobile = mobileAndTabletCheck();
        const pickRadius = 100;

        let best = null;
        let bestDist = Infinity;

        for (let i = entities.length - 1; i >= 0; i--) {
            const ent = entities[i];

            if (this.containsPoint(ent, worldX, worldY)) {
                return ent;
            }

            if (isMobile) {
              
                const cx = ent.x + ent.w / 2;
                const cy = ent.y + ent.h / 2;
                const dx = worldX - cx;
                const dy = worldY - cy;
                const dist = Math.hypot(dx, dy);

                if (dist < pickRadius && dist < bestDist) {
                    best = ent;
                    bestDist = dist;
                }
            }
        }

        return best;
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
        this.leftclicked=true;
        if(this.game.UISIZE()||this.game.buildMode)return;
        this.deselectAll();
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

        
        clicked.selected = true;
        this.sendSelectCommand([clicked.id]);
    }

    handleDragSelect(rect) {
        if (this.game.UISIZE() || this.game.buildMode) return;

        this.deselectAll();

        const overlapped = [];

        for (const ent of this.getAllEntities()) {
            const ex = (ent.renderX ?? ent.x);
            const ey = (ent.renderY ?? ent.y);

            const overlaps =
                ex < rect.x2 &&
                ex + ent.w > rect.x1 &&
                ey < rect.y2 &&
                ey + ent.h > rect.y1;

            if (overlaps && ent.selectable) {
                overlapped.push(ent);
            }
        }

        // 1. bara dina egna
        const myId = this.myId; // eller this.app.myId beroende på din struktur
        const mine = overlapped.filter(ent => ent.owner === myId);

   


        // fallback: om inga egna finns, använd alla
        const base = mine.length > 0 ? mine : overlapped;

        // 2. prioritera dynamic (units)
        const dynamic = base.filter(ent => ent.kind === "dynamic");

        const finalSelection = dynamic.length > 0 ? dynamic : base;

        const selectedIds = [];

        for (const ent of finalSelection) {
            ent.selected = true;
            selectedIds.push(ent.id);
        }

        this.sendSelectCommand(selectedIds);
    }
    handlePointerRightDown(worldX, worldY) {
        if(this.game.buildMode){
            this.game.buildMode = null;
            this.game.buildSelectedIds = [];
            this.game.bildModew=0;
            this.game.bildModeh=0;
            return;
        }
        const selected = this.getSelectedEntities();
        if (selected.length === 0) return;

        const clicked = this.getEntityAt(worldX, worldY);

        this.sendRightClickCommand(worldX, worldY, clicked ? clicked.id : null);

        for (const ent of selected) {
            ent.targetX = worldX;
            ent.targetY = worldY;
        }
    }

    handleTouchCommand(worldX, worldY) {
        this.leftclicked=true;
        if(this.game.UISIZE()||this.game.buildMode)return;
        const selected = this.getSelectedEntities();
        if (selected.length === 0) return;
        
        const isbuilding=selected[0].isBuilding;
        
        const clicked = this.getEntityAt(worldX, worldY);

        this.sendRightClickCommand(worldX, worldY, clicked ? clicked.id : null);
        if(clicked&&!isbuilding){this.deselectAll();if(clicked.owner===this.myId)clicked.selected=true;}
        
        
        
        
        
        
        
        
        
        
        for (const ent of selected) {
            ent.targetX = worldX;
            ent.targetY = worldY;
        }
    }

    sendRightClickCommand(x, y, targetId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "right_click_command",
            x: Number(x),
            y: Number(y),
            targetId: targetId ?? null
        }));
    }
    handlePan(dx, dy, scale = 1) {
        const currentMap = this.game.maps[this.game.currentmap];

        currentMap.camerax += dx * scale;
        currentMap.cameray += dy * scale;

        if (currentMap.cameray > 800) currentMap.cameray = 800;
        if (currentMap.cameray < -2200) currentMap.cameray = -2200;
        if (currentMap.camerax > 200) currentMap.camerax = 200;
        if(currentMap.camerax<=-6000-2400+canvas.width)currentMap.camerax=-6000-2400+canvas.width;
    }

update(scale) {


    const camSpeed = 15*scale; 
    const currentMap = this.game.maps[this.game.currentmap]; 
    if (this.input2.up) if(currentMap.cameray<800)currentMap.cameray += camSpeed;
    if (this.input2.down) if(currentMap.cameray>-2200)currentMap.cameray -= camSpeed;
    if (this.input2.left) if(currentMap.camerax<200)currentMap.camerax += camSpeed; 
    if (this.input2.right) if(currentMap.camerax>-6000)currentMap.camerax -= camSpeed;
    
    
    
   
}

    draw(scale) {
       
        this.updateCanvasSize();
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        this.updateNetworkRendering();
        this.game.draw(scale,this.getSelectedEntities(),this.myId,this.leftclicked,this);
       
        this.leftclicked=false;
        
        if(this.game.buildMode){
            if(this.canPlaceBuilding(this.game.cursorX-this.game.getCameraX()-this.game.bildModew/2, this.game.cursorY-this.game.getCameraY()-this.game.bildModeh/2,this.game.bildModew,this.game.bildModeh)===true){
                ctx.fillStyle="green";
                ctx.fillRect(this.game.cursorX-this.game.bildModew/2-1,this.game.cursorY-this.game.bildModeh/2-1,this.game.bildModew+2,this.game.bildModeh+2);
                
                
            }
            else{
                ctx.fillStyle="red";
                ctx.fillRect(this.game.cursorX-this.game.bildModew/2-1,this.game.cursorY-this.game.bildModeh/2-1,this.game.bildModew+2,this.game.bildModeh+2);
                
            }
            ctx.drawImage(this.game.getObjectType(this.game.buildMode).sprites[0].getimage(),this.game.cursorX-this.game.bildModew/2,this.game.cursorY-this.game.bildModeh/2,this.game.bildModew,this.game.bildModeh );
            
        }
        
        
        
        ctx.save();
        ctx.scale(this.game.getZoom(), this.game.getZoom());
        ctx.translate(this.game.getCameraX(), this.game.getCameraY());
        ctx.strokeStyle = "lime";
    

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
            const screenW = window.innerWidth;
            const screenH = window.innerHeight;
            if (this.lastCanvasScreenW === screenW && this.lastCanvasScreenH === screenH) {return;}
            this.lastCanvasScreenW = screenW;
            this.lastCanvasScreenH = screenH;
            
            canvas.width = 1920 * 1.25;
            canvas.height = 1080 * 1.25;
            canvas.style.position = "absolute";
            canvas.style.width = window.innerWidth + "px";
            canvas.style.height = window.innerHeight + "px";
     
        } else {
            const screenW = window.innerWidth;
            const screenH = window.innerHeight;
            if (this.lastCanvasScreenW === screenW && this.lastCanvasScreenH === screenH) {return;}
            this.lastCanvasScreenW = screenW;
            this.lastCanvasScreenH = screenH;

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
    canPlaceBuilding(x, y, w, h) {
        const all = this.game.world.entities;

        for (const o of all) {
            if (!o) continue;
            if (o.dead && !o.amount) continue;

            const blocksPlacement =
                o.isBuilding ||
                o.type === "tree" ||
                o.type === "gold" ||
                o.type === "stone" ||
                o.type === "river" ||
                o.type === "berry" ||
                o.type === "sheep" ||
                o.type === "boar" ||
                (o.type.includes("worker")&&o.hp>0) ||
                (o.type.includes("warrior")&&o.hp>0);

            if (!blocksPlacement) continue;

            if (this.rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h)) {
                return false;
            }
        }

        return true;
    }
    rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, pad = 0) {
        return (
            ax < bx + bw + pad &&
            ax + aw > bx - pad &&
            ay < by + bh + pad &&
            ay + ah > by - pad
        );
    }
    
    
}


