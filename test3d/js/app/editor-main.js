import * as THREE from "three";
import { ThreeApp } from "../engine/ThreeApp.js";
import { Editor } from "../editor/Editor.js";

const app = new ThreeApp(document.querySelector("#gameCanvas"));
app.scene.background = new THREE.Color(0x8fb3d9);
// A 200m terrain reaches its edge about 100m from its centre. End fog before
// that edge so geometry actually dissolves into the shader sky.
app.scene.fog = new THREE.Fog(0x8fb3d9, 90, 190);
app.addDefaultLighting();
const grid = new THREE.GridHelper(100, 100, 0x58796a, 0x425a50); grid.position.y = .015; app.scene.add(grid);
app.editorGrid = grid;

const editor = new Editor(app);
try {

    await editor.load("maps/world.json");
    editor.setStatus(`${editor.mapLoader.world.name} loaded`);
  
} catch (error) {
  console.error(error); editor.setStatus("Could not load maps/world.json");
}





document.querySelector("#openButton").addEventListener("click", async () => {
  try { await editor.loadWorld(await editor.files.open()); editor.setStatus("Map opened"); } catch (error) { if (error.name !== "AbortError") console.error(error); }
});
document.querySelector("#saveButton").addEventListener("click", async () => {
  try { const bytes = await editor.files.saveAs(editor.mapLoader.world); editor.dirty = false; editor.setStatus(`Saved ${bytes} bytes`); } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    try { const bytes = editor.files.download(editor.mapLoader.world); editor.setStatus(`File save failed; downloaded ${bytes} bytes instead`); } catch (downloadError) { editor.setStatus(`Save failed: ${downloadError.message}`); }
  }
});
document.querySelector("#selectToolButton").addEventListener("click", () => editor.setTool("select"));
document.querySelector("#moveToolButton").addEventListener("click", () => editor.setTool("move"));
document.querySelector("#rotateToolButton").addEventListener("click", () => editor.setTool("rotate"));
document.querySelector("#scaleToolButton").addEventListener("click", () => editor.setTool("scale"));
document.querySelector("#stackToolButton").addEventListener("click", () => editor.setTool("stack"));
document.querySelector("#brushToolButton").addEventListener("click", () => editor.setTool("brush"));
document.querySelector("#terrainRaiseButton").addEventListener("click", () => editor.setTerrainMode("raise"));
document.querySelector("#terrainLowerButton").addEventListener("click", () => editor.setTerrainMode("lower"));
document.querySelector("#terrainSmoothButton").addEventListener("click", () => editor.setTerrainMode("smooth"));
document.querySelector("#terrainFlattenButton").addEventListener("click", () => editor.setTerrainMode("flatten"));
document.querySelector("#terrainPaintButton").addEventListener("click", () => editor.startTerrainTexturePaint());
document.querySelector("#terrainTextureButton").addEventListener("click", () => editor.chooseTerrainTexture());
document.querySelector("#terrainTextureSelect").addEventListener("change", event => editor.selectTerrainTexture(Number(event.target.value)));
document.querySelector("#terrainTextureScale").addEventListener("change", event => editor.setTerrainTextureScale(Number(event.target.value)));
document.querySelector("#terrainRemoveTextureButton").addEventListener("click", () => editor.removeTerrainTexture());
document.querySelector("#terrainGrassButton").addEventListener("click", () => editor.startGrassPaint());
document.querySelector("#terrainEraseGrassButton").addEventListener("click", () => editor.startGrassErase());
document.querySelector("#duplicateButton").addEventListener("click", () => editor.duplicateSelected());
editor.setTool("select");
app.beforeRender = (renderer, camera) => editor.mapLoader.sky.renderToTexture(renderer, camera);
app.start(delta => editor.update(delta));
