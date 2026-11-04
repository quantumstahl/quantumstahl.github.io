import { TITLE_CHECKPOINT, MUSIC_STOP_CHECKPOINT, TITLE_TUNING, mountainTitleConfig, mountainTitleDestination } from '../game/MountainTitleConfig.js';

export class TitleRevealPanel {
  constructor(editor, element) {
    this.editor = editor; this.element = element;
    element.innerHTML = `<h3>Mountain title reveal</h3><p data-title-event></p>
      <div data-title-settings><label>Camera destination checkpoint ID<input data-title-camera-checkpoint></label>
      <label class="trigger-check">Automatic cat run destination<input type="checkbox" data-title-run-auto></label>
      <label>Safe destination feet (world meters)<span class="trigger-vector">${['X', 'Y', 'Z'].map((axis, i) => `<input data-title-destination="${i}" type="number" step="0.1" aria-label="Cinematic destination ${axis}">`).join('')}</span></label>
      ${Object.entries(TITLE_TUNING).map(([key, label]) => `<label>${label}<input data-title-setting="${key}" type="number" step="0.1"></label>`).join('')}
      <p data-title-sources></p><button type="button" data-title-defaults>Reset tuning to config defaults</button>
      <p>Camera travel is measured beyond cave clearance, before rising toward the marker. Automatic cat destination follows the marker's ground direction. Ground and camera collision remain active. Title appears at 8s.</p></div>`;
    element.querySelector('[data-title-defaults]').onclick = () => {
      const e = this.editor, before = e.data.volumes.get(e.selectedId); if (before?.id !== TITLE_CHECKPOINT) return;
      const after = structuredClone(before); after.titleReveal = { ...before.titleReveal };
      for (const key of Object.keys(TITLE_TUNING)) delete after.titleReveal[key];
      e.commit(before, after);
    };
    element.onchange = event => {
      const e = this.editor, before = e.data.volumes.get(e.selectedId); if (before?.id !== TITLE_CHECKPOINT) return;
      if (event.target.hasAttribute('data-title-run-auto')) {
        const after = structuredClone(before); after.titleReveal = { ...before.titleReveal };
        if (event.target.checked) delete after.titleReveal.destination;
        else after.titleReveal.destination = mountainTitleDestination(before, e.data.volumes);
        e.commit(before, after); return;
      }
      if (event.target.hasAttribute('data-title-camera-checkpoint')) {
        const after = structuredClone(before); after.titleReveal = { ...before.titleReveal };
        after.titleReveal.cameraCheckpointId = event.target.value.trim(); e.commit(before, after); return;
      }
      const value = Number(event.target.value); if (!Number.isFinite(value) || event.target.value === '') { this.refresh(before); return; }
      const after = structuredClone(before); after.titleReveal = { ...before.titleReveal };
      if (event.target.dataset.titleDestination != null) {
        after.titleReveal.destination ??= [...before.respawn.position];
        after.titleReveal.destination[Number(event.target.dataset.titleDestination)] = value;
      } else if (event.target.dataset.titleSetting) after.titleReveal[event.target.dataset.titleSetting] = value;
      else return;
      e.commit(before, after);
    };
  }
  refresh(record) {
    this.element.hidden = record?.type !== 'Checkpoint' || ![TITLE_CHECKPOINT, MUSIC_STOP_CHECKPOINT].includes(record?.id);
    if (this.element.hidden) return;
    this.element.querySelector('[data-title-event]').textContent = record.id === MUSIC_STOP_CHECKPOINT ? 'Fades gameplay music once over 2 seconds. Ambience and effects continue.' : 'Starts the once-per-adventure landscape title cinematic.';
    this.element.querySelector('[data-title-settings]').hidden = record.id !== TITLE_CHECKPOINT;
    const c = mountainTitleConfig(record.titleReveal);
    const overridden = Object.keys(TITLE_TUNING).filter(key => Object.hasOwn(record.titleReveal ?? {}, key));
    this.element.querySelector('[data-title-sources]').textContent = overridden.length
      ? `Placement overrides: ${overridden.join(', ')}. Other tuning follows MountainTitleConfig.js.`
      : 'All tuning follows MountainTitleConfig.js. Editing a field creates a placement override.';
    this.element.querySelector('[data-title-camera-checkpoint]').value = c.cameraCheckpointId;
    const automatic = !c.destination, destination = mountainTitleDestination(record, this.editor.data.volumes, c);
    this.element.querySelector('[data-title-run-auto]').checked = automatic;
    for (const input of this.element.querySelectorAll('[data-title-destination]')) {
      input.value = destination[Number(input.dataset.titleDestination)]; input.disabled = automatic;
    }
    for (const input of this.element.querySelectorAll('[data-title-setting]')) input.value = c[input.dataset.titleSetting];
  }
}
