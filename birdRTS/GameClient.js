class GameClient {
    constructor() {
        this.ws=null;
        this.maps = [];
        this.currentmap = 0;
        this.world = null;
        this.renderer = null;
        this.idcounter = 0;
        this.isLoaded = false;
        this.needsPathRebuild = false;
        this.cursorX=0;
        this.cursorY=0;
        this.clientgame= new ClientGame(this);
        this.playerResources={wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10 };
        this.canvas=document.getElementById("myCanvas");
        this.ctx=canvas.getContext("2d");
        this.pathfinder = new PathfinderOBB();
        this.unreachableResources = new Set();
        
       
        
    }
    setWS(ws){
        this.ws=ws;
        
    }
    updateSolver(){
        
        SimSolver.step(this);
        
        
    }
    markStaticsDirty(){
        SimSolver.markStaticsDirty();
        
    }
    updateGameLogic() {
        this.simulation.updateGameLogic();
    }

    async loadGame() {
        await this.load();
        this.buildWorldOnCurrentmap();

        this.renderer = new MapRenderer(this.ctx);
    }

    draw(scale,selected,myId,leftclicked,app) {
        this.renderer.drawMap(this,scale,app);
        this.clientgame.updateanimation(selected,myId,this.ctx,this.canvas,leftclicked,app);
    }
    UISIZE(){
        return this.cursorY>this.canvas.height-this.clientgame.UISIZE;
        
    }
    buildWorldOnCurrentmap() {
        this.world = this.buildWorldFromMap(this.maps[this.currentmap]);
    }
    async load() {
        this.maps = [];

        await new Promise((resolve, reject) => {
            const client = new XMLHttpRequest();
            client.open("GET", "map.txt");

            client.onload = () => {
                try {
                    this.parseMapText(client.responseText);
                    this.isLoaded = true;
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            client.onerror = () => reject(new Error("XHR error"));
            client.send();
        });
    }

    parseMapText(text) {
        const lines = text.split(/\r?\n/);
        if (this.maps.length !== 0) return;

        this.name = lines[0];
        this.currentmap = Number(lines[1]) || 0;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === "A*?") {
                const map = new Maps(lines[i + 1]);
                this.maps.push(map);

                map.camerax = Number(lines[i + 2]);
                map.cameray = Number(lines[i + 3]);

                i += 3;
            } else if (lines[i] === "B*?") {
                const layer = new Layer(lines[i + 1]);
                layer.lock = JSON.parse(lines[i + 2]);
                layer.moving = Number(lines[i + 3]);
                layer.physics = JSON.parse(lines[i + 4]);
                layer.solid = JSON.parse(lines[i + 5]);
                layer.ghost = JSON.parse(lines[i + 6]);

                const map = this.getLastMap();
                layer.map = map;

                map.layer.push(layer);
                map.layersByName.set(layer.name, layer);

                i += 6;
            } else if (lines[i] === "C*?") {
                const objectType = new Objecttype(lines[i + 1]);
                objectType.standardx = Number(lines[i + 2]);
                objectType.standardy = Number(lines[i + 3]);
                objectType.r = Number(lines[i + 4]);
                objectType.flipped = JSON.parse(lines[i + 5]);

                const layer = this.getLastLayer();
                const map = this.getLastMap();

                objectType.layer = layer;
                objectType.map = map;

                layer.objectTypes.push(objectType);
                map.objecttypesByName.set(objectType.name, objectType);

                i += 5;
            } else if (lines[i]==="D*?"){
                this.getLastObjectType().sprites.push(new Sprites(lines[i+1]));
                this.getLastSprites().speed = Number(lines[i+2]);
                i += 2;
            } else if (lines[i]==="E*?"){
                this.getLastSprites().images.push(String(lines[i+1]));
                i += 1;
            } else if (lines[i] === "F*?") {
                const layer = this.getLastLayer();
                const objectType = this.getLastObjectType();

                let kind = "none";
                if (layer.physics) {
                    if (layer.solid) kind = "solid";
                    else if (layer.ghost) kind = "ghost";
                    else kind = "dynamic";
                }

                const obj = new Objectx(
                    Number(lines[i + 1]),
                    Number(lines[i + 2]),
                    Number(lines[i + 3]),
                    Number(lines[i + 4]),
                    Number(lines[i + 5]),
                    JSON.parse(lines[i + 6]),
                    this.idcounter,
                    kind,
                    objectType.name
                );

                obj.objecttype = objectType;
                obj.layer = layer;
                obj.map = layer.map;

                objectType.objects.push(obj);
                this.idcounter++;
                i += 6;
            }
        }
    }

    getLastMap() {
        if (this.maps.length === 0) throw new Error("No maps loaded");
        return this.maps[this.maps.length - 1];
    }

    getLastLayer() {
        const map = this.getLastMap();
        return map.layer[map.layer.length - 1];
    }

    getLastObjectType() {
        const layer = this.getLastLayer();
        return layer.objectTypes[layer.objectTypes.length - 1];
    }
    getLastSprites(){
        const objectType = this.getLastObjectType();
        return objectType.sprites[objectType.sprites.length - 1];
        
    }
    getLastObject() {
        const objectType = this.getLastObjectType();
        return objectType.objects[objectType.objects.length - 1];
    }
    addObject(x, y, w, h, r, flipped, kind = "dynamic", type = "generic",noId=false) {
        
       
        
        if (!this.world) {
            throw new Error("World is not initialized");
        }
        let obj=null;
        if(noId){       
            obj = new Objectx(x, y, w, h, r, flipped, -1, kind, type);
            
        }
        else{
          
            obj = new Objectx(x, y, w, h, r, flipped, this.idcounter, kind, type);
            this.idcounter++;
            this.world.entities.push(obj);
            this.world.entitiesById.set(obj.id, obj);
        }
        

        if (obj.kind === "solid") {
            this.world.solids.push(obj);
            this.world.selectable.push(obj);
        } else if (obj.kind === "ghost") {
            this.world.ghosts.push(obj);
            if(obj.type==="farm"||obj.type==="rfarm"||obj.type==="gfarm"||obj.type==="yfarm")this.world.selectable.push(obj);
        } else if (obj.kind === "dynamic") {
            this.world.dynamic.push(obj);
            this.world.selectable.push(obj);
        }

        const objecttype = this.getObjectType(type, this.maps[this.currentmap].name);
        if (objecttype) {
            objecttype.objects.push(obj);

            obj.objecttype = objecttype;
            obj.layer = objecttype.layer;
            obj.map = objecttype.map;
        }

        return obj;
    }
    removeObject(id,ob=null) {
        const obj = ob||this.world.entitiesById.get(id);
        if (!obj) return false;

        this.removeFromArray(this.world.entities, obj);
        this.removeFromArray(this.world.solids, obj);
        this.removeFromArray(this.world.dynamic, obj);
        this.removeFromArray(this.world.ghosts, obj);
        this.removeFromArray(this.world.selectable, obj);
        this.world.entitiesById.delete(id);

        if (obj.objecttype) {
            this.removeFromArray(obj.objecttype.objects, obj);
        }

        return true;
    }
    removeFromArray(arr, obj) {
        const index = arr.indexOf(obj);
        if (index !== -1) {
            arr.splice(index, 1);
        }
    }
    getMapByName(name) {
        for (const map of this.maps) {
            if (map.name === name) return map;
        }
        return null;
    }
    getLayer(layerName, mapName = null) {
        let map = null;

        if (mapName) {
            map = this.getMapByName(mapName);
        } else {
            map = this.maps[this.currentmap];
        }

        if (!map) return null;
        return map.layersByName.get(layerName) || null;
    }
    getObjectType(typeName, mapName = null) {
        let map = null;

        if (mapName) {
            map = this.getMapByName(mapName);
        } else {
            map = this.maps[this.currentmap];
        }

        if (!map) return null;
        return map.objecttypesByName.get(typeName) || null;
    }
    buildWorldFromMap(map) {
        if (!map) throw new Error("No map provided");
        const world = new WorldState();

        for (const layer of map.layer) {
            for (const type of layer.objectTypes) {
                for (const obj of type.objects) {
                    world.entities.push(obj);
                    world.entitiesById.set(obj.id, obj);

                    if (obj.kind === "solid"){ world.solids.push(obj);if(obj.type!=="river")world.selectable.push(obj);}
                    else if (obj.kind === "ghost"){ world.ghosts.push(obj);if(obj.type==="farm"||obj.type==="rfarm"||obj.type==="gfarm"||obj.type==="yfarm")world.selectable.push(obj);}
                    else if (obj.kind === "dynamic"){ world.dynamic.push(obj);world.selectable.push(obj);}
                }
            }
        }

        return world;
    }
    getCameraX(){
        return this.maps[this.currentmap].camerax;  
    }
    getCameraY(){
        return this.maps[this.currentmap].cameray;  
    }
    getZoom(){
        return this.maps[this.currentmap].zoom;  
    }
    updateUnitMovement() {
        const objects = this.world.dynamic;

        for (let obj of objects) {
            if (obj.targetX == null || obj.targetY == null){obj.standingstill=true; continue;}
            const dx = obj.targetX - obj.x;
            const dy = obj.targetY - obj.y;
            const dist = Math.hypot(dx, dy);
            if(dist<2*6||obj.standingstill){obj.targetX=null;obj.targetY=null;obj.standingstill=true;continue;}
            obj.y += ((dy / dist) * obj.speed*6);
            obj.x += ((dx / dist) * obj.speed*6);
            let stop=false; 

            const absdx = Math.abs(dx);
            const absdy = Math.abs(dy);
            // om vi är blockerade i x-led och försöker gå i x-led:
            
            
            
            if ((absdx > absdy && obj.blockedx)||obj.avoidDirxconter>0) {
                if (!obj.avoidDirx) {
                    if (absdx > absdy) obj.direction = dx > 0 ? "right" : "left";
                    else obj.direction = dy > 0 ? "down" : "up";

                    if(obj.wasdynblocked){
                        if(obj.direction==="right"||obj.direction==="down")obj.avoidDirx ="down" ;
                        else obj.avoidDirx = "up";
                    }
                    else obj.avoidDirx = dy > 0 ? "down" : "up";
                    obj.avoidDirxconter=8;

                }
                obj.avoidDirxconter-=1;
                obj.direction = obj.avoidDirx;
            }

            // om vi är blockerade i y-led och försöker gå i y-led:
            else if ((absdy >= absdx && obj.blockedy)||obj.avoidDiryconter>0) {
                
                if (!obj.avoidDiry) {
                    if (absdx > absdy) obj.direction = dx > 0 ? "right" : "left";
                    else obj.direction = dy > 0 ? "down" : "up";

                    if(obj.wasdynblocked){
                        if(obj.direction==="down"||obj.direction==="right")obj.avoidDiry = "right";
                        else obj.avoidDiry = "left";
                    }
                    else{ obj.avoidDiry = dx > 0 ? "right" : "left";}
                    obj.avoidDiryconter=8;
                }
                obj.direction = obj.avoidDiry;
                obj.avoidDiryconter-=1;
            }
            else{
                if (absdx > absdy) obj.direction = dx > 0 ? "right" : "left";
                else obj.direction = dy > 0 ? "down" : "up";

                obj.avoidDirx=null;
                obj.avoidDiry=null;
            }
       
            if (obj.targetBuilding && this.collideswithanoterobject(obj, obj.targetBuilding)) {
                    stop = true;
            }
           
            if(stop==false&&(obj.blocked)){
                if(obj.direction=="left"){obj.x -= obj.speed*6;}
                if(obj.direction=="right"){obj.x += obj.speed*6;}
                if(obj.direction=="up"){obj.y -= obj.speed*6;}
                if(obj.direction=="down"){obj.y += obj.speed*6;}
            }
        } 
    }
    collideswiths(obj, type) {
            return (
                this._matchContact(obj.contactsSolid.left, type) ||
                this._matchContact(obj.contactsSolid.right, type) ||
                this._matchContact(obj.contactsSolid.up, type) ||
                this._matchContact(obj.contactsSolid.down, type) ||
                this._matchContact(obj.contactsDyn.left, type) ||
                this._matchContact(obj.contactsDyn.right, type) ||
                this._matchContact(obj.contactsDyn.up, type) ||
                this._matchContact(obj.contactsDyn.down, type) ||
                this._matchContact(obj.contactsGhost.ghost1, type)||
                this._matchContact(obj.contactsGhost.ghost2, type)||
                this._matchContact(obj.contactsGhost.ghost3, type)
            );


        return null;
    }

    collideswith(obj, type, dir) {
        try {
            if (dir === "ghost") {  
                return this._matchContact(obj.contactsGhost.ghost1, type)||
                       this._matchContact(obj.contactsGhost.ghost2, type)||
                       this._matchContact(obj.contactsGhost.ghost3, type);
            }

            if (dir === "any") {
                return (
                    this._matchContact(obj.contactsSolid.left, type) ||
                    this._matchContact(obj.contactsSolid.right, type) ||
                    this._matchContact(obj.contactsSolid.up, type) ||
                    this._matchContact(obj.contactsSolid.down, type) ||
                    this._matchContact(obj.contactsDyn.left, type) ||
                    this._matchContact(obj.contactsDyn.right, type) ||
                    this._matchContact(obj.contactsDyn.up, type) ||
                    this._matchContact(obj.contactsDyn.down, type) ||
                    this._matchContact(obj.contactsGhost.ghost1, type)||
                    this._matchContact(obj.contactsGhost.ghost2, type)||
                    this._matchContact(obj.contactsGhost.ghost3, type)
                );
            }

            return (
                this._matchContact(obj.contactsSolid[dir], type) ||
                this._matchContact(obj.contactsDyn[dir], type)
            );
        } catch (error) {}

        return null;
    }
    collideswithanoterobject(obj, obj2) {
        return (
            obj.contactsSolid.left === obj2 ||
            obj.contactsSolid.right === obj2 ||
            obj.contactsSolid.up === obj2 ||
            obj.contactsSolid.down === obj2 ||
            obj.contactsDyn.left === obj2 ||
            obj.contactsDyn.right === obj2 ||
            obj.contactsDyn.up === obj2 ||
            obj.contactsDyn.down === obj2 ||
            obj.contactsGhost.ghost1 === obj2||
            obj.contactsGhost.ghost2 === obj2||
            obj.contactsGhost.ghost3 === obj2
        );
    }
    _matchContact(ref, type){
        
        
        
        if (!ref) return null;
        if (type === "any") return ref;
        if (ref.type === type) return ref;
        return null;
    }
     //---------------------pathfinding

    pathfinding = {
        raw: [],
        options: {
            cell: 32,
            inflate: 10,
            pad: 320,
            maxGrid: 256,
            smooth: true,
            bucket: 96,
            isBlocker: null
        }
    };
    getPathBlockingObjects() {
        if (!this.world) return [];

        const isBlocker =
            this.pathfinding.options.isBlocker ||
            ((o) => {
                if (!o) return false;
                if (o.dead) return false;

                // solids blockerar normalt
                if (o.kind === "solid") return true;

                // vanliga terräng/blockers som ibland kan ligga som dynamic/ghost i äldre kartor
                if (
                    o.type === "tree" ||
                    o.type === "stone" ||
                    o.type === "gold" ||
                    o.type === "river" ||
                    o.type === "berry"
                ) {
                    return true;
                }

                return false;
            });

        return this.world.entities.filter(isBlocker);
    }

    rebuildPathfinding(opt = {}) {
        this.pathfinding.options = { ...this.pathfinding.options, ...opt };

        const blockers = this.getPathBlockingObjects();
        const raw = [];

        for (const o of blockers) {
            const p = (o.bottomsolid ?? 100) / 100;
            const baseH = Math.max(1, Math.floor(o.h * p));

            raw.push({
                cx: o.x + o.w / 2,
                cy: o.y + (o.h - baseH) + baseH / 2,
                w: o.w,
                h: baseH,
                angleRad: (o.r || 0) * Math.PI / 180
            });
        }

        this.pathfinding.raw = raw;

        // bygg om index i Pathfinder-klassen
        this.pathfinder.clearCaches();
        this.pathfinder.setObstacles(raw, this.pathfinding.options.bucket || 96);

        this.needsPathRebuild = false;
    }

    findPath(startX, startY, goalX, goalY, opt = {}) {
        if (this.needsPathRebuild || !this.pathfinder.obbCache?.index) {
            this.rebuildPathfinding(opt);
        }

        const options = { ...this.pathfinding.options, ...opt };

        return this.pathfinder.findPath(
            { x: startX, y: startY },
            { x: goalX, y: goalY },
            null,
            {
                cell: options.cell,
                inflate: options.inflate,
                pad: options.pad,
                maxGrid: options.maxGrid,
                smooth: options.smooth,
                obbIndex: this.pathfinder.obbCache?.index,
                obbKey: this.pathfinder.obbCache?.key
            }
        );
    }

    assignPath(unit, path) {
        if (!unit) return;

        if (!Array.isArray(path) || path.length === 0) {
            unit.path = null;
            unit.pathIndex = 1;
            return;
        }

        unit.path = path.slice();
        unit.pathIndex = 1;

        while (unit.pathIndex < unit.path.length) {
            const p = unit.path[unit.pathIndex];
            const dx = p.x - unit.x;
            const dy = p.y - unit.y;
            const d = Math.hypot(dx, dy);

            if (d > 8) break;
            unit.pathIndex++;
        }

        if (unit.pathIndex >= unit.path.length) {
            unit.path = null;
            unit.pathIndex = 1;
            unit.targetX = null;
            unit.targetY = null;
            return;
        }

        unit.targetX = unit.path[unit.pathIndex].x;
        unit.targetY = unit.path[unit.pathIndex].y;
        unit.standingstill = false;
    }

    clearPath(unit) {
        if (!unit) return;
        unit.path = null;
        unit.pathIndex = 1;
    }

    followPath(unit, opt = {}) {
        if (!unit || !unit.path || unit.path.length === 0) return false;
        unit.standingstill=false;
        const reachDist = opt.reachDist ?? 10;
        const nextBetterMargin = opt.nextBetterMargin ?? 12;

        if (unit.pathIndex == null) unit.pathIndex = 1;

        if (unit.pathIndex >= unit.path.length) {
            unit.path = null;
            unit.pathIndex = 1;
            return false;
        }

        let p = unit.path[unit.pathIndex];
        let d = Math.hypot(p.x - unit.x, p.y - unit.y);

        if (d <= reachDist) {
            unit.pathIndex++;

            if (unit.pathIndex >= unit.path.length) {
                unit.path = null;
                unit.pathIndex = 1;
                return false;
            }

            p = unit.path[unit.pathIndex];
            d = Math.hypot(p.x - unit.x, p.y - unit.y);
        } else {
            const nextIndex = unit.pathIndex + 1;
            if (nextIndex < unit.path.length) {
                const pNext = unit.path[nextIndex];
                const dNext = Math.hypot(pNext.x - unit.x, pNext.y - unit.y);

                if (dNext + nextBetterMargin < d) {
                    unit.pathIndex = nextIndex;
                    p = pNext;
                }
            }
        }

        unit.targetX = p.x;
        unit.targetY = p.y;
        unit.standingstill = false;
        return true;
    }

    pathUnitTo(unit, tx, ty, opt = {}) {
        if (!unit) return null;

        const path = this.findPath(unit.x, unit.y, tx, ty, opt);

        if (path && path.length > 0) {
            this.assignPath(unit, path);
            return path;
        }

        unit.path = null;
        unit.pathIndex = 1;
        unit.targetX = tx;
        unit.targetY = ty;
        unit.standingstill = false;
        return null;
    }

    canPathTo(unit, tx, ty, opt = {}) {
        if (!unit) return false;

        const path = this.findPath(unit.x, unit.y, tx, ty, opt);
        if (!Array.isArray(path) || path.length === 0) return false;

        const last = path[path.length - 1];
        const dx = last.x - tx;
        const dy = last.y - ty;
        const d = Math.hypot(dx, dy);

        if (d < 24) return true;
        if (d < 80) return true;

        return false;
    }
}

class Maps {
    constructor(name) {
        this.name = name;
        this.layer = [];
        this.camerax = 0;
        this.cameray = 0;
        this.zoom = 1;

        this.layersByName = new Map();
        this.objecttypesByName = new Map();
    }
}

class Layer {
    constructor(name) {
        this.name = name;
        this.objectTypes = [];
        this.lock = false;
        this.moving = 100;
        this.physics = false;
        this.solid = false;
        this.ghost = false;

        this.map = null;
    }
}

class Objecttype {
    constructor(name) {
        this.name = name;
        this.sprites = [];
        this.objects = [];
        this.standardx = 100;
        this.standardy = 100;
        this.r = 0;
        this.flipped = false;

        this.layer = null;
        this.map = null;
    }
}
class Sprites {
    constructor(name) {
        this.name = name;
        this.images = [];
        this.imagelist = [];
        this.img = new Image();
        this.ani = 0;
        this.counter = 0;
        this.speed = 5;
    }
    updateanimation(scale) {
        if (this.counter >= this.speed) {
            this.ani++;
            this.counter = 0;
        }
        if (this.ani >= this.images.length)
            this.ani = 0;
        this.counter=this.counter+(1*scale);
    }
    getimage() {
        try {
            if (this.imagelist.length == 0) {
                for (let i = 0; i < this.images.length; i++) {
                    this.imagelist.push(new Image());
                    this.imagelist[this.imagelist.length - 1].src = this.images[i];
                }
            }
            if (this.images.length > 0) {
                return this.imagelist[this.ani];
            }
        } catch (error) {}
        return null;
    }
}
class Objectx {
    constructor(x, y, w, h, r, flipped, id, kind = "dynamic", type = "generic") {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.r = r;
        this.flipped = flipped;
        this.id = id;
        this.kind = kind;
        this.type = type;

        this.objecttype = null;
        this.layer = null;
        this.map = null;

        this.contactsSolid = { left: null, right: null, up: null, down: null };
        this.contactsDyn   = { left: null, right: null, up: null, down: null };
        this.contactsGhost = { ghost1: null, ghost2: null, ghost3: null };

        this.vx = 0;
        this.vy = 0;

        this.blocked = false;
        this.blockedx = false;
        this.blockedy = false;

        this.freex = x;
        this.freey = y;

        this.bottomsolid = 100;
        this.slide = false;
        this.stuck = false;
        this.dead = false;
        this.ghost = (kind === "ghost");

        this.hitWallX = false;
        this.hitWallY = false;
        this.wasstaticblocked = false;
        this.wasdynblocked = false;

        this._wantdx = 0;
        this._wantdy = 0;
        this._contactNormals = [];
        this._triggered = false;

        this._stepRemain = 0;
        this._stepLock = 0;

        this.savedx = x;
        this.savedy = y;

        this.animation = 0;
        this.flashTimer = 0;
        this.isvisable = true;
        this.isonscreen = false;
        this.selected = false;
        this.selectable = true;
        this.alertT = 0;
        this.drawunfinished = false;
        this.buildProgress = 0;
        this.rotimage=0;
        this.iscontrollable=true;
        this.canMove=true;
        this.direction="down";
        this.dead=false;
        this.ani=0;
        this.carry=0;
        this.hp=10;
        this.owner=this.getOwnerFromType(this.type);
        
        this.targetX=null;
        this.targetY=null;
        this.direction="down";
        this.speed=1.25;
        this.standingstill=true;
        this.sistabit=false;
        this.dead=false;
        this.rtype=null;
        
        
        if(this.type==="townhall"||this.type==="rtownhall"||this.type==="gtownhall"||this.type==="ytownhall"||
           this.type==="barrack"||this.type==="rbarrack"||this.type==="gbarrack"||this.type==="ybarrack"||
           this.type==="hus"||this.type==="rhus"||this.type==="ghus"||this.type==="yhus"||
           this.type==="lumbercamp"||this.type==="rlumbercamp"||this.type==="glumbercamp"||this.type==="ylumbercamp"||     
           this.type==="miningcamp"||this.type==="rminingcamp"||this.type==="gminingcamp"||this.type==="yminingcamp"||    
           this.type==="farm"||this.type==="rfarm"||this.type==="gfarm"||this.type==="yfarm"||    
           this.type==="mill"||this.type==="rmill"||this.type==="gmill"||this.type==="ymill"||    
           this.type==="tower"||this.type==="rtower"||this.type==="gtower"||this.type==="ytower"){
                this.isBuilding=true;
       
           }    
        
    }
    getOwnerFromType(type) {
        if (!type) return null;

        if (type === "tree" || type === "gold" || type === "stone" || type === "berry" || type === "sheep"|| type === "boar") {
            return 0; // neutral
        }

        if (type.startsWith("r")) return 2;
        if (type.startsWith("y")) return 3;
        if (type.startsWith("g")) return 4;

        return 1;
    }

    resetContacts() {
        this.contactsSolid.left = null;
        this.contactsSolid.right = null;
        this.contactsSolid.up = null;
        this.contactsSolid.down = null;

        this.contactsDyn.left = null;
        this.contactsDyn.right = null;
        this.contactsDyn.up = null;
        this.contactsDyn.down = null;

        this.contactsGhost.ghost1 = null;
        this.contactsGhost.ghost2 = null;
        this.contactsGhost.ghost3 = null;
    }
}
class WorldState {
    constructor() {
        this.entities = [];
        this.entitiesById = new Map();
        this.solids = [];
        this.dynamic = [];
        this.ghosts = [];
        this.selectable=[];
    }
}