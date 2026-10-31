import { copy, copyAsset } from "../objects/ObjectData.js";
import { DESTRUCTIBLE_DEFAULTS, normalizeDestructible, resolveDestructible } from "../objects/DestructibleConfig.js";

export function commitDestructible(data, id, value, recordHistory) {
  const before = data.objects.get(id); if (!before) return;
  const config = normalizeDestructible(value === false ? { enabled: false } : value);
  if (JSON.stringify(before.properties.destructible ?? null) === JSON.stringify(config)) return;
  const after = copy(before);
  if (config) after.properties.destructible = config;
  else delete after.properties.destructible;
  data.setObject(after);
  recordHistory({ kind: "object", entries: { id, before: copy(before), after: copy(data.objects.get(id)) } });
}

export function commitAssetDestructible(data, id, value, recordHistory) {
  const asset = data.assets.get(id); if (!asset) return;
  const config = normalizeDestructible(value);
  if (JSON.stringify(asset.destructible ?? null) === JSON.stringify(config)) return;
  const before = copyAsset(asset), after = copyAsset(asset);
  if (config) after.destructible = config;
  else delete after.destructible;
  data.setAsset(after);
  recordHistory({ kind: "objectAsset", entries: { id, before, after: copyAsset(data.assets.get(id)) } });
}

// Same controls/validation for library defaults and complete placement overrides.
export class DestructiblePanel {
  constructor(editor, element, { assetDefaults = false } = {}) {
    Object.assign(this, { editor, element, assetDefaults });
    this.prefix = assetDefaults ? "assetDestructible" : "objectDestructible";
    this.$ = suffix => element.querySelector(`#${this.prefix}${suffix}`);
    element.innerHTML = `
      ${assetDefaults ? "<h3>Destructible defaults</h3>" : `<label class="object-check">Override asset destructible defaults<input id="${this.prefix}Override" type="checkbox"></label>`}
      <fieldset id="${this.prefix}Settings">
        <label class="object-check">Destructible<input id="${this.prefix}Enabled" type="checkbox"></label>
        <div id="${this.prefix}Fields">
          <label>HP<input id="${this.prefix}Health" type="number" min="0.01" step="1"></label>
          <label>Debris GLB<select id="${this.prefix}Asset"></select></label>
          <label>Debris lifetime (seconds)<input id="${this.prefix}Lifetime" type="number" min="0.1" step="0.1"></label>
          <label>Impulse strength<input id="${this.prefix}Impulse" type="number" min="0" step="0.1"></label>
        </div>
      </fieldset>
      <p id="${this.prefix}Status" role="status"></p>`;
    for (const input of element.querySelectorAll("input, select")) input.onchange = event => {
      editor.finishTransform();
      const target = this.target(); if (!target) return;
      try {
        if (!assetDefaults && event.target === this.$("Override")) {
          commitDestructible(editor.data, target.id, this.$("Override").checked ? this.config() : null, editor.recordHistory);
        } else {
          const config = { ...this.config(), enabled: this.$("Enabled").checked,
            health: Number(this.$("Health").value), destroyedAsset: this.$("Asset").value,
            debrisLifetime: Number(this.$("Lifetime").value), impulseStrength: Number(this.$("Impulse").value) };
          const commit = assetDefaults ? commitAssetDestructible : commitDestructible;
          commit(editor.data, target.id, config, editor.recordHistory);
        }
      }
      catch (error) { editor.onStatus(error.message); }
      this.refresh();
    };
    this.refresh();
  }
  target() {
    return this.assetDefaults ? this.editor.data.assets.get(this.editor.assetId) : this.editor.data.objects.get(this.editor.selectedId);
  }
  config() {
    const target = this.target();
    const config = this.assetDefaults ? normalizeDestructible(target?.destructible)
      : resolveDestructible(this.editor.data.assets.get(target?.assetId), target);
    return config ?? { ...DESTRUCTIBLE_DEFAULTS, enabled: false };
  }
  refresh() {
    const target = this.target(), config = this.config();
    const overridden = target?.properties?.destructible != null;
    if (!this.assetDefaults) {
      this.$("Override").checked = overridden;
      this.$("Override").disabled = !target;
    }
    this.$("Settings").disabled = !target || (!this.assetDefaults && !overridden);
    this.$("Enabled").checked = config.enabled;
    this.$("Fields").hidden = !config.enabled;
    for (const [suffix, value] of [["Health", config.health], ["Lifetime", config.debrisLifetime], ["Impulse", config.impulseStrength]]) {
      if (document.activeElement !== this.$(suffix)) this.$(suffix).value = value;
    }
    const list = this.$("Asset"); list.replaceChildren(new Option("box2.glb (bundled wooden panels)", "box2.glb"));
    for (const asset of [...this.editor.data.assets.values(), ...this.editor.data.resources.values()]) list.add(new Option(asset.name, asset.id));
    if (![...list.options].some(option => option.value === config.destroyedAsset)) list.add(new Option("Missing debris GLB", config.destroyedAsset));
    list.value = config.destroyedAsset;
    this.$("Status").textContent = this.assetDefaults
      ? target ? `Defaults for “${target.name}”. Existing and new placements inherit unless overridden. Each copy has its own HP; damage resets on game restart.` : "Select a library asset to edit its destructible defaults."
      : !target ? "Select a placed object to override its defaults."
        : `${overridden ? "Using this placement's override" : "Inheriting asset defaults"}: ${config.enabled ? `${config.health} HP` : "not destructible"}. ${overridden ? "Clear Override to inherit again." : "Enable Override to customize this placement."}`;
  }
}
