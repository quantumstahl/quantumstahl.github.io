import * as THREE from "three";
import { createDefaultWorld, deserializeWorld } from "./MapSchema.js";
import { RenderBatcher } from "./RenderBatcher.js";
import { Terrain } from "./Terrain.js";
import { Water } from "./Water.js";
import { Grass } from "./Grass.js";
import { FakeShadows } from "./FakeShadows.js";
import { GroundMist } from "./GroundMist.js";
import { Sky } from "./Sky.js";
import { EnvironmentSystem } from "./EnvironmentSystem.js";

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
    this.terrain = new Terrain(scene);
    this.water = new Water(scene);
    this.grass = new Grass(scene, assets);
    this.fakeShadows = new FakeShadows(scene);
    this.groundMist = new GroundMist(scene);
    this.sky = new Sky(scene);
    this.environment = new EnvironmentSystem({ scene, sky: this.sky });
    this.selectedObject = null;
  }

  async load(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return this.loadData(text.trim() ? JSON.parse(text) : createDefaultWorld());
    } catch (error) {
      console.warn(`Could not load ${url}; starting a blank world instead.`, error);
      return this.loadData(createDefaultWorld());
    }
  }

  async loadData(data) {
    this.world = deserializeWorld(data);
    await this.rebuild();
    return this.world;
  }

  async rebuild() {
    this.clear();
    this.environment.apply(this.world.sky);
    this.terrain.apply(this.world.terrain);
    this.groundMist.apply(this.terrain.mesh);
    this.water.apply(this.world.water, this.world.terrain);
    await this.grass.apply(this.world.grass, this.terrain);
    this.water.setSunDirection(this.sky.findDirectionalLight());
    this.sky.addBackgroundFadeToMaterial(this.terrain.mesh?.material);
    this.sky.addBackgroundFadeToMaterial(this.water.mesh?.material);
    this.sky.addBackgroundFadeToMaterial(this.grass.farGrassMaterial);
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
  }

  clear() {
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
    const changed = this.terrain.sculpt(this.world.terrain, point, radius, amount, mode, flattenHeight);
    if (changed) this.water.apply(this.world.water, this.world.terrain);
    return changed;
  }
  paintTerrain(point, radius, color, strength) {
    return this.terrain.paint(this.world.terrain, point, radius, color, strength);
  }
  paintTerrainTexture(point, radius, strength) {
    return this.terrain.paintTexture(this.world.terrain, point, radius, strength);
  }
  paintGrass(point, radius) { return this.grass.paint(this.world.grass, this.terrain, point, radius); }
  eraseGrass(point, radius) { return this.grass.erase(this.world.grass, point, radius); }
  update(delta, camera) { this.environment.update(delta); const sun = this.environment.sun; this.water.update(delta, camera); this.water.setSunDirection(sun); this.grass.setSunDirection(sun); this.grass.setEnvironmentTint(this.environment.GrassTint, this.environment.sunsun); this.grass.update(delta, camera); this.groundMist.apply(this.terrain.mesh); this.groundMist.setHorizonColors(this.environment, this.environment.timeOfDay); this.groundMist.update(delta, camera); this.fakeShadows.update(this.terrain, delta); }
  refreshWater() { this.water.apply(this.world.water, this.world.terrain); }
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
