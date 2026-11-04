import { copy } from '../objects/ObjectData.js';
import { isSpider, spiderType, spiderConfig, SPIDER_TUNING, BIG_SPIDER_TUNING } from '../enemies/SpiderConfig.js';

export class SpiderPanel {
  constructor(editor, element) {
    this.editor = editor; this.element = element;
    element.innerHTML = `<h3>Spider enemy</h3>
      <label class="object-check">Spider AI in game mode<input data-spider-enabled type="checkbox"></label>
      <div data-spider-values><label>Enemy type<select data-spider-type><option value="spider">Spider</option><option value="spiderbig">Big Spider miniboss</option></select></label>
      ${Object.entries(BIG_SPIDER_TUNING).map(([key, label]) =>
        `<label ${key in SPIDER_TUNING ? '' : 'data-big-spider'}>${label}<input data-spider="${key}" type="number" min="${key === 'maxHealth' ? 1 : 0}" step="${key === 'maxHealth' ? 1 : .05}"></label>`).join('')}</div>
      <p>Each spider has its own health. Jump onto it from above to stun, then claw for double damage. Big Spider sizes follow the GLB/placement scale unless overridden here. Big Spider wind-up crouches before a committed dash. Values use world meters and seconds.</p>`;
    element.querySelector('[data-spider-enabled]').onchange = event => this.edit(properties => {
      const e = this.editor, record = e.data.objects.get(e.selectedId);
      properties.enemy = event.target.checked ? { type: spiderType({ ...record, properties: {} }, e.data.assets.get(record.assetId)) ?? 'spider' } : false;
    });
    element.querySelector('[data-spider-type]').onchange = event => this.edit(properties => { properties.enemy = { type: event.target.value }; });
    for (const input of element.querySelectorAll('[data-spider]')) input.onchange = () => {
      const value = Number(input.value);
      if (input.value === '' || !Number.isFinite(value) || value < 0) { this.refresh(); return; }
      this.edit(properties => {
        const e = this.editor, record = e.data.objects.get(e.selectedId);
        properties.enemy = { ...(typeof properties.enemy === 'object' ? properties.enemy : {}),
          type: spiderType(record, e.data.assets.get(record.assetId)), [input.dataset.spider]: value };
      });
    };
  }
  edit(change) {
    const e = this.editor, before = e.data.objects.get(e.selectedId); if (!before) return;
    const after = copy(before); change(after.properties); e.commit(before, after); this.refresh();
  }
  refresh() {
    const e = this.editor, record = e.data.objects.get(e.selectedId);
    this.element.hidden = !record;
    if (!record) return;
    const type = spiderType(record, e.data.assets.get(record.assetId));
    const enabled = isSpider(record, e.data.assets.get(record.assetId)), config = spiderConfig(record.properties.enemy, type ?? 'spider');
    this.element.querySelector('[data-spider-type]').value = type ?? 'spider';
    for (const field of this.element.querySelectorAll('[data-big-spider]')) field.hidden = type !== 'spiderbig';
    this.element.querySelector('[data-spider-enabled]').checked = enabled;
    this.element.querySelector('[data-spider-values]').hidden = !enabled;
    for (const input of this.element.querySelectorAll('[data-spider]')) input.value = config[input.dataset.spider];
  }
}
