// Compact renderer monitor. Detailed timing probes are deliberately omitted
// from normal play because GPU queries can themselves disturb frame pacing.
export class PerformanceInfo {
  constructor(renderer) {
    this.renderer = renderer;
    // Detailed timing is opt-in. The normal play overlay should not add
    // performance.now() bookkeeping to every update path.
    this.profiling = false;
    this.frames = 0;
    this.elapsed = 0;
    this.fps = 0;
    this.frameMax = 0;
    this.timings = new Map();
    this.timingPeaks = new Map();
    this.lastTimings = [];
    this.objectCount = () => 0;
    this.element = document.createElement("aside");
    this.element.className = "performance-info";
    this.element.setAttribute("aria-live", "off");
    document.body.append(this.element);
    this.render();
  }
  // Lightweight compatibility hooks for the render loop.
  beginFrame() {}
  beginGpuTimer() {}
  endGpuTimer() {}
  measure(label, callback) {
    if (!this.profiling) return callback();
    const start = performance.now();
    try { return callback(); }
    finally {
      const elapsed = performance.now() - start;
      const timing = this.timings.get(label) ?? { total: 0, count: 0, max: 0 };
      timing.total += elapsed;
      timing.count++;
      timing.max = Math.max(timing.max, elapsed);
      this.timings.set(label, timing);
      const now = performance.now();
      const peak = this.timingPeaks.get(label);
      if (!peak || elapsed >= peak.value || now >= peak.until) {
        this.timingPeaks.set(label, { value: elapsed, until: now + 5000 });
      }
    }
  }
  endFrame(delta) {
    this.frames++;
    this.elapsed += delta;
    this.frameMax = Math.max(this.frameMax, delta * 1000);
    if (this.elapsed < .25) return;
    this.fps = Math.round(this.frames / this.elapsed);
    this.lastTimings = [...this.timings.entries()].map(([label, value]) => ({
      label,
      average: value.total / Math.max(1, value.count),
      max: value.max,
      peak: this.timingPeaks.get(label)?.value ?? value.max
    }));
    this.timings.clear();
    this.frames = 0;
    this.elapsed = 0;
    this.render();
    this.frameMax = 0;
  }
  setObjectCountProvider(provider) { this.objectCount = provider; }
  render() {
    const { render, memory } = this.renderer.info;
    const timings = this.lastTimings.map(item => `${item.label} ${item.average.toFixed(1)}/${item.max.toFixed(1)}/${item.peak.toFixed(1)}ms`);
    const timingSplit = Math.ceil(timings.length / 2);
    const timingRows = timings.length
      ? `\nCPU avg/max/5s-peak  ${timings.slice(0, timingSplit).join(" · ")}\nCPU avg/max/5s-peak  ${timings.slice(timingSplit).join(" · ")}`
      : "";
    this.element.textContent = `FPS  ${this.fps}\nObjects  ${this.objectCount().toLocaleString()}\nDraw calls  ${render.calls}\nTris  ${render.triangles.toLocaleString()}\nGeometries  ${memory.geometries}\nTextures  ${memory.textures}`;
  }
}
