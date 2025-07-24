"use strict";

function getRotatedRectangleCorners(x, y, w, h, rot) {
    // Calculate the center of the rectangle
    var cx = x + w / 2;
    var cy = y + h / 2;
    // Define the corners relative to the center
    var pts = [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: w / 2, y: h / 2 },
        { x: -w / 2, y: h / 2 }
    ];
    var corners = [];
    var cos = Math.cos(rot * Math.PI / 180);
    var sin = Math.sin(rot * Math.PI / 180);
    for (var i = 0; i < pts.length; i++) {
        var rx = pts[i].x * cos - pts[i].y * sin;
        var ry = pts[i].x * sin + pts[i].y * cos;
        corners.push({ x: cx + rx, y: cy + ry });
    }
    return corners;
}

function SATCollision(corners1, corners2) {
    // Helper function to compute the perpendicular (normalized) of an edge
    function getAxis(corners, i) {
        var p1 = corners[i];
        var p2 = corners[(i + 1) % corners.length];
        var axis = { x: p2.x - p1.x, y: p2.y - p1.y };
        var perp = { x: -axis.y, y: axis.x };
        var len = Math.sqrt(perp.x * perp.x + perp.y * perp.y);
        if (len !== 0) {
            perp.x /= len;
            perp.y /= len;
        }
        return perp;
    }
    var axes = [];
    // Get axes from both rectangles (4 from each, some may be duplicates)
    for (var i = 0; i < 4; i++) {
        axes.push(getAxis(corners1, i));
        axes.push(getAxis(corners2, i));
    }
    // Check for separation on any axis
    for (var i = 0; i < axes.length; i++) {
        var axis = axes[i];
        var min1 = Infinity, max1 = -Infinity;
        for (var j = 0; j < corners1.length; j++) {
            var proj = corners1[j].x * axis.x + corners1[j].y * axis.y;
            if (proj < min1) min1 = proj;
            if (proj > max1) max1 = proj;
        }
        var min2 = Infinity, max2 = -Infinity;
        for (var j = 0; j < corners2.length; j++) {
            var proj = corners2[j].x * axis.x + corners2[j].y * axis.y;
            if (proj < min2) min2 = proj;
            if (proj > max2) max2 = proj;
        }
        if (max1 < min2 || max2 < min1) {
            return false;
        }
    }
    return true;
}

var colli;
colli = {
    checkifcollides: function(x1, y1, w1, h1, r1, x2, y2, w2, h2, r2) {
        var corners1 = getRotatedRectangleCorners(x1, y1, w1, h1, r1);
        var corners2 = getRotatedRectangleCorners(x2, y2, w2, h2, r2);
        return SATCollision(corners1, corners2);
    }
};

var cursorX;
var cursorY;
var game;
var colli;
let counterru = 0;

class Game3 {
    
    kollitions = [];
    kollitions2 = [];
    
    constructor(name) {
        this.name = name;
        this.maps = [];
        this.currentmap = 0;
        game = this;
        this.load();

        document.getElementById("myCanvas").addEventListener("touchstart", function(e) {
            e.preventDefault();
            // Cache current map and zoom for efficiency
            const curMap = game.maps[game.currentmap];
            const zoomFactor = 1 + (1 * curMap.zoom / 100);
            for (let i2 = 0; i2 < curMap.layer.length; i2++) { 
                const layer = curMap.layer[i2];
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                    const objectype = layer.objectype[i3];
                    for (let i4 = 0; i4 < objectype.objects.length; i4++) {
                        const obj = objectype.objects[i4];
                        let touchProcessed = false;
                        // First touch
                        const t0x = e.touches[0].clientX / zoomFactor;
                        const t0y = e.touches[0].clientY / zoomFactor;
                        const calcX = Number(curMap.camerax) / 100 * Number(layer.moving) + Number(obj.x) + (Number(obj.dimx) / 2);
                        const calcY = Number(curMap.cameray) / 100 * Number(layer.moving) + Number(obj.y) + (Number(obj.dimy) / 2);
                        if (game.collideCircleWithRotatedRectangle(t0x, t0y, 10,
                                calcX,
                                calcY,
                                Number(obj.dimx),
                                Number(obj.dimy),
                                (-Number(obj.rot) * Math.PI) / 180)) {
                            obj.mousepressed = true;
                            touchProcessed = true;
                        }
                        
                        // Second touch if exists
                        if (e.touches.length > 1) {
                            const t1x = e.touches[1].clientX / zoomFactor;
                            const t1y = e.touches[1].clientY / zoomFactor;
                            if (game.collideCircleWithRotatedRectangle(t1x, t1y, 10, 
                                    calcX,
                                    calcY,
                                    Number(obj.dimx),
                                    Number(obj.dimy),
                                    (-Number(obj.rot) * Math.PI) / 180)) {
                                obj.mousepressed = true;
                                touchProcessed = true;
                            }
                        }
                    }
                }
            }
        });

        document.getElementById("myCanvas").addEventListener("touchend", function(e) {
            e.preventDefault();
          
            const curMap = game.maps[game.currentmap];
            if (e.touches.length === 0) {
                for (let i2 = 0; i2 < curMap.layer.length; i2++) { 
                    const layer = curMap.layer[i2];
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                        const objectype = layer.objectype[i3];
                        for (let i4 = 0; i4 < objectype.objects.length; i4++) {
                            objectype.objects[i4].mousepressed = false;
                        }
                    }
                }
            }
          
            if (e.touches.length === 1) {
                const zoomFactor = 1 + (1 * curMap.zoom / 100);
                for (let i2 = 0; i2 < curMap.layer.length; i2++) { 
                    const layer = curMap.layer[i2];
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                        const objectype = layer.objectype[i3];
                        for (let i4 = 0; i4 < objectype.objects.length; i4++) {
                            const obj = objectype.objects[i4];
                            const t0x = e.touches[0].clientX / zoomFactor;
                            const t0y = e.touches[0].clientY / zoomFactor;
                            const calcX = Number(curMap.camerax) / 100 * Number(layer.moving) + Number(obj.x) + (Number(obj.dimx) / 2);
                            const calcY = Number(curMap.cameray) / 100 * Number(layer.moving) + Number(obj.y) + (Number(obj.dimy) / 2);
                            if (!game.collideCircleWithRotatedRectangle(t0x, t0y, 10,
                                    calcX,
                                    calcY,
                                    Number(obj.dimx),
                                    Number(obj.dimy),
                                    (-Number(obj.rot) * Math.PI) / 180)) {
                                obj.mousepressed = false;
                            }
                        }
                    }
                }
            }
          
        });
    }
    load() {
        this.maps = [];
        var client = new XMLHttpRequest();
        client.open('GET', "maps/Spelet.txt");
        client.onload = function() { 
            var lines = client.responseText.split('\n');
            if (game.maps.length === 0) {
                for (var i = 0; i < lines.length; i++) {
                    game.name = lines[0];
                    game.currentmap = lines[1];
                    if (lines[i] === "A*?") {
                        game.maps.push(new Maps(lines[i + 1]));
                        game.getlastmaps().camerax = Number(lines[i + 2]);
                        game.getlastmaps().cameray = Number(lines[i + 3]);
                        i = i + 3;
                    }
                    else if (lines[i] === "B*?") {
                        game.getlastmaps().layer.push(new Layer(lines[i + 1]));
                        game.getlastlayer().lock = JSON.parse(lines[i + 2]);
                        game.getlastlayer().moving = Number(lines[i + 3]);
                        game.getlastlayer().fysics = JSON.parse(lines[i + 4]);
                        game.getlastlayer().solid = JSON.parse(lines[i + 5]);
                        game.getlastlayer().ghost = JSON.parse(lines[i + 6]);
                        i = i + 6;
                    }
                    else if (lines[i] === "C*?") {
                        game.getlastlayer().objectype.push(new Objecttype(lines[i + 1]));
                        game.getlastObjecttype().standarddimx = Number(lines[i + 2]);
                        game.getlastObjecttype().standarddimy = Number(lines[i + 3]);
                        game.getlastObjecttype().rot = Number(lines[i + 4]);
                        game.getlastObjecttype().fliped = JSON.parse(lines[i + 5]);
                        i = i + 5; 
                    }
                    else if (lines[i] === "D*?") {
                        game.getlastObjecttype().images.push(new Sprites(lines[i + 1]));
                        game.getlastSprites().speed = Number(lines[i + 2]);
                        i = i + 2;
                    }
                    else if (lines[i] === "E*?") {
                        game.getlastSprites().images.push(new String(lines[i + 1]));
                        i = i + 1;
                    }
                    else if (lines[i] === "F*?") {
                        game.getlastObjecttype().objects.push(new Objectt(
                            Number(lines[i + 1]),
                            Number(lines[i + 2]),
                            Number(lines[i + 3]),
                            Number(lines[i + 4]),
                            Number(lines[i + 5]),
                            JSON.parse(lines[i + 6])
                        ));
                        i = i + 6;
                    }
                }
            }
        };
        client.send(null);
    }
    
    getlastmaps(){
        return this.maps[this.maps.length-1];
    }
    getlastlayer(){
        return this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1];
    }
    getlastObjecttype(){
        return this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
                objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1];
               
    }
    getlastSprites(){
        return this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
               objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].
               images[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
                   objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].images.length-1];
        
    }
    getlastimages(){
        return this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
               objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].
               images[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
                   objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].images.length-1].
               images[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
               objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].
               images[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
                   objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].images.length-1].images.length-1]; 
    }
    getlastobject(){
        return this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
               objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].
               objects[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].
                   objectype[this.maps[this.maps.length-1].layer[this.maps[this.maps.length-1].layer.length-1].objectype.length-1].objects.length-1];   
    }
    
    toString() {
        let string = this.name + "\n";
        string = string + this.currentmap + "\n";
        for (let i = 0; i < this.maps.length; i++) {
            string = string + "A*?" + "\n";
            string = string + this.maps[i].name + "\n" + this.maps[i].camerax + "\n" + this.maps[i].cameray + "\n";
            
            for (let i2 = 0; i2 < this.maps[i].layer.length; i2++) {
                string = string + "B*?" + "\n";
                string = string + this.maps[i].layer[i2].name + "\n";
                string = string + this.maps[i].layer[i2].lock + "\n";
                string = string + this.maps[i].layer[i2].moving + "\n";
                string = string + this.maps[i].layer[i2].fysics + "\n";
                string = string + this.maps[i].layer[i2].solid + "\n";
                string = string + this.maps[i].layer[i2].ghost + "\n";
                
                for (let i3 = 0; i3 < this.maps[i].layer[i2].objectype.length; i3++) {
                    string = string + "C*?" + "\n";
                    string = string + this.maps[i].layer[i2].objectype[i3].name + "\n" +
                             this.maps[i].layer[i2].objectype[i3].standarddimx + "\n" +
                             this.maps[i].layer[i2].objectype[i3].standarddimy + "\n" +
                             this.maps[i].layer[i2].objectype[i3].rot + "\n" +
                             this.maps[i].layer[i2].objectype[i3].fliped + "\n";
   
                    for (let i4 = 0; i4 < this.maps[i].layer[i2].objectype[i3].images.length; i4++) {
                        string = string + "D*?" + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].images[i4].name + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].images[i4].speed + "\n";
                        
                        for (let i5 = 0; i5 < this.maps[i].layer[i2].objectype[i3].images[i4].images.length; i5++) {
                            string = string + "E*?" + "\n";
                            string = string + this.maps[i].layer[i2].objectype[i3].images[i4].images[i5] + "\n";
                        }
                    }
                    for (let i4 = 0; i4 < this.maps[i].layer[i2].objectype[i3].objects.length; i4++) {
                        string = string + "F*?" + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].objects[i4].x + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].objects[i4].y + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].objects[i4].dimx + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].objects[i4].dimy + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].objects[i4].rot + "\n";
                        string = string + this.maps[i].layer[i2].objectype[i3].objects[i4].fliped + "\n";
                    }
                } 
            }
        }
        string = string + "Q*?" + "\n";
        return string;
    }
    
    updateanimation(ctx) {
        try {
            this.collitionengine();
        } catch (error) {}
            
        for (let i = 0; i < this.maps.length; i++) {
            if (i == this.currentmap) {
                const curMap = this.maps[i];
                for (let i2 = 0; i2 < curMap.layer.length; i2++) {
                    const layer = curMap.layer[i2];
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                        const objType = layer.objectype[i3];
                        objType.draw(ctx, curMap.zoom, curMap.camerax / 100 * layer.moving, curMap.cameray / 100 * layer.moving);
                        for (let i4 = 0; i4 < objType.images.length; i4++) {
                            objType.images[i4].updateanimation();
                        }
                    } 
                }
            }
        }
    }
    
    collitionengine() {
        const curMap = this.maps[this.currentmap];
        // Reset collision lists
        for (let i2 = 0; i2 < curMap.layer.length; i2++) {   
            const layer = curMap.layer[i2];
            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                const objType = layer.objectype[i3];
                for (let i4 = 0; i4 < objType.objects.length; i4++) {
                    const o = objType.objects[i4];
                    o.collideslistan = [];
                    o.collideslistandir = [];
                    o.collideslistanobj = [];
                }
            }
        }
        
        // Process collision reaction calculations
        for (let i2 = 0; i2 < curMap.layer.length; i2++) { 
            const layer = curMap.layer[i2];
            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                const objType = layer.objectype[i3];
                for (let i4 = 0; i4 < objType.objects.length; i4++) {
                    var o = objType.objects[i4];
                    if (layer.fysics === false || layer.ghost === true || layer.solid || o.ghost === true) {
                        o.rakna = 0;
                        o.rakna2 = 0;
                    } else {
                        o.rakna = o.x - o.freex;
                        o.rakna2 = o.y - o.freey;
                        if ((o.rakna > 0 || o.rakna2 > 0) && (!o.collideslist(this.maps, this.currentmap, "left"))) {
                            o.rakna = 0;
                            o.rakna2 = 0;
                        } else {
                            o.x = o.freex;
                            o.y = o.freey;
                        }
                    }
                }
            }
        }
                   
        // Process collision resolution per axis
        for (let i2 = 0; i2 < curMap.layer.length; i2++) { 
            const layer = curMap.layer[i2];
            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                const objType = layer.objectype[i3];
                for (let i4 = 0; i4 < objType.objects.length; i4++) {
                    var o = objType.objects[i4];      
                   
                    if (o.rakna < 0) {
                        for (let k = 0; k < -o.rakna; k++) {
                            o.x = o.x - 1;
                            if (o.collideslist(this.maps, this.currentmap, "left")) {
                                o.x = o.x + 3;
                                break;
                            }
                        }
                    } else {
                        for (let k = 0; k < o.rakna; k++) {
                            o.x = o.x + 1;
                            if (o.collideslist(this.maps, this.currentmap, "right")) {
                                o.x = o.x - 3;
                                break;
                            }
                        }
                    }
                    if (o.rakna2 < 0) {
                        for (let k = 0; k < -o.rakna2; k++) {
                            o.y = o.y - 1;         
                            if (o.collideslist(this.maps, this.currentmap, "up")) {
                                o.y = o.y + 3;
                                break;
                            }
                        }
                    } else {
                        for (let k = 0; k < o.rakna2; k++) {
                            o.y = o.y + 1;    
                            if (o.collideslist(this.maps, this.currentmap, "down")) {  
                                o.y = o.y - 3;
                                break;
                            }
                        }
                    }
                    o.freex = o.x;
                    o.freey = o.y;
                }
            } 
        }
    }
    
    collideswiths(obj, name) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if (name === "any") return true;
            else if (obj.collideslistan[i] === name) return true;
        }
        return false;  
    }
    
    collideswith(obj, name, dir) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if (name === "any") {
                if (obj.collideslistandir[i] === dir) return true;
            } else if (obj.collideslistan[i] === name && obj.collideslistandir[i] === dir) return true;
        }
        return false;  
    }
    
    collideswithanoterobject(obj, obj2, dir) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if (obj2 === obj.collideslistanobj[i] && obj.collideslistandir[i] === dir)
                return true;
        }
        return false;
    }
    
    collideswithobject(obj, name, dir) {
        for (let i = counterru; i < obj.collideslistan.length; i++) {
            if (name === "any") {
                if (obj.collideslistandir[i] === dir) { counterru = i; return obj.collideslistanobj[i]; }
            } else if (obj.collideslistan[i] === name && obj.collideslistandir[i] === dir) { counterru = i + 1; return obj.collideslistanobj[i]; }
        }
        for (let i = 0; i < counterru; i++) {
            if (name === "any") {
                if (obj.collideslistandir[i] === dir) { counterru = i; return obj.collideslistanobj[i]; }
            } else if (obj.collideslistan[i] === name && obj.collideslistandir[i] === dir) { counterru = i + 1; return obj.collideslistanobj[i]; }
        }
        return null;
    }
    
    collideswithobject(obj, name) {
        for (let i = counterru; i < obj.collideslistan.length; i++) {
            if (name === "any") { counterru = i; return obj.collideslistanobj[i]; }
            else if (obj.collideslistan[i] === name) { counterru = i + 1; return obj.collideslistanobj[i]; }
        }
        for (let i = 0; i < counterru; i++) {
            if (name === "any") { counterru = i; return obj.collideslistanobj[i]; }
            else if (obj.collideslistan[i] === name) { counterru = i + 1; return obj.collideslistanobj[i]; }
        }
        return null;
    }
    
    addobjecttype(obj, name, image) {
        try {
            for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
                const layer = this.maps[this.currentmap].layer[i2];
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                    if (name === layer.objectype[i3].name) {
                        return layer.objectype[i3];
                    }
                }
            }
            
            for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
                const layer = this.maps[this.currentmap].layer[i2];
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                    if (obj === layer.objectype[i3].name) {
                        layer.objectype.push(new Objecttype(name));
                        layer.objectype[layer.objectype.length - 1].images.push(new Sprites(""));
                        layer.objectype[layer.objectype.length - 1].images[0].images.push(image);
                        return layer.objectype[layer.objectype.length - 1];
                    }
                }
            }
        } catch (error) {}
        
        return null;
    }
    
    addobject(objtype, x, y, dimx, dimy, rot, fliped) {
        objtype.objects.push(new Objectt(x, y, dimx, dimy, rot, fliped));
    }
    
    getobjecttype(obj) {
        try {
            for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
                const layer = this.maps[this.currentmap].layer[i2];
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                    if (obj === layer.objectype[i3].name) {
                        return layer.objectype[i3];
                    }
                }
            }
        } catch (error) {}
        return null;
    }
    
    setcameraobj(obj, canvasx, canvasy) {
        const curMap = this.maps[this.currentmap];
        curMap.camerax = -(obj.x) + (canvasx / 2 / (1 + (1 * curMap.zoom / 100)));
        curMap.cameray = -(obj.y) + (canvasy / 2 / (1 + (1 * curMap.zoom / 100)));
    }
    
    collideCircleWithRotatedRectangle(circlex, circley, circlerad, x, y, dimx, dimy, rot) {
        var rectCenterX = x;
        var rectCenterY = y;
        var rectX = rectCenterX - dimx / 2;
        var rectY = rectCenterY - dimy / 2;
        var rectReferenceX = rectX;
        var rectReferenceY = rectY;
	
        // Rotate circle's center point back
        var unrotatedCircleX = Math.cos(rot) * (circlex - rectCenterX) - Math.sin(rot) * (circley - rectCenterY) + rectCenterX;
        var unrotatedCircleY = Math.sin(rot) * (circlex - rectCenterX) + Math.cos(rot) * (circley - rectCenterY) + rectCenterY;
	
        // Closest point in the rectangle to the center of circle rotated backwards(unrotated)
        var closestX, closestY;
        if (unrotatedCircleX < rectReferenceX) {
            closestX = rectReferenceX;
        } else if (unrotatedCircleX > rectReferenceX + dimx) {
            closestX = rectReferenceX + dimx;
        } else {
            closestX = unrotatedCircleX;
        }
 
        if (unrotatedCircleY < rectReferenceY) {
            closestY = rectReferenceY;
        } else if (unrotatedCircleY > rectReferenceY + dimy) {
            closestY = rectReferenceY + dimy;
        } else {
            closestY = unrotatedCircleY;
        }
 
        var distance = game.getDistance(unrotatedCircleX, unrotatedCircleY, closestX, closestY);
        var collision = distance < circlerad;
        return collision;
    }

    getDistance(fromX, fromY, toX, toY) {
        var dX = Math.abs(fromX - toX);
        var dY = Math.abs(fromY - toY);
        return Math.sqrt((dX * dX) + (dY * dY));
    }
}

class Maps {
    constructor(name) {
        this.layer = [];
        this.name = name;
        this.camerax = 0;
        this.cameray = 0;
        this.zoom = 0;
    }
}

class Layer {
    constructor(name) {
        this.objectype = [];
        this.name = name;
        this.lock = false;
        this.moving = 100;
        this.fysics = false;
        this.solid = false;
        this.ghost = false;
    }
}

class Objecttype {
    constructor(name) {
        this.images = [];
        this.objects = [];
        this.name = name;
        this.standarddimx = 100;
        this.standarddimy = 100;
        this.rot = 0;
        this.fliped = false;
    }
    draw(ctx, zoom, camerax, cameray) {
        for (let i = 0; i < this.objects.length; i++) {
            try {
                const obj = this.objects[i];
                // Check if object is in view - using cached document dimensions for efficiency
                if (-camerax - obj.dimx <= obj.x + obj.dimx &&
                    (obj.dimx + document.body.clientWidth / (1 + (1 * zoom / 100)) - 8 - camerax) >= obj.x + obj.dimx) {
                    if (-cameray - obj.dimy <= obj.y + obj.dimy &&
                        (obj.dimy + document.body.clientHeight / (1 + (1 * zoom / 100)) - 8 + 300 - cameray) >= obj.y + obj.dimy) {
                        if (this.images[obj.animation].getimage() != null) {
                            ctx.save();
                            ctx.scale(1 + (1 * zoom / 100), 1 + (1 * zoom / 100));
                            ctx.translate(obj.x + camerax + obj.dimx / 2, obj.y + cameray + obj.dimy / 2);
                            ctx.rotate((obj.rot * Math.PI) / 180);
                            if (obj.fliped === true)
                                ctx.scale(-1, 1);
                            ctx.translate(-(obj.x + camerax + obj.dimx / 2), -(obj.y + cameray + obj.dimy / 2));
                            ctx.drawImage(this.images[obj.animation].getimage(), obj.x + camerax, obj.y + cameray, obj.dimx, obj.dimy);
                            ctx.restore();
                        }
                    }
                }
            } catch (error) {}
        }
    }
}

class Sprites {
    constructor(name) {
        this.name = name;
        this.images = [];
        this.imagelist = [];
        this.img = new Image();
        this.ani = 0;
        this.counter = 0;
        this.speed = 5;
    } 
    updateanimation() {
        if (this.counter >= this.speed) {
            this.ani++;
            this.counter = 0;
        }
        if (this.ani >= this.images.length)
            this.ani = 0;
        this.counter++;
    }
    getimage() {
        try {  
            if (this.imagelist.length === 0) {
                for (let i = 0; i < this.images.length; i++) {
                    this.imagelist.push(new Image());
                    this.imagelist[this.imagelist.length - 1].src = this.images[i];
                }
            }
            if (this.images.length > 0) {
                return this.imagelist[this.ani];
            }
        } catch (error) {}
        return null;
    }
}

class Objectt {
    constructor(x, y, dimx, dimy, rot, fliped) {
        this.x = x;
        this.y = y;
        this.dimx = dimx;
        this.dimy = dimy;
        this.rot = rot;
        this.buffer = 0;
        this.freex = x;
        this.freey = y;
        this.colloded = false;
        this.collideslistan = [];
        this.collideslistandir = [];
        this.collideslistanobj = [];
        this.rakna = 0;
        this.rakna2 = 0;
        this.animation = 0;
        this.fliped = fliped;
        this.mousepressed = false;
        this.ghost = false;
    }
    collideslist(maps, currentmap, dir) {
        for (let i2 = 0; i2 < maps[currentmap].layer.length; i2++) {
            const layer = maps[currentmap].layer[i2];
            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                const objType = layer.objectype[i3];
                for (let i4 = 0; i4 < objType.objects.length; i4++) {
                    if ((objType.objects[i4] === this) || maps[currentmap].layer[i2].fysics === false) {
                        // Do nothing, skip self or non-physical layer
                    } else {
                        if (objType.objects[i4].rot === 0 && this.rot === 0) {
                            if (this.collideswithfast(objType.objects[i4])) {
                                if (layer.ghost === true || objType.objects[i4].ghost === true) {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                } else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    return true;
                                }
                            }
                        } else {
                            if (this.collideswith(objType.objects[i4])) {
                                if (layer.ghost === true || objType.objects[i4].ghost === true) {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                } else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
    }
    
    collideswith(obj) {
        return colli.checkifcollides(this.x, this.y, this.dimx, this.dimy, this.rot,
                                       obj.x, obj.y, obj.dimx, obj.dimy, obj.rot);
    }
    
    collideswithfast(obj) {
        if (!(this.x > obj.x + obj.dimx || 
              this.x + this.dimx < obj.x || 
              this.y > obj.y + obj.dimy || 
              this.y + this.dimy < obj.y)) {
            return true;
        }
        return false;
    }
    
    toString() {
        return `${this.x} ${this.y} ${this.dimx} ${this.dimy} ${this.rot}`;
    }
}
