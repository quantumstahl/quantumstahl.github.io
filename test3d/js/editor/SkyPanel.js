export class SkyPanel {
  constructor(environment, onChanged) {
    this.environment = environment;
    this.time = document.querySelector("#skyTime");
    this.output = document.querySelector("#skyTimeValue");
    this.cycle = document.querySelector("#skyCycle");
    this.duration = document.querySelector("#skyDuration");
    const configure = changes => {
      environment.configure(changes);
      this.update();
      onChanged();
    };
    this.time.addEventListener("input", () => configure({ timeOfDay: Number(this.time.value) / 1440 }));
    this.cycle.addEventListener("change", () => configure({ cycleEnabled: this.cycle.checked, timeOfDay: environment.timeOfDay }));
    this.duration.addEventListener("change", () => {
      if (Number.isFinite(this.duration.valueAsNumber)) configure({ dayDuration: this.duration.valueAsNumber });
      this.duration.value = environment.settings.dayDuration;
    });
    for (const button of document.querySelectorAll("[data-sky-time]")) {
      button.addEventListener("click", () => configure({ timeOfDay: Number(button.dataset.skyTime) }));
    }
    this.duration.value = environment.settings.dayDuration;
    this.update();
  }

  update() {
    const minutes = Math.min(1439, Math.floor(this.environment.timeOfDay * 1440 + 1e-7));
    this.time.value = minutes;
    this.output.textContent = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    this.cycle.checked = this.environment.settings.cycleEnabled;
  }
}
