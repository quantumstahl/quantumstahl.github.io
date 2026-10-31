// Reuse EnvironmentSystem's eased uDaylight value, including its twilight band.
// Reconcile at 4 Hz; schedule smooth audio-clock ramps only when levels change.
export class DayNightAudio {
  constructor(audio) {
    this.audio = audio; this.age = Infinity; this.disposed = false;
    this.layers = [
      { id: "birds", volume: .5, voice: null, level: -1, failed: false },
      { id: "crickets", volume: .4, voice: null, level: -1, failed: false },
      { id: "wind", volume: .18, voice: null, level: -1, failed: false },
    ];
    for (const layer of this.layers) layer.volume = audio.config.get(layer.id)?.volume ?? layer.volume;
  }
  update(delta, daylight) {
    if (this.disposed) return;
    this.age += Number.isFinite(delta) ? Math.max(0, delta) : 0;
    if (this.age < .25) return;
    this.age = 0;
    daylight = Number.isFinite(daylight) ? Math.max(0, Math.min(1, daylight)) : 1;
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const amount = i === 0 ? daylight : i === 1 ? 1 - daylight : 1;
      const level = Math.round(amount * layer.volume * 100) / 100;
      if (level <= .01) {
        layer.voice?.stop({ fade: 2 }); layer.voice = null; layer.level = 0;
      } else if (!layer.voice && !layer.failed) {
        const voice = this.audio.play(layer.id, { channel: "ambient", loop: true, volume: level, fade: 2 });
        layer.voice = voice; layer.level = level;
        if (voice) voice.ready.then(playing => { if (!playing && layer.voice === voice) layer.failed = true; });
      } else if (layer.voice && Math.abs(level - layer.level) >= .01) {
        layer.voice.setVolume(level, { fade: 1 }); layer.level = level;
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Include outgoing fades whose handles have already left the layer slot.
    for (const layer of this.layers) { this.audio.stop(layer.id); layer.voice = null; }
  }
}
