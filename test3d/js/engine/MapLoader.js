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
    this.environment = new EnvironmentSystem({ scene, sky: this.sky, assets });
    this.selectedObject = null;
    // Both play mode and the editor use the same active 9x9 object window.
    // The editor retains the map data for authoring, but only nearby scene
    // instances are created and rendered.
    this.chunks = new ChunkSystem({
      chunkSize: 50,
      radius: 4,
      loadChunk: (entries, key) => this.loadChunk(entries, key),
      unloadChunk: objects => this.unloadChunk(objects),
      shouldLoad: key => this.shouldLoadChunk(key),
      setChunkVisible: (key, objects, visible) => this.setChunkVisible(key, objects, visible),
      onChanged: () => {
        this.measure("Chunk batches", () => this.refreshBatches());
        this.measure("Chunk fake shadows", () => this.refreshFakeShadows());
        this.measure("Chunk mist", () => this.refreshChunkedGroundMist());
        // ChunkSystem finishes a whole window change before this callback.
        // Rebuilding the grass grid per entering tile caused five identical
        // full rebuilds whenever the camera crossed one chunk boundary.
        this.measure("Chunk grass", () => this.refreshChunkedGrass());
      }
    });
  }
  measure(label, callback) { return this.scene.userData.performanceInfo?.measure(label, callback) ?? callback(); }

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
        terrain: { enabled: legacy.terrain.enabled, color: legacy.terrain.color, baseTexture: legacy.terrain.baseTexture, textures: legacy.terrain.textures, activeTexture: legacy.terrain.activeTexture },
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
    // Chunk manifests keep asset definitions but intentionally omit their
    // instance arrays. Rebuild that editor-facing index from every chunk so
    // the asset tree represents the complete map, not only the streamed 9x9
    // window around the camera.
    if (this.chunkStore) await this.indexChunkedObjects();
    await this.rebuild();
    return this.world;
  }

  async indexChunkedObjects() {
    for (const layer of this.world.layers) {
      for (const type of layer.assetTypes) type.instances = [];
    }
    for (const coordinate of this.world.chunks ?? []) {
      const chunk = await this.chunkStore.load(coordinate.x, coordinate.z);
      for (const record of chunk.objects ?? []) {
        const layer = this.world.layers.find(item => item.id === record.layerId);
        const type = layer?.assetTypes.find(item => item.id === record.typeId);
        if (!type || !record.data) continue;
        record.chunkX ??= chunk.x;
        record.chunkZ ??= chunk.z;
        // Older duplicate commands appended " copy" repeatedly. Keep object
        // labels clean now that instances are identified by their stable id.
        const cleanName = typeof record.data.name === "string"
          ? record.data.name.replace(/(?:\s+copy)+$/i, "")
          : "";
        if (cleanName && cleanName !== record.data.name) {
          record.data.name = cleanName;
          this.chunkStore.markDirty(chunk);
        }
        record.data._chunkRecord = record;
        type.instances.push(record.data);
      }
    }
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
      this.groundMist.applyChunks(this.streamedTerrain.meshes);
    } else {
      this.terrain = this.monolithicTerrain;
      this.terrain.apply(this.world.terrain);
      this.groundMist.apply(this.terrain.mesh);
      this.water.apply(this.world.water, this.world.terrain);
      await this.grass.apply(this.world.grass, this.terrain);
    }
    this.water.setSunDirection(this.sky.findDirectionalLight(), this.environment.sunsun);
    this.sky.addBackgroundFadeToMaterial(this.chunkStore ? this.streamedTerrain.material : this.terrain.mesh?.material);
    if (this.chunkStore) this.sky.addBackgroundFadeToMaterial(this.water.material);
    if (!this.chunkStore) {
      this.sky.addBackgroundFadeToMaterial(this.water.mesh?.material);
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
      chunk._decorativeOuterEdges = decoration.outerEdges;
      chunk._decorativeOuterCorners = decoration.outerCorners;
      objects.terrainChunk = chunk;
      const terrainMesh = this.streamedTerrain.loadChunk(chunk);
      this.streamedTerrain.updateCliffWall(chunk);
      // A diagonal decorative tile builds the rock connector between two
      // adjacent wall chunks. Refresh this small neighbourhood as tiles stream
      // in, so the connector appears once both source walls are available.
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const nearby = this.streamedTerrain.getTileAt({ x: (x + offsetX + .5) * this.world.chunkSize, z: (z + offsetZ + .5) * this.world.chunkSize });
       
      }
      if (terrainMesh.userData.cliffWall) this.sky.addBackgroundFadeToMaterial(terrainMesh.userData.cliffWall.material);
      this.water.applyChunk(chunk, this.world.terrain);
      objects.waterChunk = chunk;
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
  setChunkVisible(key, objects, visible) {
    const terrain = this.streamedTerrain.tiles.get(key)?.mesh;
    if (terrain) terrain.visible = visible;
    const water = this.water.chunkMeshes?.get(key);
    if (water) water.visible = visible;
    for (const object of objects) {
      // Characters/animals use bones or authored animation pivots. They are
      // not part of the static batch and must remain live when their source
      // chunk falls outside the editor camera's frustum.
      const keepLive = object.userData.keepAuthoredPivot || object.userData.hasSkinnedMeshes || object.userData.animations?.length;
      this.batcher.setChunkVisible(object, keepLive ? true : visible);
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
      if (object) {
        const keepsAuthoredPivot = object.userData.hasSkinnedMeshes || object.userData.animations?.length;
        if (keepsAuthoredPivot) {
          // Characters exported from MaxPaint carry an explicit skeleton and
          // animation pivots. Recentering their visual bounds moves the model
          // away from its authored root and makes editor moves appear broken.
          // They also cannot use the static InstancedMesh batcher.
          type.render.instanced = false;
          object.userData.keepAuthoredPivot = true;
        } else object = this.centerGLBPivot(object);
      }
    }
    if (!object) return null;
    object.name = data.name || type.name;
    object.position.set(data.position.x, data.position.y, data.position.z);
    object.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    object.scale.set(data.scale.x, data.scale.y, data.scale.z);
    object.traverse(child => {
      if (!child.isMesh) return;
      // MaxPaint leaf batches intentionally never render to the shadow map.
      // Its optional SHADOW_PROXY_* mesh lives on the sun-only layer and is
      // the single low-poly caster for the entire canopy instead.
      child.castShadow = child.userData.shadowProxy
        ? type.render.castShadow
        : child.userData.maxPaintLeafBatch ? false : type.render.castShadow;
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
  async removeType(type) {
    const layer = this.world.layers.find(item => item.assetTypes.includes(type));
    const sources = this.objects.filter(object => object.userData.assetType === type);
    this.batcher.removeType(type, sources);
    sources.forEach(object => object.removeFromParent());
    this.objects = this.objects.filter(object => object.userData.assetType !== type);
    if (this.selectedObject?.userData.assetType === type) this.selectedObject = null;
    // Objects outside the streamed window do not have scene instances, but
    // their chunk records must be removed too or they return on a later load.
    if (this.chunkStore) {
      for (const coordinate of this.world.chunks ?? []) {
        const chunk = await this.chunkStore.load(coordinate.x, coordinate.z);
        const before = chunk.objects?.length ?? 0;
        chunk.objects = (chunk.objects ?? []).filter(record =>
          record.layerId !== layer?.id || record.typeId !== type.id
        );
        if (chunk.objects.length !== before) this.chunkStore.markDirty(chunk);
      }
    }
    type.instances = [];
    this.refreshFakeShadows();
  }
  setTypeShadowMode(type, mode) {
    type.render.shadowMode = mode;
    type.render.castShadow = mode === "real";
    for (const object of this.objects) {
      if (object.userData.assetType !== type) continue;
      object.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = child.userData.shadowProxy
          ? mode === "real"
          : child.userData.maxPaintLeafBatch ? false : mode === "real";
      });
    }
    this.refreshBatches();
    this.refreshFakeShadows();
  }
  sculptTerrain(point, radius, amount, mode, flattenHeight, rockStamp = null) {
    const changed = this.chunkStore
      ? this.terrain.sculpt(point, radius, amount, mode, flattenHeight, rockStamp)
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
    if (this.chunkStore.has(x, z)) return true;
    if (this.mode !== "editor" || !this.world.editor.autoCreateChunks) return false;
    return !this.isDecorativeChunkMoat(x, z) && this.isConnectedToMainLand(x, z);
  }
  isDecorativeChunkMoat(x, z) {
    // Keep a complete one-chunk gap, including corners, around each explicit
    // decorative chunk. This is the reserved visual boundary around land.
    return this.world.chunks.some(chunk => chunk.decorative &&
      Math.abs(chunk.x - x) <= 1 && Math.abs(chunk.z - z) <= 1
    );
  }
  isConnectedToMainLand(x, z) {
    const definitions = new Map(this.world.chunks.map(chunk => [`${chunk.x},${chunk.z}`, chunk]));
    const normalKnownChunk = (cx, cz) => {
      const definition = definitions.get(`${cx},${cz}`);
      return definition ? !definition.decorative : this.chunkStore.cache.has(WorldChunkStore.key(cx, cz));
    };
    // The origin component is the main land. Cached automatic tiles may
    // extend it while the editor is open, but a camera jump cannot create a
    // disconnected island because there is no route back to this component.
    if (!normalKnownChunk(0, 0)) return false;
    const queue = [[0, 0]], visited = new Set(["0,0"]);
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      const [cx, cz] = queue.shift();
      for (const [dx, dz] of directions) {
        const nx = cx + dx, nz = cz + dz;
        if (nx === x && nz === z) return true;
        const neighbourKey = `${nx},${nz}`;
        if (visited.has(neighbourKey) || !normalKnownChunk(nx, nz) || this.isDecorativeChunkMoat(nx, nz)) continue;
        visited.add(neighbourKey);
        queue.push([nx, nz]);
      }
    }
    return false;
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
    }
    this.calculateChunkDecorativeFlags();
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
      return untouchedHeights && untouchedColors && untouchedMasks && !(chunk.grass?.points?.length) && !(chunk.grass?.mask?.some(value => Number(value) > 1e-6)) && !(chunk.objects?.length);
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
  async setChunkDecorative(x, z, decorative, camera) {
    if (!this.chunkStore || this.mode !== "editor") return false;
    const chunk = await this.chunkStore.load(x, z);
    let definition = this.world.chunks.find(item => item.x === x && item.z === z);
    if (!definition) {
      definition = { x, z, decorative: Boolean(decorative) };
      this.world.chunks.push(definition);
    } else {
      definition.decorative = Boolean(decorative);
    }
    this.chunkStore.cache.set(WorldChunkStore.key(x, z), chunk);
    this.chunkStore.markDirty(chunk);
    this.calculateChunkDecorativeFlags();
    this.chunks.refresh(camera);
    return true;
  }
  async deleteChunk(x, z, camera) {
    if (!this.chunkStore || this.mode !== "editor") return false;
    const index = this.world.chunks.findIndex(item => item.x === x && item.z === z);
    if (index < 0) return false;
    const chunk = await this.chunkStore.load(x, z);
    for (const record of chunk.objects ?? []) {
      const type = this.world.layers.find(layer => layer.id === record.layerId)
        ?.assetTypes.find(item => item.id === record.typeId);
      if (type && record.data) type.instances = type.instances.filter(item => item !== record.data);
    }
    const key = this.chunks.key(x, z);
    const active = this.chunks.active.get(key);
    if (active) {
      this.chunks.active.delete(key);
      this.unloadChunk(active);
    }
    await this.chunkStore.remove(x, z);
    this.world.chunks.splice(index, 1);
    this.chunkStore.manifest.chunks = this.world.chunks;
    this.calculateChunkDecorativeFlags();
    this.chunks.refresh(camera);
    return true;
  }
  async paintDecorativeChunks(camera = null) {
    if (!this.chunkStore || this.mode !== "editor") return { painted: 0, hilled: 0, skipped: 0 };

    this.calculateChunkDecorativeFlags();
    const targets = this.world.chunks.filter(chunk => chunk.decorative);
    // Once the current generator has painted a decorative chunk, a later run
    // is an explicit full rebuild. This makes changed decorative boundaries
    // deterministic: every ridge and grass field is regenerated together.
    const rebuildAll = (await Promise.all(targets.map(definition => this.chunkStore.load(definition.x, definition.z))))
      .some(chunk => (Number(chunk.terrain?.decorativeHillsVersion) || 0) >= 13);
    const size = this.world.chunkSize;
    const density = Math.max(8000, Math.round((this.world.grass?.density ?? 2) * 6000));
    const random = seed => {
      const value = Math.sin(seed) * 43758.5453123;
      return value - Math.floor(value);
    };
    let painted = 0;
    let hilled = 0;
    let skipped = 0;

    for (const definition of targets) {
      const chunk = await this.chunkStore.load(definition.x, definition.z);
      chunk.grass ??= { points: [] };
      chunk.grass.points ??= [];
      const hillVersion = Number(chunk.terrain?.decorativeHillsVersion) || 0;
      // Version 13 widens the bare cliff buffer. Re-running the editor action
      // upgrades previous generated borders and removes their grass points.
      const refreshGeneratedHills = rebuildAll || (hillVersion > 0 && hillVersion < 13) || this.hasLegacyDecorativeHills(chunk, definition);
      // This command creates base cover once. Re-running it must not pile
      // hundreds more blades onto chunks the user has already painted. The
      // previous auto-hill profile is the sole exception: repair it in place.
      if (chunk.grass.points.length && !refreshGeneratedHills) {
        skipped++;
        continue;
      }

      if (rebuildAll && chunk.grass.points.length) {
        chunk.grass.points = [];
        chunk.grass.revision = (Number(chunk.grass.revision) || 0) + 1;
      }

      // Add terrain before sampling grass height. Only untouched, flat tiles
      // are changed: a decorative chunk the user has already sculpted remains
      // exactly as authored.
      const changedHills = await this.makeDecorativeChunkHilly(chunk, definition, refreshGeneratedHills);
      if (changedHills) {
        hilled++;
        // A repaired auto-hill must move its existing grass down/up with the
        // terrain; otherwise the blades appear to float over the water.
        for (const blade of chunk.grass.points) blade.y = this.getChunkHeight(chunk, blade.x, blade.z);
        chunk.grass.revision = (Number(chunk.grass.revision) || 0) + 1;
      }
      // The cliff face and its crest are deliberately bare.
      const cliffEdges = this.getChunkDecoration(definition.x, definition.z).edges;
      const cliffGrassClearance = 2.0;
      const isOnCliff = (x, z) => Math.min(
        cliffEdges[0] ? x - definition.x * size : Infinity,
        cliffEdges[1] ? (definition.x + 1) * size - x : Infinity,
        cliffEdges[2] ? (definition.z + 1) * size - z : Infinity,
        cliffEdges[3] ? z - definition.z * size : Infinity
      ) < cliffGrassClearance;
      if (changedHills) {
        const previousCount = chunk.grass.points.length;
        chunk.grass.points = chunk.grass.points.filter(point => !isOnCliff(point.x, point.z));
        if (chunk.grass.points.length !== previousCount) {
          chunk.grass.revision = (Number(chunk.grass.revision) || 0) + 1;
        }
      }
      if (chunk.grass.points.length) {
        this.chunkStore.markDirty(chunk);
        skipped++;
        continue;
      }

      const seed = definition.x * 73856093 + definition.z * 19349663;
      for (let index = 0; index < density; index++) {
        const x = definition.x * size + random(seed + index * 17.13) * size;
        const z = definition.z * size + random(seed + index * 31.79 + 0.5) * size;
        if (isOnCliff(x, z)) continue;
        chunk.grass.points.push({
          x,
          z,
          y: this.getChunkHeight(chunk, x, z),
          scale: 0.55 + random(seed + index * 47.17) * 0.35,
          height: 0.55 + random(seed + index * 61.43) * 0.35,
          rotation: random(seed + index * 73.91) * Math.PI * 2
        });
      }
      this.chunkStore.markDirty(chunk);
      painted++;
    }

    this.refreshChunkedGrass();
    // Re-evaluate the streamed window after establishing the decorative map
    // boundary, removing any temporary editor tiles beyond the new ridge.
    this.chunks?.refresh(camera);
    return { painted, hilled, skipped };
  }
  hasLegacyDecorativeHills(chunk, definition) {
    const resolution = this.world.terrain?.resolution ?? 50;
    const heights = chunk.terrain?.heights ?? [];
    if (heights.length < (resolution + 1) ** 2) return false;
    const { edges } = this.getChunkDecoration(definition.x, definition.z);
    const samples = [.18, .41, .67, .84];
    const size = this.world.chunkSize;
    const legacyHeightAt = (u, v) => {
      const worldX = (definition.x + u) * size;
      const worldZ = (definition.z + v) * size;
      const hill = 1.7 * Math.sin(worldX * 0.075 + worldZ * 0.042)
        + 0.8 * Math.sin(worldX * 0.17 - worldZ * 0.11 + 1.3);
      let fade = 1;
      if (edges[0]) fade *= THREE.MathUtils.smoothstep(u, 0, 0.28);
      if (edges[1]) fade *= THREE.MathUtils.smoothstep(1 - u, 0, 0.28);
      if (edges[2]) fade *= THREE.MathUtils.smoothstep(v, 0, 0.28);
      if (edges[3]) fade *= THREE.MathUtils.smoothstep(1 - v, 0, 0.28);
      return hill * fade;
    };
    return samples.every((u, index) => {
      const v = samples[(index + 2) % samples.length];
      const x = Math.round(u * resolution), z = Math.round(v * resolution);
      return Math.abs((Number(heights[z * (resolution + 1) + x]) || 0) - legacyHeightAt(x / resolution, z / resolution)) < 1e-4;
    });
  }
  async makeDecorativeChunkHilly(chunk, definition, replaceGenerated = false) {
  const resolution = this.world.terrain?.resolution ?? 50;
  const width = resolution + 1;
  const count = width * width;
  const size = this.world.chunkSize;

  chunk.terrain ??= {};
  chunk.terrain.heights ??= [];

  while (chunk.terrain.heights.length < count) {
    chunk.terrain.heights.push(0);
  }

  const heights = chunk.terrain.heights;

  // Do not overwrite manually edited terrain unless explicitly requested.
  if (
    !replaceGenerated &&
    heights.some(height => Math.abs(Number(height) || 0) > 1e-6)
  ) {
    return false;
  }

  const cx = definition.x;
  const cz = definition.z;

  const decoration =
    this.getChunkDecoration(cx, cz);

  const edges = decoration?.edges ?? [false, false, false, false];
  const outerEdges =
    decoration?.outerEdges ?? [false, false, false, false];

  /*
      Direction convention:

      0 = x - 1   LEFT
      1 = x + 1   RIGHT
      2 = z + 1   FORWARD
      3 = z - 1   BACK
  */

  // --------------------------------------------------
  // Cardinal neighbours
  // --------------------------------------------------

  const neighbours = await Promise.all([
    edges[0]
      ? this.chunkStore.load(cx - 1, cz)
      : null,

    edges[1]
      ? this.chunkStore.load(cx + 1, cz)
      : null,

    edges[2]
      ? this.chunkStore.load(cx, cz + 1)
      : null,

    edges[3]
      ? this.chunkStore.load(cx, cz - 1)
      : null
  ]);

  // --------------------------------------------------
  // Terrain validation
  // --------------------------------------------------

  const hasValidTerrain = neighbour => {
    return (
      neighbour &&
      Array.isArray(neighbour.terrain?.heights) &&
      neighbour.terrain.heights.length >= count
    );
  };

  const getHeight = (neighbour, index) => {
    if (!hasValidTerrain(neighbour)) {
      return null;
    }

    const value =
      Number(neighbour.terrain.heights[index]);

    if (!Number.isFinite(value)) {
      return null;
    }

    return value;
  };

  const validNeighbours =
    neighbours.map(hasValidTerrain);

  // --------------------------------------------------
  // Detect diagonal playable corners
  // --------------------------------------------------
  //
  // Example:
  //
  // decorative | decorative
  // ------------+------------
  // decorative | playable
  //
  // The top-left decorative chunk has no direct playable
  // neighbour, but its corner still touches playable terrain.
  // --------------------------------------------------

  const leftDecoration =
    this.getChunkDecoration(cx - 1, cz) ?? {};

  const rightDecoration =
    this.getChunkDecoration(cx + 1, cz) ?? {};

  const forwardDecoration =
    this.getChunkDecoration(cx, cz + 1) ?? {};

  const backDecoration =
    this.getChunkDecoration(cx, cz - 1) ?? {};

  const leftEdges =
    leftDecoration.edges ?? [false, false, false, false];

  const rightEdges =
    rightDecoration.edges ?? [false, false, false, false];

  const forwardEdges =
    forwardDecoration.edges ?? [false, false, false, false];

  const backEdges =
    backDecoration.edges ?? [false, false, false, false];

  /*
      Corner order:

      0 = x-, z-
      1 = x+, z-
      2 = x-, z+
      3 = x+, z+
  */

  const cornerJoins = [
    // x-, z-
    !!(
      leftEdges[3] ||
      backEdges[0]
    ),

    // x+, z-
    !!(
      rightEdges[3] ||
      backEdges[1]
    ),

    // x-, z+
    !!(
      leftEdges[2] ||
      forwardEdges[0]
    ),

    // x+, z+
    !!(
      rightEdges[2] ||
      forwardEdges[1]
    )
  ];

  // --------------------------------------------------
  // Diagonal neighbours
  // --------------------------------------------------

  const diagonalNeighbours =
    await Promise.all([
      cornerJoins[0]
        ? this.chunkStore.load(cx - 1, cz - 1)
        : null,

      cornerJoins[1]
        ? this.chunkStore.load(cx + 1, cz - 1)
        : null,

      cornerJoins[2]
        ? this.chunkStore.load(cx - 1, cz + 1)
        : null,

      cornerJoins[3]
        ? this.chunkStore.load(cx + 1, cz + 1)
        : null
    ]);

  // --------------------------------------------------
  // Exact diagonal corner heights
  // --------------------------------------------------

  const cornerHeights = [
    // Our x-,z- touches diagonal x+,z+
    getHeight(
      diagonalNeighbours[0],
      resolution * width + resolution
    ),

    // Our x+,z- touches diagonal x-,z+
    getHeight(
      diagonalNeighbours[1],
      resolution * width
    ),

    // Our x-,z+ touches diagonal x+,z-
    getHeight(
      diagonalNeighbours[2],
      resolution
    ),

    // Our x+,z+ touches diagonal x-,z-
    getHeight(
      diagonalNeighbours[3],
      0
    )
  ];

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  const smoothEdge = distance =>
    THREE.MathUtils.smoothstep(
      distance,
      0,
      0.28
    );

  const waterFloor = Math.max(
    0,
    (Number(this.world.water?.level) || 0) + 0.25
  );

  // --------------------------------------------------
  // Generate terrain
  // --------------------------------------------------

  for (let z = 0; z <= resolution; z++) {
    for (let x = 0; x <= resolution; x++) {

      const index =
        z * width + x;

      const u =
        x / resolution;

      const v =
        z / resolution;

      const worldX =
        (cx + u) * size;

      const worldZ =
        (cz + v) * size;

      // ----------------------------------------------
      // Rolling hills
      // ----------------------------------------------

            const rollingHill =
        1.8 +
        1.11 *
          Math.sin(
            worldX * 0.075 +
            worldZ * 0.042
          ) +
        1.7 *
          Math.sin(
            worldX * 0.17 -
            worldZ * 0.11 +
            2.3
          );
 +
        1.4 *
          Math.sin(
            worldX * 0.22 -
            worldZ * 0.22 +
            2.3
          );

 +
        1.6 *
          Math.sin(
            worldX * 0.44 -
            worldZ * 0.32 +
            2.3
          );

      // ----------------------------------------------
      // Outer world ridge
      // ----------------------------------------------

      const outerRise =
        Math.max(

          // LEFT
          outerEdges[0]
            ? THREE.MathUtils.smoothstep(
                1 - u,
                0.12,
                0.92
              )
            : 0,

          // RIGHT
          outerEdges[1]
            ? THREE.MathUtils.smoothstep(
                u,
                0.12,
                0.92
              )
            : 0,

          // Z+
          outerEdges[2]
            ? THREE.MathUtils.smoothstep(
                v,
                0.12,
                0.92
              )
            : 0,

          // Z-
          outerEdges[3]
            ? THREE.MathUtils.smoothstep(
                1 - v,
                0.12,
                0.92
              )
            : 0
        );

      const ridgeHeight =
        waterFloor + 2.5;

      const generatedHeight =
        waterFloor +
        rollingHill * (1 - outerRise) +
        (ridgeHeight - waterFloor) *
          outerRise;

      // ----------------------------------------------
      // Gather edge influences
      // ----------------------------------------------

      const edgeSamples = [];

      // LEFT
      //
      // current x=0
      // neighbour x=resolution
      if (validNeighbours[0]) {

        const influence =
          1 - smoothEdge(u);

        const neighbourIndex =
          z * width + resolution;

        const h =
          getHeight(
            neighbours[0],
            neighbourIndex
          );

        if (
          h !== null &&
          influence > 0
        ) {
          edgeSamples.push({
            influence,
            height: h
          });
        }
      }

      // RIGHT
      //
      // current x=resolution
      // neighbour x=0
      if (validNeighbours[1]) {

        const influence =
          1 - smoothEdge(1 - u);

        const neighbourIndex =
          z * width;

        const h =
          getHeight(
            neighbours[1],
            neighbourIndex
          );

        if (
          h !== null &&
          influence > 0
        ) {
          edgeSamples.push({
            influence,
            height: h
          });
        }
      }

      // Z+
      //
      // current z=resolution
      // neighbour z=0
      if (validNeighbours[2]) {

        const influence =
          1 - smoothEdge(1 - v);

        const neighbourIndex =
          x;

        const h =
          getHeight(
            neighbours[2],
            neighbourIndex
          );

        if (
          h !== null &&
          influence > 0
        ) {
          edgeSamples.push({
            influence,
            height: h
          });
        }
      }

      // Z-
      //
      // current z=0
      // neighbour z=resolution
      if (validNeighbours[3]) {

        const influence =
          1 - smoothEdge(v);

        const neighbourIndex =
          resolution * width + x;

        const h =
          getHeight(
            neighbours[3],
            neighbourIndex
          );

        if (
          h !== null &&
          influence > 0
        ) {
          edgeSamples.push({
            influence,
            height: h
          });
        }
      }

      // ----------------------------------------------
      // Diagonal corner influence
      // ----------------------------------------------

      const addCornerSample = (
        cornerU,
        cornerV,
        height
      ) => {

        if (height === null) {
          return;
        }

        const distance =
          Math.hypot(
            u - cornerU,
            v - cornerV
          );

        // Same approximate width as the normal
        // playable-edge transition.
        const influence =
          1 -
          THREE.MathUtils.smoothstep(
            distance,
            0,
            0.28
          );

        if (influence <= 0) {
          return;
        }

        edgeSamples.push({
          influence,
          height
        });
      };

      // x-, z-
      if (cornerJoins[0]) {
        addCornerSample(
          0,
          0,
          cornerHeights[0]
        );
      }

      // x+, z-
      if (cornerJoins[1]) {
        addCornerSample(
          1,
          0,
          cornerHeights[1]
        );
      }

      // x-, z+
      if (cornerJoins[2]) {
        addCornerSample(
          0,
          1,
          cornerHeights[2]
        );
      }

      // x+, z+
      if (cornerJoins[3]) {
        addCornerSample(
          1,
          1,
          cornerHeights[3]
        );
      }

      // ----------------------------------------------
      // Blend
      // ----------------------------------------------

      if (edgeSamples.length === 0) {

        heights[index] =
          generatedHeight;

      } else {

        let totalWeight = 0;
        let weightedHeight = 0;
        let edgeInfluence = 0;

        for (const sample of edgeSamples) {

          totalWeight +=
            sample.influence;

          weightedHeight +=
            sample.height *
            sample.influence;

          // Important:
          // max instead of multiplying fades.
          //
          // Multiplication causes deep holes where
          // two edges meet.
          edgeInfluence =
            Math.max(
              edgeInfluence,
              sample.influence
            );
        }

        const sharedHeight =
          totalWeight > 0
            ? weightedHeight /
              totalWeight
            : generatedHeight;

        heights[index] =
          THREE.MathUtils.lerp(
            generatedHeight,
            sharedHeight,
            edgeInfluence
          );
      }
    }
  }

  // --------------------------------------------------
  // Exact cardinal seams
  // --------------------------------------------------

  const copyEdge = (
    targetIndex,
    neighbour,
    sourceIndex
  ) => {

    const value =
      getHeight(
        neighbour,
        sourceIndex
      );

    if (value === null) {
      return;
    }

    heights[targetIndex] =
      value;
  };

  // LEFT
  if (validNeighbours[0]) {
    for (
      let z = 0;
      z <= resolution;
      z++
    ) {

      copyEdge(
        z * width,
        neighbours[0],
        z * width + resolution
      );
    }
  }

  // RIGHT
  if (validNeighbours[1]) {
    for (
      let z = 0;
      z <= resolution;
      z++
    ) {

      copyEdge(
        z * width + resolution,
        neighbours[1],
        z * width
      );
    }
  }

  // Z+
  if (validNeighbours[2]) {
    for (
      let x = 0;
      x <= resolution;
      x++
    ) {

      copyEdge(
        resolution * width + x,
        neighbours[2],
        x
      );
    }
  }

  // Z-
  if (validNeighbours[3]) {
    for (
      let x = 0;
      x <= resolution;
      x++
    ) {

      copyEdge(
        x,
        neighbours[3],
        resolution * width + x
      );
    }
  }

  // --------------------------------------------------
  // Exact diagonal corners
  // --------------------------------------------------
  //
  // A terrain vertex at a chunk corner is shared
  // between FOUR chunks.
  //
  // The cardinal seam pass above cannot guarantee
  // correctness if playable terrain only touches
  // diagonally.
  // --------------------------------------------------

  // x-, z-
  if (
    cornerJoins[0] &&
    cornerHeights[0] !== null
  ) {
    heights[0] =
      cornerHeights[0];
  }

  // x+, z-
  if (
    cornerJoins[1] &&
    cornerHeights[1] !== null
  ) {
    heights[resolution] =
      cornerHeights[1];
  }

  // x-, z+
  if (
    cornerJoins[2] &&
    cornerHeights[2] !== null
  ) {
    heights[
      resolution * width
    ] = cornerHeights[2];
  }

  // x+, z+
  if (
    cornerJoins[3] &&
    cornerHeights[3] !== null
  ) {
    heights[
      resolution * width +
      resolution
    ] = cornerHeights[3];
  }

  // Turn playable borders into actual vertical cliffs rather than raising an
  // interior row (which only makes a triangular ramp). The height arrays on
  // the decorative mesh carry the cliff top; ChunkedTerrain draws the wall
  // down to these saved playable-edge heights as separate geometry.
  const cliffEdges = Array.from({ length: 4 }, () => Array(width).fill(null));
  const cliffHeight = (worldX, worldZ) => THREE.MathUtils.clamp(
    1.7
    + 0.18 * Math.sin(worldX * 0.24 + worldZ * 0.17)
    + 0.08 * Math.sin(worldX * 0.53 - worldZ * 0.36 + 1.6),
    1.4,
    2.0
  );
  const raiseCliffEdge = (edge, edgeIndex, vertex, height, worldX, worldZ) => {
    if (height === null) return;
    cliffEdges[edge][edgeIndex] = height;
    heights[vertex] = Math.max(heights[vertex], height + cliffHeight(worldX, worldZ));
  };
  if (validNeighbours[0]) for (let z = 0; z <= resolution; z++) {
    raiseCliffEdge(0, z, z * width, getHeight(neighbours[0], z * width + resolution), cx * size, (cz + z / resolution) * size);
  }
  if (validNeighbours[1]) for (let z = 0; z <= resolution; z++) {
    raiseCliffEdge(1, z, z * width + resolution, getHeight(neighbours[1], z * width), (cx + 1) * size, (cz + z / resolution) * size);
  }
  if (validNeighbours[2]) for (let x = 0; x <= resolution; x++) {
    raiseCliffEdge(2, x, resolution * width + x, getHeight(neighbours[2], x), (cx + x / resolution) * size, (cz + 1) * size);
  }
  if (validNeighbours[3]) for (let x = 0; x <= resolution; x++) {
    raiseCliffEdge(3, x, x, getHeight(neighbours[3], resolution * width + x), (cx + x / resolution) * size, cz * size);
  }
  chunk.terrain.cliffEdges = cliffEdges;

  // New generator version.
  chunk.terrain.decorativeHillsVersion = 13;

  // --------------------------------------------------
  // Update currently loaded terrain mesh
  // --------------------------------------------------

  const tile =
    this.streamedTerrain.getTileAt({
      x: (cx + 0.5) * size,
      z: (cz + 0.5) * size
    });

  if (tile?.chunk === chunk) {

    const geometry =
      tile.mesh.geometry;

    const positions =
      geometry.getAttribute(
        "position"
      );

    for (
      let index = 0;
      index < count;
      index++
    ) {

      positions.setY(
        index,
        heights[index]
      );
    }

    positions.needsUpdate = true;

    // Use surrounding loaded chunks when calculating edge normals. This keeps
    // terrain lighting continuous across the decorative chunk seam.
    this.streamedTerrain.refreshNormalsAround(cx, cz);
    const cliffWall = this.streamedTerrain.updateCliffWall(chunk);
    if (cliffWall) this.sky.addBackgroundFadeToMaterial(cliffWall.material);

    this.water.applyChunk(
      chunk,
      this.world.terrain
    );
  }

  this.chunkStore.markDirty(chunk);

  return true;
}
  getChunkHeight(chunk, worldX, worldZ) {
    const resolution = this.world.terrain?.resolution ?? 50;
    const heights = chunk.terrain?.heights ?? [];
    if (heights.length < (resolution + 1) ** 2) return 0;
    const size = this.world.chunkSize;
    const localX = THREE.MathUtils.clamp((worldX - chunk.x * size) / size * resolution, 0, resolution);
    const localZ = THREE.MathUtils.clamp((worldZ - chunk.z * size) / size * resolution, 0, resolution);
    const x0 = Math.floor(localX), z0 = Math.floor(localZ);
    const x1 = Math.min(resolution, x0 + 1), z1 = Math.min(resolution, z0 + 1);
    const tx = localX - x0, tz = localZ - z0;
    const valueAt = (x, z) => Number(heights[z * (resolution + 1) + x]) || 0;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(valueAt(x0, z0), valueAt(x1, z0), tx),
      THREE.MathUtils.lerp(valueAt(x0, z1), valueAt(x1, z1), tx),
      tz
    );
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
    for (const { chunk } of this.streamedTerrain.tiles.values()) {
      const decoration = this.getChunkDecoration(chunk.x, chunk.z);
      this.streamedTerrain.setChunkDecorative(chunk, decoration.decorative, decoration.edges, decoration.corners, decoration.outerEdges, decoration.outerCorners);
    
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
    const exists = (offsetX, offsetZ) => chunks.has(`${x + offsetX},${z + offsetZ}`);
    // PlaneGeometry's UV Y axis is reversed after the terrain's X rotation:
    // UV-bottom faces world +Z, while UV-top faces world -Z.
    const edges = decorative ? [isPlayable(-1, 0), isPlayable(1, 0), isPlayable(0, 1), isPlayable(0, -1)].map(Number) : [0, 0, 0, 0];
    // Soften only a true T-junction: a playable diagonal with both directly
    // adjacent chunks still decorative. Ordinary corners keep no round mark.
    const softCorner = (offsetX, offsetZ) => isPlayable(offsetX, offsetZ) && !isPlayable(offsetX, 0) && !isPlayable(0, offsetZ);
    // UV corners are: world (-X,+Z), (+X,+Z), (-X,-Z), (+X,-Z).


    
    const corners = decorative ? [softCorner(-1, 1), softCorner(1, 1), softCorner(-1, -1), softCorner(1, -1)].map(Number) : [0, 0, 0, 0];

    const outerEdges = decorative
        ? [
            !exists(-1, 0), // left
            !exists( 1, 0), // right
            !exists( 0, 1), // bottom / +Z
            !exists( 0,-1)  // top / -Z
          ].map(Number)
        : [0, 0, 0, 0];

    // A chunk can meet the world exterior only diagonally, between two chunks
    // that still exist on its cardinal sides. Flag that corner so the sky fade
    // rounds into the gap instead of ending in a pointed V.
    const outerCorner = (offsetX, offsetZ) => !exists(offsetX, offsetZ) && exists(offsetX, 0) && exists(0, offsetZ);
    const outerCorners = decorative
      ? [outerCorner(-1, 1), outerCorner(1, 1), outerCorner(-1, -1), outerCorner(1, -1)].map(Number)
      : [0, 0, 0, 0];

    return { decorative, edges, corners, outerEdges, outerCorners };
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

    // Test the leading edge of the player rather than its centre. This keeps
    // the whole cat outside the cliff and avoids the move-then-snap jitter.
    const directionX = Math.sign(position.x - previousPosition.x);
    const wallClearance = padding;
    if (directionX && !isGameplayChunk(position.x + directionX * wallClearance, previousPosition.z)) {
        const direction = directionX;
        const chunkX = Math.floor(previousPosition.x / chunkSize);
        const wallX = direction > 0 ? (chunkX + 1) * chunkSize : chunkX * chunkSize;
        position.x = wallX - direction * wallClearance;
    }

    // Then Z, using the same leading-edge test for a cliff running along X.
    const directionZ = Math.sign(position.z - previousPosition.z);
    if (directionZ && !isGameplayChunk(position.x, position.z + directionZ * wallClearance)) {
        const direction = directionZ;
        const chunkZ = Math.floor(previousPosition.z / chunkSize);
        const wallZ = direction > 0 ? (chunkZ + 1) * chunkSize : chunkZ * chunkSize;
        position.z = wallZ - direction * wallClearance;
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
    const changed = this.grass.paintChunked(
      point,
      radius,
      target => this.streamedTerrain.getTileAt(target)?.chunk,
      chunks,
      target => !this.streamedTerrain.isRockSurfaceAt(target)
    );
    if (changed) {
      this.markActiveChunksDirty();
    }
    return changed;
  }
  eraseGrass(point, radius) {
    const changed = this.chunkStore ? this.grass.eraseChunked(point, radius, this.activeTerrainChunks()) : this.grass.erase(this.world.grass, point, radius);
    if (changed) {
      this.markActiveChunksDirty();
    }
    return changed;
  }
  update(delta, camera) {
    const measure = (label, callback) => this.measure(label, callback);
    measure("Chunks", () => this.chunks?.update(camera));
    measure("Assets", () => this.assets.update(delta));
    measure("Environment", () => this.environment.update(delta, camera));
    const sun = this.environment.sun;
    // Give the unpainted/base ground texture the same time-of-day hue as the
    // horizon. Painted terrain remains readable and is left untouched.
    if (this.chunkStore) this.streamedTerrain.setHorizonTint(this.environment.fogHorizonColor);
    measure("Terrain", () => {
      if (this.chunkStore) this.streamedTerrain.update(delta);
      if (this.chunkStore) this.cullTerrainShadowReceiversToFog(camera);
    });
    measure("Water", () => this.water.update(delta, camera));
    this.water.setSunDirection(sun, this.environment.sunsun,this.environment.GrassTint);
    this.grass.setSunDirection(sun);
    this.grass.setEnvironmentTint(this.environment.GrassTint, this.environment.sunsun);
    this.streamedTerrain.updatesun(this.environment.GrassTint,this.environment.sunsun);
    measure("Grass", () => this.grass.update(delta, camera));
    if (!this.chunkStore) this.groundMist.apply(this.terrain.mesh);
    this.groundMist.setHorizonColors(this.environment, this.environment.timeOfDay);
    measure("Mist", () => this.groundMist.update(delta, camera));
    measure("Fake shadows", () => this.fakeShadows.update(this.terrain, delta));
  }
  refreshWater() {
    if (this.chunkStore) {
      this.water.beginChunked(this.world.water);
      for (const { chunk } of this.streamedTerrain.tiles.values()) this.water.applyChunk(chunk, this.world.terrain);
    } else this.water.apply(this.world.water, this.world.terrain);
  }
  refreshFakeShadows() { this.fakeShadows.rebuild(this.objects, this.terrain); }
  refreshChunkedGroundMist() { if (this.chunkStore) this.groundMist.applyChunks(this.streamedTerrain.meshes); }
  cullTerrainShadowReceiversToFog(camera) {
    const fogFar = this.scene.fog?.far;
    if (!camera || !Number.isFinite(fogFar)) return;
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    for (const { mesh } of this.streamedTerrain.tiles.values()) {
      const overlay = mesh.userData.shadowOverlay;
      if (!overlay) continue;
      mesh.getWorldPosition(this._terrainShadowCenter ??= new THREE.Vector3());
      overlay.visible = this._terrainShadowCenter.distanceTo(cameraPosition) <= fogFar;
    }
  }
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
