import { MenuNavigation } from "./MenuNavigation.js";

const INTRO = [
  [0, "Once upon a time, when the world was still young, there existed a golden thread."],
  [9, "Not an ordinary thread, but one that bound together the countless paths of tomorrow. It was known as… the Golden Yarn."],
  [17, "For ages, it lay hidden, untouched by those who wished to bend fate to their will."],
  [25, "But far beyond the mountains, in the Shadowlands, a dark king had begun to stir."],
  [34, "The Spider King, master of a thousand webs, dreamed of weaving every future into one of his own making."],
  [43, "And so, as shadows slowly crept across the land, an unlikely hero was about to begin a most extraordinary journey."],
  [51, "A little cat… who knew nothing of kings, ancient magic, or the fate of the world. Not yet, anyway."],
];

export class MenuController {
  constructor({ session, saves, settings, audio, presentation, documentTarget = document, eventTarget = window,
    navigatorTarget = navigator, onTransition = () => {} }) {
    Object.assign(this, { session, saves, settings, audio, presentation, document: documentTarget,
      events: eventTarget, navigator: navigatorTarget, onTransition });
    this.mode = "main"; this.screen = "main";
    this.dirty = false; this.busy = false; this.navigation = new MenuNavigation();
    this.root = this.element("section", "game-settings game-menu");
    this.root.setAttribute("role", "dialog"); this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-labelledby", "menuTitle");
    this.panel = this.element("div", "game-menu__panel");
    this.heading = this.element("h1"); this.heading.id = "menuTitle";
    this.subtitle = this.element("p", "game-menu__subtitle");
    this.content = this.element("div", "game-menu__content");
    this.status = this.element("p", "game-menu__status"); this.status.setAttribute("role", "status");
    this.hint = this.element("p", "game-menu__hint"); this.hint.textContent = "↑ ↓ Select · Enter / A Confirm · Esc / B Back";
    this.panel.append(this.heading, this.subtitle, this.content, this.status, this.hint); this.root.append(this.panel);
    this.pauseButton = this.element("button", "game-settings game-pause");
    this.pauseButton.type = "button"; this.pauseButton.textContent = "Ⅱ"; this.pauseButton.setAttribute("aria-label", "Pause game");
    this.pauseButton.onclick = () => this.pause();
    this.document.body.append(this.root, this.pauseButton);
    this.keydown = event => this.key(event);
    this.pointerdown = event => {
      if (event.pointerType === "touch") {
        this.session.runtime.input.preferTouch = true; this.session.runtime.input.syncTouch();
      }
    };
    this.background = () => { if (!this.busy && ["play", "intro"].includes(this.mode)) this.pause(); };
    this.visibility = () => { if (this.document.hidden) this.background(); };
    this.beforeUnload = event => { if (this.dirty) { event.preventDefault(); event.returnValue = ""; } };
    this.events.addEventListener("keydown", this.keydown, true);
    this.events.addEventListener("pointerdown", this.pointerdown, true);
    this.events.addEventListener("blur", this.background);
    this.document.addEventListener("visibilitychange", this.visibility);
    this.events.addEventListener("beforeunload", this.beforeUnload);
    this.presentation.enter(); this.transition(); this.render();
  }
  element(tag, className = "") { const el = this.document.createElement(tag); el.className = className; return el; }
  get playing() { return this.mode === "play" && !this.busy; }
  get showingScene() { return this.mode === "main" || this.mode === "intro" || (this.mode === "pause" && this.resumeMode === "intro"); }
  transition() {
    this.session.runtime.input.setMenuBlocked(!this.playing || !!this.session.runtime.cinematic?.active);
    this.audio.setMenuPaused(this.mode === "pause" || this.busy);
    this.root.hidden = this.mode === "play";
    this.pauseButton.hidden = !["play", "intro"].includes(this.mode) || this.busy;
    this.document.body.classList.toggle("game-menu-open", !this.playing);
    const hud = this.document.querySelector("#gameHud"); if (hud) hud.hidden = !this.playing;
    this.onTransition();
  }
  button(label, action, disabled = false) {
    const el = this.element("button", "game-menu__button"); el.type = "button"; el.textContent = label; el.disabled = disabled;
    el.onclick = () => this.run(action); this.content.append(el); return el;
  }
  message(text) { this.status.textContent = text; }
  async run(action) {
    if (this.busy) return;
    try { await action(); } catch (error) { this.message(error.message); }
  }
  availableSaves() {
    try {
      const list = this.saves.list();
      if (this.saves.unavailable?.length) this.message(`${this.saves.unavailable.length} stored save(s) cannot load here. Open Load Game to see reasons or export originals. Nothing was deleted.`);
      return list;
    } catch { this.message("Browser storage is unavailable. Saves cannot be loaded or persisted."); return []; }
  }
  render() {
    this.content.replaceChildren(); this.message(""); this.subtitle.textContent = "";
    this.root.dataset.screen = this.screen;
    if (this.screen === "main") {
      this.heading.textContent = "CatAdventure"; this.subtitle.textContent = "and the Golden Yarn";
      const list = this.availableSaves();
      this.button("Continue", () => this.load(list[0].key), !list.length);
      this.button("New Game", () => this.newGame());
      this.button("Load Game", () => this.open("load"), !list.length && !this.saves.unavailable?.length);
      this.button("Settings", () => this.open("settings"));
    } else if (this.screen === "pause") {
      this.heading.textContent = "A little rest";
      const list = this.availableSaves();
      this.button("Resume", () => this.resume());
      this.button("Save Game", () => this.save(), this.resumeMode !== "play" || !this.session.canSave);
      this.button("Load Game", () => this.open("load"), !list.length && !this.saves.unavailable?.length);
      this.button("Settings", () => this.open("settings"));
      this.button("Quit to Main Menu", () => this.requestQuit());
      if (this.resumeMode !== "play") this.message("Saving is available after the introduction.");
      else if (!this.session.canSave) this.message("Resume to finish respawning before saving.");
    } else if (this.screen === "settings") {
      this.heading.textContent = "Settings"; this.renderSettings(); this.button("Back", () => this.back());
    } else if (this.screen === "load") {
      this.heading.textContent = "Load Game";
      const available = this.availableSaves();
      for (const save of available) this.button(`${save.name} · ${save.state.pickups.coinCount} coins${save.legacy ? ' · Legacy save recovered by stable IDs' : ''}`, () => this.requestLoad(save.key));
      for (const save of this.saves.unavailable ?? []) {
        const reason = this.element('p', 'game-menu__subtitle'); reason.textContent = `${save.name}: ${save.reason}`;
        this.content.append(reason);
        this.button(`Export original: ${save.name}`, () => this.exportSave(save.key));
      }
      if (!available.length) this.subtitle.textContent = this.saves.unavailable?.length ? 'Stored saves are listed below with compatibility details. Originals are preserved.' : 'No saves in this browser for this world.';
      this.button("Back", () => this.back());
    } else if (this.screen === "confirm") {
      this.heading.textContent = "Leave this adventure?";
      this.subtitle.textContent = "You have unsaved progress. Save a new entry or discard the changes to continue.";
      this.button("Keep playing", () => { this.screen = this.confirmFrom; this.render(); });
      this.button("Save and continue", async () => { await this.save(); await this.pendingAction(); }, this.resumeMode !== "play" || !this.session.canSave);
      this.button("Discard changes", () => this.pendingAction());
    } else if (this.screen === "intro") {
      this.heading.textContent = "The Golden Yarn";
      this.introText = this.element("p", "game-menu__narration"); this.content.append(this.introText);
      this.introIndex = -1; this.updateIntroText();
      this.button("Wake up · Skip introduction", () => this.finishIntro());
    }
    if (this.saves.worldKey.startsWith("development")) this.subtitle.textContent += " · Development saves";
    this.focusables()[0]?.focus({ preventScroll: true });
  }
  renderSettings() {
    const title = text => { const el = this.element("h2"); el.textContent = text; this.content.append(el); };
    const field = (label, key, options) => {
      const row = this.element("label", "game-menu__field"), span = this.element("span"); span.textContent = label;
      const control = this.element(options ? "select" : "input");
      if (options) {
        for (const [value, text] of options) { const el = this.element("option"); el.value = value; el.textContent = text; control.append(el); }
        control.value = String(this.settings.value[key]);
      } else if (["grass", "flowers"].includes(key)) { control.type = "checkbox"; control.checked = this.settings.value[key]; }
      else { control.type = "range"; control.min = "0"; control.max = "1"; control.step = ".05"; control.value = this.settings.value[key]; }
      control.setAttribute("aria-label", label); control.dataset.setting = key;
      const output = this.element("output");
      const volume = !options && control.type === "range";
      if (volume) output.textContent = `${Math.round(control.value * 100)}%`;
      const change = () => {
        const value = control.type === "checkbox" ? control.checked : key === "quality" ? control.value : Number(control.value);
        const persisted = this.settings.set(key, value);
        if (volume) output.textContent = `${Math.round(control.value * 100)}%`;
        if (key === "quality") { this.render(); this.content.querySelector('[data-setting="quality"]')?.focus(); }
        this.message(persisted ? "Settings saved." : "Applied for this session. Browser storage is unavailable.");
      };
      if (volume) control.oninput = change; else control.onchange = change;
      row.append(span, control); if (volume) row.append(output); this.content.append(row);
    };
    title("Graphics");
    field("Quality", "quality", [["low", "Low · mobile"], ["balanced", "Balanced"], ["high", "High"]]);
    field("Render scale", "renderScale", [.5, .65, .75, 1, 1.25, 1.5, 2].map(n => [String(n), `${Math.round(n * 100)}%`]));
    field("Grass", "grass"); field("Flowers", "flowers");
    const note = this.element("p", "game-menu__note"); note.textContent = "Shadows: shadow maps are unavailable in this renderer."; this.content.append(note);
    title("Sound");
    for (const [key, label] of [["master", "Master"], ["music", "Music"], ["ambient", "Ambient"], ["sfx", "Sound effects"]]) field(label, key);
  }
  focusables() { return [...this.content.querySelectorAll("button:not(:disabled), input, select")]; }
  focusStep(direction) {
    const elements = this.focusables(), index = elements.indexOf(this.document.activeElement);
    const next = elements[(index + direction + elements.length) % elements.length]; next?.focus({ preventScroll: true });
    next?.scrollIntoView?.({ block: "nearest" });
  }
  adjust(direction) {
    const el = this.document.activeElement;
    if (el?.tagName === "SELECT") {
      el.selectedIndex = (el.selectedIndex + direction + el.options.length) % el.options.length;
      el.onchange?.();
    } else if (el?.type === "range") {
      el.value = Math.max(0, Math.min(1, Number(el.value) + direction * .05)); el.oninput?.();
    } else if (el?.type === "checkbox") { el.checked = !el.checked; el.onchange?.(); }
  }
  navigate(action) {
    if (this.busy) return;
    if (this.mode === 'play' && this.session.runtime.cinematic?.active && ['confirm', 'back', 'start'].includes(action)) {
      this.session.runtime.cinematic.skip(); return;
    }
    if (action === "start") { this.mode === "pause" ? this.resume() : this.pause(); return; }
    if (this.mode === "play") return;
    if (action === "back") { this.back(); return; }
    if (action === "up" || action === "down") this.focusStep(action === "up" ? -1 : 1);
    else if (action === "left" || action === "right") this.adjust(action === "left" ? -1 : 1);
    else if (action === "confirm") {
      const el = this.document.activeElement;
      if (el?.tagName === "SELECT") this.adjust(1); else el?.click();
    }
  }
  key(event) {
    if (this.mode === "play" && event.code !== "Escape") return;
    const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "confirm", Space: "confirm", Escape: "back" };
    const action = map[event.code];
    if (action || event.code === "Tab") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat && ["confirm", "back"].includes(action)) return;
      if (event.code === "Tab") this.focusStep(event.shiftKey ? -1 : 1);
      else if (event.code === "Escape" && ["play", "intro"].includes(this.mode)) this.pause();
      else this.navigate(action);
    } else if (this.mode !== "play") event.stopImmediatePropagation();
  }
  open(screen) { this.screen = screen; this.render(); }
  back() {
    if (this.screen === "confirm") { this.screen = this.confirmFrom; this.render(); }
    else if (["settings", "load"].includes(this.screen)) { this.screen = this.mode === "main" ? "main" : "pause"; this.render(); }
    else if (this.mode === "pause") this.resume();
    else if (this.mode === "intro") this.pause();
  }
  pause() {
    if (this.busy || !["play", "intro"].includes(this.mode)) return;
    this.resumeMode = this.mode; this.mode = "pause"; this.screen = "pause"; this.transition(); this.render();
  }
  resume() {
    if (this.busy || this.mode !== "pause") return;
    this.mode = this.resumeMode; this.screen = this.mode; this.transition();
    if (this.mode === "intro") this.render(); else this.document.activeElement?.blur();
  }
  async withLoading(action) {
    if (this.busy) return;
    this.busy = true; this.transition(); this.message("Loading adventure…"); this.root.setAttribute("aria-busy", "true");
    try { await action(); }
    finally { this.busy = false; this.root.removeAttribute("aria-busy"); this.transition(); }
  }
  async newGame() {
    await this.withLoading(async () => {
      this.stopIntro(); this.presentation.exit(); await this.session.reset(); this.presentation.enter();
      this.introElapsed = 0; this.mode = "intro"; this.screen = "intro"; this.dirty = true; this.render();
    });
    this.introVoice = this.audio.play("introduction", { preserveOnPause: true });
  }
  updateIntroText() {
    const index = INTRO.findLastIndex(([time]) => this.introElapsed >= time);
    if (index !== this.introIndex) { this.introIndex = index; this.introText.textContent = INTRO[Math.max(0, index)][1]; }
  }
  finishIntro() {
    if (this.busy || this.mode !== "intro") return;
    this.stopIntro(); this.presentation.exit();
    this.session.runtime.syncVisual(1, 0);
    this.mode = "play"; this.screen = "play"; this.transition(); this.document.activeElement?.blur();
  }
  stopIntro() { this.introVoice?.stop(); this.introVoice = null; }
  async load(key) {
    const save = this.saves.read(key); // Validate before exiting the title shot.
    await this.withLoading(async () => {
      await this.session.restore(save.state);
      this.stopIntro(); this.presentation.exit(); this.session.runtime.syncVisual(1, 0);
      this.mode = "play"; this.screen = "play"; this.dirty = false;
    });
    this.document.activeElement?.blur();
  }
  save() {
    if (this.resumeMode !== "play" || !this.session.canSave) throw new Error("Resume to finish the introduction or respawn before saving.");
    const save = this.saves.create(this.session.capture()); this.dirty = false;
    if (this.screen === "pause") this.render();
    this.message(`Saved ${save.name}. A new entry was created.`); return save;
  }
  exportSave(key) {
    const raw = this.saves.getRaw(key), blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = this.element('a');
    link.href = url; link.download = 'catadventure-save-original.json'; this.document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.message('Exported the original stored save. Browser data was not changed.');
  }
  confirm(action) {
    if (!this.dirty) return this.run(action);
    this.pendingAction = action; this.confirmFrom = this.screen; this.screen = "confirm"; this.render();
  }
  requestLoad(key) { return this.confirm(() => this.load(key)); }
  requestQuit() { return this.confirm(() => this.quit()); }
  async quit() {
    await this.withLoading(async () => {
      this.stopIntro(); this.presentation.exit(); await this.session.reset(); this.presentation.enter();
      this.mode = "main"; this.screen = "main"; this.dirty = false; this.render();
    });
  }
  update(now, delta) {
    let pads;
    try { pads = this.navigator.getGamepads?.(); } catch { /* Locked until controller activation. */ }
    const action = this.navigation.poll(pads, now); if (action) this.navigate(action);
    if (this.busy) return;
    if (this.mode === "intro") {
      this.introElapsed += delta; this.updateIntroText();
      if (this.introElapsed >= 59) this.finishIntro();
    }
    if (this.showingScene && this.mode !== "pause") this.presentation.update(delta);
  }
  gameplayAdvanced(delta) { if (delta > 0) { this.session.update(delta); this.dirty = true; } }
  dispose() {
    this.stopIntro(); this.presentation.exit();
    this.events.removeEventListener("keydown", this.keydown, true); this.events.removeEventListener("pointerdown", this.pointerdown, true);
    this.events.removeEventListener("blur", this.background); this.events.removeEventListener("beforeunload", this.beforeUnload);
    this.document.removeEventListener("visibilitychange", this.visibility); this.root.remove(); this.pauseButton.remove();
  }
}
