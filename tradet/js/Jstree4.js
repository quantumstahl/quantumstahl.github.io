"use strict";

// Required dependencies and supporting code

// Preload images
var treeimage = new Image();
treeimage.src = "https://png.pngtree.com/png-vector/20240127/ourmid/pngtree-big-tree-png-image_11498504.png";

var folderimage = new Image();
folderimage.src = "https://png.pngtree.com/png-vector/20240216/ourmid/pngtree-yellow-folder-illustration-vector-png-image_11747699.png";  

var fileimage = new Image();
fileimage.src = "https://static.vecteezy.com/system/resources/previews/017/178/244/original/file-document-icon-on-transparent-background-free-png.png";

// Global variables
var cursorX;
var cursorY;

var ttree;

let element = {x: null, y: null, l: null, o: null};

var objects;

let flyttar = false;
var count = 0;

document.onmousemove = function(e){
    cursorX = e.pageX;
    cursorY = e.pageY;
};

let wp = false;
let sp = false;
let dp = false;
let ap = false;
let plusp = false;
let minusp = false;
let zoomFactor = 1;
const input55 = document.createElement('input');

// The Jstree4 class with complete implementation
class Jstree4 {

    constructor(name, game) {
        ttree = this;
        this.name = name;
        this.maps = [];
        this.open = true;

        let keysPressed = {};
        document.addEventListener('keydown', (event) => {
            keysPressed[event.key] = true;

            if (keysPressed['w']) {
                wp = true;
            }
            if (keysPressed['s']) {
                sp = true;
            }
            if (keysPressed['d']) {
                dp = true;
            }
            if (keysPressed['a']) {
                ap = true;
            }
            if (keysPressed['h']) {
                game.maps[game.currentmap].camerax = 0;
                game.maps[game.currentmap].cameray = 0;
                game.maps[game.currentmap].zoom = 0;
            }
            if (keysPressed["Delete"]) {
                flyttar = false;
                if(objects != null){
                    for (let i = 0; i < ttree.maps.length; i++){
                        for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++){
                            for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++){
                                const index = ttree.maps[i].layer[i2].objectype[i3].objects.indexOf(objects);
                                if (index > -1) { 
                                    ttree.maps[i].layer[i2].objectype[i3].objects.splice(index, 1); 
                                }
                            }
                        }
                    }
                    objects = null;
                }
            }
            if (keysPressed['+']) {
                plusp = true;
            }
            if (keysPressed['-']) {
                minusp = true;
            }
        });

        document.addEventListener('keyup', (event) => {
            delete keysPressed[event.key];

            if (event.key == 'w'){
                wp = false;
            }
            if (event.key == 's'){
                sp = false;
            }
            if (event.key == 'd'){
                dp = false;
            }
            if (event.key == 'a'){
                ap = false;
            }
            if (event.key == '+'){
                plusp = false;
            }
            if (event.key == '-'){
                minusp = false;
            }
        });
    }

    maketree(canvas, ctx, x, y, game) {



        if (wp == true)
            game.maps[game.currentmap].cameray = game.maps[game.currentmap].cameray + 16 / zoomFactor;
        if (sp == true)
            game.maps[game.currentmap].cameray = game.maps[game.currentmap].cameray - 16 / zoomFactor;
        if (dp == true)
            game.maps[game.currentmap].camerax = game.maps[game.currentmap].camerax - 16 / zoomFactor;
        if (ap == true)
            game.maps[game.currentmap].camerax = game.maps[game.currentmap].camerax + 16 / zoomFactor;
        if (plusp == true)
            game.maps[game.currentmap].zoom = game.maps[game.currentmap].zoom + 1;
        if (minusp == true)
            game.maps[game.currentmap].zoom = game.maps[game.currentmap].zoom - 1;

        // Recompute zoomFactor if changed
        if(game.maps.length>0)
        zoomFactor = 1 + (game.maps[game.currentmap].zoom / 100);

        if (objects != null) {
            objects.x = ((cursorX / zoomFactor) - (ttree.maps[game.currentmap].camerax / 100 * Number(ttree.maps[game.currentmap].layer[objects.buffer].moving)) - objects.dimx / 2);
            objects.y = ((cursorY / zoomFactor) - (ttree.maps[game.currentmap].cameray / 100 * Number(ttree.maps[game.currentmap].layer[objects.buffer].moving)) - objects.dimy / 2);
        }

        this.maps = game.maps;

        ctx.fillStyle = "lightgray";
        ctx.fillRect(0, 0, 200, canvas.height);

        ctx.drawImage(treeimage, x, y, 50, 50);
        ctx.fillStyle = "black";
        ctx.font = "12px serif";

        ctx.fillText(this.name, x, y);

        canvas.ondblclick = function() {

            if (element.x == null) {

                if (cursorX < x + 50 && cursorY < y + 50 && cursorX > x && cursorY > y) {
                    if (ttree.open == true) { ttree.open = false; }
                    else { ttree.open = true; }
                }
                let trean = 0;
                for (let i = 0; i < ttree.maps.length; i++) {

                    if (cursorX < x + 80 && cursorY < y + (30 * i) + 50 + 20 + trean && cursorX > x + 50 && cursorY > y + (30 * i) + 50 + trean) {
                        if (ttree.maps[i].open == true) { ttree.maps[i].open = false; }
                        else { ttree.maps[i].open = true; }
                    }

                    if (ttree.maps[i].open == true) {
                        for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {

                            if (cursorX < x + 110 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 80 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                                if (ttree.maps[i].layer[i2].open == true) { ttree.maps[i].layer[i2].open = false; }
                                else { ttree.maps[i].layer[i2].open = true; }
                            }
                            trean = trean + 30;
                            if (ttree.maps[i].layer[i2].open == true) {
                                for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++) {

                                    if (cursorX < x + 140 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 110 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                                        if (ttree.maps[i].layer[i2].objectype[i3].open == true) { ttree.maps[i].layer[i2].objectype[i3].open = false; }
                                        else { ttree.maps[i].layer[i2].objectype[i3].open = true; }

                                        if (objects != null) {
                                            for (let i = 0; i < ttree.maps.length; i++){
                                                for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++){
                                                    for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++){
                                                        const index = ttree.maps[i].layer[i2].objectype[i3].objects.indexOf(objects);
                                                        if (index > -1) { 
                                                            ttree.maps[i].layer[i2].objectype[i3].objects.splice(index, 1); 
                                                        }
                                                    }
                                                }
                                            }
                                            objects = null;
                                        }
                                    }

                                    trean = trean + 30;

                                    if (ttree.maps[i].layer[i2].objectype[i3].open == true) {

                                        for (let i4 = 0; i4 < ttree.maps[i].layer[i2].objectype[i3].images.length; i4++) {
                                            trean = trean + 30;
                                        }
                                        for (let i4 = 0; i4 < ttree.maps[i].layer[i2].objectype[i3].objects.length; i4++) {
                                            trean = trean + 30;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else {}

            element.x = null;
        };
        canvas.onclick = function() {

            

            if (flyttar == true) {
                objects = null;
            }

            if (element.x == null) {

                
                let trean = 0;
                for (let i = 0; i < ttree.maps.length; i++) {

                    if (cursorX < x + 80 && cursorY < y + (30 * i) + 50 + 20 + trean && cursorX > x + 50 && cursorY > y + (30 * i) + 50 + trean) {
                        game.currentmap = i;
                        objects = null;
                    }

                    if (ttree.maps[i].open == true) {
                        for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {

                            if (cursorX < x + 110 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 80 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                            }
                            trean = trean + 30;
                            if (ttree.maps[i].layer[i2].open == true) {
                                for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++) {

                                    if (cursorX < x + 140 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 110 && cursorY > y + (30 * i) + 50 + 30 + trean && objects == null && game.currentmap == i) {
                                        flyttar = false;
                                        ttree.maps[i].layer[i2].objectype[i3].objects.push(new Objectt(cursorX - game.maps[game.currentmap].camerax / 100 * Number(ttree.maps[i].layer[i2].moving) - Number(ttree.maps[i].layer[i2].objectype[i3].standarddimx) / 2, cursorY - game.maps[game.currentmap].cameray / 100 * Number(ttree.maps[i].layer[i2].moving) - Number(ttree.maps[i].layer[i2].objectype[i3].standarddimy) / 2, Number(ttree.maps[i].layer[i2].objectype[i3].standarddimx), Number(ttree.maps[i].layer[i2].objectype[i3].standarddimy), ttree.maps[i].layer[i2].objectype[i3].rot, ttree.maps[i].layer[i2].objectype[i3].fliped));
                                        objects = ttree.maps[i].layer[i2].objectype[i3].objects[ttree.maps[i].layer[i2].objectype[i3].objects.length - 1];
                                        objects.buffer = i2;
                                    }
                                    else if (game.currentmap == i && objects == ttree.maps[i].layer[i2].objectype[i3].objects[ttree.maps[i].layer[i2].objectype[i3].objects.length - 1] && objects != null && flyttar == false && true != (cursorX < x + 140 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 110 && cursorY > y + (30 * i) + 50 + 30 + trean)) {
                                        if(cursorX<200)return;
                                        ttree.maps[i].layer[i2].objectype[i3].objects.push(new Objectt(cursorX - game.maps[game.currentmap].camerax / 100 * Number(ttree.maps[i].layer[i2].moving) - Number(ttree.maps[i].layer[i2].objectype[i3].standarddimx) / 2, cursorY - game.maps[game.currentmap].cameray / 100 * Number(ttree.maps[i].layer[i2].moving) - Number(ttree.maps[i].layer[i2].objectype[i3].standarddimy) / 2, Number(ttree.maps[i].layer[i2].objectype[i3].standarddimx), Number(ttree.maps[i].layer[i2].objectype[i3].standarddimy), ttree.maps[i].layer[i2].objectype[i3].rot, ttree.maps[i].layer[i2].objectype[i3].fliped));
                                        objects = ttree.maps[i].layer[i2].objectype[i3].objects[ttree.maps[i].layer[i2].objectype[i3].objects.length - 1];
                                        objects.buffer = i2;
                                        return;
                                    }

                                    trean = trean + 30;

                                    if (ttree.maps[i].layer[i2].objectype[i3].open == true) {

                                        for (let i4 = 0; i4 < ttree.maps[i].layer[i2].objectype[i3].images.length; i4++) {
                                            trean = trean + 30;
                                        }
                                        for (let i4 = 0; i4 < ttree.maps[i].layer[i2].objectype[i3].objects.length; i4++) {
                                            trean = trean + 30;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else {}

            if (element.x != null) {
                if (element.l == 0) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {

                        let promt = window.prompt("Add map");
                        if (promt != null)
                            ttree.maps.push(new Maps(promt));
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {

                        let promt = window.prompt("Add map copy");
                        if (promt != null && ttree.maps.length > 0) {
                            ttree.maps.push(new Maps(promt));

                            ttree.maps[ttree.maps.length - 1].camerax = ttree.maps[ttree.maps.length - 2].camerax;
                            ttree.maps[ttree.maps.length - 1].cameray = ttree.maps[ttree.maps.length - 2].cameray;

                            for (let i = 0; i < ttree.maps[ttree.maps.length - 2].layer.length; i++) {

                                ttree.maps[ttree.maps.length - 1].layer.push(new Layer(ttree.maps[ttree.maps.length - 2].layer[i].name));
                                game.getlastlayer().lock = ttree.maps[ttree.maps.length - 2].layer[i].lock;
                                game.getlastlayer().moving = ttree.maps[ttree.maps.length - 2].layer[i].moving;
                                game.getlastlayer().fysics = ttree.maps[ttree.maps.length - 2].layer[i].fysics;
                                game.getlastlayer().solid = ttree.maps[ttree.maps.length - 2].layer[i].solid;
                                game.getlastlayer().ghost = ttree.maps[ttree.maps.length - 2].layer[i].ghost;

                                for (let i2 = 0; i2 < ttree.maps[ttree.maps.length - 2].layer[i].objectype.length; i2++) {

                                    ttree.maps[ttree.maps.length - 1].layer[i].objectype.push(new Objecttype(ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].name));
                                    game.getlastObjecttype().standarddimx = ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].standarddimx;
                                    game.getlastObjecttype().standarddimy = ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].standarddimy;
                                    game.getlastObjecttype().rot = ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].rot;
                                    game.getlastObjecttype().fliped = ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].fliped;

                                    for (let i3 = 0; i3 < ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].images.length; i3++) {

                                        ttree.maps[ttree.maps.length - 1].layer[i].objectype[i2].images.push(new Sprites(""));
                                        game.getlastSprites().speed = ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].images[i3].speed;

                                        for (let i4 = 0; i4 < ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].images[i3].images.length; i4++) {

                                            ttree.maps[ttree.maps.length - 1].layer[i].objectype[i2].images[i3].images.push(new String(ttree.maps[ttree.maps.length - 2].layer[i].objectype[i2].images[i3].images[i4]));
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        let promt = window.prompt("Rename", ttree.name);
                        if (promt != null) {
                            ttree.name = promt;
                            game.name = promt;
                        }
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 100 && cursorX > element.x && cursorY > element.y + 75) {
                        //alert("SAVE");

                        let promt = window.prompt("Save name:", ttree.name);
                        if (promt == null) return;

                        const link = document.createElement("a");
                        const file = new Blob([game.toString()], { type: 'data' });
                        link.href = URL.createObjectURL(file);
                        link.download = promt+".txt";
                        link.click();
                        URL.revokeObjectURL(link.href);
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 125 && cursorX > element.x && cursorY > element.y + 100) {
                        //alert("LOAD");

                        let input = document.createElement('input');
                        input.type = 'file';
                        input.multiple = false;

                        input.onchange = _ => {
                            game.maps = [];
                            let file = Array.from(input.files);
                            var client = new XMLHttpRequest();
                            client.open('GET', URL.createObjectURL(file[0]));
                            client.onreadystatechange = function() {
                                var lines = client.responseText.split('\n');
                                if (game.maps.length == 0) {
                                    for (var i = 0; i < lines.length; i++) {

                                        game.name = lines[0];
                                        ttree.name = lines[0];
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
                                            game.getlastObjecttype().objects.push(new Objectt(Number(lines[i + 1]), Number(lines[i + 2]), Number(lines[i + 3]), Number(lines[i + 4]), Number(lines[i + 5]), JSON.parse(lines[i + 6])));
                                            i = i + 6;
                                        }
                                    }
                                }
                            }
                            client.send();
                        };
                        input.click();
                    }
                }
                if (element.l == 1) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        let promt = window.prompt("Add Layer");
                        if (promt != null)
                            element.o.layer.push(new Layer(promt));
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        let promt = window.prompt("Rename", element.o.name);
                        if (promt != null)
                            element.o.name = promt;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        var result = confirm("REMOVE " + element.o.name);
                        if (result === false) {
                            element.x = null;
                            return;
                        }
                        const index = ttree.maps.indexOf(element.o);
                        if (index > -1) {
                            ttree.maps.splice(index, 1);
                        }
                    }
                }
                if (element.l == 2) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        let promt = window.prompt("Add objecttype");
                        if (promt != null)
                            element.o.objectype.push(new Objecttype(promt));
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        let promt = window.prompt("Rename", element.o.name);
                        if (promt != null)
                            element.o.name = promt;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        var result = confirm("REMOVE " + element.o.name);
                        if (result === false) {
                            element.x = null;
                            return;
                        }
                        for (let i = 0; i < ttree.maps.length; i++) {
                            const index = ttree.maps[i].layer.indexOf(element.o);
                            if (index > -1) {
                                ttree.maps[i].layer.splice(index, 1);
                            }
                        }
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 100 && cursorX > element.x && cursorY > element.y + 75) {
                        if (element.o.lock == true) element.o.lock = false;
                        else element.o.lock = true;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 125 && cursorX > element.x && cursorY > element.y + 100) {
                        let promt = window.prompt("Moving %: ", element.o.moving);
                        if (promt != null)
                            element.o.moving = Number(promt);
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 150 && cursorX > element.x && cursorY > element.y + 125) {
                        if (element.o.fysics == true) element.o.fysics = false;
                        else element.o.fysics = true;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 175 && cursorX > element.x && cursorY > element.y + 150) {
                        if (element.o.solid == true) element.o.solid = false;
                        else element.o.solid = true;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 200 && cursorX > element.x && cursorY > element.y + 175) {
                        if (element.o.ghost == true) element.o.ghost = false;
                        else element.o.ghost = true;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 225 && cursorX > element.x && cursorY > element.y + 200) {
                        for (let i = 0; i < ttree.maps.length; i++) {
                            if (i == game.currentmap) {
                                const index = ttree.maps[i].layer.indexOf(element.o);
                                if (index > 0) {
                                    var f = ttree.maps[i].layer.splice(index, 1)[0];
                                    ttree.maps[i].layer.splice(index - 1, 0, f);
                                }
                            }
                        }
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 250 && cursorX > element.x && cursorY > element.y + 225) {
                        for (let i = 0; i < ttree.maps.length; i++) {
                            if (i == game.currentmap) {
                                const index = ttree.maps[i].layer.indexOf(element.o);
                                if (index <= ttree.maps[i].layer.length) {
                                    var f = ttree.maps[i].layer.splice(index, 1)[0];
                                    ttree.maps[i].layer.splice(index + 1, 0, f);
                                }
                            }
                        }
                    }
                }
                if (element.l == 3) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {

                        
                        input55.type = 'file';
                        input55.multiple = true;

                        input55.onchange = _ => {
                            element.o.images.push(new Sprites(""));
                            element.o.images[element.o.images.length - 1].images = Array.from(input55.files);

                            for (let i = 0; i < element.o.images[element.o.images.length - 1].images.length; i++) {
                                element.o.images[element.o.images.length - 1].images[i] = "images/" + element.o.images[element.o.images.length - 1].images[i].name;
                            }

                        };
                        input55.click();
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        let promt = window.prompt("Dimx", Number(element.o.standarddimx));
                        if (promt != null)
                            element.o.standarddimx = Number(promt);
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        let promt = window.prompt("Dimy", Number(element.o.standarddimy));
                        if (promt != null)
                            element.o.standarddimy = Number(promt);
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 100 && cursorX > element.x && cursorY > element.y + 75) {
                        let promt = window.prompt("Rotation", element.o.rot);
                        if (promt != null)
                            element.o.rot = Number(promt);
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 125 && cursorX > element.x && cursorY > element.y + 100) {
                        if (element.o.fliped == false) element.o.fliped = true;
                        else element.o.fliped = false;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 150 && cursorX > element.x && cursorY > element.y + 125) {
                        let promt = window.prompt("Rename", element.o.name);
                        if (promt != null)
                            element.o.name = promt;
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 175 && cursorX > element.x && cursorY > element.y + 150) {
                        var result = confirm("REMOVE " + element.o.name);
                        if (result === false) {
                            element.x = null;
                            return;
                        }
                        for (let i = 0; i < ttree.maps.length; i++) {
                            for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {
                                const index = ttree.maps[i].layer[i2].objectype.indexOf(element.o);
                                if (index > -1) {
                                    ttree.maps[i].layer[i2].objectype.splice(index, 1);
                                }
                            }
                        }
                    }
                }
                if (element.l == 5) {

                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        let promt = window.prompt("Change animation speed.. lower is faster", element.o.speed);
                        if (promt != null && isNaN(promt) == false)
                            element.o.speed = Number(promt);
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        for (let i = 0; i < ttree.maps.length; i++) {
                            for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {
                                for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++) {
                                    const index = ttree.maps[i].layer[i2].objectype[i3].images.indexOf(element.o);
                                    if (index > -1) {
                                        ttree.maps[i].layer[i2].objectype[i3].images.splice(index, 1);
                                    }
                                }
                            }
                        }
                    }
                }
                if (element.l == 4) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {

                        for (let i = 0; i < ttree.maps.length; i++) {
                            for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {
                                for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++) {
                                    const index = ttree.maps[i].layer[i2].objectype[i3].objects.indexOf(element.o);
                                    if (index > -1) {
                                        ttree.maps[i].layer[i2].objectype[i3].objects.splice(index, 1);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else {}
            //element.x = null;
            for (let i = ttree.maps.length - 1; i > -1; i--) {
                for (let i2 = ttree.maps[i].layer.length - 1; i2 > -1; i2--) {
                    for (let i3 = ttree.maps[i].layer[i2].objectype.length - 1; i3 > -1; i3--) {
                        for (let i4 = ttree.maps[i].layer[i2].objectype[i3].objects.length - 1; i4 > -1; i4--) {

                            if (element.x == null&&flyttar == false && game.currentmap == i && objects == null && (!(cursorX < 200 && cursorY < 600)) &&
                                ttree.collideCircleWithRotatedRectangle(
                                    (cursorX / zoomFactor),
                                    (cursorY / zoomFactor),
                                    1,
                                    Number(ttree.maps[game.currentmap].camerax) / 100 * Number(ttree.maps[i].layer[i2].moving) + Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].x) + (Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].dimx) / 2),
                                    Number(ttree.maps[game.currentmap].cameray) / 100 * Number(ttree.maps[i].layer[i2].moving) + Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].y) + (Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].dimy) / 2),
                                    Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].dimx),
                                    Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].dimy),
                                    (-Number(ttree.maps[i].layer[i2].objectype[i3].objects[i4].rot) * Math.PI) / 180
                                )) {

                                if (JSON.parse(ttree.maps[i].layer[i2].lock) === false) {
                                    flyttar = true;
                                    objects = ttree.maps[i].layer[i2].objectype[i3].objects[i4];
                                    objects.buffer = i2;
                                }
                                element.x = null;
                                return;
                            }
                        }
                    }
                }
            }
            flyttar = false;

            if (count > 1) count = 0;
            count++;

            element.x = null;

        };

        canvas.addEventListener('contextmenu', function(evt) {
            evt.preventDefault();
            element.x = null;
            flyttar = false;
            if (objects != null) {
                for (let i = 0; i < ttree.maps.length; i++){
                    for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++){
                        for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++){
                            const index = ttree.maps[i].layer[i2].objectype[i3].objects.indexOf(objects);
                            if (index > -1) {
                                ttree.maps[i].layer[i2].objectype[i3].objects.splice(index, 1);
                            }
                        }
                    }
                }
                objects = null;
            }
            if (evt.button == 2) {

                if (cursorX < x + 50 && cursorY < y + 50 && cursorX > x && cursorY > y) {

                    element.x = cursorX; element.y = cursorY; element.l = 0;
                }
                let trean = 0;
                for (let i = 0; i < ttree.maps.length; i++) {

                    if (cursorX < x + 80 && cursorY < y + (30 * i) + 50 + 20 + trean && cursorX > x + 50 && cursorY > y + (30 * i) + 50 + trean) {
                        element.x = cursorX; element.y = cursorY; element.l = 1; element.o = ttree.maps[i];
                    }

                    if (ttree.maps[i].open == true) {
                        for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {

                            if (cursorX < x + 110 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 80 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                                element.x = cursorX; element.y = cursorY; element.l = 2; element.o = ttree.maps[i].layer[i2];
                            }
                            trean = trean + 30;
                            if (ttree.maps[i].layer[i2].open == true) {
                                for (let i3 = 0; i3 < ttree.maps[i].layer[i2].objectype.length; i3++) {

                                    if (cursorX < x + 140 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 110 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                                        element.x = cursorX; element.y = cursorY; element.l = 3; element.o = ttree.maps[i].layer[i2].objectype[i3];
                                    }
                                    trean = trean + 30;

                                    if (ttree.maps[i].layer[i2].objectype[i3].open == true) {

                                        for (let i4 = 0; i4 < ttree.maps[i].layer[i2].objectype[i3].images.length; i4++) {
                                            if (cursorX < x + 170 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 140 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                                                element.x = cursorX; element.y = cursorY; element.l = 5; element.o = ttree.maps[i].layer[i2].objectype[i3].images[i4];
                                            }
                                            trean = trean + 30;
                                        }

                                        for (let i4 = 0; i4 < ttree.maps[i].layer[i2].objectype[i3].objects.length; i4++) {
                                            if (cursorX < x + 170 && cursorY < y + (30 * i) + 50 + 30 + trean + 20 && cursorX > x + 140 && cursorY > y + (30 * i) + 50 + 30 + trean) {
                                                element.x = cursorX; element.y = cursorY; element.l = 4; element.o = ttree.maps[i].layer[i2].objectype[i3].objects[i4];
                                            }
                                            trean = trean + 30;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }, false);

        if (ttree.open == false) {
            ctx.fillText("+", x - 8, y + 30);
        }
        else {
            ctx.fillText("-", x - 8, y + 30);

            let trean = 0;

            for (let i = 0; i < this.maps.length; i++) {

                if (this.maps[i].layer.length > 0) {
                    ctx.drawImage(folderimage, x + (50), y + (30 * i) + 50 + trean, 30, 20);
                    ctx.fillText(this.maps[i].name, x + (50), y + (30 * i) + 50 + trean);

                    if (this.maps[i].open == true) ctx.fillText("-", x + (50) - 8, y + (30 * i) + 50 + 15 + trean);
                    else ctx.fillText("+", x + (50) - 8, y + (30 * i) + 50 + 15 + trean);
                }
                else {
                    ctx.fillText(this.maps[i].name, x + (50), y + (30 * i) + 50 + trean);
                    ctx.drawImage(fileimage, x + (50), y + (30 * i) + 50 + trean, 30, 20);
                }
                if (ttree.maps[i].open == true) {
                    for (let i2 = 0; i2 < ttree.maps[i].layer.length; i2++) {

                        if (this.maps[i].layer[i2].objectype.length > 0) {
                            ctx.fillText(this.maps[i].layer[i2].name, x + (80), y + (30 * i) + 50 + 30 + trean);
                            ctx.drawImage(folderimage, x + (80), y + (30 * i) + 50 + 30 + trean, 30, 20);

                            if (this.maps[i].layer[i2].open == true) ctx.fillText("-", x + (80) - 8, y + (30 * i) + 50 + 45 + trean);
                            else ctx.fillText("+", x + (80) - 8, y + (30 * i) + 50 + 45 + trean);
                        }
                        else {
                            ctx.fillText(this.maps[i].layer[i2].name, x + (80), y + (30 * i) + 50 + 30 + trean);
                            ctx.drawImage(fileimage, x + (80), y + (30 * i) + 50 + 30 + trean, 30, 20);
                        }

                        trean = trean + 30;

                        if (this.maps[i].layer[i2].open == true) {
                            for (let i3 = 0; i3 < this.maps[i].layer[i2].objectype.length; i3++) {

                                if (this.maps[i].layer[i2].objectype[i3].objects.length > 0 || this.maps[i].layer[i2].objectype[i3].images.length > 0) {

                                    try {
                                        ctx.drawImage(this.maps[i].layer[i2].objectype[i3].images[0].getimage(), x + (110), y + (30 * i) + 80 + trean, 30, 20);
                                    } catch (error) {
                                        ctx.drawImage(folderimage, x + (110), y + (30 * i) + 80 + trean, 30, 20);
                                    }

                                    ctx.fillText(this.maps[i].layer[i2].objectype[i3].name, x + (110), y + (30 * i) + 50 + 30 + trean);
                                    if (this.maps[i].layer[i2].objectype[i3].open == true) ctx.fillText("-", x + (110) - 8, y + (30 * i) + 50 + 45 + trean);
                                    else ctx.fillText("+", x + (110) - 8, y + (30 * i) + 50 + 45 + trean);
                                }
                                else {
                                    ctx.fillText(this.maps[i].layer[i2].objectype[i3].name, x + (110), y + (30 * i) + 50 + 30 + trean);
                                    ctx.drawImage(fileimage, x + (110), y + (30 * i) + 80 + trean, 30, 20);
                                }
                                trean = trean + 30;

                                if (this.maps[i].layer[i2].objectype[i3].open == true) {
                                    for (let i4 = 0; i4 < this.maps[i].layer[i2].objectype[i3].images.length; i4++) {
                                        ctx.fillText(this.maps[i].layer[i2].objectype[i3].images[i4].name, x + (140), y + (30 * i) + 50 + 30 + trean);
                                        try {
                                            ctx.drawImage(this.maps[i].layer[i2].objectype[i3].images[i4].getimage(), x + (140), y + (30 * i) + 80 + trean, 30, 20);
                                        } catch (error) {}
                                        trean = trean + 30;
                                    }
                                    for (let i4 = 0; i4 < this.maps[i].layer[i2].objectype[i3].objects.length; i4++) {
                                        ctx.fillText(this.maps[i].layer[i2].objectype[i3].objects[i4].toString(), x + (140), y + (30 * i) + 50 + 30 + trean);
                                        ctx.drawImage(fileimage, x + (140), y + (30 * i) + 80 + trean, 30, 20);
                                        trean = trean + 30;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if (element.x != null) {
            if (element.l == 0) {
                ctx.fillStyle = "lightgray";
                ctx.fillRect(element.x, element.y, 130, 125);
                ctx.fillStyle = "black";
                ctx.font = "16px serif";

                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 25); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 50); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 75); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 100); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 125); ctx.stroke();

                ctx.fillText("Add map empty", element.x, element.y + 20);
                ctx.fillText("Add map copy", element.x, element.y + 45);
                ctx.fillText("Rename", element.x, element.y + 70);
                ctx.fillText("Save", element.x, element.y + 95);
                ctx.fillText("Load", element.x, element.y + 120);
            }
            if (element.l == 1) {
                ctx.fillStyle = "lightgray";
                ctx.fillRect(element.x, element.y, 130, 75);
                ctx.fillStyle = "black";
                ctx.font = "16px serif";

                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 25); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 50); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 75); ctx.stroke();

                ctx.fillText("Add layer", element.x, element.y + 20);
                ctx.fillText("Rename", element.x, element.y + 45);
                ctx.fillText("Remove map", element.x, element.y + 70);
            }
            if (element.l == 2) {
                ctx.fillStyle = "lightgray";
                ctx.fillRect(element.x, element.y, 130, 250);
                ctx.fillStyle = "black";
                ctx.font = "16px serif";

                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 25); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 50); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 75); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 100); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 125); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 150); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 175); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 200); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 225); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 250); ctx.stroke();

                ctx.fillText("Add objecttype", element.x, element.y + 20);
                ctx.fillText("Rename", element.x, element.y + 45);
                ctx.fillText("Remove layer", element.x, element.y + 70);
                ctx.fillText("Lock layer: " + element.o.lock, element.x, element.y + 95);
                ctx.fillText("Moving %: " + element.o.moving, element.x, element.y + 120);
                ctx.fillText("Fysical: " + element.o.fysics, element.x, element.y + 145);
                ctx.fillText("Solid: " + element.o.solid, element.x, element.y + 170);
                ctx.fillText("Ghost: " + element.o.ghost, element.x, element.y + 195);
                ctx.fillText("Up", element.x, element.y + 220);
                ctx.fillText("Down", element.x, element.y + 245);
            }
            if (element.l == 3) {
                ctx.fillStyle = "lightgray";
                ctx.fillRect(element.x, element.y, 130, 175);
                ctx.fillStyle = "black";
                ctx.font = "16px serif";

                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 25); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 50); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 75); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 100); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 125); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 150); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 175); ctx.stroke();

                ctx.fillText("Add animation", element.x, element.y + 20);
                ctx.fillText("Set dimx", element.x, element.y + 45);
                ctx.fillText("Set dimy", element.x, element.y + 70);
                ctx.fillText("Set rotation", element.x, element.y + 95);
                ctx.fillText("Flipped : " + element.o.fliped, element.x, element.y + 120);
                ctx.fillText("Rename", element.x, element.y + 145);
                ctx.fillText("Remove objecttype", element.x, element.y + 170);
            }
            if (element.l == 4) {
                ctx.fillStyle = "lightgray";
                ctx.fillRect(element.x, element.y, 130, 25);
                ctx.fillStyle = "black";
                ctx.font = "16px serif";

                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 25); ctx.stroke();

                ctx.fillText("Remove object", element.x, element.y + 20);
            }
            if (element.l == 5) {
                ctx.fillStyle = "lightgray";
                ctx.fillRect(element.x, element.y, 130, 50);
                ctx.fillStyle = "black";
                ctx.font = "16px serif";

                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 25); ctx.stroke();
                ctx.beginPath(); ctx.rect(element.x, element.y, 130, 50); ctx.stroke();

                ctx.fillText("Change ani speed", element.x, element.y + 20);
                ctx.fillText("Remove animation", element.x, element.y + 45);
            }
        }
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

        // Closest point in the rectangle to the center of circle rotated backwards (unrotated)
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
        var distance = ttree.getDistance(unrotatedCircleX, unrotatedCircleY, closestX, closestY);

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
}
