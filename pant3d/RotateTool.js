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
          if (input.keys["w"]) {  this.app.beginEdit(); selected.rotation.y += rotSpeed;}
          else if (input.keys["s"]){  this.app.beginEdit();selected.rotation.y -= rotSpeed;}
          else this.app.endEdit();
          
       }
       else{
            // PC fallback
            if (input.keys["a"]){  this.app.beginEdit();selected.rotation.z += rotSpeed;}
            else if (input.keys["d"]){this.app.beginEdit(); selected.rotation.z -= rotSpeed;}
            else if (input.keys["w"]){ this.app.beginEdit();   selected.rotation.x += rotSpeed;}
            else if (input.keys["s"]){ this.app.beginEdit(); selected.rotation.x -= rotSpeed;}
            else this.app.endEdit();
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