import { copy } from "../objects/ObjectData.js";
import { DESTRUCTIBLE_DEFAULTS, normalizeDestructible } from "../objects/DestructibleConfig.js";

export function commitDestructible(data, id, value, recordHistory) {
  const before = data.objects.get(id); if (!before) return;
  const after = copy(before); after.properties.destructible = normalizeDestructible(value);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  data.setObject(after);
  recordHistory({ kind: "object", entries: { id, before: copy(before), after: copy(after) } });
}

export class DestructiblePanel {
  constructor(editor, element) {
    this.editor = editor; this.element = element; this.$ = selector => element.querySelector(selector);
    element.innerHTML = `
      <label class="object-check">Destructible<input id="objectDestructible" type="checkbox"></label>
      <div id="destructibleFields" hidden>
        <label>Health<input id="destructibleHealth" type="number" min="0.01" step="1"></label>
        <label>Destroyed GLB asset<select id="destructibleAsset"></select></label>
        <label>Debris lifetime (seconds)<input id="destructibleLifetime" type="number" min="0.1" step="0.1"></label>
        <label>Impulse strength<input id="destructibleImpulse" type="number" min="0" step="0.1"></label>
        <p>Applies to this placement. Damage resets when the game session restarts. Bundled box2.glb contains six panels.</p>
      </div>`;
    for (const input of element.querySelectorAll("input, select")) input.onchange = () => {
      editor.finishTransform();
      const record = editor.data.objects.get(editor.selectedId); if (!record) return;
      const config = { ...DESTRUCTIBLE_DEFAULTS, ...record.properties.destructible,
        enabled: this.$("#objectDestructible").checked,
        health: Number(this.$("#destructibleHealth").value), destroyedAsset: this.$("#destructibleAsset").value,
        debrisLifetime: Number(this.$("#destructibleLifetime").value), impulseStrength: Number(this.$("#destructibleImpulse").value) };
      try { commitDestructible(editor.data, record.id, config, editor.recordHistory); }
      catch (error) { editor.onStatus(error.message); }
      this.refresh();
    };
    this.refresh();
  }
  refresh() {
    const record = this.editor.data.objects.get(this.editor.selectedId), config = record?.properties.destructible ?? DESTRUCTIBLE_DEFAULTS;
    this.$("#objectDestructible").checked = !!record?.properties.destructible?.enabled;
    this.$("#destructibleFields").hidden = !this.$("#objectDestructible").checked;
    this.$("#destructibleHealth").value = config.health;
    this.$("#destructibleLifetime").value = config.debrisLifetime;
    this.$("#destructibleImpulse").value = config.impulseStrength;
    const list = this.$("#destructibleAsset"); list.replaceChildren(new Option("box2.glb (bundled wooden panels)", "box2.glb"));
    for (const asset of [...this.editor.data.assets.values(), ...this.editor.data.resources.values()]) list.add(new Option(`${asset.name}.glb`, asset.id));
    if (![...list.options].some(option => option.value === config.destroyedAsset)) list.add(new Option("Missing destroyed asset", config.destroyedAsset));
    list.value = config.destroyedAsset;
  }
}
