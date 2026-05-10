

class TestThree {
    constructor() {
        
      
        this.updateCanvasSize();

        this.joy = new JoyStick('myCanvas');

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        this.renderer.shadowMap.enabled = true;
        
        this.texture = new THREE.TextureLoader().load("housewall.png");
        this.texture.wrapS = THREE.RepeatWrapping;
        this.texture.wrapT = THREE.RepeatWrapping;
        this.texture.repeat.set(2, 2);
        
        this.texture2 = new THREE.TextureLoader().load("grasyfield.png");
        this.texture2.wrapS = THREE.RepeatWrapping;
        this.texture2.wrapT = THREE.RepeatWrapping;
        this.texture2.repeat.set(2, 2);
        
        
        
        this.material = new THREE.MeshStandardMaterial({ map: this.texture });
        this.house = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this.material);
        this.house.castShadow = true;
        this.roof = this.createRoof();
        this.scene.add(this.roof);
        // ground texture valfritt
        const groundMat = new THREE.MeshStandardMaterial({
          map:this.texture2,
          color: 0xcccccc
        });

        this.ground = new THREE.Mesh(
          new THREE.PlaneGeometry(20, 20),
          groundMat
        );
        this.ground.receiveShadow = true;

        // plane ligger vertikalt från början, rotera ner den
        this.ground.rotation.x = -Math.PI / 2;

        // lägg den under huset
        this.ground.position.y = -1;

        this.scene.add(this.ground);

    
        this.scene.add(this.house);
        this.camera.position.z = 5;
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(5, 5, 5);
        light.castShadow = true;
        this.scene.add(light);

        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);
        
        this.camera.position.set(4, 3, 6);
        
        this.moveX = 0;
        this.moveZ = 0;
        
        
         this.player=null;

        
        
        
const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 22),
    new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
    })
);

shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -0.89;
shadow.renderOrder = 1;

this.scene.add(shadow);
this.shadow = shadow;

        this.cameraOffset = new THREE.Vector3(4, 5, 6);

        this.setupKeyboard();
        
        
        this.mixers = [];

        this.loadGLB("katt.glb", (model, animations) => {
            model.position.set(2, -1, 0);
            model.scale.setScalar(0.2);
            this.player = model;
            this.scene.add(this.player);
            

            const mixer = new THREE.AnimationMixer(model);
            this.mixers.push(mixer);

            const clip = THREE.AnimationClip.findByName(animations, "Animation 1");

            if (clip) {
                const action = mixer.clipAction(clip);
                action.play();
            } else {
                console.warn("Animation not found. Available animations:", animations.map(a => a.name));
            }
        });
        
        
        
        
        
        
        
        
        
        
        
        
        
        
    }
    createRoof() {
        const texture = new THREE.TextureLoader().load("roof.png");
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        
        const wallTexture = new THREE.TextureLoader().load("gavel.png");
        wallTexture.wrapS = THREE.RepeatWrapping;
        wallTexture.wrapT = THREE.RepeatWrapping;
        wallTexture.repeat.set(1, 1);
        
        
        
        const roof2 = new THREE.MeshStandardMaterial({map: texture,side: THREE.DoubleSide});
        const wall = new THREE.MeshStandardMaterial({map: wallTexture,side: THREE.DoubleSide});
        const materials = [roof2, wall];
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([
            // left sloped roof side
            -1.3, 1,  1.3,
             0.0, 2,  1.3,
             0.0, 2, -1.3,
            -1.3, 1, -1.3,

            // right sloped roof side
             0.0, 2,  1.3,
             1.3, 1,  1.3,
             1.3, 1, -1.3,
             0.0, 2, -1.3,

            // front triangle
            -1.3, 1, 1.3,
             1.3, 1, 1.3,
             0.0, 2, 1.3,

            // back triangle
             1.3, 1, -1.3,
            -1.3, 1, -1.3,
             0.0, 2, -1.3,
        ]);

        const uvs = new Float32Array([
            // left sloped side
            0, 0,
            0, 1,
            1, 1,
            1, 0,

            // right sloped side
            0, 1,
            0, 0,
            1, 0,
            1, 1,

            // front triangle
            0, 0,
            1, 0,
            0.5, 1,

            // back triangle
            0, 0,
            1, 0,
            0.5, 1,
        ]);

        const indices = [
            // left side
            0, 1, 2,
            0, 2, 3,

            // right side
            4, 5, 6,
            4, 6, 7,

            // front triangle
            8, 9, 10,

            // back triangle
            11, 12, 13
        ];

        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        
        geometry.clearGroups();

        // vänster tak (2 triangles = 6 indices)
        geometry.addGroup(0, 6, 0);

        // höger tak (2 triangles = 6 indices)
        geometry.addGroup(6, 6, 0);

        // front triangle (3 indices)
        geometry.addGroup(12, 3, 1);

        // back triangle (3 indices)
        geometry.addGroup(15, 3, 1);
        

        const roof = new THREE.Mesh(geometry, materials);
        roof.castShadow = true;
        return roof;
    }
    
    
    init(){

        requestAnimationFrame((t) => this.gameLoop(t));
        
    }
    update(scale, dt) {
        if (this.player == null) return;

        const speed = 0.06 * scale;

        this.player.position.x += this.moveX * speed;
        this.player.position.z += this.moveZ * speed;

        this.updateShadow();

        if (this.moveX !== 0 || this.moveZ !== 0) {
            const angle = Math.atan2(this.moveX, this.moveZ);
            this.player.rotation.y = angle + Math.PI;
        }

        const targetCamPos = this.player.position.clone().add(this.cameraOffset);
        this.camera.position.lerp(targetCamPos, 0.08);

        this.camera.lookAt(
            this.player.position.x,
            this.player.position.y + 0.5,
            this.player.position.z
        );

        for (const mixer of this.mixers) {
            mixer.update(dt); // sekunder
        }
    }  
    updateShadow() {
        if (!this.player || !this.shadow) return;

        const box = new THREE.Box3().setFromObject(this.player);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Framåt-riktning för modellen
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(this.player.quaternion);

        const forwardOffset = 0.35; // testa 0.2–0.6

        this.shadow.position.x = center.x + forward.x * forwardOffset;
        this.shadow.position.z = center.z + forward.z * forwardOffset;
        this.shadow.position.y = -0.89;

        const radius = Math.max(size.x, size.z) * 0.38;
        this.shadow.scale.set(radius, radius, 1);
    }
    
        
     draw(scale) {
        const resized = this.updateCanvasSize();

        if (resized) {
            this.camera.aspect = canvas.width / canvas.height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(canvas.width, canvas.height, false);
        }




       this.renderer.render(this.scene, this.camera);
        
        if("ontouchstart" in document.documentElement ){
                    this.keys["d"]=false;this.keys["a"] = false;this.keys["w"]=false;this.keys["s"] = false;
                    if(this.joy.GetDir()=="N"){this.keys["w"] = true;}
                    else if(this.joy.GetDir()=="NE"){this.keys["d"] = true;this.keys["w"] = true;}    
                    else if(this.joy.GetDir()=="E"){this.keys["d"] = true;}
                    else if(this.joy.GetDir()=="SE"){this.keys["d"] = true;this.keys["s"] = true;}    
                    else if(this.joy.GetDir()=="S"){this.keys["s"] = true;}
                    else if(this.joy.GetDir()=="SW"){this.keys["a"] = true;this.keys["s"] = true;}    
                    else if(this.joy.GetDir()=="W"){this.keys["a"] = true;}    
                    else if(this.joy.GetDir()=="NW"){this.keys["a"] = true;this.keys["w"] = true;}     
                    else if(this.joy.GetDir()=="C") {

                    }
                 this.updateMoveInput();   
                 this.joy.redraw();
                }
        
        
}

    gameLoop(time) {
        
      
        
        if (!this.lastTime) this.lastTime = time;

        let deltaMs = time - this.lastTime;
        this.lastTime = time;

        if (deltaMs > 50) deltaMs = 50;

        const scale = deltaMs / (1000 / 60);
        const dt = deltaMs / 1000; 
        this.update(scale,dt);
        this.draw(scale);

        requestAnimationFrame((t) => this.gameLoop(t));
    }
    updateCanvasSize() {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        if (this.lastCanvasScreenW === screenW && this.lastCanvasScreenH === screenH) {
            return false;
        }

        this.lastCanvasScreenW = screenW;
        this.lastCanvasScreenH = screenH;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        canvas2.width = window.innerWidth;
        canvas2.height = window.innerHeight;
        
  

    
        return true;
    }
    setupKeyboard() {
        this.keys = {};

        window.addEventListener("keydown", e => {
            this.keys[e.key.toLowerCase()] = true;
            this.updateMoveInput();
        });

        window.addEventListener("keyup", e => {
            this.keys[e.key.toLowerCase()] = false;
            this.updateMoveInput();
        });
    }

    updateMoveInput() {
        let x = 0;
        let z = 0;

        if (this.keys["a"] || this.keys["arrowleft"]) x -= 1;
        if (this.keys["d"] || this.keys["arrowright"]) x += 1;
        if (this.keys["w"] || this.keys["arrowup"]) z -= 1;
        if (this.keys["s"] || this.keys["arrowdown"]) z += 1;

        const len = Math.hypot(x, z);
        if (len > 0) {
            x /= len;
            z /= len;
        }

        this.moveX = x;
        this.moveZ = z;
    }
   loadGLB(path, callback) {
    const loader = new THREE.GLTFLoader();

    loader.load(path, (gltf) => {
        callback(gltf.scene, gltf.animations);
    });
}
    
}    
