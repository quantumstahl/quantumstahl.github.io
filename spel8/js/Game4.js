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
let dragSelectStart = null;
let dragSelectEnd = null;

class Game4 {
    
    kollitions = [];
    kollitions2 = [];
    
    
    constructor(name) {
        this.name = name;
        this.maps = [];
        this.currentmap = 0;
        game = this;
        this.load();

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
            if (e.touches.length === 1) {
                const x = e.touches[0].clientX / zoomFactor - currentMap.camerax;
                const y = e.touches[0].clientY / zoomFactor - currentMap.cameray;
                dragSelectStart = { x, y };
                dragSelectEnd = null;
            }
            
        });
        canvas.addEventListener("touchmove", function(e) {
            if (e.touches.length === 1 && dragSelectStart) {
                const currentMap = game.maps[game.currentmap];
                const zoomFactor = 1 + (1 * currentMap.zoom / 100);
                const x = e.touches[0].clientX / zoomFactor - currentMap.camerax;
                const y = e.touches[0].clientY / zoomFactor - currentMap.cameray;
                dragSelectEnd = { x, y };
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
            if (dragSelectStart && dragSelectEnd) {
                game.deselectAll();
                const x1 = Math.min(dragSelectStart.x, dragSelectEnd.x);
                const y1 = Math.min(dragSelectStart.y, dragSelectEnd.y);
                const x2 = Math.max(dragSelectStart.x, dragSelectEnd.x);
                const y2 = Math.max(dragSelectStart.y, dragSelectEnd.y);

                for (let obj of game.getAllObjects()) {
                    if (
                        obj.selectable &&
                        obj.x + obj.dimx > x1 &&
                        obj.x < x2 &&
                        obj.y + obj.dimy > y1 &&
                        obj.y < y2
                    ) {
                        obj.selected = true;
                    }
                }
            }
            dragSelectStart = null;
            dragSelectEnd = null;
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
            const mouseX = e.clientX / zoomFactor;
            const mouseY = e.clientY / zoomFactor;

            const clickedObj = game.getObjectAt(mouseX - currentMap.camerax, mouseY - currentMap.cameray);

            if (e.button === 0) { // Vänsterklick – välj
                game.deselectAll();
                if (clickedObj) clickedObj.selected = true;
            } else if (e.button === 2) { // Högerklick – flytta valda
                for (let obj of game.getAllObjects()) {
                    if (obj.selected) {
                        obj.targetX = mouseX - currentMap.camerax;
                        obj.targetY = mouseY - currentMap.cameray;
                    }
                }
            }
            if (e.button === 0) {
                const currentMap = game.maps[game.currentmap];
                const zoomFactor = 1 + (1 * currentMap.zoom / 100);
                const x = e.clientX / zoomFactor - currentMap.camerax;
                const y = e.clientY / zoomFactor - currentMap.cameray;
                dragSelectStart = { x, y };
                dragSelectEnd = null;
            }
            
            
        });
        canvas.addEventListener("contextmenu", function(e) {
            e.preventDefault();
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
            if (e.button === 0 && dragSelectStart && dragSelectEnd) {
                game.deselectAll();
                const x1 = Math.min(dragSelectStart.x, dragSelectEnd.x);
                const y1 = Math.min(dragSelectStart.y, dragSelectEnd.y);
                const x2 = Math.max(dragSelectStart.x, dragSelectEnd.x);
                const y2 = Math.max(dragSelectStart.y, dragSelectEnd.y);

                for (let obj of game.getAllObjects()) {
                    if (
                        obj.selectable &&    
                        obj.x + obj.dimx > x1 &&
                        obj.x < x2 &&
                        obj.y + obj.dimy > y1 &&
                        obj.y < y2
                    ) {
                        obj.selected = true;
                    }
                }
            }
            dragSelectStart = null;
            dragSelectEnd = null;    
        });
        canvas.addEventListener("mousemove", function(e) {
            if (dragSelectStart) {
                const currentMap = game.maps[game.currentmap];
                const zoomFactor = 1 + (1 * currentMap.zoom / 100);
                const x = e.clientX / zoomFactor - currentMap.camerax;
                const y = e.clientY / zoomFactor - currentMap.cameray;
                dragSelectEnd = { x, y };
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
            this.updateUnitMovement();
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
        if (dragSelectStart && dragSelectEnd) {
            ctx.save();
            const zoomFactor = 1 + (1 * this.maps[this.currentmap].zoom / 100);
            ctx.scale(zoomFactor, zoomFactor);

            const x = Math.min(dragSelectStart.x, dragSelectEnd.x) + this.getcamerax();
            const y = Math.min(dragSelectStart.y, dragSelectEnd.y) + this.getcameray();
            const w = Math.abs(dragSelectEnd.x - dragSelectStart.x);
            const h = Math.abs(dragSelectEnd.y - dragSelectStart.y);

     

            // Kant
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ff00";
            ctx.strokeRect(x, y, w, h);
            
            ctx.lineWidth = 2;
            ctx.strokeStyle = "black";
            ctx.strokeRect(x, y, w, h);
            

            ctx.restore();
        }
        
        
        
    }
    collitionengine() {
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
        
        for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
            for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
                for (let i4 = 0; i4 < this.maps[this.currentmap].layer[i2].objectype[i3].objects.length; i4++) {
                    var o = this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4];
                    
                    if (this.maps[this.currentmap].layer[i2].fysics == false || this.maps[this.currentmap].layer[i2].solid) {
                        o.rakna = 0;
                        o.rakna2 = 0;
                    }
                    else if (this.maps[this.currentmap].layer[i2].ghost == true || this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4].ghost == true) {
                        o.rakna = 0;
                        o.rakna2 = 0;
                        o.collideslistfull(this.maps, this.currentmap, "ghost",this.maps[this.currentmap].layer[i2].objectype[i3].name);
              
                    }
                    else {
                        if (-(this.maps[this.currentmap].camerax / 100 * this.maps[this.currentmap].layer[i2].moving) - o.dimx <= o.x + o.dimx &&
                            ((o.dimx + document.body.clientWidth / (1 + (1 * this.maps[this.currentmap].zoom / 100)) - 8 + 300) - (this.maps[this.currentmap].camerax / 100 * this.maps[this.currentmap].layer[i2].moving)) >= o.x + o.dimx &&
                            -(this.maps[this.currentmap].cameray / 100 * this.maps[this.currentmap].layer[i2].moving) - o.dimy <= o.y + o.dimy+300 &&
                            ((o.dimy + document.body.clientHeight / (1 + (1 * this.maps[this.currentmap].zoom / 100)) - 8 + 300) - (this.maps[this.currentmap].cameray / 100 * this.maps[this.currentmap].layer[i2].moving)) >= o.y + o.dimy) {
                            
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
                        
        for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
            for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
                for (let i4 = 0; i4 < this.maps[this.currentmap].layer[i2].objectype[i3].objects.length; i4++) {
                    var o = this.maps[this.currentmap].layer[i2].objectype[i3].objects[i4];
                    
                    if(o.rakna!=0||o.rakna!=0)o.hadcollidedobj = [];
                    
                    if (o.rakna < 0) {
                        
                        for (let k = 0; k < -o.rakna; k++) {
                            o.x = o.x - 1;
                            if (o.collideslist(this.maps, this.currentmap, "left")) {
                                o.x = o.x + 1;
                                break;
                            }
                        }
                    }
                    else {
                        
                        for (let k = 0; k < o.rakna; k++) {
                            o.x = o.x + 1;
                            if (o.collideslist(this.maps, this.currentmap, "right")) {
                                o.x = o.x - 1;
                                break;
                            }
                        }
                    }
                    if (o.rakna2 < 0) {
                        
                        for (let k = 0; k < -o.rakna2; k++) {
                            o.y = o.y - 1;
                            if (o.collideslist(this.maps, this.currentmap, "up")) {
                                o.y = o.y + 1;
                                break;
                            }
                        }
                    }
                    else {
                        
                        for (let k = 0; k < o.rakna2; k++) {
                            o.y = o.y + 1;
                            if (o.collideslist(this.maps, this.currentmap, "down")) {
                                o.y = o.y - 1;
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
    updateUnitMovement() {
        const objects = this.getAllObjects();
        for (let obj of objects) {
            if (obj.targetX !== null && obj.targetY !== null) {
                const dx = obj.targetX - obj.x;
                const dy = obj.targetY - obj.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist > 1) {
                    // Beräkna rörelseriktning
                    if (Math.abs(dx) > Math.abs(dy)) {
                        obj.direction = dx > 0 ? "right" : "left";
                    } else {
                        obj.direction = dy > 0 ? "down" : "up";
                    }

                    obj.x += (dx / dist) * obj.speed;
                    obj.y += (dy / dist) * obj.speed;
                } else {
                    obj.targetX = null;
                    obj.targetY = null;
                }
            }
        }
    }
    getAllObjects() {
        const list = [];
        for (let map of this.maps) {
            for (let layer of map.layer) {
                for (let objtype of layer.objectype) {
                    list.push(...objtype.objects);
                }
            }
        }
        return list;
    }

    deselectAll() {
        for (let obj of this.getAllObjects()) {
            obj.selected = false;
        }
    }

    getObjectAt(x, y) {
    for (let obj of this.getAllObjects()) {
        if (
            obj.selectable &&
            x >= obj.x &&
            x <= obj.x + obj.dimx &&
            y >= obj.y &&
            y <= obj.y + obj.dimy
        ) {
            return obj;
        }
    }
    return null;
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
            this.objects[i].isonscreen=false;
            try {
                // Check if object is within view horizontally
                if (-camerax - this.objects[i].dimx <= this.objects[i].x + this.objects[i].dimx &&
                    ((this.objects[i].dimx + document.body.clientWidth / (1 + (1 * zoom / 100)) - 8 + 300) - camerax) >= this.objects[i].x + this.objects[i].dimx) {
                    // Check if object is within view vertically
                    if (-cameray - this.objects[i].dimy <= this.objects[i].y + this.objects[i].dimy &&
                        ((this.objects[i].dimy + document.body.clientHeight / (1 + (1 * zoom / 100)) - 8 + 300) - cameray) >= this.objects[i].y + this.objects[i].dimy) {
                        if (this.images[this.objects[i].animation].getimage() != null) {
                            this.objects[i].isonscreen=true;
                            ctx.save();
                            ctx.scale(1 + (1 * zoom / 100), 1 + (1 * zoom / 100));
                            ctx.translate(this.objects[i].x + camerax + this.objects[i].dimx / 2, this.objects[i].y + cameray + this.objects[i].dimy / 2);
                            ctx.rotate((this.objects[i].rot * Math.PI) / 180);
                            if (this.objects[i].fliped == true)
                                ctx.scale(-1, 1);
                            ctx.translate(-(this.objects[i].x + camerax + this.objects[i].dimx / 2), -(this.objects[i].y + cameray + this.objects[i].dimy / 2));
                            ctx.drawImage(this.images[this.objects[i].animation].getimage(), this.objects[i].x + camerax, this.objects[i].y + cameray, this.objects[i].dimx, this.objects[i].dimy);
                            ctx.restore();
                            
                            if (this.objects[i].selected) {
                                ctx.save();
                                ctx.scale(1 + (1 * zoom / 100), 1 + (1 * zoom / 100));
                                ctx.strokeStyle = "#00ff00";
                                ctx.lineWidth = 4;
                                
                                
                                
                                ctx.strokeRect(
                                    this.objects[i].x + camerax,
                                    this.objects[i].y + cameray,
                                    this.objects[i].dimx,
                                    this.objects[i].dimy
                                );
                        
                                ctx.strokeStyle = "black";
                                ctx.lineWidth = 2;
                                
                                
                                
                                ctx.strokeRect(
                                    this.objects[i].x + camerax,
                                    this.objects[i].y + cameray,
                                    this.objects[i].dimx,
                                    this.objects[i].dimy
                                );
                        
                        
                                ctx.restore();
                            }
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
            if (this.imagelist.length == 0) {
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
        this.selected = false;
        this.targetX = null;
        this.targetY = null;
        this.speed = 1.0;
        this.selectable = false;
        this.direction = "up";
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
                        if (objType.objects[i4].rot == 0 && this.rot == 0) {
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
                        else {
                            if (this.collideswith(objType.objects[i4])) {
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
    collideslistfull(maps, currentmap, dir,name) {
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
                                    
                                    objType.objects[i4].collideslistan.push(name);
                                    objType.objects[i4].collideslistandir.push("ghost");
                                    objType.objects[i4].collideslistanobj.push(this);
                                }
                                else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    
                                    objType.objects[i4].collideslistan.push(name);
                                    objType.objects[i4].collideslistandir.push(dir);
                                    objType.objects[i4].collideslistanobj.push(this);
                                }
                            }
                        }
                        else {
                            if (this.collideswith(objType.objects[i4])) {
                                if (maps[currentmap].layer[i2].ghost == true || objType.objects[i4].ghost == true) {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    
                                    objType.objects[i4].collideslistan.push(name);
                                    objType.objects[i4].collideslistandir.push("ghost");
                                    objType.objects[i4].collideslistanobj.push(this);
                                }
                                else {
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    
                                    objType.objects[i4].collideslistan.push(name);
                                    objType.objects[i4].collideslistandir.push(dir);
                                    objType.objects[i4].collideslistanobj.push(this);
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
    toString() {
        return `${this.x} ${this.y} ${this.dimx} ${this.dimy} ${this.rot}`;
    }
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





