

class MaxPaint3D {
    constructor() {
        this.move={x:0,z:0,y:0};
      
        this.updateCanvasSize();

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        
      
        const ambient = new THREE.AmbientLight(0xffffff, 1);
        this.scene.add(ambient);
        
        
        this.texture = new THREE.TextureLoader().load("texture.png");
        this.material = new THREE.MeshStandardMaterial({ map: this.texture });
        this.model = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this.material);
        this.scene.add(this.model);

        this.camera.position.set(4, 2, 6);
        this.setupKeyboard();
        this.setupMouse();

    }
    init(){
        requestAnimationFrame((t) => this.gameLoop(t));    
    }
    update(scale) {
        const speed = 0.06 * scale;
        
        // Framåt där kameran tittar
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);

        // håll rörelsen platt på X/Z-plan
        forward.y = 0;
        forward.normalize();

        // Höger/vänster relativt kameran
        const right = new THREE.Vector3();
        right.crossVectors(forward, this.camera.up).normalize();

        const moveVec = new THREE.Vector3();

        // W/S
        moveVec.addScaledVector(forward, -this.move.z);

        // A/D
        moveVec.addScaledVector(right, this.move.x);

        if (moveVec.lengthSq() > 0) {
            moveVec.normalize();
            this.camera.position.addScaledVector(moveVec, speed);
        }

        this.camera.position.y += this.move.y * speed;

        this.camera.lookAt(
            this.model.position.x,
            this.model.position.y,
            this.model.position.z
        );
    } 
    draw(scale) {
        const resized = this.updateCanvasSize();
        if (resized) {
            this.camera.aspect = canvas.width / canvas.height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(canvas.width, canvas.height, false);
        }
        this.renderer.render(this.scene, this.camera); 
    }

    gameLoop(time) {
        if (!this.lastTime) this.lastTime = time;
        let deltaMs = time - this.lastTime;
        this.lastTime = time;
        if (deltaMs > 50) deltaMs = 50;
        const scale = deltaMs / (1000 / 60);
        this.update(scale);
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
        let y = 0;
        
        if (this.keys["a"] || this.keys["arrowleft"]) x -= 1;
        if (this.keys["d"] || this.keys["arrowright"]) x += 1;
        
        if(this.keys["shift"]){
            if (this.keys["w"] || this.keys["arrowup"]) y -= 1;
            if (this.keys["s"] || this.keys["arrowdown"]) y += 1;
        }
        else{
            if (this.keys["w"] || this.keys["arrowup"]) z -= 1;
            if (this.keys["s"] || this.keys["arrowdown"]) z += 1;
        }
        const len = Math.hypot(x, z);
        if (len > 0) {
            x /= len;
            z /= len;
        }

        this.move.x = x;
        this.move.z = z;
        this.move.y = y;
    }
    
    setupMouse() {
        this.isRotating = false;
        this.lastMouse = { x: 0, y: 0 };
        
        window.addEventListener("contextmenu", (e) => {
            e.preventDefault();
        });
        
        window.addEventListener("mousedown", (e) => {
            e.preventDefault();
            
            if (e.button === 2) {  // right mouse
                this.isRotating = true;
                this.lastMouse.x = e.clientX;
                this.lastMouse.y = e.clientY;
            }
        });

        window.addEventListener("mouseup", (e) => {
            if (e.button === 2) {
                this.isRotating = false;
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (!this.isRotating) return;

            const dx = e.clientX - this.lastMouse.x;
            const dy = e.clientY - this.lastMouse.y;

            this.lastMouse.x = e.clientX;
            this.lastMouse.y = e.clientY;

            const rotSpeed = 0.005;

            this.model.rotation.y += dx * rotSpeed;
            this.model.rotation.x += dy * rotSpeed;

            // stoppa modellen från att gå över upp-och-ner
            const limit = Math.PI / 2 - 0.05;
            this.model.rotation.x = Math.max(-limit, Math.min(limit, this.model.rotation.x));
          
        });
    }
    
}    
