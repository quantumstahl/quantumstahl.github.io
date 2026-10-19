// Streams map objects in fixed-size world cells. Map data remains in the
// WorldMap, while only the nearby object instances exist in the scene.
export class ChunkSystem {
  constructor({ chunkSize = 50, radius = 2, loadChunk, unloadChunk, onChanged, shouldLoad = () => true }) {
    this.chunkSize = chunkSize;
    this.radius = radius;
    this.loadChunk = loadChunk;
    this.unloadChunk = unloadChunk;
    this.onChanged = onChanged;
    this.shouldLoad = shouldLoad;
    this.entries = new Map();
    this.active = new Map();
    this.loading = new Map();
    this.currentKey = null;
  }

  buildIndex(world, mode) {
    this.clear();
    for (const layer of world.layers) {
      if (!layer.visible) continue;
      for (const type of layer.assetTypes) {
        if (mode === "editor" && !type.editor.visible) continue;
        for (const data of type.instances) {
          const key = this.keyForPosition(data.position);
          if (!this.entries.has(key)) this.entries.set(key, []);
          this.entries.get(key).push({ layer, type, data });
        }
      }
    }
  }

  keyForPosition(position) {
    return this.key(Math.floor(position.x / this.chunkSize), Math.floor(position.z / this.chunkSize));
  }

  key(x, z) { return `${x},${z}`; }

  update(camera) {
    if (!camera) return;
    const x = Math.floor(camera.position.x / this.chunkSize);
    const z = Math.floor(camera.position.z / this.chunkSize);
    const key = this.key(x, z);
    if (key === this.currentKey) return;
    this.currentKey = key;
    void this.setCenter(x, z);
  }

  async setCenter(x, z) {
    const wanted = new Set();
    for (let chunkZ = z - this.radius; chunkZ <= z + this.radius; chunkZ++) {
      for (let chunkX = x - this.radius; chunkX <= x + this.radius; chunkX++) {
        const key = this.key(chunkX, chunkZ);
        if (this.shouldLoad(key)) wanted.add(key);
      }
    }

    let changed = false;
    for (const [key, objects] of this.active) {
      if (wanted.has(key)) continue;
      this.active.delete(key);
      this.unloadChunk(objects);
      changed = true;
    }

    const keysToLoad = [...wanted].filter(key => !this.active.has(key) && !this.loading.has(key));
    const results = [];
    // The initial window can load together. Later, spread a newly entering
    // column over frames so JSON parsing, terrain construction and asset
    // setup do not all land in the same movement frame.
    const spreadLoads = this.active.size > 0;
    if (!spreadLoads) {
      const loads = keysToLoad.map(key => {
        const promise = this.load(key).finally(() => this.loading.delete(key));
        this.loading.set(key, promise);
        return promise;
      });
      if (loads.length) changed ||= (await Promise.all(loads)).some(Boolean);
      if (changed) this.onChanged();
      return;
    }
    for (let index = 0; index < keysToLoad.length; index++) {
      const key = keysToLoad[index];
      const promise = this.load(key).finally(() => this.loading.delete(key));
      this.loading.set(key, promise);
      results.push(await promise);
      if (spreadLoads && index < keysToLoad.length - 1) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    if (results.length) changed ||= results.some(Boolean);
    if (changed) this.onChanged();
  }

  async load(key) {
    const objects = await this.loadChunk(this.entries.get(key) ?? [], key);
    // The camera may have crossed another chunk while assets were loading.
    // Retain only objects that belong to the current 5x5 window.
    const [x, z] = key.split(",").map(Number);
    const [centerX, centerZ] = (this.currentKey ?? "0,0").split(",").map(Number);
    if (Math.abs(x - centerX) > this.radius || Math.abs(z - centerZ) > this.radius) {
      this.unloadChunk(objects);
      return objects.length > 0 || Boolean(objects.terrainChunk);
    }
    this.active.set(key, objects);
    return objects.length > 0 || Boolean(objects.terrainChunk);
  }

  async loadInitial(camera) {
    const x = Math.floor((camera?.position.x ?? 0) / this.chunkSize);
    const z = Math.floor((camera?.position.z ?? 0) / this.chunkSize);
    this.currentKey = this.key(x, z);
    await this.setCenter(x, z);
  }

  refresh(camera) {
    this.currentKey = null;
    this.update(camera);
  }

  clear() {
    this.entries.clear();
    this.active.clear();
    this.loading.clear();
    this.currentKey = null;
  }
}
