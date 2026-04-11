class GameClient {
    constructor() {
        this.maps = [];
        this.currentmap = 0;
        this.world = null;
        this.renderer = null;
        this.idcounter = 0;
        this.isLoaded = false;
        this.needsPathRebuild = false;
        this.cursorX=0;
        this.cursorY=0;
    }


    async loadGame() {
        await this.load();
        this.buildWorldOnCurrentmap();

        const canvas = document.getElementById("myCanvas");
        const ctx = canvas.getContext("2d");
        this.renderer = new MapRenderer(ctx);
    }

    draw(scale) {
        this.renderer.drawMap(this,scale);
    }
    updateSolver(){
        SimSolver.step(this);
        
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
    addObject(x, y, w, h, r, flipped, kind = "dynamic", type = "generic", mapName = null) {
        if (!this.world) {
            throw new Error("World is not initialized");
        }

        const obj = new Objectx(x, y, w, h, r, flipped, this.idcounter, kind, type);
        this.idcounter++;

        this.world.entities.push(obj);
        this.world.entitiesById.set(obj.id, obj);

        if (obj.kind === "solid") {
            this.world.solids.push(obj);
            this.world.selectable.push(obj);
        } else if (obj.kind === "ghost") {
            this.world.ghosts.push(obj);
        } else if (obj.kind === "dynamic") {
            this.world.dynamic.push(obj);
            this.world.selectable.push(obj);
        }

        const objecttype = this.getObjectType(type, mapName);
        if (objecttype) {
            objecttype.objects.push(obj);

            obj.objecttype = objecttype;
            obj.layer = objecttype.layer;
            obj.map = objecttype.map;
        }

        return obj;
    }
    removeObject(id) {
        const obj = this.world.entitiesById.get(id);
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
                    else if (obj.kind === "ghost") world.ghosts.push(obj);
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
        this.ownerID=null;
        this.direction="down";
        
            
        
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