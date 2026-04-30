class RotateTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const selected = this.app.selected;
        const input = this.app.input;
        if (!selected) return;

        const rotSpeed = 0.005 * scale;

      if(this.app.Yblue){
          if (input.keys["w"])    selected.rotation.y += rotSpeed;
          if (input.keys["s"])  selected.rotation.y -= rotSpeed;
          
          
       }
       else{
            // PC fallback
            if (input.keys["a"])  selected.rotation.z += rotSpeed;
            if (input.keys["d"]) selected.rotation.z -= rotSpeed;
            if (input.keys["w"])    selected.rotation.x += rotSpeed;
            if (input.keys["s"])  selected.rotation.x -= rotSpeed;
        }
        // snap om du vill med t.ex. space
        if (input.keys[" "]) {
            this.snapRotation(selected, Math.PI / 4); // 45 grader
        }
    }

    snapRotation(obj, step) {
        obj.rotation.x = Math.round(obj.rotation.x / step) * step;
        obj.rotation.y = Math.round(obj.rotation.y / step) * step;
        obj.rotation.z = Math.round(obj.rotation.z / step) * step;
    }
}