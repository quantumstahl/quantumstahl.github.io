class MapFileManager {
    constructor(game) {
        this.game = game;
        this.fileHandle = null;
        this._saving = false;
        this.localStorageKey = "worldeditor_autosave_map";
    }

    async openFile() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: "Map JSON",
                    accept: { "application/json": [".json"] }
                }]
            });

            this.fileHandle = handle;

            const file = await handle.getFile();
            const text = await file.text();

            if (!text.trim()) {
                this.game.mapLoader.loadFromData(
                    this.game.mapLoader.createDefaultMapData()
                );
            } else {
                const data = JSON.parse(text);
                this.game.mapLoader.loadFromData(data);
            }

            await this.game.mapLoader.loadCurrentMapToScene();

            this.game.unsaved = false;
            this.game.editorTree?.refresh();

        } catch (err) {
            console.warn("Open cancelled or failed", err);
        }
    }

    async saveAs() {
        try {
            this.fileHandle = await window.showSaveFilePicker({
                suggestedName: "map.json",
                types: [{
                    description: "Map JSON",
                    accept: { "application/json": [".json"] }
                }]
            });

            await this.save();

        } catch (err) {
            console.warn("Save cancelled", err);
        }
    }

    async save() {
        if (!this.fileHandle) {
            await this.saveAs();
            return;
        }

        const writable = await this.fileHandle.createWritable();
        await writable.write(this.game.serializeMapData());
        await writable.close();

        this.game.unsaved = false;
        this.game.editorTree?.refresh();
    }

    autoSave() {
        if (this._saving) return;

        this._saving = true;

        setTimeout(async () => {
            try {
                if (this.fileHandle) {
                    await this.save();
                } else {
                    localStorage.setItem(
                        this.localStorageKey,
                        this.game.serializeMapData()
                    );
                }

                this.game.unsaved = false;
                this.game.editorTree?.refresh();

            } catch (err) {
                console.warn("Autosave failed", err);
            }

            this._saving = false;
        }, 300);
    }

    loadAutoSaveIfAny() {
        const text = localStorage.getItem(this.localStorageKey);
        if (!text) return false;

        try {
            const data = JSON.parse(text);
            this.game.mapLoader.loadFromData(data);
            return true;
        } catch (err) {
            console.warn("Could not load autosave", err);
            return false;
        }
    }

    clearAutoSave() {
        localStorage.removeItem(this.localStorageKey);
    }
}
window.MapFileManager = MapFileManager;