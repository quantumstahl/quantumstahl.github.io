class ClientApp {
    constructor() {
        this.ws = null;
        this.game = new GameClient();

        this.myId = null;
        this.playerName = localStorage.getItem("playerName") || "Player";
        this.roomId = "default";

        this.appState = "connecting";
        // "connecting" | "room_browser" | "lobby" | "starting" | "in_game"

        this.lobby = {
            roomId: null,
            players: [],
            settings: { map: "default" },
            started: false
        };

        this.dragSelectStart = null;
        this.dragSelectEnd = null;
        this.input = new InputManager(this, this.game);

        this.input2 = {
            left: false,
            right: false,
            up: false,
            down: false
        };

        this.lastTime = 0;
        this.leftclicked = false;
        this.latestPacketTime = null;
        
        this.playerName = localStorage.getItem("playerName") || "Player";
        this.nameInputActive = false;
        this.nameDraft = this.playerName;
        this.lobby = {
            roomId: null,
            players: [],
            settings: { map: "default" },
            started: false
        };

        this.roomList = [];
        this.gameOver = false;
        this.gameOverText = "";
        this.gameOverTime = 0;
        this.uiButtons = [];

    }
    async init() {
        await this.game.loadGame();
        this.setupInput();
        requestAnimationFrame((t) => this.gameLoop(t));
        this.connect();
    }

    // ---------------- NETWORK ----------------
    handleServerMessage(data) {
        if (data.type === "connected") return;

        if (data.type === "hello_ok") {
            this.myId = data.playerId;
            this.playerName = data.playerName;
            this.appState = "room_browser";
            return;
        }

        if (data.type === "room_list") {
            this.roomList = data.rooms || [];

            if (!this.lobby.roomId) {
                this.appState = "room_browser";
            }

            return;
        }
        if (data.type === "match_ended") {
            const winner = data.winner;
            this.gameOverWinner = winner;

            if (winner === this.myId) this.gameOverText = "YOU WIN";
            else if (winner === 0) this.gameOverText = "DRAW";
            else this.gameOverText = "YOU LOSE";

            this.gameOver = true;
            this.gameOverTime = performance.now();
            this.appState = "game_over";
            return;
        }
        
        
        if (data.type === "lobby_state") {
            this.lobby.roomId = data.roomId;
            this.lobby.players = data.players || [];
            this.lobby.settings = data.settings || { map: "default" };
            this.lobby.started = !!data.started;

            if (!this.gameOver) {
                this.appState = this.lobby.started ? "starting" : "lobby";
            }

            return;
        }

        if (data.type === "left_room") {
            this.lobby = {
                roomId: null,
                players: [],
                settings: { map: "default" },
                started: false
            };

            this.appState = "room_browser";
            return;
        }

        if (data.type === "match_start") {
            this.gameOver = false;
            this.gameOverText = "";
            this.gameOverTime = 0;
            showPanHint();
            this.appState = "starting";
            return;
        }

        if (data.type === "init") {
            this.myId = data.id;
            this.game.maps[this.game.currentmap].camerax = data.cx + 500;
            this.game.maps[this.game.currentmap].cameray = data.cy + 500;
            this.applyServerState(data.data);
            this.appState = "in_game";
            return;
        }
        if(data.type === "spawn"){
            this.applyServerState2(data);
            
            return;
        }
        

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
                    mode: rallymode
                            };
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
        //this.ws = new WebSocket(`ws://${window.location.hostname}:3000`);
        this.game.setWS(this.ws);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            this.appState = "connecting";

            this.ws.send(JSON.stringify({
                type: "hello",
                name: this.playerName,
                roomId: this.roomId
            }));
        };

        this.ws.onmessage = (event) => {
            if (typeof event.data === "string") {
                const data = JSON.parse(event.data);
                this.handleServerMessage(data);
                return;
            }

            if (event.data instanceof ArrayBuffer) {
                if (this.appState !== "in_game") return;
                
        
                

                const view = new DataView(event.data);
                const type = view.getUint8(0);

                if (type === 0) this.handleBinaryState(event.data);
                else if (type === 1) this.handleBinaryRemove(event.data);
                else if (type === 2) this.handleBinaryResources(event.data);
                else if (type === 3) this.handleBinaryXY(event.data);

                return;
            }

            console.log("Unknown websocket message:", event.data);
        };

        this.ws.onclose = () => {
            console.log("Disconnected from server");
            this.appState = "connecting";
        };
    }
    sendSelectCommand(entityIds) {
        if (this.appState !== "in_game") return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "select_command",
            entityIds
        }));
    }
    setupInput() {
        window.addEventListener("keydown", (e) => {
            if (this.appState === "lobby") {
                if (this.nameInputActive) {
                    if (e.key === "Enter") {
                        this.playerName = this.nameDraft.trim().slice(0, 16) || "Player";
                        localStorage.setItem("playerName", this.playerName);
                        this.nameInputActive = false;
                        this.sendRename(this.playerName);
                        return;
                    }

                    if (e.key === "Escape") {
                        this.nameDraft = this.playerName;
                        this.nameInputActive = false;
                        return;
                    }

                    if (e.key === "Backspace") {
                        e.preventDefault();
                        this.nameDraft = this.nameDraft.slice(0, -1);
                        return;
                    }

                    if (e.key.length === 1 && this.nameDraft.length < 16) {
                        this.nameDraft += e.key;
                        return;
                    }

                    return;
                }
                if (e.key === "l" || e.key === "L") {
                    this.leaveRoom();
                    return;
                }

                if (e.key === "n" || e.key === "N") {
                    this.nameInputActive = true;
                    this.nameDraft = this.playerName;
                    return;
                }

                if (e.key === "r" || e.key === "R") {
                    const me = this.lobby.players.find(p => p.id === this.myId);
                    const currentReady = !!me?.ready;
                    this.setReady(!currentReady);
                    return;
                }
            }
            if (this.appState === "room_browser") {
                if (e.key === "c" || e.key === "C") {
                    const roomName = prompt("Room name:");
                    if (roomName) this.createRoom(roomName);
                    return;
                }

                if (e.key >= "1" && e.key <= "9") {
                    const idx = Number(e.key) - 1;
                    const room = this.roomList?.[idx];
                    if (room) this.joinRoom(room.id);
                    return;
                }

                if (e.key === "n" || e.key === "N") {
                    this.changeNamePrompt();
                    return;
                }
            }
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
            
            if(e.rallyPointX!==32767){
                
                if(!obj.rallyPoint){
                    obj.rallyPoint = {
                    x: e.rallyPointX,
                    y: e.rallyPointY,
                    mode: e.rallymode
                            };
                }
                else{
                    obj.rallyPoint.x=e.rallyPointX;
                    obj.rallyPoint.y=e.rallyPointY;
                    obj.rallyPoint.mode=e.rallymode;
                   
                }
            }  
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
        if (this.appState !== "in_game") return;
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
        if (this.appState !== "in_game") return;
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
        if (this.appState !== "in_game") return;
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
        if (this.appState !== "in_game") return;
        this.leftclicked=true;
        if(this.game.UISIZE()||this.game.buildMode)return;
        const selected = this.getSelectedEntities();
        if (selected.length === 0) return;
        
        const isbuilding=selected[0].isBuilding;
        
        const clicked = this.getEntityAt(worldX, worldY);

        if((!clicked||(clicked.owner!==this.myId||clicked.type==="sheep")||(clicked.owner===this.myId&&clicked.buildProgress&&clicked.buildProgress<1)))if(!clicked||!(selected[0].type==="sheep" && clicked.type==="sheep"))this.sendRightClickCommand(worldX, worldY, clicked ? clicked.id : null);
    
        if(clicked){if(!isbuilding)this.deselectAll();if(clicked.owner===this.myId&&!(isbuilding&&clicked.type==="sheep")&&!(clicked.buildProgress&&clicked.buildProgress<1) ){this.handlePointerLeftDown(worldX, worldY);}}
        
        for (const ent of selected) {
            ent.targetX = worldX;
            ent.targetY = worldY;
        }
    }

    sendRightClickCommand(x, y, targetId) {
        if (this.appState !== "in_game") return;
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
        if (this.gameOver) {
            const elapsed = performance.now() - this.gameOverTime;

            if (elapsed > 7500) {
                this.gameOver = false;
                this.gameOverText = "";
                this.gameOverTime = 0;

                this.appState = "lobby";
            }
        }
    
    
   
}

    draw(scale) {
        this.updateCanvasSize();

        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (this.appState === "connecting") {
            this.drawCenteredText("Connecting...");
            return;
        }

        if (this.appState === "lobby" || this.appState === "starting") {
            this.drawLobby();
            return;
        }
        
        if(this.appState ==="room_browser" ){
            this.drawRoomBrowser();
            return;
        }


        this.updateNetworkRendering();
        this.game.draw(scale, this.getSelectedEntities(), this.myId, this.leftclicked, this);

        this.leftclicked = false;

        if (this.game.buildMode) {
            if (this.canPlaceBuilding(
                this.game.cursorX - this.game.getCameraX() - this.game.bildModew / 2,
                this.game.cursorY - this.game.getCameraY() - this.game.bildModeh / 2,
                this.game.bildModew,
                this.game.bildModeh
            ) === true) {
                ctx.fillStyle = "green";
                ctx.fillRect(
                    this.game.cursorX - this.game.bildModew / 2 - 1,
                    this.game.cursorY - this.game.bildModeh / 2 - 1,
                    this.game.bildModew + 2,
                    this.game.bildModeh + 2
                );
            } else {
                ctx.fillStyle = "red";
                ctx.fillRect(
                    this.game.cursorX - this.game.bildModew / 2 - 1,
                    this.game.cursorY - this.game.bildModeh / 2 - 1,
                    this.game.bildModew + 2,
                    this.game.bildModeh + 2
                );
            }

            ctx.drawImage(
                this.game.getObjectType(this.game.buildMode).sprites[0].getimage(),
                this.game.cursorX - this.game.bildModew / 2,
                this.game.cursorY - this.game.bildModeh / 2,
                this.game.bildModew,
                this.game.bildModeh
            );
        }

        ctx.save();
        ctx.scale(this.game.getZoom(), this.game.getZoom());
        ctx.translate(this.game.getCameraX(), this.game.getCameraY());

        if (this.dragSelectStart && this.dragSelectEnd) {
            const x = Math.min(this.dragSelectStart.x, this.dragSelectEnd.x);
            const y = Math.min(this.dragSelectStart.y, this.dragSelectEnd.y);
            const w = Math.abs(this.dragSelectEnd.x - this.dragSelectStart.x);
            const h = Math.abs(this.dragSelectEnd.y - this.dragSelectStart.y);

            const dashOffset = (performance.now() * 0.02) % 12;

            ctx.fillStyle = "rgba(0, 255, 120, 0.10)";
            ctx.fillRect(x, y, w, h);

            ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
            ctx.lineWidth = 6;
            ctx.strokeRect(x, y, w, h);

            ctx.strokeStyle = "rgba(120,255,180,1)";
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            ctx.lineDashOffset = -dashOffset;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        }

        ctx.restore();
        if (this.gameOver || this.appState === "game_over") {
            const t = performance.now() - this.gameOverTime;

            // fade in (0 → 1 på ~400ms)
            const fade = Math.min(1, t / 400);

            // pulserande skala
            const pulse = 1 + Math.sin(t * 0.005) * 0.05;

            ctx.save();

            // mörk bakgrund med fade
            ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * fade})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // center
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;

            ctx.translate(cx, cy);
            ctx.scale(pulse, pulse);
            ctx.translate(-cx, -cy);

            // färg beroende på resultat
            let color = "white";
            if (this.gameOverText === "YOU WIN") color = "#00ff88";
            else if (this.gameOverText === "YOU LOSE") color = "#ff4444";
            else if (this.gameOverText === "DRAW") color = "#ffff66";

            // glow
            ctx.shadowColor = color;
            ctx.shadowBlur = 30 * fade;

            ctx.fillStyle = color;
            ctx.textAlign = "center";
            ctx.font = "80px Arial";

            ctx.fillText(this.gameOverText, cx, cy);

            // subtext (fade + liten animation)
            ctx.shadowBlur = 0;
            ctx.fillStyle = `rgba(255,255,255,${fade})`;
            ctx.font = "30px Arial";

            const dots = ".".repeat(Math.floor((t / 400) % 4));
            ctx.fillText(`Returning to lobby${dots}`, cx, cy + 80);

            ctx.restore();
            return;
        }
        
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
    sendHello(name, roomId = "default") {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.playerName = String(name || "Player").trim().slice(0, 16) || "Player";
        this.roomId = roomId;

        localStorage.setItem("playerName", this.playerName);

        this.ws.send(JSON.stringify({
            type: "hello",
            name: this.playerName,
            roomId: this.roomId
        }));
    }

    setReady(ready) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "set_ready",
            ready: !!ready
        }));
    }

    setMap(map) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "set_map",
            map
        }));
    }
    drawCenteredText(text) {
        ctx.fillStyle = "white";
        ctx.font = "40px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }

    sendRename(name) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "set_name",
            name
        }));
    }
    createRoom(roomId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "create_room",
            roomId
        }));
    }

    joinRoom(roomId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "join_room",
            roomId
        }));
    }

    leaveRoom() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "leave_room"
        }));
    }
    makeButton(x, y, w, h, text, action) {
        return { x, y, w, h, text, action };
    }
    drawButton(btn) {
        const mobile = mobileAndTabletCheck();

        ctx.fillStyle = "rgba(40,40,40,0.9)";
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);

        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);

        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = mobile ? "28px Arial" : "24px Arial";
        ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2);
    }
    pointInButton(x, y, btn) {
        return (
            x >= btn.x &&
            x <= btn.x + btn.w &&
            y >= btn.y &&
            y <= btn.y + btn.h
        );
    }
    drawRoomBrowser() {
        ctx.fillStyle = "white";
        ctx.textAlign = "left";
        ctx.font = mobileAndTabletCheck() ? "36px Arial" : "42px Arial";
        ctx.fillText("Room Browser", 40, 70);

        ctx.font = mobileAndTabletCheck() ? "24px Arial" : "30px Arial";
        ctx.fillText(`Name: ${this.playerName}`, 40, 120);

        this.uiButtons = this.buildRoomBrowserButtons();
        for (const btn of this.uiButtons) {
            this.drawButton(btn);
        }
    }
    drawLobby() {
        ctx.fillStyle = "white";
        ctx.textAlign = "left";
        ctx.font = mobileAndTabletCheck() ? "36px Arial" : "42px Arial";
        ctx.fillText(`Lobby: ${this.lobby.roomId || "-"}`, 40, 70);

        ctx.font = mobileAndTabletCheck() ? "24px Arial" : "30px Arial";
        ctx.fillText(`Map: ${this.lobby.settings?.map || "default"}`, 40, 120);
        ctx.fillText(`Name: ${this.playerName}`, 40, 165);

        const namesLine = (this.lobby.players || [])
            .map(p => p.id === this.myId ? `[${p.name}]` : p.name)
            .join(", ");

        ctx.fillStyle = "yellow";
        ctx.fillText(`Players: ${namesLine}`, 40, 220);

        this.uiButtons = this.buildLobbyButtons();
        for (const btn of this.uiButtons) {
            this.drawButton(btn);
        }
    }
    handleUIButton(action) {
        if (action === "create_room") {
            const roomName = prompt("Room name:");
            if (roomName) this.createRoom(roomName);
            return;
        }

        if (action === "change_name") {
            this.changeNamePrompt();
            return;
        }

        if (action === "leave_room") {
            this.leaveRoom();
            return;
        }

        if (action === "toggle_ready") {
            const me = this.lobby.players.find(p => p.id === this.myId);
            const currentReady = !!me?.ready;
            this.setReady(!currentReady);
            return;
        }

        if (action.startsWith("join_room:")) {
            const roomId = action.slice("join_room:".length);
            this.joinRoom(roomId);
        }
    }
    handleMenuClick(screenX, screenY) {
        for (const btn of this.uiButtons) {
            if (this.pointInButton(screenX, screenY, btn)) {
                this.handleUIButton(btn.action);
                return true;
            }
        }
        return false;
    }
    buildLobbyButtons() {
        const mobile = mobileAndTabletCheck();
        const buttons = [];

        if (mobile) {
            buttons.push(this.makeButton(40, canvas.height - 180, 220, 70, "Ready", "toggle_ready"));
            buttons.push(this.makeButton(280, canvas.height - 180, 220, 70, "Leave", "leave_room"));
            buttons.push(this.makeButton(40, canvas.height - 95, 220, 70, "Name", "change_name"));
        } else {
            buttons.push(this.makeButton(40, canvas.height - 160, 180, 55, "Ready (R)", "toggle_ready"));
            buttons.push(this.makeButton(240, canvas.height - 160, 180, 55, "Leave (L)", "leave_room"));
            buttons.push(this.makeButton(440, canvas.height - 160, 180, 55, "Name (N)", "change_name"));
        }

        return buttons;
    }
    buildRoomBrowserButtons() {
        const mobile = mobileAndTabletCheck();
        const buttons = [];

        if (mobile) {
            buttons.push(this.makeButton(40, 160, 260, 70, "Create Room", "create_room"));
            buttons.push(this.makeButton(320, 160, 260, 70, "Change Name", "change_name"));
        } else {
            buttons.push(this.makeButton(40, 160, 180, 55, "Create (C)", "create_room"));
            buttons.push(this.makeButton(240, 160, 180, 55, "Name (N)", "change_name"));
        }

        const rooms = this.roomList || [];
        let y = mobile ? 260 : 250;
        const rowH = mobile ? 84 : 64;
        const btnH = mobile ? 68 : 50;
        const btnW = mobile ? 520 : 420;

        for (const r of rooms) {
            buttons.push(
                this.makeButton(
                    40,
                    y,
                    btnW,
                    btnH,
                    `${r.id} (${r.players})${r.started ? " [INGAME]" : ""}`,
                    `join_room:${r.id}`
                )
            );
            y += rowH;
        }

        return buttons;
    }
}


