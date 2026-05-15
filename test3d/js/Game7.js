
class Game7 {
     constructor() {
        this.maps = [];
        this.currentMap = 0;
        this.mapObjects = [];

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        this.unsaved = false;
        this.input = null;
        this.editorCamera = null;
        
        this.assetManager = new AssetManager();
        this.mapLoader = new MapLoader(this);
        this.fileManager = new MapFileManager(this);
        
        this.tools = null;
        this.selected = null;
        this.selectedMapObject = null;
        this.selectionBox = null;
    }

    serializeMapData() {
        const data = {
            startMap: this.currentMap,
            maps: this.maps.map(map => ({
                name: map.name,
                layers: map.layers.map(layer => ({
                    id: layer.id,
                    name: layer.name,
                    types: layer.assetTypes.map(type => ({
                        uid: type.uid,
                        id: type.id,
                        name: type.name,
                        glb: type.glb,
                        category: type.category,
                        collision: type.collision,
                        instanced: type.instanced,
                        instances: type.instances.map(inst => ({
                            id: inst.id,
                            name: inst.name,

                            x: inst.x,
                            y: inst.y,
                            z: inst.z,

                            rotX: inst.rotX,
                            rotY: inst.rotY,
                            rotZ: inst.rotZ,

                            scale: inst.scale
                        }))
                    }))
                }))
            }))
        };

        return JSON.stringify(data, null, 2);
    }

    markUnsaved() {
        this.unsaved = true;
        this.editorTree?.renderTopbar();
        this.fileManager.autoSave();
    }

    async start() {
        this.initThree();

        await this.mapLoader.load("map.json");

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    initThree() {
        const canvas = document.getElementById("gameCanvas");

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x8fb3d9);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true
        });

        this.input = new InputManager(canvas);

        this.editorCamera = new EditorCamera(this);
        this.camera = this.editorCamera.camera;

        const light = new THREE.DirectionalLight(0xffffff, 1.2);
        light.position.set(5, 10, 5);
        this.scene.add(light);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));

        const groundGeo = new THREE.PlaneGeometry(200, 200);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x86cc7a
        });

        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.rotation.x = -Math.PI / 2;
        this.scene.add(this.ground);

        window.addEventListener("resize", () => this.resize());
        this.resize();
        this.tools = new ToolManager(this);
        this.createSelectionBox();
    }

    resize() {
        const canvas = this.renderer.domElement;
        const rect = canvas.getBoundingClientRect();

        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);

        this.renderer.setSize(width, height, false);

        if (this.editorCamera) {
            this.editorCamera.resize(width, height);
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

        if (this.input) {
            this.input.update();
        }

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    update(scale) {
        if (this.editorCamera && this.input) {
            this.editorCamera.update(this.input, scale);
        }

        if (this.tools) {
            this.tools.update(scale);
        }

        this.updateSelectionBox();
    }

    draw(scale) {
        this.renderer.render(this.scene, this.camera);
    }
    selectMapObject(mapObject) {
        this.selectedMapObject = mapObject;
        this.selected = this.getMeshFromMapObject(mapObject);
        this.updateSelectionBox();
    }

    getMeshFromMapObject(mapObject) {
        return this.mapObjects.find(obj => obj.userData.mapObject === mapObject) || null;
    }
    updateSelectedMeshFromData() {
        if (!this.selectedMapObject) return;

        const obj = this.getMeshFromMapObject(this.selectedMapObject);
        if (!obj) return;

        const inst = this.selectedMapObject;

        obj.position.set(inst.x || 0, inst.y || 0, inst.z || 0);

        obj.rotation.set(
            inst.rotX || 0,
            inst.rotY || 0,
            inst.rotZ || 0
        );

        const s = inst.scale || 1;
        obj.scale.set(s, s, s);

        this.selected = obj;
        this.updateSelectionBox?.();
    }
    onPointerDown(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();

        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const hits = this.raycaster.intersectObjects(this.mapObjects, true);
        if (hits.length === 0) return;

        let obj = hits[0].object;

        while (obj && !obj.userData.mapObject) {
            obj = obj.parent;
        }

        if (!obj) return;

        this.selectMapObject(obj.userData.mapObject);

        if (this.editorTree) {
            this.editorTree.selectNode(
                "instance",
                obj.userData.mapObject,
                obj.userData.layer,
                obj.userData.assetType
            );
        }
    }
    getSelectableRoot(obj) {
        while (obj) {
            if (obj.userData?.mapObject) return obj;
            obj = obj.parent;
        }

        return null;
    }

    setSelected(obj) {
        this.selected = obj || null;
        this.selectedMapObject = obj?.userData?.mapObject || null;

        if (!this.selected) {
            if (this.selectionBox) {
                this.selectionBox.visible = false;
            }

            if (this.editorTree) {
                this.editorTree.selectedNode = null;
                this.editorTree.renderProperties();
                this.editorTree.renderTree();
                this.editorTree.renderToolbar?.();
            }

            return;
        }

        if (this.selectedMapObject && this.editorTree) {
            this.editorTree.selectNode(
                "instance",
                this.selectedMapObject,
                obj.userData.layer,
                obj.userData.assetType
            );
        }

        this.updateSelectionBox();
    }
    createSelectionBox() {
        this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x00ffff);
        this.selectionBox.visible = false;
        this.selectionBox.userData.ignoreSnap = true;
        this.scene.add(this.selectionBox);
    }

    updateSelectionBox() {
        if (!this.selectionBox) return;

        if (!this.selected) {
            this.selectionBox.visible = false;
            return;
        }

        this.selectionBox.visible = true;
        this.selectionBox.setFromObject(this.selected);
    }
    duplicateSelected() {
        if (!this.selectedMapObject) return;

        const source = this.selectedMapObject;
        const type = this.selected?.userData?.assetType;
        if (!type) return;

        const copy = new MapObject({
            name: source.name ? source.name + " copy" : "",
            x: source.x + 1,
            y: source.y,
            z: source.z + 1,
            rotX: source.rotX,
            rotY: source.rotY,
            rotZ: source.rotZ,
            scale: source.scale
        });

        type.instances.push(copy);

        this.markUnsaved?.();

        this.mapLoader.loadCurrentMapToScene().then(() => {
            this.selectMapObject(copy);
            this.editorTree?.refresh();
        });
    }
    getSpawnPointInFrontOfCamera(distance = 6) {
        const point = new THREE.Vector3();

        // 1. Försök hitta punkt mitt på skärmen mot ground
        if (this.camera && this.ground) {
            const raycaster = new THREE.Raycaster();
            const center = new THREE.Vector2(0, 0); // mitten av skärmen

            raycaster.setFromCamera(center, this.camera);

            const hits = raycaster.intersectObject(this.ground, true);

            if (hits.length > 0) {
                point.copy(hits[0].point);
                return point;
            }
        }

        // 2. Fallback: framför kameran i kamerans riktning
        const dir = new THREE.Vector3();

        this.camera.getWorldDirection(dir);

        point.copy(this.camera.position).addScaledVector(dir, distance);

        // Om du vill att den ändå ska hamna på marknivå
        point.y = 0;

        return point;
    }

}
class MapLoader {
    constructor(game) {
        this.game = game;
    }

    async load(url) {
        let data = null;

        try {
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error("Could not load map file: " + url);
            }

            const text = await res.text();

            if (!text.trim()) {
                console.warn("map.json is empty, creating default map");
                data = this.createDefaultMapData();
            } else {
                data = JSON.parse(text);
            }

        } catch (err) {
            console.warn("Map load failed, creating default map:", err);
            data = this.createDefaultMapData();
        }

        this.loadFromData(data);
        await this.loadCurrentMapToScene();
    }

    loadFromData(data) {
        if (!data || !Array.isArray(data.maps) || data.maps.length === 0) {
            data = this.createDefaultMapData();
        }

        this.game.maps = data.maps.map(mapData => new GameMap(mapData));
        this.game.currentMap = data.startMap || 0;

        if (this.game.currentMap < 0 || this.game.currentMap >= this.game.maps.length) {
            this.game.currentMap = 0;
        }
    }

    createDefaultMapData() {
        return {
            startMap: 0,
            maps: [
                {
                    name: "Map1",
                    layers: [
                        {
                            name: "default",
                            types: []
                        }
                    ]
                }
            ]
        };
    }

    async loadCurrentMapToScene() {
        const map = this.game.maps[this.game.currentMap];
        if (!map) return;

        this.clearMapObjects();

        for (const layer of map.layers) {
            for (const type of layer.assetTypes) {
                if (!type.glb) continue;

                for (const inst of type.instances) {
                    const obj = await this.game.assetManager.createInstance(type.glb);
                    if (!obj) continue;

                    obj.position.set(inst.x, inst.y, inst.z);
                    obj.rotation.set(
                        inst.rotX || 0,
                        inst.rotY || 0,
                        inst.rotZ || 0
                    );

                    const s = inst.scale || 1;
                    obj.scale.set(s, s, s);

                    obj.userData.mapObject = inst;
                    obj.userData.assetType = type;
                    obj.userData.layer = layer;

                    this.game.scene.add(obj);
                    this.game.mapObjects.push(obj);
                }
            }
        }
    }

    clearMapObjects() {
        if (!this.game.mapObjects) this.game.mapObjects = [];

        for (const obj of this.game.mapObjects) {
            this.game.scene.remove(obj);
        }

        this.game.mapObjects.length = 0;
    }

    async switchMap(index) {
        if (index < 0 || index >= this.game.maps.length) return;

        this.game.currentMap = index;
        await this.loadCurrentMapToScene();
    }
}


class GameMap {
    constructor(data) {
        this.name = data.name || "Untitled Map";
        this.layers = (data.layers || []).map(layerData => new MapLayer(layerData));
    }
}

class MapLayer {
    constructor(data = {}) {
        this.id = data.id || crypto.randomUUID?.() || String(Math.random());
        this.name = data.name || "default";

        const types = data.types || data.assetTypes || [];
        this.assetTypes = types.map(typeData => new AssetType(typeData));
    }
}

class AssetType {
    constructor(data = {}) {
        this.id = data.id || crypto.randomUUID?.() || String(Math.random());
        this.assetId = data.assetId || data.id || "";
        this.name = data.name || this.assetId || "asset";
        this.glb = data.glb || null;
        this.category = data.category || "default";
        this.collision = data.collision || null;
        this.instanced = data.instanced || false;

        this.instances = (data.instances || []).map(objData => new MapObject(objData));
    }
}

class MapObject {
    constructor(data) {
        this.x = data.x || 0;
        this.y = data.y || 0;
        this.z = data.z || 0;

        this.rotX = data.rotX || 0;
        this.rotY = data.rotY || 0;
        this.rotZ = data.rotZ || 0;

        this.scale = data.scale || 1;

        this.name = data.name || "";
        this.id = data.id || crypto.randomUUID?.() || String(Math.random());
    }
}
window.Game7 = Game7;