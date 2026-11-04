// Extra fields on the existing trigger inspector; the normal gizmo/history
// still owns sphere placement, selection, moves, resizing, undo and redo.
export class ArenaPanel {
  constructor(editor, element) {
    this.editor = editor; this.element = element;
    element.innerHTML = `<h3>Spherical encounter</h3>
      <label>Arena ID<input data-arena="arenaId"></label>
      <label>Radius (m)<input data-arena="radius" type="number" min="0.1" step="0.5"></label>
      <label>Min world height (blank = unlimited)<input data-arena="minHeight" type="number" step="0.1"></label>
      <label>Max world height (blank = unlimited)<input data-arena="maxHeight" type="number" step="0.1"></label>
      <label>Enemy object IDs (comma separated)<textarea data-arena="enemyIds" rows="3"></textarea></label>
      <label>Web barrier object IDs (comma separated)<textarea data-arena="barrierIds" rows="3"></textarea></label>
      <label class="trigger-check">Already completed<input data-arena="completed" type="checkbox"></label>
      <label>Victory reward<select data-arena="reward"><option value="">None</option><option value="coin">Coin</option><option value="heart">Heart</option></select></label>
      <label>Reward position (world meters)<span class="trigger-vector">${['X', 'Y', 'Z'].map((axis, i) => `<input type="number" step="0.1" data-reward-axis="${i}" aria-label="Reward ${axis}">`).join('')}</span></label>
      <p>Sphere detects entry only. Copy object IDs from the Objects inspector. Linked webs need Simple or Mesh solid collision. Completed encounters stay open. Active saves restart living enemies at full health at home, with webs closed.</p>`;
    element.onchange = event => {
      const e = this.editor, before = e.data.volumes.get(e.selectedId); if (before?.type !== 'Arena') return;
      const after = structuredClone(before), input = event.target, key = input.dataset.arena;
      if (key === 'completed') after.completed = input.checked;
      else if (key === 'enemyIds' || key === 'barrierIds') after[key] = input.value.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'arenaId') after.arenaId = input.value.trim();
      else if (key === 'reward') {
        if (input.value) after.reward = { type: input.value, position: after.reward?.position ?? [...after.position] };
        else delete after.reward;
      } else if (key) after[key] = input.value === '' ? null : Number(input.value);
      else if (input.dataset.rewardAxis != null && after.reward) after.reward.position[Number(input.dataset.rewardAxis)] = Number(input.value);
      else return;
      e.commit(before, after);
    };
  }
  refresh(record) {
    this.element.hidden = record?.type !== 'Arena';
    if (record?.type !== 'Arena') return;
    for (const input of this.element.querySelectorAll('[data-arena]')) {
      const key = input.dataset.arena;
      if (key === 'completed') input.checked = record.completed;
      else if (key === 'reward') input.value = record.reward?.type ?? '';
      else input.value = Array.isArray(record[key]) ? record[key].join(', ') : record[key] ?? '';
    }
    for (const input of this.element.querySelectorAll('[data-reward-axis]')) {
      input.disabled = !record.reward;
      input.value = (record.reward?.position ?? record.position)[Number(input.dataset.rewardAxis)];
    }
  }
}
