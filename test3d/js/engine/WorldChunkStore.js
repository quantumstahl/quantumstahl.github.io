// Owns the on-disk layout of a streamed world. The manifest is intentionally
// tiny; terrain and placed-object data live in independent 50 m chunk files.
export class WorldChunkStore {
  constructor({ manifest, manifestUrl = null, directoryHandle = null }) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.directoryHandle = directoryHandle;
    this.cache = new Map();
  }

  static key(x, z) { return `${x}_${z}`; }
  static fileName(x, z) { return `${x}_${z}.json`; }

  has(x, z) {
    return this.manifest.chunks?.some(chunk => chunk.x === x && chunk.z === z) ?? false;
  }

  createEmptyChunk(x, z) {
    return {
      version: 1,
      x,
      z,
      terrain: { heights: [], colors: [], masks: [] },
      grass: { points: [] },
      objects: []
    };
  }

  async load(x, z) {
    const key = WorldChunkStore.key(x, z);
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.has(x, z)) {
      const chunk = this.createEmptyChunk(x, z);
      this.cache.set(key, chunk);
      return chunk;
    }

    let chunk;
    if (this.directoryHandle) {
      const chunks = await this.directoryHandle.getDirectoryHandle("chunks", { create: false });
      const handle = await chunks.getFileHandle(WorldChunkStore.fileName(x, z));
      chunk = JSON.parse(await (await handle.getFile()).text());
    } else {
      const url = new URL(`chunks/${WorldChunkStore.fileName(x, z)}`, this.manifestUrl);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load chunk ${x},${z}: HTTP ${response.status}`);
      chunk = JSON.parse(await response.text());
    }
    this.cache.set(key, chunk);
    return chunk;
  }

  async save(chunk) {
    if (!this.directoryHandle) throw new Error("Saving chunks requires a map workspace directory.");
    const chunks = await this.directoryHandle.getDirectoryHandle("chunks", { create: true });
    const handle = await chunks.getFileHandle(WorldChunkStore.fileName(chunk.x, chunk.z), { create: true });
    // The editor keeps a non-serializable back-reference from an object data
    // record to its containing chunk. Chunk JSON must contain data only.
    const json = JSON.stringify(chunk, (key, value) => key === "_chunkRecord" ? undefined : value, 2);
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    const key = WorldChunkStore.key(chunk.x, chunk.z);
    this.cache.set(key, chunk);
    if (!this.has(chunk.x, chunk.z)) this.manifest.chunks.push({ x: chunk.x, z: chunk.z });
  }

  release(x, z) { this.cache.delete(WorldChunkStore.key(x, z)); }
}
