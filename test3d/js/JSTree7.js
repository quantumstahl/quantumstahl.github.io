

class JSTree7 {
    constructor(game) {
        this.game = game;
        
        this.topbar = document.getElementById("topbar");
        this.leftPanel = document.getElementById("leftPanel");
        this.treePanel = document.getElementById("treePanel");
        this.propertyPanel = document.getElementById("propertyPanel");
        this.bottomToolbar = document.getElementById("bottomToolbar");

        this.selectedNode = null;
        this.expanded = new Set();
        
        this.unsavedtext=true;
    }

    refresh() {
        this.renderTopbar();
        this.renderTree();
        this.renderProperties();
        this.renderToolbar();
    }

    renderTopbar() {
        this.topbar.innerHTML = "";

        this.game.maps.forEach((map, index) => {
            const btn = document.createElement("button");
            btn.textContent = map.name || `Map${index + 1}`;
            btn.className = index === this.game.currentMap ? "mapTab active" : "mapTab";

            btn.onclick = async () => {
                await this.game.mapLoader.switchMap(index);
                this.refresh();
            };

            this.topbar.appendChild(btn);
        });

        const addBtn = document.createElement("button");
        addBtn.textContent = "+";
        addBtn.onclick = () => {
            this.addMap();
        };
        this.topbar.appendChild(addBtn);

        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        this.topbar.appendChild(spacer);

        const status = document.createElement("span");
        status.textContent = this.unsavedtext ? "Unsaved" : "Saved";
        status.style.padding = "8px";
        this.topbar.appendChild(status);

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Save";
        saveBtn.onclick = () => {this.game.fileManager.save();this.unsavedtext=false;};
        this.topbar.appendChild(saveBtn);
        

        
    }

    renderTree() {
        this.treePanel.innerHTML = "";

        const map = this.game.maps[this.game.currentMap];
        if (!map) return;

        const title = document.createElement("div");
        title.className = "treeTitle";
        title.textContent = "▾ " + map.name;

        title.onclick = (e) => {
            e.stopPropagation();
            this.selectNode("map", map);
        };

        if (this.isSelected?.("map", map)) {
            title.classList.add("treeSelected");
        }

        this.treePanel.appendChild(title);

        for (const layer of map.layers) {
            this.renderLayer(layer);
        }

        const addLayerBtn = document.createElement("button");
        addLayerBtn.textContent = "+ Layer";
        addLayerBtn.onclick = () => this.addLayer();
        this.treePanel.appendChild(addLayerBtn);
    }

    renderLayer(layer) {
        const open = this.isExpanded("layer", layer);

        const layerEl = document.createElement("div");
        layerEl.className = "treeLayer";
        layerEl.textContent = (open ? "▾ " : "▸ ") + layer.name;

        layerEl.onclick = (e) => {
            e.stopPropagation();

            if (e.detail === 2) {
                this.toggleExpanded("layer", layer);
            } else {
                this.selectNode("layer", layer);
            }
        };

        this.treePanel.appendChild(layerEl);

        if (!open) return;

        for (const type of layer.assetTypes) {
            this.renderAssetType(layer, type);
        }
        if (this.isSelected("layer", layer)) {
            layerEl.classList.add("treeSelected");
        }
        
    }

    renderAssetType(layer, type) {
        const open = this.isExpanded("assetType", type);

        const typeEl = document.createElement("div");
        typeEl.className = "treeAssetType";
        const col = type.collision || "solid";
        typeEl.textContent = (open ? "  ▾ " : "  ▸ ") + 
            (type.name || type.id) + 
            " [" + col + "]";
        if (col === "solid") typeEl.style.color = "#222";
        if (col === "none") typeEl.style.color = "#777";
        if (col === "ghost") typeEl.style.color = "#8a2be2";
        if (col === "trigger") typeEl.style.color = "#008b8b";
        
        
        typeEl.onclick = (e) => {
            e.stopPropagation();

            if (e.detail === 2) {
                this.toggleExpanded("assetType", type);
            } else {
                this.selectNode("assetType", type, layer);
            }
        };

        this.treePanel.appendChild(typeEl);

        if (!open) return;

        for (let i = 0; i < type.instances.length; i++) {
            const inst = type.instances[i];
            this.renderInstance(layer, type, inst, i);
        }
        if (this.isSelected("assetType", type)) {
            typeEl.classList.add("treeSelected");
        }
    }

    renderInstance(layer, type, inst, index) {
        const instEl = document.createElement("div");
        instEl.className = "treeInstance";
        instEl.textContent = `      ${inst.name || type.id + " #" + (index + 1)}`;

        instEl.onclick = (e) => {
            e.stopPropagation();
            this.selectNode("instance", inst, layer, type);
        };

        this.treePanel.appendChild(instEl);
        if (this.isSelected("instance", inst)) {
            instEl.classList.add("treeSelected");
        }
    }

    selectNode(kind, data, layer = null, type = null) {
        this.selectedNode = {
            kind,
            data,
            layer,
            type
        };

        if (kind === "instance") {
            this.game.selectMapObject?.(data);
        }

        this.renderProperties();
    }

    renderProperties() {
        if (!this.propertyPanel) return;

        this.propertyPanel.innerHTML = "";

        if (!this.selectedNode) {
            this.propertyPanel.textContent = "No selection";
            return;
        }

        const { kind, data } = this.selectedNode;

        const title = document.createElement("h3");
        title.textContent = kind;
        this.propertyPanel.appendChild(title);

        if (kind === "instance") {
            this.renderInstanceProperties(data);
        } else if (kind === "assetType") {
            this.renderAssetTypeProperties(data);
        } else if (kind === "layer") {
            this.renderLayerProperties(data);
        } else if (kind === "map") {
            this.renderMapProperties(data);
        }
    }
    renderMapProperties(map) {
        this.addTextLine("name", map.name);
        this.addTextLine("layers", String(map.layers.length));

        const renameBtn = document.createElement("button");
        renameBtn.textContent = "Rename Map";
        renameBtn.onclick = () => {
            const name = prompt("Map name?", map.name);
            if (!name) return;

            map.name = name;
            this.game.markUnsaved?.();
            this.refresh();
        };
        this.propertyPanel.appendChild(renameBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete Map";
        delBtn.className = "dangerBtn";
        delBtn.onclick = () => this.deleteSelectedMap();
        this.propertyPanel.appendChild(delBtn);
    }
    renderInstanceProperties(inst) {
        const type = this.selectedNode?.type;
        if (type?.shape === "box") {
            this.addNumberInput("scaleX", inst.scaleX ?? 1, value => {
                inst.scaleX = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addNumberInput("scaleY", inst.scaleY ?? 1, value => {
                inst.scaleY = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addNumberInput("scaleZ", inst.scaleZ ?? 1, value => {
                inst.scaleZ = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addTextInput?.("event", inst.event || "", value => {
                inst.event = value;
                this.game.markUnsaved?.();
            });
        }
        else{
            this.addNumberInput("x", inst.x, value => {
                inst.x = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addNumberInput("y", inst.y, value => {
                inst.y = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addNumberInput("z", inst.z, value => {
                inst.z = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addNumberInput("rotY", inst.rotY, value => {
                inst.rotY = value;
                this.game.updateSelectedMeshFromData?.();
            });

            this.addNumberInput("scale", inst.scale, value => {
                inst.scale = value;
                this.game.updateSelectedMeshFromData?.();
            });
        }
        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete Object";
        delBtn.onclick = () => this.deleteSelectedInstance();
        this.propertyPanel.appendChild(delBtn);
    }

    renderAssetTypeProperties(type) {
        this.addTextLine("id", type.id);
        this.addTextLine("glb", type.glb || "");
        this.addTextLine("instances", String(type.instances.length));

        const renameBtn = document.createElement("button");
        renameBtn.textContent = "Rename AssetType";
        renameBtn.onclick = () => {
            const name = prompt("AssetType name?", type.name || type.id);
            if (!name) return;

            type.name = name;
            this.game.markUnsaved?.();
            this.refresh();
        };
        this.propertyPanel.appendChild(renameBtn);
        
        this.addTextLine("collision", type.collision || "solid");
        this.addCollisionButtons(type);
        
        const addBtn = document.createElement("button");
        addBtn.textContent = "+ Instance";
        addBtn.onclick = () => this.addInstanceToSelectedType();
        this.propertyPanel.appendChild(addBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete AssetType";
        delBtn.className = "dangerBtn";
        delBtn.onclick = () => this.deleteSelectedAssetType();
        this.propertyPanel.appendChild(delBtn);
    }
    addCollisionButtons(type) {
        const wrap = document.createElement("div");
        wrap.className = "collisionButtons";

        const modes = [
            "solid",
            "none",
            "ghost",
            "trigger",
            "wall"
        ];

        for (const mode of modes) {
            const btn = document.createElement("button");
            btn.textContent = mode;

            btn.className = "collisionBtn";
            if ((type.collision || "solid") === mode) {
                btn.classList.add("active");
            }

            btn.onclick = () => {
                type.collision = mode;
                this.game.markUnsaved?.();
                this.renderProperties();
                this.renderTree();

                // Om du vill att helpers/visibility uppdateras direkt:
                // this.game.mapLoader.loadCurrentMapToScene();
            };

            wrap.appendChild(btn);
        }

        this.propertyPanel.appendChild(wrap);
    }
    renderLayerProperties(layer) {
        this.addTextLine("name", layer.name);
        this.addTextLine("assetTypes", String(layer.assetTypes.length));

        let count = 0;
        for (const type of layer.assetTypes) {
            count += type.instances.length;
        }

        this.addTextLine("objects", String(count));

        const renameBtn = document.createElement("button");
        renameBtn.textContent = "Rename Layer";
        renameBtn.onclick = () => {
            const name = prompt("Layer name?", layer.name);
            if (!name) return;

            layer.name = name;
            this.game.markUnsaved?.();
            this.refresh();
        };
        this.propertyPanel.appendChild(renameBtn);

        const addBtn = document.createElement("button");
        addBtn.textContent = "+ AssetType";
        addBtn.onclick = () => this.addAssetTypeToSelectedLayer();
        this.propertyPanel.appendChild(addBtn);
        
        const invisBtn = document.createElement("button");
        invisBtn.textContent = "+ Invisible Box";
        invisBtn.onclick = () => this.addInvisibleBoxTypeToSelectedLayer();
        this.propertyPanel.appendChild(invisBtn);
        
        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete Layer";
        delBtn.className = "dangerBtn";
        delBtn.onclick = () => this.deleteSelectedLayer();
        this.propertyPanel.appendChild(delBtn);
    }
    async addAssetTypeToSelectedLayer() {
        if (!this.selectedNode || this.selectedNode.kind !== "layer") return;

        const layer = this.selectedNode.data;

        const glbPath = await this.pickGLBPath();
        if (!glbPath) return;

        const fileName = glbPath.split("/").pop();
        const id = fileName.replace(/\.(glb|gltf)$/i, "");

        const type = new AssetType({
            id,
            name: id,
            glb: glbPath,
            instances: []
        });

        layer.assetTypes.push(type);

        this.game.markUnsaved?.();
        this.refresh();
    }
    addNumberInput(label, value, onChange) {
        const row = document.createElement("div");
        row.className = "propRow";

        const span = document.createElement("span");
        span.textContent = label;

        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.1";
        input.value = value || 0;

        input.oninput = () => {
            const v = parseFloat(input.value);

            if (!Number.isNaN(v)) {
                onChange(v);
                this.game.markUnsaved();
            }
        };

        row.appendChild(span);
        row.appendChild(input);
        this.propertyPanel.appendChild(row);
    }

    addTextLine(label, value) {
        const row = document.createElement("div");
        row.className = "propRow";
        row.textContent = `${label}: ${value}`;
        this.propertyPanel.appendChild(row);
    }

    addMap() {
        const map = new GameMap({
            name: `Map${this.game.maps.length + 1}`,
            layers: []
        });

        this.game.maps.push(map);
        this.game.currentMap = this.game.maps.length - 1;
        this.game.markUnsaved();

        this.game.mapLoader.loadCurrentMapToScene();
        this.refresh();
    }

    addLayer() {
        const map = this.game.maps[this.game.currentMap];
        if (!map) return;

        const name = prompt("Layer name?", "nature");
        if (!name) return;

        map.layers.push(new MapLayer({
            name,
            types: []
        }));

        this.game.markUnsaved();
        this.refresh();
    }

    async addInstanceToSelectedType() {
        if (!this.selectedNode || this.selectedNode.kind !== "assetType") return;

        const type = this.selectedNode.data;

        const p = this.game.getSpawnPointInFrontOfCamera?.() || new THREE.Vector3(0, 0, 0);

        const inst = new MapObject({
            x: Number(p.x.toFixed(3)),
            y: Number(p.y.toFixed(3)),
            z: Number(p.z.toFixed(3)),
            rotY: 0,
            scale: 1
        });

        type.instances.push(inst);

        this.game.markUnsaved?.();

        await this.game.mapLoader.loadCurrentMapToScene();

        // Välj nya objektet direkt
        this.game.selectMapObject?.(inst);

        this.refresh();
    }

    deleteSelectedInstance() {
        if (!this.selectedNode || this.selectedNode.kind !== "instance") return;

        const inst = this.selectedNode.data;
        const type = this.selectedNode.type;
        if (!type) return;

        const index = type.instances.indexOf(inst);
        if (index !== -1) {
            type.instances.splice(index, 1);
        }

        this.selectedNode = null;
        this.game.setSelected(null);
        this.game.markUnsaved();

        this.game.mapLoader.loadCurrentMapToScene();
        this.refresh();
    }
    getNodeKey(kind, obj) {
        return kind + ":" + (obj.id || obj.name);
    }

    isExpanded(kind, obj) {
        return this.expanded.has(this.getNodeKey(kind, obj));
    }

    toggleExpanded(kind, obj) {
        const key = this.getNodeKey(kind, obj);

        if (this.expanded.has(key)) {
            this.expanded.delete(key);
        } else {
            this.expanded.add(key);
        }

        this.renderTree();
    }
    isSelected(kind, data) {
        return this.selectedNode &&
               this.selectedNode.kind === kind &&
               this.selectedNode.data === data;
    }
    deleteSelectedMap() {
        if (!this.selectedNode || this.selectedNode.kind !== "map") return;

        const map = this.selectedNode.data;
        const maps = this.game.maps;

        if (maps.length <= 1) {
            alert("You must keep at least one map.");
            return;
        }

        const index = maps.indexOf(map);
        if (index === -1) return;

        let layerCount = map.layers.length;
        let typeCount = 0;
        let objectCount = 0;

        for (const layer of map.layers) {
            typeCount += layer.assetTypes.length;

            for (const type of layer.assetTypes) {
                objectCount += type.instances.length;
            }
        }

        const ok = confirm(
            `Delete map "${map.name}"?\n\n` +
            `This will remove:\n` +
            `- ${layerCount} layers\n` +
            `- ${typeCount} asset types\n` +
            `- ${objectCount} objects`
        );

        if (!ok) return;

        maps.splice(index, 1);

        if (this.game.currentMap >= maps.length) {
            this.game.currentMap = maps.length - 1;
        }

        if (this.game.currentMap < 0) {
            this.game.currentMap = 0;
        }

        this.selectedNode = null;
        this.game.markUnsaved?.();

        this.game.mapLoader.loadCurrentMapToScene();
        this.refresh();
    }
    deleteSelectedLayer() {
        if (!this.selectedNode || this.selectedNode.kind !== "layer") return;

        const layer = this.selectedNode.data;
        const map = this.game.maps[this.game.currentMap];
        if (!map) return;

        const index = map.layers.indexOf(layer);
        if (index === -1) return;

        let objectCount = 0;

        for (const type of layer.assetTypes) {
            objectCount += type.instances.length;
        }

        const ok = confirm(
            `Delete layer "${layer.name}"?\n\n` +
            `This will remove:\n` +
            `- ${layer.assetTypes.length} asset types\n` +
            `- ${objectCount} objects`
        );

        if (!ok) return;

        map.layers.splice(index, 1);

        this.selectedNode = null;
        this.game.selectedMapObject = null;
        this.game.markUnsaved?.();

        this.game.mapLoader.loadCurrentMapToScene();
        this.refresh();
    }
    deleteSelectedAssetType() {
        if (!this.selectedNode || this.selectedNode.kind !== "assetType") return;

        const type = this.selectedNode.data;
        const layer = this.selectedNode.layer;
        if (!layer) return;

        const index = layer.assetTypes.indexOf(type);
        if (index === -1) return;

        const ok = confirm(
            `Delete asset type "${type.name || type.id}"?\n\n` +
            `This will remove ${type.instances.length} objects.`
        );

        if (!ok) return;

        layer.assetTypes.splice(index, 1);

        this.selectedNode = null;
        this.game.selectedMapObject = null;
        this.game.markUnsaved?.();

        this.game.mapLoader.loadCurrentMapToScene();
        this.refresh();
    }
    async pickGLBPath() {
        try {
            if (!window.showOpenFilePicker) {
                const path = prompt("GLB path?", "assets/tree.glb");
                return path;
            }

            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: "GLB / GLTF Models",
                    accept: {
                        "model/gltf-binary": [".glb"],
                        "model/gltf+json": [".gltf"]
                    }
                }],
                excludeAcceptAllOption: false,
                multiple: false
            });

            const file = await handle.getFile();

            // Enkel V1:
            // Vi antar att användaren har lagt modellen i /assets
            return "assets/" + file.name;

        } catch (err) {
            console.warn("GLB pick cancelled", err);
            return null;
        }
    }
    renderToolbar() {
        if (!this.bottomToolbar) return;

        this.bottomToolbar.innerHTML = "";

        this.addToolButton("select", "Select");
        this.addToolButton("move", "Move");
        this.addToolButton("rotate", "Rotate");
        this.addToolButton("scale", "Scale");
        this.addToolButton("stack", "Stack");

        this.addToolbarSeparator();

        const duplicateBtn = document.createElement("button");
        duplicateBtn.textContent = "Duplicate";
        duplicateBtn.className = "toolBtn";
        duplicateBtn.onclick = () => this.game.duplicateSelected?.();
        this.bottomToolbar.appendChild(duplicateBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "toolBtn";
        deleteBtn.onclick = () => this.deleteSelectedInstance?.();
        this.bottomToolbar.appendChild(deleteBtn);

        this.addToolbarSeparator();

        const status = document.createElement("span");
        status.textContent = this.game.selected ? "Selected" : "No selection";
        status.style.padding = "0 8px";
        this.bottomToolbar.appendChild(status);
    }

    addToolButton(toolName, label) {
        const btn = document.createElement("button");
        btn.textContent = label;
        btn.className = "toolBtn";

        if (this.game.tools?.currentName === toolName) {
            btn.classList.add("active");
        }

        btn.onclick = () => {
            this.game.tools?.setTool(toolName);
            this.renderToolbar();
        };

        this.bottomToolbar.appendChild(btn);
    }

    addToolbarSeparator() {
        const sep = document.createElement("div");
        sep.style.width = "1px";
        sep.style.height = "30px";
        sep.style.background = "#777";
        sep.style.margin = "0 4px";
        this.bottomToolbar.appendChild(sep);
    }
    addInvisibleBoxTypeToSelectedLayer() {
        if (!this.selectedNode || this.selectedNode.kind !== "layer") return;

        const layer = this.selectedNode.data;

        const name = prompt("Invisible box name?", "trigger");
        if (!name) return;

        const type = new AssetType({
            id: name,
            name,
            glb: null,
            shape: "box",
            collision: "trigger",
            visibleInEditor: true,
            visibleInGame: false,
            instances: [
                {
                    x: 0,
                    y: 1,
                    z: 0,
                    scaleX: 2,
                    scaleY: 2,
                    scaleZ: 2
                }
            ]
        });

        layer.assetTypes.push(type);

        this.game.markUnsaved?.();

        this.game.mapLoader.loadCurrentMapToScene().then(() => {
            this.refresh();
        });
    }
    
}
window.JSTree7 = JSTree7;