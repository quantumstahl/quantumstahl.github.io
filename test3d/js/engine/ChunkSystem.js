// Streams map objects in fixed-size world cells. Map data remains in the
// WorldMap, while only the nearby object instances exist in the scene.
import * as THREE from "three";

export class ChunkSystem {
  constructor({ chunkSize = 50, radius = 2, loadChunk, unloadChunk, onChanged, shouldLoad = () => true, setChunkVisible = null }) {
    this.chunkSize = chunkSize;
    this.radius = radius;
    this.loadChunk = loadChunk;
    this.unloadChunk = unloadChunk;
    this.onChanged = onChanged;
    this.shouldLoad = shouldLoad;
    this.setChunkVisible = setChunkVisible;
    this.entries = new Map();
    this.active = new Map();
    this.loading = new Map();
    this.currentKey = null;
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.chunkBounds = new THREE.Box3();
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
    this.updateVisibility(camera);
    const x = Math.floor(camera.position.x / this.chunkSize);
    const z = Math.floor(camera.position.z / this.chunkSize);
    const key = this.key(x, z);
    if (key === this.currentKey) return;
    this.currentKey = key;
    void this.setCenter(x, z);
  }

  updateVisibility(camera) {
    if (!this.setChunkVisible || !this.active.size) return;
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    for (const [key, objects] of this.active) {
      const [x, z] = key.split(",").map(Number);
      // Tall enough for authored cliffs, while still representing one 50 m
      // streaming cell. Off-screen cells are hidden from both colour and
      // directional-shadow passes, but remain loaded for seamless movement.
      this.chunkBounds.min.set(x * this.chunkSize, -160, z * this.chunkSize);
      this.chunkBounds.max.set((x + 1) * this.chunkSize, 320, (z + 1) * this.chunkSize);
      const visible = this.frustum.intersectsBox(this.chunkBounds);
      // Updating an InstancedMesh slot uploads its whole instance matrix
      // buffer. Only do that when this chunk actually enters/leaves view;
      // the previous version did it for every active object every frame.
      if (objects._chunkFrustumVisible === visible) continue;
      objects._chunkFrustumVisible = visible;
      this.setChunkVisible(key, objects, visible);
    }
  }

  async setCenter(x, z) {
    const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const wanted = new Set();
    for (let chunkZ = z - this.radius; chunkZ <= z + this.radius; chunkZ++) {
      for (let chunkX = x - this.radius; chunkX <= x + this.radius; chunkX++) {
        const key = this.key(chunkX, chunkZ);
        if (this.shouldLoad(key)) wanted.add(key);
      }
    }

    let changed = false;
    const outgoing = [];
    for (const [key, objects] of this.active) {
      if (wanted.has(key)) continue;
      this.active.delete(key);
      outgoing.push(objects);
      changed = true;
    }

    // Disposing a whole departing column can stall mobile for a frame. Keep
    // the old visuals alive for a moment and release one chunk per frame.
    // The incoming work below is handled the same way once streaming begins.
    if (outgoing.length && this.active.size > 0) {
      for (const objects of outgoing) {
        await yieldFrame();
        this.unloadChunk(objects);
      }
    } else {
      for (const objects of outgoing) this.unloadChunk(objects);
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
      await yieldFrame();
      const promise = this.load(key).finally(() => this.loading.delete(key));
      this.loading.set(key, promise);
      results.push(await promise);
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
