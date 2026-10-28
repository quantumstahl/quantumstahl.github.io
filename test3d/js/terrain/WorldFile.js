import { LocalStorageTerrainTileStore, TerrainDataProvider, TERRAIN_TILE_SIZE, TERRAIN_TILE_SEGMENTS } from "./TerrainDataProvider.js";
import { TerrainMaterialData } from "./TerrainMaterialData.js";
import { WaterData } from "../water/WaterData.js";
import {WaterBedData} from "../water/WaterBedData.js";
import { normalizeEnvironmentSettings, environmentSettingsEqual } from "../engine/EnvironmentSettings.js";
import { ObjectData } from "../objects/ObjectData.js";

export const DEFAULT_WORLD_URL = new URL("../../worlds/main.maxworld.json", import.meta.url).href;
export const WORLD_FILE_NAME = "main.maxworld.json";
const FORMAT = "maxworld-world";

export class WorldTileStore {
  constructor(tiles = new Map(), rockKeys = new Set(), materialData = new TerrainMaterialData()) {
    this.tiles = tiles;
    this.rockExposureTileKeys = rockKeys;
    this.materialData = materialData;
    this.waterData = new WaterData();
    this.waterBeds = new WaterBedData();
    this.objectData = new ObjectData();
  }
  read(key) { return this.tiles.get(key) ?? null; }
  write(key, value) { this.tiles.set(key, value); return true; }
  listKeys() { return [...this.tiles.keys()]; }

  static parse(text) {
    const world = JSON.parse(text);
    if (!world || world.format !== FORMAT || ![1, 2, 3, 4, 5, 6].includes(world.version) || world.baseTerrain !== "flat-v1"
      || world.tileSize !== TERRAIN_TILE_SIZE || world.tileSegments !== TERRAIN_TILE_SEGMENTS || !Array.isArray(world.tiles)) {
      throw new Error("This is not a supported MaxWorld world file.");
    }
    const store = new WorldTileStore();
    if (world.objects !== undefined && world.version < 5) throw new Error("Object data requires world file version 5.");
    store.objectData = ObjectData.fromJSON(world.objects);
    if (world.version >= 2) store.materialData = TerrainMaterialData.fromJSON({ materials: world.materials, tiles: world.materialTiles });
    else if (world.materials !== undefined || world.materialTiles !== undefined) throw new Error("Material data requires world file version 2.");
    if (world.water !== undefined && world.version < 3) throw new Error("Water data requires world file version 3.");
    store.waterData = WaterData.fromJSON(world.water);
    if(world.waterBeds!==undefined&&world.version<4)throw new Error("Waterbed restoration data requires world file version 4.");
    store.waterBeds=WaterBedData.fromJSON(world.waterBeds,store.waterData);
    const validator = new TerrainDataProvider({ store: null });
    for (const record of world.tiles) {
      if (!record || !Number.isSafeInteger(record.x) || !Number.isSafeInteger(record.z) || !Number.isSafeInteger(record.x / TERRAIN_TILE_SIZE) || !Number.isSafeInteger(record.z / TERRAIN_TILE_SIZE)) throw new Error("World file contains an invalid tile position.");
      const key = validator.tileKey(record.x / TERRAIN_TILE_SIZE, record.z / TERRAIN_TILE_SIZE);
      const serialized = JSON.stringify(record);
      const tile = validator.deserializeTile(serialized);
      if (!tile || store.tiles.has(key)) throw new Error(`World file contains an invalid or duplicate tile: ${key}.`);
      for (const values of [tile.heights, tile.warp, tile.rockExposure]) {
        if (values?.some(value => !Number.isFinite(value))) throw new Error(`World file contains invalid samples: ${key}.`);
      }
      store.tiles.set(key, serialized);
      if (record.rockExposure) store.rockExposureTileKeys.add(key);
    }
    return { store, settings: { rockShellEnabled: world.settings?.rockShellEnabled !== false, environment: normalizeEnvironmentSettings(world.settings?.environment) }, savedAt: world.savedAt ?? null, version: world.version };
  }

  snapshot(provider, settings) {
    const tiles = new Map(this.tiles), versions = new Map(), rockKeys = new Set(this.rockExposureTileKeys);
    for (const [key, tile] of provider.cache) {
      if (tile.source === "procedural") continue;
      tiles.set(key, provider.serializeTile(tile));
      versions.set(tile, { key, revision: tile.revision });
      if (tile.rockExposure) rockKeys.add(key); else rockKeys.delete(key);
    }
    const materialSnapshot = this.materialData.snapshot();
    const waterSnapshot = this.waterData.snapshot();
    const bedSnapshot=this.waterBeds.snapshot();
    const objectSnapshot = this.objectData.snapshot();
    const header = JSON.stringify({ format: FORMAT, version: 6, baseTerrain: "flat-v1", tileSize: provider.tileSize, tileSegments: provider.tileSegments, savedAt: new Date().toISOString(), settings, materials: materialSnapshot.materials, water: waterSnapshot.value,waterBeds:bedSnapshot.value, objects: objectSnapshot.value });
    return { text: `${header.slice(0, -1)},"tiles":[${[...tiles.values()].join(",")}],"materialTiles":[${[...materialSnapshot.tiles.values()].join(",")}]}`, tiles, versions, rockKeys, materialSnapshot, waterSnapshot,bedSnapshot, objectSnapshot };
  }

  commit(snapshot, provider) {
    this.tiles = snapshot.tiles;
    this.rockExposureTileKeys = snapshot.rockKeys;
    this.materialData.commit(snapshot.materialSnapshot);
    this.waterData.commit(snapshot.waterSnapshot);
    this.waterBeds.commit(snapshot.bedSnapshot);
    this.objectData.commit(snapshot.objectSnapshot);
    for (const key of this.tiles.keys()) provider.persistedTileKeys.add(key);
    for (const [tile, saved] of snapshot.versions) {
      // Editing may continue while a large file is being written. Only the
      // exact saved revision becomes clean; newer samples remain pinned.
      if (provider.cache.get(saved.key) === tile && tile.revision === saved.revision) tile.dirty = false;
    }
  }
}

// Only the file handle is remembered in browser storage, never world bytes.
export const rememberedWorldFile = {
  async transaction(action, handle) {
    if (!globalThis.indexedDB) throw new Error("This browser cannot remember the selected world file.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("maxworld-world-files", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other MaxWorld tabs and try again."));
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("files", action === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore("files");
        const request = action === "get" ? store.get("active") : action === "put" ? store.put(handle, "active") : store.delete("active");
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("Could not remember the world file."));
      });
    } finally { db.close(); }
  },
  get() { return this.transaction("get"); },
  set(handle) { return this.transaction("put", handle); },
  clear() { return this.transaction("delete"); },
};

export class WorldReconnectError extends Error {
  constructor(handle, cause = null) {
    const missing = cause?.name === "NotFoundError";
    super(missing ? `${handle.name} was removed or moved. Choose another file or start a new world.` : `Reopen ${handle.name} to continue with your saved world.`, { cause });
    this.handle = handle;
    this.missing = missing;
  }
}

export class WorldFileSession {
  constructor({ store = new WorldTileStore(), settings = { rockShellEnabled: true }, handle = null, name = "worlds/main.maxworld.json", importedLegacy = false, notice = "", remember = rememberedWorldFile, pickSave = options => {
    if (!globalThis.showSaveFilePicker) throw new Error("Direct saving requires Chrome or Edge at localhost (or HTTPS).");
    return globalThis.showSaveFilePicker(options);
  } } = {}) {
    Object.assign(this, { store, settings, handle, name, importedLegacy, notice, remember, pickSave });
    this.saving = false;
    this.fileMissing = false;
  }

  static async fromHandle(handle, options = {}) {
    const world = WorldTileStore.parse(await (await handle.getFile()).text());
    return new WorldFileSession({ ...options, ...world, handle, name: handle.name });
  }

  static async project({ fetchWorld = globalThis.fetch, importLegacy = true, ...options } = {}) {
    const response = await fetchWorld(DEFAULT_WORLD_URL, { cache: "no-store" });
    // A deleted project file is a valid empty starting point. Do not
    // recreate it on disk or resurrect unrelated legacy browser terrain.
    if (response.status === 404) return new WorldFileSession({ ...options, name: "New world", notice: "Project world file is missing. Started a new world — Save to choose a file." });
    if (!response.ok) throw new Error(`Could not load worlds/main.maxworld.json (${response.status}).`);
    const world = WorldTileStore.parse(await response.text());
    if (importLegacy && world.version === 1 && !world.savedAt && world.store.tiles.size === 0) {
      // Preserve the editor's current flat-world save first. The older game
      // namespace is used only when no editor save exists. Neither is erased.
      for (const namespace of ["maxworld:terrain-flat-test", "maxworld:terrain"]) {
        const legacy = new LocalStorageTerrainTileStore(namespace), keys = legacy.listKeys();
        if (!keys.length) continue;
        const records = keys.map(key => JSON.parse(legacy.read(key)));
        const migrated = WorldTileStore.parse(JSON.stringify({ format: FORMAT, version: 1, baseTerrain: "flat-v1", tileSize: TERRAIN_TILE_SIZE, tileSegments: TERRAIN_TILE_SEGMENTS, tiles: records }));
        return new WorldFileSession({ ...options, ...migrated, importedLegacy: true, name: "Imported browser world — save to a file" });
      }
    }
    return new WorldFileSession({ ...options, ...world });
  }

  static async load(options = {}) {
    const remember = options.remember ?? rememberedWorldFile;
    const handle = await remember.get();
    if (!handle) return this.project({ ...options, remember });
    // Do not silently substitute another world when a remembered file is
    // inaccessible or malformed: a later Save could overwrite the real one.
    try {
      if (await handle.queryPermission({ mode: "read" }) !== "granted") throw new WorldReconnectError(handle);
      return await this.fromHandle(handle, { ...options, remember });
    } catch (error) {
      if (error instanceof WorldReconnectError) throw error;
      if (error.name === "NotFoundError") { try { await remember.clear(); } catch {} }
      throw new WorldReconnectError(handle, error);
    }
  }

  get materialData() { return this.store.materialData; }
  get waterData() { return this.store.waterData; }
  get waterBeds(){return this.store.waterBeds;}
  get objectData() { return this.store.objectData; }

  hasUnsavedChanges(provider, settings = this.settings) {
    return this.fileMissing || this.importedLegacy || this.objectData.hasUnsavedChanges || this.materialData.hasUnsavedChanges || this.waterData.hasUnsavedChanges || this.waterBeds.hasUnsavedChanges || settings.rockShellEnabled !== this.settings.rockShellEnabled || !environmentSettingsEqual(settings.environment, this.settings.environment) || [...provider.cache.values()].some(tile => tile.dirty);
  }

  async save(provider, { saveAs = false, settings = this.settings } = {}) {
    if (this.saving) return null;
    this.saving = true;
    let writable;
    try {
      let handle = this.handle;
      if (!handle || saveAs) {
        // Pick before encoding data: transient browser user activation must
        // still be available to show the native save-location dialog.
        handle = await this.pickSave({ id: "maxworld-world", suggestedName: this.handle?.name ?? this.suggestedName ?? WORLD_FILE_NAME, ...(this.handle ? { startIn: this.handle } : {}), types: [{ description: "MaxWorld world", accept: { "application/json": [".json"] } }] });
      } else {
        if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Allow write access to save changes to this world file.");
        // Some file handles can recreate a removed entry in createWritable.
        // Detect deletion first rather than silently resurrecting that path.
        await handle.getFile();
      }
      const snapshot = this.store.snapshot(provider, settings);
      writable = await handle.createWritable();
      await writable.write(snapshot.text);
      await writable.close();
      writable = null;
      this.store.commit(snapshot, provider);
      this.handle = handle; this.name = handle.name; this.settings = { ...settings }; this.importedLegacy = false;
      this.fileMissing = false;
      let remembered = true;
      try { await this.remember.set(handle); } catch { remembered = false; }
      return { name: handle.name, tiles: snapshot.tiles.size, remembered, unsaved: this.hasUnsavedChanges(provider, settings) };
    } catch (error) {
      if (writable) { try { await writable.abort(); } catch {} }
      if (error.name === "NotFoundError" && this.handle && !saveAs) {
        this.suggestedName = this.handle.name;
        this.name = `${this.handle.name} (file removed)`;
        this.handle = null;
        this.fileMissing = true;
        try { await this.remember.clear(); } catch {}
        // A new click preserves the user activation required by the picker.
        // All saved owner payloads and unsaved CPU edits remain in memory.
        throw new Error("The save file was removed or moved. Your world is still open — click Save again to choose a new file.", { cause: error });
      }
      if (error.name === "AbortError") return null;
      throw error;
    } finally { this.saving = false; }
  }
}
