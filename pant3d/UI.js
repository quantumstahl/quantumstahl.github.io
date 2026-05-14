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
        this.animatetoggle=false;
        this.styletoggle=false;
        
        this.colors = [
            0x8B5A2B, // brun (trä)
            0xC68642, // hudfärg (ljus)
            0xFF0000, // röd
            0x4D7CFE, // blå
            0xFFFFFF, // vit
            0x222222  // mörk/grå istället för svart (ser bättre ut)
        ];
        this.colors2 = [
                 // Greens / nature
            0x66aa55, // green
            0x99cc66, // light green
            0x2f5d34, // dark forest green
            0x8fbf3f, // yellow green

            // Wood / brown / skin
            0x8B5A2B, // brown / wood
            0xC68642, // light skin / tan
            0x7A5230, // darker skin / leather
            0x4A2C18, // dark brown

            // Warm colors
            0xFF0000, // red
            0xCC4422 // brick red
        ];
        this.colors3 = [
       
            0xF4D35E, // yellow
            0xFFAA33, // orange

            // Cool colors
            0x4D7CFE, // blue
            0x2E4A9E, // dark blue
            0x55C7D8, // cyan
            0x8E5AC8, // purple

            // Neutrals
            0xFFFFFF, // white
            0xCCCCCC, // light gray
            0x777777, // gray
            0x222222  // dark gray / almost black
        ];
        this.activeColorArray = this.colors2;
        this.activeColorIndex = 0;
        this.activeColor = this.colors2[0];
        this.activeColorbuffer = this.colors2[0];

        this.colorInput = document.getElementById("styleColorInput");

        this.colorInput.addEventListener("input", e => {
            this.applyPickedColor(e.target.value);
        });
        this.setupTextureInput();
        
        this.textureSlots = [null, null, null, null];
        this.activeTextureSlot = 0;
        
    }
    update(){
        this.ctx.clearRect(0,0,200,200);
        
     //   this.ctx.save();
        const stats = this.app.countTriangles();
        const text = "Tris: " + stats.triangles + " / 1000";
        this.ctx.font = 20+"px Arial";
        this.ctx.textAlign = "left";
        this.ctx.textBaseline = "top";
        this.ctx.fillStyle = "white";
        
        
        this.ctx.fillStyle = stats.triangles > 1000 ? "#ff6666" : "white";
        this.ctx.fillText(text, 10, 95);
        this.ctx.textBaseline = "alphabetic";
      //  this.ctx.restore();
        this.makeprimitives();

        
        
    }
    makeimagebutton(number,x,y,dx,dy){

        if(this.textureSlots[number]){
            this.ctx.drawImage(this.textureSlots[number].image,x,y,dx,dy);
        }    
        else{this.ctx.fillStyle="black"; this.ctx.fillRect(x,y,dx,dy);}
        
        if(this.activeTextureSlot===number){
            this.ctx.strokeStyle = "white";
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(x + 2, y + 2, dx - 4, dy - 4);

            this.ctx.strokeStyle = "black";
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x + 5, y + 5, dx - 10, dy - 10);
            
            
        }
        
       
        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            if(this.textureSlots[number])this.applyActiveTextureToSelected();
            this.activeTextureSlot=number;
        }
    }
    
    
    
    makeprimitives(){
        
        const isLandscape = this.canvas.width > this.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, this.canvas.height * 0.18)
            : Math.min(150, this.canvas.width * 0.20);
        this.positionColorInputCanvasCoords(-btnSize , this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
        this.positionTextureInput(-btnSize , this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
        
        if(!this.animatetoggle&&!this.styletoggle){

            this.drawbutton("cube",0,this.canvas.height-btnSize,btnSize,btnSize);
            this.drawbutton("cone",btnSize,this.canvas.height-btnSize,btnSize,btnSize);
            this.drawbutton("cylinder",btnSize*2,this.canvas.height-btnSize,btnSize,btnSize);
            this.drawbutton("sphere",btnSize*3,this.canvas.height-btnSize,btnSize,btnSize);
            this.drawbutton("plane",btnSize*4,this.canvas.height-btnSize,btnSize,btnSize);
            this.drawbutton("resolution",btnSize*5,this.canvas.height-btnSize*1,btnSize*0.75,btnSize*0.5);
            this.drawbutton("trash",btnSize*5,this.canvas.height-btnSize*0.5,btnSize*0.75,btnSize*0.5); 
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
            this.drawbuttonstools("[PrimSelect]", btnSize * 5.75, this.canvas.height - btnSize * 1.5, btnSize*0.75, btnSize / 2);

            for(let i=0;i<this.colors.length;i++){

               this.drawColorButton(this.colors[i], 0+(i*btnSize/4 + btnSize*4.5), 0 , btnSize/4.0,i,this.colors);

            }
            this.drawbuttonstools("Ungroup",btnSize*3.75,0,btnSize*0.75,btnSize/2);
        }
        else if(this.animatetoggle){
            this.drawAnimationList(btnSize);
            this.handleAnimationListClick();
            this.drawAnimateUI(btnSize);
            this.drawbuttonstools("recordGIF",btnSize*3.75,0,btnSize*0.75,btnSize/2);
            this.drawbuttonstools("ShareGIF",btnSize*4.50,0,btnSize*0.75,btnSize/2);
            
            
            
        }
        else if(this.styletoggle){
            
            
            this.drawbuttonstools("[PrimSelect]", 0, this.canvas.height - btnSize * 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[FacePaint]", btnSize * 0.75, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[ColorPick]", btnSize *1.5, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[FlatSmooth]", btnSize *2.25, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[loadTexture]", btnSize *3, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.positionTextureInput(btnSize *3, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[Light+]", btnSize *3.75, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[Light-]", btnSize *4.5, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[Roughen]", btnSize *5.25, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2); 
			this.drawbuttonstools("[DarkenInner]", btnSize *6, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            
            
            this.positionColorInputCanvasCoords(btnSize *1.5, this.canvas.height - btnSize* 1.5, btnSize*0.75, btnSize / 2);
            for(let i=0;i<this.colors2.length;i++){
               this.drawColorButton(this.colors2[i], 0+(i*btnSize/4), this.canvas.height-btnSize/2 , btnSize/4.0,i,this.colors2);
            }
            for(let i=0;i<this.colors3.length;i++){
               this.drawColorButton(this.colors3[i], 0+(i*btnSize/4), this.canvas.height-btnSize , btnSize/4.0,i,this.colors3);
            }
            
            this.makeimagebutton(0,(10*btnSize/4),this.canvas.height-btnSize,btnSize/2.0,btnSize/2.0);
            this.makeimagebutton(1,(12*btnSize/4),this.canvas.height-btnSize,btnSize/2.0,btnSize/2.0);
            this.makeimagebutton(2,(10*btnSize/4),this.canvas.height-btnSize/2.0,btnSize/2.0,btnSize/2.0);
            this.makeimagebutton(3,(12*btnSize/4),this.canvas.height-btnSize/2.0,btnSize/2.0,btnSize/2.0);
            
            this.drawbuttonstools("[Alpha]", (14*btnSize/4), this.canvas.height - btnSize, btnSize*0.75, btnSize / 2);
            this.drawbuttonstools("[roughRock]", (14*btnSize/4), this.canvas.height - btnSize/2, btnSize*0.75, btnSize / 2);
            
            
        }
        
        this.drawbuttonstools("Style",btnSize*3,0,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("Animate",btnSize*2.25,0,btnSize*0.75,btnSize/2);
        this.drawbuttonstools("EXPORT",btnSize*1.5,0,btnSize*0.75,btnSize/2);
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
        const isLandscape = this.canvas.width > this.canvas.height;
        
        if(isLandscape)this.ctx.textBaseline = "top";
        else this.ctx.textBaseline = "middle";

       
 

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
         const isLandscape = this.canvas.width > this.canvas.height;
        
        if(isLandscape)this.ctx.textBaseline = "top";
        else this.ctx.textBaseline = "middle";
       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = (dx/7)+"px Arial";
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
            if (text === "[PrimSelect]") {this.app.tools.setTool("primselect");}
            
            if(text==="LOAD"){this.app.loadProject();}
            if(text==="SAVE"){this.app.saveProject();}
            if(text==="EXPORT"){this.app.exportGLB();}
            if(text==="Animate"){if(this.animatetoggle){this.animatetoggle=false;this.app.exitAnimateMode();this.app.tools.setTool("select");this.selectedtool="[Select]";}else {this.app.tools.setTool("select");this.selectedtool="[Select]";this.animatetoggle=true;this.styletoggle=false;this.app.enterAnimateMode();}}
            if(text==="Style"){if(this.styletoggle){this.styletoggle=false;this.app.exitAnimateMode();this.app.tools.setTool("select");this.selectedtool="[Select]";}else {this.app.tools.setTool("select");this.selectedtool="[Select]";this.styletoggle=true;this.animatetoggle=false;}}
            if(text==="recordGIF"){this.app.exportGifPreview();}
            if(text==="ShareGIF"){this.app.shareLastGif();}
            if(text==="Ungroup"){this.app.ungroupAllToPrimitives();}
            if (text === "[ColorPick]") {return;}
            if (text === "[FacePaint]") {this.app.tools.setTool("facepaint");return;}
            if (text === "[FlatSmooth]") {this.app.toggleFlatSmoothSelected(); return;}
            if(text === "[loadTexture]"){ return;}
            if (text === "[Light+]") {this.activeColor=this.adjustColorBrightness(this.activeColorbuffer, 0.25);return;}
            if (text === "[Light-]") {this.activeColor=this.adjustColorBrightness(this.activeColorbuffer, -0.25);return;}
            if (text === "[Roughen]"){this.app.roughenObject(this.app.selected);return;}
            if (text === "[DarkenInner]"){this.app.applyRadialVertexGradient(this.app.selected);return;}
            if (text === "[Alpha]") {this.app.cycleAlphaSelected();return;}
            if(text === "[roughRock]"){this.app.roughenRock(this.app.selected);return;}
            
			
            
            this.handleAnimateButton(text);
        }
        
        if(this.selectedtool===text){
            
            if((text==="[Group]" && !this.grouptoggle) || (text==="Animate" && !this.animatetoggle)){}
            else{
                this.ctx.strokeStyle = "blue";
                this.ctx.lineWidth = 4;
                this.ctx.strokeRect(x, y, dx-4, dy-4);
            }
            if(text!=="[Group]")this.app.clearGroupSelection();
 
        }
        this.ctx.restore();
        
        
        
        
        
        
    }
    adjustColorBrightness(color, amount) {
        const c = new THREE.Color(color);

        if (amount > 0) {
            // ljusa upp mot vitt
            c.lerp(new THREE.Color(0xffffff), amount);
        } else {
            // mörka ner mot svart
            c.lerp(new THREE.Color(0x000000), -amount);
        }

        return c;
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
        if(text=="trash")this.ctx.drawImage(this.trash,x+15,y+3,dx-30,dy-30);
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

       
 

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = subColor;
        this.ctx.font = (dx/6)+"px Arial";
        
        
        const resText =
        this.app.primitiveResolution === "low" ? "Res:Low" :
        this.app.primitiveResolution === "medium" ? "Res:Med" :
        "Res:High";
        
        if(text=="trash") this.ctx.fillText(text, x + dx / 2, y + dy -20);
        else if(text=="resolution")this.ctx.fillText(resText, x + dx / 2, y + dy -30);
        else this.ctx.fillText(text, x + dx / 2, y + dy -30);

        if(this.input.mouse.justPressed&&
                this.input.mouse.x >= x &&
                this.input.mouse.x <= x + dx &&
                this.input.mouse.y >= y &&
                this.input.mouse.y <= y + dy){
            
            if(text=="trash"){this.app.deleteSelected(); return;}
            if(text=="undo"){this.app.undo(); return;}
            if(text=="redo"){this.app.redo(); return;}
            if(text=="resolution"){this.app.cyclePrimitiveResolution();return;}
            
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
    drawColorButton(color, x, y, size, index, colorArray) {
        this.ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
        this.ctx.fillRect(x, y, size, size*2);
        
            // markera aktiv färg
        if (this.activeColorArray === colorArray && this.activeColorIndex === index) {
            this.ctx.strokeStyle = "white";
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(x + 2, y + 2, size - 4, size*2 - 4);

            this.ctx.strokeStyle = "black";
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x + 5, y + 5, size - 10, size*2 - 10);
        }
        
        
        if (this.input.mouse.justPressed &&
            this.input.mouse.x >= x &&
            this.input.mouse.x <= x + size &&
            this.input.mouse.y >= y &&
            this.input.mouse.y <= y + size*2) {
            this.activeColorArray = colorArray;
            this.activeColorIndex = index;
            this.activeColor = color;
            this.activeColorbuffer=color;
            this.app.setColor(color);
        }
    }
    hexStringToNumber(hex) {
        return parseInt(hex.replace("#", ""), 16);
    }

    numberToHexString(color) {
        return "#" + color.toString(16).padStart(6, "0");
    }
    positionColorInputCanvasCoords(x, y, w, h) {
        const input = document.getElementById("styleColorInput");
        const rect = this.canvas.getBoundingClientRect();

        const sx = rect.width / this.canvas.width;
        const sy = rect.height / this.canvas.height;

        input.style.position = "fixed";
        input.style.left = (rect.left + x * sx) + "px";
        input.style.top = (rect.top + y * sy) + "px";
        input.style.width = (w * sx) + "px";
        input.style.height = (h * sy) + "px";
        input.style.opacity = "0.01";
        input.style.zIndex = "9999";
        
        const color = this.activeColorArray[this.activeColorIndex] ?? 0xffffff;
            input.value = "#" + color.toString(16).padStart(6, "0");
    }
    applyPickedColor(hex) {
        if (!this.activeColorArray) return;

        const color = this.hexStringToNumber(hex);

        this.activeColorArray[this.activeColorIndex] = color;
        this.activeColor = color;

        this.app.setColor(color);
    }
    drawAnimateUI(btnSize) {
        
        this.drawbuttonstools("[SelectSG]", 0, this.canvas.height - btnSize*1.5 , btnSize, btnSize / 2);
        this.drawbuttonstools("[CreateAni]", btnSize * 1, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        this.drawbuttonstools("[Speed-]", btnSize * 2, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        this.drawbuttonstools("[Speed+]", btnSize * 3, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        this.drawbuttonstools("[Reset]", btnSize*4, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        this.drawbuttonstools("[ScaleSG]", btnSize * 5, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        
        
        this.drawbuttonstools("[SavePose]", 0, this.canvas.height - btnSize, btnSize, btnSize / 2);
        this.drawbuttonstools("[LoadPose]", btnSize, this.canvas.height - btnSize, btnSize, btnSize / 2);
        
        this.drawbuttonstools("[PoseTime-]", btnSize * 2, this.canvas.height - btnSize, btnSize , btnSize / 2);
        this.drawbuttonstools("[PoseTime+]", btnSize * 3, this.canvas.height - btnSize, btnSize , btnSize / 2);
        this.drawbuttonstools("[Play]", btnSize * 4, this.canvas.height - btnSize, btnSize , btnSize / 2);
        this.drawbuttonstools("[MoveSG]", btnSize * 5, this.canvas.height - btnSize , btnSize, btnSize / 2);
        
        this.drawbuttonstools("[Subgroup]", 0, this.canvas.height - btnSize/2, btnSize, btnSize / 2);
        this.drawbuttonstools("[Create]", btnSize, this.canvas.height - btnSize/2, btnSize, btnSize / 2);
        this.drawbuttonstools("[Delete]", btnSize*2, this.canvas.height - btnSize/2, btnSize, btnSize / 2);
        this.drawbuttonstools("[Rename]", btnSize*3, this.canvas.height - btnSize/2, btnSize, btnSize / 2);
        this.drawbuttonstools("[Pivot]", btnSize*4, this.canvas.height - btnSize/2, btnSize, btnSize / 2);
        this.drawbuttonstools("[RotateSG]", btnSize*5, this.canvas.height - btnSize/2, btnSize, btnSize / 2);
        
        this.drawYbutton("Y",btnSize*6,this.canvas.height - btnSize/2,btnSize/2,btnSize/2);
        this.ctx.fillStyle = "white";
        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";
        this.ctx.fillText(
            "Selected parts: " + this.app.subgroupSelection.length,
            0,
            this.canvas.height - btnSize * 1.55
        );

        this.drawSubgroupList(btnSize);
        this.drawPoseList(btnSize);
    }
    drawSubgroupList(btnSize) {
        if (!this.app.subgroups) return;

        let x = this.canvas.width - btnSize * 1.7;
        let y = btnSize * 0.6;

        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";
        this.ctx.fillStyle = "white";
        this.ctx.fillText("Subgroups", x, y);

        for (let i = 0; i < this.app.subgroups.length; i++) {
            const sg = this.app.subgroups[i];

            y += btnSize * 0.3;

            const selected = this.app.selectedSubgroup === sg;

            this.ctx.fillStyle = selected ? "rgba(80,160,255,0.9)" : "rgba(0,0,0,0.55)";
            this.ctx.fillRect(x, y, btnSize * 1.5, btnSize * 0.25);

            this.ctx.fillStyle = "white";
            this.ctx.fillText(sg.name, x + 6, y + btnSize * 0.18);
        }

        
    }
    handleAnimateButton(name) {
        if (name === "[Subgroup]") {
            this.app.tools.setTool("subgroup");
            this.app.selectedSubgroup = null;
            return;
        }
        if (name === "[SelectSG]") {
            this.app.tools.setTool("selectsub");
            this.app.subgroupSelection = [];
            return;
        }
        if (name === "[Create]") {
             this.app.createSubgroup();
            return;
        }
        if (name === "[Delete]") {
             this.app.deleteSelectedSubgroup();
            return;
        }
        if (name === "[Rename]") {
             this.app.renameSelectedSubgroup();
            return;
        }
        if (name === "[Pivot]") {
             this.app.tools.setTool("pivit");
            return;
        }
        if (name === "[RotateSG]") {
            this.app.tools.setTool("anirot");
            return;
        }
        if (name === "[Reset]") {
            this.app.resetSelectedSubgroupTransform();
            return;
        }
        if (name === "[SavePose]") {
            this.app.savePose();
            return;
        }

        if (name === "[LoadPose]") {
            this.app.loadLastPose();
            return;
        }
        if (name === "[Play]") {

            this.app.togglePosePlay();
            return;
        }
        if (name === "[PoseTime-]") {
             this.app.changeCurrentSegmentDuration(-0.05);
            return;
        }

        if (name === "[PoseTime+]") {
            this.app.changeCurrentSegmentDuration(0.05);
            return;
        }
        if (name === "[Speed-]") {
            this.app.changeAnimationSpeedPercent(-10);
            return;
        }

        if (name === "[Speed+]") {
            this.app.changeAnimationSpeedPercent(10);
            return;
        }

        if (name === "[CreateAni]") {
            this.app.tools.setTool("selectsub");
            this.app.createAnimation();
            return;
        }

        if (name === "[Play]") {
            this.app.toggleAnimationPlay();
            return;
        }
        if (name === "[MoveSG]") {
            this.app.tools.setTool("animove");
            return;
        }
        if (name === "[ScaleSG]") {
            this.app.tools.setTool("aniscale");
            return;
        }
        
        
    }
    drawPoseList(btnSize) {
        if (!this.app.poses) return;

        let x = this.canvas.width - btnSize * 1.8;
        let y = btnSize * 2.6;

        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";
        this.ctx.fillStyle = "white";
        this.ctx.fillText("Poses", x, y);

        for (let i = 0; i < this.app.poses.length; i++) {
            const pose = this.app.poses[i];

            y += btnSize * 0.32;

            this.ctx.fillStyle = "rgba(0,0,0,0.55)";
            this.ctx.fillRect(x, y, btnSize * 1.6, btnSize * 0.28);

            this.ctx.fillStyle = "white";
            this.ctx.fillText(pose.name, x + 6, y + btnSize * 0.2);
        }
        this.ctx.fillStyle = "white";
        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";
        this.ctx.fillText(
            "Next segment: " + this.app.currentSegmentDuration.toFixed(2) + "s",
            0,
            this.canvas.height - btnSize * 1.7
        );
        this.ctx.fillStyle = "white";
        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";

   
        
    }
    drawAnimationList(btnSize) {
        if (!this.app.animations) return;
        
        let x = this.canvas.width - btnSize * 2.8;
        let y = btnSize * 4.2;

        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";
        this.ctx.fillStyle = "white";
        this.ctx.fillText("Animations", x, y);

        this.animationListButtons = [];

        for (let i = 0; i < this.app.animations.length; i++) {
            const anim = this.app.animations[i];

            y += btnSize * 0.35;

            const rowW = btnSize * 2.8;
            const rowH = btnSize * 0.3;

            this.ctx.fillStyle = anim === this.app.selectedAnimation
                ? "rgba(80,160,255,0.85)"
                : "rgba(0,0,0,0.55)";

            this.ctx.fillRect(x, y, rowW, rowH);

            this.ctx.fillStyle = "white";
            this.ctx.fillText(anim.name, x + 6, y + btnSize * 0.21);

            // Play button
            const trashW = btnSize * 0.35;
            const playW = btnSize * 0.35;
            const modeW = btnSize * 0.35;

            const trashX = x + rowW - trashW;
            const playX = trashX - playW;
            const modeX = playX - modeW;

            this.ctx.fillStyle = "rgba(0,0,0,0.75)";
            this.ctx.fillRect(modeX, y, modeW, rowH);
            this.ctx.fillRect(playX, y, playW, rowH);
            this.ctx.fillRect(trashX, y, trashW, rowH);

            this.ctx.fillStyle = "white";
            this.ctx.fillText(this.app.getAnimationModeLabel(anim), modeX + modeW / 2, y + btnSize * 0.21);
            this.ctx.fillText("▶", playX + playW / 2, y + btnSize * 0.21);
            this.ctx.fillText("X", trashX + trashW / 2, y + btnSize * 0.21);

const speedText = (anim.speedPercent ?? 100) + "%";
this.ctx.fillText(anim.name + " " + speedText, x + 6, y + btnSize * 0.21);




            this.animationListButtons.push({
                type: "mode",
                anim,
                x: modeX,
                y,
                w: modeW,
                h: rowH
            });

            this.animationListButtons.push({
                type: "play",
                anim,
                x: playX,
                y,
                w: playW,
                h: rowH
            });

            this.animationListButtons.push({
                type: "trash",
                anim,
                x: trashX,
                y,
                w: trashW,
                h: rowH
            });
        }
    }
    handleAnimationListClick() {
        if (!this.animationListButtons) return false;

        for (const b of this.animationListButtons) {
            if (this.input.mouse.justPressed &&
                this.input.mouse.x >= b.x &&
                this.input.mouse.x <= b.x + b.w &&
                this.input.mouse.y >= b.y &&
                this.input.mouse.y <= b.y + b.h
            ) {
                if (b.type === "mode") {
                    this.app.cycleAnimationMode(b.anim);
                } else if (b.type === "play") {
                    this.app.toggleAnimationPlay(b.anim);
                } else if (b.type === "trash") {
                    this.app.deleteAnimation(b.anim);
                }

                return true;
            }
        }

        return false;
    }
    setupTextureInput() {
        
       
        
        this.textureInput = document.getElementById("textureFileInput");

        this.textureInput.addEventListener("change", e => {
            const file = e.target.files[0];
            if (!file) return;

            this.loadTextureIntoSlot(file, this.activeTextureSlot);

            // gör så man kan välja samma fil igen senare
            e.target.value = "";
        });
    }
    positionTextureInput(x, y, w, h) {
        
        
        const input = document.getElementById("textureFileInput");
        const rect = this.canvas.getBoundingClientRect();

        const sx = rect.width / this.canvas.width;
        const sy = rect.height / this.canvas.height;

        input.style.position = "fixed";
        input.style.left = (rect.left + x * sx) + "px";
        input.style.top = (rect.top + y * sy) + "px";
        input.style.width = (w * sx) + "px";
        input.style.height = (h * sy) + "px";
        input.style.opacity = "0.01";
        input.style.zIndex = "9999";
        
    }
    
    loadTextureIntoSlot(file, slotIndex) {
        const reader = new FileReader();

        reader.onload = () => {
            const dataURL = reader.result;

            const img = new Image();
            img.onload = () => {
                const texture = new THREE.Texture(img);
                texture.needsUpdate = true;

                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.colorSpace = THREE.SRGBColorSpace;

                this.textureSlots[slotIndex] = {
                    name: file.name,
                    image:img,
                    dataURL: dataURL,
                    texture
                };

                console.log("Loaded texture slot", slotIndex, file.name);
            };

            img.src = dataURL;
        };

        reader.readAsDataURL(file);
    }
    applyActiveTextureToSelected() {
        const slot = this.textureSlots[this.activeTextureSlot];
        if (!slot || !slot.texture) {
            alert("No texture loaded in this slot.");
            return;
        }

        if (!this.app.selected) {
            alert("Select an object first.");
            return;
        }

        this.app.selected.traverse(obj => {
            if (!obj.isMesh) return;

            const mat = new THREE.MeshStandardMaterial({
                map: slot.texture,
                color: 0xffffff,
                roughness: 0.8,
                metalness: 0.0
            });

            obj.material = mat;

            obj.userData.hasTexture = true;
            obj.userData.textureDataURL = slot.dataURL;
            obj.userData.textureName = slot.name || "texture";
        });

        this.pushUndoState?.();
    }

}