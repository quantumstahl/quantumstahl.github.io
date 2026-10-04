import * as THREE from "three";
import { createDefaultWorld, createChunkedWorldManifest, deserializeWorld, isChunkedWorld } from "./MapSchema.js";
import { RenderBatcher } from "./RenderBatcher.js";
import { Terrain } from "./Terrain.js";
import { Water } from "./Water.js";
import { Grass } from "./Grass.js";
import { FakeShadows } from "./FakeShadows.js";
import { GroundMist } from "./GroundMist.js";
import { Sky } from "./Sky.js";
import { EnvironmentSystem } from "./EnvironmentSystem.js";
import { ChunkSystem } from "./ChunkSystem.js";
import { WorldChunkStore } from "./WorldChunkStore.js";
import { ChunkedTerrain } from "./ChunkedTerrain.js";

export class MapLoader {
  constructor({ scene, assets, mode = "game" }) {
    this.scene = scene;
    this.assets = assets;
    this.mode = mode;
    this.root = new THREE.Group();
    this.root.name = "Map objects";
    this.scene.add(this.root);
    this.world = createDefaultWorld();
    this.objects = [];
    this.batcher = new RenderBatcher(scene);
    this.monolithicTerrain = new Terrain(scene);
    this.streamedTerrain = new ChunkedTerrain(scene);
    this.terrain = this.monolithicTerrain;
    this.chunkStore = null;
    this.water = new Water(scene);
    this.grass = new Grass(scene, assets);
    this.fakeShadows = new FakeShadows(scene);
    this.groundMist = new GroundMist(scene);
    this.sky = new Sky(scene);
    this.environment = new EnvironmentSystem({ scene, sky: this.sky });
    this.selectedObject = null;
    // Both play mode and the editor use the same active 5x5 object window.
    // The editor retains the map data for authoring, but only nearby scene
    // instances are created and rendered.
    this.chunks = new ChunkSystem({
      chunkSize: 50,
      radius: 2,
      loadChunk: (entries, key) => this.loadChunk(entries, key),
      unloadChunk: objects => this.unloadChunk(objects),
      shouldLoad: key => this.shouldLoadChunk(key),
      onChanged: () => {
        this.refreshBatches();
        this.refreshFakeShadows();
      }
    });
  }

  async load(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return this.loadData(text.trim() ? JSON.parse(text) : createDefaultWorld(), new URL(url, window.location.href).href);
    } catch (error) {
      console.warn(`Could not load ${url}; starting a blank world instead.`, error);
      return this.loadData(createDefaultWorld());
    }
  }

  async loadData(data, manifestUrl = null, directoryHandle = null) {
    if (isChunkedWorld(data)) {
      this.world = deserializeWorld(data);
      this.chunkStore = new WorldChunkStore({ manifest: this.world, manifestUrl, directoryHandle });
    } else {
      // The editor no longer saves the monolithic format. A legacy world is
      // promoted once in memory; its placed objects are assigned to their
      // 50 m chunks and the next Save writes the native v2 workspace.
      const legacy = deserializeWorld(data);
      this.world = createChunkedWorldManifest({
        name: legacy.name,
        editor: legacy.editor,
        sky: legacy.sky,
        terrain: { enabled: legacy.terrain.enabled, color: legacy.terrain.color, textures: legacy.terrain.textures, activeTexture: legacy.terrain.activeTexture },
        water: legacy.water,
        grass: { enabled: legacy.grass.enabled, density: legacy.grass.density },
        layers: legacy.layers.map(layer => ({ ...layer, assetTypes: layer.assetTypes.map(({ instances, ...type }) => type) })),
        chunks: []
      });
      this.chunkStore = new WorldChunkStore({ manifest: this.world, manifestUrl, directoryHandle });
      for (const layer of legacy.layers) for (const type of layer.assetTypes) for (const instance of type.instances) {
        const x = Math.floor(instance.position.x / this.world.chunkSize);
        const z = Math.floor(instance.position.z / this.world.chunkSize);
        const key = WorldChunkStore.key(x, z);
        let chunk = this.chunkStore.cache.get(key);
        if (!chunk) {
          chunk = this.chunkStore.createEmptyChunk(x, z);
          this.chunkStore.cache.set(key, chunk);
          this.world.chunks.push({ x, z });
        }
        chunk.objects.push({ layerId: layer.id, typeId: type.id, chunkX: x, chunkZ: z, data: instance });
        this.chunkStore.markDirty(chunk);
      }
    }
    await this.rebuild();
    return this.world;
  }

  async rebuild() {
    this.clear();
    this.environment.apply(this.world.sky);
    if (this.chunkStore) {
      this.monolithicTerrain.mesh?.removeFromParent();
      this.terrain = this.streamedTerrain;
      this.world.terrain.chunkSize = this.world.chunkSize;
      this.streamedTerrain.applyManifest(this.world.terrain);
      this.water.beginChunked(this.world.water);
      this.grass.applyChunked(this.world.grass, this.streamedTerrain);
    } else {
      this.terrain = this.monolithicTerrain;
      this.terrain.apply(this.world.terrain);
      this.groundMist.apply(this.terrain.mesh);
      this.water.apply(this.world.water, this.world.terrain);
      await this.grass.apply(this.world.grass, this.terrain);
    }
    this.water.setSunDirection(this.sky.findDirectionalLight());
    this.sky.addBackgroundFadeToMaterial(this.chunkStore ? this.streamedTerrain.material : this.terrain.mesh?.material);
    if (this.chunkStore) this.sky.addBackgroundFadeToMaterial(this.water.material);
    if (this.chunkStore) this.sky.addBackgroundFadeToMaterial(this.grass.farGrassMaterial);
    if (!this.chunkStore) {
      this.sky.addBackgroundFadeToMaterial(this.water.mesh?.material);
      this.sky.addBackgroundFadeToMaterial(this.grass.farGrassMaterial);
    }
    if (this.chunks) {
      this.chunks.buildIndex(this.world, this.mode);
      if (this.chunkStore) for (const chunk of this.world.chunks) this.chunks.entries.set(this.chunks.key(chunk.x, chunk.z), []);
      await this.chunks.loadInitial();
    } else {
      for (const layer of this.world.layers) {
        if (!layer.visible) continue;
        for (const type of layer.assetTypes) {
          if (this.mode === "editor" && !type.editor.visible) continue;
          for (const data of type.instances) {
            await this.addInstance(type, data, layer);
          }
        }
      }
      this.refreshBatches();
      this.refreshFakeShadows();
    }
  }

  async loadChunk(entries, key) {
    const objects = [];
    if (this.chunkStore) {
      const [x, z] = key.split(",").map(Number);
      const chunk = await this.chunkStore.load(x, z);
      const decoration = this.getChunkDecoration(x, z);
      chunk._decorative = decoration.decorative;
      chunk._decorativeEdges = decoration.edges;
      chunk._decorativeCorners = decoration.corners;
      objects.terrainChunk = chunk;
      this.streamedTerrain.loadChunk(chunk);
      this.water.applyChunk(chunk, this.world.terrain);
      objects.waterChunk = chunk;
      this.refreshChunkedGrass();
      for (const record of chunk.objects ?? []) {
        const layer = this.world.layers.find(item => item.id === record.layerId);
        const type = layer?.assetTypes.find(item => item.id === record.typeId);
        if (!layer || !type || !record.data) continue;
        // The controlled cat remains in the scene after its source chunk
        // streams out, so do not create another instance when it streams in.
        if (this.playerObject?.userData.mapObject === record.data) continue;
        record.chunkX ??= x;
        record.chunkZ ??= z;
        record.data._chunkRecord = record;
        const object = await this.addInstance(type, record.data, layer);
        if (object) objects.push(object);
      }
      return objects;
    }
    for (const { type, data, layer } of entries) {
      const object = await this.addInstance(type, data, layer);
      if (object) objects.push(object);
    }
    return objects;
  }

  unloadChunk(objects) {
    if (objects.terrainChunk) this.streamedTerrain.unloadChunk(objects.terrainChunk.x, objects.terrainChunk.z);
    if (objects.waterChunk) this.water.removeChunk(objects.waterChunk.x, objects.waterChunk.z);
    if (objects.terrainChunk) this.refreshChunkedGrass();
    for (const object of objects) {
      // Do not unload the player with its authored spawn chunk. It is moved
      // independently by PlayerController and must survive world streaming.
      if (object === this.playerObject) continue;
      this.batcher.remove(object);
      object.removeFromParent();
      const index = this.objects.indexOf(object);
      if (index >= 0) this.objects.splice(index, 1);
      if (this.selectedObject === object) this.selectedObject = null;
    }
  }

  // Incremental insertion is important for the Brush tool. Rebuilding the
  // entire map after every stamp causes visible flicker and needless GLB work.
  async addInstance(type, data, layer) {
    const object = await this.createObject(type, data);
    if (!object) return null;
    object.userData.mapObject = data;
    object.userData.assetType = type;
    object.userData.mapLayer = layer;
    this.root.add(object);
    this.objects.push(object);
    if (this.chunkStore && !data._chunkRecord) {
      const x = Math.floor(data.position.x / this.world.chunkSize);
      const z = Math.floor(data.position.z / this.world.chunkSize);
      const chunk = await this.chunkStore.load(x, z);
      const record = { layerId: layer.id, typeId: type.id, chunkX: x, chunkZ: z, data };
      chunk.objects.push(record);
      this.chunkStore.markDirty(chunk);
      data._chunkRecord = record;
    }
    return object;
  }

  async createObject(type, data) {
    let object;
    if (type.shape === "box") {
      const material = new THREE.MeshStandardMaterial({ color: 0x6c9d76, transparent: this.mode === "editor", opacity: this.mode === "editor" ? .42 : 1 });
      object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      // Boxes are editor-only helpers for now. Their map objects still load in
      // the game, ready to become trigger volumes, but never draw there.
      object.visible = this.mode === "editor";
      object.castShadow = false;
      object.receiveShadow = false;
    } else {
      object = await this.assets.createInstance(type.glb);
      if (object) object = this.centerGLBPivot(object);
    }
    if (!object) return null;
    object.name = data.name || type.name;
    object.position.set(data.position.x, data.position.y, data.position.z);
    object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    object.scale.set(data.scale.x, data.scale.y, data.scale.z);
    object.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = type.render.castShadow;
      child.receiveShadow = type.render.receiveShadow;
      this.enableFog(child.material);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) this.sky.addBackgroundFadeToMaterial(material);
    });
    return object;
  }

  // GLB files can carry many material classes. Built-in Three materials know
  // how to apply scene fog, but an author may have exported them with fog off.
  // Turn it on at map load so distance fading is consistent for every asset.
  enableFog(material) {
    for (const item of Array.isArray(material) ? material : [material]) {
      if (!item || item.fog === true) continue;
      item.fog = true;
      item.needsUpdate = true;
    }
  }

  // GLB authoring pivots are not dependable. Put the loaded scene inside a
  // neutral wrapper and offset the scene so its visual bounding-box centre is
  // at wrapper origin. Map transforms then always rotate around the model's
  // middle, in both editor and game.
  centerGLBPivot(model) {
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) return model;
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const pivot = new THREE.Group();
    pivot.name = `${model.name || "GLB"} pivot`;
    pivot.add(model);
    return pivot;
  }

  syncDataFromObject(object) {
    const data = object?.userData.mapObject;
    if (!data) return;
    Object.assign(data.position, object.position);
    data.rotation.x = object.rotation.x;
    data.rotation.y = object.rotation.y;
    data.rotation.z = object.rotation.z;
    Object.assign(data.scale, object.scale);
    void this.moveChunkRecord(data._chunkRecord);
  }

  async moveChunkRecord(record) {
    if (!record || !this.chunkStore) return;
    const x = Math.floor(record.data.position.x / this.world.chunkSize);
    const z = Math.floor(record.data.position.z / this.world.chunkSize);
    if (x === record.chunkX && z === record.chunkZ) return;
    const source = this.chunkStore.cache.get(WorldChunkStore.key(record.chunkX, record.chunkZ));
    if (source) source.objects = source.objects.filter(item => item !== record);
    const target = await this.chunkStore.load(x, z);
    target.objects.push(record);
    this.chunkStore.markDirty(source);
    this.chunkStore.markDirty(target);
    record.chunkX = x;
    record.chunkZ = z;
  }

  clear() {
    this.chunks?.clear();
    this.streamedTerrain.clear();
    this.water.clearChunks();
    this.batcher.clear();
    this.fakeShadows.clear();
    this.root.clear();
    this.objects.length = 0;
  }
  refreshBatches() {
    this.batcher.rebuild(this.objects);
    this.syncBatchedSourceAttachment();
  }
  addToBatch(object) {
    this.batcher.add(object, this.objects);
    this.syncBatchedSourceAttachment();
    this.refreshFakeShadows();
  }
  removeInstance(object) {
    if (!object) return;
    this.batcher.remove(object);
    object.removeFromParent();
    const index = this.objects.indexOf(object);
    if (index >= 0) this.objects.splice(index, 1);
    const record = object.userData.mapObject?._chunkRecord;
    if (record && this.chunkStore) {
      const chunk = this.chunkStore.cache.get(WorldChunkStore.key(record.chunkX, record.chunkZ));
      if (chunk) chunk.objects = chunk.objects.filter(item => item !== record);
      this.chunkStore.markDirty(chunk);
    }
    if (this.selectedObject === object) this.selectedObject = null;
    this.refreshFakeShadows();
  }
  removeType(type) {
    const sources = this.objects.filter(object => object.userData.assetType === type);
    this.batcher.removeType(type, sources);
    sources.forEach(object => object.removeFromParent());
    this.objects = this.objects.filter(object => object.userData.assetType !== type);
    if (this.selectedObject?.userData.assetType === type) this.selectedObject = null;
    this.refreshFakeShadows();
  }
  setTypeShadowMode(type, mode) {
    type.render.shadowMode = mode;
    type.render.castShadow = mode === "real";
    for (const object of this.objects) {
      if (object.userData.assetType !== type) continue;
      object.traverse(child => { if (child.isMesh) child.castShadow = mode === "real"; });
    }
    this.refreshBatches();
    this.refreshFakeShadows();
  }
  sculptTerrain(point, radius, amount, mode, flattenHeight) {
    const changed = this.chunkStore
      ? this.terrain.sculpt(point, radius, amount, mode, flattenHeight)
      : this.terrain.sculpt(this.world.terrain, point, radius, amount, mode, flattenHeight);
    if (changed) {
      this.markActiveChunksDirty();
      if (this.chunkStore) for (const { chunk } of this.streamedTerrain.tiles.values()) this.water.applyChunk(chunk, this.world.terrain);
      else this.water.apply(this.world.water, this.world.terrain);
    }
    return changed;
  }
  paintTerrain(point, radius, color, strength) {
    const changed = this.chunkStore
      ? this.terrain.paint(point, radius, color, strength)
      : this.terrain.paint(this.world.terrain, point, radius, color, strength);
    if (changed) this.markActiveChunksDirty();
    return changed;
  }
  paintTerrainTexture(point, radius, strength) {
    const changed = this.chunkStore
      ? this.terrain.paintTexture(point, radius, strength)
      : this.terrain.paintTexture(this.world.terrain, point, radius, strength);
    if (changed) this.markActiveChunksDirty();
    return changed;
  }
  activeTerrainChunks() { return [...this.streamedTerrain.tiles.values()].map(tile => tile.chunk); }
  shouldLoadChunk(key) {
    if (!this.chunkStore) return true;
    const [x, z] = key.split(",").map(Number);
    // Game mode never creates terrain that was not authored. In the editor,
    // the toggle permits creating new tiles while still allowing boundary
    // work with only the manifest's existing chunk coordinates loaded.
    return this.chunkStore.has(x, z) || (this.mode === "editor" && this.world.editor.autoCreateChunks);
  }
  setAutoCreateChunks(enabled, camera) {
    if (!this.chunkStore || this.mode !== "editor") return;
    this.world.editor.autoCreateChunks = Boolean(enabled);
    // Freezing automatic creation turns every generated tile into authored
    // map territory. Always include the 5x5 starter area at the origin so it
    // remains available after travelling elsewhere and teleporting back.
    if (!enabled) {
      const chunksByKey = new Map(this.chunkStore.cache);
      for (const chunk of this.activeTerrainChunks()) chunksByKey.set(WorldChunkStore.key(chunk.x, chunk.z), chunk);
      for (let z = -this.world.chunkRadius; z <= this.world.chunkRadius; z++) {
        for (let x = -this.world.chunkRadius; x <= this.world.chunkRadius; x++) {
          const key = WorldChunkStore.key(x, z);
          if (!chunksByKey.has(key)) chunksByKey.set(key, this.chunkStore.createEmptyChunk(x, z));
        }
      }
      const chunks = [...chunksByKey.values()];
      for (const chunk of chunks) {
        const key = WorldChunkStore.key(chunk.x, chunk.z);
        if (!this.chunkStore.cache.has(key)) this.chunkStore.cache.set(key, chunk);
        if (!this.world.chunks.some(item => item.x === chunk.x && item.z === chunk.z)) this.world.chunks.push({ x: chunk.x, z: chunk.z });
        this.chunkStore.markDirty(chunk);
      }
      this.calculateChunkDecorativeFlags();
    }
    this.chunks.refresh(camera);
  }
  async trimEmptyChunks(camera) {
    if (!this.chunkStore || this.mode !== "editor" || !this.world.chunks.length) return 0;
    const coordinates = this.world.chunks.map(chunk => ({ x: chunk.x, z: chunk.z }));
    const defaultColor = this.world.terrain.color;
    const isEmpty = chunk => {
      const terrain = chunk.terrain ?? {};
      const untouchedHeights = !(terrain.heights ?? []).some(height => Math.abs(Number(height) || 0) > 1e-6);
      const untouchedColors = !(terrain.colors ?? []).some(color => Number(color) !== defaultColor);
      const untouchedMasks = !(terrain.masks ?? []).some(mask => mask?.some(value => Number(value) > 1e-6));
      return untouchedHeights && untouchedColors && untouchedMasks && !(chunk.grass?.points?.length) && !(chunk.objects?.length);
    };
    const chunkData = new Map();
    for (const coordinate of coordinates) chunkData.set(`${coordinate.x},${coordinate.z}`, await this.chunkStore.load(coordinate.x, coordinate.z));
    const nonEmptyKeys = new Set([...chunkData].filter(([, chunk]) => !isEmpty(chunk)).map(([key]) => key));
    const removed = [];
    for (const coordinate of coordinates) {
      const isOrigin = coordinate.x === 0 && coordinate.z === 0;
      const isStarterChunk = Math.abs(coordinate.x) <= this.world.chunkRadius && Math.abs(coordinate.z) <= this.world.chunkRadius;
      // Preserve the immediate 3x3 decorative ring around authored terrain.
      const isDecorativeBorder = [-1, 0, 1].some(dx => [-1, 0, 1].some(dz => (dx || dz) && nonEmptyKeys.has(`${coordinate.x + dx},${coordinate.z + dz}`)));
      if (isOrigin || isStarterChunk || nonEmptyKeys.has(`${coordinate.x},${coordinate.z}`) || isDecorativeBorder) continue;
      const chunk = chunkData.get(`${coordinate.x},${coordinate.z}`);
      if (!isEmpty(chunk)) continue;
      await this.chunkStore.remove(coordinate.x, coordinate.z);
      removed.push(coordinate);
    }
    if (!removed.length) return 0;
    const removedKeys = new Set(removed.map(chunk => `${chunk.x},${chunk.z}`));
    this.world.chunks = this.world.chunks.filter(chunk => !removedKeys.has(`${chunk.x},${chunk.z}`));
    this.chunkStore.manifest.chunks = this.world.chunks;
    this.calculateChunkDecorativeFlags();
    this.chunks.refresh(camera);
    return removed.length;
  }
  markActiveChunksDirty() { if (this.chunkStore) for (const chunk of this.activeTerrainChunks()) this.chunkStore.markDirty(chunk); }
  getChunkBounds() {
    if (!this.chunkStore || !this.world.chunks?.length) {
      const size = this.world.terrain?.size;
      return Number.isFinite(size) ? { minX: -size * .5, maxX: size * .5, minZ: -size * .5, maxZ: size * .5 } : null;
    }
    const size = this.world.chunkSize;
    return {
      minX: Math.min(...this.world.chunks.map(chunk => chunk.x * size)),
      maxX: Math.max(...this.world.chunks.map(chunk => (chunk.x + 1) * size)),
      minZ: Math.min(...this.world.chunks.map(chunk => chunk.z * size)),
      maxZ: Math.max(...this.world.chunks.map(chunk => (chunk.z + 1) * size))
    };
  }
  constrainToChunkBounds(position, padding = 0.65) {
    const bounds = this.getChunkBounds();
    if (!bounds) return position;
    position.x = THREE.MathUtils.clamp(position.x, bounds.minX + padding, bounds.maxX - padding);
    position.z = THREE.MathUtils.clamp(position.z, bounds.minZ + padding, bounds.maxZ - padding);
    return position;
  }
  calculateChunkDecorativeFlags() {
    if (!this.chunkStore || !this.world.chunks?.length) return;
    const keys = new Set(this.world.chunks.map(chunk => `${chunk.x},${chunk.z}`));
    for (const chunk of this.world.chunks) {
      chunk.decorative = ![-1, 0, 1].every(dz => [-1, 0, 1].every(dx =>
        (dx === 0 && dz === 0) || keys.has(`${chunk.x + dx},${chunk.z + dz}`)
      ));
    }
    for (const { chunk } of this.streamedTerrain.tiles.values()) {
      const decoration = this.getChunkDecoration(chunk.x, chunk.z);
      this.streamedTerrain.setChunkDecorative(chunk, decoration.decorative, decoration.edges, decoration.corners);
    }
  }
  getChunkDecoration(x, z) {
    const chunks = new Map(this.world.chunks.map(chunk => [`${chunk.x},${chunk.z}`, chunk]));
    const definition = chunks.get(`${x},${z}`);
    const decorative = Boolean(definition?.decorative);
    const isPlayable = (offsetX, offsetZ) => {
      const neighbour = chunks.get(`${x + offsetX},${z + offsetZ}`);
      return Boolean(neighbour && !neighbour.decorative);
    };
    // PlaneGeometry's UV Y axis is reversed after the terrain's X rotation:
    // UV-bottom faces world +Z, while UV-top faces world -Z.
    const edges = decorative ? [isPlayable(-1, 0), isPlayable(1, 0), isPlayable(0, 1), isPlayable(0, -1)].map(Number) : [0, 0, 0, 0];
    // Soften only a true T-junction: a playable diagonal with both directly
    // adjacent chunks still decorative. Ordinary corners keep no round mark.
    const softCorner = (offsetX, offsetZ) => isPlayable(offsetX, offsetZ) && !isPlayable(offsetX, 0) && !isPlayable(0, offsetZ);
    // UV corners are: world (-X,+Z), (+X,+Z), (-X,-Z), (+X,-Z).
    const corners = decorative ? [softCorner(-1, 1), softCorner(1, 1), softCorner(-1, -1), softCorner(1, -1)].map(Number) : [0, 0, 0, 0];
    return { decorative, edges, corners };
  }
  constrainToGameplayChunks(position, previousPosition, padding = 0.05) {
    if (!this.world.chunks?.length) {
        return position;
    }

    const chunkSize = this.world.chunkSize;

    const chunksByKey = new Map(this.world.chunks.map(chunk => [`${chunk.x},${chunk.z}`, chunk]));

    const isGameplayChunk = (worldX, worldZ) => {
        const cx = Math.floor(worldX / chunkSize);
        const cz = Math.floor(worldZ / chunkSize);

        return Boolean(chunksByKey.get(`${cx},${cz}`) && !chunksByKey.get(`${cx},${cz}`).decorative);
    };

    // Try X movement first
    if (!isGameplayChunk(position.x, previousPosition.z)) {
        position.x = previousPosition.x;
    }

    // Then Z
    if (!isGameplayChunk(position.x, position.z)) {
        position.z = previousPosition.z;
    }

    return position;
}
  getGameplayBoundaryPadding(cameraClearance = 8) {
    const bounds = this.getChunkBounds();
    const chunkSize = this.world.chunkSize;
    // Reserve the outer tile ring for backdrop terrain. The player stops at
    // its inner edge, while the third-person camera may use that decorative
    // terrain behind the player. Tiny/legacy maps retain camera clearance.
    if (!bounds || !Number.isFinite(chunkSize)) return cameraClearance;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    return width > chunkSize * 1 && depth > chunkSize * 1
      ? chunkSize
      : cameraClearance;
  }
  refreshChunkedGrass() { if (this.chunkStore) this.grass.setChunkedChunks(this.activeTerrainChunks()); }
  paintGrass(point, radius) {
    if (!this.chunkStore) return this.grass.paint(this.world.grass, this.terrain, point, radius);
    const chunks = this.activeTerrainChunks();
    const changed = this.grass.paintChunked(point, radius, target => this.streamedTerrain.getTileAt(target)?.chunk, chunks);
    if (changed) this.markActiveChunksDirty();
    return changed;
  }
  eraseGrass(point, radius) {
    const changed = this.chunkStore ? this.grass.eraseChunked(point, radius, this.activeTerrainChunks()) : this.grass.erase(this.world.grass, point, radius);
    if (changed) this.markActiveChunksDirty();
    return changed;
  }
  update(delta, camera) {
    this.chunks?.update(camera);
    this.environment.update(delta, camera);
    const sun = this.environment.sun;
    this.water.update(delta, camera);
    this.water.setSunDirection(sun);
    this.grass.setSunDirection(sun);
    this.grass.setEnvironmentTint(this.environment.GrassTint, this.environment.sunsun);
    this.grass.update(delta, camera);
    if (!this.chunkStore) {
      this.groundMist.apply(this.terrain.mesh);
      this.groundMist.setHorizonColors(this.environment, this.environment.timeOfDay);
      this.groundMist.update(delta, camera);
    }
    this.fakeShadows.update(this.terrain, delta);
  }
  refreshWater() {
    if (this.chunkStore) {
      this.water.beginChunked(this.world.water);
      for (const { chunk } of this.streamedTerrain.tiles.values()) this.water.applyChunk(chunk, this.world.terrain);
    } else this.water.apply(this.world.water, this.world.terrain);
  }
  refreshFakeShadows() { this.fakeShadows.rebuild(this.objects, this.terrain); }
  setSelected(object) {
    this.batcher.setSelected(object);
    this.selectedObject = object ?? null;
    this.syncBatchedSourceAttachment();
  }
  syncBatchedSourceAttachment() {
    for (const object of this.objects) {
      if (!this.batcher.has(object)) {
        if (!object.parent) this.root.add(object);
        continue;
      }
      if (object === this.selectedObject) {
        if (!object.parent) this.root.add(object);
      } else {
        // Keep sources available for picker/tools but out of the scene graph.
        // This avoids per-frame traversal of tens of thousands of GLB clones.
        object.visible = true;
        object.removeFromParent();
      }
    }
  }
}
