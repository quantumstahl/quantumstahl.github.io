class GameServerSimulation {
    constructor(game, teamResources = null) {
        this.game = game;
        this.teamResources = teamResources || {
            one: { wood: 0, food: 0, gold: 0, stone: 0, pop: 3, popMax: 10 }
        };
        this.BUILDING_TYPES = {
                hus: {
                    imageType: "hus",
                    foundationType: "husfoundation",
                    iconType: "husicon",
                    width: 120,
                    height: 120,
                    cost: { wood: 30 },
                    buildTime: 900,
                    popMaxBonus: 5,
                    hp: 100,
                    dropoffTypes: []
                },
                townhall: {
                    imageType: "townhall",
                    foundationType: "townhallfoundation",
                    iconType: "townhallicon",
                    width: 300,
                    height: 200,
                    cost: { wood: 120, stone: 80 },
                    buildTime: 2000,
                    popMaxBonus: 0,
                    hp: 400,
                    dropoffTypes: ["wood", "food", "gold", "stone"]
                    
                },
                lumbercamp: {
                    imageType: "lumbercamp",
                    foundationType: "lumbercampfoundation",
                    iconType: "lumbercampicon",
                    width: 150,
                    height: 150,
                    cost: { wood: 60 },
                    buildTime: 900,
                    hp: 150,
                    dropoffTypes: ["wood"]
                },

                miningcamp: {
                    imageType: "miningcamp",
                    foundationType: "miningcampfoundation",
                    iconType: "miningcampicon",
                    width: 150,
                    height: 150,
                    cost: { wood: 60 },
                    buildTime: 900,
                    hp: 150,
                    dropoffTypes: ["gold", "stone"]
                },
                farm: {
                    imageType: "farm",
                    foundationType: "farmfoundation",
                    iconType: "farmicon",
                    width: 200,
                    height: 200,
                    cost: { wood: 60 },
                    buildTime: 600,
                    hp: 120,
                    dropoffTypes: []
                },
                mill: {
                    imageType: "mill",
                    foundationType: "windmillfoundation",
                    iconType: "mill",
                    width: 130,
                    height: 180,
                    cost: { wood: 80 },
                    buildTime: 1000,
                    hp: 180,
                    dropoffTypes: ["food"]
                },
                barrack: {
                    imageType: "barrack",
                    width: 300,
                    height: 300,
                    buildTime: 800,
                    hp: 300,
                    cost: { wood: 120 },
                    dropoffTypes: []
                },
                tower: {
                    width: 140,
                    height: 250,
                    hp: 120,
                    buildTime: 500,
                    imageType: "tower",
                    cost: { wood: 80, stone: 50 },
                    dropoffTypes: []
                }
            };
            this.aiBrains = this.game.aiBrains || (this.game.aiBrains = {
                2:    { thinkTimer: 0, attackTimer: 0, defendTarget: null, mode: "idle" },
                3: { thinkTimer: 0, attackTimer: 0, defendTarget: null, mode: "idle" },
                4:  { thinkTimer: 0, attackTimer: 0, defendTarget: null, mode: "idle" }
            });
            this.teamFactions = {
                1: 1,
                2: 2,
                3: 3,
                4: 4
            };
            this.game.simulation = this;
    }
    handleRightClickBuilding(building, x, y, target){
        if (this.trySetSelectedBuildingRally(building,x,y,target)) {
                    return;
        }
        
    }
    
    handleRightClickCommand(selectedUnits, x, y, target) {
        
        
        alert(selectedUnits.length+" "+ target.type);
        
        
        const selectedWorkers = selectedUnits.filter(o => !o.dead&&(o.type === "worker"||o.type === "rworker"||o.type === "gworker"||o.type === "yworker"));
        const selectedWarriors = selectedUnits.filter(o => !o.dead&&(o.type === "warrior"||o.type === "rwarrior"||o.type === "gwarrior"||o.type === "ywarrior"));
        const selectedSheep = selectedUnits.filter(o => !o.dead&&(o.type === "sheep"));
        
        const isResource = target && target.gatherTime;
        const isEnemy = target && target.selectable && this.isEnemyOf(selectedUnits[0], target);
        if (selectedWorkers.length > 0 && isResource && !this.game.buildMode) {
           
            for (const w of selectedWorkers) {
                if (
                    (target.type === "barrack"    ||target.type === "rbarrack"    ||target.type === "gbarrack"    ||target.type === "ybarrack" ||
                     target.type === "hus"        ||target.type === "rhus"        ||target.type === "ghus"        ||target.type === "yhus" ||
                     target.type === "townhall"   ||target.type === "rtownhall"   ||target.type === "gtownhall"   ||target.type === "ytownhall" ||
                     target.type === "mill"       ||target.type === "rmill"       ||target.type === "gmill"       ||target.type === "ymill" ||
                     target.type === "miningcamp" ||target.type === "rminingcamp" ||target.type === "gminingcamp" ||target.type === "yminingcamp" ||
                     target.type === "lumbercamp" ||target.type === "rlumbercamp" ||target.type === "glumbercamp" ||target.type === "ylumbercamp"))
                {    
                    if(target.isUnderConstruction===true&&!target.dead){
                        this.clearWorkerOrder(w);
                        w.state = "buildBuilding";
                        w.targetBuilding = target;
                        w.targetX = target.x + target.w / 2;
                        w.targetY = target.y + target.h / 2;
                        w.standingstill = false;
                        this.game.pathUnitTo(w, w.targetX, w.targetY);
                        
                        
                    }
                } else if (target.type === "boar" && !target.dead) {
                    this.orderWorkerAttackBoar(w, target);      
                    w.standingstill = false;
                } else {
                    if (target.type === "farm"||target.type === "rfarm"||target.type === "gfarm"||target.type === "yfarm") {
                        if (!target.slot) {
                            this.orderWorkerGather(w, target);
                            target.slot = w;
                            w.standingstill = false;
                        }
                    } else {
                        
                        this.orderWorkerGather(w, target);
                        w.standingstill = false;
                    }
                }
            }
            return;
        }

        if (selectedWarriors.length > 0 && !this.game.buildMode) {
            if (isResource && target.type === "boar" && !target.dead) {
                for (const w of selectedWarriors) {
                    this.orderWarriorAttackBoar(w, target);
                    w.standingstill = false;
                }
                return;
            }

            if (isEnemy && !target.dead) {
                for (const w of selectedWarriors) {
                    this.orderWarriorAttackTarget(w, target);
                    w.standingstill = false;
                }
                return;
            }
        }
        if (selectedWorkers.length > 0 && !this.game.buildMode) {
            for (const w of selectedWorkers) {
                if (w.targetResource) w.targetResource.slot = null;
                this.clearWorkerOrder(w);
                w.state = "move";
                w.targetX = x;
                w.targetY = y;
                w.standingstill = false;
                this.game.pathUnitTo(w, x, y);
                
               
            }
        }

        if (selectedWarriors.length > 0 && !this.game.buildMode) {
            for (const w of selectedWarriors) {
                w.targetEnemy = null;
                w.state = "move";
                w.targetX = x;
                w.targetY = y;
                w.standingstill = false;
                this.game.pathUnitTo(w, x, y);
                
            }
        }
        if(selectedSheep.length>0){
            for (const w of selectedSheep) {
                w.state = "move";
                w.targetX = x;
                w.targetY = y;
                w.standingstill = false;
                this.game.pathUnitTo(w, x, y);
               
            }
            
            
        }
    }
    updateGameLogic() {
        this.rebuildPathfindingIfNeeded();

        this.updateProjectiles();
        this.updateBuildings();
        this.updateResources();
        this.updateAnimals();
        this.updateUnits();
        if (this.aiTeams) {
            for (const team of this.aiTeams) {
                this.updateTeamAI(team);
            }
        }
        
        this.cleanupTransientFlags();
    }

    rebuildPathfindingIfNeeded() {
        if (!this.game.needsPathRebuild) return;

        this.game.rebuildPathfinding({
            isBlocker: (o) => {
                if (!o || o.dead) return false;

                return (
                    (o.isBuilding &&
                        o.type !== "farm" &&
                        o.type !== "rfarm" &&
                        o.type !== "gfarm" &&
                        o.type !== "yfarm") ||
                    o.type === "tree" ||
                    o.type === "stone" ||
                    o.type === "gold" ||
                    o.type === "river" ||
                    o.type === "berry"
                );
            },
            cell: 32,
            inflate: 10,
            bucket: 96
        });

        this.game.needsPathRebuild = false;
    }

    updateProjectiles() {
        const arrows = this.getAllArrowsAllTeams();
        for (const a of arrows) {
            this.updateArrow(a, 1);
        }
    }

    updateBuildings() {
        this.updateTowers();
        this.updateHouses();
        this.updateBarracks();
        this.updateTownhalls();
        this.updateLumbercamps();
        this.updateMiningcamps();
        this.updateMills();
        this.updateFarms();
    }

    updateResources() {
        this.updateGold();
        this.updateStone();
        this.updateBerry();
        this.updateTrees();
    }

    updateAnimals() {
        this.updateSheep();
        this.updateBoars();
    }

    updateUnits() {
        this.updateWarriors();
        this.updateWorkers();
    }

    cleanupTransientFlags() {
        // Lägg senare till sånt som behöver nollas varje logic-tick.
    }


    initTower(t) {
        this.ensureOwnerByName(t);

        t.isBuilding = true;
        t.isvisable = true;
        t.canMove = false;
        t.selectable = true;
        t.bottomsolid = 40;

        if (t.state == null) t.state = "idle";
        if (t.isUnderConstruction == null) t.isUnderConstruction = false;

        if (t.hp == null) t.hp = 120;
        if (t.maxHp == null) t.maxHp = 120;

        if (t.attackRange == null) t.attackRange = 600;
        if (t.damage == null) t.damage = 3;
        if (t.attackCooldown == null) t.attackCooldown = 0;
        if (t.attackSpeed == null) t.attackSpeed = 60;
        if (t.targetEnemy == null) t.targetEnemy = null;
    }

    updateTowers() {
        const towers = this.getAllTowersAllTeams();

        for (const t of towers) {
            this.initTower(t);

            if (!t.isUnderConstruction) {
                this.updateTower(t, 1);
            }
        }
    }

    initHouse(h) {
        this.ensureOwnerByName(h);

        h.isBuilding = true;
        h.isvisable = true;
        h.gatherTime = 100;
        h.selectable = true;
        h.canMove = false;

        if (h.hp == null) h.hp = 100;
        if (h.maxHp == null) h.maxHp = 100;
        if (h.isUnderConstruction == null) h.isUnderConstruction = false;
    }

    updateHouses() {
        const houses = this.getAllHousesAllTeams();

        for (const h of houses) {
            this.initHouse(h);
        }
    }

    initBarrack(b) {
        this.ensureOwnerByName(b);

        if (b.trainingQueue == null) {
            b.trainingQueue = [];
            b.trainingTimer = 0;
            b.trainingTimeMax = 700;
        }

        if (b.hp == null) b.hp = 300;
        if (b.maxHp == null) b.maxHp = 300;

        b.isBuilding = true;
        b.isvisable = true;
        b.gatherTime = 100;
        b.canMove = false;
        b.selectable = true;

        if (b.state == null) {
            b.isUnderConstruction = false;
            b.state = "building";
        }

    }

    updateBarracks() {
        const barracks = this.getAllBarracksAllTeams();

        for (const b of barracks) {
            this.initBarrack(b);
            this.updateBarrackTraining(b, 1,b.owner);
        }
    }

    initTownhall(t) {
        this.ensureOwnerByName(t);

        if (t.trainingQueue == null) {
            t.trainingQueue = [];
            t.trainingTimer = 0;
            t.trainingTimeMax = 900;

            
        }

        t.isBuilding = true;
        t.isvisable = true;
        t.gatherTime = 100;
        t.canMove = false;
        t.selectable = true;

        if (t.state == null) {
            t.isUnderConstruction = false;
            t.state = "building";
            t.dropoffTypes = ["wood", "food", "gold", "stone"];
            
            
            
        }

        if (t.hp == null) t.hp = 400;
        if (t.maxHp == null) t.maxHp = 400;
    }

    updateTownhalls() {
        const townhalls = this.getAllTownhallsAllTeams();

        for (const t of townhalls) {
            
            
            this.initTownhall(t);
            this.updateTownhallTraining(t, 1);
        }
    }

    initLumbercamp(l) {
        this.ensureOwnerByName(l);

        l.isvisable = true;
        l.gatherTime = 100;
        l.isBuilding = true;
        l.canMove = false;
        l.selectable = true;

        if (l.hp == null) l.hp = 150;
        if (l.maxHp == null) l.maxHp = 150;

        if (l.state == null) {
            l.isUnderConstruction = false;
            l.state = "building";
            l.dropoffTypes = ["wood"];
        }
    }

    updateLumbercamps() {
        const lumbercamps = this.getAllLumbercampsAllTeams();

        for (const l of lumbercamps) {
            this.initLumbercamp(l);
        }
    }

    initMiningcamp(m) {
        this.ensureOwnerByName(m);

        m.isvisable = true;
        m.gatherTime = 100;
        m.isBuilding = true;
        m.canMove = false;
        m.selectable = true;

        if (m.hp == null) m.hp = 150;
        if (m.maxHp == null) m.maxHp = 150;

        if (m.state == null) {
            m.isUnderConstruction = false;
            m.state = "building";
            m.dropoffTypes = ["gold", "stone"];
        }
    }

    updateMiningcamps() {
        const miningcamps = this.getAllMiningcampsAllTeams();

        for (const m of miningcamps) {
            this.initMiningcamp(m);
        }
    }

    initMill(m) {
        this.ensureOwnerByName(m);

        m.isvisable = true;
        m.gatherTime = 100;
        m.isBuilding = true;
        m.canMove = false;
        m.selectable = true;

        if (m.hp == null) m.hp = 180;
        if (m.maxHp == null) m.maxHp = 180;

        if (m.state == null) {
            m.isUnderConstruction = false;
            m.state = "building";
            m.dropoffTypes = ["food"];
        }
    }

    updateMills() {
        const mills = this.getAllMillsAllTeams();

        for (const m of mills) {
            this.initMill(m);
        }
    }

    initFarm(f) {
        this.ensureOwnerByName(f);

        f.isvisable = true;
        f.gatherTime = 1000;
        f.isBuilding = true;
        f.canMove = false;
        f.selectable = true;

        if (f.hp == null) f.hp = 120;
        if (f.maxHp == null) f.maxHp = 120;

        if (f.state == null) {
            f.isUnderConstruction = false;
            f.state = "building";
            f.rtype = "food";
            f.amount = 1000;
        }
    }

    updateFarms() {
        const farms = this.getAllFarmsAllTeams();

        for (const f of farms) {
            this.initFarm(f);
        }
    }

    updateGold() {
        const gold = this.game.getObjectType("gold")?.objects || [];

        for (const g of gold) {
            g.canMove = false;
            g.selectable = true;

            if (g.state == null) {
                g.state = "idle";
                g.rtype = "gold";
                g.amount = 1000;
                g.gatherTime = 500;
            }
        }
    }

    updateStone() {
        const stone = this.game.getObjectType("stone")?.objects || [];

        for (const s of stone) {
            s.canMove = false;
            s.selectable = true;

            if (s.state == null) {
                s.state = "idle";
                s.rtype = "stone";
                s.amount = 1000;
                s.gatherTime = 500;
            }
        }
    }

    updateBerry() {
        const berry = this.game.getObjectType("berry")?.objects || [];

        for (const b of berry) {
            b.canMove = false;
            b.selectable = true;

            if (b.state == null) {
                b.state = "idle";
                b.rtype = "food";
                b.amount = 100;
                b.gatherTime = 500;
            }
        }
    }

    updateTrees() {
        const trees = this.game.getObjectType("tree")?.objects || [];

        for (const t of trees) {
            t.selectable = true;

            if (t.state == null) {
                t.state = "idle";
                t.rtype = "wood";
                t.amount = 100;
                t.gatherTime = 500;
            }
        }
    }

    initSheep(s) {
        s.selectable = true;

        if (s.state == null) {
            s.state = "idle";
            s.rtype = "food";
            s.amount = 100;
            s.gatherTime = 500;
            s.nearActivated = false;
            s.owner = null;
            s.direction = "down";
            s.standingstill = true;
            s.hp=10;
        }
    }

    updateSheep() {
        const sheep = this.game.getObjectType("sheep")?.objects || [];

        for (const s of sheep) {
            this.initSheep(s);
            if (s.dead){s.hp=0;s.owner = null;s.standingstill = true; continue;}
            const nearbyWorker = this.getNearestWorkerInRange(s, 300);
            if (!s.dead && !s.owner && nearbyWorker) {
                s.owner = nearbyWorker.owner || 1;
                s.standingstill = false;
            }
            if (s.state === "move") {
                if (s.path && s.path.length > 0) {
                    this.game.followPath(s, { reachDist: 25 });
                     s.standingstill = false;
                }
            }
            

            

            if (!s.owner) {
                this.updatePassiveWander(s, 1, 60, 100, 240);
            } 
        }
    }

    initBoar(b) {
        b.selectable = true;

        if (b.state == null) {
            b.state = "idle";
            b.dead = false;
            b.rtype = "none";
            b.amount = 100;
            b.gatherTime = 500;

            b.spawnX = b.x;
            b.spawnY = b.y;

            b.hp = 40;
            b.maxHp = 40;
            b.targetUnit = null;
            b.attackCooldown = 0;
            b.aggroRange = 300;
            b.attackRange = 28;
            b.leashRange = 260;
            b.moveSpeed = 1.4;
            b.damage = 5;
        }
    }

    updateBoars() {
        const boars = this.game.getObjectType("boar")?.objects || [];

        for (const b of boars) {
            this.initBoar(b);

            if (!b.dead) {
                this.updateBoar(b, 1);
            }
        }
    }

    initWarrior(w) {
        this.ensureOwnerByName(w);

        if (!w.dead) w.selectable = true;
        w.iscontrollable = (w.owner === 1);

        if (w.state == null) {
            w.state = "idle";
            w.hp = 40;
            w.maxHp = 40;
            w.damage = 8;
            w.attackCooldown = 0;
            w.targetEnemy = null;
            w.direction = "down";
            w.standingstill = true;

            w.autoAttackRange = 180;
            w.resumeMoveAfterAttack = false;
            w.resumeX = null;
            w.resumeY = null;
        }
    }

    updateWarriors() {
        const warriors = this.getAllWarriorsAllTeams();

        for (const w of warriors) {
            this.initWarrior(w);
            this.updateWarrior(w, 1);
        }
    }

    initWorker(w) {
        this.ensureOwnerByName(w);

        if (!w.dead) w.selectable = true;

        if (w.state == null) {
            w.state = "idle";
            w.targetResource = null;
            w.targetDropoff = null;
            w.carryType = null;
            w.carryAmount = 0;
            w.carryMax = 10;
            w.gatherTimer = 0;
            w.jobType = null;
            w.attackTarget = null;
            w.attackTimer = 0;
            w.hp = 20;
            w.maxHp = 20;
            w.holdingicon = null;
        }
    }

    updateWorkers() {
        const townhalls = this.getAllTownhallsAllTeams();
        const workers = this.getAllWorkersAllTeams();

        for (const w of workers) {
            this.initWorker(w);

           

            this.updateWorker(w, townhalls, this.getPlayerResources(w.owner), 1);
        }
    }
    getAllArrowsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("arrow");
    }
    getAllObjectsOfBaseTypeAllTeams(baseName) {
        return [
            ...this.getTeamObjects(baseName, 1),
            ...this.getTeamObjects(baseName, 2),
            ...this.getTeamObjects(baseName, 3),
            ...this.getTeamObjects(baseName, 4)
        ];
    }

    getAllWorkersAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("worker");
    }

    getAllWarriorsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("warrior");
    }

    getAllTownhallsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("townhall");
    }

    getAllBarracksAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("barrack");
    }

    getAllHousesAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("hus");
    }

    getAllLumbercampsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("lumbercamp");
    }

    getAllMiningcampsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("miningcamp");
    }

    getAllMillsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("mill");
    }
    getAllBuildingsForTeam(owner) {
        return [
            ...this.getTeamObjects("townhall", owner),
            ...this.getTeamObjects("barrack", owner),
            ...this.getTeamObjects("hus", owner),
            ...this.getTeamObjects("lumbercamp", owner),
            ...this.getTeamObjects("miningcamp", owner),
            ...this.getTeamObjects("mill", owner),
            ...this.getTeamObjects("farm", owner),
            ...this.getTeamObjects("tower", owner)
        ];
    }
    getAllUnitsForTeam(owner) {
        return [
            ...this.getTeamObjects("worker", owner),
            ...this.getTeamObjects("warrior", owner)
        ];
    }
    getAliveObjectsOfBaseTypeAllTeams(baseName) {
        return this.getAllObjectsOfBaseTypeAllTeams(baseName).filter(o => !o.dead);
    }

    getAliveWorkersAllTeams() {
        return this.getAliveObjectsOfBaseTypeAllTeams("worker");
    }

    getAliveWarriorsAllTeams() {
        return this.getAliveObjectsOfBaseTypeAllTeams("warrior");
    }

    getAliveTownhallsAllTeams() {
        return this.getAliveObjectsOfBaseTypeAllTeams("townhall");
    }

    getAliveBarracksAllTeams() {
        return this.getAliveObjectsOfBaseTypeAllTeams("barrack");
    }
    getAllFarmsAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("farm");
    }
    getTeamObjectType(baseName, owner) {
        const prefix = this.getPrefixForOwner(owner);
        return this.game.getObjectType(prefix + baseName);
    }

    getTeamObjects(baseName, owner) {
        return this.getTeamObjectType(baseName, owner)?.objects || [];
    }
    getPrefixForOwner(owner) {
        if (owner === 2) return "r";
        if (owner === 3) return "y";
        if (owner === 4) return "g";
        return "";
    }
    getAllTowersAllTeams() {
        return this.getAllObjectsOfBaseTypeAllTeams("tower");
    }
    getAliveTowersAllTeams() {
        return this.getAliveObjectsOfBaseTypeAllTeams("tower");
    }
    ensureOwnerByName(obj) {
        if (!obj.owner) obj.owner = this.getOwnerFromName(obj.type);
    }
    getOwnerFromName(type) {
        if (!type) return 0;
        if (type.startsWith("r")) return 2;
        if (type.startsWith("y")) return 3;
        if (type.startsWith("g")) return 4;
        return 1;
    }
    updateTownhallTraining(townhall, scale) {
        if (!townhall.trainingQueue || townhall.trainingQueue.length === 0) {
            townhall.trainingTimer = 0;
            return;
        }

        townhall.trainingTimer += 12 * scale;

        if (townhall.trainingTimer >= townhall.trainingTimeMax) {
            const unitType = townhall.trainingQueue[0];

            let spawned = false;
            spawned = this.spawnWorkerFromTownhall(townhall);


            if (spawned) {
                townhall.trainingQueue.shift();
                townhall.trainingTimer = 0;
            } else {
                // håll kvar på 100% tills plats finns
                townhall.trainingTimer = townhall.trainingTimeMax;
            }
        }
    }  
    getNearestWorkerInRange(unit, range) {
        const workers = this.getAllWorkersAllTeams().filter(w => !w.dead);
        let best = null;
        let bestDist = range * range;

        for (const w of workers) {
            this.ensureOwnerByName(w);

            const dx = w.x - unit.x;
            const dy = w.y - unit.y;
            const d = dx * dx + dy * dy;

            if (d < bestDist) {
                bestDist = d;
                best = w;
            }
        }

        return best;
    }
    updatePassiveWander(unit, scale, radius = 80, waitMin = 40, waitMax = 140) {
        if (unit.dead) return;
        unit.standingstill = true;
        if (unit.spawnX == null) unit.spawnX = unit.x;
        if (unit.spawnY == null) unit.spawnY = unit.y;

        if (unit.wanderTimer == null) unit.wanderTimer = 0;
        if (unit.wanderState == null) unit.wanderState = "wait"; // "wait" | "move"
        if (unit.wanderMoveTimer == null) unit.wanderMoveTimer = 0;

        if (unit.wanderState === "wait") {
            unit.standingstill = true;
            unit.wanderTimer -= 12 * scale;

            if (unit.wanderTimer <= 0) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * radius;

                unit.wanderTargetX = unit.spawnX + Math.cos(angle) * dist;
                unit.wanderTargetY = unit.spawnY + Math.sin(angle) * dist;

                unit.targetX = unit.wanderTargetX;
                unit.targetY = unit.wanderTargetY;
                unit.standingstill = false;
                unit.wanderState = "move";
            }
            return;
        }

    if (unit.wanderState === "move") {
        unit.standingstill = false;
        const dx = unit.targetX - unit.x;
        const dy = unit.targetY - unit.y;
        const d = Math.hypot(dx, dy);
        
        unit.wanderMoveTimer += 12 * scale;

        if (d < 10 || unit.wanderMoveTimer > 120) {
            unit.wanderState = "wait";
            unit.wanderTimer = waitMin + Math.random() * (waitMax - waitMin);
            unit.wanderMoveTimer = 0;
            unit.standingstill = true;
            return;
        }

        
    }
    } 
    updateBoar(boar, scale) {
        if (boar.dead) return;
        // cooldown
        if (boar.attackCooldown > 0) {
            boar.attackCooldown -= 12 * scale;
            if (boar.attackCooldown < 0) boar.attackCooldown = 0;
        }



        if (boar.state === "idle") {
            const target = this.getNearestUnitInRange(boar, boar.aggroRange);
            if (target) {
                boar.targetUnit = target;
                boar.state = "aggro";
                return;
            }

            this.updatePassiveWander(boar, scale, 70, 80, 200);
            return;
        }

        if (boar.state === "aggro") {
            const t = boar.targetUnit;

            if (!t || t.dead) {
                boar.targetUnit = null;
                boar.state = "return";
                return;
            }

            const dxSpawn = boar.x - boar.spawnX;
            const dySpawn = boar.y - boar.spawnY;
            const dSpawn = Math.hypot(dxSpawn, dySpawn);

            if (dSpawn > boar.leashRange) {
                boar.targetUnit = null;
                boar.state = "return";
                return;
            }



            if (this.game.collideswithanoterobject(boar,t)) {
                boar.state = "attack";
                boar.standingstill = false;
                return;
            }

            this.moveBoarTowards(boar, t.x, t.y);
            return;
        }

        if (boar.state === "attack") {
            const t = boar.targetUnit;

            if (!t || t.dead) {
                boar.targetUnit = null;
                boar.state = "return";
                return;
            }



            if (!this.game.collideswithanoterobject(boar,t)) {
                boar.state = "aggro";
                return;
            }

            boar.standingstill = false;

            if (boar.attackCooldown <= 0) {
                boar.attackCooldown = 60; // justera
                t.hp = (t.hp || 20) - boar.damage;
                 t.flashTimer=30;
                // enkel knockback om du vill
                // t.vx = (dx > 0 ? 1 : -1) * 1.5;
                // t.vy = -1;

                if (t.hp <= 0) {
                    t.selectable = false;
                    t.flashTimer = 0;
                    t.dead = true;

                    const owner = t.owner;
                    const res = this.getPlayerResources(owner);;
                    if (res) {
                        res.pop -= 1;
                        if (res.pop < 0) res.pop = 0;
                    }

                    if (t.type.includes("worker")) {
                        t.animation = 12;
                    } else if (t.type.includes("warrior")) {
                        t.animation = 9;
                    }

                    boar.targetUnit = null;
                    boar.state = "return";
                }
            }

            return;
        }

        if (boar.state === "return") {
            const dx = boar.spawnX - boar.x;
            const dy = boar.spawnY - boar.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 8) {
                boar.x = boar.spawnX;
                boar.y = boar.spawnY;
                boar.state = "idle";
                boar.standingstill = false;
                return;
            }

            this.moveBoarTowards(boar, boar.spawnX, boar.spawnY);
            return;
        }

        if (boar.state === "dead") {
            boar.standingstill = true;
            return;
        }
    }          
    getNearestUnitInRange(boar, range) {
        const owners = [1, 2, 3, 4];
        let units = [];

        for (const owner of owners) {
            units.push(...this.getTeamObjects("worker", owner));
            units.push(...this.getTeamObjects("warrior", owner));
        }

        let best = null;
        let bestDist = range * range;

        for (const u of units) {
            if (!u || u.dead) continue;
            const d = this.dist2(boar, u);
            if (d < bestDist) {
                bestDist = d;
                best = u;
            }
        }

        return best;
    }  
    dist2(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }  
    updateOwnedSheep(s, scale) {
        const townhall = this.getNearestTownhallForOwner(s, s.owner);
        if (!townhall) {

            return;
        }

        const tx = townhall.x + townhall.w / 2;
        const ty = townhall.y + townhall.h / 2;

        const dx = tx - s.x;
        const dy = ty - s.y;
        const dist = Math.hypot(dx, dy);

        // stanna en bit från townhallen
        if (dist < 300) {
            s.targetX = null;
            s.targetY = null;
            return;
        }
        s.standingstill=false;
        s.targetX = tx;
        s.targetY = ty;
    }
    getNearestTownhallForOwner(unit, owner) {
        const townhalls = this.getTeamObjects("townhall", owner).filter(t => !t.dead);

        let best = null;
        let bestDist = Infinity;

        for (const t of townhalls) {
            const tx = t.x + t.w / 2;
            const ty = t.y + t.h / 2;
            const dx = tx - unit.x;
            const dy = ty - unit.y;
            const d = dx * dx + dy * dy;

            if (d < bestDist) {
                bestDist = d;
                best = t;
            }
        }

        return best;
    }
    moveBoarTowards(boar, tx, ty) {
        boar.targetX = tx;
        boar.targetY = ty;
        boar.standingstill = false;

        const dx = tx - boar.x;
        const dy = ty - boar.y;


    } 
    updateWorker(worker, townhallList, playerResources, scale) {
        if(worker.dead){worker.standingstill=true;return;}
        const speed = 1.0;
        if(worker.state !== "buildBuilding")worker.isbuilding=false;
        
        
       // drawUnitPathDebug(ctx, worker, "cyan");

        if (worker.state === "idle") {

            return;
        }
        if (worker.state === "move") {


            if (worker.path && worker.path.length > 0) {
                worker.standingstill=false;
                this.game.followPath(worker, { reachDist: 25 });
            }

            if (worker.targetX == null || worker.targetY == null) {
                worker.state = "idle";
                worker.standingstill = true;

            }

            return;
        }
    if (worker.state === "buildBuilding") {
        const b = worker.targetBuilding;

           



        if (!b || b.dead || !b.isUnderConstruction || b.isFinishing) {
            worker.targetBuilding = null;
            worker.state = "idle";
            worker.targetX = null;
            worker.targetY = null;
            worker.sistabit=false;
            worker.standingstill=false;
            this.clearUnitPath(worker);
            return;
        }

        if (this.game.collideswithanoterobject(worker, b)|| worker.isbuilding) {
            worker.isbuilding=true;
            worker.standingstill = true;
            this.clearUnitPath(worker);

            b.buildTimer += 12 * scale;
            
            
            b.buildProgress = b.buildTimer / b.buildTimeMax;
       
            if (b.buildProgress >= 1) {
                worker.sistabit=false;
                worker.standingstill=false;
                 worker.standingstill = true;
                b.buildProgress = 1;
                b.isUnderConstruction = false;
                b.isFinishing = true;

                this.finishBuilding(b, worker);
                worker.targetBuilding = null;

                if (!b.slot && (b.type === "farm"||b.type === "rfarm"||b.type === "gfarm"||b.type === "yfarm")) {
                    b.slot = worker;
                    this.orderWorkerGather(worker, b);
                    worker.selected = false;

                } else {
                    worker.state = "idle";
                    worker.targetX = null;
                    worker.targetY = null;
                    worker.standingstill = true;

                }
            } else {


            }

            return;
        }

        const p = this.getApproachPoint(worker, b, 20);
        const px = p.x;
        const py = p.y;

        if (!worker.sistabit) {
            worker.standingstill = false;
            worker.targetX = px;
            worker.targetY = py;
            const go=this.updateUnitPathMovement(worker, scale, { reachDist: 25, repathEvery: 500 });

            if (!go) {
                worker.standingstill = false;
                worker.targetX = b.x + b.w / 2;
                worker.targetY = b.y + b.h / 2;
                worker.sistabit = true;
            }
        }      
        return;
    }

    if (worker.state === "attackBoar") {
        const b = worker.attackTarget;

        if (!b || b.dead || b.state === "dead" || b.hp <= 0) {
            worker.attackTarget = null;
            worker.state = "gather";
            worker.targetResource = b;
            worker.jobType = "food";
            this.clearUnitPath(worker);
            return;
        }

        if (this.game.collideswithanoterobject(worker, b)) {
            this.clearUnitPath(worker);
            worker.standingstill = true;
            worker.attackTimer = (worker.attackTimer || 0) + 12 * scale;

            if (worker.attackTimer >= 60) {
                worker.attackTimer = 0;
                b.hp -= 5;
                b.flashTimer = 30;

                if (b.hp <= 0) {
                    b.hp=0;
                    b.dead = true;
                    b.rtype = "food";
                    worker.attackTarget = null;
                    worker.state = "gather";
                    worker.targetResource = b;
                    worker.jobType = "food";
                    worker.sistabit=false;
                    worker.standingstill=false;
                }
            }
            return;
        }

        worker.targetX = b.x + b.w / 2;
        worker.targetY = b.y + b.h / 2;
        this.updateUnitPathMovement(worker, scale, { reachDist: 25, repathEvery: 25, movedThreshold: 12 });
        return;
        
        
        
        
        
    
        if (!worker.sistabit) {
            worker.standingstill = false;
            worker.targetX = b.x + b.w / 2;
            worker.targetY = b.y + b.h / 2;
            const go=this.updateUnitPathMovement(worker, scale, { reachDist: 25, repathEvery: 500 });
            if(!go)worker.sistabit = true;
            
        }
        if(worker.sistabit){
                worker.standingstill = false;
                worker.targetX = b.x + b.w / 2;
                worker.targetY = b.y + b.h / 2;
                worker.sistabit = true;
        }
        return;
        
        
        
        
        
        
        
        
    }
    if (worker.state === "moveToResource") {
        let r = worker.targetResource;
        if (!r || (r.dead && r.type !== "sheep" && r.type !== "boar") || r.amount <= 0) {
            worker.targetResource = null;
            this.clearUnitPath(worker);

            if (worker.carryAmount > 0) {
                worker.targetDropoff = this.getNearestDropoff(worker, worker.carryType);
                if (worker.targetDropoff) {
                    worker.state = "returnToBase";
                    worker.sistabit=false;
                    worker.standingstill=false;
                    this.requestUnitPath(
                        worker,
                        worker.targetDropoff.x + worker.targetDropoff.w / 2,
                        worker.targetDropoff.y + worker.targetDropoff.h / 2
                    );
                } else {
                    worker.state = "idle";
                    worker.sistabit=false;
                    worker.standingstill=false;
                }
            } else {
                const next = this.getNearestResourceOfType(worker,worker.jobType);
                if (next) {
                    worker.targetResource = next;
                    worker.state = "moveToResource";
                    worker.sistabit=false;
                    worker.standingstill=false;
                    this.requestUnitPath(worker, next.x + next.w / 2, next.y + next.h / 2);
                } else {
                    worker.state = "idle";
                    worker.sistabit=false;worker.standingstill=false;
                    worker.jobType = null;
                }
            }


            return;
        }

        if(r.type=="farm"||r.type=="rfarm"||r.type=="gfarm"||r.type=="yfarm"){
            if (this.game.collideswithanoterobject(worker,r)) {
                this.clearUnitPath(worker);
                worker.state = "gather";
                worker.sistabit=false;
                worker.standingstill=false;
                worker.gatherTimer = 0;
                worker.standingstill = true;
                return;
            }


        }
        else{
     
            const collideobject=this.game.collideswiths(worker,r.type);
            if (collideobject) {
                this.clearUnitPath(worker);
                r=collideobject;
                worker.targetResource=collideobject;
                worker.state = "gather";
                worker.sistabit=false;
                worker.standingstill=false;
                worker.gatherTimer = 0;
                worker.standingstill = true;
                if(r.type==="sheep")r.dead=true;
                return;
            }
        }

        const p = this.getApproachPoint(worker, r, 20);
        const px = p.x;
        const py = p.y;

        if (!worker.sistabit) {
            worker.standingstill = false;
            worker.targetX = px;
            worker.targetY = py;
            const go=this.updateUnitPathMovement(worker, scale, { reachDist: 25, repathEvery: 500 });

            if (!go) {
                worker.standingstill = false;
                worker.targetX = r.x + r.w / 2;
                worker.targetY = r.y + r.h / 2;
                worker.sistabit = true;
            }
        }      
        return;
    }

        if (worker.state === "gather") {
           
            const r = worker.targetResource;
            worker.standingstill = true;
            if(r.type==="farm"||r.type==="rfarm"||r.type==="gfarm"||r.type==="yfarm"){

                worker.standingstill=false;

                worker.targetX = r.x + (r.w / 2)-(worker.w / 2);
                worker.targetY = r.y + (r.h / 2)-(worker.h / 2);


            }

            if (!r  || r.amount <= 0) {
                worker.targetResource = null;

                if (worker.carryAmount > 0) {
                    worker.targetDropoff = this.getNearestDropoff(worker, worker.carryType);
                    if (worker.targetDropoff) {
                        worker.state = "returnToBase";
                        worker.sistabit=false;
                        worker.standingstill=false;
                    } else {
                        worker.state = "idle";
                        worker.sistabit=false;
                        worker.standingstill=false;
                    }
                } else {
                    const next = this.getNearestResourceOfType(worker, worker.jobType);
                    if (next) {
                        worker.targetResource = next;
                        worker.state = "moveToResource";
                        worker.sistabit=false;
                        worker.standingstill=false;
                    } else {
                        worker.state = "idle";
                        worker.jobType = null;
                        worker.sistabit=false;
                        worker.standingstill=false;
                    }
                }


                return;
            }


            worker.gatherTimer += 12 * scale;
            
            if (worker.gatherTimer >= r.gatherTime) {
                worker.gatherTimer = 0;
                const take = Math.min(worker.carryMax - worker.carryAmount, 10, r.amount);
                r.amount -= take;
                worker.carryAmount += take;
                worker.carryType = r.rtype;

                if (r.amount <= 0) {
                    this.game.removeObject(r.id);
                    this.game.markStaticsDirty();
                }

                if (worker.carryAmount >= worker.carryMax || r.amount <= 0) {
                    worker.targetDropoff = this.getNearestDropoff(worker, worker.carryType);
                    if (worker.targetDropoff) {
                        worker.state = "returnToBase";
                        worker.sistabit=false;
                        worker.standingstill=false;
                    } else {
                        worker.state = "idle";
                        worker.sistabit=false;
                        worker.standingstill=false;
                    }
                }
            }
            return;
        }

    if (worker.state === "returnToBase") {
        const t = worker.targetDropoff;
 
        if (!t || t.dead) {
            worker.state = "idle";
            worker.sistabit=false;
            worker.standingstill=false;
            worker.standingstill = true;
            this.clearUnitPath(worker);
            return;
        }

        if (this.game.collideswithanoterobject(worker, t)) {
            this.clearUnitPath(worker);
            if (t.isUnderConstruction) return;
            worker.state = "deposit";
            worker.sistabit=false;
            worker.standingstill=false;
            worker.standingstill = true;
            return;
        }

        const p = this.getApproachPoint(worker, t, 20);
        const px = p.x;
        const py = p.y;

        if (!worker.sistabit) {
            worker.standingstill = false;
            worker.targetX = px;
            worker.targetY = py;
            const go=this.updateUnitPathMovement(worker, scale, { reachDist: 25, repathEvery: 500 });

            if (!go) {
                worker.standingstill = false;
                worker.targetX = t.x + t.w / 2;
                worker.targetY = t.y + t.h / 2;
                worker.sistabit = true;
            }
        }      
        return;
    }

    if (worker.state === "deposit") {
        this.clearUnitPath(worker);

        if (worker.carryAmount > 0 && worker.carryType) {
            playerResources[worker.carryType] =
                (playerResources[worker.carryType] || 0) + worker.carryAmount;
        }

        worker.carryAmount = 0;
        worker.carryType = null;

        if (worker.targetResource && worker.targetResource.amount > 0) {
            worker.state = "moveToResource";
            worker.sistabit=false;
            worker.standingstill=false;
            this.requestUnitPath(
                worker,
                worker.targetResource.x + worker.targetResource.w / 2,
                worker.targetResource.y + worker.targetResource.h / 2
            );
        } else {
            const next = this.getNearestResourceOfType(worker, worker.jobType);

            if (next ) {
                worker.targetResource = next;
                worker.state = "moveToResource";
                worker.sistabit=false;
                worker.standingstill=false;
                this.requestUnitPath(
                    worker,
                    next.x + next.w / 2,
                    next.y + next.h / 2
                );
            } else {
                worker.state = "idle";
                worker.targetResource = null;
                worker.jobType = null;
                worker.sistabit=false;
                worker.standingstill=false;

            }
        }


        return;
    }
    }
    clearWorkerOrder(worker) {
        if (!worker) return;

        if (worker.targetResource && worker.targetResource.slot === worker) {
            worker.targetResource.slot = null;
        }

        worker.state = "idle";
        worker.targetResource = null;
        worker.targetDropoff = null;
        worker.jobType = null;
        worker.gatherTimer = 0;
        worker.targetBuilding = null;
        worker.attackTarget = null;

        this.clearUnitPath(worker);
    }   
    clearUnitPath(unit) {
        if (!unit) return;
        if (this.game.clearPath) this.game.clearPath(unit);
        unit.path = null;
        unit.pathIndex = 0;
        unit._lastPathGoalX = null;
        unit._lastPathGoalY = null;
        unit.repathTimer = 0;
    }
    isEnemyOf(a, b) {
        if (!a || !b) return false;
        if (a.dead || b.dead) return false;

        const fa = this.getFaction(a.owner);
        const fb = this.getFaction(b.owner);

        if (fa === 0 || fb === 0) return false;

        return fa !== fb;
    }
    getFaction(owner) {
        if (!owner) return 0;
        return this.teamFactions?.[owner] ?? owner;
    }
    orderWorkerGather(worker, resource) {
        if (!worker || !resource) return;
        if (resource.amount <= 0) return;

        worker.targetResource = resource;
        
      
        
        worker.jobType = resource.rtype;
        worker.targetDropoff = this.getNearestDropoff(worker, resource.rtype);
        worker.state = "moveToResource";

        const p = this.getApproachPoint(worker, resource, 18);
        worker.targetX=resource.x+resource.w/2;worker.targetY=resource.y+resource.h/2;
        this.requestUnitPath(worker, p.x, p.y);
        worker.standingstill=false;
    }  
    getNearestDropoff(unit, resourceType) {
        const owner = unit.owner || 1;

        const all = this.game.world.selectable.filter(o =>
            !o.dead &&
            o.owner === owner &&
            o.dropoffTypes &&
            o.dropoffTypes.includes(resourceType)
        );

        let best = null;
        let bestDist = Infinity;

        for (const b of all) {
            const dx = b.x - unit.x;
            const dy = b.y - unit.y;
            const d = dx * dx + dy * dy;

            if (d < bestDist) {
                bestDist = d;
                best = b;
            }
        }

        return best;
    }
    getApproachPoint(unit, target, margin = 12) {
        if (!unit || !target) return null;

        if(unit.ApproachPointtarget ===target){return unit.ApproachPoint;}
        margin= 0;
        const points = [
            // vänster
            { x: target.x - margin, y: target.y + target.h / 2 },
            // höger
            { x: target.x + target.w + margin, y: target.y + target.h / 2 },
            // uppe
            { x: target.x + target.w / 2, y: target.y - margin },
            // nere
            { x: target.x + target.w / 2, y: target.y + target.h + margin },

            // hörn
            { x: target.x - margin, y: target.y - margin },
            { x: target.x + target.w + margin, y: target.y - margin },
            { x: target.x - margin, y: target.y + target.h + margin },
            { x: target.x + target.w + margin, y: target.y + target.h + margin }
        ];

        let best = null;
        let bestDist = Infinity;

        for (const p of points) {
            const dx = p.x - unit.x;
            const dy = p.y - unit.y;
            const d = dx * dx + dy * dy;

            if (d < bestDist) {
                bestDist = d;
                best = p;
            }
        }
        unit.ApproachPointtarget=target;
        unit.ApproachPoint=best;
        return best;
    }
    requestUnitPath(unit, tx, ty) {
        if (!unit) return;
        unit.targetX = tx;
        unit.targetY = ty;
        unit.repathTimer = 0;
        unit._lastPathGoalX = null;
        unit._lastPathGoalY = null;
    }
    updateUnitPathMovement(unit, scale, options = {}) {
        if (!unit || unit.dead) return;

        const reachDist = options.reachDist ?? 14;
        const repathEvery = options.repathEvery ?? 45;
        const movedThreshold = options.movedThreshold ?? 24;

        if (unit.targetX == null || unit.targetY == null) {

            this.clearUnitPath(unit);
            return;
        }

        if (unit.repathTimer == null) unit.repathTimer = 0;
        unit.repathTimer -= 1 * scale;

        const gx = unit.targetX;
        const gy = unit.targetY;

        const dxGoal = gx - (unit._lastPathGoalX ?? gx);
        const dyGoal = gy - (unit._lastPathGoalY ?? gy);
        const goalMoved = Math.hypot(dxGoal, dyGoal);

        if (
            unit.repathTimer <= 0 ||
            !unit.path ||
            unit.path.length === 0 ||
            goalMoved > movedThreshold
        ) {
            unit._lastPathGoalX = gx;
            unit._lastPathGoalY = gy;
            this.game.pathUnitTo(unit, gx, gy);
            unit.repathTimer = repathEvery;
        }

        if (unit.path && unit.path.length > 0) {
            this.game.followPath(unit, { reachDist });
        }
        else{return false;}

        return true;
    }
    orderWorkerAttackBoar(worker, boar) {
        if (!worker || !boar || boar.state === "dead") return;

        this.clearWorkerOrder(worker);
        worker.attackTarget = boar;
        worker.state = "attackBoar";

        this.requestUnitPath(
            worker,
            boar.x + boar.w / 2,
            boar.y + boar.h / 2
        );
    }
    getPlayerResources(player) {
        if (player === 1) return this.teamResources.one;
        if (player === 2) return this.teamResources.two;
        if (player === 3) return this.teamResources.three;
        if (player === 4) return this.teamResources.four;
        return null;
    }

    canAfford(cost, player) {
        const res = this.getPlayerResources(player);
        if (!res) return false;

        for (const key in cost) {
            if ((res[key] || 0) < cost[key]) return false;
        }
        return true;
    }

    payCost(cost, player) {
        const res = this.getPlayerResources(player);
        if (!res) return false;

        for (const key in cost) {
            res[key] = (res[key] || 0) - cost[key];
        }
        return true;
    }

    canPlaceBuilding(x, y, w, h,AI) {
        const all = this.game.world.entities;

        for (const o of all) {
            if (!o) continue;
            if (o.dead && !o.amount) continue;

            const blocksPlacement =
                o.isBuilding ||
                o.type === "tree" ||
                o.type === "tree2" ||
                o.type === "gold" ||
                o.type === "stone" ||
                o.type === "river" ||
                o.type === "berry" ||
                o.type === "sheep" ||
                o.type === "boar" ||
                o.type.includes("worker") ||
                o.type.includes("warrior");

            if (!blocksPlacement) continue;

            if(AI)if (this.rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h, 100)) {return false;}
            else if (this.rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h,0)) {return false;}
        }

        return true;
    }

    placeBuilding(x, y, buildingType, player, workers = []) {
        
        
  
        
        
        var def = this.BUILDING_TYPES[buildingType];
        if (!def) def = this.BUILDING_TYPES[buildingType.substring(1)];
        if(!def)return false;
        if (!this.canAfford(def.cost, player)) return false;
        if (!this.canPlaceBuilding(x, y, def.width, def.height,false)) return false;
        
        this.payCost(def.cost, player);
        
        var b=null; 
        if(def.imageType==="farm")b = this.game.addObject(x,y,def.width,def.height,0,false,"ghost",buildingType);
        else b = this.game.addObject(x,y,def.width,def.height,0,false,"solid",buildingType);
        
        if (!b) return false;
        this.game.markStaticsDirty();
        b.owner = player;
        b.selectable = true;
        b.canMove = false;
        b.iscontrollable = false;
        b.isBuilding = true;
        b.isUnderConstruction = true;
        b.state = "building";
        b.buildingType = buildingType;
        b.buildProgress = 0;
        b.buildTimer = 0;
        b.buildTimeMax = def.buildTime;
        b.maxHp = def.hp;
        b.hp = 1;
        b.popGranted = false;
        b.cost = def.cost;
        for (const w of workers) {
            this.clearWorkerOrder?.(w);
            w.state = "buildBuilding";
            w.sistabit = false;
            w.standingstill = false;
            w.targetBuilding = b;
            this.game.pathUnitTo(w, b.x + b.w / 2, b.y + b.h / 2);
        }

        this.game.needsPathRebuild = true;
        return b;
    }
    rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh, pad = 0) {
        return (
            ax < bx + bw + pad &&
            ax + aw > bx - pad &&
            ay < by + bh + pad &&
            ay + ah > by - pad
        );
    }
    finishBuilding(b, worker) {
        if (!b || b._finishedOnce) return;
        b._finishedOnce = true;

        var def = this.BUILDING_TYPES[b.buildingType];
        if (!def) def=this.BUILDING_TYPES[b.buildingType.substring(1)];
        if(!def)return;

        const owner = b.owner;
        let resources = this.getPlayerResources(owner);
        
        if (!resources) return;

        b.selectable = true;
        b.canMove = false;
        b.iscontrollable = false;
        b.isBuilding = true;
        b.isUnderConstruction = false;
        b.isFinishing = false;
        b.hp = def.hp;
        b.maxHp = def.hp;
        b.dropoffTypes = def.dropoffTypes || [];
        b.cost = def.cost;

        if (b.type.includes("farm") || b.buildingType === "farm") {
            b.rtype = "food";
            b.amount = 1000;
            b.state = "building";
        }

        if (def.popMaxBonus) {
            resources.popMax += def.popMaxBonus;
        }
    }
    getNearestResourceOfType(unit, type) {
        if (!type || !this.game.world) return null;

        const preferred = [];
        const fallback = [];
        const allObjects = this.game.world.selectable;
        const rivers = this.getRiverList();

        for (const r of allObjects) {
            if (!r||r.amount <= 0 || r.rtype !== type) continue;
            if (r.id != null && this.game.unreachableResources.has(r.id)) continue;
            if (r.type === "farm" || r.type === "rfarm" || r.type === "gfarm" || r.type === "yfarm") continue;
            const p = this.getApproachPoint(unit, r, 18);
            if (!p) continue;

            const dx = p.x - unit.x;
            const dy = p.y - unit.y;
            const airD2 = dx * dx + dy * dy;

            const item = { r, airD2, p };

            if (this.aabbHitsRiverBetweenFast(unit.x, unit.y, p.x, p.y, rivers)) {
                fallback.push(item);
            } else {
                preferred.push(item);
            }
        }

        preferred.sort((a, b) => a.airD2 - b.airD2);
        fallback.sort((a, b) => a.airD2 - b.airD2);

        // 1. samma sida först
        let best = this.findBestReachableResourceCheap(unit, preferred, 1);
        if (best) return best;

        // 2. andra sidan, normal billig test
        best = this.findBestReachableResourceCheap(unit, fallback, 1);
        if (best) return best;


        return null;
    }
    findBestReachableResourceCheap(unit, candidates, maxTest) {
        let best = null;
        let bestScore = Infinity;

        let limit = Math.min(candidates.length, maxTest);

        for (let i = 0; i < limit; i++) {
            const r = candidates[i].r;
            const p = this.getApproachPoint(unit, r, 18);
            if (!p) continue;
            const path = this.game.findPath(unit.x, unit.y, p.x, p.y, {
                isBlocker: this.game.pathfinding.options.isBlocker
            });

            if (!Array.isArray(path) ){this.game.unreachableResources.add(r.id);continue;}

            const last = path[path.length - 1];
            const endDist = Math.hypot(last.x - p.x, last.y - p.y);
            if (endDist >= 60){ this.game.unreachableResources.add(r.id);continue;}

            const score = path.length * 32 + endDist;

            if (score < bestScore) {
                bestScore = score;
                best = r;
            }
        }

        return best;
    }

    getRiverList() {
        if (!this.game._riverListCache || this.game.needsPathRebuild) {
            this.game._riverListCache = this.game.world.selectable.filter(o => o.type === "river");
        }
        return this.game._riverListCache;
    }

    aabbHitsRiverBetweenFast(ux, uy, rx, ry, rivers) {
        const minx = Math.min(ux, rx);
        const miny = Math.min(uy, ry);
        const maxx = Math.max(ux, rx);
        const maxy = Math.max(uy, ry);

        for (const o of rivers) {
            const ox1 = o.x;
            const oy1 = o.y;
            const ox2 = o.x + o.w;
            const oy2 = o.y + o.h;

            if (
                maxx >= ox1 &&
                minx <= ox2 &&
                maxy >= oy1 &&
                miny <= oy2
            ) {
                return true;
            }
        }

        return false;
    }
    updateBarrackTraining(barrack, scale,owner) {
        if (!barrack.trainingQueue || barrack.trainingQueue.length === 0) {
            barrack.trainingTimer = 0;
            return;
        }

        barrack.trainingTimer += 12 * scale;

        if (barrack.trainingTimer >= barrack.trainingTimeMax) {
            const unitType = barrack.trainingQueue[0];
            let spawned = false;
            if (unitType === "warrior") {
                spawned = this.spawnWarriorFromBarrack(barrack);
            }

            if (spawned) {
                barrack.trainingQueue.shift();
                barrack.trainingTimer = 0;
            } else {
                barrack.trainingTimer = barrack.trainingTimeMax;
            }
        }
    }
    spawnWarriorFromBarrack(barrack) {
        const owner = barrack.owner;
        const resources = this.getPlayerResources(owner);
        const warriorType = this.getTeamObjectType("warrior", owner);
        if (!warriorType) return false;

        const pos = this.findFreeSpawnPosition(barrack, 40, 60);
        if (!pos) return false;

        if (resources.pop >= resources.popMax) {
            return false;
        }

        resources.pop += 1;

        const w = this.game.addObject(pos.x,  pos.y, 40, 60, 0, false,"dynamic", warriorType.name);
        if (!w) return false;

        w.owner = owner;
       // w.state = "idle";
        w.hp = 40;
        w.maxHp = 40;
        w.damage = 6;
        w.attackRange = 28;
        w.attackCooldown = 0;
        w.moveSpeed = 1.2;
        w.targetEnemy = null;
        w.selectable = true;
        w.direction = "down";
        w.standingstill = true;
        w.autoAttackRange = 180;
        w.resumeMoveAfterAttack = false;
        w.resumeX = null;
        w.resumeY = null;
        this.applyRallyPointToUnit(w, barrack);
       

        return true;
    }
    findFreeSpawnPosition(townhall, unitW = 30, unitH = 50) {
        const spots = this.getTownhallSpawnPositions(townhall,unitW,unitH);

        for (const p of spots) {
            if (this.isSpawnAreaFree(p.x, p.y, unitW, unitH)) {
                return p;
            }
        }

        return null;
    }  
    isSpawnAreaFree(x, y, w, h) {
        const all = this.game.world.selectable;

        for (const o of all) {
            if (o.dead) continue;

            if (
                x < o.x + o.w &&
                x + w > o.x &&
                y < o.y + o.h &&
                y + h > o.y
            ) {

                return false;
            }
        }

        return true;
    }            
    getTownhallSpawnPositions(townhall, unitW = 30, unitH = 50) {
        const pad = 20;

        const left = townhall.x - unitW - pad;
        const right = townhall.x + townhall.w + pad;
        const top = townhall.y - unitH - pad;
        const bottom = townhall.y + townhall.h + pad;
        const midX = townhall.x + townhall.w / 2 - unitW / 2;
        const midY = townhall.y + townhall.h / 2 - unitH / 2;

        return [
            { x: left,  y: top },     // vänster uppe
            { x: left,  y: midY },    // vänster mitten
            { x: left,  y: bottom },  // vänster nere

            { x: midX,  y: top },     // mitten uppe
            { x: midX,  y: bottom },  // mitten nere

            { x: right, y: top },     // höger uppe
            { x: right, y: midY },    // höger mitten
            { x: right, y: bottom }   // höger nere
        ];
    }
    queueWorkerTrainingForTeam(townhall) {
        const owner = townhall.owner;
        const resources = this.getPlayerResources(owner);;
        if (!townhall || townhall.isUnderConstruction) return false;
        if ((resources.food || 0) < 50) return false;
        if (townhall.trainingQueue.length >= 8) return false;
        if (resources.pop >= resources.popMax) return false;

        resources.food -= 50;
        townhall.trainingQueue.push("worker");
        return true;
    }

    queueWarriorTrainingForTeam(barrack) {
        const owner = barrack.owner;
        const resources = this.getPlayerResources(owner);;
        if (!barrack || barrack.isUnderConstruction) return false;
        if ((resources.food || 0) < 60) return false;
        if ((resources.gold || 0) < 20) return false;
        if (barrack.trainingQueue.length >= 8) return false;
        if (resources.pop >= resources.popMax) return false;

        resources.food -= 60;
        resources.gold -= 20;
        barrack.trainingQueue.push("warrior");
        return true;
    }
    spawnWorkerFromTownhall(townhall) {
        const owner = townhall.owner ;
        const resources = this.getPlayerResources(owner);;

        const workerType = this.getTeamObjectType("worker", owner);
        if (!workerType) return false;

        let pos = this.findFreeSpawnPosition(townhall, 40, 60);
        if(owner===1)this.findFreeSpawnPosition(townhall, 30, 50);
        if (!pos) return false;

        if (resources.pop >= resources.popMax) {
            return false;
        }

        resources.pop += 1;
        let w=null;
        if(owner===1)w = this.game.addObject(pos.x, pos.y, 30, 50, 0, false, "dynamic", workerType.name); 
        else w = this.game.addObject(pos.x, pos.y, 40, 60, 0, false, "dynamic", workerType.name); 
        if (!w) return false;

        w.owner = owner;
       // w.state = "idle";
        w.targetResource = null;
        w.targetDropoff = null;
        w.carryType = null;
        w.carryAmount = 0;
        w.carryMax = 10;
        w.gatherTimer = 0;
        w.jobType = null;
        w.holdingicon = null;
        w.attackTarget = null;
        w.attackTimer = 0;
        w.hp = 20;
        w.maxHp=20;
        w.selectable = owner;
        w.direction = "down";
        w.standingstill = false;
        this.applyRallyPointToUnit(w, townhall);

        return true;
    }
    updateWarrior(warrior, scale) {
        if (warrior.dead){warrior.standingstill=true; return;}
       // drawUnitPathDebug(ctx, warrior, "yellow");
        if (warrior.attackCooldown == null) warrior.attackCooldown = 0;
        if (warrior.damage == null) warrior.damage = 8;
        if (warrior.hp == null) warrior.hp = 40;
        if (warrior.state == null) warrior.state = "idle";
        if (warrior.autoAttackRange == null) warrior.autoAttackRange = 180;

        if (warrior.attackCooldown > 0) {
            warrior.attackCooldown -= 12 * scale;
            if (warrior.attackCooldown < 0) warrior.attackCooldown = 0;
        }




        // AUTOATTACK: testa innan idle/move logik
        if (warrior.state === "idle" || warrior.state === "move") {
            if (this.tryAutoAttack(warrior)) {
                return;
            }
        }

        if (warrior.state === "idle") {
            warrior.standingstill = true;
            return;
        }

    if (warrior.state === "move") {
        if (warrior.path && warrior.path.length > 0) {
            this.game.followPath(warrior, { reachDist: 25 });
            warrior.standingstill = false;
        } else {
            warrior.state = "idle";
            warrior.standingstill = true;
            warrior.targetX = null;
            warrior.targetY = null;
        }

        return;
    }

        if (warrior.state === "attackTarget") {
            const t = warrior.targetEnemy;

            if (!t || t.dead || t.hp <= 0) {
                this.finishWarriorAttack(warrior);
                return;
            }

            if (this.game.collideswithanoterobject(warrior, t)) {
                this.clearUnitPath(warrior);
                warrior.standingstill = true;

                if (warrior.attackCooldown <= 0) {
                    warrior.attackCooldown = 40;
                    t.hp = (t.hp || 40) - warrior.damage;
                    t.flashTimer = 30;

                    if (t.hp <= 0) {
                        t.hp = 0;
                        t.dead = true;

                        if (t.type === "boar") {
                            t.rtype = "food";
                        } else if (t.type.includes("worker")) {
                            t.selectable = false;
                        } else if (t.type.includes("warrior")) {
                            t.selectable = false;
                        }

                        if (t.isBuilding) {
                            this.game.removeObject(t.id);
                            this.game.markStaticsDirty();
                        }

                        if (t.owner && this.getPlayerResources(t.owner) && (t.type.includes("worker") || t.type.includes("warrior"))) {
                            this.getPlayerResources(t.owner).pop -= 1;
                            if (this.getPlayerResources(t.owner).pop < 0) this.getPlayerResources(t.owner).pop = 0;
                        }

                        this.finishWarriorAttack(warrior);
                    }
                }

                return;
            }

            if (warrior.repathTimer == null) warrior.repathTimer = 0;
            warrior.repathTimer -= 12 * scale;

            if (warrior.repathTimer <= 0 || !warrior.path || warrior.path.length === 0) {
                const tx = t.x + t.w / 2;
                const ty = t.y + t.h / 2;

                const ddx = tx - (warrior._lastPathGoalX ?? tx);
                const ddy = ty - (warrior._lastPathGoalY ?? ty);
                const moved = Math.hypot(ddx, ddy);

                if (!warrior.path || warrior.path.length === 0 || moved > 40) {
                    warrior._lastPathGoalX = tx;
                    warrior._lastPathGoalY = ty;
                    this.game.pathUnitTo(warrior, tx, ty);
                }

                warrior.repathTimer = 500;
            }

            if (warrior.path && warrior.path.length > 0) {
                warrior.standingstill = false;
                this.game.followPath(warrior, { reachDist: 25 });
            } else {
                warrior.targetX = t.x + t.w / 2;
                warrior.targetY = t.y + t.h / 2;
                warrior.standingstill = false;
            }

            return;
        }
    }
    finishWarriorAttack(warrior) {
        if (!warrior) return;

        const shouldResume = warrior.resumeMoveAfterAttack && warrior.resumeX != null && warrior.resumeY != null;
        const rx = warrior.resumeX;
        const ry = warrior.resumeY;

        warrior.targetEnemy = null;
        warrior.resumeMoveAfterAttack = false;
        warrior.resumeX = null;
        warrior.resumeY = null;

        if (shouldResume) {
            this.orderUnitMove(warrior, rx, ry);
        } else {
            warrior.state = "idle";
            warrior.targetX = null;
            warrior.targetY = null;
            warrior.standingstill = true;
            this.clearUnitPath(warrior);
        }
    }
    orderUnitMove(unit, x, y) {
        if (!unit) return;

        unit.state = "move";
        unit.targetX = x;
        unit.targetY = y;
        unit.standingstill = false;
        this.clearUnitPath(unit);
        this.game.pathUnitTo(unit, x, y);
    }
    tryAutoAttack(warrior) {
        if (!warrior || warrior.dead) return false;

        // bara när den inte redan slåss
        if (warrior.state !== "idle" && warrior.state !== "move") return false;

        const target = this.getWarriorAutoAttackTarget(warrior, warrior.autoAttackRange || 180);
        if (!target) return false;

        // om den gick mot en punkt, spara den så vi kan återuppta efter fight
        if (warrior.state === "move" && warrior.targetX !== null && warrior.targetY !== null) {
            warrior.resumeMoveAfterAttack = true;
            warrior.resumeX = warrior.targetX;
            warrior.resumeY = warrior.targetY;
        } else {
            warrior.resumeMoveAfterAttack = false;
            warrior.resumeX = null;
            warrior.resumeY = null;
        }

        this.orderWarriorAttackTarget(warrior, target);
        return true;
    }
    getWarriorAutoAttackTarget(warrior, range = 180) {
        if (!warrior || warrior.dead) return null;

        const enemies = [];

        // vanliga fiendelag
        for (const enemyOwner of this.getEnemyOwners(warrior.owner)) {
            enemies.push(...this.getTeamObjects("worker", enemyOwner));
            enemies.push(...this.getTeamObjects("warrior", enemyOwner));
            enemies.push(...this.getTeamObjects("townhall", enemyOwner));
            enemies.push(...this.getTeamObjects("barrack", enemyOwner));
            enemies.push(...this.getTeamObjects("hus", enemyOwner));
            enemies.push(...this.getTeamObjects("lumbercamp", enemyOwner));
            enemies.push(...this.getTeamObjects("miningcamp", enemyOwner));
            enemies.push(...this.getTeamObjects("mill", enemyOwner));
            enemies.push(...this.getTeamObjects("farm", enemyOwner));
        }

        // boar får också vara autoattack-target
        const boars = this.game.getObjectType("boar")?.objects || [];
        enemies.push(...boars);

        let best = null;
        let bestDist = range * range;

        for (const e of enemies) {
            if (!e || e.dead) continue;
            if (e === warrior) continue;

            // boar är neutral, så den måste tillåtas separat
            const validEnemy = e.type === "boar" || this.isEnemyOf(warrior, e);
            if (!validEnemy) continue;

            const ex = e.x + e.w / 2;
            const ey = e.y + e.h / 2;
            const wx = warrior.x + warrior.w / 2;
            const wy = warrior.y + warrior.h / 2;

            const dx = ex - wx;
            const dy = ey - wy;
            const d2 = dx * dx + dy * dy;

            if (d2 < bestDist) {
                bestDist = d2;
                best = e;
            }
        }

        return best;
    }
    getEnemyOwners(owner) {
        const myFaction = this.getFaction(owner);
        if (myFaction === 0) return [];

        const enemies = [];

        for (let i = 1; i <= 4; i++) {
            if (i === owner) continue;

            const f = this.getFaction(i);

            if (f !== 0 && f !== myFaction) {
                enemies.push(i);
            }
        }

        return enemies;
    }
    orderWarriorAttackBoar(warrior, boar) {
        if (!warrior || !boar || boar.dead) return;

        warrior.targetEnemy = boar;
        warrior.state = "attackTarget";
        warrior.repathTimer = 0;
        warrior._lastPathGoalX = null;
        warrior._lastPathGoalY = null;
        this.game.pathUnitTo(warrior, boar.x + boar.w / 2, boar.y + boar.h / 2);
    }
    orderWarriorAttackTarget(warrior, target) {
        if (!warrior || !target || target.dead) return;

        warrior.targetEnemy = target;
        warrior.state = "attackTarget";
        warrior.repathTimer = 0;
        warrior._lastPathGoalX = null;
        warrior._lastPathGoalY = null;
        this.game.pathUnitTo(warrior, target.x + target.w / 2, target.y + target.h / 2);
    }
    updateTower(tower, scale) {
        if (tower.dead) return;

        if (tower.attackCooldown > 0) {
            tower.attackCooldown -= 12 * scale;
            if (tower.attackCooldown < 0) tower.attackCooldown = 0;
        }

        let t = tower.targetEnemy;

        if (!t || t.dead) {
            t = this.getTowerTarget(tower);
            tower.targetEnemy = t;
        }



        if (!t) return;

        const tx = tower.x + tower.w / 2;
        const ty = tower.y + tower.h / 2;
        const ex = t.x + t.w / 2;
        const ey = t.y + t.h / 2;

        const dx = ex - tx;
        const dy = ey - ty;
        const dist = Math.hypot(dx, dy);



        if (dist > tower.attackRange) {
            tower.targetEnemy = null;
            return;
        }

        if (tower.attackCooldown <= 0) {
            tower.attackCooldown = tower.attackSpeed;
            this.spawnArrow(tower, t);
        }
    }
    updateArrow(arrow, scale) {
        if (!arrow || arrow.dead) return;

        const t = arrow.targetEnemy;

        if (!t || t.dead) {
            this.game.removeObject(arrow.id);
            return;
        }

        const tx = t.x + t.w / 2;
        const ty = t.y + t.h / 2;

        const dx = tx - arrow.x;
        const dy = ty - arrow.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 10 || this.game.collideswithanoterobject(arrow, t)) {
            t.hp = t.hp- (arrow.damage || 6);
            t.flashTimer = 30;
            if (t.hp <= 0) {
                
                t.hp = 0;
                t.dead = true;
                t.selectable = false;

                if (t.type === "boar") {
                    
                    t.rtype = "food";
                }
                else if (t.isBuilding) {
                    this.game.removeObject(t.id);
                    this.game.markStaticsDirty();
                }

                if (t.owner && this.getPlayerResources(t.owner) && (t.type.includes("worker") || t.type.includes("warrior"))) {
                    this.getPlayerResources(t.owner).pop -= 1;
                    if (this.getPlayerResources(t.owner).pop < 0)this.getPlayerResources(t.owner).pop = 0;
                }
            }

            this.game.removeObject(arrow.id);
            return;
        }

        if (dist > 0.001) {
            
            arrow.x += (dx / dist) * (arrow.speed || 6) * scale;
            arrow.y += (dy / dist) * (arrow.speed || 6) * scale;
            arrow.r = Math.atan2(dy, dx) * 180 / Math.PI;
        }
    }
    spawnArrow(tower, target) {
        if (!tower || !target || target.dead) return null;

        const owner = tower.owner;
        const arrowType = this.getTeamObjectType("arrow", owner);
        if (!arrowType) return null;

        const sx = tower.x + tower.w / 2 - 8;
        const sy = tower.y + tower.h / 2 - 8;

        const a = this.game.addObject(sx,  sy, 16, 16, 0, false,"ghost", arrowType.name);
        
        
        if (!a) return null;

        a.owner = owner;
        a.targetEnemy = target;
        a.damage = tower.damage || 6;
        a.speed = 6*12;
        a.state = "fly";
        a.selectable = false;
        a.canMove = true;
        a.isProjectile = true;

        return a;
    }
    getTowerTarget(tower) {
        const all = this.game.world.selectable;

        let best = null;
        let bestDist = tower.attackRange * tower.attackRange;

        const tx = tower.x + tower.w / 2;
        const ty = tower.y + tower.h / 2;

        for (const o of all) {
            if (!o || o.dead) continue;
            if (o === tower) continue;

            // ignorera projektiler
            if (o.isProjectile) continue;

            // ignorera neutralt skräp om du vill
            if (o.holdingicon) continue;

            // MÅSTE vara fiende (eller boar)
            const isValid =
                o.type === "boar" ||
                this.isEnemyOf(tower, o);

            if (!isValid) continue;

            const ox = o.x + o.w / 2;
            const oy = o.y + o.h / 2;

            const dx = ox - tx;
            const dy = oy - ty;
            const d = dx * dx + dy * dy;

            if (d < bestDist) {
                bestDist = d;
                best = o;
            }
        }

        return best;
    }
    setBuildingRallyPoint(building, x, y, clickedResource = null) {
        if (!building) return;
        if (!building.rallyPoint) {
            building.rallyPoint = {
                x: x,
                y: y,
                mode: "ground",
                resourceType: null,
                preferredResourceId: null
            };
        }
        building.rallyPoint.x = x;
        building.rallyPoint.y = y;
        

        if (building.type.endsWith("townhall")&&clickedResource &&( clickedResource.rtype||clickedResource.type==="boar" )) {
            building.rallyPoint.mode = "resource";
            
            if(clickedResource.type==="boar")building.rallyPoint.resourceType="food";
            else building.rallyPoint.resourceType = clickedResource.rtype;
            
            
            
            building.rallyPoint.preferredResourceId = clickedResource.id ?? null;
        } else {
            building.rallyPoint.mode = "ground";
            building.rallyPoint.resourceType = null;
            building.rallyPoint.preferredResourceId = null;
        }
    }
    findBestResourceNearRally(unit, rallyPoint) {
        if (!rallyPoint || rallyPoint.mode !== "resource" || !rallyPoint.resourceType) return null;

        const allObjects = this.game.world.entities;
        const rivers = this.getRiverList ? this.getRiverList() : null;

        let best = null;
        let bestScore = Infinity;

        // 1. Försök originalresursen först om den finns kvar
        if (rallyPoint.preferredResourceId != null) {
            for (const r of allObjects) {
                if (r.id !== rallyPoint.preferredResourceId) continue;
                if (this.isValidRallyResource(unit, r, rallyPoint.resourceType)) {
                    return r;
                }
                break;
            }
        }

        // 2. Annars välj bästa resurs nära rallypunkten
        for (const r of allObjects) {
            if (!this.isValidRallyResource(unit, r, rallyPoint.resourceType)) continue;

            const p = this.getApproachPoint(unit, r, 18);
            if (!p) continue;

            const dxR = p.x - rallyPoint.x;
            const dyR = p.y - rallyPoint.y;
            const dRally2 = dxR * dxR + dyR * dyR;

            const dxU = p.x - unit.x;
            const dyU = p.y - unit.y;
            const dUnit2 = dxU * dxU + dyU * dyU;

            let penalty = 0;

            // om du redan använder river-check för resursval:
            if (rivers && this.aabbHitsRiverBetweenFast && this.aabbHitsRiverBetweenFast(unit.x, unit.y, p.x, p.y, rivers)) {
                penalty += 500000;
            }

            // liten penalty om upptagen av annan worker
            if (r.slot && r.slot !== unit) {
                penalty += 200000;
            }

            const score = dRally2 * 0.8 + dUnit2 * 0.2 + penalty;

            if (score < bestScore) {
                bestScore = score;
                best = r;
            }
        }

        return best;
    }
    isValidRallyResource(unit, r, wantedType) {
        if (!r) return false;
        if (r.amount <= 0) return false;
        if (r.rtype !== wantedType) return false;

        if (r.id != null && this.game.unreachableResources && this.game.unreachableResources.has(r.id)) {
            return false;
        }

        // sheep specialfall
        if (r.type === "sheep") {
            //if (r.owner && r.owner !== "neutral" && r.owner !== unit.owner) return false;
        }

        // hoppa över farms om du inte vill att wood/stone osv råkar ta farm
        if (r.type === "farm" || r.type === "rfarm" || r.type === "gfarm" || r.type === "yfarm") {
            return false;
        }

        return true;
    }
    applyRallyPointToUnit(unit, building) {
        if (!unit || !building || !building.rallyPoint) return;

        const rp = building.rallyPoint;

        if (rp.mode === "ground") {
            this.clearUnitPath(unit);
            unit.targetX = rp.x;
            unit.targetY = rp.y;
            unit.state = "move";
            unit.standingstill = false;
            this.game.pathUnitTo(unit, unit.targetX, unit.targetY);
            return;
        }

        if (rp.mode === "resource") {
            const r = this.findBestResourceNearRally(unit, rp);

            if (r) {
                if (r.slot == null) r.slot = unit;
                this.orderWorkerGather(unit, r);
                return;
            }

            // fallback om ingen resurs hittas
            this.clearUnitPath(unit);
            unit.targetX = rp.x;
            unit.targetY = rp.y;
            unit.state = "move";
            unit.standingstill = false;
            this.game.pathUnitTo(unit, unit.targetX, unit.targetY);
        }
    }
    trySetSelectedBuildingRally(building,x,y,target) {
     
            for(const b of building){
                if(b.type.endsWith("barrack")||b.type.endsWith("townhall"))this.setBuildingRallyPoint(b, x, y, target);
            }    
     
    }
    ///-------------------------AI
    updateTeamAI(owner) {
        const brain = this.aiBrains[owner];
        const resources = this.getPlayerResources(owner);
        if (!brain || !resources) return;

        brain.thinkTimer -= 12 ;
        if (brain.thinkTimer > 0) return;
        brain.thinkTimer = 30;

        const workers = this.getTeamObjects("worker", owner).filter(w => !w.dead);
        const warriors = this.getTeamObjects("warrior", owner).filter(w => !w.dead);
        const townhalls = this.getTeamObjects("townhall", owner).filter(t => !t.dead);
        const barracks = this.getTeamObjects("barrack", owner).filter(b => !b.dead);

        const mainTownhall = townhalls[0];
        if (!mainTownhall) return;

        const unfinished = this.getUnfinishedBuildingsNeedingBuilder(owner);
        for (const b of unfinished) {
            if (!this.hasAliveBuilderAssigned(b)) {
                const builder = this.getBuilderWorkerForTeam(owner);
                if (builder) {
                    this.clearWorkerOrder(builder);
                    builder.state = "buildBuilding";
                    builder.targetBuilding = b;
                    builder.targetX = b.x + b.w / 2;
                    builder.targetY = b.y + b.h / 2;
                }
                return;
            }
        }




        // --- 3. Om inget hot: vanlig AI ---
        brain.mode = "normal";

        // workers jobbar
        for (const w of workers) {
            if (w.state === "idle") {
                const wantedType = this.getMostNeededResourceJob(owner);
                const res = this.getNearestResourceOfType(w, wantedType);

                if (res) {
                    if (res.type === "boar") this.orderWorkerAttackBoar(w, res);
                    else this.orderWorkerGather(w, res);
                }
            }
        }

        const builder = this.getBuilderWorkerForTeam(owner);

        const needHouse = resources.pop >= resources.popMax - 1;
        const houseAlreadyPlanned = this.hasBuildingOfTypeUnderConstruction(owner, "hus");

        if (needHouse && !houseAlreadyPlanned && builder && this.canAffordForTeam(this.BUILDING_TYPES.hus.cost, resources)) {
            const spot = this.findBuildSpotNear(mainTownhall, this.BUILDING_TYPES.hus.width, this.BUILDING_TYPES.hus.height);
            if (spot) {
                this.placeBuildingForOwner(spot.x, spot.y, "hus", owner, builder);
                return;
            }
        }

        const barrackPlanned = this.hasBuildingOfTypeUnderConstruction(owner, "barrack");
        if (barracks.length === 0 && !barrackPlanned && builder && this.canAffordForTeam(this.BUILDING_TYPES.barrack.cost, resources)) {
            const spot = this.findBuildSpotNear(mainTownhall, this.BUILDING_TYPES.barrack.width, this.BUILDING_TYPES.barrack.height);
            if (spot) {
                this.placeBuildingForOwner(spot.x, spot.y, "barrack", owner, builder);
                return;
            }
        }
        for (const b of barracks) {
            if (warriors.length < 10) {
                this.queueWarriorTrainingForTeam(b, resources);
            }
        }
        const desiredWorkers = Math.min(12, 5 + this.countBuildingsOfType(owner, "hus", false) * 2);

        if (workers.length < desiredWorkers && townhalls.length > 0) {
            this.queueWorkerTrainingForTeam(townhalls[0], resources);
        }



        this.sendIdleWarriorsToRally(owner);


        // --- 1. Försvarsläge prioriteras ---
        if (brain.defendTarget && this.isThreatStillRelevant(owner, brain.defendTarget, 320)) {
            brain.mode = "defend";
            this.sendTeamWarriorsToDefend(owner, brain.defendTarget, 4);
            return; // attackera inte bas samtidigt
        } else {
            brain.defendTarget = null;
            if (brain.mode === "defend") brain.mode = "idle";
        }

        // --- 2. Leta nytt hot ---
        const threat = this.getNearestThreatToOwner(owner, 280);
        if (threat) {
            brain.defendTarget = threat;
            brain.mode = "defend";
            this.sendTeamWarriorsToDefend(owner, threat, 4);
            return; // attackera inte bas samtidigt
        }



        if (warriors.length >= 4 && brain.attackTimer <= 0) {
            const target = this.getAttackTargetForOwner(owner);
            if (target) {
                for (const w of warriors) {
                    this.orderWarriorAttackTarget(w, target);
                }
                brain.attackTimer = 600;
                brain.mode = "attack";
            }
        }

        brain.attackTimer -= 360;
        if (brain.attackTimer < 0) brain.attackTimer = 0;
    }
    getUnfinishedBuildingsNeedingBuilder(owner) {
        return this.getAllBuildingsForTeam(owner).filter(b =>
            b && !b.dead && b.isUnderConstruction && !b.isFinishing
        );
    }
    hasAliveBuilderAssigned(building) {
        const workers = this.getTeamObjects("worker", building.owner );
        return workers.some(w =>
            !w.dead &&
            w.state === "buildBuilding" &&
            w.targetBuilding === building
        );
    }
    getBuilderWorkerForTeam(owner) {
        const workers = this.getTeamObjects("worker", owner).filter(w => !w.dead);

        // 1. bästa fallet: idle
        let w = workers.find(w =>
            w.state === "idle" &&
            !w.targetBuilding
        );
        if (w) return w;

        // 2. annars ta en som samlar / är på väg till resurs
        w = workers.find(w =>
            !w.targetBuilding &&
            (
                w.state === "moveToResource" ||
                w.state === "gather" ||
                w.state === "returnToBase" ||
                w.state === "deposit"
            )
        );
        if (w) return w;

        // 3. sista utväg: vad som helst som inte redan bygger
        w = workers.find(w =>
            !w.targetBuilding &&
            w.state !== "buildBuilding" &&
            w.state !== "attackBoar"
        );
        return w || null;
    }
    getMostNeededResourceJob(owner) {
        const wanted = this.getAITargetWorkerCounts(owner);
        const current = this.getAIWorkerJobCounts(owner);

        const deficits = [
            { type: "food",  need: wanted.food  - current.food },
            { type: "wood",  need: wanted.wood  - current.wood },
            { type: "gold",  need: wanted.gold  - current.gold },
            { type: "stone", need: wanted.stone - current.stone }
        ];

        deficits.sort((a, b) => b.need - a.need);

        if (deficits[0].need > 0) return deficits[0].type;

        return "wood";
    }
    getAITargetWorkerCounts(owner) {
        const resources = this.getPlayerResources(owner);
        const barracks = this.getTeamObjects("barrack", owner).filter(b => !b.dead && !b.isUnderConstruction);

        let food = 3;
        let wood = 3;
        let gold = 0;
        let stone = 0;

        // när barrack finns och AI ska göra warriors behövs guld
        if (barracks.length > 0) {
            gold = 2;
        }

        // om låg på food, öka food-prio
        if ((resources.food || 0) < 80) food += 1;

        // om låg på wood, öka wood-prio
        if ((resources.wood || 0) < 80) wood += 1;

        // om låg på gold, öka gold-prio
        if ((resources.gold || 0) < 40 && barracks.length > 0) gold += 1;

        return { food, wood, gold, stone };
    }
    getAIWorkerJobCounts(owner) {
        const workers = this.getTeamObjects("worker", owner).filter(w => !w.dead);

        const counts = {
            food: 0,
            wood: 0,
            gold: 0,
            stone: 0,
            build: 0,
            idle: 0
        };

        for (const w of workers) {
            if (w.state === "buildBuilding") {
                counts.build++;
                continue;
            }

            if (w.state === "idle") {
                counts.idle++;
                continue;
            }

            if (w.jobType === "food") counts.food++;
            else if (w.jobType === "wood") counts.wood++;
            else if (w.jobType === "gold") counts.gold++;
            else if (w.jobType === "stone") counts.stone++;
            else counts.idle++;
        }

        return counts;
    }
    hasBuildingOfTypeUnderConstruction(owner, buildingType) {
        const list = this.getTeamObjects(buildingType, owner) || [];
        return list.some(b => !b.dead && b.isUnderConstruction);
    }
    findBuildSpotNear(base, w, h, tries = 30, radius = 260) {
        for (let i = 0; i < tries; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 120 + Math.random() * radius;

            const x = Math.floor(base.x + base.w / 2 + Math.cos(angle) * dist - w / 2);
            const y = Math.floor(base.y + base.h / 2 + Math.sin(angle) * dist - h / 2);

            if (this.canPlaceBuilding(x, y, w, h,true)) {
                return { x, y };
            }
        }
        return null;
    }
    placeBuildingForOwner(x, y, buildingType, owner, builder) {
        const def = this.BUILDING_TYPES[buildingType];
        if (!def) return false;

        const resources = this.getPlayerResources(owner);
        if (!resources) return false;
        if (!this.canAffordForTeam(def.cost, resources)) return false;

        const objType = this.getTeamObjectType(def.imageType, owner);
        if (!objType) return false;

        const b = this.game.addObject( x, y, def.width, def.height, 0, false, "solid", objType.name);
        if (!b) return false;
        this.payCostForTeam(def.cost, resources);

        b.owner = owner;
        b.canMove = false;
        b.iscontrollable = false;
        b.isBuilding = true;
        b.isUnderConstruction = true;
        b.state = "building";
        b.buildingType = buildingType;
        b.buildProgress = 0;
        b.buildTimer = 0;
        b.buildTimeMax = def.buildTime;
        b.maxHp = def.hp;
        b.hp = 1;
        b.popGranted = false;
        b.cost = def.cost;

        if (builder) {
            this.clearWorkerOrder(builder);
            builder.state = "buildBuilding";
            builder.sistabit=false;
            builder.standingstill=false;
            builder.targetBuilding = b;
            this.requestUnitPath(builder, b.x + b.w / 2, b.y + b.h / 2);
        }

        this.game.markStaticsDirty();
        return b;
    }
    payCostForTeam(cost, resources) {
        for (const key in cost) {
            resources[key] -= cost[key];
        }
    }
    canAffordForTeam(cost, resources) {
        for (const key in cost) {
            if ((resources[key] || 0) < cost[key]) return false;
        }
        return true;
    }
    countBuildingsOfType(owner, buildingType, includeUnderConstruction = true) {
        const list = this.getTeamObjects(buildingType, owner) || [];
        if (includeUnderConstruction) return list.filter(b => !b.dead).length;
        return list.filter(b => !b.dead && !b.isUnderConstruction).length;
    }
    sendIdleWarriorsToRally(owner) {
        const barracks = this.getTeamObjects("barrack", owner).filter(b => !b.dead && !b.isUnderConstruction);
        if (barracks.length === 0) return;

        const rallyBarrack = barracks[0];
        this.ensureBarrackRallyPoint(rallyBarrack);

        const warriors = this.getTeamObjects("warrior", owner).filter(w => !w.dead);

        for (const w of warriors) {
            if (w.state === "idle") {
                const dx = (rallyBarrack.rallyX || 0) - w.x;
                const dy = (rallyBarrack.rallyY || 0) - w.y;
                const d = Math.hypot(dx, dy);

                if (d > 30 ) {
                    this.orderUnitMove(w, rallyBarrack.rallyX, rallyBarrack.rallyY);
                }
            }
        }
    }
    ensureBarrackRallyPoint(barrack) {
        if (barrack.rallyX != null && barrack.rallyY != null) return;

        barrack.rallyX = barrack.x + barrack.w / 2 + 140;
        barrack.rallyY = barrack.y + barrack.h / 2 + 140;
    }
    isThreatStillRelevant(owner, threat, range = 320) {
        if (!threat || threat.dead) return false;

        const myThings = [
            ...this.getTeamObjects("worker", owner),
            ...this.getTeamObjects("warrior", owner),
            ...this.getTeamObjects("townhall", owner),
            ...this.getTeamObjects("barrack", owner),
            ...this.getTeamObjects("hus", owner)
        ].filter(o => !o.dead);

        const range2 = range * range;

        for (const o of myThings) {
            const dx = o.x - threat.x;
            const dy = o.y - threat.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= range2) return true;
        }

        return false;
    }
    sendTeamWarriorsToDefend(owner, threat, maxCount = 4) {
        if (!threat || threat.dead) return;

        const warriors = this.getTeamObjects("warrior", owner)
            .filter(w => !w.dead)
            .slice(0, maxCount);

        for (const w of warriors) {
            if (w.targetEnemy === threat && w.state === "attackTarget") continue;
            this.orderWarriorAttackTarget(w, threat);
        }
    }
    getNearestThreatToOwner(owner, range = 300) {
        const myUnits = [
            ...this.getTeamObjects("worker", owner),
            ...this.getTeamObjects("warrior", owner),
            ...this.getTeamObjects("townhall", owner),
            ...this.getTeamObjects("barrack", owner),
            ...this.getTeamObjects("hus", owner),
            ...this.getTeamObjects("tower", owner)
        ].filter(o => !o.dead);

        const boars = this.game.getObjectType("boar")?.objects || [];
        const enemyOwners = this.getEnemyOwners(owner);

        let threats = [...boars.filter(b => !b.dead)];

        for (const eo of enemyOwners) {
            threats.push(...this.getTeamObjects("worker", eo).filter(o => !o.dead));
            threats.push(...this.getTeamObjects("warrior", eo).filter(o => !o.dead));
        }

        let bestThreat = null;
        let bestDist = range * range;

        for (const my of myUnits) {
            for (const t of threats) {
                const dx = my.x - t.x;
                const dy = my.y - t.y;
                const d = dx * dx + dy * dy;

                if (d < bestDist) {
                    bestDist = d;
                    bestThreat = t;
                }
            }
        }

        return bestThreat;
    }
    getAttackTargetForOwner(owner) {
        const enemies = [];

        for (const enemyOwner of this.getEnemyOwners(owner)) {
            enemies.push(...this.getTeamObjects("warrior", enemyOwner));
            enemies.push(...this.getTeamObjects("worker", enemyOwner));
            enemies.push(...this.getTeamObjects("townhall", enemyOwner));
            enemies.push(...this.getTeamObjects("barrack", enemyOwner));
            enemies.push(...this.getTeamObjects("hus", enemyOwner));
            enemies.push(...this.getTeamObjects("tower", enemyOwner));
        }

        let best = null;
        let bestDist = Infinity;
        const myTownhall = this.getTeamObjects("townhall", owner)[0];
        if (!myTownhall) return enemies.find(e => !e.dead) || null;

        for (const e of enemies) {
            if (!e || e.dead) continue;
            const d = this.dist2(myTownhall, e);
            if (d < bestDist) {
                bestDist = d;
                best = e;
            }
        }

        return best;
    }
    
}
