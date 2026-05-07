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
        this.ctx.clearRect(0,0,200,200);
        
      //  this.ctx.save();
        const stats = this.app.countTriangles();
        const text = "Tris: " + stats.triangles + " / 1000";
        this.ctx.font = 20+"px Arial";
        this.ctx.textAlign = "left";
        this.ctx.textBaseline = "top";
        this.ctx.fillStyle = "white";
        
        
        this.ctx.fillStyle = stats.triangles > 1000 ? "#ff6666" : "white";
        this.ctx.fillText(text, 10, 95);
        this.ctx.textBaseline = "alphabetic";
        //this.ctx.restore();
        this.makeprimitives();

        
        
    }
    makeprimitives(){
        
        const isLandscape = this.canvas.width > this.canvas.height;

        const btnSize = isLandscape
            ? Math.min(90, this.canvas.height * 0.18)
            : Math.min(150, this.canvas.width * 0.20);
        
        
        if(!this.animatetoggle){

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

                this.drawColorButton(this.colors[i], 0+(i*btnSize/2.8 + btnSize*3), 0 , btnSize/2.8);

            }
        }
        else{
            this.drawAnimateUI(btnSize);
            this.drawAnimationList(btnSize);
            this.handleAnimationListClick();
            
        }
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
            if(text==="EXPORT"){this.app.exportGLB();}
            if(text==="Animate"){if(this.animatetoggle){this.animatetoggle=false;this.app.exitAnimateMode();}else {this.animatetoggle=true;this.app.enterAnimateMode();}}
            
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
    drawAnimateUI(btnSize) {
        
        this.drawbuttonstools("[SelectSG]", 0, this.canvas.height - btnSize*1.5 , btnSize, btnSize / 2);
        this.drawbuttonstools("[CreateAni]", btnSize * 1, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        this.drawbuttonstools("[Speed-]", btnSize * 2, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        this.drawbuttonstools("[Speed+]", btnSize * 3, this.canvas.height - btnSize*1.5, btnSize, btnSize / 2);
        
        
        
        
        this.drawbuttonstools("[SavePose]", 0, this.canvas.height - btnSize, btnSize, btnSize / 2);
        this.drawbuttonstools("[LoadPose]", btnSize, this.canvas.height - btnSize, btnSize, btnSize / 2);
        
        this.drawbuttonstools("[T-]", btnSize * 2, this.canvas.height - btnSize, btnSize , btnSize / 2);
        this.drawbuttonstools("[T+]", btnSize * 3, this.canvas.height - btnSize, btnSize , btnSize / 2);
        this.drawbuttonstools("[Play]", btnSize * 4, this.canvas.height - btnSize, btnSize , btnSize / 2);
        this.drawbuttonstools("[Reset]", btnSize*5, this.canvas.height - btnSize, btnSize, btnSize / 2);
        
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
            this.canvas.height - btnSize * 1.85
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
        if (name === "[T-]") {
            this.app.poseT = Math.max(0, this.app.poseT - 0.1);
            this.app.interpolatePoses(this.app.poses[0], this.app.poses[1], this.app.poseT);
            return;
        }

        if (name === "[T+]") {
            this.app.poseT = Math.min(1, this.app.poseT + 0.1);
            this.app.interpolatePoses(this.app.poses[0], this.app.poses[1], this.app.poseT);
            return;
        }
        if (name === "[Speed-]") {
            this.app.changeAnimationSpeed(-0.001);
            return;
        }

        if (name === "[Speed+]") {
            this.app.changeAnimationSpeed(0.001);
            return;
        }

        if (name === "[CreateAni]") {
            this.app.createAnimation();
            return;
        }

        if (name === "[Play]") {
            this.app.toggleAnimationPlay();
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
    }
    drawAnimationList(btnSize) {
        if (!this.app.animations) return;

        let x = this.canvas.width - btnSize * 2.6;
        let y = btnSize * 4.2;

        this.ctx.font = Math.floor(btnSize * 0.18) + "px Arial";
        this.ctx.fillStyle = "white";
        this.ctx.fillText("Animations", x, y);

        this.animationListButtons = [];

        for (let i = 0; i < this.app.animations.length; i++) {
            const anim = this.app.animations[i];

            y += btnSize * 0.35;

            const rowW = btnSize * 2.5;
            const rowH = btnSize * 0.3;

            this.ctx.fillStyle = anim === this.app.selectedAnimation
                ? "rgba(80,160,255,0.85)"
                : "rgba(0,0,0,0.55)";

            this.ctx.fillRect(x, y, rowW, rowH);

            this.ctx.fillStyle = "white";
            this.ctx.fillText(anim.name, x + 6, y + btnSize * 0.21);

            // Play button
            const playX = x + btnSize * 1.45;
            const trashX = x + btnSize * 1.95;

            this.ctx.fillStyle = "rgba(0,0,0,0.75)";
            this.ctx.fillRect(playX, y, btnSize * 0.45, rowH);
            this.ctx.fillRect(trashX, y, btnSize * 0.45, rowH);

            this.ctx.fillStyle = "white";
            this.ctx.fillText("▶", playX + 6, y + btnSize * 0.21);
            this.ctx.fillText("X", trashX + 8, y + btnSize * 0.21);

            this.animationListButtons.push({
                type: "play",
                anim,
                x: playX,
                y,
                w: btnSize * 0.45,
                h: rowH
            });

            this.animationListButtons.push({
                type: "trash",
                anim,
                x: trashX,
                y,
                w: btnSize * 0.45,
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
                if (b.type === "play") {
                    this.app.toggleAnimationPlay(b.anim);
                } else if (b.type === "trash") {
                    this.app.deleteAnimation(b.anim);
                }

                return true;
            }
        }

        return false;
    }


}