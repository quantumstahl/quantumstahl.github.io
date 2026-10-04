import { createDefaultWorld, deserializeWorld, serializeWorld } from "../engine/MapSchema.js";

export class MapFileManager {
  constructor(storageKey = "nextworld-editor-autosave") { this.storageKey = storageKey; this.fileHandle = null; }
  async open() {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: "NextWorld map", accept: { "application/json": [".json"] } }] });
    this.fileHandle = handle;
    const text = await (await handle.getFile()).text();
    return text.trim() ? deserializeWorld(JSON.parse(text)) : createDefaultWorld();
  }
  async openWorkspace() {
    if (!window.showDirectoryPicker) throw new Error("This browser cannot open a chunked map workspace.");
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const manifestHandle = await directoryHandle.getFileHandle("world.json");
    const text = await (await manifestHandle.getFile()).text();
    const world = text.trim() ? deserializeWorld(JSON.parse(text)) : createDefaultWorld();
    this.directoryHandle = directoryHandle;
    return { world, directoryHandle };
  }
  async chooseWorkspaceDirectory() {
    if (!window.showDirectoryPicker) throw new Error("This browser cannot choose a folder for a chunked map.");
    this.directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    return this.directoryHandle;
  }
  async save(world) {
    if (!this.fileHandle) return this.saveAs(world);
    const bytes = await this.writeWorld(world);
    localStorage.removeItem(this.storageKey);
    return bytes;
  }
  async saveAs(world) {
   if (!window.showSaveFilePicker) return this.download(world);
    this.fileHandle = await window.showSaveFilePicker({ suggestedName: "world.json", types: [{ description: "NextWorld map", accept: { "application/json": [".json"] } }] });
    return this.save(world);
  }
  async saveWorkspace(world, chunkStore) {
    if (!chunkStore) throw new Error("No chunked map workspace is loaded.");
    if (!chunkStore.directoryHandle) chunkStore.directoryHandle = await this.chooseWorkspaceDirectory();
    // Persist loaded chunks first. The manifest only lists their coordinates,
    // so a completed manifest write can never point at an unfinished chunk.
    for (const chunk of chunkStore.cache.values()) await chunkStore.save(chunk);
    this.calculateDecorativeChunks(world);
    const manifestHandle = await chunkStore.directoryHandle.getFileHandle("world.json", { create: true });
    const json = this.serialize(world);
    const writable = await manifestHandle.createWritable();
    await writable.write(json);
    await writable.close();
    localStorage.removeItem(this.storageKey);
    return new Blob([json]).size;
  }
  download(world) {
    const json = this.serialize(world);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "world.json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return blob.size;
  }
  async writeWorld(world) {
    // Serialize before opening the writable stream. That prevents a failed
    // JSON conversion from truncating the chosen file to zero bytes.
    const json = this.serialize(world);
    const blob = new Blob([json], { type: "application/json" });
    const bytes = blob.size;
    // Keep the old file intact while the replacement is assembled. With a
    // watched development server, the default truncate-on-open behavior can
    // reload the page before close(), leaving a zero-byte map behind.
    const writable = await this.fileHandle.createWritable({ keepExistingData: true });
    try {
      await writable.write({ type: "write", position: 0, data: blob });
      await writable.truncate(bytes);
      await writable.close();
    } catch (error) {
      try { await writable.abort?.(); } catch { /* stream may already be closed */ }
      throw error;
    }
    return bytes;
  }
  serialize(world) {
    // Runtime instances are reconstructed from chunk files. Never duplicate
    // them into world.json, or the manifest would grow with the whole map.
    const source = world.version === 2 ? {
      ...world,
      chunks: world.chunks.map(chunk => ({ x: chunk.x, z: chunk.z, decorative: Boolean(chunk.decorative) })),
      layers: world.layers.map(layer => ({
        ...layer,
        assetTypes: layer.assetTypes.map(({ instances, ...type }) => type)
      }))
    } : world;
    const json = serializeWorld(source);
    if (!json || !json.trim() || json === "undefined") throw new Error("Refusing to save an empty map payload.");
    JSON.parse(json);
    return json;
  }
  calculateDecorativeChunks(world) {
    if (world.version !== 2 || !world.chunks?.length) return;
    const keys = new Set(world.chunks.map(chunk => `${chunk.x},${chunk.z}`));
    for (const chunk of world.chunks) {
      chunk.decorative = ![-1, 0, 1].every(dz => [-1, 0, 1].every(dx =>
        (dx === 0 && dz === 0) || keys.has(`${chunk.x + dx},${chunk.z + dz}`)
      ));
    }
  }
  autosave(world) { localStorage.setItem(this.storageKey, this.serialize(world)); }
  loadAutosave() { const data = localStorage.getItem(this.storageKey); return data ? deserializeWorld(JSON.parse(data)) : null; }
}
