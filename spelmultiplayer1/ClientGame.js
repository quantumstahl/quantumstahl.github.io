class ClientGame {
    constructor(game) {
        this.game = game;
        this.sendCommandcounter=0;
        this.WORKER_BUILD_OPTIONS = [
                {type: "hus",label: "House",icon: "hus",cost: { wood: 30 }},
                {type: "townhall",label: "TownHall",icon: "townhall",cost: { wood: 120, stone: 80 }},
                  { type: "lumbercamp", label: "Lumber", icon: "lumbercamp", cost: { wood: 60 } },
                  { type: "miningcamp", label: "Mining", icon: "miningcamp", cost: { wood: 60 } },
                  { type: "mill", label: "WindMill", icon: "mill", cost: { wood: 80 } },
                  { type: "farm", label: "farm", icon: "farm", cost: { wood: 60 } },
                  {type: "barrack",label: "Barrack",icon: "barrack",cost: { wood: 120 }},
                  {type: "tower",label: "Tower",icon: "tower",cost: { wood: 80, stone: 50 }}
                
            ];
        this.UISIZE=0;  
        this.BUILDING_TYPES = {
                hus: {
                    width: 120,
                    height: 120
                },
                townhall: {
                    width: 300,
                    height: 200
                },
                lumbercamp: {
                    width: 150,
                    height: 150
                },

                miningcamp: {
                    width: 150,
                    height: 150
                },
                farm: {
                    width: 200,
                    height: 200
                },
                mill: {
                    width: 130,
                    height: 180
                },
                barrack: {
                    width: 300,
                    height: 300
                },
                tower: {
                    width: 140,
                    height: 250
                }
            };
    }
    
    updateanimation(selected,myId,ctx,canvas,leftclicked,app) {
         for(const townhall of this.getAllObjectsOfBaseTypeAllTeams("townhall")){
            this.drawTownhallTrainingQueue(ctx, townhall, this.game.maps[this.game.currentmap]);
        }
        for(const barrack of this.getAllObjectsOfBaseTypeAllTeams("barrack")){
            this.drawBarrackTrainingQueue(ctx, barrack, this.game.maps[this.game.currentmap]);
        }
        
        
        this.updateworkers();
        this.updatewarrior();
        this.updateboar();
        this.updatesheep();
        this.UI(selected,myId,ctx,canvas,leftclicked,app);
        this.drawResourcesUI(ctx, this.game.playerResources);
    }
    updateworkers(){
        const worker = this.getAllWorkersAllTeams();
        for (const w of worker) {
            w.flipped=false;
            if(w.hp>0){
                
                if(w.direction=="down"){w.animation=1;if(w.ani===1)w.animation=0;if(w.ani===2)w.animation=6;if(w.ani===3)w.animation=9;}
                if(w.direction=="up"){w.animation=3;if(w.ani===1)w.animation=2;if(w.ani===2)w.animation=7;if(w.ani===3)w.animation=10;}
                if(w.direction=="right"){w.animation=5;if(w.ani===1)w.animation=4;if(w.ani===2)w.animation=8;if(w.ani===3)w.animation=11;}
                if(w.direction=="left"){w.animation=5;if(w.ani===1)w.animation=4;w.flipped=true;if(w.ani===2)w.animation=8;if(w.ani===3)w.animation=11;}
            }
            else{ w.animation=12;w.selectable=false;}
            if(w.ani===3){
                if(w.carry===0&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false, "ghost","foodicon",true); }
                if(w.carry===1&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false,"ghost","woodicon",true); }   
                if(w.carry===2&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false,"ghost","stoneicon",true); }    
                if(w.carry===3&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false,"ghost","goldicon",true); }        
                if(w.holdingicon){w.holdingicon.x=w.renderX;w.holdingicon.y=w.renderY-20;}
            }
            else if(w.holdingicon){
                this.game.removeObject(-1,w.holdingicon);
                this.game.idcounter++;
                w.holdingicon=null;

            }
        }
    }
    updatewarrior(){
        const warrior = this.getAllWarriorsAllTeams();
        for (const w of warrior) {
        w.flipped=false;
        if (w.hp>0) {
            if (w.direction=="down"){w.animation=1;if(w.ani===1)w.animation=0;}
            if (w.direction=="up"){w.animation=3;if(w.ani===1)w.animation=2;}
            if (w.direction=="right"){w.animation=5;if(w.ani===1)w.animation=4;}
            if (w.direction=="left"){w.animation=5;if(w.ani===1)w.animation=4;w.flipped=true;}

            // attack-pose om du vill
            if (w.ani===2) {
                if (w.direction=="down") w.animation=6;
                if (w.direction=="up") w.animation=7;
                if (w.direction=="right") w.animation=8;
                if (w.direction=="left") { w.animation=8; w.fliped=true; }
            }
        }
        else{ w.animation = 9;w.selectable=false;}
        }
    }
    updateboar(){
        const boar = this.game.getObjectType('boar')?.objects || [];
        for (const b of boar) {
        
            b.flipped=false;
            if(b.hp>0){
                if(b.direction=="down"){b.animation=3;if(b.ani===1)b.animation=2;}
                if(b.direction=="up"){b.animation=5;if(b.ani===1)b.animation=4;}
                if(b.direction=="right"){b.animation=1;if(b.ani===1)b.animation=0;}
                if(b.direction=="left"){b.animation=1;if(b.ani===1)b.animation=0;b.flipped=true;}
            }
            else b.animation=6;
        
        } 
    }
    updatesheep(){
        const sheep = this.game.getObjectType('sheep')?.objects || [];
        for (const s of sheep) {
            if (s.hp>0) {
                s.flipped = false;
                const base = this.getSheepAnimBase(s.owner);
                if (s.direction == "down") {
                    s.animation = base + 3;
                    if (s.ani===1) s.animation = base + 2;
                }
                if (s.direction == "up") {
                    s.animation = base + 5;
                    if (s.ani===1) s.animation = base + 4;
                }
                if (s.direction == "right") {
                    s.animation = base + 1;
                    if (s.ani===1) s.animation = base + 0;
                }
                if (s.direction == "left") {
                    s.animation = base + 1;
                    if (s.ani===1) s.animation = base + 0;
                    s.flipped = true;
                }
            }
            else s.animation=12;
        }
    }
    getSheepAnimBase(owner) {
        if (owner === 1) return 6;
        if (owner === 2) return 13;
        if (owner === 4) return 19;
        if (owner === 3) return 25;
        return 0; // neutral
    }
    
    
    getAllWarriorsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("warrior");
    }
    
    getAllWorkersAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("worker");
    }
    getAllObjectsOfBaseTypeAllTeams(baseName) {
        return [
            ...this.getTeamObjects(baseName, 1),
            ...this.getTeamObjects(baseName, 2),
            ...this.getTeamObjects(baseName, 3),
            ...this.getTeamObjects(baseName, 4)
        ];
    }
    getTeamObjects(baseName, owner) {
        return this.getTeamObjectType(baseName, owner)?.objects || [];
    }
    getTeamObjectType(baseName, owner) {
        const prefix = this.getPrefixForOwner(owner);
        return this.game.getObjectType(prefix + baseName);
    }
    getPrefixForOwner(owner) {
        if (owner === 2) return "r";
        if (owner === 3) return "y";
        if (owner === 4) return "g";
        return "";
    }
    UI(selected, myOwner, ctx, canvas,leftclicked,app) {
        const prefix = this.getPrefixForOwner(myOwner);
        this.UISIZE=0;
        if (selected.length === 1) {
            const type = selected[0].type;

            if (type === prefix + "townhall") {
                this.drawTownhallUI(ctx, canvas, selected[0],myOwner);
                if(leftclicked)this.handleGameUILeftClick(1,selected[0],app);
                
                
                return;
            }

            if (type === prefix + "barrack") {
                this.drawBarrackUI(ctx, canvas, selected[0],myOwner);
                if(leftclicked)this.handleGameUILeftClick(2,selected[0],app);
                return;
            }

            if (
                type === prefix + "hus" ||
                type === prefix + "lumbercamp" ||
                type === prefix + "miningcamp" ||
                type === prefix + "farm" ||
                type === prefix + "mill" ||
                type === prefix + "tower"
            ) {
                this.drawBuildingUI(ctx, canvas,selected[0],myOwner);
                if(leftclicked)this.handleGameUILeftClick(3,selected[0],app);
                return;
            }
        }

        if (selected.some(o => o.type === prefix + "worker")) {
            this.drawWorkerBuildUI(ctx, canvas,selected,myOwner);
            if(leftclicked)this.handleGameUILeftClick(4,selected,app);
            return;
        }
    }
    drawTownhallUI(ctx, canvas, selectedTownhall,myOwner) {
        if (!selectedTownhall) return;

        const panelH = 110;
        this.UISIZE=110;  
        const panelY = canvas.height - panelH;

        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, panelY, canvas.width, panelH);

        ctx.strokeStyle = "gold";
        ctx.lineWidth = 2;
        ctx.strokeRect(0, panelY, canvas.width, panelH);

        ctx.fillStyle = "white";
        ctx.font = "22px Cinzel";
        ctx.fillText("Town Hall", 20, panelY + 30);

        // Worker-knapp
        const bx = 20;
        const by = panelY + 45;
        const bw = 110;
        const bh = 50;

        if(this.game.playerResources.food<50)ctx.fillStyle = "rgba(60,30,30,0.95)";
        else ctx.fillStyle = "rgba(30,80,30,0.95)";
        ctx.fillRect(bx, by, bw, bh);
        if(this.game.playerResources.food<50)ctx.strokeStyle = "red";
        else ctx.strokeStyle = "green";
        ctx.strokeRect(bx, by, bw, bh);

        ctx.drawImage(this.game.getObjectType(this.getPrefixForOwner(myOwner)+"worker").sprites[1].getimage(), bx + 6, by + 6, 22, 22);

        ctx.fillStyle = "white";
        ctx.font = "16px Cinzel";
        ctx.fillText("Worker", bx + 34, by + 18);
        ctx.fillText("50 Food", bx + 34, by + 38);

        selectedTownhall.trainWorkerButton = {
            x: bx,
            y: by,
            w: bw,
            h: bh
        };

        

        if (selectedTownhall.trainingQueue > 0) {
                // Queue/progress
            ctx.fillStyle = "white";
            ctx.fillText("Queue: " + selectedTownhall.trainingQueue, 140, by + 20);
            const p = Math.min(1, selectedTownhall.trainingTimer / selectedTownhall.trainingTimeMax);

            ctx.strokeStyle = "white";
            ctx.strokeRect(140, by + 28, 140, 14);

            ctx.fillStyle = "lime";
            ctx.fillRect(140, by + 28, 140 * p, 14);
        }



        // Delete-knapp i högra hörnet
        const bw2 = 90;
        const bh2 = 40;
        const bx2 = canvas.width - bw2 - 20;
        const by2 = panelY + 15;

        ctx.fillStyle = "rgba(120,30,30,0.95)";
        ctx.fillRect(bx2, by2, bw2, bh2);
        ctx.strokeStyle = "white";
        ctx.strokeRect(bx2, by2, bw2, bh2);

        ctx.fillStyle = "white";
        ctx.font = "16px Cinzel";
        ctx.fillText("Delete", bx2 + 14, by2 + 24);

        selectedTownhall.deleteButton = { x: bx2, y: by2, w: bw2, h: bh2 };

    } 
    drawResourcesUI(ctx, playerResources) {
        
        
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(10, 5, 150, 350);
        
        const startX = 25;

        const iconSize = 60;
        const spacing = 90;

        const resList = [
            { type: "wood",  icon: "woodicon" },
            { type: "food",  icon: "foodicon" },
            { type: "gold",  icon: "goldicon" },
            { type: "stone", icon: "stoneicon" },
             { type: "pop", icon: "husicon" }
        ];




        ctx.font = "18px Cinzel";
        ctx.textBaseline = "middle";

        for (let i = 0; i < resList.length; i++) {
            const r = resList[i];
            const x = startX ;
            const y = 60+(60 *i);
            const img = this.game.getObjectType(r.icon)?.sprites?.[0]?.getimage();

            if (img) {
                ctx.drawImage(img, x, y - iconSize / 2, iconSize, iconSize);
            }

            ctx.fillStyle = "white";
            if(r.type==="pop"){
                ctx.fillText(playerResources.pop + " / " + playerResources.popMax || 0, x + iconSize + 6, y);
            }
            else
                ctx.fillText(playerResources[r.type] || 0, x + iconSize + 6, y);
        }
    }
    drawBarrackUI(ctx, canvas, selectedBarrack,myOwner) {
        if (!selectedBarrack) return;

        const panelH = 110;
        this.UISIZE=110;  
        const panelY = canvas.height - panelH;

        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, panelY, canvas.width, panelH);

        ctx.strokeStyle = "gold";
        ctx.lineWidth = 2;
        ctx.strokeRect(0, panelY, canvas.width, panelH);

        ctx.fillStyle = "white";
        ctx.font = "22px Cinzel";
        ctx.fillText("Barrack", 20, panelY + 30);

        const bx = 20;
        const by = panelY + 45;
        const bw = 130;
        const bh = 50;

        const canBuy = this.game.playerResources.food >= 60 && this.game.playerResources.gold >= 20 && this.game.playerResources.pop < this.game.playerResources.popMax;

        ctx.fillStyle = canBuy ? "rgba(30,80,30,0.95)" : "rgba(60,30,30,0.95)";
        ctx.fillRect(bx, by, bw, bh);

        ctx.strokeStyle = canBuy ? "green" : "red";
        ctx.strokeRect(bx, by, bw, bh);
        
        const img = this.game.getObjectType(this.getPrefixForOwner(myOwner)+"warrior")?.sprites?.[1]?.getimage();
        if (img) ctx.drawImage(img, bx + 6, by + 6, 22, 22);

        ctx.fillStyle = "white";
        ctx.font = "16px Cinzel";
        ctx.fillText("Warrior", bx + 34, by + 18);
        ctx.fillText("60F 20G", bx + 34, by + 38);

        selectedBarrack.trainWarriorButton = {
            x: bx,
            y: by,
            w: bw,
            h: bh
        };

        ctx.fillStyle = "white";
        ctx.fillText("Queue: " + selectedBarrack.trainingQueue, 170, by + 20);

        if (selectedBarrack.trainingQueue > 0) {
            const p = Math.min(1, selectedBarrack.trainingTimer / selectedBarrack.trainingTimeMax);

            ctx.strokeStyle = "white";
            ctx.strokeRect(170, by + 28, 140, 14);

            ctx.fillStyle = "lime";
            ctx.fillRect(170, by + 28, 140 * p, 14);
        }

        const bw2 = 90;
        const bh2 = 40;
        const bx2 = canvas.width - bw2 - 20;
        const by2 = panelY + 15;

        ctx.fillStyle = "rgba(120,30,30,0.95)";
        ctx.fillRect(bx2, by2, bw2, bh2);
        ctx.strokeStyle = "white";
        ctx.strokeRect(bx2, by2, bw2, bh2);

        ctx.fillStyle = "white";
        ctx.font = "16px Cinzel";
        ctx.fillText("Delete", bx2 + 14, by2 + 24);

        selectedBarrack.deleteButton = { x: bx2, y: by2, w: bw2, h: bh2 };
    }
    drawBuildingUI(ctx, canvas,selected,myOwner) {
        const b = selected;
        if (!b&& b.type===this.getPrefixForOwner(myOwner)+"barrack") return;

        const panelH = 100;
        const panelY = canvas.height - panelH;
        this.UISIZE=100;  

        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, panelY, canvas.width, panelH);

        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.strokeRect(0, panelY, canvas.width, panelH);

        // titel
        ctx.fillStyle = "white";
        ctx.font = "20px Cinzel";
        if(b.type===this.getPrefixForOwner(myOwner)+"hus")ctx.fillText("house", 20, panelY + 28);
        else ctx.fillText(b.type, 20, panelY + 28);

        // Delete-knapp i högra hörnet
        const bw = 90;
        const bh = 40;
        const bx = canvas.width - bw - 20;
        const by = panelY + 15;

        ctx.fillStyle = "rgba(120,30,30,0.95)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "white";
        ctx.strokeRect(bx, by, bw, bh);

        ctx.fillStyle = "white";
        ctx.font = "16px Cinzel";
        ctx.fillText("Delete", bx + 14, by + 24);

        b.deleteButton = { x: bx, y: by, w: bw, h: bh };
    }
    drawWorkerBuildUI(ctx, canvas,selected,myOwner) {
        const selectedWorker = selected;
        if (!selectedWorker) return;

        const options = this.WORKER_BUILD_OPTIONS;

        const panelH = 170;
        const panelY = canvas.height - panelH;
        this.UISIZE=170;  

        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, panelY, canvas.width, panelH);

        const cols = canvas.width < 900 ? 2 : 4;
        const bw = 170;
        const bh = 60;
        const gapX = 12;
        const gapY = 12;
        const startX = 20;
        const startY = panelY + 20;

        selectedWorker.buildButtons = [];

        for (let i = 0; i < options.length; i++) {
            const opt = options[i];

            const col = i % cols;
            const row = Math.floor(i / cols);

            const bx = startX + col * (bw + gapX);
            const by = startY + row * (bh + gapY);

            const canBuy = this.canAfford(opt.cost);

            ctx.fillStyle = canBuy ? "rgba(30,80,30,0.95)" : "rgba(60,30,30,0.95)";
            ctx.fillRect(bx, by, bw, bh);

            ctx.strokeStyle = canBuy ? "green" : "red";
            ctx.strokeRect(bx, by, bw, bh);

            const img = this.game.getObjectType(this.getPrefixForOwner(myOwner)+opt.icon)?.sprites?.[0]?.getimage();
            if (img) ctx.drawImage(img, bx + 6, by + 6, 28, 28);

            ctx.fillStyle = "white";
            ctx.font = "15px Cinzel";
            ctx.fillText(opt.label, bx + 40, by + 18);

            ctx.font = "12px Cinzel";
            ctx.fillText(this.getCostText(opt.cost), bx + 40, by + 38);

            selectedWorker.buildButtons.push({
                type: this.getPrefixForOwner(myOwner)+opt.type,
                x: bx,
                y: by,
                w: bw,
                h: bh
            });
        }
    }
    canAfford(cost) {
        for (const key in cost) {
            if ((this.game.playerResources[key] || 0) < cost[key]) return false;
        }
        return true;
    }
    getCostText(cost) {
        const parts = [];
        if (cost.wood) parts.push(cost.wood + " Wood");
        if (cost.food) parts.push(cost.food + " Food");
        if (cost.gold) parts.push(cost.gold + " Gold");
        if (cost.stone) parts.push(cost.stone + " Stone");
        return parts.join(" ");
    }
    handleGameUILeftClick(value, selected,app) {
        const cursorX = this.game.cursorX;
        const cursorY = this.game.cursorY;

        const sel = [];
        for (let i = 0; i < selected.length; i++) {
            sel.push(selected[i].id);
        }
        
         if (this.game.buildMode) {
            this.sendCommand("build", -1, this.game.buildMode, cursorX-this.game.getCameraX()-this.game.bildModew/2, cursorY-this.game.getCameraY()-this.game.bildModeh/2, this.game.buildSelectedIds);
            this.game.buildMode = null;
            this.game.buildSelectedIds = [];
            this.game.bildModew=0;
            this.game.bildModeh=0;
            app.deselectAll();
            
            
            return true;
        }
        
        if (value === 1) {
            if (selected.trainWorkerButton && this.pointInRect(cursorX, cursorY, selected.trainWorkerButton)) {
                this.sendCommand("queueWorker", selected.id);
                return true;
            }

            if (selected.deleteButton && this.pointInRect(cursorX, cursorY, selected.deleteButton)) {
                this.sendCommand("destroy", selected.id);
                return true;
            }

            return false;
        }

        if (value === 2) {
            if (selected.trainWarriorButton && this.pointInRect(cursorX, cursorY, selected.trainWarriorButton)) {
                this.sendCommand("queueWarrior", selected.id);
                return true;
            }

            if (selected.deleteButton && this.pointInRect(cursorX, cursorY, selected.deleteButton)) {
                this.sendCommand("destroy", selected.id);
                return true;
            }

            return false;
        }

        if (value === 4) {
            for (const btn of selected.buildButtons) {
                if (this.pointInRect(cursorX, cursorY, btn)) {
                    this.game.buildMode=btn.type;
                    this.game.buildMod=btn.type;
                    this.game.buildSelectedIds=sel;
                    var def = this.BUILDING_TYPES[(btn.type)];
                    if(!def)def=this.BUILDING_TYPES[(btn.type).substring(1)];
                    
                    this.game.bildModew=def.width;
                    this.game.bildModeh=def.height;
                    return true;
                }
            }
        }

        if (value === 3) {
            if (this.pointInRect(cursorX, cursorY, selected.deleteButton)) {
                this.sendCommand("destroy", selected.id);
                return true;
            }
        }
        
       
        
        
        return false;
    }

    pointInRect(px, py, r) {
        return r && px >= r.x && py >= r.y && px <= r.x + r.w && py <= r.y + r.h;
    }

    sendCommand(action, targetId, typer = "", x = 0, y = 0, arr = []) {

        if (!this.game.ws || this.game.ws.readyState !== WebSocket.OPEN) return;
        console.log(x+" "+y);
        this.game.ws.send(JSON.stringify({
            type: "command",
            action,
            targetId,
            typer,
            x,
            y,
            arr
        }));
        
    }
    drawTownhallTrainingQueue(ctx, townhall, currentMap) {        
        if (townhall.trainingQueue<=0) return;
           
        const owner = townhall.owner ;
        const iconSize = 30;
        const gap = 4;
        const maxVisible = 8;

        const queue = townhall.trainingQueue;
        const totalW = queue * iconSize + (queue - 1) * gap;

        const startX = townhall.x + currentMap.camerax + townhall.w / 2 - totalW / 2;
        const y = townhall.y + currentMap.cameray - 34;

        for (let i = 0; i < queue; i++) {
            const type = this.getTeamObjectType("worker", owner);
            let img = null;
            img = this.getTeamObjectType("worker", owner)?.sprites?.[1]?.getimage();
            if (!img) continue;
              
            const x = startX + i * (iconSize + gap);

            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(x - 2, y - 2, iconSize + 4, iconSize + 4);

            ctx.drawImage(img, x, y, iconSize, iconSize);

            if (i === 0 && townhall.trainingTimeMax > 0) {
                const p = Math.min(1, townhall.trainingTimer / townhall.trainingTimeMax);

                ctx.drawImage(img, x, y, iconSize, iconSize);
                ctx.fillStyle = "rgba(0,0,0,0.8)";
                ctx.fillRect(x, y, iconSize, iconSize);

                const w = iconSize * p;

                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, w, iconSize);
                ctx.clip();

                ctx.fillStyle = "orange";
                ctx.fillRect(x, y, iconSize, iconSize);
                ctx.drawImage(img, x, y, iconSize, iconSize);
                ctx.restore();
            }
        }

        if (townhall.trainingQueue.length > maxVisible) {
            ctx.fillStyle = "white";
            ctx.font = "14px Cinzel";
            ctx.fillText(
                "+" + (townhall.trainingQueue.length - maxVisible),
                startX + maxVisible * (iconSize + gap),
                y + 16
            );
        }
    } 
    drawBarrackTrainingQueue(ctx, barrack, currentMap) {
         if (barrack.trainingQueue<=0) return;
           
        const owner = barrack.owner ;
        const iconSize = 30;
        const gap = 4;
        const maxVisible = 8;

        const queue = barrack.trainingQueue;
        const totalW = queue * iconSize + (queue - 1) * gap;

        const startX = barrack.x + currentMap.camerax + barrack.w / 2 - totalW / 2;
        const y = barrack.y + currentMap.cameray - 34;

        for (let i = 0; i < queue; i++) {
            const type = this.getTeamObjectType("warrior", owner);
            let img = null;
            img = this.getTeamObjectType("warrior", owner)?.sprites?.[1]?.getimage();
            if (!img) continue;
              
            const x = startX + i * (iconSize + gap);

            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(x - 2, y - 2, iconSize + 4, iconSize + 4);

            ctx.drawImage(img, x, y, iconSize, iconSize);

            if (i === 0 && barrack.trainingTimeMax > 0) {
                const p = Math.min(1, barrack.trainingTimer / barrack.trainingTimeMax);

                ctx.drawImage(img, x, y, iconSize, iconSize);
                ctx.fillStyle = "rgba(0,0,0,0.8)";
                ctx.fillRect(x, y, iconSize, iconSize);

                const w = iconSize * p;

                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, w, iconSize);
                ctx.clip();

                ctx.fillStyle = "orange";
                ctx.fillRect(x, y, iconSize, iconSize);
                ctx.drawImage(img, x, y, iconSize, iconSize);
                ctx.restore();
            }
        }

        if (barrack.trainingQueue.length > maxVisible) {
            ctx.fillStyle = "white";
            ctx.font = "14px Cinzel";
            ctx.fillText(
                "+" + (barrack.trainingQueue.length - maxVisible),
                startX + maxVisible * (iconSize + gap),
                y + 16
            );
        }
    }
    
}