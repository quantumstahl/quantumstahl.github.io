class UniformScale {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const selected = this.app.selected;
        const input = this.app.input;

        if (!selected) return;

        const speed = 0.005 * scale;

   
        if (input.keys["s"]) {   this.app.beginEdit();selected.scale.x -= speed;selected.scale.y -= speed;selected.scale.z -= speed;}
        else if (input.keys["w"]) {  this.app.beginEdit();selected.scale.x += speed;selected.scale.y += speed;selected.scale.z += speed;}
        else this.app.endEdit();
      //  if (input.keys["a"])    selected.scale.z += speed;
       // if (input.keys["d"])  selected.scale.z -= speed;
        
        const box = new THREE.Box3().setFromObject(selected);

        if (box.min.y < 0) {
            selected.position.y -= box.min.y;
        }
        
    }
}