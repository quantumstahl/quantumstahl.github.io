export async function readMaterialImage(file) {
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read this image."));
    reader.readAsDataURL(file);
  });
  await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error("Choose a supported image such as PNG, JPEG or WebP."));
    image.src = url;
  });
  return url;
}

export class TerrainMaterialPanel {
  constructor(root, data, cache, { onSelect, onEdit, onStatus }) {
    Object.assign(this, { root, data, cache, onSelect, onEdit, onStatus });
    this.activeMaterial = 0;
    this.importGenerations = new Map();
    this.nameInput = root.querySelector("#materialName");
    this.pathInput = root.querySelector("#materialPath");
    this.repeatInput = root.querySelector("#materialRepeat");
    this.fileInput = root.querySelector("#materialImageFile");
    this.loadStatus = root.querySelector("#materialLoadStatus");
    this.buttons = data.materials.map(material => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "material-slot";
      button.dataset.material = material.id;
      const image = document.createElement("img"); image.alt = "";
      const name = document.createElement("span");
      button.append(image, name);
      button.addEventListener("click", () => this.select(material.id));
      root.querySelector("#materialSlots").append(button);
      return button;
    });
    this.nameInput.addEventListener("change", () => {
      const name = this.nameInput.value.trim();
      if (name) onEdit(this.activeMaterial, { name });
      this.render();
    });
    this.pathInput.addEventListener("change", () => onEdit(this.activeMaterial, { texture: this.pathInput.value.trim() || null }));
    this.repeatInput.addEventListener("change", () => {
      if (this.repeatInput.checkValidity()) onEdit(this.activeMaterial, { repeatSize: Number(this.repeatInput.value) });
      else this.repeatInput.reportValidity();
    });
    root.querySelector("#importMaterialImage").addEventListener("click", () => this.fileInput.click());
    root.querySelector("#clearMaterialImage").addEventListener("click", () => onEdit(this.activeMaterial, { texture: null }));
    this.fileInput.addEventListener("change", async () => {
      const file = this.fileInput.files[0];
      this.fileInput.value = "";
      if (!file) return;
      const id = this.activeMaterial;
      const originalTexture = data.materials[id].texture;
      const generation = (this.importGenerations.get(id) ?? 0) + 1;
      this.importGenerations.set(id, generation);
      try {
        const texture = await readMaterialImage(file);
        if (generation !== this.importGenerations.get(id) || data.materials[id].texture !== originalTexture) return;
        const patch = { texture };
        if (/^Material \d+$/.test(data.materials[id].name)) patch.name = file.name.replace(/\.[^.]+$/, "") || data.materials[id].name;
        onEdit(id, patch);
        onStatus(`Imported ${file.name} — saved inside the world`);
      } catch (error) { onStatus(`Image import failed: ${error.message}`); }
    });
    this.unsubscribe = data.onChanged(event => { if (event.type === "palette") this.render(); });
    this.render();
  }

  select(id) {
    this.activeMaterial = id;
    this.render();
    this.onSelect(id);
  }

  render() {
    for (const material of this.data.materials) {
      const button = this.buttons[material.id];
      button.setAttribute("aria-pressed", String(material.id === this.activeMaterial));
      button.setAttribute("aria-label", `${material.id + 1}: ${material.name}${material.texture ? "" : " (empty)"}`);
      button.title = `${material.id + 1}: ${material.name}`;
      const image = button.querySelector("img");
      if (material.texture) { if (image.getAttribute("src") !== material.texture) image.src = material.texture; }
      else image.removeAttribute("src");
      image.hidden = !material.texture;
      button.querySelector("span").textContent = `${material.id + 1} · ${material.name}`;
    }
    const material = this.data.materials[this.activeMaterial];
    this.nameInput.value = material.name;
    this.pathInput.value = material.texture?.startsWith("data:") ? "" : material.texture ?? "";
    this.pathInput.placeholder = material.texture?.startsWith("data:") ? "Image saved inside world" : "assets/grass.png or image URL";
    this.repeatInput.value = material.repeatSize;
    this.updateLoadState();
  }

  updateLoadState() {
    const material = this.data.materials[this.activeMaterial];
    const message = !material.texture ? "Import an image to paint this slot."
      : this.cache.loadErrors.has(material.texture) ? "Image could not load. Check its path."
      : this.cache.uniforms.uMaterialReady.value[this.activeMaterial] ? "Ready to paint" : "Loading image…";
    if (this.loadStatus.textContent !== message) this.loadStatus.textContent = message;
  }
}
