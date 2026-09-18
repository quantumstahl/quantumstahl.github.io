class CatAdventure {
    constructor(canvasId = "gameCanvas",canvas2d = "canvas2d") {
        this.canvas = document.getElementById(canvasId);
        this.canvas2d = document.getElementById(canvas2d);
		this.ctx=this.canvas2d.getContext("2d");
        this.joy = new JoyStick('canvas2d');
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        this.assetManager = new AssetManager();
        this.mapLoader = new AdventureMapLoader(this);

        this.mapObjects = [];
        this.player = null;
        this.playerData = null;

        this.input = new AdventureInput(this.canvas2d);

        this.lastTime = 0;

        this.moveSpeed = 0.07;
        this.turnSpeed = 0.04;
        this.mixers = [];
        this.animatedObjects = [];
        this.cameraYaw = 0;
        this.cameraDistance = 6;
        this.cameraHeight = 3;
        
        this.playerVelY = 0;
        this.onGround = false;

        this.gravity = -0.010;
        this.jumpPower = 0.22;
        this.playerRadius = 0.35;
        this.groundSnapDistance = 0.25;
        this.worldSolver = new WorldSolver(this);
        this.playerBottomOffset = 0;
        this.coins=0;
        
        this.gates=[];
        
        this.insectObj=null;
        
        this.texture2 = new THREE.TextureLoader().load("grasyfield.png");
        this.texture2.wrapS = THREE.RepeatWrapping;
        this.texture2.wrapT = THREE.RepeatWrapping;
        this.texture2.repeat.set(8, 8);
        this.texture2.colorSpace = THREE.NoColorSpace;
    }

    async start(mapUrl = "map.json") {
        this.initThree();

        await this.mapLoader.load(mapUrl);
        
        this.findsleepingbug();
        this.findPlayerCat();
        this.setupAnimation();
        this.grass = new CatAdventureGrass(this);
        this.grass.build();
        this.buildRenderBatches();
        
        
        
        window.addEventListener("resize", () => this.resize());
        this.resize();

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x8fb3d9);

        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        const sun = new THREE.DirectionalLight(0xffffff, 4.2);
        sun.position.set(5, 10, 5);
        this.scene.add(sun);

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
        
        const groundGeo = new THREE.PlaneGeometry(400, 400);
        const groundMat = new THREE.MeshStandardMaterial({
           map: this.texture2
        });

        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.rotation.x = -Math.PI / 2;
        this.scene.add(this.ground);

        this.renderBatcher = new CatAdventureRenderBatcher(this);
    }

    gameLoop(time) {
        if (!this.lastTime) this.lastTime = time;

        let deltaMs = time - this.lastTime;
        this.lastTime = time;

        if (deltaMs > 50) deltaMs = 50;

        const scale = deltaMs / (1000 / 60);
        const deltaSeconds = deltaMs / 1000;


        
        
        this.update(scale, deltaSeconds);
        this.draw();

        


        requestAnimationFrame((t) => this.gameLoop(t));
    }

    update(scale,deltaSeconds) {
        this.worldSolver.beginFrame();
        this.worldSolver.updatePlayerY(this.player, scale);
        this.worldSolver.resolveHorizontal(this.player);
        this.worldSolver.checkGhostAndTriggerContacts(this.player);
        if(mobileAndTabletCheck())this.updatePlayerFromJoystick(scale);
        else this.updatePlayer(scale);
        
        
        this.updateCamera(scale);
        this.grass?.update(deltaSeconds);
        for (const mixer of this.mixers) {
            mixer.update(deltaSeconds);
        }
        if (this.insectObj?.userData.sleepingEffect) {
   
            this.insectObj.userData.sleepingEffect.update(deltaSeconds);

            
        }
        
        
        const e=this.touching(this.player, "bug", "solid", "down");
        if (e) {
            this.squishInsect(e.mesh);
             audio2("sounds/splash.mp3");
        }
        
	
	
        if (this.input.isJumpJustPressed()) {

            this.jump();
    
        }
        const c=this.touching(this.player, "coin", "ghost");
        if(c){
            this.removeMapObject(c);
            this.coins++;
            audio2("sounds/coin.mp3");
            
        }
        if(this.coins>8)this.openGate(this.gates[0]);
        
        if(this.touching(this.player, "2song", "trigger")){
            if(song!=='sounds/FoxMeadow.mp3'){
                song= 'sounds/FoxMeadow.mp3';
                audio.src = song;
                audio.play();
            }
        }
        if(this.touching(this.player, "1song", "trigger")){
            if(song!=='sounds/PawprintMeadow.mp3'){
                song= 'sounds/PawprintMeadow.mp3';
                audio.src = song;
                audio.play();
            }
        }
        
        
	this.input.update();	
    }
    squishInsect(insectObj) {
        if (!insectObj || insectObj.userData.squished) return;

        insectObj.userData.squished = true;

        // spara originalskala
        insectObj.userData.originalScale = insectObj.scale.clone();

        insectObj.scale.set(
            insectObj.scale.x * 1.25,
            insectObj.scale.y * 0.18,
            insectObj.scale.z * 1.25
        );

        insectObj.userData.assetType.collision = "none";
           
        
    }
    openGate(gate) {
        if(gate.open===false){
            const action = gate.userData.actions?.["Animation 1"];
            if (!action) return;
            gate.userData.collisionOverride = "none";
            action.reset();
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            action.enabled = true;
            action.paused = false;
            action.setEffectiveWeight(1).play();
            gate.open=true;
            audio2("sounds/gate.mp3");
            
        }
    }
    
    
    removeMapObject(obj) {
        if (!obj) return;
        this.scene.remove(obj.mesh);
        this.mapObjects = this.mapObjects.filter(o => o !== obj.mesh);
    }
    
    
    draw() {
        this.renderer.render(this.scene, this.camera);
        this.lastRenderInfo = {
            calls: this.renderer.info.render.calls,
            triangles: this.renderer.info.render.triangles,
            frame: this.renderer.info.render.frame
        };
        this.drawUI();
    }

    buildRenderBatches() {
        this.renderBatcher?.build();
    }

    clearRenderBatches() {
        this.renderBatcher?.restore();
    }

    measureRenderBatching() {
        // Run `game.measureRenderBatching()` in DevTools after a map loads.
        this.clearRenderBatches();
        this.renderer.render(this.scene, this.camera);
        const before = this.renderer.info.render.calls;

        this.buildRenderBatches();
        this.renderer.render(this.scene, this.camera);
        const after = this.renderer.info.render.calls;
        const result = {
            beforeCalls: before,
            afterCalls: after,
            savedCalls: before - after,
            batches: this.renderBatcher.lastBatchCount,
            instances: this.renderBatcher.lastInstanceCount
        };
        console.table([result]);
        return result;
    }
    drawUI() {
        const w = this.canvas2d.width;
        const h = this.canvas2d.height;

        

        const jumpX = w * 0.78;
        const jumpY = h * 0.75;
        const jumpR = 48;
        if(mobileAndTabletCheck()){
            this.input.setJumpButton(jumpX, jumpY, jumpR);
            this.drawPaw(this.ctx, jumpX, jumpY, jumpR);
        }
        else this.ctx.clearRect(0, 0,this.canvas.width, this.canvas.height);
        this.ctx.fillStyle="black";
        this.ctx.font = "40px serif";
        if(mobileAndTabletCheck())this.ctx.font = "20px serif";
        this.ctx.fillText("Coins: " + this.coins, 10, 40);
        
        
    }
    drawPaw(ctx, x, y, size) {
        
        
        ctx.beginPath();
        ctx.arc(x, y-5, size*0.7, 0, 2 * Math.PI, false);
        
        var grd = ctx.createRadialGradient(x, y-5, 5, x, y-5, size * 2);
        grd.addColorStop(0, "#ff4a57");
        grd.addColorStop(1, "#9e0f1c");
        
        
        ctx.fillStyle = grd;
        ctx.fill();
        
        
        ctx.lineWidth = 1;
        //context.strokeStyle = externalStrokeColor;
        ctx.strokeStyle="white";
        ctx.stroke();
        
        
        
        ctx.save();
        ctx.translate(x, y);

        ctx.fillStyle = "rgba(255,255,255,0.9)";
        
        // Tår
        this.drawOval(ctx, -size * 0.38, -size * 0.12, size * 0.13, size * 0.18);
        this.drawOval(ctx, -size * 0.14, -size * 0.37, size * 0.13, size * 0.18);
        this.drawOval(ctx,  size * 0.14, -size * 0.37, size * 0.13, size * 0.18);
        this.drawOval(ctx,  size * 0.38, -size * 0.12, size * 0.13, size * 0.18);

        // Stor trampdyna, byggd av 3 ovala delar
        this.drawOval(ctx, -size * 0.13, size * 0.12, size * 0.21, size * 0.19, true);
        this.drawOval(ctx,  size * 0.13, size * 0.12, size * 0.21, size * 0.19, true);
        this.drawOval(ctx,  0,             size * 0.02, size * 0.26, size * 0.22, true);

        ctx.restore();
        
        
        
        
        
        
    }

    drawOval(ctx, x, y, rx, ry, big = false) {
        ctx.beginPath();

        if (big) {
            ctx.ellipse(x, y, rx * 0.95, ry * 0.9, 0, 0, Math.PI * 2);
        } else {
            ctx.ellipse(x, y - rx / 2, rx * 0.9, ry * 0.9, 0, 0, Math.PI * 2);
        }

        ctx.fill();
    }

    resize() {
        
    
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (this.canvas.width === w && this.canvas.height === h) {
            return false;
        }

        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas2d.width = w;
        this.canvas2d.height = h;

        this.renderer.setSize(w, h, false);

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();

        return true;
    }
    setupAnimation(){
        
        for (const obj of this.mapObjects) {
            const type = obj.userData.assetType;
            const id = (type?.id || "").toLowerCase();
            const name = (type?.name || "").toLowerCase();

            if(id.includes("coin") || name.includes("coin")){
                this.setupObjectAnimation(obj, "Animation 1", true);
            }
            else if(id.includes("gate") || name.includes("gate")){
                this.setupObjectAnimation(obj, "Animation 1", false);
                obj.open=false;
                this.gates.push(obj);
            }
            else if (obj.userData.animations?.length && !obj.userData.mixer) {
                // Some legacy exports depend on frame zero to establish a
                // valid pose. Keep that pose active for static animated props.
                this.setupObjectAnimation(obj, "Animation 1", false);
            }
            
        }
    }
    findsleepingbug(){
         for (const obj of this.mapObjects) {
            const type = obj.userData.assetType;
            const id = (type?.id || "").toLowerCase();
            const name = (type?.name || "").toLowerCase();

            if (id.includes("bug") || name.includes("bug")) {
                obj.userData.sleepingEffect = new SleepingZEffect(obj,this);
                this.insectObj=obj;
                
                
                break;
            }
            
        }
        
        
        
        
        
    }
    
    findPlayerCat() {
        // Försök hitta första objektet vars assetType id/name innehåller "cat"
        for (const obj of this.mapObjects) {
            const type = obj.userData.assetType;
            const id = (type?.id || "").toLowerCase();
            const name = (type?.name || "").toLowerCase();

            if (id.includes("cat") || name.includes("cat")) {
                this.player = obj;
                this.setupObjectAnimation(obj, "Animation 1", false);
                this.setupPlayerPhysicsBounds();
                this.cameraYaw = this.player.rotation.y || 0;
                this.playerData = obj.userData.mapObject;
                break;
            }
            
        }

        if (!this.player) {
            console.warn("No cat found in map.json. Creating fallback player.");
            this.createFallbackPlayer();
        }

        console.log("Player cat:", this.player);
    }

    createFallbackPlayer() {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffaa55 });
        const box = new THREE.Mesh(geo, mat);

        box.position.set(0, 0.5, 0);

        this.scene.add(box);

        this.player = box;
        this.playerData = null;
    }

    updatePlayer(scale) {
        if (!this.player) return;
        const input = this.input;

        let x = 0;
        let y = 0;

        // Digital joystick
        if (input.keys["w"] || input.keys["arrowup"]) y += 1;
        if (input.keys["s"] || input.keys["arrowdown"]) y -= 1;
        if (input.keys["a"] || input.keys["arrowleft"]) x -= 1;
        if (input.keys["d"] || input.keys["arrowright"]) x += 1;

        const isMoving = x !== 0 || y !== 0;

        if (isMoving) {
            this.setPlayerAnimation(true);
        } else {
       
            this.setPlayerAnimation(false);
            return;
        }

        // Normalisera så diagonal inte blir snabbare
        const inputVec = new THREE.Vector2(x, y);
        if (inputVec.lengthSq() > 1) {
            inputVec.normalize();
        }

        // Kamerans framåt/höger på markplanet
        const cameraForward = new THREE.Vector3();
        this.camera.getWorldDirection(cameraForward);
        cameraForward.y = 0;
        cameraForward.normalize();

        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();

        const move = new THREE.Vector3();
        move.addScaledVector(cameraRight, inputVec.x);
        move.addScaledVector(cameraForward, inputVec.y);

        if (move.lengthSq() <= 0) return;

        move.normalize();

        this.player.position.addScaledVector(
            move,
            this.moveSpeed * scale
        );

        // Rotera katten mot rörelseriktningen
        const targetYaw = Math.atan2(-move.x, -move.z);

        const turnSmooth = Math.min(1, 0.18 * scale);

        this.player.rotation.y = this.lerpAngle(
            this.player.rotation.y,
            targetYaw,
            turnSmooth
        );


    }
    updatePlayerFromJoystick(scale) {

        if (!this.player || !this.joy) return;

        this.joy.redraw();

        const v = this.joy.GetVector();
       
        if (v.power <= 0.1) {
            this.setPlayerAnimation(false);
            return;
        }
        this.setPlayerAnimation(true);
        const cameraForward = new THREE.Vector3();
        this.camera.getWorldDirection(cameraForward);
        cameraForward.y = 0;
        cameraForward.normalize();

        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();

        const move = new THREE.Vector3();

        move.addScaledVector(cameraRight, v.x);
        move.addScaledVector(cameraForward, v.y);

        if (move.lengthSq() <= 0) return;

        move.normalize();

        this.player.position.addScaledVector(
            move,
            this.moveSpeed * v.power * scale
        );

        // Räkna ut vilken riktning katten SKA titta åt
        const targetYaw = Math.atan2(-move.x, -move.z);

        // Rotera katten mjukt mot den riktningen
        const turnSmooth = Math.min(1, 0.05 * scale);
        this.player.rotation.y = this.lerpAngle(
            this.player.rotation.y,
            targetYaw,
            turnSmooth
        );
    }
    lerpAngle(a, b, t) {
        let diff = b - a;

        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        return a + diff * t;
    }
    updateCamera(scale) {
        if (!this.player) return;

        const target = this.player.position.clone();
        target.y += 1.0;

        // Kameran följer kattens riktning långsamt
        const camTurnSmooth = Math.min(1, 0.011 * scale);

        this.cameraYaw = this.lerpAngle(
            this.cameraYaw,
            this.player.rotation.y,
            camTurnSmooth
        );

        const offset = new THREE.Vector3(
            Math.sin(this.cameraYaw) * this.cameraDistance,
            this.cameraHeight,
            Math.cos(this.cameraYaw) * this.cameraDistance
        );

        const desiredPos = target.clone().add(offset);

        const followSmooth = Math.min(1, 0.12 * scale);
        this.camera.position.lerp(desiredPos, followSmooth);

        this.camera.lookAt(target);
    }
    setPlayerAnimation(isMoving) {
        const action = this.player?.userData.actions?.["Animation 1"];
        if (!action || this.playerAnimating === isMoving) return;

        this.playerAnimating = isMoving;
        if (isMoving) {
            action.enabled = true;
            action.paused = false;
            action.setEffectiveWeight(1).play();
        } else {
            // The exported cat has invalid transforms in its unanimated rest
            // pose. Keep its valid animation pose applied while idle instead
            // of fading the only action to zero influence.
            action.paused = true;
        }
    }
    setupObjectAnimation(obj, clipName = "Animation 1", autoPlay = true) {
        const animations = obj.userData.animations || [];

        if (!animations.length) return null;

        const mixer = new THREE.AnimationMixer(obj);

        const clip =
            THREE.AnimationClip.findByName(animations, clipName) ||
            animations[0];

        if (!clip) return null;

        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;

        if (autoPlay) {
            action.enabled = true;
            action.setEffectiveWeight(1).play();
        } else {
            // Sätt objektet i animationens startpose, men spela inte vidare
            action.reset();
            action.play();
            action.paused = true;
            action.time = 0;
            mixer.update(0);
        }

        obj.userData.mixer = mixer;
        obj.userData.actions = obj.userData.actions || {};
        obj.userData.actions[clipName] = action;

        this.mixers.push(mixer);
        this.animatedObjects.push(obj);

        return {
            mixer,
            action,
            clip
        };
    }
    
    playPlayerAction(name) {
        const next = this.playerActions[name];
        if (!next) return;

        if (this.currentPlayerAction === next) return;

        if (this.currentPlayerAction) {
            this.currentPlayerAction.fadeOut(0.15);
        }

        next.reset();
        next.fadeIn(0.15);
        next.play();

        this.currentPlayerAction = next;
    }
    jump() {
        if (!this.onGround) return;

        this.playerVelY = this.jumpPower;
        this.onGround = false;
    }
    setupPlayerPhysicsBounds() {
        if (!this.player) return;

        const box = this.worldSolver.getRealBox(this.player);

        this.playerBottomOffset = this.player.position.y - box.min.y;
        this.playerHeight = box.max.y - box.min.y;

   
    }
    touching(obj, type = "any", mode = "ghost", dir = "any") {
        const mapObj = obj.userData?.mapObject || obj;

        if (mode === "ghost") {
            return this.anyContact(mapObj.contactsGhost, type, dir);
        }

        if (mode === "solid") {
            return this.anyContact(mapObj.contactsSolid, type, dir);
        }

        if (mode === "dyn") {
            return this.anyContact(mapObj.contactsDyn, type, dir);
        }

        if (mode === "trigger") {
            return this.anyContact(mapObj.contactsTrigger, type, dir);
        }

        if (mode === "any") {
            return (
                this.anyContact(mapObj.contactsGhost, type, dir) ||
                this.anyContact(mapObj.contactsTrigger, type, dir) ||
                this.anyContact(mapObj.contactsSolid, type, dir) ||
                this.anyContact(mapObj.contactsDyn, type, dir)
            );
        }

        return null;
    }

    anyContact(group, type = "any", dir = "any") {
        if (!group) return null;

        dir = this.normalizeDir(dir);

        if (dir !== "any") {
            return this.matchContact(group[dir], type);
        }

        for (const key in group) {
            const hit = this.matchContact(group[key], type);
            if (hit) return hit;
        }

        return null;
    }

    matchContact(ref, name = "any") {
        if (!ref) return null;
        if (name === "any") return ref;
        return ref.name === name ? ref : null;
    }
    normalizeDir(dir) {
        if (dir === "top") return "up";
        if (dir === "bottom") return "down";
        if (dir === "forward") return "front";
        if (dir === "backward") return "back";
        return dir;
    }
}

// Render-only batching for repeated static GLB map props. Physics continues to
// traverse the original object trees, so collision/contact behaviour does not
// change. Dynamic objects are excluded and remain conventional Meshes.
class CatAdventureRenderBatcher {
    constructor(game) {
        this.game = game;
        this.root = new THREE.Group();
        this.root.name = "CatAdventure instanced render batches";
        this.root.userData.isRenderBatch = true;
        game.scene.add(this.root);
        this.hiddenSources = [];
        this.active = false;
        this.lastBatchCount = 0;
        this.lastInstanceCount = 0;
    }

    isStaticMapObject(root) {
        const type = root.userData.assetType;
        return root !== this.game.player &&
            root !== this.game.insectObj &&
            !root.userData.mixer &&
            !root.userData.sleepingEffect &&
            !root.userData.animations?.length &&
            !root.userData.isInvisibleBox &&
            !type?.disableInstancing;
    }

    meshKey(root, meshIndex, mesh) {
        const material = mesh.material;
        if (Array.isArray(material)) return null;
        const type = root.userData.assetType;
        if (!material || mesh.isSkinnedMesh || mesh.morphTargetInfluences) return null;
        // meshIndex scopes the batch to the same mesh slot within an identical
        // GLB. This avoids accidentally combining different parts of a model.
        return [type?.glb || type?.id, meshIndex, mesh.geometry?.uuid,
            material.type, material.map?.uuid || "", material.color?.getHex() || "",
            material.opacity, material.transparent, material.side,
            mesh.castShadow, mesh.receiveShadow].join("|");
    }

    build() {
        if (this.active) return;
        this.restore();
        this.game.scene.updateMatrixWorld(true);
        const groups = new Map();

        for (const mapObject of this.game.mapObjects) {
            if (!this.isStaticMapObject(mapObject)) continue;
            let meshIndex = 0;
            mapObject.traverse(mesh => {
                if (!mesh.isMesh) return;
                const key = mesh.visible
                    ? this.meshKey(mapObject, meshIndex, mesh)
                    : null;
                meshIndex++;
                if (!key) return;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(mesh);
            });
        }

        let batches = 0, instances = 0;
        for (const meshes of groups.values()) {
            if (meshes.length < 2) continue;
            const first = meshes[0];
            const proxy = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
            proxy.name = "Instanced map prop";
            proxy.castShadow = first.castShadow;
            proxy.receiveShadow = first.receiveShadow;
            proxy.userData.isRenderBatch = true;
            meshes.forEach((mesh, index) => {
                proxy.setMatrixAt(index, mesh.matrixWorld);
                this.hiddenSources.push({ mesh, visible: mesh.visible });
                mesh.visible = false;
            });
            proxy.instanceMatrix.needsUpdate = true;
            proxy.computeBoundingBox();
            proxy.computeBoundingSphere();
            this.root.add(proxy);
            batches++;
            instances += meshes.length;
        }
        this.active = batches > 0;
        this.lastBatchCount = batches;
        this.lastInstanceCount = instances;
    }

    restore() {
        for (const entry of this.hiddenSources) entry.mesh.visible = entry.visible;
        this.hiddenSources = [];
        for (const proxy of [...this.root.children]) {
            this.root.remove(proxy);
            proxy.dispose?.();
        }
        this.active = false;
    }
}

// Render-only meadow grass.  A single instanced mesh holds two crossed cards
// per clump, keeping it cheap enough to populate the whole playable map.
class CatAdventureGrass {
    constructor(game) {
        this.game = game;
        this.root = new THREE.Group();
        this.root.name = "Meadow grass";
        this.candidates = [];
        this.lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
        this.refreshTimer = 0;
        this.nearDistance = 20000;
        this.farDistance = 56000;
        this.maxVisible = 1800000;
        this.dummy = new THREE.Object3D();
        this.texture = new THREE.TextureLoader().load("assets/grass-tuft.png");
        // Match the legacy terrain/GLB texture treatment in this project.
        this.texture.colorSpace = THREE.NoColorSpace;
    }

    build() {
        const exclusions = this.getExclusionOBBs();
        const bounds = this.getMapBounds();
        const geometry = this.createCrossedBladeGeometry();
        const material = this.createMaterial();
        this.mesh = new THREE.InstancedMesh(geometry, material, this.maxVisible);
        this.mesh.name = "Distance faded crossed-billboard grass";
        this.mesh.frustumCulled = false;
        this.root.add(this.mesh);
        this.game.scene.add(this.root);

        // A stable jittered grid gives natural scatter without popping as the
        // player moves.  OBB rejection happens once, after every GLB is loaded.
        const spacing = 0.9;
        for (let z = bounds.minZ; z <= bounds.maxZ; z += spacing) {
            for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
                const hash = this.hash2(x, z);
                if (hash > 0.70) continue;
                const px = x + (this.hash2(x + 19.1, z) - 0.5) * spacing * 0.8;
                const pz = z + (this.hash2(x, z + 47.3) - 0.5) * spacing * 0.8;
                if (exclusions.some(zone => this.pointInOBB(px, pz, zone))) continue;
                this.candidates.push({
                    x: px,
                    z: pz,
                    // Used both for natural variation and distance thinning.
                    seed: this.hash2(x + 83.7, z + 11.4),
                    scale: 0.55 + this.hash2(x + 5.8, z + 3.2) * 0.65,
                    rotation: this.hash2(x + 9.4, z + 61.9) * Math.PI
                });
            }
        }
        this.updateVisible(true);
    }

    getExclusionOBBs() {
        return this.game.mapObjects
            .filter(obj => /^(path|water)$/i.test(obj.userData.assetType?.name || obj.userData.mapObject?.name || ""))
            .map(obj => {
                const box = this.game.worldSolver.getLocalBox(obj);
                if (!box) return null;
                obj.updateWorldMatrix(true, true);
                return { inverse: obj.matrixWorld.clone().invert(), box };
            })
            .filter(Boolean);
    }

    pointInOBB(x, z, zone) {
        // Transforming the sample into object-local space is an OBB point test.
        const point = new THREE.Vector3(x, 0, z).applyMatrix4(zone.inverse);
        const pad = 0.32;
        return point.x >= zone.box.min.x - pad && point.x <= zone.box.max.x + pad &&
            point.z >= zone.box.min.z - pad && point.z <= zone.box.max.z + pad;
    }

    getMapBounds() {
        const meaningful = this.game.mapObjects.filter(obj => !obj.userData.isInvisibleBox);
        const box = new THREE.Box3();
        for (const obj of meaningful) box.expandByObject(obj);
        // The fallback also makes an empty/new map look intentional.
        if (box.isEmpty()) return { minX: -70, maxX: 70, minZ: -70, maxZ: 70 };
        const padding = 18;
        return {
            minX: Math.max(-195, box.min.x - padding), maxX: Math.min(195, box.max.x + padding),
            minZ: Math.max(-195, box.min.z - padding), maxZ: Math.min(195, box.max.z + padding)
        };
    }

    createCrossedBladeGeometry() {
        // Two perpendicular UV-mapped cards. Texture alpha supplies the
        // organic silhouette, so the clump remains readable from every side.
        const positions = [];
        const uvs = [];
        const indices = [];
        const addCard = (angle) => {
            const start = positions.length / 3;
            const dx = Math.cos(angle) * 1.32, dz = Math.sin(angle) * 1.32;
            const verts = [
                -dx, 0, -dz, dx, 0, dz,
                dx, 1.0, dz, -dx, 1.0, -dz
            ];
            positions.push(...verts);
            uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
            indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        };
        addCard(0); addCard(Math.PI * 0.5);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    createMaterial() {
        // Start from Three's stock material so instanced transforms and
        // instance colours use its tested shader chunks.  We only add the
        // distance fade, avoiding a fragile fully custom instancing shader.
        const material = new THREE.MeshStandardMaterial({
          //  color: 0x3d8a2f,
            roughness: 1,
            map: this.texture,
            alphaTest: 0,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        material.onBeforeCompile = shader => {
            shader.uniforms.grassCameraXZ = { value: new THREE.Vector2() };
            shader.uniforms.grassFadeNear = { value: this.nearDistance };
            shader.uniforms.grassFadeFar = { value: this.farDistance };
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", `#include <common>
                    uniform vec2 grassCameraXZ;
                    uniform float grassFadeNear;
                    uniform float grassFadeFar;
                    varying float grassFade;`)
                .replace("#include <begin_vertex>", `#include <begin_vertex>
                    vec3 grassWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
                    grassFade = 1.0 - smoothstep(grassFadeNear, grassFadeFar,
                        distance(grassWorldPosition.xz, grassCameraXZ));`);
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", `#include <common>
                    varying float grassFade;`)
                .replace("#include <color_fragment>", `#include <color_fragment>
                    if (grassFade < 0.015) discard;
                    diffuseColor.a *= grassFade * 0.92;`);
            material.userData.grassShader = shader;
        };
        return material;
    }

    update(deltaSeconds) {
        if (!this.mesh || !this.game.camera) return;
        this.mesh.material.userData.grassShader?.uniforms.grassCameraXZ.value
            .set(this.game.camera.position.x, this.game.camera.position.z);
        this.refreshTimer += deltaSeconds;
        if (this.refreshTimer < 0.20 && this.lastCamera.distanceToSquared(this.game.camera.position) < 9) return;
        this.refreshTimer = 0;
        this.updateVisible(false);
    }

    updateVisible(force) {
        const camera = this.game.camera.position;
        if (!force && this.lastCamera.distanceToSquared(camera) < 9) return;
        this.lastCamera.copy(camera);
        let count = 0;
        const farSq = this.farDistance * this.farDistance;
        for (const grass of this.candidates) {
            const dx = grass.x - camera.x, dz = grass.z - camera.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq > farSq) continue;
            const distance = Math.sqrt(distanceSq);
            // Full density nearby, increasingly sparse farther out.  The
            // shader still fades the final surviving clumps smoothly.
            const density = 1 - Math.max(0, distance - this.nearDistance) / (this.farDistance - this.nearDistance);
            if (grass.seed > density || count === this.maxVisible) continue;
            this.dummy.position.set(grass.x, 0.012, grass.z);
            this.dummy.rotation.set(0, grass.rotation, 0);
            this.dummy.scale.setScalar(grass.scale);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(count, this.dummy.matrix);
            const shade = 0.78 + grass.seed * 0.22;
            this.mesh.setColorAt(count, new THREE.Color(0.21 * shade, 0.52 * shade, 0.12 * shade));
            count++;
        }
        this.mesh.count = count;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    hash2(x, z) {
        const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
        return value - Math.floor(value);
    }
}
