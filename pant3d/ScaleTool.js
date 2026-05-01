class ScaleTool {
    constructor(app) {
        this.app = app;
    }

    update(scale) {
        const selected = this.app.selected;
        const input = this.app.input;

        if (!selected) return;

        const speed = 0.008 * scale;

      
       if(this.app.Yblue){
          if (input.keys["w"]){  this.app.beginEdit();   selected.scale.y += speed;}
          else if (input.keys["s"]){ this.app.beginEdit();  selected.scale.y -= speed;}
          else   this.app.endEdit();
          
       }
       
       else{
        // PC fallback
        if (input.keys["a"]){ this.app.beginEdit();  selected.scale.x -= speed;}
        else if (input.keys["d"]){ this.app.beginEdit(); selected.scale.x += speed;}
        else if (input.keys["w"]){ this.app.beginEdit();    selected.scale.z += speed;}
        else if (input.keys["s"]){  this.app.beginEdit(); selected.scale.z -= speed;}
        else   this.app.endEdit();
        }

        
        
        
        
        
        
        
        
        
        
        const box = new THREE.Box3().setFromObject(selected);

        if (box.min.y < 0) {
            selected.position.y -= box.min.y;
        }
        
    }
}