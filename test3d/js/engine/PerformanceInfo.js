// Small dependency-free renderer monitor. It reads Three.js stats after the
// frame is rendered, so calls/triangles are for the frame the user just saw.
export class PerformanceInfo {
  constructor(renderer) {
    this.renderer = renderer;
    this.frames = 0;
    this.elapsed = 0;
    this.fps = 0;
    this.objectCount = () => 0;
    this.element = document.createElement("aside");
    this.element.className = "performance-info";
    this.element.setAttribute("aria-live", "off");
    document.body.append(this.element);
    this.render();
  }
  update(delta) {
    this.frames++;
    this.elapsed += delta;
    if (this.elapsed < .25) return;
    this.fps = Math.round(this.frames / this.elapsed);
    this.frames = 0; this.elapsed = 0;
    this.render();
  }
  setObjectCountProvider(provider) { this.objectCount = provider; }
  render() {
    const { render, memory } = this.renderer.info;
    this.element.textContent = `FPS  ${this.fps}\nObjects  ${this.objectCount().toLocaleString()}\nCalls  ${render.calls}\nTris  ${render.triangles.toLocaleString()}\nGeometries  ${memory.geometries}\nTextures  ${memory.textures}`;
  }
}
