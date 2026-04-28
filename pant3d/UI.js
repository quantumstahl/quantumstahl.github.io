class UI {
    constructor(canvas, input,app) {
        this.canvas = canvas;
        this.ctx = this.canvas.getContext("2d");
        this.input = input; // stavfel fixat också
        this.app = app;
        this.cube = new Image();
        this.cube.src = "images/cube.png";
        this.cone = new Image();
        this.cone.src = "images/cone.png";
        this.cylinder = new Image();
        this.cylinder.src = "images/cylinder.png";
        this.sphere = new Image();
        this.sphere.src = "images/sphere.png";
        this.plane = new Image();
        this.plane.src = "images/plane.png";
        
        
        this.selected="";
        this.selectedtool="[Move]";
        
    }
    update(){
        this.makeprimitives();
        
        
    }
    makeprimitives(){
        this.drawbutton("cube",0,this.canvas.height-150,150,150);
        this.drawbutton("cone",150,this.canvas.height-150,150,150);
        this.drawbutton("cylinder",300,this.canvas.height-150,150,150);
        this.drawbutton("sphere",450,this.canvas.height-150,150,150);
        this.drawbutton("plane",600,this.canvas.height-150,150,150);
        
        this.drawbuttonstools("[Select]",0,this.canvas.height-225,150,75);
        this.drawbuttonstools("[Move]",150,this.canvas.height-225,150,75);
        
        
    }
    drawbuttonstools(text,x,y,dx,dy){
        
        const mobile = mobileAndTabletCheck();

        let top = "#555";
        let bottom = "#2a2a2a";
        let border = "#888";
        let textColor = "white";
        let subColor = "rgba(255,255,255,0.75)";

        this.ctx.save();

        this.ctx.fillStyle = "#252628";
        this.ctx.fillRect(x, y, dx, dy);

        this.ctx.strokeStyle = border;
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(x, y, dx-4, dy-4);

        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = mobile ? "25px Arial" : "20px Arial";
        this.ctx.fillText(text, x + dx / 2, y + dy -30);

        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            this.selectedtool=text;
            if(text==="[Select]"){this.app.tools.setTool("select");}
            if(text==="[Move]"){this.app.tools.setTool("move");}
        }
        
        if(this.selectedtool===text){
            this.ctx.strokeStyle = "blue";
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(x, y, dx-4, dy-4);
 
        }
        this.ctx.restore();
        
        
        
        
        
        
    }
    
    
    drawbutton(text,x,y,dx,dy){
        
   
        const mobile = mobileAndTabletCheck();

        let top = "#555";
        let bottom = "#2a2a2a";
        let border = "#888";
        let textColor = "white";
        let subColor = "rgba(255,255,255,0.75)";


        
        
        
        this.ctx.save();

        this.ctx.fillStyle = "#252628";
        this.ctx.fillRect(x, y, dx, dy);

        this.ctx.strokeStyle = border;
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(x, y, dx-4, dy-4);
        if(text=="cube")this.ctx.drawImage(this.cube,x+20,y+2,dx-40,dy-40);
        if(text=="cone")this.ctx.drawImage(this.cone,x+20,y+2,dx-40,dy-40);
        if(text=="cylinder")this.ctx.drawImage(this.cylinder,x+20,y+2,dx-40,dy-40);
        if(text=="sphere")this.ctx.drawImage(this.sphere,x+20,y+2,dx-40,dy-40);
        if(text=="plane")this.ctx.drawImage(this.plane,x+20,y+2,dx-40,dy-40);

        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = mobile ? "25px Arial" : "20px Arial";
        this.ctx.fillText(text, x + dx / 2, y + dy -30);

        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            this.selected=text;
            this.app.addPrimitive(text);
        }
        
        if(this.selected===text){
            this.ctx.strokeStyle = "blue";
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(x, y, dx-4, dy-4);
 
        }
        this.ctx.restore();
    }

}