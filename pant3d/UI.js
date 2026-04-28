

class UI {
    constructor(canvas, input) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext("2d");
        this.input = input; // stavfel fixat också

        this.cube = new Image();
        this.cube.onload = () => {
            this.makeprimitives();
        };
        this.cube.src = "images/cube.png";
    }
    makeprimitives(){
        this.drawbutton("cube",0,0,100,100);
        
        
    }
    drawbutton(text,x,y,dx,dy){
        
   
        const mobile = mobileAndTabletCheck();

        let top = "#555";
        let bottom = "#2a2a2a";
        let border = "#888";
        let textColor = "white";
        let subColor = "rgba(255,255,255,0.75)";


        const grad = this.ctx.createLinearGradient(x, y, x, y + dy);
        grad.addColorStop(0, top);
        grad.addColorStop(1, bottom);
        
        
        
        this.ctx.save();

        this.ctx.fillStyle = grad;
        this.ctx.fillRect(x, y, dx, dy);

        this.ctx.strokeStyle = border;
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, dx, dy);
        if(text=="cube")
            this.ctx.drawImage(this.cube,x,y,dx,dy);

        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = mobile ? "18px Arial" : "16px Arial";
        this.ctx.fillText(text, x + dx / 2, y + dy -15);
        

  

        this.ctx.restore();
    }
        
        
        
        
    
    
    
}