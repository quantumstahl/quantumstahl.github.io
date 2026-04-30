class ScaleTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const selected = this.app.selected;
        const input = this.app.input;

        if (!selected) return;

        const speed = 0.01 * scale;

      


        // PC fallback
        if (input.keys["a"])  selected.scale.x -= speed;
        if (input.keys["d"]) selected.scale.x += speed;
        if (input.keys["w"])    selected.scale.y += speed;
        if (input.keys["s"])  selected.scale.y -= speed;
        
        const box = new THREE.Box3().setFromObject(selected);

        if (box.min.y < 0) {
            selected.position.y -= box.min.y;
        }
        
    }
}