// Owns the on-disk layout of a streamed world. The manifest is intentionally
// tiny; terrain and placed-object data live in independent 50 m chunk files.

// A painted blade used to be saved as five verbose, full-precision JSON
// properties. A dense 50 m chunk therefore spent several megabytes on names
// and decimal digits alone. The compact form below is 12 bytes/blade before
// Base64 (normally 16 characters): local x/z, height, scale, blade height and
// rotation. It is only an on-disk representation; the renderer still receives
// the same friendly point objects.
const PACKED_GRASS_FORMAT = "packed-v1";
const PACKED_GRASS_BYTES = 12;

function bytesToBase64(bytes) {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function packGrass(points, chunk, chunkSize, revision = 0) {
  const bytes = new Uint8Array(points.length * PACKED_GRASS_BYTES);
  const view = new DataView(bytes.buffer);
  const originX = chunk.x * chunkSize;
  const originZ = chunk.z * chunkSize;
  const toUnit16 = value => Math.round(Math.max(0, Math.min(1, value)) * 65535);
  const toByte = (value, min, max) => Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 255);

  points.forEach((point, index) => {
    const offset = index * PACKED_GRASS_BYTES;
    view.setUint16(offset, toUnit16(((Number(point.x) || 0) - originX) / chunkSize), true);
    view.setUint16(offset + 2, toUnit16(((Number(point.z) || 0) - originZ) / chunkSize), true);
    view.setFloat32(offset + 4, Number(point.y) || 0, true);
    view.setUint8(offset + 8, toByte(Number(point.scale) || 1, 0.2, 2));
    view.setUint8(offset + 9, toByte(Number(point.height) || 1, 0.2, 2));
    view.setUint16(offset + 10, toUnit16((Number(point.rotation) || 0) / (Math.PI * 2)), true);
  });
  return { format: PACKED_GRASS_FORMAT, count: points.length, revision: Number(revision) || 0, data: bytesToBase64(bytes) };
}

function unpackGrass(grass, chunk, chunkSize) {
  if (grass?.format !== PACKED_GRASS_FORMAT || typeof grass.data !== "string") return grass;
  try {
    const bytes = base64ToBytes(grass.data);
    const count = Math.min(Number(grass.count) || 0, Math.floor(bytes.length / PACKED_GRASS_BYTES));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const originX = chunk.x * chunkSize;
    const originZ = chunk.z * chunkSize;
    const fromUnit16 = value => value / 65535;
    const fromByte = (value, min, max) => min + value / 255 * (max - min);
    const points = Array.from({ length: count }, (_, index) => {
      const offset = index * PACKED_GRASS_BYTES;
      return {
        x: originX + fromUnit16(view.getUint16(offset, true)) * chunkSize,
        z: originZ + fromUnit16(view.getUint16(offset + 2, true)) * chunkSize,
        y: view.getFloat32(offset + 4, true),
        scale: fromByte(view.getUint8(offset + 8), 0.2, 2),
        height: fromByte(view.getUint8(offset + 9), 0.2, 2),
        rotation: fromUnit16(view.getUint16(offset + 10, true)) * Math.PI * 2
      };
    });
    return { points, revision: Number(grass.revision) || 0 };
  } catch (error) {
    console.warn("Could not unpack grass in chunk", chunk.x, chunk.z, error);
    return { points: [] };
  }
}

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
    // No manifest URL means MapLoader created an in-memory blank fallback
    // after a missing/empty map. There is no chunk file to fetch in that
    // case; start with an editable in-memory tile instead.
    if (!this.has(x, z) || !this.manifestUrl) {
      const chunk = this.createEmptyChunk(x, z);
      chunk._isNew = true;
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
    // Read both legacy point-object chunks and the compact grass payload.
    chunk.grass = unpackGrass(chunk.grass, chunk, Number(this.manifest.chunkSize) || 50);
    this.cache.set(key, chunk);
    return chunk;
  }

  async save(chunk) {
    if (!this.directoryHandle) throw new Error("Saving chunks requires a map workspace directory.");
    // Preloaded empty tiles are runtime look-ahead only. Do not turn them
    // into map territory unless an edit or placed object marked them dirty.
    if (!this.has(chunk.x, chunk.z) && !chunk._dirty) return;
    const chunks = await this.directoryHandle.getDirectoryHandle("chunks", { create: true });
    const handle = await chunks.getFileHandle(WorldChunkStore.fileName(chunk.x, chunk.z), { create: true });
    // The editor keeps a non-serializable back-reference from an object data
    // record to its containing chunk. Chunk JSON must contain data only.
    const chunkSize = Number(this.manifest.chunkSize) || 50;
    const json = JSON.stringify(chunk, (key, value) => {
      if (key === "grass" && Array.isArray(value?.points)) return packGrass(value.points, chunk, chunkSize, value.revision);
      return key === "_chunkRecord" || key.startsWith("_") ? undefined : value;
    });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    const key = WorldChunkStore.key(chunk.x, chunk.z);
    this.cache.set(key, chunk);
    if (!this.has(chunk.x, chunk.z)) this.manifest.chunks.push({ x: chunk.x, z: chunk.z });
    chunk._dirty = false;
  }

  markDirty(chunk) { if (chunk) chunk._dirty = true; }

  async remove(x, z) {
    this.cache.delete(WorldChunkStore.key(x, z));
    if (!this.directoryHandle) return;
    const chunks = await this.directoryHandle.getDirectoryHandle("chunks", { create: true });
    try { await chunks.removeEntry(WorldChunkStore.fileName(x, z)); } catch (error) {
      if (error.name !== "NotFoundError") throw error;
    }
  }

  release(x, z) { this.cache.delete(WorldChunkStore.key(x, z)); }
}
