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
