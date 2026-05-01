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
        this.trash = new Image();
        this.trash.src = "images/trash.png";
        
        this.selected="";
        this.selectedtool="[Select]";
        this.grouptoggle=false;
        
        this.colors = [
            0x66aa55, // grön (du har)
            0x99cc66, // ljusgrön
            0x8B5A2B, // brun (trä)
            0xC68642, // hudfärg (ljus)
            0x7A5230, // hudfärg (mörkare)
            0xFF0000, // röd
            0x4D7CFE, // blå
            0xF4D35E, // gul
            0xFFFFFF, // vit
            0x222222  // mörk/grå istället för svart (ser bättre ut)
        ];
        
    }
    update(){
        this.makeprimitives();
        
        
    }
    makeprimitives(){
        
        const isLandscape = this.canvas.width > this.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, this.canvas.height * 0.18)
            : Math.min(150, this.canvas.width * 0.20);
        
        this.drawbutton("cube",0,this.canvas.height-btnSize,btnSize,btnSize);
        this.drawbutton("cone",btnSize,this.canvas.height-btnSize,btnSize,btnSize);
        this.drawbutton("cylinder",btnSize*2,this.canvas.height-btnSize,btnSize,btnSize);
        this.drawbutton("sphere",btnSize*3,this.canvas.height-btnSize,btnSize,btnSize);
        this.drawbutton("plane",btnSize*4,this.canvas.height-btnSize,btnSize,btnSize);
        this.drawbutton("trash",btnSize*5,this.canvas.height-btnSize*0.75,btnSize*0.75,btnSize*0.75);
        this.drawbutton("undo",btnSize*5.75,this.canvas.height-btnSize*1,btnSize*0.75,btnSize*0.50);
        this.drawbutton("redo",btnSize*5.75,this.canvas.height-btnSize*0.5,btnSize*0.75,btnSize*0.50);
        
        this.drawYbutton("Y",0,this.canvas.height-btnSize*1.5,btnSize/2,btnSize/2);
        this.drawbuttonstools("[Select]",btnSize/2,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("[Move]",btnSize*1.25,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("[Rotate]",btnSize*2,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("[Scale]",btnSize*2.75,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("[UniScale]",btnSize*3.50,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("[Duplicate]",btnSize*4.25,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("[Group]",btnSize*5,this.canvas.height-btnSize*1.5,btnSize*0.75,btnSize/2);
        
        
        for(let i=0;i<this.colors.length;i++){
            
            this.drawColorButton(this.colors[i], 0+(i*btnSize/2 + btnSize*1.5), 0 , btnSize/2);
            
        }
        this.drawbuttonstools("LOAD",btnSize*0.75,0,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("SAVE",0,0,btnSize*0.75,btnSize/2);
        
    }
    drawYbutton(text,x,y,dx,dy){
        
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
        this.ctx.font = (dx/3)+"px Arial";
        this.ctx.fillText(text, x + dx / 2 -2, y + dy -30);

        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            if(this.app.Yblue===true)this.app.Yblue=false;
            else if(this.app.Yblue===false)this.app.Yblue=true;
            
        }
        
        if(this.app.Yblue===true){
            this.ctx.strokeStyle = "blue";
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(x, y, dx-4, dy-4);
       
 
        }
  
        
        this.ctx.restore();
        
        
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
        
        if(text==="LOAD"){
            
            
              const input = document.getElementById("loadFileInput");
  

          

                input.style.left = x + "px";
                input.style.top = y + "px";
                input.style.width = dx + "px";
                input.style.height = dy + "px";

            
            
            
            
            
        }
        
        
        
        
        
        
        
        
        
        this.ctx.strokeStyle = border;
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(x, y, dx-4, dy-4);

        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = (dx/6)+"px Arial";
        this.ctx.fillText(text, x + dx / 2, y + dy -30);

        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            this.selectedtool=text;
            if(text==="[Select]"){this.app.tools.setTool("select");}
            if(text==="[Move]"){this.app.tools.setTool("move");}
            if(text==="[Rotate]"){this.app.tools.setTool("rotate");}
            if(text==="[Scale]"){this.app.tools.setTool("scale");}
            if(text==="[UniScale]"){this.app.tools.setTool("uniscale");}
            if(text==="[Duplicate]"){this.app.duplicateSelected();}
            if(text==="[Group]"){this.app.tools.setTool("group");this.app.createGroup();if(this.grouptoggle){this.grouptoggle=false} else this.grouptoggle=true;}
            
            if(text==="LOAD"){this.app.loadProject();}
            if(text==="SAVE"){this.app.saveProject();}
        }
        
        if(this.selectedtool===text){
            
            if(text==="[Group]" && !this.grouptoggle){}
            else{
                this.ctx.strokeStyle = "blue";
                this.ctx.lineWidth = 4;
                this.ctx.strokeRect(x, y, dx-4, dy-4);
            }
            if(text!=="[Group]")this.app.clearGroupSelection();
 
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
        if(text=="trash")this.ctx.drawImage(this.trash,x+23,y+8,dx-50,dy-50);
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = (dx/6)+"px Arial";
        this.ctx.fillText(text, x + dx / 2, y + dy -30);

        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            
            if(text=="trash"){this.app.deleteSelected(); return;}
            if(text=="undo"){this.app.undo(); return;}
            if(text=="redo"){this.app.redo(); return;}
            
            this.selected=text;
            this.app.UI.selectedtool="[Move]";
            this.app.tools.setTool("move");
            
            this.app.addPrimitive(text);
        }
        
        if(this.selected===text){
            this.ctx.strokeStyle = "blue";
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(x, y, dx-4, dy-4);
 
        }
        this.ctx.restore();
    }
    drawColorButton(color, x, y, size) {
        this.ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
        this.ctx.fillRect(x, y, size, size);

        if (this.input.mouse.justPressed &&
            this.input.mouse.x >= x &&
            this.input.mouse.x <= x + size &&
            this.input.mouse.y >= y &&
            this.input.mouse.y <= y + size) {

            this.app.setColor(color);
        }
    }

}