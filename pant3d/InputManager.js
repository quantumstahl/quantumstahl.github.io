class InputManager {
    constructor(canvas,app) {
        this.canvas = canvas;
        this.app=app;
        this.keys = {};
        this.mouse = {
            x: 0,
            y: 0,
            dx: 0,
            dy: 0,
            down: false,
            rightDown: false,
            justPressed: false,
            justReleased: false,
            wheel: 0
        };
    
        this.joy = new JoyStick('myCanvas');
        this._setupKeyboard();
        this._setupMouse();
        this._setupTouch();
    }

    update() {
        // reset per frame
     
        this.mouse.justPressed = false;
        this.mouse.justReleased = false;
        this.mouse.wheel = 0;
        
        if( mobileAndTabletCheck()){
            
                    
                    
                    if(this.app?.tools?.current === this.app?.tools?.tools.select){
                        
                        this.joy.SetDirectionMode(8);
                        
                        this.keys["d"]=false;this.keys["a"] = false;this.keys["w"]=false;this.keys["s"] = false;
                        if(this.joy.GetDir()=="N"){this.keys["w"] = true;}
                        else if(this.joy.GetDir()=="NE"){this.keys["d"] = true;this.keys["w"] = true;}    
                        else if(this.joy.GetDir()=="E"){this.keys["d"] = true;}
                        else if(this.joy.GetDir()=="SE"){this.keys["d"] = true;this.keys["s"] = true;}    
                        else if(this.joy.GetDir()=="S"){this.keys["s"] = true;}
                        else if(this.joy.GetDir()=="SW"){this.keys["a"] = true;this.keys["s"] = true;}    
                        else if(this.joy.GetDir()=="W"){this.keys["a"] = true;}    
                        else if(this.joy.GetDir()=="NW"){this.keys["a"] = true;this.keys["w"] = true;}     
                        else if(this.joy.GetDir()=="C") {}
                    }
                    else{
                        this.joy.SetDirectionMode(4);
                        
                        this.keys["d"]=false;this.keys["a"] = false;this.keys["w"]=false;this.keys["s"] = false;
                        if(this.joy.GetDir()=="N"){this.keys["w"] = true;}   
                        else if(this.joy.GetDir()=="E"){this.keys["d"] = true;}
                        else if(this.joy.GetDir()=="S"){this.keys["s"] = true;}
                        else if(this.joy.GetDir()=="W"){this.keys["a"] = true;}    
                        else if(this.joy.GetDir()=="C") {}
                        
                        
                    }
            
                 this.joy.redraw();
           
                }
        
        
    }

    // ------------------------
    // KEYBOARD
    // ------------------------
    _setupKeyboard() {
        window.addEventListener("keydown", e => {
            this.keys[e.key.toLowerCase()] = true;
        });

        window.addEventListener("keyup", e => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }

    isKeyDown(key) {
        return !!this.keys[key.toLowerCase()];
    }

    // ------------------------
    // MOUSE
    // ------------------------
    _setupMouse() {
        this.canvas.addEventListener("mousedown", e => {
            if (e.button === 0) {
                this.mouse.down = true;
                this.mouse.justPressed = true;
            }
            if (e.button === 2) {
                this.mouse.rightDown = true;
            }
        });

        window.addEventListener("mouseup", e => {
            if (e.button === 0) {
                this.mouse.down = false;
                this.mouse.justReleased = true;
            }
            if (e.button === 2) {
                this.mouse.rightDown = false;
            }
        });

        this.canvas.addEventListener("mousemove", e => {
            const rect = this.canvas.getBoundingClientRect();

            const newX = e.clientX - rect.left;
            const newY = e.clientY - rect.top;
            this.mouse.dx = 0;
            this.mouse.dy = 0;
            this.mouse.dx += newX - this.mouse.x;
            this.mouse.dy += newY - this.mouse.y;

            this.mouse.x = newX;
            this.mouse.y = newY;
        });

        this.canvas.addEventListener("wheel", e => {
            this.mouse.wheel += e.deltaY;
        });

        this.canvas.addEventListener("contextmenu", e => {
            e.preventDefault(); // disable right click menu
        });
    }
    _setupTouch() {
        this.canvas.addEventListener("touchstart", e => {
            e.preventDefault();
            const t = e.touches[0];
            if(this._isInsideJoystickZone(t))return;
            
            const pos = this._getCanvasPos(t);
            clearTimeout(this.touchTimer);
            
            this.touchTimer = setTimeout(() => {if(e.touches.length===1){
                    this.mouse.down = true;
                    this.mouse.rightDown = false;
                    this.mouse.justPressed = true;
                    
                }}, 200); // <-- delay (testa 80–120 ms)
                
                
                
            
            if(e.touches.length>1){clearTimeout(this.touchTimer);this.mouse.rightDown = true;this.mouse.down = false;this.mouse.justPressed = false;}
            
            
            this.mouse.x = pos.x;
            this.mouse.y = pos.y;
            this.mouse.dx = 0;
            this.mouse.dy = 0;
            
            const isLandscape = this.canvas.width > this.canvas.height;

            const btnSize = isLandscape
                ? Math.min(90, this.canvas.height * 0.18)
                : Math.min(150, this.canvas.width * 0.20);
            
            if(this.mouse.y>this.canvas.height-btnSize*1.5 || this.mouse.y<btnSize*0.5){
                this.mouse.down = true;
                    this.mouse.rightDown = false;
                    this.mouse.justPressed = true;
                
            }
            

            
        }, { passive: false });

        this.canvas.addEventListener("touchmove", e => {
            e.preventDefault();
         
            
            if (e.touches.length === 0 ) {
                this.mouse.dx = 0;
                this.mouse.dy = 0;
                
                
                return;
            }
            if(e.touches.length>1)clearTimeout(this.touchTimer);
            const t = e.touches[0];
            if(this._isInsideJoystickZone(t))return;
            const pos = this._getCanvasPos(t);
            
            this.mouse.dx=0;
            this.mouse.dy=0;
            this.mouse.dx += (pos.x - this.mouse.x);
            this.mouse.dy += (pos.y - this.mouse.y);

            this.mouse.x = pos.x;
            this.mouse.y = pos.y;
        }, { passive: false });

        this.canvas.addEventListener("touchend", e => {
            e.preventDefault();
            clearTimeout(this.touchTimer);
            this.mouse.down = false;
            this.mouse.rightDown = false;
            this.mouse.justReleased = true;

            this.mouse.dx = 0;
            this.mouse.dy = 0;
        }, { passive: false });
        this.canvas.addEventListener("touchcancel", e => {
            e.preventDefault();
            clearTimeout(this.touchTimer);
            this.mouse.down = false;
            this.mouse.rightDown = false;
            this.mouse.justPressed = false;
            this.mouse.justReleased = true;

            this.mouse.dx = 0;
            this.mouse.dy = 0;
        }, { passive: false });
    }
    _getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();

        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
    _isInsideJoystickZone(touch) {
     
     
        const isPortrait = this.canvas.height > this.canvas.width;
        if(!isPortrait){
            return (
                touch.clientX >= this.canvas.width * 0.12-Math.min(this.canvas.width, this.canvas.height) * 0.030 &&
                touch.clientX <= this.canvas.width * 0.12-Math.min(this.canvas.width, this.canvas.height) * 0.030 +Math.min(this.canvas.width, this.canvas.height) * 0.18 &&
                touch.clientY >= this.canvas.height * 0.60-Math.min(this.canvas.width, this.canvas.height) * 0.09 &&
                touch.clientY <= this.canvas.height * 0.60-Math.min(this.canvas.width, this.canvas.height) * 0.09+Math.min(this.canvas.width, this.canvas.height) * 0.18
            );
            
        }
        else{
            return (
                touch.clientX >= this.canvas.width * 0.12-Math.min(this.canvas.width, this.canvas.height) * 0.030 &&
                touch.clientX <= this.canvas.width * 0.12-Math.min(this.canvas.width, this.canvas.height) * 0.030 +Math.min(this.canvas.width, this.canvas.height) * 0.18 &&
                touch.clientY >= this.canvas.height * 0.79-Math.min(this.canvas.width, this.canvas.height) * 0.09 &&
                touch.clientY <= this.canvas.height * 0.79-Math.min(this.canvas.width, this.canvas.height) * 0.09+Math.min(this.canvas.width, this.canvas.height) * 0.18
            );
        }
    }
}