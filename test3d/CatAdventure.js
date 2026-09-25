
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
        // Small details use cheap painted-on contact shadows. They are drawn
        // in only two instanced batches instead of rendering into the sun's
        // shadow map once per mesh.
        this.fakeShadowConfig = {
            enabled: true,
            opacity: 0.25,
            verticalOffset: 0.018,
            padding: 0.18,
            minSize: 0.32,
            staticTypes: new Set(["gras", "grass", "flower", "rock", "stump", "barrel", "crate", "logs", "sack"]),
            dynamicTypes: new Set(["cat", "fox", "bug", "spider", "coin"]),
            // Animated models often include tails, ears, or wide animation
            // bounds. Their contact shadows should be intentionally smaller.
            footprints: {
                cat: { width: 0.62, depth: 0.95 },
                fox: { width: 0.88, depth: 2.95 },
                bug: { width: 0.52, depth: 1.36 },
                spider: { width: 0.52, depth: 1.36 },
                coin: { width: 0.36, depth: 0.36 }
            }
        };
        this.fakeShadows = null;
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
        this.playerVelX = 0;
        this.playerVelZ = 0;
        this.onGround = false;

        this.gravity = -0.010;
        this.jumpPower = 0.22;
        this.playerRadius = 0.35;
        this.groundSnapDistance = 0.25;
        this.worldSolver = new WorldSolver(this);
        this.playerBottomOffset = 0;
        this.basePlayerBottomOffset = 0;
        this.waterSink = 0;
        this.coins=0;
        this.maxHealth = 3;
        this.health = this.maxHealth;
        this.healthInvulnerability = 0;
        this.healthFlash = 0;
        this.deathSequence = null;
        this.playerSpawn = null;
        this.heartDrops = [];
        this.foxMeadowCinematicPlayed = false;
        this.cinematic = null;
        
        this.gates=[];
        this.clouds = [];
        
        this.insectObj=null;
        this.bugAI = [];
        this.foxPatrol = null;
        this.foxQuest = {
            state: "unseen", // unseen, speaking, choice, deferred, active, readyToComplete, completing, completed
            tracksFound: 0,
            requiredTracks: 3,
            dialog: null,
            optionBounds: [],
            token: 0,
            announcement: 0,
            completionTimer: 0,
            sparkleTexture: null,
            sparkles: []
        };
        this.spiderQuest = {
            state: "unseen", // unseen, active, completing, completed
            squished: 0,
            required: 10,
            announcement: 0,
            token: 0
        };
        
        this.texture2 = new THREE.TextureLoader().load("grasyfield.png");
        this.texture2.wrapS = THREE.RepeatWrapping;
        this.texture2.wrapT = THREE.RepeatWrapping;
        this.texture2.repeat.set(64,64);
        this.texture2.colorSpace = THREE.NoColorSpace;

        


        this.wallNormalMap = null;


        this.skyCanvas = document.createElement("canvas");
        this.skyCanvas.width = 512;
        this.skyCanvas.height = 512;
        this.skyContext = this.skyCanvas.getContext("2d");
        this.skyGradient = this.skyContext.createLinearGradient(0, 0, 0, this.skyCanvas.height);
        this.skyGradient.addColorStop(0, "#c5ddf8");
        this.skyGradient.addColorStop(0.20, "#c8c8fa");
        this.skyGradient.addColorStop(0.45, "#d2b7b0");
        this.skyGradient.addColorStop(0.60, "#f8e49c");
        this.skyGradient.addColorStop(1, "#e3c8a3");
        this.skyContext.fillStyle = this.skyGradient;
        this.skyContext.save();
        this.skyContext.rotate(-10 * Math.PI / 180);
        this.skyContext.fillRect(-this.skyCanvas.width*0.2, 0, this.skyCanvas.width*1.2, this.skyCanvas.height);
        this.skyContext.restore();
        this.skyTexture = new THREE.CanvasTexture(this.skyCanvas);
        this.skyTexture.colorSpace = THREE.SRGBColorSpace;
        this.skyTexture.needsUpdate = true;

        this.fpsFrames = 0;
        this.fpsTime = performance.now();
        this.fps=0;

    }

    async start(mapUrl = "map.json") {
        this.setLoadingMessage("Loading the meadow…");
        this.initThree();

        await this.mapLoader.load(mapUrl);
        this.setLoadingMessage("Setting out the adventure…");
        this.configureMapShadows();
        this.configureWallNormalMaps();
        
        this.findsleepingbug();
        this.findPlayerCat();
        this.setupAnimation();
        this.setupBugAI();
        this.setupFoxPatrol();
        this.grass = new CatAdventureGrass(this);
        this.grass.build();
        this.pathEdgeFlowers = new CatAdventurePathEdgeFlowers(this);
        this.pathEdgeFlowers.build();
        this.water = new CatAdventureWater(this);
        this.water.build();
        this.dryField = new CatAdventureDryField(this);
        this.dryField.build();
        this.treeWind = new CatAdventureTreeWind(this);
        this.treeWind.build();
        this.dryGrassWind = new CatAdventureDryGrassWind(this);
        this.dryGrassWind.build();
        this.fakeShadows = new CatAdventureFakeShadows(this);
        this.fakeShadows.build();
        this.buildRenderBatches();
        this.addBackgroundFadeGLB();
        
        
        window.addEventListener("resize", () => this.resize());
        this.resize();

        requestAnimationFrame((t) => this.gameLoop(t));
    }

    setLoadingMessage(message) {
        const label = document.getElementById("loadingMessage");
        if (label) label.textContent = message;
    }

    hideLoadingScreen() {
        if (this.loadingScreenHidden) return;
        this.loadingScreenHidden = true;
        document.getElementById("loadingScreen")?.classList.add("is-ready");
    }

    initThree() {
        this.scene = new THREE.Scene();


        
        
        this.scene.background = this.skyTexture;

        this.scene.fog = new THREE.Fog(new THREE.Color(0xcfcffa), 52, 175);
         //color="#e3c8a3";

        

















        this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true
        });

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.08;
        this.renderer.setPixelRatio(1);

        this.createSunsetSky();

        // ============================
        // SUN
        // ============================

        this.sun = new THREE.DirectionalLight(0xF1CD6C, 4.0);

        this.sun.castShadow = true;

        // 2048 räcker bra om shadow-området är mindre
        this.sun.shadow.mapSize.set(2048, 2048);

        // Mycket mindre än tidigare ±100.
        // Detta ger betydligt högre faktisk shadow-resolution.
        this.shadowExtent = 40;

        this.sun.shadow.camera.left   = -this.shadowExtent;
        this.sun.shadow.camera.right  =  this.shadowExtent;
        this.sun.shadow.camera.top    =  this.shadowExtent;
        this.sun.shadow.camera.bottom = -this.shadowExtent;

        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 250;

        // Hjälper mot acne / fula polygonkanter
        this.sun.shadow.bias = -0.0001;
        this.sun.shadow.normalBias = 0.02;

        // Behåll samma ungefärliga solriktning som tidigare
        this.sunOffset = new THREE.Vector3(
            -60,
            60,
            -100
        );

        this.sun.target.position.set(0, 0, 0);
        this.sun.position.copy(this.sunOffset);

        this.scene.add(this.sun);
        this.scene.add(this.sun.target);


        // ============================
        // AMBIENT
        // ============================
        this.scene.add(new THREE.HemisphereLight(0xdcc8ee, 0xF1CD6C, 2.5));
      //  this.scene.add(new THREE.AmbientLight(0xffead5, 2.15));


        // ============================
        // GROUND
        // ============================

        const groundGeo = new THREE.PlaneGeometry(400, 400,1,1);

        const groundMat = new THREE.MeshStandardMaterial({
            map: this.texture2,
            color: new THREE.Color(0xefffff),
   
        });
        groundMat.roughness = 5;
        groundMat.metalness = 0.0;
        this.addBackgroundFadeToMaterial(groundMat, this.skyTexture);




        this.ground = new THREE.Mesh(
            groundGeo,
            groundMat
        );

        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
       // this.ground.material.map.colorSpace = THREE.SRGBColorSpace;
        

        this.scene.add(this.ground);


        this.renderBatcher = new CatAdventureRenderBatcher(this);




    }
    debugPerformance() {
        this.fpsFrames++;
        
        const now = performance.now();

        if (now - this.fpsTime >= 1000) {
            this.fps = Math.round(
                this.fpsFrames * 1000 / (now - this.fpsTime)
            );     
            this.fpsFrames = 0;
            this.fpsTime = now;
        }
        this.ctx.fillStyle = "#000000";
        let extra=0;
        this.ctx.font = "10px Arial";    
        if(!mobileAndTabletCheck()){extra=35;this.ctx.font = "15px Arial";}

          
        this.ctx.fillText("FPS:" + this.fps, 10, 105+extra);
        this.ctx.fillText("calls:" + this.renderer.info.render.calls, 10, 115+extra);
        this.ctx.fillText("tris:" + this.renderer.info.render.triangles, 10, 125+extra);
        this.ctx.fillText("geometries:"+ this.renderer.info.memory.geometries, 10, 135+extra);
        this.ctx.fillText("textures:"+ this.renderer.info.memory.textures, 10, 145+extra);   

    }

    configureEditorMaterial(obj, type) {
        // Alpha-blended crossed planes cannot be depth-sorted per instance.
        // A cutout gives the batch a stable depth order.  The small emissive
        // fill keeps the reverse side of each crossed blade from turning much
        // darker than its sun-facing side in the editor preview.
        const typeId = type?.id || type?.name || "";



        if (!/^(gras-tuftdry)$/i.test(typeId)) return;

        obj.traverse(mesh => {
            if (!mesh.isMesh) return;

            const oldMaterials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];

            mesh.material = oldMaterials.map(old => {
                const mat = new THREE.MeshStandardMaterial({
                    map: old.map,
                    color: old.color,
                    alphaMap: old.alphaMap,
                    alphaTest: 0.5,
                    transparent: false,
                    side: THREE.DoubleSide,
                    depthWrite: true
                });

                return mat;
            });

            if (mesh.material.length === 1) {
                mesh.material = mesh.material[0];
            }
            mesh.material.needsUpdate = true;
        });
    }
    addBackgroundFadeGLB(){


        for (const object of this.mapObjects) {
            object.traverse(mesh => {
                if (!mesh.isMesh) return;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const material of materials) {
                    // Keep authored normal maps if a later wall asset ships one.
                    if (!material ) continue;
                    this.addBackgroundFadeToMaterial(material,this.skyTexture);
                    material.needsUpdate = true;

                }
            });
        }



    }


    addBackgroundFadeToMaterial(material,backgroundTexture) {
        if (!material) return null;
        if (material.userData.backgroundFadeAdded) {
            return material.userData.backgroundFadeUniforms;
        }

        const uniforms = {
        uBackgroundTexture: { value: backgroundTexture },
        };
        const previousOnBeforeCompile = material.onBeforeCompile;
        // Capture this before replacing the hook. Three's default cache key is
        // based on onBeforeCompile, so retaining the old key prevents a tree,
        // dry-grass, or billboard-grass shader from sharing the wrong program.
        const previousProgramKey = material.customProgramCacheKey?.() || "";

        material.onBeforeCompile = (shader, renderer) => {
        previousOnBeforeCompile?.call(material, shader, renderer);
        shader.uniforms.uBackgroundTexture = uniforms.uBackgroundTexture;

        shader.vertexShader = shader.vertexShader.replace(
        `#include <common>`,
        `#include <common>
        varying vec4 vClipPosition;
        `
        );

        shader.vertexShader = shader.vertexShader.replace(
        `#include <fog_vertex>`,
        `#include <fog_vertex>
        vClipPosition = gl_Position;
        `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
        `#include <clipping_planes_pars_fragment>`,
        `#include <clipping_planes_pars_fragment>
        uniform sampler2D uBackgroundTexture;
        varying vec4 vClipPosition;
        `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
        `#include <fog_fragment>`,
        /*glsl*/ `
        #ifdef USE_FOG
            #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
            #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
            #endif
            vec2 vCoords = vClipPosition.xy / vClipPosition.w; // NDC coordinates
            vCoords = vCoords * 0.5 + 0.5; // Convert to UV coordinates
            vec3 bgColor = texture2D(uBackgroundTexture, vCoords).rgb;
            gl_FragColor.rgb = mix( gl_FragColor.rgb, bgColor, fogFactor );
        #endif 
        `
        );
        };

        material.customProgramCacheKey = () => `${previousProgramKey}|background-fade-v1`;
        material.userData.backgroundFadeAdded = true;
        material.userData.backgroundFadeUniforms = uniforms;
        material.needsUpdate = true;

    return uniforms;
    }
    createSunsetSky() {


        // Clouds live in world space, separate from the camera-following dome.
        // They therefore stay above the meadow while the player/camera moves.
        this.cloudRoot = new THREE.Group();
        this.scene.add(this.cloudRoot);

        // Each cloud is a few low-detail icosahedrons.  This is deliberately
        // geometry, not a cloud.glb: it is easy to reposition, recolour and
        // costs only a handful of meshes.
        const cloudMaterial = new THREE.MeshStandardMaterial({
            color: 0xf7dcc1,
            emissive: 0xffe0c8,
            emissiveIntensity: 0.7,
            roughness: 1,
            flatShading: true,
            fog: false
        });

        const cloudShape = new THREE.IcosahedronGeometry(1, 1);

        const makeCloud = (position, scale = 1) => {

            const cloud = new THREE.Group();

            const puffs = [
                // x,    y,     z,    sx,   sy
                [-2.0, -0.10,  0.0,  1.5, 0.65],
                [-1.1,  0.15,  0.0,  1.7, 0.85],
                [ 0.0,  0.35, -0.1,  2.0, 1.00],
                [ 1.1,  0.15,  0.0,  1.7, 0.82],
                [ 2.0, -0.08,  0.0,  1.35, 0.62],

                // bottom filler
                [-0.8, -0.35, 0.1, 1.55, 0.55],
                [ 0.6, -0.32, 0.1, 1.65, 0.55]
            ];

            puffs.forEach(([x, y, z, sx, sy], i) => {

                const puff = new THREE.Mesh(
                    cloudShape,
                    cloudMaterial
                );

                puff.position.set(x, y, z);

                puff.scale.set(
                    sx,
                    sy,
                    0.65
                );

                // Tiny irregularity only
                puff.rotation.z =
                    (i % 2 === 0 ? 1 : -1) * 0.08;

                cloud.add(puff);
            });

            cloud.position.fromArray(position);
            cloud.scale.setScalar(scale);

            this.cloudRoot.add(cloud);

            return cloud;
        };

        // Fixed meadow coordinates. The first three sit on the authored
        // flyby route (193, 30, -162 -> 36, 4, -16), so they remain visible
        // during the Fox Meadow establishing shot without following it.
        this.clouds.push(makeCloud([78, 32, -0], 6.2));
        this.clouds.push(makeCloud([78, 34, -150], 4.8));
        this.clouds.push(makeCloud([-42, 35, -18], 4.4));
        this.clouds.push(makeCloud([-34, 38, -150], 4.2));
        this.clouds.push(makeCloud([12, 48, -70], 4.5));
        this.scene.add(this.skyRoot);
    }

    updateSky() {
        for (const cloud of this.clouds) {

            const dx =
                this.camera.position.x - cloud.position.x;

            const dz =
                this.camera.position.z - cloud.position.z;

            cloud.rotation.y =
                Math.atan2(dx, dz);
        }
    }
    updateSunShadow(position) {

        const mapSize = this.sun.shadow.mapSize.x;

        // Storleken på en enda shadow-map-pixel i världen
        const texelSize =
            (this.shadowExtent * 2) / mapSize;


        // Snap till shadow-mapens texel-grid.
        // Hindrar shadow-map från att glida lite varje frame.
        const x =
            Math.round(position.x / texelSize) * texelSize;

        const z =
            Math.round(position.z / texelSize) * texelSize;


        this.sun.target.position.set(
            x,
            0,
            z
        );

        this.sun.position.set(
            x + this.sunOffset.x,
            this.sunOffset.y,
            z + this.sunOffset.z
        );


        this.sun.target.updateMatrixWorld();
    }



    configureMapShadows() {
        for (const object of this.mapObjects) {
            const type = object.userData.assetType || {};
            const name = type.name || type.id || "";
            const typeId = String(type.id || type.name || "").toLowerCase();
            const glb = String(type.glb || "").toLowerCase();
            const usesFakeShadow = this.fakeShadowConfig?.enabled &&
                (this.fakeShadowConfig.staticTypes.has(typeId) || this.fakeShadowConfig.dynamicTypes.has(typeId));
            const noShadowSurface = /^(path|water|tracks)$/i.test(name) ||
                /(?:^|\/)(?:path|tracks)\.glb$/i.test(glb);
            const usesShadows = type.castShadow !== false && !usesFakeShadow && !noShadowSurface;
            const usesShadows2 = !noShadowSurface;
            object.traverse(mesh => {
                if (!mesh.isMesh) return;
                // Paths and water should neither darken nearby scenery nor
                // have other objects' shadows projected onto their surfaces.
                mesh.castShadow = usesShadows;
                mesh.receiveShadow = usesShadows2;
            });
        }
    }

    configureWallNormalMaps() {
        // One small texture is shared by every wall material. It adds a single
        // normal-map sample per wall fragment, without multiplying texture
        // memory by the number of wall instances.
        if (!this.wallNormalMap) {
            this.wallNormalMap = new THREE.TextureLoader().load("assets/wall-normal.png");
            this.wallNormalMap.colorSpace = THREE.NoColorSpace;
            this.wallNormalMap.anisotropy = 1;
        }

        for (const object of this.mapObjects) {
            const type = object.userData.assetType || {};
            const isWall = /wall\.glb$/i.test(type.glb || "") ||
                /^wall$/i.test(type.id || "") || /^wall$/i.test(type.name || "");
            const isHill = /hill\.glb$/i.test(type.glb || "") ||
                /^hill$/i.test(type.id || "") || /^hill$/i.test(type.name || "");
            const isrock = /rock\.glb$/i.test(type.glb || "") ||
                /^rock$/i.test(type.id || "") || /^rock$/i.test(type.name || "");


            if (!isWall && !isHill && !isrock) continue;

            object.traverse(mesh => {
                if (!mesh.isMesh) return;

    

                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const material of materials) {
                    // Keep authored normal maps if a later wall asset ships one.
                    if (!material || material.normalMap) continue;
                    material.normalMap = this.wallNormalMap;
                    material.normalScale.set(1,1);
                    material.needsUpdate = true;
                    
                }

                

            });



        }





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
        // Keep the overlay up until a completed frame exists on the canvas.
        this.hideLoadingScreen();
        
        


        requestAnimationFrame((t) => this.gameLoop(t));
    }

    update(scale,deltaSeconds) {
        if (this.deathSequence) {
            this.updateDeathSequence(deltaSeconds);
            this.input.update();
            return;
        }
        this.updatePlayerHealth(deltaSeconds);
        this.updateSunShadow(this.player.position);
        const controlsLocked = this.isCinematicActive() || this.isFoxDialogActive();
        

        this.restoreWaterSinkOffset();
        this.worldSolver.beginFrame();
        this.worldSolver.updatePlayerY(this.player, scale);
        this.updatePlayerKnockback(scale);
        this.worldSolver.resolveHorizontal(this.player);
        this.worldSolver.checkGhostAndTriggerContacts(this.player);
        this.updateWaterSink(deltaSeconds);
        if (!controlsLocked) {
            if(mobileAndTabletCheck())this.updatePlayerFromJoystick(scale);
            else this.updatePlayer(scale);
        } else {
            this.setPlayerAnimation(false);
        }
        this.applyWaterSinkOffset();
        
        
        if (controlsLocked) this.updateCinematic(deltaSeconds);
        else this.updateCamera(scale);
        this.updateSky();
        this.updateFoxPatrol(deltaSeconds);
        this.updateFoxQuest(deltaSeconds);
        this.updateSpiderQuest(deltaSeconds);
        this.updateBugAI(deltaSeconds);
        this.updateHeartDrops(deltaSeconds);
        this.grass?.update(deltaSeconds);
        this.water?.update(deltaSeconds);
        this.treeWind?.update(deltaSeconds);
        this.dryGrassWind?.update(deltaSeconds);
        for (const mixer of this.mixers) {
            mixer.update(deltaSeconds);
        }
        this.fakeShadows?.update();
        if (this.insectObj?.userData.sleepingEffect) {
   
            this.insectObj.userData.sleepingEffect.update(deltaSeconds);

            
        }
        
        
        const e=this.touching(this.player, "bug", "solid", "down");
        if (e) {
            this.squishInsect(e.mesh);
             audio2("sounds/splash.mp3");
        }
        
	
	
        if (!controlsLocked && this.input.isJumpJustPressed()) {

            this.jump();
    
        }
        const c=this.touching(this.player, "coin", "ghost");
        if(c){
            this.removeMapObject(c);
            this.coins++;
            audio2("sounds/coin.mp3");
            
        }
        if(this.coins>8)this.openGate(this.gates[0]);
        
        const song2Trigger = this.touching(this.player, "2song", "trigger") ||
            this.getOverlappingNamedTrigger("2song");
        if(song2Trigger){
            if(song!=='sounds/FoxMeadow.mp3'){
                song= 'sounds/FoxMeadow.mp3';
                audio.src = song;
                audio.play();
            }
            if (!this.foxMeadowCinematicPlayed) {
                this.startFoxMeadowCinematic(song2Trigger);
            }
        }
        if(this.touching(this.player, "1song", "trigger")){
            if(song!=='sounds/PawprintMeadow.mp3'){
                song= 'sounds/PawprintMeadow.mp3';
                audio.src = song;
                audio.play();
            }
        }
        this.handleFoxDialogInput();
        
        
	this.input.update();	
    }
    squishInsect(insectObj) {
        if (!insectObj || insectObj.userData.squished) return;

        insectObj.userData.squished = true;
        insectObj.userData.hadCollisionOverride = Object.hasOwn(insectObj.userData, "collisionOverride");
        insectObj.userData.preSquishCollisionOverride = insectObj.userData.collisionOverride;
  
        insectObj.userData.actions?.["Animation 1"].stop();
        insectObj.userData.bugAI?.attackAction?.stop();
        // spara originalskala
        insectObj.userData.originalScale = insectObj.scale.clone();

        insectObj.scale.set(
            insectObj.scale.x * 1.25,
            insectObj.scale.y * 0.18,
            insectObj.scale.z * 1.25
        );

        insectObj.userData.collisionOverride = "none";
        this.registerSpiderSquish(insectObj);
        this.fakeShadows?.update();
        this.tryDropHeart(insectObj);
           
        
    }

    tryDropHeart(insectObj) {
        const id = insectObj.userData.mapObject?.id || insectObj.uuid;
        let hash = 2166136261;
        for (let index = 0; index < id.length; index++) {
            hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
        }

        if(Math.floor(Math.random() * 10) > 3)return;

        const shape = new THREE.Shape();
        shape.moveTo(0, -0.62);
        shape.bezierCurveTo(-0.98, -0.08, -0.88, 0.62, -0.38, 0.66);
        shape.bezierCurveTo(-0.12, 0.68, -0.02, 0.48, 0, 0.31);
        shape.bezierCurveTo(0.02, 0.48, 0.12, 0.68, 0.38, 0.66);
        shape.bezierCurveTo(0.88, 0.62, 0.98, -0.08, 0, -0.62);

        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: 0.16,
            bevelEnabled: true,
            bevelSegments: 1,
            bevelSize: 0.035,
            bevelThickness: 0.035,
            curveSegments: 5
        });
        geometry.center();
        const material = new THREE.MeshStandardMaterial({
            color: 0xf05c68,
            emissive: 0x6b1725,
            emissiveIntensity: 0.65,
            roughness: 0.45,
            metalness: 0.05
        });
        const heart = new THREE.Mesh(geometry, material);
        insectObj.getWorldPosition(heart.position);
        heart.position.y += 0.48;
        heart.scale.setScalar(0.34);
        heart.castShadow = true;
        heart.receiveShadow = true;
        heart.name = "Bug health heart";
        this.scene.add(heart);
        this.heartDrops.push({
            heart,
            baseY: heart.position.y,
            phase: (hash >>> 8) * 0.01,
            age: 0,
            pickupDelay: 0.7
        });
    }

    updateHeartDrops(deltaSeconds) {
        if (!this.player || !this.heartDrops.length) return;
        for (const drop of [...this.heartDrops]) {
            const heart = drop.heart;
            drop.age += deltaSeconds;
            const time = performance.now() * 0.001 + drop.phase;
            heart.position.y = drop.baseY + Math.sin(time * 2.2) * 0.065;
            heart.rotation.y += deltaSeconds * 1.8;
            const popIn = Math.min(1, drop.age / 0.22);
            heart.scale.setScalar(0.34 * (0.72 + (1 - Math.pow(1 - popIn, 3)) * 0.28));

            const dx = heart.position.x - this.player.position.x;
            const dz = heart.position.z - this.player.position.z;
            if (drop.age < drop.pickupDelay ||
                dx * dx + dz * dz > 0.8 * 0.8 || this.health >= this.maxHealth) continue;

            this.health = Math.min(this.maxHealth, this.health + 1);
            this.healthFlash = 0.35;
            this.removeHeartDrop(drop);
        }
    }

    removeHeartDrop(drop) {
        this.scene.remove(drop.heart);
        drop.heart.geometry.dispose();
        drop.heart.material.dispose();
        this.heartDrops = this.heartDrops.filter(entry => entry !== drop);
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
        const mesh = obj.mesh || obj;
        const rebuildBatches = this.renderBatcher?.active;
        if (rebuildBatches) this.clearRenderBatches();
        this.scene.remove(mesh);
        this.mapObjects = this.mapObjects.filter(mapObject => mapObject !== mesh);
        this.fakeShadows?.update();
        if (rebuildBatches) this.buildRenderBatches();
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
        const mobile = mobileAndTabletCheck();
        const cinematicActive = this.isCinematicActive();
        const dialogActive = this.isFoxDialogActive();
        const uiLocked = cinematicActive || dialogActive || !!this.deathSequence;
        // On mobile joy.redraw() already clears this shared canvas just before
        // drawUI(). Clearing again here would erase the joystick.
        if (!mobile || uiLocked) this.ctx.clearRect(0, 0, w, h);

        const jumpX = w * 0.78;
        const jumpY = h * 0.75;
        const jumpR = 48;
        if(mobile && !uiLocked){
            this.input.setJumpButton(jumpX, jumpY, jumpR);
            this.drawPaw(this.ctx, jumpX, jumpY, jumpR);
        }
        this.drawCoinCounter(this.ctx);
        this.drawHealthUI(this.ctx);
        this.drawCinematicTitle(this.ctx, w, h);
        this.drawQuestAnnouncement(this.ctx, w, h);
        const mobileInset = mobile ? 0 : 6;
        let nextQuestY = mobileInset;
        nextQuestY = this.drawFoxQuestUI(this.ctx, w, h, nextQuestY);
        this.drawSpiderQuestUI(this.ctx, w, h, nextQuestY);
        this.drawFoxQuestCompletion(this.ctx, w, h);
        this.drawDeathOverlay(this.ctx, w, h);
        this.debugPerformance();
    }

    drawCinematicTitle(ctx, width, height) {
        const cinematic = this.cinematic;
        if (!cinematic) return;
        const fadeIn = Math.min(1, cinematic.elapsed / 0.65);
        const fadeOut = Math.min(1, (cinematic.duration - cinematic.elapsed) / 1.0);
        const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
        const mobile = mobileAndTabletCheck();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(15, 31, 18, 0.85)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "#fff1b9";
        ctx.font = `800 ${mobile ? 30 : 52}px Georgia, serif`;
        ctx.fillText("Fox Meadow", width * 0.5, height * 0.33);
        ctx.shadowColor = "transparent";
        ctx.fillStyle = "rgba(255, 248, 218, 0.92)";
        ctx.font = `700 ${mobile ? 11 : 14}px system-ui, sans-serif`;
        ctx.fillText("A new meadow awaits", width * 0.5, height * 0.33 + (mobile ? 27 : 39));
        ctx.restore();
    }

    drawQuestAnnouncement(ctx, width, height) {
        const fox = this.foxQuest;
        const spider = this.spiderQuest;
        const quest = fox.announcement > 0 ? fox : (spider.announcement > 0 ? spider : null);
        if (!quest) return;

        const mobile = mobileAndTabletCheck();
        const title = quest === fox ? "Strange Tracks" : "Spider Problem";
        const flavour = quest === fox
            ? (fox.state === "readyToComplete" ? "All the tracks have been found." : "Investigate the strange tracks in Fox Meadow.")
            : ((spider.state === "completed" || spider.state === "completing") ? "The dryfield can breathe again.  +10 coins" : "The dry grass is crawling. Squish the spiders!");
        const timer = quest.announcement;
        const alpha = Math.min(1, timer / 0.4, (4 - timer) / 0.4);
        const panelWidth = Math.min(width - 34, mobile ? 278 : 350);
        const panelHeight = mobile ? 84 : 100;
        const x = (width - panelWidth) * 0.5;
        const y = height * (mobile ? 0.28 : 0.29);
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.shadowColor = "rgba(15, 9, 4, 0.6)";
        ctx.shadowBlur = 18;
        this.roundRect(ctx, x, y, panelWidth, panelHeight, 17);
        ctx.fillStyle = "rgba(27, 57, 35, 0.94)";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255, 218, 108, 0.88)";
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd66d";
        ctx.font = `900 ${mobile ? 11 : 13}px system-ui, sans-serif`;
        ctx.fillText(quest.state === "completed" || quest.state === "completing" || fox.state === "readyToComplete" ? "QUEST COMPLETED" : "QUEST STARTED", width * 0.5, y + (mobile ? 22 : 26));
        ctx.fillStyle = "#fff4c8";
        ctx.font = `800 ${mobile ? 23 : 28}px Georgia, serif`;
        ctx.fillText(title, width * 0.5, y + (mobile ? 48 : 57));
        ctx.fillStyle = "#dcebcf";
        ctx.font = `600 ${mobile ? 10 : 12}px system-ui, sans-serif`;
        ctx.fillText(flavour, width * 0.5, y + (mobile ? 68 : 80));
        ctx.restore();
    }

    drawFoxQuestUI(ctx, width, height, stackY = 12) {
        const quest = this.foxQuest;
        const mobile = mobileAndTabletCheck();
        if (quest.dialog?.options) {
            const panelWidth = Math.min(width - 28, mobile ? 330 : 440);
            const panelHeight = mobile ? 176 : 164;
            const x = (width - panelWidth) * 0.5;
            const y = height - panelHeight - (mobile ? 24 : 42);
            ctx.save();
            this.roundRect(ctx, x, y, panelWidth, panelHeight, 18);
            ctx.fillStyle = "rgba(20, 43, 31, 0.94)";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "rgba(255, 224, 126, 0.8)";
            ctx.stroke();
            ctx.textAlign = "center";
            ctx.fillStyle = "#fff2bd";
            ctx.font = `800 ${mobile ? 20 : 24}px Georgia, serif`;
            ctx.fillText("The fox is waiting", width * 0.5, y + 34);
            ctx.fillStyle = "#dcebcf";
            ctx.font = `600 ${mobile ? 12 : 14}px system-ui, sans-serif`;
            ctx.fillText("Will you help investigate Fox Meadow?", width * 0.5, y + 58);

            const gap = 12, buttonY = y + panelHeight - 64;
            const buttonWidth = (panelWidth - gap * 3) * 0.5;
            quest.optionBounds = quest.dialog.options.map((option, index) => {
                const bx = x + gap + index * (buttonWidth + gap);
                this.roundRect(ctx, bx, buttonY, buttonWidth, 46, 12);
                ctx.fillStyle = index === 0 ? "#d99a37" : "#55775a";
                ctx.fill();
                ctx.fillStyle = "#fff8d8";
                ctx.font = `800 ${mobile ? 14 : 16}px system-ui, sans-serif`;
                ctx.fillText(option.label, bx + buttonWidth * 0.5, buttonY + 28);
                return { x: bx, y: buttonY, width: buttonWidth, height: 46, value: option.value };
            });
            ctx.restore();
        } else {
            quest.optionBounds = [];
        }

        if (quest.state !== "active" && quest.state !== "readyToComplete") return stackY;
        const panelWidth = mobile ? 142 : 178;
        const panelHeight = mobile ? 32 : 50;
        const x = width - panelWidth - (mobile ? 7 : 12);
        const y = stackY;
        ctx.save();
        this.roundRect(ctx, x, y, panelWidth, panelHeight, 10);
        ctx.fillStyle = "rgba(20, 43, 31, 0.88)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 224, 126, 0.72)";
        ctx.stroke();
        const tracksComplete = quest.state === "readyToComplete";
        ctx.fillStyle = "#ffd66d";
        ctx.font = `800 ${mobile ? 11 : 12}px system-ui, sans-serif`;
        ctx.fillStyle = "#fff4c8";
        ctx.font = `800 ${mobile ? 13 : 16}px Georgia, serif`;
        ctx.fillText("Strange Tracks", x + 9, y + 15);
        ctx.fillStyle = "#dcebcf";
        ctx.font = `700 ${mobile ? 9 : 10}px system-ui, sans-serif`;
        ctx.fillText(tracksComplete ? "Return to fox  •  3 / 3" :
            `Find tracks  •  ${quest.tracksFound} / ${quest.requiredTracks}`, x + 9, y + 28);
        ctx.restore();
        return y + panelHeight + (mobile ? 3 : 5);
    }

    drawSpiderQuestUI(ctx, width, height, stackY = 12) {
        const quest = this.spiderQuest;
        if (quest.state !== "active") return stackY;
        const mobile = mobileAndTabletCheck();
        const panelWidth = mobile ? 142 : 178;
        const panelHeight = mobile ? 32 : 50;
        const x = width - panelWidth - (mobile ? 7 : 12);
        const y = stackY;
        const complete = quest.state === "completed";
        ctx.save();
        this.roundRect(ctx, x, y, panelWidth, panelHeight, 10);
        ctx.fillStyle = "rgba(42, 29, 21, 0.88)";
        ctx.fill();
        ctx.strokeStyle = complete ? "rgba(132, 220, 141, 0.8)" : "rgba(244, 185, 82, 0.74)";
        ctx.stroke();
        ctx.fillStyle = "#fff4c8";
        ctx.font = `800 ${mobile ? 13 : 16}px Georgia, serif`;
        ctx.fillText("Spider Problem", x + 9, y + 15);
        ctx.fillStyle = "#dcebcf";
        ctx.font = `700 ${mobile ? 9 : 10}px system-ui, sans-serif`;
        ctx.fillText(complete ? "Complete  •  10 / 10" : `Squish spiders  •  ${quest.squished} / ${quest.required}`, x + 9, y + 28);
        ctx.restore();
        return y + panelHeight + (mobile ? 3 : 5);
    }

    drawFoxQuestCompletion(ctx, width, height) {
        const timer = this.foxQuest.completionTimer;
        if (timer <= 0) return;
        const mobile = mobileAndTabletCheck();
        const fade = Math.min(1, timer / 0.45, (4.5 - timer) / 0.45);
        const panelWidth = Math.min(width - 36, mobile ? 310 : 430);
        const panelHeight = mobile ? 122 : 142;
        const x = (width - panelWidth) * 0.5;
        const y = height * (mobile ? 0.25 : 0.28);
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.shadowColor = "rgba(27, 18, 5, 0.72)";
        ctx.shadowBlur = 22;
        this.roundRect(ctx, x, y, panelWidth, panelHeight, 20);
        ctx.fillStyle = "rgba(31, 64, 37, 0.94)";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255, 220, 109, 0.92)";
        ctx.stroke();
        ctx.shadowColor = "transparent";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffe27f";
        ctx.font = `900 ${mobile ? 13 : 15}px system-ui, sans-serif`;
        ctx.fillText("QUEST COMPLETED", width * 0.5, y + (mobile ? 29 : 34));
        ctx.fillStyle = "#fff5ce";
        ctx.font = `800 ${mobile ? 27 : 35}px Georgia, serif`;
        ctx.fillText("Strange Tracks", width * 0.5, y + (mobile ? 63 : 76));
        ctx.fillStyle = "#dff0d4";
        ctx.font = `700 ${mobile ? 12 : 14}px system-ui, sans-serif`;
        ctx.fillText("The fox thanks you.  +10 coins", width * 0.5, y + (mobile ? 91 : 108));
        ctx.restore();
    }

    drawHealthUI(ctx) {
        const mobile = mobileAndTabletCheck();
        const inset = mobile ? 7 : 12;
        const heartSize = mobile ? 20 : 26;
        const gap = mobile ? 4 : 6;
        const padding = mobile ? 8 : 11;
        const width = padding * 2 + heartSize * this.maxHealth + gap * (this.maxHealth - 1);
        const height = heartSize + padding * 2;
        const coinHeight = mobile ? 40 : 50;
        const x = inset;
        const y = inset + coinHeight + (mobile ? 5 : 8);
        const hitShake = this.healthFlash > 0
            ? Math.sin(performance.now() * 0.045) * this.healthFlash * 3
            : 0;

        ctx.save();
        ctx.translate(hitShake, 0);
        ctx.shadowColor = "rgba(5, 13, 9, 0.5)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "rgba(22, 51, 39, 0.94)";
        this.roundRect(ctx, x, y, width, height, height * 0.44);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "rgba(245, 223, 154, 0.55)";
        ctx.lineWidth = mobile ? 1.5 : 2;
        ctx.stroke();

        for (let index = 0; index < this.maxHealth; index++) {
            const heartX = x + padding + heartSize * 0.5 + index * (heartSize + gap);
            const heartY = y + height * 0.5;
            const filled = index < this.health;
            this.drawHealthHeart(ctx, heartX, heartY, heartSize, filled);
        }
        ctx.restore();
    }

    drawHealthHeart(ctx, x, y, size, filled) {
        const scale = size / 32;
        ctx.save();
        ctx.translate(x, y - size * 0.04);
        ctx.scale(scale, scale);
        ctx.beginPath();
        ctx.moveTo(0, 12);
        ctx.bezierCurveTo(-19, 1, -15, -13, -7, -12);
        ctx.bezierCurveTo(-3, -12, -1, -9, 0, -6);
        ctx.bezierCurveTo(1, -9, 3, -12, 7, -12);
        ctx.bezierCurveTo(15, -13, 19, 1, 0, 12);
        if (filled) {
            ctx.shadowColor = "rgba(255, 75, 92, 0.62)";
            ctx.shadowBlur = 6;
            ctx.fillStyle = "#f05c68";
            ctx.fill();
            ctx.shadowColor = "transparent";
            ctx.strokeStyle = "#ffd1bb";
        } else {
            ctx.fillStyle = "#39463f";
            ctx.strokeStyle = "#718278";
        }
        ctx.lineWidth = 2.3;
        ctx.stroke();
        ctx.restore();
    }

    updatePlayerHealth(deltaSeconds) {
        this.healthInvulnerability = Math.max(0, this.healthInvulnerability - deltaSeconds);
        this.healthFlash = Math.max(0, this.healthFlash - deltaSeconds * 2.8);
    }

    damagePlayer() {
        if (this.health <= 0 || this.healthInvulnerability > 0) return false;
        this.health--;
        this.healthInvulnerability = 1.15;
        this.healthFlash = 1;
        if (this.health === 0) this.startDeathSequence();
        return true;
    }

    startDeathSequence() {
        if (this.deathSequence || !this.player) return;
        this.restoreWaterSinkOffset();
        this.waterSink = 0;
        this.playerVelX = 0;
        this.playerVelY = 0;
        this.playerVelZ = 0;
        this.setPlayerAnimation(false);
        this.deathSequence = {
            elapsed: 0,
            respawned: false,
            fade: 0,
            fallBaseY: this.player.position.y
        };
    }

    updateDeathSequence(deltaSeconds) {
        const death = this.deathSequence;
        if (!death || !this.player) return;
        death.elapsed += deltaSeconds;

        // Let the cat visibly topple over before the screen starts fading.
        // Once respawned, do not keep applying this pose during fade-out.
        if (!death.respawned) {
            const fallProgress = Math.min(1, death.elapsed / 1.1);
            this.player.rotation.z = THREE.MathUtils.lerp(
                this.player.rotation.z, Math.PI * 0.5, Math.min(1, deltaSeconds * 9)
            );
            // The cat asset pivot is low, so raise the root for the side pose.
            this.player.position.y = death.fallBaseY + fallProgress * 0.24;
        }

        // 1.1 s fall, 1.0 s fade in, 0.6 s fully black, 1.1 s fade out.
        if (death.elapsed < 1.1) death.fade = 0;
        else if (death.elapsed < 2.1) death.fade = (death.elapsed - 1.1) / 1.0;
        else if (death.elapsed < 2.7) death.fade = 1;
        else death.fade = Math.max(0, 1 - (death.elapsed - 2.7) / 1.1);

        // Move the cat while the screen is completely black, not when the
        // return fade has already started.
        if (!death.respawned && death.elapsed >= 2.35) {
            this.respawnPlayer();
            death.respawned = true;
        }

        if (death.elapsed >= 3.8) this.deathSequence = null;
    }

    respawnPlayer() {
        if (!this.player || !this.playerSpawn) return;
        this.player.position.copy(this.playerSpawn.position);
        this.player.rotation.copy(this.playerSpawn.rotation);
        this.player.quaternion.setFromEuler(this.player.rotation);
        this.playerVelX = 0;
        this.playerVelY = 0;
        this.playerVelZ = 0;
        this.waterSink = 0;
        this.onGround = false;
        this.health = this.maxHealth;
        this.healthInvulnerability = 1.25;
        this.healthFlash = 0;
        this.restoreDeadBugs();
        this.snapCameraToPlayer();
        // The grass instance list is camera-local. Refresh it now, while the
        // black screen still hides the respawn, rather than waiting for normal
        // movement to resume after the death sequence.
        this.grass?.update(0);
    }

    restoreDeadBugs() {
        for (const bug of this.mapObjects) {
            const type = bug.userData.assetType || {};
            const label = `${type.id || ""} ${type.name || ""}`.toLowerCase();
            if (!label.includes("bug") || !bug.userData.squished) continue;

            bug.userData.squished = false;
            if (bug.userData.originalScale) bug.scale.copy(bug.userData.originalScale);
            if (bug.userData.hadCollisionOverride) {
                bug.userData.collisionOverride = bug.userData.preSquishCollisionOverride;
            } else {
                delete bug.userData.collisionOverride;
            }
            bug.userData.actions?.["Animation 1"]?.reset().play();
            bug.userData.actions?.["Animation 1"] && (bug.userData.actions["Animation 1"].paused = !!bug.userData.sleepingEffect);
            bug.userData.attackAction?.stop?.();

            const ai = bug.userData.bugAI;
            if (ai) {
                ai.state = "idle";
                ai.stateTime = 0.65;
                ai.attackCooldown = 0;
                bug.userData.bugState = ai.state;
            }
        }
    }

    drawDeathOverlay(ctx, width, height) {
        const alpha = this.deathSequence?.fade || 0;
        if (alpha <= 0) return;
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    drawCoinCounter(ctx) {
        const mobile = mobileAndTabletCheck();
        const inset = mobile ? 7 : 12;
        const height = mobile ? 40 : 50;
        const coinRadius = height * 0.36;
        const valueFont = mobile ? 19 : 25;
        const value = `× ${this.coins}`;

        ctx.save();
        ctx.font = `800 ${valueFont}px system-ui, sans-serif`;
        const width = Math.max(height + 70, height + ctx.measureText(value).width + 32);
        const x = inset, y = inset;
        const radius = height * 0.42;

        // A quiet, readable glass panel that lets the meadow remain visible.
        ctx.shadowColor = "rgba(18, 35, 17, 0.38)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        const panel = ctx.createLinearGradient(x, y, x, y + height);
        panel.addColorStop(0, "rgba(37, 62, 39, 0.88)");
        panel.addColorStop(1, "rgba(15, 30, 20, 0.88)");
        this.roundRect(ctx, x, y, width, height, radius);
        ctx.fillStyle = panel;
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255, 226, 134, 0.72)";
        ctx.stroke();

        this.drawCoinPaw(ctx, x + height * 0.5, y + height * 0.5, coinRadius);
        ctx.fillStyle = "#fff4ca";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(value, x + height + 4, y + height * 0.52);
        ctx.restore();
    }

    drawCoinPaw(ctx, x, y, radius) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        const coin = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35,
            radius * 0.1, x, y, radius);
        coin.addColorStop(0, "#ffe28a");
        coin.addColorStop(0.58, "#e9ad39");
        coin.addColorStop(1, "#a96416");
        ctx.fillStyle = coin;
        ctx.fill();
        ctx.lineWidth = Math.max(1, radius * 0.12);
        ctx.strokeStyle = "#fff0a8";
        ctx.stroke();

        ctx.fillStyle = "#ad6a1a";
        // Toes and pad are intentionally simplified so the icon stays clear
        // at the mobile HUD size.
        const toe = (dx, dy, rx, ry) => {
            ctx.beginPath();
            ctx.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
        };
        toe(-radius * 0.43, -radius * 0.17, radius * 0.16, radius * 0.22);
        toe(-radius * 0.14, -radius * 0.43, radius * 0.16, radius * 0.22);
        toe( radius * 0.14, -radius * 0.43, radius * 0.16, radius * 0.22);
        toe( radius * 0.43, -radius * 0.17, radius * 0.16, radius * 0.22);
        ctx.beginPath();
        ctx.ellipse(x, y + radius * 0.23, radius * 0.43, radius * 0.31, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
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

    setupFoxPatrol() {
        const fox = this.mapObjects.find(obj => {
            const type = obj.userData.assetType || {};
            return /fox/i.test(type.id || "") || /fox/i.test(type.name || "");
        });
        const paths = this.mapObjects.filter(obj => {
            const type = obj.userData.assetType || {};
            return /path\.glb$/i.test(type.glb || "") ||
                /^path$/i.test(type.id || "") || /^path$/i.test(type.name || "");
        }).slice(0, 3);
        if (!fox || paths.length < 3) return;

        const route = this.buildPathRoute(paths, fox.position.y);
        if (route.length < 2) return;

        const action = fox.userData.actions?.["Animation 1"];
        if (action) {
            action.reset();
            action.enabled = true;
            action.paused = false;
            action.setEffectiveWeight(1).setEffectiveTimeScale(1.05).play();
        }

        // The fox starts on path three in this map. Find the closest authored
        // route endpoint so its first step is natural rather than a teleport.
        let targetIndex = 0;
        let closestDistance = Infinity;
        route.forEach((point, index) => {
            const distance = fox.position.distanceToSquared(point);
            if (distance < closestDistance) {
                closestDistance = distance;
                targetIndex = index;
            }
        });
        this.foxPatrol = {
            fox,
            route,
            targetIndex,
            direction: targetIndex === 0 ? 1 : -1,
            speed: 1.65,
            noticeDistance: 4.5,
            action
        };
    }

    buildPathRoute(paths, y) {
        const segments = paths.map(path => {
            const box = this.worldSolver.getLocalBox(path);
            if (!box) return null;
            path.updateWorldMatrix(true, true);
            const longIsX = (box.max.x - box.min.x) >= (box.max.z - box.min.z);
            const a = new THREE.Vector3(
                longIsX ? box.min.x : (box.min.x + box.max.x) * 0.5,
                box.max.y,
                longIsX ? (box.min.z + box.max.z) * 0.5 : box.min.z
            ).applyMatrix4(path.matrixWorld);
            const b = new THREE.Vector3(
                longIsX ? box.max.x : (box.min.x + box.max.x) * 0.5,
                box.max.y,
                longIsX ? (box.min.z + box.max.z) * 0.5 : box.max.z
            ).applyMatrix4(path.matrixWorld);
            a.y = y;
            b.y = y;
            return { a, b };
        }).filter(Boolean);
        if (!segments.length) return [];

        // Orient each segment toward the following one, producing one
        // continuous route through the first three path instances.
        const route = [];
        let previous = null;
        for (let index = 0; index < segments.length; index++) {
            const segment = segments[index];
            let start = segment.a, end = segment.b;
            if (previous) {
                if (previous.distanceToSquared(segment.b) < previous.distanceToSquared(segment.a)) {
                    start = segment.b;
                    end = segment.a;
                }
            } else if (segments[index + 1]) {
                const next = segments[index + 1];
                const aToNext = Math.min(segment.a.distanceToSquared(next.a), segment.a.distanceToSquared(next.b));
                const bToNext = Math.min(segment.b.distanceToSquared(next.a), segment.b.distanceToSquared(next.b));
                if (aToNext < bToNext) {
                    start = segment.b;
                    end = segment.a;
                }
            }
            if (!route.length || route[route.length - 1].distanceToSquared(start) > 0.01) {
                route.push(start);
            }
            route.push(end);
            previous = end;
        }
        return route;
    }

    updateFoxPatrol(deltaSeconds) {
        const patrol = this.foxPatrol;
        if (!patrol) return;
        const toPlayer = this.player.position.clone().sub(patrol.fox.position);
        toPlayer.y = 0;
        const playerIsNear = toPlayer.lengthSq() <= patrol.noticeDistance * patrol.noticeDistance;
        if (playerIsNear && !patrol.playerWasNear && !this.isCinematicActive()&&this.foxMeadowCinematicPlayed) {
            if (this.foxQuest.state === "unseen") this.beginFoxDialogue("first");
            else if (this.foxQuest.state === "deferred") this.beginFoxDialogue("return");
            else if (this.foxQuest.state === "readyToComplete") this.completeFoxQuest();
        }
        patrol.playerWasNear = playerIsNear;

        const foxShouldPause = playerIsNear && this.foxQuest.state !== "deferred" && !this.isCinematicActive()&&this.foxMeadowCinematicPlayed;
        if (foxShouldPause) {
            // Pause at the current route point and give the cat the fox's
            // attention. The stored waypoint/direction remain untouched.
            if (patrol.action) patrol.action.paused = true;
            if (toPlayer.lengthSq() > 0.0001) {
                const lookYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
                patrol.fox.rotation.y = this.lerpAngle(
                    patrol.fox.rotation.y, lookYaw, Math.min(1, deltaSeconds * 8)
                );
            }
            return;
        }
        if (patrol.action) patrol.action.paused = false;
        const target = patrol.route[patrol.targetIndex];
        const toTarget = target.clone().sub(patrol.fox.position);
        toTarget.y = 0;
        const distance = toTarget.length();
        const step = patrol.speed * deltaSeconds;
        if (distance <= step) {
            patrol.fox.position.copy(target);
            let next = patrol.targetIndex + patrol.direction;
            if (next < 0 || next >= patrol.route.length) {
                patrol.direction *= -1;
                next = patrol.targetIndex + patrol.direction;
            }
            patrol.targetIndex = next;
            return;
        }
        toTarget.multiplyScalar(1 / distance);
        patrol.fox.position.addScaledVector(toTarget, step);
        const targetYaw = Math.atan2(-toTarget.x, -toTarget.z);
        patrol.fox.rotation.y = this.lerpAngle(
            patrol.fox.rotation.y, targetYaw, Math.min(1, deltaSeconds * 8)
        );
    }

    isFoxDialogActive() {
        return this.foxQuest.state === "speaking" || this.foxQuest.state === "choice" ||
            this.foxQuest.state === "completing";
    }

    async beginFoxDialogue(kind) {
        const quest = this.foxQuest;
        if (this.isCinematicActive() || this.isFoxDialogActive()) return;
        const token = ++quest.token;
        quest.state = "speaking";
        quest.dialog = { message: "The fox is speaking…" };
        const clip = kind === "first" ? "sounds/Fox1.mp3" : "sounds/Fox4.mp3";
        try {
            await audio2(clip);
        } catch (error) {
            console.warn("Could not play fox dialogue:", error);
        }
        if (quest.token !== token || quest.state !== "speaking") return;
        quest.state = "choice";
        quest.dialog = {
            options: kind === "first"
                ? [{ label: "Yes", value: "yes" }, { label: "Maybe later", value: "later" }]
                : [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]
        };
    }

    async chooseFoxQuest(option) {
        const quest = this.foxQuest;
        if (quest.state !== "choice") return;
        const token = ++quest.token;
        quest.state = "speaking";
        quest.dialog = { message: "The fox listens…" };
        if (option === "yes") {
            try {
                await audio2("sounds/Fox2.mp3");
            } catch (error) {
                console.warn("Could not play fox quest audio:", error);
            }
            if (quest.token !== token) return;
            quest.state = "active";
            quest.dialog = null;
            quest.announcement = 3.5;
            this.showFoxTrackSparkles();
        } else if (option === "later") {
            try {
                await audio2("sounds/Fox3.mp3");
            } catch (error) {
                console.warn("Could not play fox dialogue:", error);
            }
            if (quest.token !== token) return;
            quest.state = "deferred";
            quest.dialog = null;
        } else {
            // "No" leaves the quest available for another conversation.
            quest.state = "deferred";
            quest.dialog = null;
        }
    }

    async completeFoxQuest() {
        const quest = this.foxQuest;
        if (quest.state !== "readyToComplete") return;
        const token = ++quest.token;
        quest.state = "completing";
        quest.dialog = { message: "The fox is speakingâ€¦" };
        try {
            await audio2("sounds/Fox5.mp3");
        } catch (error) {
            console.warn("Could not play fox quest completion audio:", error);
        }
        if (quest.token !== token) return;

        quest.dialog = null;
        quest.completionTimer = 4.5;
        // A quick, satisfying run of pickups makes the reward feel earned
        // without holding the player in the completion moment for long.
        for (let coin = 0; coin < 10; coin++) {
            if (quest.token !== token) return;
            this.coins++;
            audio2("sounds/coin.mp3");
            await new Promise(resolve => setTimeout(resolve, 105));
        }
        if (quest.token === token) quest.state = "completed";
    }

    handleFoxDialogInput() {
        const options = this.foxQuest.optionBounds;
        if (!this.input.pointer.justPressed || !options.length) return;
        const { x, y } = this.input.pointer;
        const selected = options.find(option =>
            x >= option.x && x <= option.x + option.width &&
            y >= option.y && y <= option.y + option.height
        );
        if (selected) this.chooseFoxQuest(selected.value);
    }

    updateFoxQuest(deltaSeconds) {
        const quest = this.foxQuest;
        if (quest.announcement > 0) quest.announcement = Math.max(0, quest.announcement - deltaSeconds);
        if (quest.completionTimer > 0) quest.completionTimer = Math.max(0, quest.completionTimer - deltaSeconds);
        this.updateFoxTrackSparkles(deltaSeconds);
        if (quest.state !== "active") return;
        for (const track of [...this.mapObjects]) {
            if (!this.isFoxQuestTrack(track) || track.userData.foxQuestTrackFound) continue;
            const position = track.getWorldPosition(new THREE.Vector3());
            const dx = position.x - this.player.position.x;
            const dz = position.z - this.player.position.z;
            if (dx * dx + dz * dz > 1.7 * 1.7) continue;
            track.userData.foxQuestTrackFound = true;
            this.removeFoxTrackSparkles(track);
           // this.removeMapObject(track);
            quest.tracksFound = Math.min(quest.requiredTracks, quest.tracksFound + 1);
            audio2("sounds/questfind.mp3");
            if (quest.tracksFound === quest.requiredTracks) {
                quest.state = "readyToComplete";
                quest.announcement = 4;
            }
        }
    }

    updateSpiderQuest(deltaSeconds) {
        const quest = this.spiderQuest;
        if (quest.announcement > 0) quest.announcement = Math.max(0, quest.announcement - deltaSeconds);
        if (quest.state !== "unseen" || !this.player) return;
        if (!this.dryField?.containsPoint(this.player.position.x, this.player.position.z)) return;

        quest.state = "active";
        quest.announcement = 4;
    }

    registerSpiderSquish(spider) {
        const quest = this.spiderQuest;
        if (quest.state !== "active" || spider.userData.spiderQuestCounted) return;
        spider.userData.spiderQuestCounted = true;
        quest.squished = Math.min(quest.required, quest.squished + 1);
        audio2("sounds/questfind.mp3");
        if (quest.squished >= quest.required) {
            this.completeSpiderQuest();
        }
    }

    async completeSpiderQuest() {
        const quest = this.spiderQuest;
        if (quest.state !== "active" || quest.squished < quest.required) return;
        const token = ++quest.token;
        quest.state = "completing";
        quest.announcement = 4;
        // Keep the reward quick and readable, matching the Fox quest's
        // satisfying row of coin pickups without creating coin objects.
        for (let coin = 0; coin < 10; coin++) {
            if (quest.token !== token) return;
            this.coins++;
            audio2("sounds/coin.mp3");
            await new Promise(resolve => setTimeout(resolve, 105));
        }
        if (quest.token === token) quest.state = "completed";
    }

    isFoxQuestTrack(object) {
        const type = object.userData.assetType || {};
        const instance = object.userData.mapObject || {};
        return /track/i.test(type.id || "") || /track/i.test(type.name || "") ||
            /track/i.test(instance.name || "");
    }

    showFoxTrackSparkles() {
        for (const track of this.mapObjects) {
            if (!this.isFoxQuestTrack(track) || track.userData.foxQuestTrackFound ||
                track.userData.foxQuestSparkles) continue;
            const group = this.createFoxTrackSparkles(track);
            track.userData.foxQuestSparkles = group;
            this.foxQuest.sparkles.push(group);
            this.scene.add(group);
        }
    }

    createFoxTrackSparkles(track) {
        const group = new THREE.Group();
        const position = track.getWorldPosition(new THREE.Vector3());
        group.position.copy(position).add(new THREE.Vector3(0, 0.55, 0));
        const texture = this.getFoxSparkleTexture();
        for (let index = 0; index < 4; index++) {
            const phase = index * Math.PI * 0.5 + Math.random() * 0.35;
            const material = new THREE.SpriteMaterial({
                map: texture,
                color: index % 2 ? 0xffe58c : 0xffffff,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                opacity: 0.82
            });
            const sparkle = new THREE.Sprite(material);
            sparkle.position.set(
                Math.cos(phase) * 0.24,
                Math.sin(phase * 1.7) * 0.07,
                Math.sin(phase) * 0.24
            );
            sparkle.scale.setScalar(0.16 + index * 0.025);
            sparkle.renderOrder = 2;
            sparkle.userData.sparklePhase = phase;
            group.add(sparkle);
        }
        return group;
    }

    getFoxSparkleTexture() {
        const quest = this.foxQuest;
        if (quest.sparkleTexture) return quest.sparkleTexture;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(0.22, "rgba(255,243,164,1)");
        gradient.addColorStop(0.55, "rgba(255,213,82,0.55)");
        gradient.addColorStop(1, "rgba(255,213,82,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(32, 32, 30, 0, Math.PI * 2);
        ctx.fill();
        quest.sparkleTexture = new THREE.CanvasTexture(canvas);
        quest.sparkleTexture.colorSpace = THREE.SRGBColorSpace;
        return quest.sparkleTexture;
    }

    updateFoxTrackSparkles(deltaSeconds) {
        for (const group of this.foxQuest.sparkles) {
            for (const sparkle of group.children) {
                const phase = sparkle.userData.sparklePhase + performance.now() * 0.004;
                const pulse = 0.72 + Math.sin(phase) * 0.28;
                sparkle.material.opacity = pulse;
                sparkle.scale.setScalar((0.15 + Math.sin(phase * 1.6) * 0.035));
                sparkle.position.y = Math.sin(phase * 1.3) * 0.1 + deltaSeconds * 0;
            }
        }
    }

    removeFoxTrackSparkles(track) {
        const group = track.userData.foxQuestSparkles;
        if (!group) return;
        this.scene.remove(group);
        group.traverse(child => child.material?.dispose?.());
        this.foxQuest.sparkles = this.foxQuest.sparkles.filter(entry => entry !== group);
        delete track.userData.foxQuestSparkles;
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

    setupBugAI() {
        this.bugAI = [];
        for (const bug of this.mapObjects) {
            const type = bug.userData.assetType || {};
            const id = `${type.id || ""} ${type.name || ""}`.toLowerCase();
            // The first authored bug remains the sleeping tutorial bug.
            if (!id.includes("bug") || bug === this.insectObj) continue;

            const seed = this.getBugSeed(bug);
            const ai = {
                bug,
                home: bug.position.clone(),
                state: "idle",
                stateTime: 0.8 + seed * 1.2,
                wanderTarget: bug.position.clone(),
                wanderRadius: 2.2,
                aggroDistance: 5.25,
                returnDistance: 7.0,
                attackDistance: 1.4,
                wanderSpeed: 0.62,
                chaseSpeed: 1.45,
                returnSpeed: 0.98,
                seed,
                wanderCount: 0,
                attackCooldown: 0,
                action: bug.userData.actions?.["Animation 1"] || null,
                attackAction: this.createBugAttackAction(bug)
            };
            bug.userData.bugAI = ai;
            bug.userData.bugState = ai.state;
            this.bugAI.push(ai);
        }
    }

    getBugSeed(bug) {
        const id = bug.userData.mapObject?.id || "bug";
        let value = 0;
        for (let index = 0; index < id.length; index++) {
            value = (value * 31 + id.charCodeAt(index)) >>> 0;
        }
        return (value % 10000) / 10000;
    }

    setBugState(ai, state, duration = 0) {
        if (ai.state === state) return;
        const previousState = ai.state;
        ai.state = state;
        ai.stateTime = duration;
        ai.bug.userData.bugState = state;
      //  if (previousState === "attack" && state !== "attack") ai.attackAction?.stop();
        if (state === "wander") this.chooseBugWanderTarget(ai);
        if (state === "attack") this.triggerBugAttack(ai);
    }

    createBugAttackAction(bug) {
        const mixer = bug.userData.mixer;
        const clip = THREE.AnimationClip.findByName(bug.userData.animations || [], "Animation 2");
        if (!mixer || !clip) return null;

        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, 5);
        action.clampWhenFinished = false;
        action.enabled = true;
        action.stop();
        return action;
    }

    triggerBugAttack(ai) {
        this.setBugMoving(ai, false);
        if (ai.attackAction) {
            ai.attackAction.reset();
            ai.attackAction.enabled = true;
            ai.attackAction.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
        }

        if (!this.damagePlayer() || this.deathSequence) return;

        // A small impulse makes the hit readable without turning it into a
        // full combat/health system. WorldSolver handles the landing normally.
        const awayFromBug = this.player.position.clone().sub(ai.bug.position);
        awayFromBug.y = 0;
        if (awayFromBug.lengthSq() > 0.0001) {
            awayFromBug.normalize();
            // Horizontal impact is a velocity, not an instant position jump.
            // It is applied and eased out by updatePlayerKnockback each frame.
            this.playerVelX = awayFromBug.x * 0.26;
            this.playerVelZ = awayFromBug.z * 0.26;
        }
        this.playerVelY = Math.max(this.playerVelY, 0.18);
        this.onGround = false;
        ai.attackCooldown = 1.2;
    }

    chooseBugWanderTarget(ai) {
        ai.wanderCount++;
        // Smooth deterministic angles keep the bug near its home without a
        // random, jittery-looking route or a changing route on reload.
        const angle = (ai.seed * 19.7 + ai.wanderCount * 2.399) * Math.PI * 2;
        const distance = ai.wanderRadius * (0.35 + ((ai.seed * 7.1 + ai.wanderCount * 0.37) % 1) * 0.65);
        ai.wanderTarget.set(
            ai.home.x + Math.cos(angle) * distance,
            ai.home.y,
            ai.home.z + Math.sin(angle) * distance
        );
    }

    updateBugAI(deltaSeconds) {
        if (!this.player) return;
        for (const ai of this.bugAI) {
            const bug = ai.bug;
            if (bug.userData.squished) continue;

            const toPlayer = this.player.position.clone().sub(bug.position);
            toPlayer.y = 0;
            const playerDistance = toPlayer.length();
            ai.stateTime -= deltaSeconds;
            ai.attackCooldown = Math.max(0, ai.attackCooldown - deltaSeconds);

            // A cat that has escaped the bug's small home area breaks pursuit.
            if ((ai.state === "aggro" || ai.state === "chase" || ai.state === "attack") &&
                playerDistance > ai.returnDistance) {
                this.setBugState(ai, "return");
            }

            switch (ai.state) {
                case "idle":
                    this.setBugMoving(ai, false);
                    if (playerDistance <= ai.aggroDistance) this.setBugState(ai, "aggro", 0.45);
                    else if (ai.stateTime <= 0) this.setBugState(ai, "wander");
                    break;

                case "wander":
                    if (playerDistance <= ai.aggroDistance) {
                        this.setBugState(ai, "aggro", 0.45);
                        break;
                    }
                    if (this.moveBugTowards(ai, ai.wanderTarget, ai.wanderSpeed, deltaSeconds)) {
                        this.setBugState(ai, "idle", 0.8 + ai.seed * 1.3);
                    }
                    break;

                case "aggro":
                    this.setBugMoving(ai, false);
                    this.faceBugTowards(ai, toPlayer, deltaSeconds);
                    if (playerDistance > ai.returnDistance) this.setBugState(ai, "return");
                    else if (ai.stateTime <= 0) this.setBugState(ai, "chase");
                    break;

                case "chase":
                    if (this.touching(this.player, "bug", "solid") && !this.touching(this.player, "bug", "solid","down")) { 
                        if (ai.attackCooldown <= 0) this.setBugState(ai, "attack", 0.65);
                        else {
                            this.setBugMoving(ai, false);
                            this.faceBugTowards(ai, toPlayer, deltaSeconds);
                        }
                    } else {
                        this.moveBugTowards(ai, this.player.position, ai.chaseSpeed, deltaSeconds);
                    }
                    break;

                case "attack":
                    this.setBugMoving(ai, false);
                    this.faceBugTowards(ai, toPlayer, deltaSeconds);
                    if (playerDistance > ai.attackDistance * 1.35) this.setBugState(ai, "chase");
                    else if (ai.stateTime <= 0) this.setBugState(ai, "chase");
                    break;

                case "return":
                    if (playerDistance <= ai.aggroDistance) {
                        this.setBugState(ai, "aggro", 0.3);
                        break;
                    }
                    if (this.moveBugTowards(ai, ai.home, ai.returnSpeed, deltaSeconds)) {
                        this.setBugState(ai, "idle", 1.0 + ai.seed);
                    }
                    break;
            }
        }
    }

    moveBugTowards(ai, target, speed, deltaSeconds) {
        const direction = target.clone().sub(ai.bug.position);
        direction.y = 0;
        const distance = direction.length();
        const step = speed * deltaSeconds;
        if (distance <= Math.max(step, 0.04)) {
            ai.bug.position.x = target.x;
            ai.bug.position.z = target.z;
            this.setBugMoving(ai, false);
            return true;
        }
        direction.multiplyScalar(1 / distance);
        ai.bug.position.addScaledVector(direction, step);
        this.faceBugTowards(ai, direction, deltaSeconds);
        this.setBugMoving(ai, true);
        return false;
    }

    faceBugTowards(ai, direction, deltaSeconds) {
        if (direction.lengthSq() < 0.0001) return;
        const targetYaw = Math.atan2(-direction.x, -direction.z);
        ai.bug.rotation.y = this.lerpAngle(
            ai.bug.rotation.y, targetYaw, Math.min(1, deltaSeconds * 10)
        );
    }

    setBugMoving(ai, moving) {
        if (!ai.action) return;
        ai.action.paused = !moving;
        ai.action.setEffectiveTimeScale(moving ? 1.15 : 0.65);
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

        this.playerSpawn = {
            position: this.player.position.clone(),
            rotation: this.player.rotation.clone()
        };

        console.log("Player cat:", this.player);
    }

    createFallbackPlayer() {
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffaa55 });
        const box = new THREE.Mesh(geo, mat);

        box.position.set(0, 0.5, 0);
        box.castShadow = true;
        box.receiveShadow = true;

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
    updatePlayerKnockback(scale) {
        if (!this.player) return;
        if (Math.abs(this.playerVelX) < 0.00001 && Math.abs(this.playerVelZ) < 0.00001) {
            this.playerVelX = 0;
            this.playerVelZ = 0;
            return;
        }

        this.player.position.x += this.playerVelX * scale;
        this.player.position.z += this.playerVelZ * scale;

        // 0.72/frame produces a short, soft push of roughly 0.18 world units.
        const friction = Math.pow(0.92, scale);
        this.playerVelX *= friction;
        this.playerVelZ *= friction;
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

    snapCameraToPlayer() {
        if (!this.player || !this.camera) return;
        this.cameraYaw = this.player.rotation.y;
        const target = this.player.position.clone();
        target.y += 1.0;
        this.camera.position.set(
            target.x + Math.sin(this.cameraYaw) * this.cameraDistance,
            target.y + this.cameraHeight,
            target.z + Math.cos(this.cameraYaw) * this.cameraDistance
        );
        this.camera.lookAt(target);
        this.updateSky();
    }

    isCinematicActive() {
        return this.cinematic !== null;
    }

    getMapObjectByName(name) {
        const needle = name.toLowerCase();
        return this.mapObjects.find(object => {
            const type = object.userData.assetType || {};
            const instance = object.userData.mapObject || {};
            return [type.id, type.name, instance.name]
                .some(value => String(value || "").toLowerCase() === needle);
        }) || null;
    }

    getOverlappingNamedTrigger(name) {
        const object = this.getMapObjectByName(name);
        if (!object || !this.player) return null;
        // The normal contact cache remains the fast path. This fallback makes
        // authored cutscene triggers reliable even if another system clears a
        // contact entry later in the same frame.
        return this.worldSolver.playerOverlapsObject(this.player, object)
            ? object
            : null;
    }

    startFoxMeadowCinematic(trigger) {
        const flyby = this.getMapObjectByName("flyby");
        const targetObject = trigger?.isObject3D
            ? trigger
            : trigger?.mesh || this.getMapObjectByName("2song");
        if (!flyby || !targetObject) {
            console.warn("Fox Meadow cinematic needs both a flyby and 2song object.");
            return;
        }

        this.foxMeadowCinematicPlayed = true;
        flyby.updateWorldMatrix(true, false);
        targetObject.updateWorldMatrix(true, false);
        const start = flyby.getWorldPosition(new THREE.Vector3());
        const target = targetObject.getWorldPosition(new THREE.Vector3());
        const direction = target.clone().sub(start).normalize();
        // Stop just before the trigger, still looking into Fox Meadow rather
        // than placing the camera inside its invisible box.
        const end = target.clone().addScaledVector(direction, -8);
        end.y = target.y + 4.2;
        const lookAt = target.clone();
        lookAt.y += 1.1;

        this.cinematic = {
            elapsed: 0,
            duration: 9.2,
            start,
            end,
            lookAt,
            fogNear: this.scene.fog?.near,
            fogFar: this.scene.fog?.far
        };
        // The flyby begins much farther from the meadow than the regular
        // player camera, so move the haze back for this establishing view.
        if (this.scene.fog) {
            this.scene.fog.near = 115;
            this.scene.fog.far = 290;
        }
        // Teleport immediately to the authored flyby marker on the trigger
        // frame, then animate from there on following frames.
        this.camera.position.copy(start);
        this.camera.lookAt(lookAt);
    }

    updateCinematic(deltaSeconds) {
        const cinematic = this.cinematic;
        if (!cinematic) return;
        cinematic.elapsed += deltaSeconds;
        const progress = Math.min(1, cinematic.elapsed / cinematic.duration);
        // Smooth acceleration/deceleration gives the travel a calmer flyby.
        const eased = progress * progress * (3 - 2 * progress);
        this.camera.position.lerpVectors(cinematic.start, cinematic.end, eased);
        this.camera.lookAt(cinematic.lookAt);

        if (progress < 1) return;
        // Preserve the final view direction so the normal follow camera takes
        // over smoothly when player controls return.
        const playerTarget = this.player.position.clone();
        playerTarget.y += 1;
        const offset = this.camera.position.clone().sub(playerTarget);
        this.cameraYaw = Math.atan2(offset.x, offset.z);
        if (this.scene.fog) {
            this.scene.fog.near = cinematic.fogNear;
            this.scene.fog.far = cinematic.fogFar;
        }
        this.cinematic = null;
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
        this.basePlayerBottomOffset = this.playerBottomOffset;
        this.playerHeight = box.max.y - box.min.y;
        
   
    }
    updateWaterSink(deltaSeconds) {
        if (!this.player) return;

        // Water is a solid floor, so its down contact is the reliable signal
        // for standing in it. The visual offset is applied after physics.
        const inWater = !!this.touching(this.player, "water", "solid", "down");
        const targetSink = inWater ? 0.75 : 0;
        this.waterSink = THREE.MathUtils.damp(this.waterSink, targetSink, 14, deltaSeconds);
    }
    restoreWaterSinkOffset() {
        if (!this.player || !this.waterSink) return;
        this.player.position.y += this.waterSink;
        this.playerBottomOffset = this.basePlayerBottomOffset;
    }
    applyWaterSinkOffset() {
        if (!this.player || !this.waterSink) return;
        // Restore it before WorldSolver next frame, so physics never sees the
        // lowered visual root and therefore cannot feed back into the contact.
        this.player.position.y -= this.waterSink;
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

// Soft contact shadows for small props. Static and moving objects deliberately
// live in separate InstancedMeshes: only the moving batch needs matrix uploads
// each frame, while both replace many expensive shadow-map draws.
class CatAdventureFakeShadows {
    constructor(game) {
        this.game = game;
        this.root = new THREE.Group();
        this.root.name = "Instanced fake shadows";
        this.root.userData.isRenderBatch = true;
        this.staticMesh = null;
        this.dynamicMesh = null;
        this.dynamicEntries = [];
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.material = this.createMaterial();
        this.bounds = new THREE.Box3();
        this.worldPosition = new THREE.Vector3();
        this.dummy = new THREE.Object3D();
        this.worldQuaternion = new THREE.Quaternion();
        this.yawQuaternion = new THREE.Quaternion();
        this.yAxis = new THREE.Vector3(0, 1, 0);
        this.offsetVector = new THREE.Vector3();
        this.planeQuaternion = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), -Math.PI / 2
        );
    }

    createMaterial() {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const context = canvas.getContext("2d");
        const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(0.55, "rgba(255,255,255,0.72)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        const alphaMap = new THREE.CanvasTexture(canvas);
        alphaMap.colorSpace = THREE.NoColorSpace;
        return new THREE.MeshBasicMaterial({
            color: 0x24170d,
            alphaMap,
            transparent: true,
            opacity: this.game.fakeShadowConfig.opacity,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    }

    getKind(object) {
        const type = object.userData.assetType || {};
        const typeId = String(type.id || type.name || "").toLowerCase();
        const config = this.game.fakeShadowConfig;
        if (config.staticTypes.has(typeId) && !object.userData.mixer && !object.userData.animations?.length) return "static";
        if (config.dynamicTypes.has(typeId)) return "dynamic";
        return null;
    }

    makeEntry(object) {
        const config = this.game.fakeShadowConfig;
        this.bounds.setFromObject(object);
        if (this.bounds.isEmpty()) return null;
        object.getWorldPosition(this.worldPosition);
        object.getWorldQuaternion(this.worldQuaternion);
        const type = object.userData.assetType || {};
        const typeId = String(type.id || type.name || "").toLowerCase();
        const footprint = config.footprints[typeId];
        const groundY = (this.game.ground?.position.y ?? this.worldPosition.y) + config.verticalOffset;
        this.offsetVector.set(
            (this.bounds.min.x + this.bounds.max.x) * 0.5 - this.worldPosition.x,
            0,
            (this.bounds.min.z + this.bounds.max.z) * 0.5 - this.worldPosition.z
        ).applyQuaternion(this.worldQuaternion.clone().invert());
        return {
            object,
            width: footprint?.width ?? Math.max(config.minSize, this.bounds.max.x - this.bounds.min.x + config.padding),
            depth: footprint?.depth ?? Math.max(config.minSize, this.bounds.max.z - this.bounds.min.z + config.padding),
            // Do not follow a jumping cat or a floating coin vertically. A
            // contact shadow stays on the ground, which also makes flowers
            // reliably visible above the terrain surface.
            groundY,
            x: (this.bounds.min.x + this.bounds.max.x) * 0.5,
            z: (this.bounds.min.z + this.bounds.max.z) * 0.5,
            localCenterX: this.offsetVector.x,
            localCenterZ: this.offsetVector.z
        };
    }

    setMatrix(mesh, index, entry, dynamic) {
        const hidden = dynamic && (!entry.object.parent || entry.object.userData.squished);
        if (dynamic) {
            entry.object.getWorldPosition(this.worldPosition);
            entry.object.getWorldQuaternion(this.worldQuaternion);
            this.offsetVector.set(entry.localCenterX, 0, entry.localCenterZ)
                .applyQuaternion(this.worldQuaternion);
            this.dummy.position.set(
                this.worldPosition.x + this.offsetVector.x,
                entry.groundY,
                this.worldPosition.z + this.offsetVector.z
            );
            const yaw = Math.atan2(
                2 * (this.worldQuaternion.w * this.worldQuaternion.y + this.worldQuaternion.x * this.worldQuaternion.z),
                1 - 2 * (this.worldQuaternion.y * this.worldQuaternion.y + this.worldQuaternion.z * this.worldQuaternion.z)
            );
            this.yawQuaternion.setFromAxisAngle(this.yAxis, yaw);
            this.dummy.quaternion.copy(this.yawQuaternion).multiply(this.planeQuaternion);
        } else {
            this.dummy.position.set(entry.x, entry.groundY, entry.z);
            this.dummy.quaternion.copy(this.planeQuaternion);
        }
        // Keep the instance slot, but collapse it when its source was removed
        // (a collected coin) or squished (a defeated spider). This avoids
        // rebuilding the InstancedMesh during gameplay.
        this.dummy.scale.set(hidden ? 0 : entry.width, hidden ? 0 : entry.depth, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
    }

    buildBatch(entries, dynamic) {
        if (!entries.length) return null;
        const mesh = new THREE.InstancedMesh(this.geometry, this.material, entries.length);
        mesh.name = dynamic ? "Dynamic instanced fake shadows" : "Static instanced fake shadows";
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = -1;
        mesh.userData.isRenderBatch = true;
        entries.forEach((entry, index) => this.setMatrix(mesh, index, entry, dynamic));
        mesh.instanceMatrix.needsUpdate = true;
        this.root.add(mesh);
        return mesh;
    }

    build() {
        if (!this.game.fakeShadowConfig.enabled) return;
        this.game.scene.updateMatrixWorld(true);
        const staticEntries = [];
        const dynamicEntries = [];
        for (const object of this.game.mapObjects) {
            const kind = this.getKind(object);
            if (!kind) continue;
            const entry = this.makeEntry(object);
            if (!entry) continue;
            (kind === "dynamic" ? dynamicEntries : staticEntries).push(entry);
        }
        this.staticMesh = this.buildBatch(staticEntries, false);
        this.dynamicEntries = dynamicEntries;
        this.dynamicMesh = this.buildBatch(dynamicEntries, true);
        if (this.root.children.length) this.game.scene.add(this.root);
    }

    update() {
        if (!this.dynamicMesh) return;
        for (let index = 0; index < this.dynamicEntries.length; index++) {
            this.setMatrix(this.dynamicMesh, index, this.dynamicEntries[index], true);
        }
        this.dynamicMesh.instanceMatrix.needsUpdate = true;
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
            !root.userData.skipRenderBatch &&
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

// Lightweight vertex wind for the dry grass tufts.  It deliberately uses the
// local blade height for the bend amount, so it also works when the props are
// rendered through CatAdventureRenderBatcher as InstancedMesh objects.
class CatAdventureDryGrassWind {
    constructor(game) {
        this.game = game;
        this.time = 0;
        this.shaders = [];
    }

    build() {
        for (const tuft of this.game.mapObjects) {
            const type = tuft.userData.assetType || {};
            const id = `${type.id || ""} ${type.name || ""} ${type.glb || ""}`;
            if (!/gras-tuftdry(?:\.glb)?/i.test(id)) continue;

            tuft.traverse(mesh => {
                if (!mesh.isMesh || !mesh.geometry) return;
                mesh.geometry.computeBoundingBox();
                const bounds = mesh.geometry.boundingBox;
                if (!bounds) return;

                const localBaseY = bounds.min.y;
                const localHeight = Math.max(0.05, bounds.max.y - bounds.min.y);
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const material of materials) {
                    this.addMaterialWind(material, localBaseY, localHeight);
                }
            });
        }
    }

    addMaterialWind(material, localBaseY, localHeight) {
        if (!material || material.userData.dryGrassWindAdded) return;
        material.userData.dryGrassWindAdded = true;

        material.onBeforeCompile = shader => {
            shader.uniforms.dryGrassWindTime = { value: 0 };
            shader.uniforms.dryGrassWindBaseY = { value: localBaseY };
            shader.uniforms.dryGrassWindHeight = { value: localHeight };
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", `#include <common>
                    uniform float dryGrassWindTime;
                    uniform float dryGrassWindBaseY;
                    uniform float dryGrassWindHeight;`)
                .replace("#include <begin_vertex>", `#include <begin_vertex>
                    // Instance-aware world position gives every tuft its own
                    // stable phase without adding per-instance attributes.
                    #ifdef USE_INSTANCING
                        vec3 dryGrassWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
                    #else
                        vec3 dryGrassWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                    #endif
                    float dryGrassTip = pow(clamp((transformed.y - dryGrassWindBaseY) / dryGrassWindHeight, 0.0, 1.0), 1.55);
                    float dryGrassPhase = dot(dryGrassWorldPosition.xz, vec2(0.61, 0.79));
                    float dryGrassSway = sin(dryGrassWindTime * 2.1 + dryGrassPhase)
                        + 0.42 * sin(dryGrassWindTime * 3.8 - dryGrassPhase * 1.37);
                    transformed.x += dryGrassSway * dryGrassTip * 0.048;
                    transformed.z += dryGrassSway * dryGrassTip * 0.026;`);
            material.userData.dryGrassWindShader = shader;
            this.shaders.push(shader);
        };
    }

    update(deltaSeconds) {
        this.time += deltaSeconds;
        for (const shader of this.shaders) shader.uniforms.dryGrassWindTime.value = this.time;
    }
}

// Subtle shader-based sway for tree.glb.  The map object's transform never
// changes, so its collision shape stays fixed while the visible upper tree
// moves in the breeze.
class CatAdventureTreeWind {
    constructor(game) {
        this.game = game;
        this.time = 0;
        this.shaders = [];
    }

    build() {
        for (const tree of this.game.mapObjects) {
            const glb = tree.userData.assetType?.glb || "";
            if (!/tree\.glb$/i.test(glb)) continue;

            tree.traverse(mesh => {
                if (!mesh.isMesh || !mesh.geometry) return;
                // Local bounds are identical for every tree GLB instance.
                // That makes the bend work both before and after the render
                // batcher moves the trees into one InstancedMesh.
                mesh.geometry.computeBoundingBox();
                const bounds = mesh.geometry.boundingBox;
                if (!bounds) return;
                const baseY = bounds.min.y;
                const height = Math.max(0.01, bounds.max.y - baseY);
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const material of materials) this.addMaterialWind(material, baseY, height);
            });
        }
    }

    addMaterialWind(material, baseY, height) {
        if (!material || material.userData.treeWindAdded) return;
        material.userData.treeWindAdded = true;
        material.onBeforeCompile = shader => {
            shader.uniforms.treeWindTime = { value: 0 };
            shader.uniforms.treeWindBaseY = { value: baseY };
            shader.uniforms.treeWindHeight = { value: height };
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", `#include <common>
                    uniform float treeWindTime;
                    uniform float treeWindBaseY;
                    uniform float treeWindHeight;`)
                .replace("#include <begin_vertex>", `#include <begin_vertex>
                    // Instanced trees need their per-instance world position
                    // for a unique, stable wind phase. The bend itself stays
                    // in local space so each trunk remains planted.
                    #ifdef USE_INSTANCING
                        vec3 treeWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
                    #else
                        vec3 treeWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
                    #endif
                    float treeTip = pow(clamp((transformed.y - treeWindBaseY) / treeWindHeight, 0.0, 1.0), 1.75);
                    float treePhase = dot(treeWorldPosition.xz, vec2(0.31, 0.67));
                    float treeWind = sin(treeWindTime * 2.7 + treePhase)
                        + 0.35 * sin(treeWindTime * 4.9 - treePhase * 1.4);
                    transformed.x += treeWind * treeTip * 0.145;
                    transformed.z += treeWind * treeTip * 0.125;`);
            material.userData.treeWindShader = shader;
            this.shaders.push(shader);
        };
        material.needsUpdate = true;
    }

    update(deltaSeconds) {
        this.time += deltaSeconds;
        for (const shader of this.shaders) shader.uniforms.treeWindTime.value = this.time;
    }
}

// dryfield.glb is authored as a broad flat brush. Map tiles can overlap while
// painting the field, so render their 2D polygon union rather than stacking
// coplanar textured planes that fight for the same depth pixels.
class CatAdventureDryField {
    constructor(game) {
        this.game = game;
        this.root = null;
        this.textureWorldWidth = 28.52;
        this.textureWorldDepth = 27.68;
    }

    build() {
        const fields = this.game.mapObjects.filter(object =>
            /dryfield\.glb$/i.test(object.userData.assetType?.glb || "")
        );
        if (!fields.length || !window.polygonClipping?.union || !this.game.water) return;

        const brushes = [];
        let sourceMaterial = null;
        let surfaceY = 0.012;
        for (const field of fields) {
            field.updateWorldMatrix(true, true);
            const boundaryEdges = new Map();
            field.traverse(mesh => {
                if (!mesh.isMesh) return;
                sourceMaterial ||= Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
                this.game.water.collectBoundaryEdges(mesh, boundaryEdges);
                const bounds = new THREE.Box3().setFromObject(mesh);
                surfaceY = Math.max(surfaceY, bounds.max.y + 0.002);
            });
            for (const loop of this.game.water.getBoundaryLoops(boundaryEdges)) {
                if (loop.length < 3) continue;
                const ring = loop.map(point => [point.x, point.z]);
                ring.push([...ring[0]]);
                brushes.push([ring]);
            }
        }
        if (!brushes.length || !sourceMaterial) return;

        const union = window.polygonClipping.union(...brushes);
        if (!union.length) return;
        this.union = union;

        const material = sourceMaterial.clone();
        if (sourceMaterial.map) {
            material.map = sourceMaterial.map.clone();
            material.map.wrapS = THREE.RepeatWrapping;
            material.map.wrapT = THREE.RepeatWrapping;
            material.map.needsUpdate = true;
        }
        material.polygonOffset = false;
        material.needsUpdate = true;
        // This union mesh is generated rather than stored in mapObjects, so
        // add it to the distance-background fade explicitly.
        this.game.addBackgroundFadeToMaterial(material, this.game.skyTexture);

        const geometries = [];
        for (const polygon of union) {
            const shape = this.toShape(polygon[0]);
            for (let index = 1; index < polygon.length; index++) shape.holes.push(this.toPath(polygon[index]));
            const geometry = new THREE.ShapeGeometry(shape);
            geometry.rotateX(-Math.PI / 2);
            this.setWorldRepeatingUVs(geometry);
            geometries.push(geometry);
        }
        const geometry = geometries.length === 1
            ? geometries[0]
            : THREE.mergeGeometries?.(geometries, false);
        if (!geometry) {
            geometries.forEach(item => item.dispose());
            return;
        }
        if (geometry !== geometries[0]) geometries.forEach(item => item.dispose());

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "Combined dryfield union";
        mesh.position.y = surfaceY;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.userData.skipRenderBatch = true;
        this.root = new THREE.Group();
        this.root.name = "Combined dryfield";
        this.root.add(mesh);
        this.game.scene.add(this.root);

        for (const field of fields) {
            field.visible = false;
            field.userData.skipRenderBatch = true;
        }
    }

    containsPoint(x, z) {
        if (!this.union) return false;
        return this.union.some(polygon =>
            this.pointInRing(x, z, polygon[0]) &&
            !polygon.slice(1).some(hole => this.pointInRing(x, z, hole))
        );
    }

    pointInRing(x, z, ring) {
        let inside = false;
        for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
            const [ax, az] = ring[index];
            const [bx, bz] = ring[previous];
            const crosses = (az > z) !== (bz > z) &&
                x < (bx - ax) * (z - az) / (bz - az || Number.EPSILON) + ax;
            if (crosses) inside = !inside;
        }
        return inside;
    }

    toPath(ring) {
        const path = new THREE.Path();
        ring.slice(0, -1).forEach(([x, z], index) => {
            if (index === 0) path.moveTo(x, -z);
            else path.lineTo(x, -z);
        });
        path.closePath();
        return path;
    }

    toShape(ring) {
        const shape = new THREE.Shape();
        ring.slice(0, -1).forEach(([x, z], index) => {
            if (index === 0) shape.moveTo(x, -z);
            else shape.lineTo(x, -z);
        });
        shape.closePath();
        return shape;
    }

    setWorldRepeatingUVs(geometry) {
        const position = geometry.getAttribute("position");
        const uv = new Float32Array(position.count * 2);
        for (let index = 0; index < position.count; index++) {
            uv[index * 2] = position.getX(index) / this.textureWorldWidth;
            uv[index * 2 + 1] = position.getZ(index) / this.textureWorldDepth;
        }
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
}


// Shoreline foam tuning. These are world-space units and intentionally live
// together so the look can be adjusted without touching the mesh builder.
const CAT_ADVENTURE_FOAM = {
    width: 1,
    opacity: 0.42,
    color: 0xd9efff,
    animationSpeed: 0.36,
    irregularity: 0.075,
    verticalOffset: 0.018
};

const CAT_ADVENTURE_LAKE = {
    waterLevel: -0.22,
    groundThickness: 0.60,
    bankWidth: 1.15,
    bankWidthVariation: 0.80,
    bankColor: 0x806344
};

// A small material patch rather than a separate mesh: it keeps water.glb's
// existing outline/collision intact and also works on render-batched pieces.
class CatAdventureWater {
    constructor(game) {
        this.game = game;
        this.time = 0;
        this.shaders = [];
        this.foamShaders = [];
        this.foamRoot = null;
        this.foam = CAT_ADVENTURE_FOAM;
    }

    build() {
        const brushes = [];
        for (const water of this.game.mapObjects) {
            const type = water.userData.assetType || {};
            if (!/water/i.test(type.id || "") && !/water/i.test(type.name || "")) continue;
            water.updateWorldMatrix(true, true);
            const boundaryEdges = new Map();
            water.traverse(mesh => {
                if (!mesh.isMesh) return;
                this.collectBoundaryEdges(mesh, boundaryEdges);
            });
            for (const loop of this.getBoundaryLoops(boundaryEdges)) {
                if (loop.length < 3) continue;
                const ring = loop.map(point => [point.x, point.z]);
                ring.push([...ring[0]]);
                brushes.push([ring]);
            }
            // The original GLB remains in mapObjects for the existing water
            // collision/wading queries, but is no longer rendered or batched.
            water.visible = false;
            water.userData.skipRenderBatch = true;
        }
        if (!brushes.length) return;
        if (!window.polygonClipping?.union) {
            console.error("Lake generation needs js/polygon-clipping.umd.min.js.");
            return;
        }
        const union = window.polygonClipping.union(...brushes);
        this.buildLakeFromUnion(union);
    }

    getBoundaryLoops(edges) {
        const boundaryEdges = [...edges.values()].filter(edge => edge.count === 1);
        const byVertex = new Map();
        for (const edge of boundaryEdges) {
            for (const key of [edge.aKey, edge.bKey]) {
                if (!byVertex.has(key)) byVertex.set(key, []);
                byVertex.get(key).push(edge);
            }
        }
        const used = new Set();
        const loops = [];
        for (const first of boundaryEdges) {
            if (used.has(first)) continue;
            const loop = [first.a.clone()];
            let current = first;
            let currentKey = first.bKey;
            const startKey = first.aKey;
            used.add(first);
            loop.push(first.b.clone());
            while (currentKey !== startKey) {
                const next = (byVertex.get(currentKey) || []).find(edge => !used.has(edge));
                if (!next) break;
                used.add(next);
                const advancesFromA = next.aKey === currentKey;
                currentKey = advancesFromA ? next.bKey : next.aKey;
                loop.push((advancesFromA ? next.b : next.a).clone());
                current = next;
            }
            if (currentKey === startKey) loop.pop();
            if (loop.length >= 3) loops.push(loop);
        }
        return loops;
    }

    buildLakeFromUnion(union) {
        this.rebuildGroundWithLakeHoles(union);
        this.buildLoweredWater(union);
        this.buildLakeBank(union);
        this.buildUnionFoam(union);
    }

    toLakePath(ring) {
        const path = new THREE.Path();
        ring.slice(0, -1).forEach(([x, z], index) => {
            if (index === 0) path.moveTo(x, -z);
            else path.lineTo(x, -z);
        });
        path.closePath();
        return path;
    }

    toLakeShape(ring) {
        const shape = new THREE.Shape();
        ring.slice(0, -1).forEach(([x, z], index) => {
            if (index === 0) shape.moveTo(x, -z);
            else shape.lineTo(x, -z);
        });
        shape.closePath();
        return shape;
    }

    rebuildGroundWithLakeHoles(union) {
        const shape = new THREE.Shape();
        shape.moveTo(-200, 200);
        shape.lineTo(200, 200);
        shape.lineTo(200, -200);
        shape.lineTo(-200, -200);
        shape.closePath();
        for (const polygon of union) shape.holes.push(this.toLakePath(polygon[0]));
        // Keep the grass surface at y = 0, but give the terrain a real
        // underside. ExtrudeGeometry also creates the hole's inner walls,
        // making the lake feel cut into a solid piece of ground.
        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: CAT_ADVENTURE_LAKE.groundThickness,
            steps: 1,
            bevelEnabled: false
        });
        geometry.translate(0, 0, -CAT_ADVENTURE_LAKE.groundThickness);
        const position = geometry.getAttribute("position");
        const uv = new Float32Array(position.count * 2);
        for (let index = 0; index < position.count; index++) {
            uv[index * 2] = (position.getX(index) + 200) / 400;
            uv[index * 2 + 1] = (-position.getY(index) + 200) / 400;
        }
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geometry.computeVertexNormals();
        this.game.ground.geometry.dispose();
        this.game.ground.geometry = geometry;
    }

    buildLoweredWater(union) {
        this.lakeRoot?.removeFromParent();
        this.lakeRoot = new THREE.Group();
        this.lakeRoot.name = "Generated lake water";
        const material = new THREE.MeshStandardMaterial({ color: 0x1550aa, roughness: 0.26, metalness: 0.06 });
        this.addWaterMaterial(material);
        for (const polygon of union) {
            const shape = this.toLakeShape(polygon[0]);
            for (let index = 1; index < polygon.length; index++) shape.holes.push(this.toLakePath(polygon[index]));
            const geometry = new THREE.ShapeGeometry(shape);
            geometry.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = CAT_ADVENTURE_LAKE.waterLevel;
            mesh.receiveShadow = true;
            this.lakeRoot.add(mesh);
        }
        this.game.scene.add(this.lakeRoot);
    }

    buildLakeBank(union) {
        this.bankRoot?.removeFromParent();
        const positions = [];
        const colors = [];
        for (const polygon of union) this.appendBankRing(positions, colors, polygon[0]);
        if (!positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 1,
            flatShading: true,
            vertexColors: true,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "Generated lake bank";
        mesh.receiveShadow = true;
        this.bankRoot = new THREE.Group();
        this.bankRoot.add(mesh);
        this.game.scene.add(this.bankRoot);
    }

    appendBankRing(positions, colors, ring) {
        const points = ring.slice(0, -1);
        const inset = this.getInsetRing(ring);
        for (let index = 0; index < points.length; index++) {
            const a = points[index], b = points[(index + 1) % points.length];
            // The bank begins at the actual grass/hole edge, then slopes
            // inward over the water. This conceals the ground slab's inner
            // wall instead of leaving a dark vertical trench visible.
            const outerA = [a[0], 0, a[1]];
            const outerB = [b[0], 0, b[1]];
            const innerA = [inset[index][0], CAT_ADVENTURE_LAKE.waterLevel, inset[index][1]];
            const nextIndex = (index + 1) % points.length;
            const innerB = [inset[nextIndex][0], CAT_ADVENTURE_LAKE.waterLevel, inset[nextIndex][1]];
            this.pushBankTriangle(positions, colors, outerA, outerB, innerB,
                inset[index].bankShade, inset[nextIndex].bankShade, inset[nextIndex].bankShade * 0.88);
            this.pushBankTriangle(positions, colors, outerA, innerB, innerA,
                inset[index].bankShade, inset[nextIndex].bankShade * 0.88, inset[index].bankShade * 0.88);
        }
    }

    pushBankTriangle(positions, colors, a, b, c, shadeA, shadeB, shadeC) {
        const base = new THREE.Color(CAT_ADVENTURE_LAKE.bankColor);
        for (const [point, shade] of [[a, shadeA], [b, shadeB], [c, shadeC]]) {
            positions.push(...point);
            colors.push(base.r * shade, base.g * shade, base.b * shade);
        }
    }

    getInsetRing(ring) {
        const points = ring.slice(0, -1);
        const area = points.reduce((sum, point, index) => {
            const next = points[(index + 1) % points.length];
            return sum + point[0] * next[1] - next[0] * point[1];
        }, 0);
        const inwardNormal = (from, to) => {
            const dx = to[0] - from[0], dz = to[1] - from[1];
            const length = Math.hypot(dx, dz) || 1;
            return area >= 0 ? [-dz / length, dx / length] : [dz / length, -dx / length];
        };
        const segmentLengths = points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            return Math.hypot(next[0] - point[0], next[1] - point[1]);
        });
        const perimeter = segmentLengths.reduce((sum, length) => sum + length, 0) || 1;
        const phase = this.foamJitter(`${points[0][0]},${points[0][1]}`) * Math.PI;
        let distanceAlongShore = 0;
        return points.map((point, index) => {
            const previous = points[(index - 1 + points.length) % points.length];
            const next = points[(index + 1) % points.length];
            const before = inwardNormal(previous, point);
            const after = inwardNormal(point, next);
            let mx = before[0] + after[0], mz = before[1] + after[1];
            const miterLength = Math.hypot(mx, mz);
            if (miterLength < 0.0001) {
                mx = after[0];
                mz = after[1];
            } else {
                mx /= miterLength;
                mz /= miterLength;
            }
            // Clamp sharp miters so a very acute editor-made corner cannot
            // throw a long spike across a narrow lake channel.
            const denominator = Math.max(0.45, mx * after[0] + mz * after[1]);
            const shoreT = distanceAlongShore / perimeter;
            // Two broad cycles around the whole ring make the width drift
            // naturally, rather than giving each editor vertex its own jitter.
            const broadWave = 0.68 * Math.sin(shoreT * Math.PI * 4 + phase) +
                0.32 * Math.sin(shoreT * Math.PI * 2 - phase * 0.7);
            const widthScale = 1 + broadWave * CAT_ADVENTURE_LAKE.bankWidthVariation;
            const distance = Math.min(CAT_ADVENTURE_LAKE.bankWidth * widthScale / denominator,
                CAT_ADVENTURE_LAKE.bankWidth * 1.8);
            const insetPoint = [point[0] + mx * distance, point[1] + mz * distance];
            insetPoint.bankShade = 1 + broadWave * 0.10 +
                Math.sin(shoreT * Math.PI * 2 + phase * 1.9) * 0.035;
            distanceAlongShore += segmentLengths[index];
            return insetPoint;
        });
    }

    buildUnionFoam(union) {
        const edges = new Map();
        for (const polygon of union) {
            const ring = polygon[0];
            const inset = this.getInsetRing(ring);
            for (let index = 0; index < ring.length - 1; index++) {
                const nextIndex = (index + 1) % inset.length;
                const a = new THREE.Vector3(inset[index][0], CAT_ADVENTURE_LAKE.waterLevel, inset[index][1]);
                const b = new THREE.Vector3(inset[nextIndex][0], CAT_ADVENTURE_LAKE.waterLevel, inset[nextIndex][1]);
                const lakeCenter = new THREE.Vector3(ring[index][0], 0, ring[index][1])
                    .add(new THREE.Vector3(ring[index + 1][0], 0, ring[index + 1][1]))
                    .multiplyScalar(0.5);
                const foamMidpoint = a.clone().add(b).multiplyScalar(0.5);
                const foamInward = foamMidpoint.clone().sub(lakeCenter).normalize();
                this.addBoundaryEdge(edges, a, b, foamMidpoint.addScaledVector(foamInward, 0.25));
            }
        }
        this.buildShorelineFoam(edges, CAT_ADVENTURE_LAKE.waterLevel);
    }

    collectBoundaryEdges(mesh, edges) {
        const position = mesh.geometry?.getAttribute("position");
        if (!position) return;
        const index = mesh.geometry.index;
        const vertexCount = index ? index.count : position.count;
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const edgeAB = new THREE.Vector3();
        const edgeAC = new THREE.Vector3();
        const normal = new THREE.Vector3();

        const readVertex = (vertexIndex, target) => {
            const resolvedIndex = index ? index.getX(vertexIndex) : vertexIndex;
            return target.fromBufferAttribute(position, resolvedIndex).applyMatrix4(mesh.matrixWorld);
        };
        for (let triangle = 0; triangle + 2 < vertexCount; triangle += 3) {
            readVertex(triangle, a);
            readVertex(triangle + 1, b);
            readVertex(triangle + 2, c);
            normal.crossVectors(edgeAB.subVectors(b, a), edgeAC.subVectors(c, a)).normalize();
            // The foam belongs only to upward-facing lake surface triangles;
            // side walls or undersides in a GLB must not create ribbons.
            if (normal.y < 0.35) continue;
            this.addBoundaryEdge(edges, a, b, c);
            this.addBoundaryEdge(edges, b, c, a);
            this.addBoundaryEdge(edges, c, a, b);
        }
    }

    addBoundaryEdge(edges, a, b, insidePoint) {
        const aKey = this.boundaryVertexKey(a);
        const bKey = this.boundaryVertexKey(b);
        const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
        const existing = edges.get(key);
        if (existing) {
            existing.count++;
            return;
        }
        edges.set(key, {
            count: 1,
            a: a.clone(),
            b: b.clone(),
            inside: insidePoint.clone(),
            aKey,
            bKey
        });
    }

    boundaryVertexKey(position) {
        // Millimetre precision is plenty for this stylized world, while also
        // matching duplicated GLB vertices and adjacent water pieces.
        return `${Math.round(position.x * 1000)},${Math.round(position.y * 1000)},${Math.round(position.z * 1000)}`;
    }

    buildShorelineFoam(edges, surfaceY = null) {
        if (this.foamRoot) {
            this.game.scene.remove(this.foamRoot);
            this.foamRoot.traverse(object => {
                object.geometry?.dispose?.();
                object.material?.dispose?.();
            });
        }
        this.foamShaders.length = 0;
        const positions = [];
        const foamEdge = [];
        const inward = new THREE.Vector3();
        const midpoint = new THREE.Vector3();

        for (const edge of edges.values()) {
            if (edge.count !== 1) continue;
            midpoint.addVectors(edge.a, edge.b).multiplyScalar(0.5);
            inward.subVectors(edge.inside, midpoint);
            inward.y = 0;
            if (inward.lengthSq() < 0.000001) continue;
            inward.normalize();

            const jitterA = this.foamJitter(edge.aKey);
            const jitterB = this.foamJitter(edge.bKey);
            const outerA = edge.a.clone().addScaledVector(inward, jitterA * this.foam.irregularity);
            const outerB = edge.b.clone().addScaledVector(inward, jitterB * this.foam.irregularity);
            const innerA = outerA.clone().addScaledVector(inward,
                this.foam.width * (1 + jitterA * 0.45));
            const innerB = outerB.clone().addScaledVector(inward,
                this.foam.width * (1 + jitterB * 0.45));
            const height = (surfaceY ?? Math.max(edge.a.y, edge.b.y)) + this.foam.verticalOffset;
            outerA.y = outerB.y = innerA.y = innerB.y = height;

            // Two triangles per boundary edge: opaque-ish at the shore edge,
            // fading gently into the water at the inner edge.
            this.pushFoamTriangle(positions, foamEdge, outerA, outerB, innerB, 0, 0, 1);
            this.pushFoamTriangle(positions, foamEdge, outerA, innerB, innerA, 0, 1, 1);
        }

        if (!positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("foamEdge", new THREE.Float32BufferAttribute(foamEdge, 1));
        geometry.computeBoundingSphere();

        const material = this.createFoamMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "Water shoreline foam";
        mesh.renderOrder = 1;
        this.foamRoot = new THREE.Group();
        this.foamRoot.name = "CatAdventure shoreline foam";
        this.foamRoot.add(mesh);
        this.game.scene.add(this.foamRoot);
    }

    pushFoamTriangle(positions, foamEdge, a, b, c, edgeA, edgeB, edgeC) {
        for (const [point, edge] of [[a, edgeA], [b, edgeB], [c, edgeC]]) {
            positions.push(point.x, point.y, point.z);
            foamEdge.push(edge);
        }
    }

    foamJitter(key) {
        let hash = 2166136261;
        for (let index = 0; index < key.length; index++) {
            hash ^= key.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return ((hash >>> 0) / 4294967295) * 2 - 1;
    }

    createFoamMaterial() {
        const material = new THREE.MeshBasicMaterial({
            color: this.foam.color,
            transparent: true,
            opacity: this.foam.opacity,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        material.onBeforeCompile = shader => {
            shader.uniforms.foamTime = { value: 0 };
            shader.uniforms.foamSpeed = { value: this.foam.animationSpeed };
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", `#include <common>
                    attribute float foamEdge;
                    uniform float foamTime;
                    uniform float foamSpeed;
                    varying float vFoamEdge;
                    varying float vFoamPulse;`)
                .replace("#include <begin_vertex>", `#include <begin_vertex>
                    float foamPhase = dot(position.xz, vec2(2.13, 1.27)) + foamTime * foamSpeed;
                    transformed.y += sin(foamPhase) * 0.006;
                    vFoamEdge = foamEdge;
                    vFoamPulse = 0.88 + sin(foamPhase * 1.7) * 0.12;`);
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", `#include <common>
                    varying float vFoamEdge;
                    varying float vFoamPulse;`)
                .replace("#include <color_fragment>", `#include <color_fragment>
                    diffuseColor.a *= mix(1.0, 0.12, vFoamEdge) * vFoamPulse;`);
            material.userData.foamShader = shader;
            this.foamShaders.push(shader);
        };
        material.needsUpdate = true;
        return material;
    }

    addWaterMaterial(material) {
        if (!material || material.userData.waterShaderAdded) return;
        material.userData.waterShaderAdded = true;
        // Water pieces overlap along the irregular shoreline. Keeping them
        // opaque lets the depth buffer hide those joins instead of blending
        // them into visible rectangular patches.
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.roughness = 0.26;
        material.metalness = 0.06;
        material.onBeforeCompile = shader => {
            shader.uniforms.waterTime = { value: 0 };
            shader.vertexShader = shader.vertexShader
                .replace("#include <common>", `#include <common>
                    uniform float waterTime;
                    varying vec2 waterWorldXZ;
                    varying vec3 waterWorldPosition;

                    // A small real displacement makes the generated lake read
                    // as low-poly water. It is vertex-only and deliberately
                    // shallow, so it remains inexpensive on mobile GPUs.
                    float getWaterVertexHeight(vec2 position, float time) {
                        vec2 warped = position + vec2(
                            sin(dot(position, vec2(0.17, 0.23)) + time * 0.19),
                            cos(dot(position, vec2(-0.21, 0.14)) - time * 0.16)
                        ) * 0.38;
                        float height = sin(dot(warped, normalize(vec2(0.82, 0.57))) * 0.54 + time * 0.66) * 0.052;
                        height += sin(dot(warped, normalize(vec2(-0.34, 0.94))) * 0.91 - time * 0.48) * 0.033;
                        height += sin(dot(warped, normalize(vec2(0.97, -0.24))) * 1.43 + time * 0.91) * 0.019;
                        height += sin(dot(warped, normalize(vec2(-0.69, -0.72))) * 2.08 - time * 1.12) * 0.011;
                        return height;
                    }`)
                .replace("#include <begin_vertex>", `#include <begin_vertex>
                    vec3 waterPosition = transformed;
                    #ifdef USE_INSTANCING
                        vec3 waterWorldPos = (modelMatrix * instanceMatrix * vec4(waterPosition, 1.0)).xyz;
                    #else
                        vec3 waterWorldPos = (modelMatrix * vec4(waterPosition, 1.0)).xyz;
                    #endif
                    // Colour ripples keep adjacent water pieces perfectly
                    // joined, unlike moving their separate mesh edges.
                    waterWorldXZ = waterWorldPos.xz;
                    waterWorldPosition = waterWorldPos;
                    transformed.y += getWaterVertexHeight(waterWorldPos.xz, waterTime) * 0.24;`);
            shader.fragmentShader = shader.fragmentShader
                .replace("#include <common>", `#include <common>
                    uniform float waterTime;
                    varying vec2 waterWorldXZ;
                    varying vec3 waterWorldPosition;

                    // Calm, layered swell. The low-frequency warp prevents
                    // the waves from reading as a fixed square/diagonal grid.
                    void getWaterWaves(vec2 position, float time, out float height, out vec2 gradient) {
                        vec2 warped = position;
                        warped += vec2(
                            sin(dot(position, vec2(0.17, 0.23)) + time * 0.19),
                            cos(dot(position, vec2(-0.21, 0.14)) - time * 0.16)
                        ) * 0.38;
                        height = 0.0;
                        gradient = vec2(0.0);

                        vec2 directionA = normalize(vec2(0.82, 0.57));
                        float phaseA = dot(warped, directionA) * 0.54 + time * 0.66;
                        height += sin(phaseA) * 0.052;
                        gradient += cos(phaseA) * directionA * 0.052 * 0.54;

                        vec2 directionB = normalize(vec2(-0.34, 0.94));
                        float phaseB = dot(warped, directionB) * 0.91 - time * 0.48;
                        height += sin(phaseB) * 0.033;
                        gradient += cos(phaseB) * directionB * 0.033 * 0.91;

                        vec2 directionC = normalize(vec2(0.97, -0.24));
                        float phaseC = dot(warped, directionC) * 1.43 + time * 0.91;
                        height += sin(phaseC) * 0.019;
                        gradient += cos(phaseC) * directionC * 0.019 * 1.43;

                        vec2 directionD = normalize(vec2(-0.69, -0.72));
                        float phaseD = dot(warped, directionD) * 2.08 - time * 1.12;
                        height += sin(phaseD) * 0.011;
                        gradient += cos(phaseD) * directionD * 0.011 * 2.08;
                    }`)
                .replace("#include <color_fragment>", `#include <color_fragment>
                    float waterHeight;
                    vec2 waterGradient;
                    getWaterWaves(waterWorldXZ, waterTime, waterHeight, waterGradient);
                    vec3 deepWater = vec3(0.018, 0.105, 0.31);
                    vec3 clearWater = vec3(0.045, 0.32, 0.72);
                    // Two very broad, slowly drifting fields keep large pools
                    // from reading as one perfectly even blue plane. Their
                    // amplitude is intentionally tiny so this stays painterly,
                    // not noisy or visibly procedural.
                    float broadTintA = sin(dot(waterWorldXZ, vec2(0.083, -0.047)) + waterTime * 0.055);
                    float broadTintB = sin(dot(waterWorldXZ, vec2(-0.031, 0.096)) - waterTime * 0.038 + 1.7);
                    float broadTint = broadTintA * 0.58 + broadTintB * 0.42;
                    float waterTone = clamp(0.57 + waterHeight * 1.45 + broadTint * 0.024, 0.0, 1.0);
                    vec3 waterNormalWorld = normalize(vec3(-waterGradient.x * 1.45, 1.0, -waterGradient.y * 1.45));
                    vec3 waterViewDirection = normalize(cameraPosition - waterWorldPosition);
                    float fresnel = pow(1.0 - clamp(dot(waterNormalWorld, waterViewDirection), 0.0, 1.0), 3.2);
                    vec3 baseWater = mix(deepWater, clearWater, waterTone);
                    // A gentle sky lift at grazing angles, kept painterly rather
                    // than mirror-like for the meadow's calm water.
                    diffuseColor.rgb = mix(baseWater, vec3(0.30, 0.56, 0.82), 0.08 + fresnel * 0.27);`)
                .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
                    float waterNormalHeight;
                    vec2 waterNormalGradient;
                    getWaterWaves(waterWorldXZ, waterTime, waterNormalHeight, waterNormalGradient);
                    vec3 animatedWaterNormalWorld = normalize(vec3(
                        -waterNormalGradient.x * 1.45,
                        1.0,
                        -waterNormalGradient.y * 1.45
                    ));
                    vec3 animatedWaterNormalView = normalize(mat3(viewMatrix) * animatedWaterNormalWorld);
                    // This is deliberately restrained: enough normal motion for
                    // travelling highlights, without turning calm water choppy.
                    normal = normalize(mix(normal, animatedWaterNormalView, 0.72));`);
            material.userData.waterShader = shader;
            this.shaders.push(shader);
        };
        material.needsUpdate = true;
    }

    update(deltaSeconds) {
        this.time += deltaSeconds;
        for (const shader of this.shaders) shader.uniforms.waterTime.value = this.time;
        for (const shader of this.foamShaders) shader.uniforms.foamTime.value = this.time;
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
          this.windTime = 0;
        this.nearDistance = 20;
        this.farDistance = 500;
        this.maxVisible = 150000;
        this.treeGrassRadius = 3;
        this.dummy = new THREE.Object3D();
        this.instanceColor = new THREE.Color();
        // Wall probes are only used for grid points inside a wall's world
        // bounds, so they retain the cheap terrain scatter while giving each
        // wall its own actual top height.
        this.wallRaycaster = new THREE.Raycaster();
        this.wallRayOrigin = new THREE.Vector3();
        this.wallRayDirection = new THREE.Vector3(0, -1, 0);
        this.wallNormal = new THREE.Vector3();
        this.texture = new THREE.TextureLoader().load("assets/grass-tuft.png");
        // Match the legacy terrain/GLB texture treatment in this project.
        this.texture.colorSpace = THREE.NoColorSpace;
    }

    build() {
        const exclusions = this.getExclusionOBBs();
        const bounds = this.getMapBounds();
        const treeCenters = this.getTreeCenters();
        const wallSurfaces = this.getWallSurfaces();
        // A stable jittered grid gives natural scatter without popping as the
        // player moves.  OBB rejection happens once, after every GLB is loaded.
        const spacing = 1;
        for (let z = bounds.minZ; z <= bounds.maxZ; z += spacing) {
            for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
                const hash = this.hash2(x, z);
                if (hash > 0.70) continue;
                const px = x + (this.hash2(x + 19.1, z) - 0.5) * spacing * 0.8;
                const pz = z + (this.hash2(x, z + 47.3) - 0.5) * spacing * 0.8;
                // A wall replaces the ground as this tuft's planting surface.
                // `getWallTopY` returns null outside a wall or on a vertical
                // face, leaving normal terrain grass at its original height.
                const wallTopY = this.getWallTopY(px, pz, wallSurfaces);
                // Preserve the existing grass-around-trees behavior on the
                // terrain, but let every valid wall top receive grass.
                if ((wallTopY === null && !this.isNearTree(px, pz, treeCenters)) ||
                    exclusions.some(zone => this.pointInExclusion(px, pz, zone))) continue;

                this.candidates.push({
                    x: px,
                    y: wallTopY === null ? 0.012 : wallTopY + 0.012,
                    z: pz,
                    // Used both for natural variation and distance thinning.
                    seed: this.hash2(x + 83.7, z + 11.4),
                    scale: 0.55 + this.hash2(x + 5.8, z + 3.2) * 0.65,
                    rotation: this.hash2(x + 9.4, z + 61.9) * Math.PI
                });
            }
        }

        // Do not reserve GPU buffers for a theoretical maximum. This keeps
        // the user's density/cap unchanged, but avoids the 1.8M-instance
        // allocation when the map only generated a fraction of that amount.
        this.capacity = Math.min(this.maxVisible, this.candidates.length);
        const geometry = this.createCrossedBladeGeometry();
        const material = this.createMaterial();
        this.game.addBackgroundFadeToMaterial(material, this.game.skyTexture);
        this.mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
        this.mesh.name = "Distance faded crossed-billboard grass";
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.root.add(this.mesh);
        this.game.scene.add(this.root);
        this.updateVisible(true);
    }

    getWallSurfaces() {
        return this.game.mapObjects
            .filter(obj => {
                const type = obj.userData.assetType || {};
                return /wall\.glb$/i.test(type.glb || "") ||
                    /^wall$/i.test(type.id || "") || /^wall$/i.test(type.name || "");
            })
            .map(wall => {
                wall.updateWorldMatrix(true, true);
                return { wall, bounds: new THREE.Box3().setFromObject(wall) };
            })
            .filter(({ bounds }) => !bounds.isEmpty());
    }

    getWallTopY(x, z, wallSurfaces) {
        let highestY = null;
        for (const { wall, bounds } of wallSurfaces) {
            // Avoid raycasting every map object for every terrain grid point.
            if (x < bounds.min.x || x > bounds.max.x ||
                z < bounds.min.z || z > bounds.max.z) continue;

            this.wallRayOrigin.set(x, bounds.max.y + 0.1, z);
            this.wallRaycaster.set(this.wallRayOrigin, this.wallRayDirection);
            const hits = this.wallRaycaster.intersectObject(wall, true);
            for (const hit of hits) {
                if (!hit.face) continue;
                // Raycasts can also meet the underside or a side edge. Only
                // accept faces that genuinely point upward in world space.
                this.wallNormal.copy(hit.face.normal)
                    .transformDirection(hit.object.matrixWorld);
                if (this.wallNormal.y < 0.5) continue;
                if (highestY === null || hit.point.y > highestY) {
                    highestY = hit.point.y;
                }
                break; // Raycaster returns this wall's hits nearest first.
            }
        }
        return highestY;
    }

      getExclusionOBBs() {
          return this.game.mapObjects
              .map(obj => {
                  const name = obj.userData.assetType?.name || obj.userData.mapObject?.name || "";
                  if (/^water$/i.test(name)) return this.makeWaterExclusion(obj);
                  if (!/^path$/i.test(name)) return null;
                  const box = this.game.worldSolver.getLocalBox(obj);
                  if (!box) return null;
                  obj.updateWorldMatrix(true, true);
                  return { inverse: obj.matrixWorld.clone().invert(), box, isWater: false };
              })
              .filter(Boolean);
      }
      getTreeCenters() {
        return this.game.mapObjects
            .filter(obj => /tree\.glb$/i.test(obj.userData.assetType?.glb || ""))
            .map(tree => {
                tree.updateWorldMatrix(true, false);
                return { x: tree.matrixWorld.elements[12], z: tree.matrixWorld.elements[14] };
            });
    }

    isNearTree(x, z, treeCenters) {
        const radiusSq = this.treeGrassRadius * this.treeGrassRadius;
        return treeCenters.some(tree => {
            const dx = x - tree.x, dz = z - tree.z;
            return dx * dx + dz * dz <= radiusSq;
        });
    }


      makeWaterExclusion(water) {
          water.updateWorldMatrix(true, true);
          const triangles = [];
          const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
          water.traverse(mesh => {
              if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
              const positions = mesh.geometry.attributes.position;
              const index = mesh.geometry.index;
              const vertex = new THREE.Vector3();
              const readVertex = i => vertex.fromBufferAttribute(positions, i)
                  .applyMatrix4(mesh.matrixWorld).clone();
              const triangleCount = index ? index.count / 3 : positions.count / 3;
              for (let i = 0; i < triangleCount; i++) {
                  const a = readVertex(index ? index.getX(i * 3) : i * 3);
                  const b = readVertex(index ? index.getX(i * 3 + 1) : i * 3 + 1);
                  const c = readVertex(index ? index.getX(i * 3 + 2) : i * 3 + 2);
                  // Vertical faces project to a line and naturally fail the
                  // point-in-triangle test; horizontal water faces remain.
                  triangles.push({ a, b, c });
                  for (const point of [a, b, c]) {
                      bounds.minX = Math.min(bounds.minX, point.x);
                      bounds.maxX = Math.max(bounds.maxX, point.x);
                      bounds.minZ = Math.min(bounds.minZ, point.z);
                      bounds.maxZ = Math.max(bounds.maxZ, point.z);
                  }
              }
          });
          return { isWater: true, triangles, bounds };
      }

      pointInExclusion(x, z, zone) {
          if (!zone.isWater) return this.pointInOBB(x, z, zone);
          if (x < zone.bounds.minX || x > zone.bounds.maxX ||
              z < zone.bounds.minZ || z > zone.bounds.maxZ) return false;
          return zone.triangles.some(({ a, b, c }) => {
              const cross = (u, v, px, pz) => (v.x - u.x) * (pz - u.z) - (v.z - u.z) * (px - u.x);
              const ab = cross(a, b, x, z), bc = cross(b, c, x, z), ca = cross(c, a, x, z);
              return (ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0);
          });
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
            const dx = Math.cos(angle) * 0.45, dz = Math.sin(angle) * 0.45;
            const verts = [
                -dx, 0, -dz, dx, 0, dz,
                dx, 0.45, dz, -dx, 0.45, -dz
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
            roughness: 1,
            map: this.texture,
            // Alpha-tested cutouts skip the transparent backdrop pixels and
            // write depth, hugely reducing overlapping billboard overdraw.
            alphaTest: 0.06,
            side: THREE.DoubleSide//,
           // emissive: new THREE.Color(0.10, 0.22, 0.055),
           // emissiveIntensity: 0.35

        });
        material.onBeforeCompile = shader => {
              shader.uniforms.grassCameraXZ = { value: new THREE.Vector2() };
              shader.uniforms.grassFadeNear = { value: this.nearDistance };
              shader.uniforms.grassFadeFar = { value: this.farDistance };
              shader.uniforms.grassWindTime = { value: 0 };
              shader.vertexShader = shader.vertexShader
                  .replace("#include <common>", `#include <common>
                      uniform vec2 grassCameraXZ;
                      uniform float grassFadeNear;
                      uniform float grassFadeFar;
                      uniform float grassWindTime;
                      varying float grassFade;`)
                  .replace("#include <begin_vertex>", `#include <begin_vertex>
                      // Keep the base planted, while the tips catch two quick,
                      // slightly out-of-sync gusts. The instance translation gives
                      // every tuft a stable, unique phase at no CPU cost.
                      float bladeTip = pow(clamp(transformed.y / 0.9, 0.0, 1.0), 1.65);
                      vec2 tuftPosition = instanceMatrix[3].xz;
                      float windPhase = dot(tuftPosition, vec2(0.73, 1.19));
                      float wind = sin(grassWindTime * 4.4 + windPhase)
                          + 0.38 * sin(grassWindTime * 7.1 - windPhase * 1.7);
                      transformed.x += wind * bladeTip * 0.115;
                      transformed.z += wind * bladeTip * 0.065;
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
          this.windTime += deltaSeconds;
          const grassShader = this.mesh.material.userData.grassShader;
          if (grassShader) grassShader.uniforms.grassWindTime.value = this.windTime;
          this.mesh.material.userData.grassShader?.uniforms.grassCameraXZ.value
            .set(this.game.camera.position.x, this.game.camera.position.z);
        this.refreshTimer += deltaSeconds;
       // if (this.refreshTimer < 0.20 && this.lastCamera.distanceToSquared(this.game.camera.position) < 9) return;
        this.refreshTimer = 0;
        this.updateVisible(false);
    }

    updateVisible(force) {
        const camera = this.game.camera.position;
        if (!force && this.lastCamera.distanceToSquared(camera) < 0.00001) return;
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
            if (grass.seed > density || count === this.capacity) continue;
            this.dummy.position.set(grass.x, grass.y, grass.z);
            this.dummy.rotation.set(0, grass.rotation, 0);
            this.dummy.scale.setScalar(grass.scale);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(count, this.dummy.matrix);
            const shade = 0.82 + grass.seed * 0.18;
            this.instanceColor.setRGB(0.32 * shade, 0.70 * shade, 0.18 * shade);
            this.mesh.setColorAt(count, this.instanceColor);
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

// Decorative clumps placed beside, rather than on, the long sides of paths.
// They deliberately use the path's local axes, so rotated path instances do
// not accidentally receive flowers across their short end caps.
class CatAdventurePathEdgeFlowers {
    constructor(game) {
        this.game = game;
        this.root = new THREE.Group();
        this.root.name = "Path-edge grass and flowers";
        this.dummy = new THREE.Object3D();
        this.texture = new THREE.TextureLoader().load("assets/path-edge-flowers.png");
        this.texture.colorSpace = THREE.NoColorSpace;
    }

    build() {
        const candidates = [];
        for (const path of this.game.mapObjects) {
            const type = path.userData.assetType || {};
            if (!/path\.glb$/i.test(type.glb || "") &&
                !/^path$/i.test(type.id || "") && !/^path$/i.test(type.name || "")) continue;
            const box = this.game.worldSolver.getLocalBox(path);
            if (!box) continue;
            path.updateWorldMatrix(true, true);
            this.addPathCandidates(path, box, candidates);
        }
        if (!candidates.length) return;

        const mesh = new THREE.InstancedMesh(
            this.createCrossedCardGeometry(), this.createMaterial(), candidates.length
        );
        mesh.name = "Path-edge flower clumps";
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        candidates.forEach((candidate, index) => {
            this.dummy.position.copy(candidate.position);
            this.dummy.rotation.set(0, candidate.rotation, 0);
            this.dummy.scale.setScalar(candidate.scale);
            this.dummy.updateMatrix();
            // The local path transform includes its map rotation and scale.
            this.dummy.matrix.premultiply(candidate.path.matrixWorld);
            mesh.setMatrixAt(index, this.dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.root.add(mesh);
        this.game.scene.add(this.root);
    }

    addPathCandidates(path, box, candidates) {
        const sizeX = box.max.x - box.min.x;
        const sizeZ = box.max.z - box.min.z;
        const longIsX = sizeX >= sizeZ;
        const longMin = longIsX ? box.min.x : box.min.z;
        const longMax = longIsX ? box.max.x : box.max.z;
        const shortMin = longIsX ? box.min.z-0.5 : box.min.x+0.5;
        const shortMax = longIsX ? box.max.z+0.5 : box.max.x-0.5;
        const length = longMax - longMin;
        // Keep a clear gap at both ends: no flowers on the path brim/end cap.
        const endInset = Math.min(0.7, length * 0.18);
        const spacing = 3;
        for (let t = longMin + endInset; t <= longMax - endInset; t += spacing) {
            for (const side of [-1, 1]) {
                const seed = this.hash(t + side * 29.4, path.position.x + path.position.z);
                if (seed > 0.78) continue;
                const shortPosition = (side < 0 ? shortMin : shortMax) + side * 0.14;
                const position = longIsX
                    ? new THREE.Vector3(t, box.max.y - 0.018, shortPosition)
                    : new THREE.Vector3(shortPosition, box.max.y - 0.018, t);
                candidates.push({
                    path,
                    position,
                    rotation: this.hash(t + 8.1, side * 13.7) * Math.PI,
                    scale: 0.6 + this.hash(t + 51.2, side * 7.4) * 0.18
                });
            }
        }
    }

    createCrossedCardGeometry() {
        const positions = [];
        const uvs = [];
        const indices = [];
        const addCard = angle => {
            const start = positions.length / 3;
            const dx = Math.cos(angle) * 0.52, dz = Math.sin(angle) * 0.52;
            positions.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
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
        return new THREE.MeshStandardMaterial({
            map: this.texture,
            alphaTest: 0.6,
            side: THREE.DoubleSide,
            roughness: 1,
            depthWrite: true
        });
    }

    hash(x, y) {
        const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
        return value - Math.floor(value);
    }
}
