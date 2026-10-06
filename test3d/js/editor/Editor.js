import * as THREE from "three";
import { AssetManager } from "../engine/AssetManager.js";
import { Input } from "../engine/Input.js";
import { MapLoader } from "../engine/MapLoader.js";
import { MapFileManager } from "./MapFileManager.js";
import { EditorCamera } from "./EditorCamera.js";
import { SelectTool } from "./tools/SelectTool.js";
import { AssetType, MapObject } from "../engine/MapSchema.js";
import { AssetTree } from "./AssetTree.js";
import { MoveTool } from "./tools/MoveTool.js";
import { RotateTool } from "./tools/RotateTool.js";
import { ScaleTool } from "./tools/ScaleTool.js";
import { StackTool } from "./tools/StackTool.js";
import { BrushTool } from "./tools/BrushTool.js";
import { TerrainTool } from "./tools/TerrainTool.js";

export class Editor {
  constructor(app) {
    this.app = app; this.scene = app.scene; this.camera = app.camera; this.canvas = app.canvas;
    this.assets = new AssetManager();
    this.mapLoader = new MapLoader({ scene: this.scene, assets: this.assets, mode: "editor" });
    this.app.performanceInfo.setObjectCountProvider(() => this.mapLoader.objects.length);
    this.input = new Input(this.canvas);
    this.cameraController = new EditorCamera(this.camera);
    this.files = new MapFileManager();
    this.selectTool = new SelectTool(this);
    this.moveTool = new MoveTool(this);
    this.rotateTool = new RotateTool(this);
    this.scaleTool = new ScaleTool(this);
    this.stackTool = new StackTool(this);
    this.brushTool = new BrushTool(this);
    this.terrainTool = new TerrainTool(this);
    this.activeTool = "select";
    this.terrainMode = "raise";
    this.brushType = null;
    this.selected = null;
    this.selectionBox = new THREE.BoxHelper(undefined, 0xffd34f);
    this.selectionBox.visible = false; this.scene.add(this.selectionBox);
    this.dirty = false; this.autosaveTimer = null; this.gridSignature = "";
    this.duplicateBusy = false;
    this.tree = new AssetTree(this, document.querySelector("#assetTree"));
    window.addEventListener("keydown", event => this.onKeyDown(event));
  }
  async load(url) { await this.mapLoader.load(url); this.mapLoader.calculateChunkDecorativeFlags(); this.syncWorldEditorSettings(); this.syncTerrainTexturePicker(); this.tree.render(); }
  async loadWorld(world) { await this.mapLoader.loadData(world); this.mapLoader.calculateChunkDecorativeFlags(); this.syncWorldEditorSettings(); this.syncTerrainTexturePicker(); this.setSelected(null); this.tree.render(); }
  async loadWorkspace({ world, directoryHandle }) { await this.mapLoader.loadData(world, null, directoryHandle); this.mapLoader.calculateChunkDecorativeFlags(); this.syncWorldEditorSettings(); this.syncTerrainTexturePicker(); this.setSelected(null); this.tree.render(); }
  setSelected(object) {
    this.selected = object;
    this.mapLoader.setSelected(object);
    this.selectionBox.visible = Boolean(object);
    if (object) this.selectionBox.setFromObject(object);
    this.setStatus(object ? `Selected: ${object.name}` : "Nothing selected");
    this.tree?.updateSelection(object);
  }
  update(delta) {
    this.mapLoader.update(delta, this.camera);
    this.refreshChunkGrid();
    this.cameraController.update(this.input, delta);
    this.selectTool.update();
    if (this.activeTool === "move") this.moveTool.update(delta);
    if (this.activeTool === "rotate") this.rotateTool.update(delta);
    if (this.activeTool === "scale") this.scaleTool.update(delta);
    if (this.activeTool === "stack") this.stackTool.update(delta);
    if (this.activeTool === "brush") this.brushTool.update(delta);
    if (this.activeTool === "terrain") this.terrainTool.update(delta);
    this.input.endFrame();
  }
  setTool(name) {
    if (this.activeTool === "brush" && name !== "brush") this.brushTool.exit();
    this.activeTool = name;
    if (name === "brush") this.brushTool.enter();
    document.querySelector("#selectToolButton")?.classList.toggle("is-active", name === "select");
    document.querySelector("#moveToolButton")?.classList.toggle("is-active", name === "move");
    document.querySelector("#rotateToolButton")?.classList.toggle("is-active", name === "rotate");
    document.querySelector("#scaleToolButton")?.classList.toggle("is-active", name === "scale");
    document.querySelector("#stackToolButton")?.classList.toggle("is-active", name === "stack");
    document.querySelector("#brushToolButton")?.classList.toggle("is-active", name === "brush");
    const instructions = { select: "Select tool: click an object", move: "Move tool: drag the selected object", rotate: "Rotate tool: horizontal drag or Q / E", scale: "Scale tool: vertical drag or Q / E; R resets", stack: "Stack tool: click a support surface", brush: this.brushType ? `Brush tool: painting ${this.brushType.name}` : "Brush tool: choose an asset type in the tree", terrain: this.terrainMode === "texture" ? "Texture paint: drag to paint the selected layer; Q / E radius" : this.terrainMode === "grass" ? "Grass paint: drag to scatter grass; Q / E radius" : this.terrainMode === "eraseGrass" ? "Grass erase: drag to remove grass; Q / E radius" : `Terrain ${this.terrainMode}: drag to sculpt; Q / E radius` };
    this.setStatus(instructions[name] ?? "Tool selected");
  }
  previewTransform() { if (this.selected) this.selectionBox.setFromObject(this.selected); }
  commitTransform() {
    if (!this.selected) return;
    this.mapLoader.syncDataFromObject(this.selected);
    this.mapLoader.refreshFakeShadows();
    this.previewTransform(); this.markDirty();
  }
  onKeyDown(event) {
    if (event.key === "Delete" && this.selected) { this.removeSelected(); event.preventDefault(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { this.duplicateSelected(); event.preventDefault(); }
  }
  async addBox() {
    const layer = this.mapLoader.world.layers[0];
    if (!layer) return;
    let type = layer.assetTypes.find(item => item.id === "box");
    if (!type) { type = new AssetType({ id: "box", name: "Box", shape: "box", collision: "solid" }); layer.assetTypes.push(type); }
    return this.createInstance(type, new THREE.Vector3(this.cameraController.target.x, .5, this.cameraController.target.z));
  }
  async addInstance(type) {
    return this.createInstance(type, new THREE.Vector3(this.cameraController.target.x, type.shape === "box" ? .5 : 0, this.cameraController.target.z));
  }
  async placeBrushInstances(type, points) {
    let newest = null;
    const added = [];
    for (const point of points) {
      newest = await this.createInstance(type, point, 1, { groundY: point.y, select: false, markDirty: false, renderTree: false, refreshBatches: false });
      if (newest) added.push(newest);
    }
    added.forEach(object => this.mapLoader.addToBatch(object));
    if (newest) this.setSelected(newest);
    this.markDirty(); this.tree.render();
  }
  async createInstance(type, position, scale = 1, { groundY = 0, select = true, markDirty = true, renderTree = true, refreshBatches = true } = {}) {
    const object = new MapObject({ name: type.name, position: { x: position.x, y: position.y, z: position.z }, scale });
    type.instances.push(object);
    const mesh = await this.mapLoader.addInstance(type, object, this.findLayerForType(type));
    // GLBs use a centred pivot, so a fresh instance starts with half its
    // geometry below y=0. Snap its real bottom onto the editor ground.
    this.snapObjectBottomToGround(mesh, groundY);
    if (refreshBatches) this.mapLoader.addToBatch(mesh);
    if (select) this.setSelected(mesh);
    if (markDirty) this.markDirty();
    if (renderTree) this.tree.render();
    return mesh;
  }
  setBrushType(type) {
    this.brushType = type;
    this.tree.render();
    this.setStatus(this.activeTool === "brush" ? `Brush tool: painting ${type.name}` : `${type.name} chosen for Brush`);
  }
  inspectTerrain() {
    const terrain = this.mapLoader.world.terrain;
    const resolution = terrain.resolution ?? terrain.segments;
    this.setStatus(`Terrain: streamed 50m chunks, ${resolution} × ${resolution} vertices per chunk`);
  }
  inspectSky() {
    this.setStatus(`Shader sky: ${this.mapLoader.world.sky.mode === "night" ? "Night" : "Day"}`);
  }
  setSkyMode(mode) {
    this.mapLoader.world.sky.mode = mode === "night" ? "night" : "day";
    this.mapLoader.world.sky.timeOfDay = this.mapLoader.world.sky.mode === "night" ? 0 : 0.25;
    this.mapLoader.environment.apply(this.mapLoader.world.sky);
    this.markDirty(); this.tree.render();
    this.setStatus(`Shader sky: ${this.mapLoader.world.sky.mode === "night" ? "Night" : "Day"}`);
  }
  syncWorldEditorSettings() {
    if (this.app.editorGrid) this.app.editorGrid.visible = this.mapLoader.world.editor.showGrid;
  }
  refreshChunkGrid() {
    const chunks = this.mapLoader.activeTerrainChunks?.() ?? [];
    if (!chunks.length || !this.app.editorGrid) return;
    const size = this.mapLoader.world.chunkSize ?? 50;
    const signature = chunks.map(chunk => `${chunk.x},${chunk.z}`).sort().join("|");
    if (signature === this.gridSignature) return;
    this.gridSignature = signature;
    const old = this.app.editorGrid;
    const lines = [], colors = [];
    const fineColor = new THREE.Color(0x425a50);
    const chunkColor = new THREE.Color(0xa8d8ff);
    const addLine = (x1, z1, x2, z2, color) => {
      lines.push(x1, .015, z1, x2, .015, z2);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };
    for (const chunk of chunks) {
      const originX = chunk.x * size, originZ = chunk.z * size;
      for (let offset = 0; offset <= size; offset++) {
        const color = offset === 0 || offset === size ? chunkColor : fineColor;
        addLine(originX + offset, originZ, originX + offset, originZ + size, color);
        addLine(originX, originZ + offset, originX + size, originZ + offset, color);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85 }));
    grid.name = "Chunk terrain grid";
    grid.visible = this.mapLoader.world.editor.showGrid;
    this.scene.add(grid);
    old.removeFromParent();
    old.geometry.dispose();
    for (const material of Array.isArray(old.material) ? old.material : [old.material]) material.dispose();
    this.app.editorGrid = grid;
  }
  toggleGrid() {
    const settings = this.mapLoader.world.editor;
    settings.showGrid = !settings.showGrid;
    this.syncWorldEditorSettings(); this.markDirty(); this.tree.render();
    this.setStatus(`Grid ${settings.showGrid ? "shown" : "hidden"}`);
  }
  toggleAutoCreateChunks() {
    const settings = this.mapLoader.world.editor;
    settings.autoCreateChunks = !settings.autoCreateChunks;
    this.mapLoader.setAutoCreateChunks(settings.autoCreateChunks, this.camera);
    this.markDirty(); this.tree.render();
    this.setStatus(`Automatic chunk creation ${settings.autoCreateChunks ? "enabled" : "disabled"}`);
  }
  teleportToOrigin() {
    this.cameraController.target.set(0, 0, 0);
    this.cameraController.updateCamera();
    this.mapLoader.chunks?.refresh(this.camera);
    this.setStatus("Teleported to world origin");
  }
  async trimEmptyChunks() {
    if (!window.confirm("Trim empty chunks? The 5x5 starter area and the border around authored terrain will be kept.")) return;
    const removed = await this.mapLoader.trimEmptyChunks(this.camera);
    if (!removed) { this.setStatus("No empty interior chunks to trim"); return; }
    this.markDirty(); this.tree.render();
    this.setStatus(`Trimmed ${removed} empty interior ${removed === 1 ? "chunk" : "chunks"}`);
  }
  async paintDecorativeChunks() {
    if (!window.confirm("Create dry rolling hills and outer mountain ridges, then paint decorative grass? Existing sculpted terrain and painted grass are left unchanged. Hills made by the previous version will be repaired.")) return;
    const result = await this.mapLoader.paintDecorativeChunks(this.camera);
    if (!result.painted) {
      this.setStatus(result.skipped ? "Decorative chunks already have painted grass" : "No decorative chunks to paint");
      return;
    }
    this.markDirty();
    this.tree.render();
    this.setStatus(`Made ${result.hilled} decorative ${result.hilled === 1 ? "chunk" : "chunks"} hilly and painted grass on ${result.painted}${result.skipped ? `; kept ${result.skipped} existing` : ""}`);
  }
  changeWaterLevel() {
    const water = this.mapLoader.world.water;
    const value = window.prompt("Water level (metres)?", String(water.level));
    if (value === null) return;
    const level = Number(value);
    if (!Number.isFinite(level)) { this.setStatus("Water level must be a number"); return; }
    water.level = level;
    this.mapLoader.refreshWater(); this.markDirty(); this.tree.render();
    this.setStatus(`Water level set to ${level}m`);
  }
  setTerrainMode(mode) {
    this.terrainMode = mode;
    this.setTool("terrain");
    for (const name of ["raise", "lower", "smooth", "flatten"]) document.querySelector(`#terrain${name[0].toUpperCase()}${name.slice(1)}Button`)?.classList.toggle("is-active", name === mode);
    document.querySelector("#terrainPaintButton")?.classList.toggle("is-active", mode === "texture");
    document.querySelector("#terrainGrassButton")?.classList.toggle("is-active", mode === "grass");
    document.querySelector("#terrainEraseGrassButton")?.classList.toggle("is-active", mode === "eraseGrass");
  }
  startTerrainTexturePaint() {
    if (!this.mapLoader.world.terrain.textures?.[this.mapLoader.world.terrain.activeTexture]?.src) {
      this.setStatus("Add a PNG texture first");
      return;
    }
    this.setTerrainMode("texture");
  }
  startGrassPaint() { this.setTerrainMode("grass"); }
  startGrassErase() { this.setTerrainMode("eraseGrass"); }
  async chooseStandardGroundTexture() {
    const file = await this.pickTerrainTextureFile();
    if (!file) return;
    const terrain = this.mapLoader.world.terrain;
    const src = `assets/${file.name}`;
    // This is sampled below every paint mask. Existing masks are never
    // allocated, reset, or edited, so painted texture layers stay intact.
    terrain.baseTexture = { src, scale: terrain.baseTexture?.scale ?? 16 };
    this.mapLoader.terrain.loadTextureFile(file, src, terrain.baseTexture.scale);
    this.markDirty(); this.tree.render();
    this.setStatus(`Standard ground texture set: ${file.name}. Painted texture layers are unchanged; copy it to NextWorld/assets before playing.`);
  }
  async chooseTerrainTexture() {
    const file = await this.pickTerrainTextureFile();
    if (!file) return;
    const terrain = this.mapLoader.world.terrain;
    if (terrain.textures.length >= 8) { this.setStatus("Terrain supports up to 8 painted textures"); return; }
    const src = `assets/${file.name}`;
    let index = terrain.textures.findIndex(layer => layer.src === src);
    if (index < 0) {
      // Chunked terrain stores texture masks beside each tile's vertex data;
      // only the legacy terrain format has one global heights/mask array.
      const layer = { src, scale: 16 };
      if (!this.mapLoader.chunkStore) layer.mask = Array(terrain.heights.length).fill(0);
      terrain.textures.push(layer);
      index = terrain.textures.length - 1;
    }
    terrain.activeTexture = index;
    this.mapLoader.terrain.updateTextureMasks(terrain);
    // Compile the terrain material for every layer now. The selected file will
    // replace its temporary texture as soon as the browser has decoded it.
    this.mapLoader.terrain.applyTextures(terrain.textures);
    this.mapLoader.terrain.loadTextureFile(file, src, terrain.textures[index].scale);
    this.syncTerrainTexturePicker();
    this.setTerrainMode("texture");
    this.markDirty();
    this.setStatus(`Texture layer ${index + 1} loaded: ${file.name}. Paint it onto terrain; copy it to NextWorld/assets before playing.`);
  }
  selectTerrainTexture(index) { const terrain = this.mapLoader.world.terrain; if (!terrain.textures[index]) return; terrain.activeTexture = index; this.syncTerrainTexturePicker(); this.markDirty(); this.setStatus(`Texture layer ${index + 1} selected: ${terrain.textures[index].src.split("/").pop()}`); }
  setTerrainTextureScale(value) {
    const terrain = this.mapLoader.world.terrain, layer = terrain.textures[terrain.activeTexture];
    if (!layer) return;
    layer.scale = THREE.MathUtils.clamp(Number.isFinite(value) ? Math.round(value) : 16, 1, 200);
    this.mapLoader.terrain.applyTextures(terrain.textures); this.syncTerrainTexturePicker(); this.markDirty();
    this.setStatus(`Texture tiling: ${layer.scale}× (higher makes it smaller)`);
  }
  removeTerrainTexture() {
    const terrain = this.mapLoader.world.terrain, index = terrain.activeTexture ?? 0, layer = terrain.textures[index];
    if (!layer) { this.setStatus("No texture layer is selected"); return; }
    const name = layer.src.split("/").pop();
    if (!window.confirm(`Remove terrain texture "${name}"?\n\nIts painted areas will be removed from this map. This cannot be undone.`)) return;
    terrain.textures.splice(index, 1);
    terrain.activeTexture = Math.max(0, Math.min(index, terrain.textures.length - 1));
    this.mapLoader.terrain.updateTextureMasks(terrain);
    this.mapLoader.terrain.applyTextures(terrain.textures);
    this.syncTerrainTexturePicker(); this.markDirty();
    this.setStatus(`Removed texture layer: ${name}`);
  }
  syncTerrainTexturePicker() { const picker = document.querySelector("#terrainTextureSelect"), scaleInput = document.querySelector("#terrainTextureScale"), removeButton = document.querySelector("#terrainRemoveTextureButton"), terrain = this.mapLoader.world.terrain; if (!picker) return; picker.replaceChildren(); if (!terrain.textures.length) picker.add(new Option("No texture layers", "")); terrain.textures.forEach((layer, index) => picker.add(new Option(`${index + 1}: ${layer.src.split("/").pop()}`, String(index), false, index === terrain.activeTexture))); picker.disabled = terrain.textures.length === 0; if (scaleInput) { scaleInput.disabled = terrain.textures.length === 0; scaleInput.value = String(terrain.textures[terrain.activeTexture]?.scale ?? 16); } if (removeButton) removeButton.disabled = terrain.textures.length === 0; }
  pickTerrainTextureFile() {
    return new Promise(resolve => {
      const input = document.createElement("input"); input.type = "file"; input.accept = "image/*";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true }); input.click();
    });
  }
  cycleTypeShadowMode(type) {
    const modes = ["real", "fake", "none"], current = type.render.shadowMode ?? (type.render.castShadow ? "real" : "none"), mode = modes[(modes.indexOf(current) + 1) % modes.length];
    this.mapLoader.setTypeShadowMode(type, mode);
    this.markDirty(); this.tree.render();
    this.setStatus(`${type.name}: ${mode === "real" ? "real shadows" : mode === "fake" ? "fake contact shadows" : "no shadows"}`);
  }
  async importGLBAsset() {
    const file = await this.pickGLBFile();
    if (!file) return;
    const path = `assets/${file.name}`;
    this.assets.registerFile(path, file);
    const id = file.name.replace(/\.(glb|gltf)$/i, "").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const layer = this.mapLoader.world.layers[0];
    layer.assetTypes.push(new AssetType({ id, name: file.name.replace(/\.(glb|gltf)$/i, ""), glb: path }));
    this.markDirty(); this.tree.render();
    this.setStatus(`Added ${file.name}. Copy it into NextWorld/${path} before using this map in the game.`);
  }
  pickGLBFile() {
    return new Promise(resolve => {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true }); input.click();
    });
  }
  findObject(data) { return this.mapLoader.objects.find(object => object.userData.mapObject === data) ?? null; }
  findLayerForType(type) { return this.mapLoader.world.layers.find(layer => layer.assetTypes.includes(type)) ?? null; }
  snapObjectBottomToGround(object, groundY = 0) {
    if (!object) return;
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    object.position.y += groundY - bounds.min.y;
    this.mapLoader.syncDataFromObject(object);
    this.previewTransform();
  }
  removeSelected() {
    const object = this.selected;
    const data = object.userData.mapObject;
    const type = object.userData.assetType;
    type.instances = type.instances.filter(item => item !== data);
    this.mapLoader.removeInstance(object);
    this.setSelected(null); this.tree.removeInstance(data); this.markDirty();
  }
  async duplicateSelected() {
    if (this.duplicateBusy) return;
    const source = this.selected;
    if (!source) { this.setStatus("Select an object to duplicate"); return; }
    const data = source.userData.mapObject;
    const type = source.userData.assetType;
    if (!data || !type) return;
    const copy = new MapObject({
      name: data.name ? `${data.name} copy` : type.name,
      position: { x: data.position.x + 1, y: data.position.y, z: data.position.z + 1 },
      rotation: { ...data.rotation },
      scale: { ...data.scale },
      properties: structuredClone(data.properties ?? {})
    });
    this.duplicateBusy = true;
    try {
      type.instances.push(copy);
      const mesh = await this.mapLoader.addInstance(type, copy, this.findLayerForType(type));
      if (!mesh) { type.instances.pop(); return; }
      this.mapLoader.addToBatch(mesh);
      this.setSelected(mesh); this.markDirty(); this.tree.render();
    } finally {
      this.duplicateBusy = false;
    }
  }
  removeAssetType(type) {
    const layer = this.findLayerForType(type);
    if (!layer) return;
    const count = type.instances.length;
    const kind = type.glb ? "GLB" : "box";
    const confirmed = window.confirm(`Remove ${kind} asset "${type.name}" from this map?\n\nThis removes the asset type and its ${count} placed ${count === 1 ? "instance" : "instances"}.`);
    if (!confirmed) return;
    if (this.selected?.userData.assetType === type) this.setSelected(null);
    this.mapLoader.removeType(type);
    layer.assetTypes = layer.assetTypes.filter(item => item !== type);
    if (this.brushType === type) this.brushType = null;
    this.markDirty(); this.tree.render();
  }
  markDirty() {
    this.dirty = true; this.setStatus("Unsaved changes");
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this.files.autosave(this.mapLoader.world), 400);
  }
  setStatus(message) { const label = document.querySelector("#editorStatus"); if (label) label.textContent = message; }
}
