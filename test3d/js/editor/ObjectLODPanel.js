import { copyAsset } from "../objects/ObjectData.js";
import { defaultLOD, expandLOD, normalizeLOD, lodWarnings } from "../objects/ObjectLOD.js";

// Assignment is one history operation, including a newly imported resource.
// Placed instances always retain their logical asset ID.
export async function assignLODFile(data, library, assetId, level, file) {
  if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error("Choose LOD 0–3.");
  const prepared = await library.prepareFile(file);
  const before = copyAsset(data.assets.get(assetId));
  if (!before) { if (!prepared.existing) library.disposeSource(prepared.source); throw new Error("The logical asset was removed during import."); }
  const after = copyAsset(before); after.lod = expandLOD(after.lod, assetId);
  after.lod.levels[level].resourceId = prepared.resource.id; after.lod.levels[level].enabled = true;
  try { after.lod = normalizeLOD(after.lod, assetId); }
  catch (error) { if (!prepared.existing) library.disposeSource(prepared.source); throw error; }
  const resourceBefore = copyAsset(data.resources.get(prepared.resource.id));
  const isLogical = data.assets.has(prepared.resource.id);
  library.registerResource(prepared); data.setAsset(after);
  const resources = !isLogical && !resourceBefore ? [{ id: prepared.resource.id, before: null, after: copyAsset(data.resources.get(prepared.resource.id)) }] : [];
  return { id: assetId, before, after: copyAsset(data.assets.get(assetId)), resources };
}
export function applyLODHistory(data, entries, property) {
  if (property === "after") {
    for (const resource of entries.resources) if (resource.after) data.setResource(resource.after);
    data.setAsset(entries.after);
  } else {
    data.setAsset(entries.before);
    for (const resource of entries.resources) {
      if (resource.before) data.setResource(resource.before);
      else if (data.resources.has(resource.id)) data.deleteResource(resource.id);
    }
  }
}

export class ObjectLODPanel {
  constructor({ element, data, assets, system, getAssetId, getSelectedId, preview, recordHistory, onStatus }) {
    Object.assign(this, { element, data, assets, system, getAssetId, getSelectedId, preview, recordHistory, onStatus });
    this.dirty = true; this.assetId = null; this.counts = new Map(); this.counting = new Set(); this.disposed = false;
    this.onFocusOut = () => { this.dirty = true; }; element.addEventListener("focusout", this.onFocusOut);
    element.innerHTML = `<p id="objectLODActive" role="status">Select a placed object to preview LOD.</p>
      <details id="objectLODDetails"><summary>Object LOD</summary>
      <label class="object-check">Enable asset LOD<input id="objectLODEnabled" type="checkbox"></label>
      <label>Selected object preview<select id="objectLODPreview"><option value="auto">Automatic</option>${[0, 1, 2, 3].map(i => `<option value="${i}">LOD ${i}</option>`).join("")}</select></label>
      <div id="objectLODLevels">${[0, 1, 2, 3].map(level => `<fieldset class="lod-level" data-lod-row="${level}">
        <legend>LOD ${level} · <span data-lod-triangles="${level}">—</span></legend>
        <span data-lod-name="${level}" class="lod-model-name">Unassigned</span>
        <div class="material-actions"><button type="button" data-lod-assign="${level}">Assign GLB…</button><button type="button" data-lod-clear="${level}">Clear</button></div>
        <input type="file" accept=".glb,model/gltf-binary" data-lod-file="${level}" hidden>
        <label class="object-check">Enabled<input type="checkbox" data-lod-enabled="${level}"></label>
        <label>Start distance (m)<input type="number" min="0" step="1" data-lod-distance="${level}" ${level === 0 ? "disabled" : ""}></label>
      </fieldset>`).join("")}</div>
      <label>Maximum visibility (m; 0 = world limit)<input id="objectLODMaxDistance" type="number" min="0" step="10" value="0"></label>
      <label>Hysteresis (%)<input id="objectLODHysteresis" type="number" min="0" max="50" step="1" value="12"></label>
      <p id="objectLODWarnings" role="status"></p>
      <label class="object-check">Show LOD diagnostics<input id="objectLODDiagnostics" type="checkbox"></label>
      <p>Levels share one asset and its placements. Align model origins, orientation and dimensions before export. A preview changes only the selected object.</p>
      </details>`;
    this.$ = selector => element.querySelector(selector);
    this.$("#objectLODEnabled").onchange = event => this.edit(asset => { if (event.target.checked) asset.lod = defaultLOD(asset.id); else delete asset.lod; });
    for (let level = 0; level < 4; level++) {
      this.$(`[data-lod-assign="${level}"]`).onclick = () => this.$(`[data-lod-file="${level}"]`).click();
      this.$(`[data-lod-file="${level}"]`).onchange = async event => {
        const file = event.target.files[0], assetId = this.getAssetId(); if (!file || !assetId) return;
        try {
          this.onStatus(`Importing LOD ${level}: ${file.name}…`);
          const entries = await assignLODFile(data, assets, assetId, level, file);
          this.recordHistory({ kind: "objectLOD", entries }); this.dirty = true;
          this.onStatus(`Assigned ${file.name} to LOD ${level}`);
        } catch (error) { this.onStatus(`LOD import failed: ${error.message}`); }
        finally { event.target.value = ""; }
      };
      this.$(`[data-lod-clear="${level}"]`).onclick = () => this.edit(asset => {
        asset.lod.levels[level] = { ...asset.lod.levels[level], enabled: false, resourceId: null };
      });
      this.$(`[data-lod-enabled="${level}"]`).onchange = event => this.edit(asset => { asset.lod.levels[level].enabled = event.target.checked; });
      this.$(`[data-lod-distance="${level}"]`).onchange = event => this.edit(asset => { asset.lod.levels[level].distance = Number(event.target.value); });
    }
    this.$("#objectLODMaxDistance").onchange = event => this.edit(asset => { asset.lod.maxDistance = Number(event.target.value) || null; });
    this.$("#objectLODHysteresis").onchange = event => this.edit(asset => { asset.lod.hysteresis = Number(event.target.value) / 100; });
    this.$("#objectLODPreview").onchange = event => this.preview(event.target.value === "auto" ? null : Number(event.target.value));
    this.$("#objectLODDiagnostics").checked = system.diagnostics;
    this.$("#objectLODDiagnostics").onchange = event => { system.diagnostics = event.target.checked; };
    this.unsubscribe = data.onChanged(event => { if (event.kind === "asset" || event.kind === "resource") this.dirty = true; });
  }
  edit(change) {
    const before = copyAsset(this.data.assets.get(this.getAssetId())); if (!before) return;
    const after = copyAsset(before);
    if (after.lod) after.lod = expandLOD(after.lod, after.id);
    try {
      change(after); this.data.setAsset(after);
      this.recordHistory({ kind: "objectAsset", entries: { id: after.id, before, after: copyAsset(this.data.assets.get(after.id)) } });
    } catch (error) { this.onStatus(error.message); }
    this.dirty = true;
  }
  count(resource) {
    if (!resource) return "—";
    const triangles = resource.triangles ?? this.counts.get(resource.id);
    if (triangles != null) return `${triangles.toLocaleString()} tris`;
    if (!this.counting.has(resource.id) && resource.data) {
      this.counting.add(resource.id); const lease = this.assets.acquire(resource.id);
      lease.promise.then(source => { this.counts.set(resource.id, source.triangles); this.dirty = true; }, () => {}).finally(lease.release);
    }
    return "Unknown tris";
  }
  refresh() {
    const asset = this.data.assets.get(this.getAssetId()); this.assetId = asset?.id ?? null;
    const config = expandLOD(asset?.lod, asset?.id), enabled = !!asset?.lod;
    this.$("#objectLODEnabled").disabled = !asset; this.$("#objectLODEnabled").checked = enabled;
    for (let level = 0; level < 4; level++) {
      const item = config.levels[level], resource = item?.resourceId ? this.data.getResource(item.resourceId) : null;
      this.$(`[data-lod-triangles="${level}"]`).textContent = this.count(resource);
      this.$(`[data-lod-name="${level}"]`).textContent = resource?.name ?? (item?.resourceId ? "Missing GLB" : "Unassigned");
      this.$(`[data-lod-row="${level}"]`).disabled = !enabled;
      this.$(`[data-lod-clear="${level}"]`).disabled = !item?.resourceId;
      const active = this.$(`[data-lod-enabled="${level}"]`); active.checked = item?.enabled ?? false; active.disabled = !item?.resourceId;
      const distance = this.$(`[data-lod-distance="${level}"]`);
      if (document.activeElement !== distance) distance.value = item?.distance ?? [0, 80, 600, 2000][level];
      const option = this.$("#objectLODPreview").options[level + 1]; option.disabled = !item?.resourceId;
    }
    this.$("#objectLODMaxDistance").disabled = this.$("#objectLODHysteresis").disabled = !enabled;
    if (document.activeElement !== this.$("#objectLODMaxDistance")) this.$("#objectLODMaxDistance").value = config.maxDistance ?? 0;
    if (document.activeElement !== this.$("#objectLODHysteresis")) this.$("#objectLODHysteresis").value = Math.round(config.hysteresis * 100);
    this.$("#objectLODWarnings").textContent = lodWarnings(asset, id => this.data.getResource(id)).join(" ");
  }
  update(activeLevel, previewLevel) {
    if (this.dirty || this.assetId !== this.getAssetId()) { this.dirty = false; this.refresh(); }
    const record = this.data.objects.get(this.getSelectedId()), selected = record?.assetId === this.getAssetId();
    this.$("#objectLODPreview").disabled = !selected;
    this.$("#objectLODPreview").value = previewLevel == null ? "auto" : String(previewLevel);
    const message = selected ? `Active LOD: ${activeLevel == null ? "loading" : activeLevel < 0 ? "missing model" : activeLevel}${previewLevel == null ? " · automatic" : " · preview"}` : "Select a placed object to preview LOD.";
    if (this.$("#objectLODActive").textContent !== message) this.$("#objectLODActive").textContent = message;
  }
  dispose() { this.disposed = true; this.unsubscribe(); this.element.removeEventListener("focusout", this.onFocusOut); }
}
