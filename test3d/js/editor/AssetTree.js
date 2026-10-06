// The lean descendant of CatAdventure's JSTree: it owns editor DOM only and
// talks to the editor through small explicit methods.
export class AssetTree {
  constructor(editor, panel) {
    this.editor = editor; this.panel = panel;
    this.expanded = new Set();
    this.initializedWorld = null;
    this.instanceRows = new Map();
    this.selectedRow = null;
    this.visibleInstanceCounts = new Map();
    this.contextMenu = null;
    document.addEventListener("pointerdown", event => {
      if (this.contextMenu && !this.contextMenu.contains(event.target)) this.closeContextMenu();
    });
  }
  render() {
    this.panel.replaceChildren();
    this.instanceRows.clear(); this.selectedRow = null;
    const world = this.editor.mapLoader.world;
    this.initializeExpansion(world);
    const worldOpen = this.isOpen("world");
    const worldRow = this.row(`${worldOpen ? "▾" : "▸"} ${world.name}`, "tree-world");
    worldRow.addEventListener("click", () => this.toggle("world"));
    worldRow.addEventListener("contextmenu", event => {
      event.preventDefault(); event.stopPropagation(); this.openWorldMenu(event, world);
    });
    this.panel.append(worldRow);
    if (!worldOpen) return;
    const sky = this.row(`Sky (${world.sky.mode === "night" ? "Night" : "Day"})`, "tree-sky");
    sky.title = "Right-click to choose the shader sky";
    sky.addEventListener("click", () => this.editor.inspectSky());
    sky.addEventListener("contextmenu", event => {
      event.preventDefault(); event.stopPropagation(); this.openSkyMenu(event);
    });
    this.panel.append(sky);
    const terrain = this.row("▸ Terrain", "tree-terrain");
    terrain.title = "Click for terrain info; right-click for terrain options";
    terrain.addEventListener("click", () => this.editor.inspectTerrain());
    terrain.addEventListener("contextmenu", event => {
      event.preventDefault(); event.stopPropagation(); this.openTerrainMenu(event);
    });
    this.panel.append(terrain);
    const water = this.row(`▸ Water (${world.water.level}m)`, "tree-water");
    water.title = "Water appears where terrain is below this level";
    water.addEventListener("click", () => this.editor.setStatus(`Water level: ${world.water.level}m`));
    this.panel.append(water);
    for (const layer of world.layers) {
      const layerKey = `layer:${layer.id}`;
      const layerOpen = this.isOpen(layerKey);
      const layerRow = this.row(`${layerOpen ? "▾" : "▸"} ${layer.name}`, "tree-layer");
      layerRow.addEventListener("click", () => this.toggle(layerKey)); this.panel.append(layerRow);
      if (!layerOpen) continue;
      for (const type of layer.assetTypes) {
        const typeKey = `type:${type.id}`;
        const typeOpen = this.isOpen(typeKey);
        const typeRow = this.row(`${typeOpen ? "▾" : "▸"} ${type.name}`, "tree-type", type === this.editor.brushType);
        typeRow.title = "Click to collapse/expand";
        typeRow.addEventListener("click", () => this.toggle(typeKey));
        typeRow.addEventListener("contextmenu", event => {
          event.preventDefault(); event.stopPropagation(); this.openTypeMenu(event, type);
        });
        const brush = document.createElement("button"); brush.textContent = "B"; brush.title = "Choose for Brush";
        brush.addEventListener("click", event => { event.stopPropagation(); this.editor.setBrushType(type); });
        const shadowMode = type.render.shadowMode ?? (type.render.castShadow ? "real" : "none");
        const shadow = document.createElement("button"); shadow.textContent = "S"; shadow.title = `Shadow mode: ${shadowMode}. Click: real → fake → none`;
        shadow.classList.toggle("is-enabled", shadowMode === "real"); shadow.classList.toggle("is-fake", shadowMode === "fake");
        shadow.addEventListener("click", event => { event.stopPropagation(); this.editor.cycleTypeShadowMode(type); });
        const add = document.createElement("button"); add.textContent = "+"; add.title = "Add an instance";
        add.addEventListener("click", event => { event.stopPropagation(); this.editor.addInstance(type); });
        typeRow.append(brush, shadow, add); this.panel.append(typeRow);
        if (!typeOpen) continue;
        const visibleCount = this.visibleInstanceCounts.get(type.id) ?? 10;
        type.instances.slice(0, visibleCount).forEach((instance, index) => {
          const object = this.editor.findObject(instance);
          const instanceRow = this.row(instance.name || `${type.name} ${index + 1}`, "tree-instance", Boolean(object && object === this.editor.selected));
          instanceRow.dataset.instanceId = instance.id;
          this.instanceRows.set(instance.id, instanceRow);
          if (object === this.editor.selected) this.selectedRow = instanceRow;
          instanceRow.addEventListener("click", () => this.editor.setSelected(object));
          this.panel.append(instanceRow);
        });
        if (type.instances.length > visibleCount) {
          const more = document.createElement("button");
          more.className = "tree-more";
          more.textContent = `Show 100 more (${(type.instances.length - visibleCount).toLocaleString()} remaining)`;
          more.addEventListener("click", () => {
            this.visibleInstanceCounts.set(type.id, Math.min(type.instances.length, visibleCount + 100));
            this.render();
          });
          this.panel.append(more);
        }
      }
    }
    const actions = document.createElement("div"); actions.className = "tree-actions";
    const glb = document.createElement("button"); glb.textContent = "+ GLB asset"; glb.addEventListener("click", () => this.editor.importGLBAsset());
    const box = document.createElement("button"); box.textContent = "+ Box"; box.addEventListener("click", () => this.editor.addBox());
    actions.append(glb, box); this.panel.append(actions);
  }
  row(label, className, selected = false) {
    const row = document.createElement("div"); row.className = `tree-row ${className}${selected ? " is-selected" : ""}`; row.textContent = label; return row;
  }
  isOpen(key) { return this.expanded.has(key); }
  toggle(key) { this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key); this.render(); }
  updateSelection(object) {
    // Selecting is O(1), not a rebuild of hundreds or thousands of nodes.
    this.selectedRow?.classList.remove("is-selected");
    const id = object?.userData?.mapObject?.id;
    this.selectedRow = id ? this.instanceRows.get(id) ?? null : null;
    this.selectedRow?.classList.add("is-selected");
  }
  removeInstance(instance) {
    const row = this.instanceRows.get(instance?.id);
    row?.remove();
    this.instanceRows.delete(instance?.id);
    if (this.selectedRow === row) this.selectedRow = null;
  }
  openTypeMenu(event, type) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "tree-context-menu";
    const remove = document.createElement("button");
    remove.textContent = `Remove ${type.glb ? "GLB" : "box asset"} from map…`;
    remove.addEventListener("click", () => { this.closeContextMenu(); this.editor.removeAssetType(type); });
    menu.append(remove);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 50)}px`;
    document.body.append(menu); this.contextMenu = menu;
  }
  openTerrainMenu(event) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "tree-context-menu";
    const water = document.createElement("button");
    water.textContent = "Change water level…";
    water.addEventListener("click", () => { this.closeContextMenu(); this.editor.changeWaterLevel(); });
    menu.append(water);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 50)}px`;
    document.body.append(menu); this.contextMenu = menu;
  }
  openWorldMenu(event, world) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "tree-context-menu";
    const baseTexture = document.createElement("button");
    baseTexture.textContent = "Load base terrain texture…";
    baseTexture.title = "Sets the texture below all painted terrain layers";
    baseTexture.addEventListener("click", () => { this.closeContextMenu(); this.editor.chooseStandardGroundTexture(); });
    const grid = document.createElement("button");
    grid.textContent = world.editor.showGrid ? "Hide grid" : "Show grid";
    grid.addEventListener("click", () => { this.closeContextMenu(); this.editor.toggleGrid(); });
    const chunks = document.createElement("button");
    chunks.textContent = world.editor.autoCreateChunks ? "Disable automatic chunks" : "Enable automatic chunks";
    chunks.addEventListener("click", () => { this.closeContextMenu(); this.editor.toggleAutoCreateChunks(); });
    const origin = document.createElement("button");
    origin.textContent = "Teleport to origin";
    origin.addEventListener("click", () => { this.closeContextMenu(); this.editor.teleportToOrigin(); });
    const trim = document.createElement("button");
    trim.textContent = "Trim empty chunks";
    trim.addEventListener("click", () => { this.closeContextMenu(); this.editor.trimEmptyChunks().catch(error => console.error("Could not trim chunks", error)); });
    const paintDecorativeGrass = document.createElement("button");
    paintDecorativeGrass.textContent = "Make hilly decorative grass";
    paintDecorativeGrass.addEventListener("click", () => { this.closeContextMenu(); this.editor.paintDecorativeChunks().catch(error => console.error("Could not paint decorative grass", error)); });
    menu.append(baseTexture, grid, chunks, origin, trim, paintDecorativeGrass);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 50)}px`;
    document.body.append(menu); this.contextMenu = menu;
  }
  openSkyMenu(event) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "tree-context-menu";
    const day = document.createElement("button");
    day.textContent = "Day sky";
    day.addEventListener("click", () => { this.closeContextMenu(); this.editor.setSkyMode("day"); });
    const night = document.createElement("button");
    night.textContent = "Night sky";
    night.addEventListener("click", () => { this.closeContextMenu(); this.editor.setSkyMode("night"); });
    menu.append(day, night);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 80)}px`;
    document.body.append(menu); this.contextMenu = menu;
  }
  closeContextMenu() { this.contextMenu?.remove(); this.contextMenu = null; }
  initializeExpansion(world) {
    if (this.initializedWorld === world) return;
    this.initializedWorld = world;
    this.expanded.clear();
    this.expanded.add("world");
    const firstLayer = world.layers[0];
    if (!firstLayer) return;
    this.expanded.add(`layer:${firstLayer.id}`);
    // Keep individual GLB/type lists closed on load. A painted map can have
    // thousands of instances, while the Objects layer itself stays visible.
  }
}
