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

"use strict";
var cursorX;
var cursorY;
var game;
let counterru = 0;
var colli;
let counter;

class Game5 {
    
    kollitions = [];
    kollitions2 = [];
    
    
    constructor(name) {
        this.name = name;
        this.maps = [];
        this.currentmap = 0;
        game = this;
        this.load();
        this.setupBroadPhase();

        // Added local caching of canvas element for efficiency.
        const canvas = document.getElementById("myCanvas");

        canvas.addEventListener("touchstart", function(e) {
            e.preventDefault();
            // Cache current map object for repeated use.
            const currentMap = game.maps[game.currentmap];
            const zoomFactor = 1 + (1 * currentMap.zoom / 100);
            for (let i2 = 0; i2 < currentMap.layer.length; i2++) { 
                let layer = currentMap.layer[i2];
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                    let objType = layer.objectype[i3];
                    for (let i4 = 0; i4 < objType.objects.length; i4++) {
                        let object = objType.objects[i4];
                        let touch0x = e.touches[0].clientX / zoomFactor;
                        let touch0y = e.touches[0].clientY / zoomFactor;
                        let calcX = Number(currentMap.camerax) / 100 * Number(layer.moving) + Number(object.x) + (Number(object.dimx) / 2);
                        let calcY = Number(currentMap.cameray) / 100 * Number(layer.moving) + Number(object.y) + (Number(object.dimy) / 2);
                        let calcRot = (-Number(object.rot) * Math.PI) / 180;

                        if (game.collideCircleWithRotatedRectangle(touch0x, touch0y, 10, calcX, calcY, Number(object.dimx), Number(object.dimy), calcRot)) {
                            object.mousepressed = true;
                        }
                        
                        if (e.touches.length > 1) {
                            let touch1x = e.touches[1].clientX / zoomFactor;
                            let touch1y = e.touches[1].clientY / zoomFactor;
                            if (game.collideCircleWithRotatedRectangle(touch1x, touch1y, 10, calcX, calcY, Number(object.dimx), Number(object.dimy), calcRot)) {
                                object.mousepressed = true;
                            }
                        }
                    }
                }
            }
        });

        canvas.addEventListener("touchend", function(e) {
            e.preventDefault();
            const currentMap = game.maps[game.currentmap];
            const zoomFactor = 1 + (1 * currentMap.zoom / 100);
            if (e.touches.length == 0) {
                for (let i2 = 0; i2 < currentMap.layer.length; i2++) {
                    let layer = currentMap.layer[i2];
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                        let objType = layer.objectype[i3];
                        for (let i4 = 0; i4 < objType.objects.length; i4++) {
                            objType.objects[i4].mousepressed = false;
                        }
                    }
                }
            }
          
            if (e.touches.length == 1) {
                for (let i2 = 0; i2 < currentMap.layer.length; i2++) { 
                    let layer = currentMap.layer[i2];
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                        let objType = layer.objectype[i3];
                        for (let i4 = 0; i4 < objType.objects.length; i4++) {
                            let object = objType.objects[i4];
                            let touch0x = e.touches[0].clientX / zoomFactor;
                            let touch0y = e.touches[0].clientY / zoomFactor;
                            let calcX = Number(currentMap.camerax) / 100 * Number(layer.moving) + Number(object.x) + (Number(object.dimx) / 2);
                            let calcY = Number(currentMap.cameray) / 100 * Number(layer.moving) + Number(object.y) + (Number(object.dimy) / 2);
                            let calcRot = (-Number(object.rot) * Math.PI) / 180;
                            
                            if (!game.collideCircleWithRotatedRectangle(touch0x, touch0y, 10, calcX, calcY, Number(object.dimx), Number(object.dimy), calcRot)) {
                                object.mousepressed = false;
                            }
                        }
                    }
                }
            }
        });
        
        canvas.addEventListener("mousedown", function(e) {
            e.preventDefault();
            // Cache current map object for repeated use.
            const currentMap = game.maps[game.currentmap];
            const zoomFactor = 1 + (1 * currentMap.zoom / 100);
            for (let i2 = 0; i2 < currentMap.layer.length; i2++) { 
                let layer = currentMap.layer[i2];
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                    let objType = layer.objectype[i3];
                    for (let i4 = 0; i4 < objType.objects.length; i4++) {
                        let object = objType.objects[i4];
            
                        let touch0x = e.clientX / zoomFactor;
                        let touch0y = e.clientY / zoomFactor;
                        let calcX = Number(currentMap.camerax) / 100 * Number(layer.moving) + Number(object.x) + (Number(object.dimx) / 2);
                        let calcY = Number(currentMap.cameray) / 100 * Number(layer.moving) + Number(object.y) + (Number(object.dimy) / 2);
                        let calcRot = (-Number(object.rot) * Math.PI) / 180;

                        if (game.collideCircleWithRotatedRectangle(touch0x, touch0y, 10, calcX, calcY, Number(object.dimx), Number(object.dimy), calcRot)) {
                            object.mousepressed = true;
                        }
                    }
                }
            }
        });

        canvas.addEventListener("mouseup", function(e) {
            e.preventDefault();
            const currentMap = game.maps[game.currentmap];
            const zoomFactor = 1 + (1 * currentMap.zoom / 100);
                for (let i2 = 0; i2 < currentMap.layer.length; i2++) {
                    let layer = currentMap.layer[i2];
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                        let objType = layer.objectype[i3];
                        for (let i4 = 0; i4 < objType.objects.length; i4++) {
                            objType.objects[i4].mousepressed = false;
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
            if (game.maps.length == 0) {
                for (var i = 0; i < lines.length; i++) {
                    game.name = lines[0];
                    game.currentmap = lines[1];
                    if (lines[i] == "A*?") {
                        game.maps.push(new Maps(lines[i + 1]));
                        game.getlastmaps().camerax = Number(lines[i + 2]);
                        game.getlastmaps().cameray = Number(lines[i + 3]);
                        i = i + 3;
                    }
                    else if (lines[i] == "B*?") {
                        game.getlastmaps().layer.push(new Layer(lines[i + 1]));
                        game.getlastlayer().lock = JSON.parse(lines[i + 2]);
                        game.getlastlayer().moving = Number(lines[i + 3]);
                        game.getlastlayer().fysics = JSON.parse(lines[i + 4]);
                        game.getlastlayer().solid = JSON.parse(lines[i + 5]);
                        game.getlastlayer().ghost = JSON.parse(lines[i + 6]);
                        i = i + 6;
                    }
                    else if (lines[i] == "C*?") {
                        game.getlastlayer().objectype.push(new Objecttype(lines[i + 1]));
                        game.getlastObjecttype().standarddimx = Number(lines[i + 2]);
                        game.getlastObjecttype().standarddimy = Number(lines[i + 3]);
                        game.getlastObjecttype().rot = Number(lines[i + 4]);
                        game.getlastObjecttype().fliped = JSON.parse(lines[i + 5]);
                        i = i + 5;
                    }
                    else if (lines[i] == "D*?") {
                        game.getlastObjecttype().images.push(new Sprites(lines[i + 1]));
                        game.getlastSprites().speed = Number(lines[i + 2]);
                        i = i + 2;
                    }
                    else if (lines[i] == "E*?") {
                        game.getlastSprites().images.push(new String(lines[i + 1]));
                        i = i + 1;
                    }
                    else if (lines[i] == "F*?") {
                        game.getlastObjecttype().objects.push(new Object(Number(lines[i + 1]), Number(lines[i + 2]), Number(lines[i + 3]), Number(lines[i + 4]), Number(lines[i + 5]), JSON.parse(lines[i + 6])));
                        i = i + 6;
                    }
                }
            }
        }
        client.send();
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
                for (let i2 = 0; i2 < this.maps[i].layer.length; i2++) {
                    for (let i3 = 0; i3 < this.maps[i].layer[i2].objectype.length; i3++) {
                        this.maps[i].layer[i2].objectype[i3].draw(ctx, this.maps[i].zoom, this.maps[i].camerax / 100 * this.maps[i].layer[i2].moving, this.maps[i].cameray / 100 * this.maps[i].layer[i2].moving);
                        for (let i4 = 0; i4 < this.maps[i].layer[i2].objectype[i3].images.length; i4++) {
                            this.maps[i].layer[i2].objectype[i3].images[i4].updateanimation();
                        }
                    }
                }
            }
        }
    }
    
    setupBroadPhase() {
    // Set up a spatial grid for broad-phase collision
    this.cellSize = 200; // Adjust based on your typical object size
    this.spatialGrid = {};
}
// Add this method to help with the broad phase
clearSpatialGrid() {
    this.spatialGrid = {};
}

// Add this method to place objects in the grid
addToSpatialGrid(obj) {
    // Calculate grid cells this object occupies
    const startCellX = Math.floor(obj.x / this.cellSize);
    const startCellY = Math.floor(obj.y / this.cellSize);
    const endCellX = Math.floor((obj.x + obj.dimx) / this.cellSize);
    const endCellY = Math.floor((obj.y + obj.dimy) / this.cellSize);
    
    // Add object to each cell it occupies
    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
        for (let cellY = startCellY; cellY <= endCellY; cellY++) {
            const cellKey = `${cellX},${cellY}`;
            if (!this.spatialGrid[cellKey]) {
                this.spatialGrid[cellKey] = [];
            }
            this.spatialGrid[cellKey].push(obj);
        }
    }
}

// Get potential collision candidates for an object
getPotentialCollisions(obj) {
    const collisionCandidates = new Set();
    
    // Calculate grid cells this object occupies
    const startCellX = Math.floor(obj.x / this.cellSize);
    const startCellY = Math.floor(obj.y / this.cellSize);
    const endCellX = Math.floor((obj.x + obj.dimx) / this.cellSize);
    const endCellY = Math.floor((obj.y + obj.dimy) / this.cellSize);
    
    // Get objects from each cell
    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
        for (let cellY = startCellY; cellY <= endCellY; cellY++) {
            const cellKey = `${cellX},${cellY}`;
            const cellObjects = this.spatialGrid[cellKey];
            
            if (cellObjects) {
                for (let i = 0; i < cellObjects.length; i++) {
                    if (cellObjects[i] !== obj) { // Don't check against self
                        collisionCandidates.add(cellObjects[i]);
                    }
                }
            }
        }
    }
    
    return Array.from(collisionCandidates);
}    
    
collitionengine() {
    // Reset collision lists for all objects
    for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
        for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
            for (let i4 = 0; i4 < this.maps[this.currentmap].layer[i2].objectype[i3].objects.length; i4++) {
                let o = this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4];
                o.collideslistan = [];
                o.collideslistandir = [];
                o.collideslistanobj = [];
            }
        }
    }
    
    // Clear spatial grid
    this.clearSpatialGrid();
    
    // First pass: Process movement and add objects to spatial grid
    for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
        for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
            for (let i4 = 0; i4 < this.maps[this.currentmap].layer[i2].objectype[i3].objects.length; i4++) {
                var o = this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4];
                
                // Only process visible objects
                if (o.isonscreen) {
                    this.addToSpatialGrid(o);
                }
                
                if (this.maps[this.currentmap].layer[i2].fysics == false || 
                    this.maps[this.currentmap].layer[i2].solid || 
                    this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4].ghost == true) {
                    o.rakna = 0;
                    o.rakna2 = 0;
                }
                else if (this.maps[this.currentmap].layer[i2].ghost == true) {
                    o.rakna = 0;
                    o.rakna2 = 0;
                    o.collideslistfull(this.maps, this.currentmap, "ghost"); // Keep this line for ghost layers
                }
                else {
                    if (-(this.maps[this.currentmap].camerax / 100 * this.maps[this.currentmap].layer[i2].moving) - o.dimx <= o.x + o.dimx &&
                        ((o.dimx + document.body.clientWidth / (1 + (1 * this.maps[this.currentmap].zoom / 100)) - 8 + 300) - 
                         (this.maps[this.currentmap].camerax / 100 * this.maps[this.currentmap].layer[i2].moving)) >= o.x + o.dimx &&
                        -(this.maps[this.currentmap].cameray / 100 * this.maps[this.currentmap].layer[i2].moving) - o.dimy <= o.y + o.dimy &&
                        ((o.dimy + document.body.clientHeight / (1 + (1 * this.maps[this.currentmap].zoom / 100)) - 8 + 300) - 
                         (this.maps[this.currentmap].cameray / 100 * this.maps[this.currentmap].layer[i2].moving)) >= o.y + o.dimy) {
                        
                        o.rakna = o.x - o.freex;
                        o.rakna2 = o.y - o.freey;
                        o.x = o.freex;
                        o.y = o.freey;
                    }
                    else {
                        o.rakna = 0;
                        o.rakna2 = 0;
                        o.freex = o.x;
                        o.freey = o.y;
                    }
                }
            }
        }
    }
    
    // Process ghost collisions for all objects (even those that don't move)
    for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
        const layer = this.maps[this.currentmap].layer[i2];
        if (layer.ghost || !layer.fysics) continue; // Skip ghost layers as they're already handled above
        
        for (let i3 = 0; i3 < layer.objectype.length; i3++) {
            const objType = layer.objectype[i3];
            for (let i4 = 0; i4 < objType.objects.length; i4++) {
                const obj = objType.objects[i4];
                if (!obj.isonscreen) continue;
                
                // Get potential collisions
                const potentialCollisions = this.getPotentialCollisions(obj);
                
                // Check for ghost collisions
                for (let j = 0; j < potentialCollisions.length; j++) {
                    const other = potentialCollisions[j];
                    if (other === obj) continue; // Skip self
                    
                    // Find the layer and object type for the other object
                    let otherLayer = null, otherType = null;
                    
                    for (let li = 0; li < this.maps[this.currentmap].layer.length; li++) {
                        const l = this.maps[this.currentmap].layer[li];
                        for (let ti = 0; ti < l.objectype.length; ti++) {
                            if (l.objectype[ti].objects.includes(other)) {
                                otherLayer = l;
                                otherType = l.objectype[ti];
                                break;
                            }
                        }
                        if (otherLayer) break;
                    }
                    
                    // Check if this is a ghost collision
                    if (otherLayer && (otherLayer.ghost || other.ghost)) {
                        // Check collision with appropriate method
                        let collides = false;
                        if (obj.rot === 0 && other.rot === 0) {
                            collides = obj.collideswithfast(other);
                        } else {
                            collides = obj.collideswith(other);
                        }
                        
                        if (collides) {
                            // Add ghost collision
                            obj.collideslistan.push(otherType.name);
                            obj.collideslistandir.push("ghost");
                            obj.collideslistanobj.push(other);
                        }
                    }
                }
            }
        }
    }
                        
    // Second pass: Check collisions and handle movement
    for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
        for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
            for (let i4 = 0; i4 < this.maps[this.currentmap].layer[i2].objectype[i3].objects.length; i4++) {
                var o = this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4];
                
                if(o.rakna != 0 || o.rakna2 != 0) o.hadcollidedobj = [];
                
                // Process X-axis movement
                if (o.rakna != 0) {
                    // Move the object in X direction
                    o.x += o.rakna;
                    
                    // Get potential collisions using the spatial grid
                    const potentialCollisions = this.getPotentialCollisions(o);
                    let collisionDetected = false;
                    
                    // Check for collisions
                    for (let j = 0; j < potentialCollisions.length; j++) {
                        const other = potentialCollisions[j];
                        if (other === o) continue; // Skip self
                        
                        // Find the layer and object type for the other object
                        let otherLayer = null, otherType = null;
                        
                        for (let li = 0; li < this.maps[this.currentmap].layer.length; li++) {
                            const l = this.maps[this.currentmap].layer[li];
                            for (let ti = 0; ti < l.objectype.length; ti++) {
                                if (l.objectype[ti].objects.includes(other)) {
                                    otherLayer = l;
                                    otherType = l.objectype[ti];
                                    break;
                                }
                            }
                            if (otherLayer) break;
                        }
                        
                        // Skip if the other object is not physical or is a ghost
                        if (!otherLayer || !otherLayer.fysics || otherLayer.ghost || other.ghost) {
                            continue;
                        }
                        
                        // Check collision with fast method first
                        let collides = false;
                        if (o.rot === 0 && other.rot === 0) {
                            collides = o.collideswithfast(other);
                        } else {
                            collides = o.collideswith(other);
                        }
                        
                        if (collides) {
                            // Add to collision list
                            o.collideslistan.push(otherType.name);
                            o.collideslistandir.push(o.rakna < 0 ? "left" : "right");
                            o.collideslistanobj.push(other);
                            o.hadcollidedobj.push(other);
                            
                            // Revert movement
                            o.x -= o.rakna;
                            collisionDetected = true;
                            break;
                        }
                    }
                }
                
                // Process Y-axis movement (similar to X-axis)
                if (o.rakna2 != 0) {
                    // Move the object in Y direction
                    o.y += o.rakna2;
                    
                    // Get potential collisions
                    const potentialCollisions = this.getPotentialCollisions(o);
                    let collisionDetected = false;
                    
                    // Check for collisions
                    for (let j = 0; j < potentialCollisions.length; j++) {
                        const other = potentialCollisions[j];
                        if (other === o) continue; // Skip self
                        
                        // Find the layer and object type for the other object
                        let otherLayer = null, otherType = null;
                        
                        for (let li = 0; li < this.maps[this.currentmap].layer.length; li++) {
                            const l = this.maps[this.currentmap].layer[li];
                            for (let ti = 0; ti < l.objectype.length; ti++) {
                                if (l.objectype[ti].objects.includes(other)) {
                                    otherLayer = l;
                                    otherType = l.objectype[ti];
                                    break;
                                }
                            }
                            if (otherLayer) break;
                        }
                        
                        // Skip if the other object is not physical or is a ghost
                        if (!otherLayer || !otherLayer.fysics || otherLayer.ghost || other.ghost) {
                            continue;
                        }
                        
                        // Check collision with fast method first
                        let collides = false;
                        if (o.rot === 0 && other.rot === 0) {
                            collides = o.collideswithfast(other);
                        } else {
                            collides = o.collideswith(other);
                        }
                        
                        if (collides) {
                            // Add to collision list
                            o.collideslistan.push(otherType.name);
                            o.collideslistandir.push(o.rakna2 < 0 ? "up" : "down");
                            o.collideslistanobj.push(other);
                            o.hadcollidedobj.push(other);
                            
                            // Revert movement
                            o.y -= o.rakna2;
                            collisionDetected = true;
                            break;
                        }
                    }
                }
                
                // Update free positions to current positions
                o.freex = o.x;
                o.freey = o.y;
            }
        }
    }
}
    
    isclose(obj, obj2){
        for (let i = 0; i < obj.hadcollidedobj.length; i++) {
            if (obj2 == obj.hadcollidedobj[i])
                return true;
        }
        return false;
    }
    
    
    collideswiths(obj, name) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if (name == "any")
                return true;
            else if (obj.collideslistan[i] == name)
                return true;
        }
        return false;
    }
    
    collideswith(obj, name, dir) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if (name == "any") {
                if (obj.collideslistandir[i] == dir)
                    return true;
            }
            else if (obj.collideslistan[i] == name && obj.collideslistandir[i] == dir)
                return true;
        }
        return false;
    }
    collideswithanoterobject(obj, obj2) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if (obj2 == obj.collideslistanobj[i])
                return true;
        }
        return false;
    }
    collideswithobject(obj, name, dir) {
        for (let i = counterru; i < obj.collideslistan.length; i++) {
            if (name == "any") {
                if (obj.collideslistandir[i] == dir) {
                    counterru = i;
                    return obj.collideslistanobj[i];
                }
            }
            else if (obj.collideslistan[i] == name && obj.collideslistandir[i] == dir) {
                counterru = i + 1;
                return obj.collideslistanobj[i];
            }
        }
        for (let i = 0; i < counterru; i++) {
            if (name == "any") {
                if (obj.collideslistandir[i] == dir) {
                    counterru = i;
                    return obj.collideslistanobj[i];
                }
            }
            else if (obj.collideslistan[i] == name && obj.collideslistandir[i] == dir) {
                counterru = i + 1;
                return obj.collideslistanobj[i];
            }
        }
        return null;
    }
    collideswithobject(obj, name) {
        for (let i = counterru; i < obj.collideslistan.length; i++) {
            if (name == "any") {
                counterru = i;
                return obj.collideslistanobj[i];
            }
            else if (obj.collideslistan[i] == name) {
                counterru = i + 1;
                return obj.collideslistanobj[i];
            }
        }
        for (let i = 0; i < counterru; i++) {
            if (name == "any") {
                counterru = i;
                return obj.collideslistanobj[i];
            }
            else if (obj.collideslistan[i] == name) {
                counterru = i + 1;
                return obj.collideslistanobj[i];
            }
        }
        return null;
    }
    addobjecttype(obj, name, image) {
        try {
            for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
                for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
                    if (name == this.maps[this.currentmap].layer[i2].objectype[i3].name) {
                        return this.maps[this.currentmap].layer[i2].objectype[i3];
                    }
                }
            }
            for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
                for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
                    if (obj == this.maps[this.currentmap].layer[i2].objectype[i3].name) {
                        this.maps[this.currentmap].layer[i2].objectype.push(new Objecttype(name));
                        this.maps[this.currentmap].layer[i2].objectype[this.maps[this.currentmap].layer[i2].objectype.length - 1].images.push(new Sprites(""));
                        this.maps[this.currentmap].layer[i2].objectype[this.maps[this.currentmap].layer[i2].objectype.length - 1].images[0].images.push(image);
                        return this.maps[this.currentmap].layer[i2].objectype[this.maps[this.currentmap].layer[i2].objectype.length - 1];
                    }
                }
            }
        } catch (error) {}
        return null;
    }
    addobject(objtype, x, y, dimx, dimy, rot, fliped) {
        objtype.objects.push(new Object(x, y, dimx, dimy, rot, fliped));
    }
    removeObject(objtype, obj) {
        const index = objtype.objects.indexOf(obj);
        if (index !== -1) {
            objtype.objects.splice(index, 1);
        }
    }
    
    getobjecttype(obj) {
        try {
            for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
                for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
                    if (obj === this.maps[this.currentmap].layer[i2].objectype[i3].name) {
                        return this.maps[this.currentmap].layer[i2].objectype[i3];
                    }
                }
            }
        } catch (error) {}
        return null;
    }
    
    setcameraobj(obj, canvasx, canvasy) {
        if (canvasx != null)
            this.maps[this.currentmap].camerax = -(obj.x) + (canvasx / 2 / (1 + (1 * this.maps[this.currentmap].zoom / 100)));
        if (canvasy != null)
            this.maps[this.currentmap].cameray = -(obj.y) + (canvasy / 2 / (1 + (1 * this.maps[this.currentmap].zoom / 100)));
    }
    getcamerax() {
        return this.maps[this.currentmap].camerax;
    }
    getcameray() {
        return this.maps[this.currentmap].cameray;
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
	
        // Find the unrotated closest x point from center of unrotated circle
        if (unrotatedCircleX < rectReferenceX) {
            closestX = rectReferenceX;
        } else if (unrotatedCircleX > rectReferenceX + dimx) {
            closestX = rectReferenceX + dimx;
        } else {
            closestX = unrotatedCircleX;
        }
 
        // Find the unrotated closest y point from center of unrotated circle
        if (unrotatedCircleY < rectReferenceY) {
            closestY = rectReferenceY;
        } else if (unrotatedCircleY > rectReferenceY + dimy) {
            closestY = rectReferenceY + dimy;
        } else {
            closestY = unrotatedCircleY;
        }
 
        // Determine collision
        var collision = false;
        var distance = game.getDistance(unrotatedCircleX, unrotatedCircleY, closestX, closestY);
	
        if (distance < circlerad) {
            collision = true;
        }
        else {
            collision = false;
        }
        return collision;
    }

    getDistance(fromX, fromY, toX, toY) {
        var dX = Math.abs(fromX - toX);
        var dY = Math.abs(fromY - toY);
        return Math.sqrt((dX * dX) + (dY * dY));
    }
    createlightning(){
        for (let i = 0 ; i < lightning.length ; i++) {
            lightning[i].opacity -= 0.01;
            lightning[i].thickness -= 0.05;
            if (lightning[i].thickness <= 2) {
              lightning[i].end.y -= 0.05;
            }
            lightning[i].draw();
        }
        if((Math.floor(Math.random() * 100))==0)createLightning();
        
        
    }
    createrain(){
        raintime = raintime+1;
        resetPseudoRandom();
        const speed = raintime * 50;
        ctx.fillStyle = "blue";
        for (let i = 0; i < numRain; ++i) {
          const x = pseudoRandomInt(canvas.width);
          const y = (pseudoRandomInt(canvas.height) + speed) % canvas.height;
          ctx.fillRect(x, y, 6, 16);
        }
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
    // Cull entire objectType if not visible (big optimization)
    const zoomFactor = 1 + (1 * zoom / 100);
    const viewportWidth = document.body.clientWidth / zoomFactor;
    const viewportHeight = document.body.clientHeight / zoomFactor;
    
    // Only draw if there are objects and images
    if (this.objects.length === 0 || this.images.length === 0) return;
    
    // Skip entire objectType if all are far offscreen
    // Find bounds of all objects in this type
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (let i = 0; i < this.objects.length; i++) {
        const obj = this.objects[i];
        // Skip dead objects
        if (obj.alive === false) continue;
        
        minX = Math.min(minX, obj.x);
        minY = Math.min(minY, obj.y);
        maxX = Math.max(maxX, obj.x + obj.dimx);
        maxY = Math.max(maxY, obj.y + obj.dimy);
    }
    
    // Add margin
    minX -= 100;
    minY -= 100;
    maxX += 100;
    maxY += 100;
    
    // Check if entire object type is outside viewport
    if (maxX + camerax < 0 || minX + camerax > viewportWidth || 
        maxY + cameray < 0 || minY + cameray > viewportHeight) {
        // All objects offscreen, skip drawing
        for (let i = 0; i < this.objects.length; i++) {
            this.objects[i].isonscreen = false;
        }
        return;
    }
    
    // Process visible objects
    for (let i = 0; i < this.objects.length; i++) {
        const obj = this.objects[i];
        // Skip dead objects
        if (obj.alive === false) continue;
        
        obj.isonscreen = false;
        
        // Fast culling check for individual objects
        if (obj.x + obj.dimx + camerax < 0 || obj.x + camerax > viewportWidth ||
            obj.y + obj.dimy + cameray < 0 || obj.y + cameray > viewportHeight) {
            continue; // Skip offscreen objects
        }
        
        try {
            // Object is visible
            obj.isonscreen = true;
            
            // Get image once outside try-catch
            const image = this.images[obj.animation].getimage();
            if (!image) continue;
            
            ctx.save();
            ctx.scale(zoomFactor, zoomFactor);
            
            // Calculate position once
            const centerX = obj.x + camerax + obj.dimx / 2;
            const centerY = obj.y + cameray + obj.dimy / 2;
            
            // For objects without rotation, use a faster path (major optimization)
            if (obj.rot === 0 && !obj.fliped) {
                ctx.drawImage(image, obj.x + camerax, obj.y + cameray, obj.dimx, obj.dimy);
            } else {
                // Only use transforms when needed
                ctx.translate(centerX, centerY);
                if (obj.rot !== 0) {
                    ctx.rotate((obj.rot * Math.PI) / 180);
                }
                if (obj.fliped) {
                    ctx.scale(-1, 1);
                }
                ctx.translate(-centerX, -centerY);
                ctx.drawImage(image, obj.x + camerax, obj.y + cameray, obj.dimx, obj.dimy);
            }
            
            ctx.restore();
        } catch (error) {}
    }
}
}

class Sprites {
    
    // Add static image cache to Sprites class

    
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
            if (this.images.length === 0) return null;
            
            // Load all images at once
            for (let i = 0; i < this.images.length; i++) {
                if (!this.images[i]) continue; // Skip empty entries
                
                // Check global image cache first
                const cachedImage = Sprites.imageCache[this.images[i]];
                if (cachedImage) {
                    this.imagelist.push(cachedImage);
                } else {
                    const img = new Image();
                    img.src = this.images[i];
                    this.imagelist.push(img);
                    Sprites.imageCache[this.images[i]] = img; // Store in cache
                }
            }
        }
        
        if (this.imagelist.length > 0 && this.ani < this.imagelist.length) {
            return this.imagelist[this.ani];
        }
    } catch (error) {}
    return null;
}


}
// Add static image cache to Sprites class
Sprites.imageCache = {};
class Object {
    constructor(x, y, dimx, dimy, rot, fliped) {
        this.x = x;
        this.y = y;
        this.origonx = x;
        this.origony = y;
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
        this.hadcollidedobj = [];
        this.rakna = 0;
        this.rakna2 = 0;
        this.animation = 0;
        this.fliped = fliped;
        this.mousepressed = false;
        this.ghost = false;
        this.health = 100;
        this.counter = 0;
        this.counter2 = 0;
        this.counter3 = 0;
        this.counter4 = 0;
        this.counter5 = 0;
        this.isonscreen=false;
    }
    collideslist(maps, currentmap, dir) {
        for (let i2 = 0; i2 < maps[currentmap].layer.length; i2++) {
            let layer = maps[currentmap].layer[i2];
            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                let objType = layer.objectype[i3];
                for (let i4 = 0; i4 < objType.objects.length; i4++) {
                    if ((objType.objects[i4] == this) || maps[currentmap].layer[i2].fysics == false) {
                    }
                    else {
                        if (this.collideswithOptimized(objType.objects[i4])) {
                            if (this.collideswithfast(objType.objects[i4])) {
                                if (maps[currentmap].layer[i2].ghost == true || objType.objects[i4].ghost == true) {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    this.hadcollidedobj.push(objType.objects[i4]);
                                }
                                else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    this.hadcollidedobj.push(objType.objects[i4]);
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
    collideslistfull(maps, currentmap, dir) {
        for (let i2 = 0; i2 < maps[currentmap].layer.length; i2++) {
            let layer = maps[currentmap].layer[i2];
            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                let objType = layer.objectype[i3];
                for (let i4 = 0; i4 < objType.objects.length; i4++) {
                    if ((objType.objects[i4] == this) || maps[currentmap].layer[i2].fysics == false) {
                    }
                    else {
                        if (objType.objects[i4].rot == 0 && this.rot == 0) {
                            if (this.collideswithfast(objType.objects[i4])) {
                                if (maps[currentmap].layer[i2].ghost == true || objType.objects[i4].ghost == true) {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                }
                                else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                }
                            }
                        }
                        else {
                            if (this.collideswith(objType.objects[i4])) {
                                if (maps[currentmap].layer[i2].ghost == true || objType.objects[i4].ghost == true) {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                }
                                else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                }
                            }
                        }
                    }
                }
            }
        }
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
collideswithOptimized(obj) {
    // Fast path for non-rotated objects (use AABB)
    if (this.rot === 0 && obj.rot === 0) {
        return this.collideswithfast(obj);
    }
    
    // Fast path for 90-degree rotations (common case)
    if ((this.rot % 90 === 0) && (obj.rot % 90 === 0)) {
        return this.collideswithSimpleRotation(obj);
    }
    
    // Fallback to full SAT for complex rotations
    return this.collideswith(obj);
}

// Add this faster implementation for simple rotations
collideswithSimpleRotation(obj) {
    // Get corners of both objects
    const corners1 = this.getCorners();
    const corners2 = obj.getCorners();
    
    // Check if any corner of object 1 is inside object 2
    for (let i = 0; i < corners1.length; i++) {
        if (pointInRotatedRect(corners1[i], obj)) {
            return true;
        }
    }
    
    // Check if any corner of object 2 is inside object 1
    for (let i = 0; i < corners2.length; i++) {
        if (pointInRotatedRect(corners2[i], this)) {
            return true;
        }
    }
    
    // Check for edge crossing
    if (edgesIntersect(corners1, corners2)) {
        return true;
    }
    
    return false;
}

// Add this helper method to get corners
getCorners() {
    // Cache this result if object hasn't moved or rotated
    if (this._cachedCorners && 
        this._cachedX === this.x && 
        this._cachedY === this.y && 
        this._cachedRot === this.rot &&
        this._cachedDimx === this.dimx &&
        this._cachedDimy === this.dimy) {
        return this._cachedCorners;
    }
    
    const corners = [];
    const centerX = this.x + this.dimx / 2;
    const centerY = this.y + this.dimy / 2;
    const halfWidth = this.dimx / 2;
    const halfHeight = this.dimy / 2;
    
    const radians = this.rot * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    
    // Calculate corners (clockwise from top-left)
    const points = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight }
    ];
    
    for (let i = 0; i < points.length; i++) {
        const rotatedX = points[i].x * cos - points[i].y * sin;
        const rotatedY = points[i].x * sin + points[i].y * cos;
        corners.push({
            x: centerX + rotatedX,
            y: centerY + rotatedY
        });
    }
    
    // Cache the result
    this._cachedCorners = corners;
    this._cachedX = this.x;
    this._cachedY = this.y;
    this._cachedRot = this.rot;
    this._cachedDimx = this.dimx;
    this._cachedDimy = this.dimy;
    
    return corners;
}
    
    
    
    toString() {
        return `${this.x} ${this.y} ${this.dimx} ${this.dimy} ${this.rot}`;
    }
}
// Helper function to check if a point is inside a rotated rectangle
function pointInRotatedRect(point, rect) {
    const centerX = rect.x + rect.dimx / 2;
    const centerY = rect.y + rect.dimy / 2;
    
    // Translate point so that rect center is at origin
    const translatedX = point.x - centerX;
    const translatedY = point.y - centerY;
    
    // Rotate point in opposite direction of rectangle's rotation
    const radians = -rect.rot * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    
    const rotatedX = translatedX * cos - translatedY * sin;
    const rotatedY = translatedX * sin + translatedY * cos;
    
    // Check if rotated point is within the unrotated rectangle
    return (
        rotatedX >= -rect.dimx/2 && 
        rotatedX <= rect.dimx/2 &&
        rotatedY >= -rect.dimy/2 && 
        rotatedY <= rect.dimy/2
    );
}

// Helper function to check if edges of two rectangles intersect
function edgesIntersect(corners1, corners2) {
    // Check each edge of rectangle 1 against each edge of rectangle 2
    for (let i = 0; i < 4; i++) {
        const a1 = corners1[i];
        const a2 = corners1[(i + 1) % 4];
        
        for (let j = 0; j < 4; j++) {
            const b1 = corners2[j];
            const b2 = corners2[(j + 1) % 4];
            
            if (lineIntersect(a1.x, a1.y, a2.x, a2.y, b1.x, b1.y, b2.x, b2.y)) {
                return true;
            }
        }
    }
    return false;
}

// Helper function to check if two line segments intersect
function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denominator = ((y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1));
    
    // Lines are parallel
    if (denominator === 0) {
        return false;
    }
    
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denominator;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denominator;
    
    // Check if intersection point is on both line segments
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1);
}



//LIGHTNING//////////////////////////////////////////////////////////////////////////////
const createVector = (x, y) => ({ x, y });

const getRandomFloat = (min, max) => {
  const random = Math.random() * (max - min + 1) + min;
  return random;
};

const getRandomInteger = (min, max) => {
  return Math.floor(getRandomFloat(min, max));
};

const line = (start, end, thickness) => {
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.lineWidth = thickness;
  ctx.strokeStyle = "rgb(255, 255, 255)";
  ctx.stroke();
};

class Lightning {
  constructor(x1, y1, x2, y2, thickness, opacity) {
    this.start = createVector(x1, y1);
    this.end = createVector(x2, y2);
    this.thickness = thickness;
    this.opacity = opacity;
  }
  draw() {
    return line(this.start, this.end, this.thickness);
  }
}

const interval = 3000;
const lightningStrikeOffset = 5;
const lightningStrikeLength = 100;
const lightningBoltLength = 7;
const lightningThickness = 4;
let lightning = [];

const createLightning = () => {
  lightning = [];
  let leng = Math.floor(Math.random() * 10);
  let lightningX1 = getRandomInteger(2, canvas.width - 2);
  let lightningX2 = getRandomInteger(lightningX1 - lightningStrikeOffset, lightningX1 + lightningStrikeOffset);
  lightning[0] = new Lightning(lightningX1, 0, lightningX2, leng, lightningThickness, 1);
  for (let l = 1; l < lightningStrikeLength; l++) {
    let lastBolt = lightning[l - 1];
    let lx1 = lastBolt.end.x;
    let lx2 = getRandomInteger(lx1 - lightningStrikeOffset, lx1 + lightningStrikeOffset);
    lightning.push(new Lightning(
      lx1, 
      lastBolt.end.y, 
      lx2, 
      lastBolt.end.y + leng, 
      lastBolt.thickness, 
      lastBolt.opacity
    ));
  }
};
//RAIN//////////////////////////////////////////////////////////////////////////////////////////
const numRain = 200;
let raintime=0;
function pseudoRandom() {
    return (randomSeed_ =
            ((134775813 * randomSeed_ + 1) >>> 0)) / RANDOM_RANGE_;
};
let randomSeed_ = 0;
const RANDOM_RANGE_ = 4294967296;
function pseudoRandomInt(n) {
  return pseudoRandom() * n | 0;
}
function resetPseudoRandom() {
    randomSeed_ = 0;
};





