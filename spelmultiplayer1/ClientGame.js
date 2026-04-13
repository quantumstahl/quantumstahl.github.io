class ClientGame {
    constructor(game) {
        this.game = game;
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
    
    updateanimation(selected,myId,ctx,canvas,leftclicked) {
        this.updateworkers();
        this.UI(selected,myId,ctx,canvas,leftclicked);
        this.drawResourcesUI(ctx, this.game.playerResources);
    }
    updateworkers(){
        const worker = this.getAllWorkersAllTeams();
        for (const w of worker) {
            w.flipped=false;
            if(!w.dead){
                
                if(w.direction=="down"){w.animation=1;if(w.ani===1)w.animation=0;if(w.ani===2)w.animation=6;if(w.ani===3)w.animation=9;}
                if(w.direction=="up"){w.animation=3;if(w.ani===1)w.animation=2;if(w.ani===2)w.animation=7;if(w.ani===3)w.animation=10;}
                if(w.direction=="right"){w.animation=5;if(w.ani===1)w.animation=4;if(w.ani===2)w.animation=8;if(w.ani===3)w.animation=11;}
                if(w.direction=="left"){w.animation=5;if(w.ani===1)w.animation=4;w.flipped=true;if(w.ani===2)w.animation=8;if(w.ani===3)w.animation=11;}
            }
            else w.animation=6;
            if(w.ani===3){
                if(w.carry===0&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false, "ghost","foodicon"); this.game.idcounter--;}
                if(w.carry===1&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false,"ghost","woodicon"); this.game.idcounter--;}   
                if(w.carry===2&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false,"ghost","stoneicon"); this.game.idcounter--;}    
                if(w.carry===3&&!w.holdingicon){w.holdingicon=this.game.addObject(w.renderX,w.renderY-20,30,30,0,false,"ghost","goldicon"); this.game.idcounter--;}        
                if(w.holdingicon){w.holdingicon.x=w.renderX;w.holdingicon.y=w.renderY-20;}
            }
            else if(w.holdingicon){
                this.game.removeObject(-1,w.holdingicon);
                this.game.idcounter++;
                w.holdingicon=null;

            }
        }
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
    UI(selected, myOwner, ctx, canvas,leftclicked) {
        const prefix = this.getPrefixForOwner(myOwner);
        this.UISIZE=0;
        if (selected.length === 1) {
            const type = selected[0].type;

            if (type === prefix + "townhall") {
                this.drawTownhallUI(ctx, canvas, selected[0],myOwner);
                if(leftclicked)this.handleGameUILeftClick(1,selected[0]);
                
                
                return;
            }

            if (type === prefix + "barrack") {
                this.drawBarrackUI(ctx, canvas, selected[0],myOwner);
                if(leftclicked)this.handleGameUILeftClick(2,selected[0]);
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
                if(leftclicked)this.handleGameUILeftClick(3,selected[0]);
                return;
            }
        }

        if (selected.some(o => o.type === prefix + "worker")) {
            this.drawWorkerBuildUI(ctx, canvas,selected,myOwner);
            if(leftclicked)this.handleGameUILeftClick(4,selected);
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

        // Queue/progress
        ctx.fillStyle = "white";
        ctx.fillText("Queue: " + selectedTownhall.trainingQueue.length, 140, by + 20);

        if (selectedTownhall.trainingQueue.length > 0) {
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
        ctx.fillText("Queue: " + selectedBarrack.trainingQueue.length, 170, by + 20);

        if (selectedBarrack.trainingQueue.length > 0) {
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
        if(b.name===this.getPrefixForOwner(myOwner)+"hus")ctx.fillText("house", 20, panelY + 28);
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

            const img = this.game.getObjectType(opt.icon)?.sprites?.[0]?.getimage();
            if (img) ctx.drawImage(img, bx + 6, by + 6, 28, 28);

            ctx.fillStyle = "white";
            ctx.font = "15px Cinzel";
            ctx.fillText(opt.label, bx + 40, by + 18);

            ctx.font = "12px Cinzel";
            ctx.fillText(this.getCostText(opt.cost), bx + 40, by + 38);

            selectedWorker.buildButtons.push({
                type: opt.type,
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
    handleGameUILeftClick(value, selected) {
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
                    const def = this.BUILDING_TYPES[btn.type];
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
    
}