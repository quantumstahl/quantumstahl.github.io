class AdventureMapLoader {
    constructor(game) {
        this.game = game;
    }

    async load(url) {
        const res = await fetch(url);
        const text = await res.text();

        let data;

        if (!text.trim()) {
            console.warn("Empty map file.");
            data = this.createDefaultMapData();
        } else {
            data = JSON.parse(text);
        }

        await this.loadFromData(data);
    }

    async loadFromData(data) {
        const startMap = data.startMap || 0;
        const map = data.maps?.[startMap];

        if (!map) {
            console.warn("No map found.");
            return;
        }

        await this.loadMapToScene(map);
    }

    async loadMapToScene(map) {
        this.clearMapObjects();

        for (const layer of map.layers || []) {
            const types = layer.types || layer.assetTypes || [];

            for (const type of types) {
                for (const instData of type.instances || []) {
                    const inst = new MapObject(instData);

                    let obj = null;

                    if (type.shape === "box" && !type.glb) {
                        obj = this.createInvisibleBoxObject(inst, type, layer);
                    } else {
                        if (!type.glb) continue;
                        obj = await this.game.assetManager.createInstance(type.glb);
                    }

                    if (!obj) continue;

                    obj.position.set(inst.x || 0, inst.y || 0, inst.z || 0);

                    obj.rotation.set(
                        inst.rotX || 0,
                        inst.rotY || 0,
                        inst.rotZ || 0
                    );

                    if (type.shape === "box") {
                        obj.scale.set(
                            inst.scaleX ?? inst.scale ?? 1,
                            inst.scaleY ?? inst.scale ?? 1,
                            inst.scaleZ ?? inst.scale ?? 1
                        );
                    } else {
                        const s = inst.scale || 1;
                        obj.scale.set(s, s, s);
                    }

                    obj.userData.mapObject = inst;
                    obj.userData.assetType = type;
                    obj.userData.layer = layer;
                    inst.mesh=obj;
                    this.game.scene.add(obj);
                    this.game.mapObjects.push(obj);
                }
            }
        }
    }

    clearMapObjects() {
        for (const obj of this.game.mapObjects) {
            this.game.scene.remove(obj);
        }

        this.game.mapObjects.length = 0;
    }

    createDefaultMapData() {
        return {
            startMap: 0,
            maps: [
                {
                    name: "Map1",
                    layers: []
                }
            ]
        };
    }
    createInvisibleBoxObject(inst, type, layer) {
        const geo = new THREE.BoxGeometry(1, 1, 1);

        const mat = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false
        });

        const obj = new THREE.Mesh(geo, mat);
        obj.visible = false;

        obj.position.set(
            inst.x || 0,
            inst.y || 0,
            inst.z || 0
        );

        obj.rotation.set(
            inst.rotX || 0,
            inst.rotY || 0,
            inst.rotZ || 0
        );

        obj.scale.set(
            inst.scaleX ,
            inst.scaleY ,
            inst.scaleZ 
        );

        obj.userData.mapObject = inst;
        obj.userData.assetType = type;
        obj.userData.layer = layer;
        obj.userData.isInvisibleBox = true;

        return obj;
    }
}