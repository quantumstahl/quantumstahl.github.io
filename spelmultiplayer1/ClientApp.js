class ClientApp {
    constructor() {
        this.ws = null;
        this.game = new GameClient();
        this.availableMaps = ["Map1","Map2"];
        this.myId = null;
        this.playerName = localStorage.getItem("playerName") || "Player";
        this.roomId = "default";

     
        this.appState = "title";
        // "title"| "connecting" | "room_browser" | "lobby" | "starting" | "in_game"|"singleplayer_lobby"| singleplayer

        this.lobby = {
            roomId: null,
            players: [],
            slots: [],
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
        
        this.nameInputActive = false;
        this.nameDraft = this.playerName;


        this.roomList = [];
        this.gameOver = false;
        this.gameOverText = "";
        this.gameOverTime = 0;
        this.uiButtons = [];
        this.manualDisconnect = false;
        
        this.titlescreen=new Image();
        this.titlescreen.src="images/titlescreenRTS.png";
        
        this.selectedsingleplayer=[];
        
        this.gamespeedCounter = 0;
        this.solverCounter=0;
        

    }
    async init() {
        await this.game.loadGame();
        this.setupInput();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    // ---------------- NETWORK ----------------
    handleServerMessage(data) {
        if (data.type === "connected") return;

        if (data.type === "hello_ok") {
            this.myId = data.playerId;
            this.playerName = localStorage.getItem("playerName") || this.playerName || "Player";
            this.appState = "room_browser";

            if (this.playerName !== "Player") {
                this.sendRename(this.playerName);
            }
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

            if (winner === this.myFaction) this.gameOverText = "YOU WIN";
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
            this.lobby.slots = data.slots || [];
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
                slots: [],
                settings: { map: "default" },
                started: false
            };

            this.gameOverWinner = null;
            this.gameOver = false;
            this.gameOverText = "";
            this.gameOverTime = 0;

            this.appState = "room_browser";
            return;
        }

        if (data.type === "match_start") {
            this.gameOver = false;
            this.gameOverText = "";
            this.gameOverTime = 0;
            showPanHint();
            this.appState = "starting";
            this.forceCanvasResize();
            return;
        }

        if (data.type === "init") {
            this.myId = data.id;
            this.myFaction = data.faction ?? data.id;
            
            if (data.mapName) {
                const idx = this.game.maps.findIndex(m => m.name === data.mapName);
                if (idx >= 0) {
                    this.game.currentmap = idx;
                }
            }
            this.game.buildWorldOnCurrentmap();
            this.game.maps[this.game.currentmap].camerax = data.cx + 500;
            this.game.maps[this.game.currentmap].cameray = data.cy + 500;
            this.applyServerState(data.data);
            this.appState = "in_game";
            this.forceCanvasResize?.();
            return;
        }
        if(data.type === "spawn"){
            this.applyServerState2(data);
            
            return;
        }
        if (data.type === "match_cancelled") {
            this.gameOver = false;
            this.gameOverText = "";
            this.gameOverTime = 0;

            this.appState = "lobby";
            this.lobby.started = false;

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
            obj.trainingQueue2=trainingQueue;
            obj.trainingTimer2=trainingTimer*4;
            obj.trainingTimeMax2=trainingTimeMax*4;
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
            this.startHeartbeat();

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
            this.stopHeartbeat();
            console.log("Disconnected from server");

            if (this.manualDisconnect) {
                this.manualDisconnect = false;
                return;
            }

            this.appState = "connecting";
        };
    }
    sendSelectCommand(entityIds) {
        if (this.appState === "singleplayer"){this.selectedsingleplayer=entityIds; return;}
        
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
                if (e.key === "m" || e.key === "M") {
                    this.nextMap();
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
        if (this.appState !== "in_game"&&this.appState !== "singleplayer") return;
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
        if (this.appState !== "in_game"&&this.appState !== "singleplayer") return;
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
        if (this.appState !== "in_game"&&this.appState !== "singleplayer") return;
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
           // ent.targetX = worldX;
           // ent.targetY = worldY;
        }
    }

    handleTouchCommand(worldX, worldY) {
        
        if(this.getEntityAt(worldX, worldY)) alert("1"+this.getEntityAt(worldX, worldY).type);
        
        
        if (this.appState !== "in_game"&&this.appState !== "singleplayer") return;
        this.leftclicked=true;
        if(this.game.UISIZE()||this.game.buildMode)return;
        const selected = this.getSelectedEntities();
        if (selected.length === 0) return;
        if(this.getEntityAt(worldX, worldY)) alert("2"+this.getEntityAt(worldX, worldY).type);
        const isbuilding=selected[0].isBuilding;
        
        const clicked = this.getEntityAt(worldX, worldY);
        if(this.getEntityAt(worldX, worldY)) alert("3"+this.getEntityAt(worldX, worldY).type);
        if((!clicked||(clicked.owner!==this.myId||clicked.type==="sheep")||(clicked.owner===this.myId&&clicked.buildProgress&&clicked.buildProgress<1)))if(!clicked||!(selected[0].type==="sheep" && clicked.type==="sheep"))this.sendRightClickCommand(worldX, worldY, clicked ? clicked.id : null);
       
        
        
        if(clicked){if(!isbuilding)this.deselectAll();if(clicked.owner===this.myId&&!(isbuilding&&clicked.type==="sheep")&&!(clicked.buildProgress&&clicked.buildProgress<1) ){this.handlePointerLeftDown(worldX, worldY);}}

    }

    sendRightClickCommand(x, y, targetId) {
        
        if(this.appState === "singleplayer"){
            
            let objects=[];
            for(const o of this.selectedsingleplayer){
                objects.push(this.game.world.entitiesById.get(o));
            }
           
            if(objects[0].isBuilding) this.game.simulation.handleRightClickBuilding(objects, x, y,this.game.world.entitiesById.get(targetId));
            else this.game.simulation.handleRightClickCommand(objects, x, y, this.game.world.entitiesById.get(targetId)); return;
        }
        
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

    if(this.appState === "singleplayer"){
        
        

        
        this.gamespeedCounter+=1*scale;
        this.solverCounter+=1*scale;
        
          // full state 5 Hz
        if (this.gamespeedCounter >= 12) {
            this.game.updateGameLogic();
            this.gamespeedCounter = 0;
            if(!this.spGameOver)this.checkGameOver();
        }
          // XY 10 Hz
        if (this.solverCounter >= 6) {
            this.game.updateUnitMovement();
            this.game.updateSolver();
            this.solverCounter = 0;
            
            for(const obj of this.game.world.dynamic){
            
                obj.snapshots ||= [];
                obj.snapshots.push({
                    time: performance.now() & 0xFFFF,
                    x:obj.x,
                    y:obj.y
                });

                if (obj.snapshots.length > 10) {
                    obj.snapshots.shift();
                }

                if (obj.renderX == null) obj.renderX = obj.x;
                if (obj.renderY == null) obj.renderY = obj.y;
                
                if (obj.type === "worker" || obj.type === "rworker" || obj.type === "yworker" || obj.type === "gworker") {
                    const still = obj.standingstill;
                    const work =
                        (obj.state === "attackBoar" && this.game.collideswiths(obj, "boar")) ||
                        (obj.state === "buildBuilding" && obj.isbuilding === true) ||
                        obj.state === "gather";
                    const rtbase = (obj.state === "returnToBase");
                    const dead = obj.dead;
                    const carrytype = obj.carryType;
                    
                    obj.ani =0;
                    if (still) obj.ani = 1;
                    if (work) obj.ani = 2;
                    if (rtbase) obj.ani = 3;
                    if (dead) obj.ani = 4;

                    if (carrytype === "wood") obj.carry = 1;
                    if (carrytype === "stone") obj.carry = 2;
                    if (carrytype === "gold") obj.carry = 3;
                }
                
                
                
            
            }
            this.latestPacketTime = performance.now() & 0xFFFF;
            this.latestArrivalTime = performance.now();     
            
            for(const obj of this.game.world.solids){
                if(obj.trainingQueue){obj.trainingQueue2=obj.trainingQueue.length;}
                
            }
            
        }
    }
    


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
        if (this.spGameOver) {
            const elapsed = performance.now() - this.gameOverTime;
            if (elapsed > 7500) {
                this.spGameOver = false;
                this.spGameOverText = "";
                this.gameOverTime = 0;
                this.gameStopped=false;

                this.appState = "singleplayer_lobby";
            }
        }
}

    draw(scale) {
        this.updateCanvasSize();

        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if(this.appState === "title"){
            this.drawTitle();
            return;
            
        }
        
        
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
        if(this.appState ==="singleplayer_lobby"){
            
            this.drawSingleplayerLobby();
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
        if (this.gameOver || this.appState === "game_over"||this.spGameOver) {
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
            
            let color = "white";
            if(this.spGameOver){
                // färg beroende på resultat              
                if (this.spGameOverText === "YOU WIN") color = "#00ff88";
                else if (this.spGameOverText === "YOU LOSE") color = "#ff4444";
                else if (this.spGameOverText === "DRAW") color = "#ffff66";
                // glow
                ctx.shadowColor = color;
                ctx.shadowBlur = 30 * fade;

                ctx.fillStyle = color;
                ctx.textAlign = "center";
                ctx.font = "80px Arial";

                ctx.fillText(this.spGameOverText, cx, cy);

                // subtext (fade + liten animation)
                ctx.shadowBlur = 0;
                ctx.fillStyle = `rgba(255,255,255,${fade})`;
                ctx.font = "30px Arial";

                const dots = ".".repeat(Math.floor((t / 400) % 4));
                ctx.fillText(`Returning to lobby${dots}`, cx, cy + 80);
            }
            else{
                // färg beroende på resultat
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
            }
            

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
        const hovered = !!btn.hovered && !btn.disabled;

        let top = "#555";
        let bottom = "#2a2a2a";
        let border = "#888";
        let textColor = "white";
        let subColor = "rgba(255,255,255,0.75)";

        if (btn.disabled) {
            top = "#2f2f2f";
            bottom = "#1a1a1a";
            border = "#555";
            textColor = "#999";
            subColor = "#777";
        } else if (hovered) {
            top = "#666";
            bottom = "#2c2c2c";
            border = "#fff";
        }

        const grad = ctx.createLinearGradient(btn.x, btn.y, btn.x, btn.y + btn.h);
        grad.addColorStop(0, top);
        grad.addColorStop(1, bottom);

        ctx.save();

        ctx.fillStyle = grad;
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);

        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);

        if (hovered) {
            ctx.shadowColor = "white";
            ctx.shadowBlur = 10;
        }

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (btn.subtext) {
            ctx.fillStyle = textColor;
            ctx.font = mobile ? "24px Arial" : "22px Arial";
            ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2 - 12);

            ctx.shadowBlur = 0;
            ctx.fillStyle = subColor;
            ctx.font = mobile ? "18px Arial" : "16px Arial";
            ctx.fillText(btn.subtext, btn.x + btn.w / 2, btn.y + btn.h / 2 + 16);
        } else {
            ctx.fillStyle = textColor;
            ctx.font = mobile ? "26px Arial" : "22px Arial";
            ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2);
        }

        if (btn.tag) {
            ctx.textAlign = "right";
            ctx.textBaseline = "top";
            ctx.font = mobile ? "16px Arial" : "14px Arial";
            ctx.fillStyle = btn.tag === "INGAME" ? "#ff6666" : "#ffe066";
            ctx.fillText(btn.tag, btn.x + btn.w - 10, btn.y + 8);
        }

        ctx.restore();
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
        const mobile = mobileAndTabletCheck();
        
    
       
        
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this.titlescreen,0,0,canvas.width,canvas.height);
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // title
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.font = mobile ? "34px Arial" : "30px Arial";
        ctx.fillText("Room Browser", canvas.width / 2, 48);

        // info
        ctx.font = mobile ? "24px Arial" : "18px Arial";
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(`Name: ${this.playerName}`, canvas.width / 2, 80);

        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillText(`Rooms online: ${(this.roomList || []).length}`, canvas.width / 2, mobile ? 108 : 102);

        // buttons
        this.uiButtons = this.buildRoomBrowserButtons();
        for (const btn of this.uiButtons) {
            this.drawButton(btn);
        }

        // empty state
        const rooms = this.roomList || [];
        if (rooms.length === 0) {
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.font = mobile ? "26px Arial" : "22px Arial";
            ctx.fillText("No rooms available", canvas.width / 2, mobile ? 340 : 220);

            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.font = mobile ? "20px Arial" : "17px Arial";
            ctx.fillText("Create one to get started.", canvas.width / 2, mobile ? 375 : 248);
        }
    }
    drawLobby() {
        const mobile = mobileAndTabletCheck();
        ctx.drawImage(this.titlescreen,0,0,canvas.width,canvas.height);
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.font = mobile ? "36px Arial" : "42px Arial";
        ctx.fillText(`Lobby: ${this.lobby.roomId || "-"}`, canvas.width / 2, 70);

        ctx.font = mobile ? "24px Arial" : "30px Arial";
        ctx.fillStyle = "#ffe066";
        ctx.fillText(`Map: ${this.lobby.settings?.map || "default"}`, canvas.width / 2, 120);
        ctx.fillStyle = "white";
        
        
        ctx.fillText(`Name: ${this.playerName}`, canvas.width / 2, 165);

        const slots = this.lobby.slots || [];
        let y = 240;

        this.uiButtons = [];

        for (const s of slots) {
            const isMe = s.team === this.myId;
            const label = isMe ? `[Team ${s.team}] ${s.name}` : `Team ${s.team}: ${s.name}`;

            ctx.fillStyle = "white";
            ctx.font = mobile ? "22px Arial" : "26px Arial";
            ctx.fillText(label, canvas.width / 2 - 350, y);

            if (s.type === "human") {
                const p = (this.lobby.players || []).find(pp => pp.team === s.team);
                const ready = !!p?.ready;

                ctx.fillStyle = ready ? "lime" : "red";
                ctx.fillText(ready ? "READY" : "NOT", 250+canvas.width / 2- 350, y);
            } else if (s.type === "ai") {
                ctx.fillStyle = "#ffd966";
                ctx.fillText("AI", 250+canvas.width / 2- 350, y);

                if (!this.lobby.started) {
                    const btn = this.makeButton(350+canvas.width / 2- 350, y - 28, 130, 36, "Remove AI", `toggle_ai_slot:${s.team}`);
                    this.uiButtons.push(btn);
                }
            } else {
                ctx.fillStyle = "#aaa";
                ctx.fillText("OPEN", 250+canvas.width / 2- 350, y);

                if (!this.lobby.started && s.team !== 1) {
                    const btn = this.makeButton(350+canvas.width / 2- 350, y - 28, 100, 36, "Add AI", `toggle_ai_slot:${s.team}`);
                    this.uiButtons.push(btn);
                }
            }
                    // 🎨 färg per faction
            ctx.fillStyle = this.getFactionColor(s.faction);
            ctx.fillText(`Team ${s.faction}`, 530+canvas.width / 2- 350, y);
            
                    // 🔥 knapp för att ändra team
            if (!this.lobby.started) {
                const btn = this.makeButton(
                    600+canvas.width / 2- 350,
                    y - 28,
                    120,
                    36,
                    "Switch",
                    `toggle_team:${s.team}`
                );
                this.uiButtons.push(btn);
            }
            

            y += 48;
        }
        if (this.gameOverWinner != null) {
            ctx.fillStyle = "yellow";
            ctx.fillText(`Last winner: Team ${this.gameOverWinner}`, canvas.width / 2, y + 20);
        }

        const actionButtons = this.buildLobbyButtons();
        for (const btn of actionButtons) {
            this.uiButtons.push(btn);
        }

        for (const btn of this.uiButtons) {
            this.drawButton(btn);
        }
    }
    drawTitle() {
        this.uiButtons = [];

        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        
        ctx.drawImage(this.titlescreen,0,0,canvas.width,canvas.height);
        
        ctx.textAlign = "center";
        ctx.font = "64px Cinzel";

        // shadow
        ctx.shadowColor = "black";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // outline
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.strokeText("BirdKnight RTS", canvas.width / 2, 150);

        // fill
        ctx.fillStyle = "white";
        ctx.fillText("BirdKnight RTS", canvas.width / 2, 150);

        // reset shadow
        ctx.shadowBlur = 0;

        const mobile = mobileAndTabletCheck();

        const btnW = mobile ? 300 : 260;
        const btnH = mobile ? 80 : 70;
        const cx = canvas.width / 2 - btnW / 2;

        const multiBtn = this.makeButton(cx, 300, btnW, btnH, "Multiplayer", "go_multiplayer");
        const singleBtn = this.makeButton(cx, 400, btnW, btnH, "Singleplayer", "go_singleplayer");

        this.uiButtons.push(multiBtn, singleBtn);

        for (const btn of this.uiButtons) {
            this.drawButton(btn);
        }
    }
    
    handleUIButton(action) {
        if (action === "noop") return;

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
            return;
        }

        if (action === "back_to_title") {
            this.backToTitle();
            return;
        }

        if (action === "go_multiplayer") {
            this.connect();
            this.appState = "connecting";
            return;
        }

        if (action === "go_singleplayer") {
            this.forceCanvasResize();
            this.enterSingleplayerLobby();
            return;
        }
        if (action.startsWith("toggle_ai_slot:")) {
            const team = Number(action.slice("toggle_ai_slot:".length));
            this.toggleAISlot(team);
            return;
        }
        if (action === "next_map") {
            this.nextMap();
            return;
        }
        if (action.startsWith("toggle_team:")) {
            const team = Number(action.slice("toggle_team:".length));
            this.toggleTeam(team);
            return;
        }
        if (action === "sp_start") {
            this.startSingleplayer();
            return;
        }
        if (action === "sp_next_map") {
            
            const maps = this.availableMaps || [];
            if (maps.length === 0) return;

            const current = this.singleplayerSettings.map;
            let idx = maps.indexOf(current);

            if (idx < 0) idx = 0;
            idx = (idx + 1) % maps.length;


            this.singleplayerSettings.map =maps[idx];
        
            return;
        }
        if (action === "sp_back") {
            this.endSingleplayer();
            this.appState = "title";
            return;
        }

        if (action.startsWith("sp_toggle_ai:")) {
            const team = Number(action.slice("sp_toggle_ai:".length));

            if (team >= 2 && team <= 4) {
                const enabled = team <= (this.singleplayerSettings.aiCount + 1);

                if (enabled) {
                    this.singleplayerSettings.aiCount--;
                    if (this.singleplayerSettings.aiCount < 0) this.singleplayerSettings.aiCount = 0;
                } else {
                    this.singleplayerSettings.aiCount++;
                    if (this.singleplayerSettings.aiCount > 3) this.singleplayerSettings.aiCount = 3;
                }
            }
            return;
        }

        if (action.startsWith("sp_toggle_team:")) {
            const team = Number(action.slice("sp_toggle_team:".length));

            if (!this.singleplayerSettings.teamFactions) {
                this.singleplayerSettings.teamFactions = {
                    1: 1,
                    2: 2,
                    3: 3,
                    4: 4
                };
            }

            this.singleplayerSettings.teamFactions[team]++;
            if (this.singleplayerSettings.teamFactions[team] > 4) {
                this.singleplayerSettings.teamFactions[team] = 1;
            }

            return;
        }
        

        
    }
    startSingleplayer() {
        this.myId = 1;

        const mapName = this.singleplayerSettings.map;
        const idx = this.game.maps.findIndex(m => m.name === mapName);
        if (idx >= 0) this.game.currentmap = idx;

        this.game.buildWorldOnCurrentmap();

        this.game.simulation = new GameServerSimulation(this.game, {
            one: { wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10 },
            two: { wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10 },
            three: { wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10 },
            four: { wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10 }
        });

        // AI baserat på val
        this.game.simulation.aiTeams = [];
        for (let i = 2; i <= this.singleplayerSettings.aiCount + 1; i++) {
            this.game.simulation.aiTeams.push(i);
        }

        this.game.playerResources = this.game.simulation.teamResources.one;

        this.game.simulation.teamFactions = this.singleplayerSettings.teamFactions || {
            1: 1,
            2: 2,
            3: 3,
            4: 4
        };

        this.appState = "singleplayer";
        this.forceCanvasResize();
    }
    endSingleplayer() {
        // stoppa AI/simulation
        this.game.simulation = null;

        // rensa world
        this.game.world = null;

        // reset map
        this.game.currentmap = 0;

        // reset player data
        this.game.playerResources = {
            wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10
        };

        // reset selection
        this.selectedSingleplayerIds = [];

        // reset game over
        this.gameOver = false;
        this.gameOverText = "";
        this.gameOverTime = 0;

        // tillbaka till title
        this.appState = "title";
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


            buttons.push(this.makeButton(canvas.width/2-390, canvas.height - 160, 180, 55, "Ready (R)", "toggle_ready"));
            buttons.push(this.makeButton(200+canvas.width/2-390, canvas.height - 160, 180, 55, "Leave (L)", "leave_room"));
            buttons.push(this.makeButton(400+canvas.width/2-390, canvas.height - 160, 180, 55, "Name (N)", "change_name"));
            buttons.push(this.makeButton(600+canvas.width/2-390, canvas.height - 160, 180, 55, "Map", "next_map"));
        

        return buttons;
    }
    buildRoomBrowserButtons() {
        const mobile = mobileAndTabletCheck();
        const buttons = [];


        buttons.push(this.makeButton(canvas.width/2-210, 140, 130, 48, "Create (C)", "create_room"));
        buttons.push(this.makeButton(140+canvas.width/2-210, 140, 130, 48, "Name (N)", "change_name"));
        buttons.push(this.makeButton(280+canvas.width/2-210, 140, 130, 48, "Back", "back_to_title"));
        

        const rooms = this.roomList || [];
        let y = 250;

        for (const r of rooms) {
            const playerNames = (r.playerNames || []).join(", ");
            const isInGame = !!r.started;

            buttons.push(
                this.makeButton(
                    canvas.width/2-250,
                    y,
                    500,
                    72,
                    `${r.id} (${r.players}/4)`,
                    isInGame ? "noop" : `join_room:${r.id}`,
                    playerNames || "No players yet",
                    isInGame,
                    isInGame ? "INGAME" : ""
                )
            );

            y += mobile ? 108 : 88;
        }

        return buttons;
    }
    changeNamePrompt() {
        const value = prompt("Enter your name:", this.playerName || "Player");
        if (value == null) return;

        this.playerName = value.trim().slice(0, 16) || "Player";
        localStorage.setItem("playerName", this.playerName);
        this.sendRename(this.playerName);
    }
    startHeartbeat() {
        this.stopHeartbeat();

        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

            this.ws.send(JSON.stringify({
                type: "ping",
                t: Date.now()
            }));
        }, 10000);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    makeButton(x, y, w, h, text, action, subtext = "", disabled = false, tag = "") {
        return {
            x, y, w, h,
            text,
            action,
            subtext,
            disabled,
            tag,
            hovered: false
        };
    }
    forceCanvasResize() {
        this.lastCanvasScreenW = null;
        this.lastCanvasScreenH = null;
    }
    backToTitle() {
        if (this.ws) {
            try {
                this.manualDisconnect = true;
                this.ws.close();
            } catch (e) {
                console.log("close ws failed", e);
            }
            this.ws = null;
        }

        this.stopHeartbeat();

        this.lobby = {
            roomId: null,
            players: [],
            settings: { map: "default" },
            started: false
        };

        this.roomList = [];
        this.myId = null;
        this.appState = "title";
        this.forceCanvasResize?.();
    }
    updateButtonHover(screenX, screenY) {
        for (const btn of this.uiButtons) {
            btn.hovered = this.pointInButton(screenX, screenY, btn);
        }
    }
    toggleAISlot(team) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "toggle_ai_slot",
            team
        }));
    }
    nextMap() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const maps = this.availableMaps || [];
        if (maps.length === 0) return;

        const current = this.lobby.settings?.map || maps[0];
        let idx = maps.indexOf(current);

        if (idx < 0) idx = 0;
        idx = (idx + 1) % maps.length;

        this.ws.send(JSON.stringify({
            type: "set_map",
            map: maps[idx]
        }));
    }
    toggleTeam(team) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        this.ws.send(JSON.stringify({
            type: "toggle_team",
            team
        }));
    }
    getFactionColor(faction) {
        if (faction === 1) return "#66ccff"; // blå/cyan
        if (faction === 2) return "#ff9966"; // orange/röd
        if (faction === 3) return "#99ff66"; // grön
        if (faction === 4) return "#cc99ff"; // lila
        return "white";
    }
    enterSingleplayerLobby() {
        this.appState = "singleplayer_lobby";

        this.singleplayerSettings = {
            map: this.availableMaps?.[0] || "default",
            aiCount: 3,
            teamFactions: {
                1: 1,
                2: 2,
                3: 3,
                4: 4
            }
        };
    }
    drawSingleplayerLobby() {
        const mobile = mobileAndTabletCheck();

        ctx.drawImage(this.titlescreen, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.font = mobile ? "36px Arial" : "42px Arial";
        ctx.fillText("Singleplayer", canvas.width / 2, 70);

        ctx.font = mobile ? "24px Arial" : "30px Arial";
        ctx.fillStyle = "#ffe066";
        ctx.fillText(`Map: ${this.singleplayerSettings.map}`, canvas.width / 2, 120);

        ctx.fillStyle = "white";
        ctx.fillText(`Player: ${this.playerName}`, canvas.width / 2, 165);

        const leftX = canvas.width / 2 - 350;
        let y = 240;

        this.uiButtons = [];

        // Player slot
        ctx.textAlign = "left";
        ctx.font = mobile ? "22px Arial" : "26px Arial";

        ctx.fillStyle = "white";
        ctx.fillText(`[Team 1] ${this.playerName}`, leftX, y);

        const factions = this.singleplayerSettings.teamFactions || {
            1: 1,
            2: 2,
            3: 3,
            4: 4
        };

        ctx.fillStyle = this.getFactionColor(factions[1]);
        ctx.fillText(`Team ${factions[1]}`, leftX + 500, y);

        y += 48;

        // AI/Open slots 2-4
        for (let team = 2; team <= 4; team++) {
            const enabled = team <= (this.singleplayerSettings.aiCount + 1);

            ctx.fillStyle = "white";
            ctx.fillText(`Team ${team}: ${enabled ? "AI" : "OPEN"}`, leftX, y);

            ctx.fillStyle = enabled ? "#ffd966" : "#aaa";
            ctx.fillText(enabled ? "AI" : "OPEN", leftX + 250, y);

            const factions = this.singleplayerSettings.teamFactions || {
                1: 1,
                2: 2,
                3: 3,
                4: 4
            };

            ctx.fillStyle = this.getFactionColor(factions[team]);
            ctx.fillText(`Team ${factions[team]}`, leftX + 500, y);

            // Toggle AI button
            const aiBtnText = enabled ? "Remove AI" : "Add AI";
            const aiBtnWidth = enabled ? 130 : 100;

            const aiBtn = this.makeButton(
                leftX + 350,
                y - 28,
                aiBtnWidth,
                36,
                aiBtnText,
                `sp_toggle_ai:${team}`
            );
            this.uiButtons.push(aiBtn);

            // Switch team button
            const teamBtn = this.makeButton(
                leftX + 600,
                y - 28,
                120,
                36,
                "Switch",
                `sp_toggle_team:${team}`
            );
            this.uiButtons.push(teamBtn);

            y += 48;
        }
        
        
        if (this.spwinnerFaction != null) {
            ctx.textAlign = "center";
            ctx.fillStyle = "yellow";
            ctx.fillText(`Last winner: Team ${this.spwinnerFaction}`, canvas.width / 2, y + 80);
        }
        
        
        // Info text
        ctx.textAlign = "center";
        ctx.fillStyle = "yellow";
        ctx.font = mobile ? "22px Arial" : "26px Arial";
        ctx.fillText(`AI Players: ${this.singleplayerSettings.aiCount}`, canvas.width / 2, y + 20);

        // Bottom action buttons
        const btnY = mobile ? canvas.height - 170 : canvas.height - 120;

        if (mobile) {
            this.uiButtons.push(
                this.makeButton(canvas.width / 2 - 250, btnY, 160, 50, "Start", "sp_start"),
                this.makeButton(canvas.width / 2 - 70, btnY, 160, 50, "Map", "sp_next_map"),
                this.makeButton(canvas.width / 2 + 110, btnY, 160, 50, "Back", "sp_back")
            );
        } else {
            this.uiButtons.push(
                this.makeButton(canvas.width / 2 - 220, btnY, 140, 45, "Start", "sp_start"),
                this.makeButton(canvas.width / 2 - 60, btnY, 140, 45, "Map", "sp_next_map"),
                this.makeButton(canvas.width / 2 + 100, btnY, 140, 45, "Back", "sp_back")
            );
        }

        for (const btn of this.uiButtons) {
            this.drawButton(btn);
        }
    }
    checkGameOver() {
        const aliveFactions = new Set();

        for (const e of this.game.world.solids) {
            if (e.dead) continue;
            if (!e.owner) continue;

            const isImportant =
                e.type === "townhall" ||
                e.type === "rtownhall" ||
                e.type === "ytownhall" ||
                e.type === "gtownhall";

            if (!isImportant) continue;

            const faction = this.game.simulation.getFaction(e.owner);
            if (faction !== 0) {
                aliveFactions.add(faction);
            }
        }

        if (aliveFactions.size <= 1) {
            const winnerFaction = aliveFactions.size === 1 ? [...aliveFactions][0] : 0;

            this.spGameOver = true;
            this.spwinnerFaction = winnerFaction;
            if (winnerFaction === 1) {
                this.spGameOverText = "YOU WIN";
            } else if (winnerFaction === 0) {
                this.spGameOverText = "DRAW";
            } else {
                this.spGameOverText = "YOU LOSE";
            }
            this.gameOverTime = performance.now();
        }
    }
}


