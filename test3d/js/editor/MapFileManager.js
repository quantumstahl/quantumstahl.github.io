import { createDefaultWorld, deserializeWorld, serializeWorld } from "../engine/MapSchema.js";

export class MapFileManager {
  constructor(storageKey = "nextworld-editor-autosave") { this.storageKey = storageKey; this.fileHandle = null; }
  async open() {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: "NextWorld map", accept: { "application/json": [".json"] } }] });
    this.fileHandle = handle;
    const text = await (await handle.getFile()).text();
    return text.trim() ? deserializeWorld(JSON.parse(text)) : createDefaultWorld();
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
    const json = serializeWorld(world);
    if (!json || !json.trim() || json === "undefined") throw new Error("Refusing to save an empty map payload.");
    JSON.parse(json);
    return json;
  }
  autosave(world) { localStorage.setItem(this.storageKey, serializeWorld(world)); }
  loadAutosave() { const data = localStorage.getItem(this.storageKey); return data ? deserializeWorld(JSON.parse(data)) : null; }
}
