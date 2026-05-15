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
                if (!type.glb) continue;

                for (const inst of type.instances || []) {
                    const obj = await this.game.assetManager.createInstance(type.glb);
                    if (!obj) continue;

                    obj.position.set(inst.x || 0, inst.y || 0, inst.z || 0);

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
}