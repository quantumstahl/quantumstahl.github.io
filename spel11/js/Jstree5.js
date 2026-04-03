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
var selectedObject = null;
const input55 = document.createElement('input');

// The Jstree4 class with complete implementation
class Jstree5 {
    
    constructor(name, game) {
        this.name = name;
        this.maps = [];
        this.open = true;
        this.startstart=false;
        this.fileHandle = null;
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
                if (selectedObject) {
                    this.removeObjectFromAllMaps(selectedObject);
                    selectedObject = null;
                    objects = null;
                }
            }
            if (keysPressed['+']) {
                plusp = true;
            }
            if (keysPressed['-']) {
                minusp = true;
            }
            if (event.key === "r" && selectedObject) {
                selectedObject.rot += 15;
            }

            if (event.key === "c" && selectedObject) {
                const map = this.maps[game.currentmap];
                const layer = map.layer[selectedObject.buffer];

                const type = layer.objectype.find(t =>
                    t.objects.includes(selectedObject)
                );

                if (type) {
                    const clone = new Objectx(
                        selectedObject.x + 10,
                        selectedObject.y + 10,
                        selectedObject.dimx,
                        selectedObject.dimy,
                        selectedObject.rot,
                        selectedObject.fliped
                    );

                    clone.buffer = selectedObject.buffer;

                    type.objects.push(clone);

                    selectedObject = clone;
                    objects = clone;
                }
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
    async saveAs(game) {
        try {
            this.fileHandle = await window.showSaveFilePicker({
                suggestedName: "map.txt",
                types: [{
                    description: "Map Files",
                    accept: { "text/plain": [".txt"] }
                }]
            });

            await this.saveToFile(game);

        } catch (err) {
            console.error("Save cancelled", err);
        }
    }
    async saveToFile(game) {
        if (!this.fileHandle) return;

        const writable = await this.fileHandle.createWritable();
        await writable.write(game.toString());
        await writable.close();
    }
    async autoSave(game) {
        if (this._saving) return;
        this._saving = true;

        setTimeout(() => {
            if (this.fileHandle) {
                this.saveToFile(game);
            } else {
                localStorage.setItem("editor_autosave_map", game.toString());
            }
            this._saving = false;
        }, 300);
        
    }
    updateCamera(game) {
        if (game.maps.length <= 0) return;

        const map = game.maps[game.currentmap];

        if (wp === true) map.cameray += 16 / zoomFactor;
        if (sp === true) map.cameray -= 16 / zoomFactor;
        if (dp === true) map.camerax -= 16 / zoomFactor;
        if (ap === true) map.camerax += 16 / zoomFactor;
        if (plusp === true) map.zoom += 1;
        if (minusp === true) map.zoom -= 1;

        zoomFactor = 1 + (map.zoom / 100);
    }

    updateDraggedObject(game) {
        if (objects == null) return;
        if (this.maps.length <= 0) return;

        const map = this.maps[game.currentmap];
        const layer = map.layer[objects.buffer];
        if (!layer) return;

        objects.x = (cursorX / zoomFactor) - (map.camerax / 100 * Number(layer.moving)) - objects.dimx / 2;
        objects.y = (cursorY / zoomFactor) - (map.cameray / 100 * Number(layer.moving)) - objects.dimy / 2;
        this._needsAutosave = true;
    }
    removeObjectFromAllMaps(obj) {
        if (obj == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            for (let i2 = 0; i2 < this.maps[i].layer.length; i2++) {
                for (let i3 = 0; i3 < this.maps[i].layer[i2].objectype.length; i3++) {
                    const index = this.maps[i].layer[i2].objectype[i3].objects.indexOf(obj);
                    if (index > -1) {
                        this.maps[i].layer[i2].objectype[i3].objects.splice(index, 1);
                    }
                }
            }
        }
    }

    clearDraggedObject(removeFromMap = false) {
        flyttar = false;

        if (removeFromMap === true && objects != null) {
            this.removeObjectFromAllMaps(objects);
        }

        objects = null;
        selectedObject = null;
    }
    drawMenuBox(ctx, x, y, w, h) {
        ctx.fillStyle = "lightgray";
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "black";
        ctx.font = "16px serif";
    }

    drawMenuRow(ctx, x, y, w, h) {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
    }
    drawContextMenu(ctx) {
        if (element.x == null) return;

        if (element.l == 0) {
            this.drawMenuBox(ctx, element.x, element.y, 130, 125);

            this.drawMenuRow(ctx, element.x, element.y, 130, 25);
            this.drawMenuRow(ctx, element.x, element.y, 130, 50);
            this.drawMenuRow(ctx, element.x, element.y, 130, 75);
            this.drawMenuRow(ctx, element.x, element.y, 130, 100);
            this.drawMenuRow(ctx, element.x, element.y, 130, 125);

            ctx.fillText("Add map empty", element.x, element.y + 20);
            ctx.fillText("Add map copy", element.x, element.y + 45);
            ctx.fillText("Rename", element.x, element.y + 70);
            ctx.fillText("Save", element.x, element.y + 95);
            ctx.fillText("Load", element.x, element.y + 120);
        }

        if (element.l == 1) {
            this.drawMenuBox(ctx, element.x, element.y, 130, 75);

            this.drawMenuRow(ctx, element.x, element.y, 130, 25);
            this.drawMenuRow(ctx, element.x, element.y, 130, 50);
            this.drawMenuRow(ctx, element.x, element.y, 130, 75);

            ctx.fillText("Add layer", element.x, element.y + 20);
            ctx.fillText("Rename", element.x, element.y + 45);
            ctx.fillText("Remove map", element.x, element.y + 70);
        }

        if (element.l == 2) {
            this.drawMenuBox(ctx, element.x, element.y, 130, 250);

            this.drawMenuRow(ctx, element.x, element.y, 130, 25);
            this.drawMenuRow(ctx, element.x, element.y, 130, 50);
            this.drawMenuRow(ctx, element.x, element.y, 130, 75);
            this.drawMenuRow(ctx, element.x, element.y, 130, 100);
            this.drawMenuRow(ctx, element.x, element.y, 130, 125);
            this.drawMenuRow(ctx, element.x, element.y, 130, 150);
            this.drawMenuRow(ctx, element.x, element.y, 130, 175);
            this.drawMenuRow(ctx, element.x, element.y, 130, 200);
            this.drawMenuRow(ctx, element.x, element.y, 130, 225);
            this.drawMenuRow(ctx, element.x, element.y, 130, 250);

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
            this.drawMenuBox(ctx, element.x, element.y, 130, 175);

            this.drawMenuRow(ctx, element.x, element.y, 130, 25);
            this.drawMenuRow(ctx, element.x, element.y, 130, 50);
            this.drawMenuRow(ctx, element.x, element.y, 130, 75);
            this.drawMenuRow(ctx, element.x, element.y, 130, 100);
            this.drawMenuRow(ctx, element.x, element.y, 130, 125);
            this.drawMenuRow(ctx, element.x, element.y, 130, 150);
            this.drawMenuRow(ctx, element.x, element.y, 130, 175);

            ctx.fillText("Add animation", element.x, element.y + 20);
            ctx.fillText("Set dimx", element.x, element.y + 45);
            ctx.fillText("Set dimy", element.x, element.y + 70);
            ctx.fillText("Set rotation", element.x, element.y + 95);
            ctx.fillText("Flipped : " + element.o.fliped, element.x, element.y + 120);
            ctx.fillText("Rename", element.x, element.y + 145);
            ctx.fillText("Remove objecttype", element.x, element.y + 170);
        }

        if (element.l == 4) {
            this.drawMenuBox(ctx, element.x, element.y, 130, 25);

            this.drawMenuRow(ctx, element.x, element.y, 130, 25);

            ctx.fillText("Remove object", element.x, element.y + 20);
        }

        if (element.l == 5) {
            this.drawMenuBox(ctx, element.x, element.y, 130, 50);

            this.drawMenuRow(ctx, element.x, element.y, 130, 25);
            this.drawMenuRow(ctx, element.x, element.y, 130, 50);

            ctx.fillText("Change ani speed", element.x, element.y + 20);
            ctx.fillText("Remove animation", element.x, element.y + 45);
        }
    }
    drawTree(ctx, x, y,game) {
        const mapIndex = game.currentmap;
        const map = this.maps[mapIndex];
        if (!map) return;
                // Map header
        ctx.fillText(map.name, x + 50, y + 50);
        ctx.drawImage(folderimage, x + 50, y + 50, 30, 20);

        if (map.open) {
            ctx.fillText("-", x + 42, y + 65);
        } else {
            ctx.fillText("+", x + 42, y + 65);
        }

        let trean = 0;

   



        if (map.open) {
            for (let i2 = 0; i2 < map.layer.length; i2++) {

                const layer = map.layer[i2];

                if (layer.objectype.length > 0) {
                    ctx.fillText(layer.name, x + 80, y + 80 + trean);
                    ctx.drawImage(folderimage, x + 80, y + 80 + trean, 30, 20);

                    if (layer.open) {
                        ctx.fillText("-", x + 72, y + 95 + trean);
                    } else {
                        ctx.fillText("+", x + 72, y + 95 + trean);
                    }
                } else {
                    ctx.fillText(layer.name, x + 80, y + 80 + trean);
                    ctx.drawImage(fileimage, x + 80, y + 80 + trean, 30, 20);
                }

                trean += 30;

                if (layer.open) {
                    for (let i3 = 0; i3 < layer.objectype.length; i3++) {

                        const type = layer.objectype[i3];

                        ctx.fillText(type.name, x + 110, y + 80 + trean);

                        try {
                            ctx.drawImage(type.images[0].getimage(), x + 110, y + 110 + trean-30, 30, 20);
                        } catch {
                            ctx.drawImage(folderimage, x + 110, y + 110 + trean-30, 30, 20);
                        }

                        if (type.open) {
                            ctx.fillText("-", x + 102, y + 95 + trean);
                        } else {
                            ctx.fillText("+", x + 102, y + 95 + trean);
                        }

                        trean += 30;

if (type.open) {

    for (let i4 = 0; i4 < type.images.length; i4++) {
        try { ctx.drawImage(type.images[i4].getimage(), x + 140, y + 80 + trean, 30, 20);} catch (error) {}
        trean += 30;
    }

    for (let i4 = 0; i4 < type.objects.length; i4++) {
        ctx.drawImage(fileimage, x + (140), y + 80 + trean, 30, 20);
        ctx.fillText(type.objects[i4].name, x + 140, y + 80 + trean);
        trean += 30;
    }
}
                    }
                }
            }
        }
        
    }
    tryPickObjectAtCursor(game) {
        for (let i = this.maps.length - 1; i >= 0; i--) {
            for (let i2 = this.maps[i].layer.length - 1; i2 >= 0; i2--) {
                for (let i3 = this.maps[i].layer[i2].objectype.length - 1; i3 >= 0; i3--) {
                    for (let i4 = this.maps[i].layer[i2].objectype[i3].objects.length - 1; i4 >= 0; i4--) {

                        const obj = this.maps[i].layer[i2].objectype[i3].objects[i4];

                        if (
                            element.x == null &&
                            flyttar == false &&
                            game.currentmap == i &&
                            objects == null &&
                            !(cursorX < 200 && cursorY < 600) &&
                            this.collideCircleWithRotatedRectangle(
                                (cursorX / zoomFactor),
                                (cursorY / zoomFactor),
                                1,
                                Number(this.maps[game.currentmap].camerax) / 100 * Number(this.maps[i].layer[i2].moving) + Number(obj.x) + (Number(obj.dimx) / 2),
                                Number(this.maps[game.currentmap].cameray) / 100 * Number(this.maps[i].layer[i2].moving) + Number(obj.y) + (Number(obj.dimy) / 2),
                                Number(obj.dimx),
                                Number(obj.dimy),
                                (-Number(obj.rot) * Math.PI) / 180
                            )
                        ) {
                            if (JSON.parse(this.maps[i].layer[i2].lock) === false) {
                                flyttar = true;
                                objects = obj;
                                objects.buffer = i2;
                                selectedObject = obj;
                            }

                            element.x = null;
                            return true;
                        }
                    }
                }
            }
        }

        flyttar = false;
        return false;
    }
    tryPlaceObjectFromTree(x, y, game) {

        let trean = 0;

        const i = game.currentmap;
        const map = this.maps[i];

        if (this.maps[i].open == true) {

            for (let i2 = 0; i2 < this.maps[i].layer.length; i2++) {

                trean += 30;

                if (this.maps[i].layer[i2].open == true) {

                    for (let i3 = 0; i3 < this.maps[i].layer[i2].objectype.length; i3++) {

                        const objectType = this.maps[i].layer[i2].objectype[i3];

                        // === KLICK PÅ OBJECTTYPE → skapa nytt objekt ===
                        if (
                            cursorX < x + 140 &&
                            cursorY < y    + 50 + 30 + trean + 20 &&
                            cursorX > x + 110 &&
                            cursorY < y + 40  + 50 + 30 + trean &&
                            objects == null &&
                            game.currentmap == i
                        ) {
                            flyttar = false;

                            const map = game.maps[game.currentmap];
                            const layer = this.maps[i].layer[i2];

                            const newObj = new Objectx(
                                cursorX - map.camerax / 100 * Number(layer.moving) - Number(objectType.standarddimx) / 2,
                                cursorY - map.cameray / 100 * Number(layer.moving) - Number(objectType.standarddimy) / 2,
                                Number(objectType.standarddimx),
                                Number(objectType.standarddimy),
                                objectType.rot,
                                objectType.fliped
                            );

                            objectType.objects.push(newObj);

                            objects = newObj;
                            objects.buffer = i2;
                            selectedObject=newObj;
                            this.autoSave(game);
                            return true;
                        }

                        // === KLICK I VÄRLDEN → placera fler ===
                        else if (
                            game.currentmap == i &&
                            objects == objectType.objects[objectType.objects.length - 1] &&
                            objects != null &&
                            flyttar == false &&
                            !(cursorX < x + 140 &&
                              cursorY < y   + 50 + 30 + trean + 20 &&
                              cursorX > x + 110 &&
                              cursorY > y  + 50 + 30 + trean)
                        ) {
                            if (cursorX < 200) return true;

                            const map = game.maps[game.currentmap];
                            const layer = this.maps[i].layer[i2];

                            const newObj = new Objectx(
                                cursorX - map.camerax / 100 * Number(layer.moving) - Number(objectType.standarddimx) / 2,
                                cursorY - map.cameray / 100 * Number(layer.moving) - Number(objectType.standarddimy) / 2,
                                Number(objectType.standarddimx),
                                Number(objectType.standarddimy),
                                objectType.rot,
                                objectType.fliped
                            );

                            objectType.objects.push(newObj);

                            objects = newObj;
                            objects.buffer = i2;
                            selectedObject=newObj;
                            this.autoSave(game);
                            return true;
                        }

                        trean += 30;

                        if (objectType.open == true) {
                            trean += objectType.images.length * 30;
                            trean += objectType.objects.length * 30;
                        }
                    }
                }
            }
        }


        return false;
    }
    handleClick(x, y, game) {
        // =========================
        // SAVE BUTTON CLICK
        // =========================
        if (cursorY < 40) {

            const saveX = window.innerWidth - 120;

            if (cursorX > saveX) {

                if (!this.fileHandle) {
                    this.saveAs(game);
                } else {
                    this.saveToFile(game);
                }

                return;
            }
        }
        // =========================
        // TOP BAR CLICK
        // =========================
        const tabWidth = 100;

        if (cursorY < 40) {

            const index = Math.floor(cursorX / tabWidth);

            // klick på map
            if (index < this.maps.length) {
                game.currentmap = index;
                markStaticsDirty();
                objects = null;
                return;
            }

            // klick på +
            if (index === this.maps.length) {
                const name = prompt("New map name");
                if (name != null) {
                    this.addMap(name, true, game);
                    this.autoSave(game);
                }
                return;
            }
        }
        // 1. avbryt drag
        if (flyttar == true) {
            objects = null;
            selectedObject=null;
        }

        // 2. om context menu INTE öppen
        if (element.x == null) {

            // =========================
            // MAP CLICK (select map)
            // =========================
            let trean = 0;

            const i = game.currentmap;
            if (i == null || i >= this.maps.length) return;

            if (
                cursorX < x + 80 &&
                cursorY < y + 40  + 50 + 20 + trean &&
                cursorX > x + 50 &&
                cursorY > y  + 50 + trean
            ) {
                game.currentmap = i;
                markStaticsDirty();
                objects = null;
                return;
            }

            // =========================
            // PLACE OBJECT (du bröt ut tidigare)
            // =========================
            if (this.tryPlaceObjectFromTree(x, y, game)) {
                return;
            }

            if (this.maps[i].open == true) {
                for (let i2 = 0; i2 < this.maps[i].layer.length; i2++) {

                    trean += 30;

                    if (this.maps[i].layer[i2].open == true) {
                        for (let i3 = 0; i3 < this.maps[i].layer[i2].objectype.length; i3++) {

                            trean += 30;

                            if (this.maps[i].layer[i2].objectype[i3].open == true) {
                                trean += this.maps[i].layer[i2].objectype[i3].images.length * 30;
                                trean += this.maps[i].layer[i2].objectype[i3].objects.length * 30;
                            }
                        }
                    }
                }
            }
            
        }

        // =========================
        // CONTEXT MENU CLICK
        // =========================
        if (element.x != null) {

            this.handleContextMenuClick(game);
            return;
        }

        // =========================
        // PICK OBJECT (du bröt ut tidigare)
        // =========================
        if (this.tryPickObjectAtCursor(game)) {
            return;
        }

        flyttar = false;

        if (count > 1) count = 0;
        count++;

        element.x = null;
    }
    handleContextMenuClick(game) {
        
        if (element.l == 0) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {

                        let promt = window.prompt("Add map");
                        if (promt != null) {
                            this.addMap(promt, false, game);
                            
                        }
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {

                        let promt = window.prompt("Add map copy");
                        if (promt != null) {
                            this.addMap(promt, true, game);
                        }
                    }

                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        let promt = window.prompt("Rename", this.name);
                        if (promt != null) {
                            this.name = promt;
                            game.name = promt;
                        }
                    }
                    if (cursorX < element.x + 130 && cursorY < element.y + 100 && cursorX > element.x && cursorY > element.y + 75) {
                        //alert("SAVE");

                        let promt = window.prompt("Save name:", this.name);
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
                            client.onreadystatechange = () => {
                                var lines = client.responseText.split('\n');
                                if (game.maps.length == 0) {
                                    for (var i = 0; i < lines.length; i++) {

                                        game.name = lines[0];
                                        this.name = lines[0];
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
                                            game.getlastObjecttype().objects.push(new Objectx(Number(lines[i + 1]), Number(lines[i + 2]), Number(lines[i + 3]), Number(lines[i + 4]), Number(lines[i + 5]), JSON.parse(lines[i + 6])));
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
                    // MAP MENU

                    // Add Layer
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        let promt = window.prompt("Add Layer");
                        if (promt != null) {
                            this.addLayerToAllMaps(promt);
                            this.autoSave(game);
                        }
                    }

                    // Rename map (bara denna map)
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        let promt = window.prompt("Rename", element.o.name);
                        if (promt != null) {
                            element.o.name = promt;
                            this.autoSave(game);
                        }
                    }

                    // Remove map (bara denna map)
                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        var result = confirm("REMOVE " + element.o.name);
                        if (result === false) {
                            element.x = null;
                            return;
                        }

                        const index = this.maps.indexOf(element.o);
                        if (index > -1) {
                            this.maps.splice(index, 1);

                            if (game.currentmap >= this.maps.length) {
                                game.currentmap = Math.max(0, this.maps.length - 1);
                            }

                            this.autoSave(game);
                        }
                    }
                }

                if (element.l == 2) {
                    // LAYER MENU
                    const layerName = element.o?.name;

                    // Add objecttype
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        let promt = window.prompt("Add objecttype");
                        if (promt != null && layerName != null) {
                            this.addObjectTypeToAllMaps(layerName, promt);
                            this.autoSave(game);
                        }
                    }

                    // Rename layer
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        let promt = window.prompt("Rename", layerName);
                        if (promt != null && layerName != null) {
                            this.renameLayerInAllMaps(layerName, promt);
                            this.autoSave(game);
                        }
                    }

                    // Remove layer
                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        var result = confirm("REMOVE " + layerName);
                        if (result === false) {
                            element.x = null;
                            return;
                        }

                        if (layerName != null) {
                            this.removeLayerFromAllMaps(layerName);
                            this.autoSave(game);
                        }
                    }

                    // Lock
                    if (cursorX < element.x + 130 && cursorY < element.y + 100 && cursorX > element.x && cursorY > element.y + 75) {
                        if (layerName != null) {
                            this.setLayerPropInAllMaps(layerName, "lock", !element.o.lock);
                            this.autoSave(game);
                        }
                    }

                    // Moving
                    if (cursorX < element.x + 130 && cursorY < element.y + 125 && cursorX > element.x && cursorY > element.y + 100) {
                        let promt = window.prompt("Moving %: ", element.o.moving);
                        if (promt != null && layerName != null) {
                            this.setLayerPropInAllMaps(layerName, "moving", Number(promt));
                            this.autoSave(game);
                        }
                    }

                    // Fysics
                    if (cursorX < element.x + 130 && cursorY < element.y + 150 && cursorX > element.x && cursorY > element.y + 125) {
                        if (layerName != null) {
                            this.setLayerPropInAllMaps(layerName, "fysics", !element.o.fysics);
                            this.autoSave(game);
                        }
                    }

                    // Solid
                    if (cursorX < element.x + 130 && cursorY < element.y + 175 && cursorX > element.x && cursorY > element.y + 150) {
                        if (layerName != null) {
                            this.setLayerPropInAllMaps(layerName, "solid", !element.o.solid);
                            this.autoSave(game);
                        }
                    }

                    // Ghost
                    if (cursorX < element.x + 130 && cursorY < element.y + 200 && cursorX > element.x && cursorY > element.y + 175) {
                        if (layerName != null) {
                            this.setLayerPropInAllMaps(layerName, "ghost", !element.o.ghost);
                            this.autoSave(game);
                        }
                    }

                    // Up
                    if (cursorX < element.x + 130 && cursorY < element.y + 225 && cursorX > element.x && cursorY > element.y + 200) {
                        if (layerName != null) {
                            this.moveLayerUpFromCurrentMap(game, layerName);
                            this.autoSave(game);
                        }
                    }

                    // Down
                    if (cursorX < element.x + 130 && cursorY < element.y + 250 && cursorX > element.x && cursorY > element.y + 225) {
                        if (layerName != null) {
                            this.moveLayerDownFromCurrentMap(game, layerName);
                            this.autoSave(game);
                        }
                    }
                }

                if (element.l == 3) {
                    // OBJECTTYPE MENU

                    const loc = this.getObjectTypeLocationByNameInCurrentMap(game, element.o);
                    const layerName = loc.layerName;
                    const objectTypeName = loc.objectTypeName;
                    // Add animation
                 if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                    input55.type = "file";
                    input55.multiple = true;
                    input55.accept = "image/*";

                    input55.onchange = () => {
                        if (layerName == null || objectTypeName == null) return;
                        if (!input55.files || input55.files.length === 0) return;

                        const selectedFiles = Array.from(input55.files).map(f => "images/" + f.name);

                        for (let i = 0; i < this.maps.length; i++) {
                            const layer = this.maps[i].layer.find(l => l.name === layerName);
                            if (!layer) continue;

                            const targetType = layer.objectype.find(t => t.name === objectTypeName);
                            if (!targetType) continue;

                            const sprite = new Sprites("");
                            sprite.images = [...selectedFiles];

                            targetType.images.push(sprite);
                        }

                        input55.value = "";
                        this.autoSave(game);
                    };

                    input55.value = "";
                    input55.click();
                }

                    // Set dimx
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        let promt = window.prompt("Dimx", Number(element.o.standarddimx));
                        if (promt != null && layerName != null && objectTypeName != null) {
                            this.setObjectTypePropInAllMaps(layerName, objectTypeName, "standarddimx", Number(promt));
                            this.autoSave(game);
                        }
                    }

                    // Set dimy
                    if (cursorX < element.x + 130 && cursorY < element.y + 75 && cursorX > element.x && cursorY > element.y + 50) {
                        let promt = window.prompt("Dimy", Number(element.o.standarddimy));
                        if (promt != null && layerName != null && objectTypeName != null) {
                            this.setObjectTypePropInAllMaps(layerName, objectTypeName, "standarddimy", Number(promt));
                            this.autoSave(game);
                        }
                    }

                    // Set rotation
                    if (cursorX < element.x + 130 && cursorY < element.y + 100 && cursorX > element.x && cursorY > element.y + 75) {
                        let promt = window.prompt("Rotation", element.o.rot);
                        if (promt != null && layerName != null && objectTypeName != null) {
                            this.setObjectTypePropInAllMaps(layerName, objectTypeName, "rot", Number(promt));
                            this.autoSave(game);
                        }
                    }

                    // Flipped
                    if (cursorX < element.x + 130 && cursorY < element.y + 125 && cursorX > element.x && cursorY > element.y + 100) {
                        if (layerName != null && objectTypeName != null) {
                            this.setObjectTypePropInAllMaps(layerName, objectTypeName, "fliped", !element.o.fliped);
                            this.autoSave(game);
                        }
                    }

                    // Rename objecttype
                    if (cursorX < element.x + 130 && cursorY < element.y + 150 && cursorX > element.x && cursorY > element.y + 125) {
                        let promt = window.prompt("Rename", element.o.name);
                        if (promt != null && layerName != null && objectTypeName != null) {
                            this.renameObjectTypeInAllMaps(layerName, objectTypeName, promt);
                            this.autoSave(game);
                        }
                    }

                    // Remove objecttype
                    if (cursorX < element.x + 130 && cursorY < element.y + 175 && cursorX > element.x && cursorY > element.y + 150) {
                        var result = confirm("REMOVE " + element.o.name);
                        if (result === false) {
                            element.x = null;
                            return;
                        }

                        if (layerName != null && objectTypeName != null) {
                            this.removeObjectTypeFromAllMaps(layerName, objectTypeName);
                            this.autoSave(game);
                        }
                    }
                }
                if (element.l == 5) {
                    const loc = this.getAnimationLocationInCurrentMap(game, element.o);
                    const layerName = loc.layerName;
                    const objectTypeName = loc.objectTypeName;
                    const animationIndex = loc.animationIndex;

                    // Change animation speed
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        let promt = window.prompt("Change animation speed.. lower is faster", element.o.speed);
                        if (promt != null && isNaN(promt) == false) {
                            this.setAnimationSpeedInAllMaps(
                                layerName,
                                objectTypeName,
                                animationIndex,
                                Number(promt)
                            );
                            this.autoSave(game);
                        }
                    }

                    // Remove animation
                    if (cursorX < element.x + 130 && cursorY < element.y + 50 && cursorX > element.x && cursorY > element.y + 25) {
                        this.removeAnimationFromAllMaps(
                            layerName,
                            objectTypeName,
                            animationIndex
                        );
                        this.autoSave(game);
                    }
                }
                if (element.l == 4) {
                    if (cursorX < element.x + 130 && cursorY < element.y + 25 && cursorX > element.x && cursorY > element.y) {
                        this.removeObjectFromAllMaps(element.o);
                        this.autoSave(game);
                    }
                }
            
            else {}
            if (this.tryPickObjectAtCursor(game)) {
                return;
            }

            if (count > 1) count = 0;
            count++;

            element.x = null;
        
        
        
        
    }
    drawTopBar(ctx, canvas, game) {
        const barHeight = 40;

        // bakgrund
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, canvas.width, barHeight);
        ctx.fillStyle="black";
        const tabWidth = 100;
        // SAVE KNAPP
        const saveX = canvas.width - 120;

        ctx.fillStyle = "#555";
        ctx.fillRect(saveX, 0, 120, barHeight);

        ctx.fillStyle = "white";
        ctx.fillText("Save", saveX + 40, 25);
        for (let i = 0; i < this.maps.length; i++) {

            const x = i * tabWidth;

            // aktiv map
            if (i === game.currentmap) {
                ctx.fillStyle = "#666";
                ctx.fillRect(x, 0, tabWidth, barHeight);
            }

            ctx.fillStyle = "white";
            ctx.font = "14px serif";
            ctx.fillText(this.maps[i].name, x + 10, 25);
        }

        // plus-knapp
        ctx.fillStyle = "#555";
        ctx.fillRect(this.maps.length * tabWidth, 0, tabWidth, barHeight);

        ctx.fillStyle = "white";
        ctx.fillText("+", this.maps.length * tabWidth + 40, 25);
        ctx.fillStyle="black";
    }
    handleDoubleClick(x,y,game){
        if (element.x != null) {
                element.x = null;
                return;
            }
            const map = this.maps[game.currentmap];
            if (!map) return;

            // =========================
            // ROOT (trädet öppet/stängt)
            // =========================
            if (
                cursorX < x + 50 &&
                cursorY < y  + 50 &&
                cursorX > x &&
                cursorY > y
            ) {
                this.open = !this.open;
                return;
            }

            let trean = 0;
            const baseY = y  + 50;

            // =========================
            // MAP TOGGLE
            // =========================
            if (
                cursorX < x + 80 &&
                cursorY < baseY + 20 &&
                cursorX > x + 50 &&
                cursorY > baseY
            ) {
                map.open = !map.open;
                return;
            }

            if (!map.open) return;

            // =========================
            // LAYERS
            // =========================
            for (let i2 = 0; i2 < map.layer.length; i2++) {

                const layer = map.layer[i2];

                // toggle layer
                if (
                    cursorX < x + 110 &&
                    cursorY < baseY + 30 + trean + 20 &&
                    cursorX > x + 80 &&
                    cursorY > baseY + 30 + trean
                ) {
                    layer.open = !layer.open;
                    return;
                }

                trean += 30;

                if (!layer.open) continue;

                // =========================
                // OBJECT TYPES
                // =========================
                for (let i3 = 0; i3 < layer.objectype.length; i3++) {

                    const type = layer.objectype[i3];

                    if (
                        cursorX < x + 140 &&
                        cursorY < baseY + 30 + trean + 20 &&
                        cursorX > x + 110 &&
                        cursorY > baseY + 30 + trean
                    ) {
                        type.open = !type.open;

                        // viktigt: stoppa drag om man byter typ
                        if (objects != null) {
                            this.clearDraggedObject(true);
                        }

                        return;
                    }

                    trean += 30;

                    if (!type.open) continue;

                    // images + objects påverkar spacing
                    trean += type.images.length * 30;
                    trean += type.objects.length * 30;
                }
            }

            element.x = null;
        
        
        
    }
    handleContextMenu(evt, x, y, game) {
       
        if (evt.button != 2) return;
        element.x = null;
        this.clearDraggedObject(true);
        const i = game.currentmap;
        const map = this.maps[i];
        if (!map) return;
        let trean = 0;

        if (cursorX < x + 50 && cursorY < y + 50 && cursorX > x && cursorY > y) {
            element.x = cursorX;
            element.y = cursorY;
            element.l = 0;
            return;
        }

        if (cursorX < x + 80 && cursorY < y + 50 + 20 && cursorX > x + 50 && cursorY > y + 50) {
            element.x = cursorX;
            element.y = cursorY;
            element.l = 1;
            element.o = map;
            return;
        }

        if (!map.open) return;

        for (let i2 = 0; i2 < map.layer.length; i2++) {
            const layer = map.layer[i2];

            if (cursorX < x + 110 && cursorY < y + 50 + 30 + trean + 20 && cursorX > x + 80 && cursorY > y + 50 + 30 + trean) {
                element.x = cursorX;
                element.y = cursorY;
                element.l = 2;
                element.o = layer;
                return;
            }

            trean += 30;

            if (!layer.open) continue;

            for (let i3 = 0; i3 < layer.objectype.length; i3++) {
                const type = layer.objectype[i3];

                if (cursorX < x + 140 && cursorY < y + 50 + 30 + trean + 20 && cursorX > x + 110 && cursorY > y + 50 + 30 + trean) {
                    element.x = cursorX;
                    element.y = cursorY;
                    element.l = 3;
                    element.o = type;
                    return;
                }

                trean += 30;

                if (!type.open) continue;

                for (let i4 = 0; i4 < type.images.length; i4++) {
                    if (cursorX < x + 170 && cursorY < y + 50 + 30 + trean + 20 && cursorX > x + 140 && cursorY > y + 50 + 30 + trean) {
                        element.x = cursorX;
                        element.y = cursorY;
                        element.l = 5;
                        element.o = type.images[i4];
                        return;
                    }
                    trean += 30;
                }

                for (let i4 = 0; i4 < type.objects.length; i4++) {
                    if (cursorX < x + 170 && cursorY < y + 50 + 30 + trean + 20 && cursorX > x + 140 && cursorY > y + 50 + 30 + trean) {
                        element.x = cursorX;
                        element.y = cursorY;
                        element.l = 4;
                        element.o = type.objects[i4];
                        return;
                    }
                    trean += 30;
                }
            }
        }
    }
    maketree(canvas, ctx, x, y, game) {
        this.updateCamera(game);
        this.updateDraggedObject(game);

        this.maps = game.maps;
        this.bindEvents(canvas, x, y, game);

        ctx.fillStyle = "lightgray";
        ctx.fillRect(0, 40, 180, canvas.height - 40);
        ctx.fillStyle = "black";
        ctx.font = "12px serif";

        ctx.fillText(this.name, x, y);

        this.drawTopBar(ctx, canvas, game);
        this.drawTree(ctx, x - 40, y, game);
        this.drawContextMenu(ctx);
        
        ctx.fillText(
            this.fileHandle ? "Saved" : "Unsaved",
            canvas.width - 250,
            25
        );

        if (selectedObject) {
            ctx.save();

            const obj = selectedObject;
            const map = tree.maps[game.currentmap];
            const layer = map.layer[obj.buffer];
            if (layer) {
                const screenX = (map.camerax / 100 * Number(layer.moving) + obj.x) * zoomFactor;
                const screenY = (map.cameray / 100 * Number(layer.moving) + obj.y) * zoomFactor;
                const screenW = obj.dimx * zoomFactor;
                const screenH = obj.dimy * zoomFactor;

                ctx.translate(screenX + screenW / 2, screenY + screenH / 2);
                ctx.rotate((obj.rot * Math.PI) / 180);

                ctx.strokeStyle = "red";
                ctx.lineWidth = 2;
                ctx.strokeRect(-screenW / 2, -screenH / 2, screenW, screenH);
            }

            ctx.restore();
        }
        this.openAllMapsAndLayers();

        if (this._needsAutosave) {
            this.autoSave(game);
            this._needsAutosave = false;
        }
    }
    bindEvents(canvas, x, y, game) {
        if (this._eventsBound) return;
        this._eventsBound = true;
        canvas.ondblclick = (e) => {
            this.handleDoubleClick(x - 40, y, game);
        };

        canvas.onclick = (e) => {
            this.handleClick(x - 40, y, game);
        };

        canvas.addEventListener("contextmenu", (evt) => {
            evt.preventDefault();
            this.handleContextMenu(evt, x-40, y, game);
        });
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
        var distance = this.getDistance(unrotatedCircleX, unrotatedCircleY, closestX, closestY);

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
    addMap(name, copyPrevious = true, game = null) {
        if (name == null) return null;

        const newMap = new Maps(name);
   
        // Tom map om det inte finns något att kopiera från
        if (copyPrevious !== true || this.maps.length === 0) {
            this.maps.push(newMap);
            return newMap;
        }

        const prevMap = this.maps[this.maps.length - 1];

        newMap.camerax = prevMap.camerax;
        newMap.cameray = prevMap.cameray;
        newMap.zoom = prevMap.zoom || 0;

        for (let i = 0; i < prevMap.layer.length; i++) {
            const prevLayer = prevMap.layer[i];
            const newLayer = new Layer(prevLayer.name);

            newLayer.lock = prevLayer.lock;
            newLayer.moving = prevLayer.moving;
            newLayer.fysics = prevLayer.fysics;
            newLayer.solid = prevLayer.solid;
            newLayer.ghost = prevLayer.ghost;
            newLayer.open = prevLayer.open;

            for (let i2 = 0; i2 < prevLayer.objectype.length; i2++) {
                const prevType = prevLayer.objectype[i2];
                const newType = new Objecttype(prevType.name);

                newType.standarddimx = prevType.standarddimx;
                newType.standarddimy = prevType.standarddimy;
                newType.rot = prevType.rot;
                newType.fliped = prevType.fliped;
                newType.open = prevType.open;

                for (let i3 = 0; i3 < prevType.images.length; i3++) {
                    const prevSprite = prevType.images[i3];
                    const newSprite = new Sprites(prevSprite.name || "");

                    newSprite.speed = prevSprite.speed;

                    for (let i4 = 0; i4 < prevSprite.images.length; i4++) {
                        newSprite.images.push(String(prevSprite.images[i4]));
                    }

                    newType.images.push(newSprite);
                }

                // Viktigt: kopiera INTE placerade objects här
                // Bara object types / "prefabs"

                newLayer.objectype.push(newType);
            }

            newMap.layer.push(newLayer);
        }

        this.maps.push(newMap);

        if (game) {
            game.currentmap = this.maps.length - 1;
        }

        return newMap;
    }
    addLayerToAllMaps(layerName) {
        if (layerName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            this.maps[i].layer.push(new Layer(layerName));
        }
    }

    renameLayerInAllMaps(oldName, newName) {
        if (oldName == null || newName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === oldName);
            if (layer) {
                layer.name = newName;
            }
        }
    }

    removeLayerFromAllMaps(layerName) {
        if (layerName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layers = this.maps[i].layer;
            const index = layers.findIndex(l => l.name === layerName);
            if (index !== -1) {
                layers.splice(index, 1);
            }
        }
    }

    setLayerPropInAllMaps(layerName, prop, value) {
        if (layerName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (layer) {
                layer[prop] = value;
            }
        }
    }

    moveLayerUpFromCurrentMap(game, layerName) {
        const currentMap = this.maps[game.currentmap];
        if (!currentMap || layerName == null) return;

        const layers = currentMap.layer;
        const index = layers.findIndex(l => l.name === layerName);

        if (index <= 0) return;

        const tmp = layers[index];
        layers[index] = layers[index - 1];
        layers[index - 1] = tmp;

        this.syncLayerOrderFromCurrentMap(game);
    }

    moveLayerDownFromCurrentMap(game, layerName) {
        const currentMap = this.maps[game.currentmap];
        if (!currentMap || layerName == null) return;

        const layers = currentMap.layer;
        const index = layers.findIndex(l => l.name === layerName);

        if (index === -1 || index >= layers.length - 1) return;

        const tmp = layers[index];
        layers[index] = layers[index + 1];
        layers[index + 1] = tmp;

        this.syncLayerOrderFromCurrentMap(game);
    }
    addObjectTypeToAllMaps(layerName, objectTypeName) {
        if (layerName == null || objectTypeName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (!layer) continue;

            layer.objectype.push(new Objecttype(objectTypeName));
        }
    }

    renameObjectTypeInAllMaps(layerName, oldName, newName) {
        if (layerName == null || oldName == null || newName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (!layer) continue;

            const type = layer.objectype.find(t => t.name === oldName);
            if (!type) continue;

            type.name = newName;
        }
    }

    removeObjectTypeFromAllMaps(layerName, objectTypeName) {
        if (layerName == null || objectTypeName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (!layer) continue;

            const index = layer.objectype.findIndex(t => t.name === objectTypeName);
            if (index !== -1) {
                layer.objectype.splice(index, 1);
            }
        }
    }

    setObjectTypePropInAllMaps(layerName, objectTypeName, prop, value) {
        if (layerName == null || objectTypeName == null) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (!layer) continue;

            const type = layer.objectype.find(t => t.name === objectTypeName);
            if (!type) continue;

            type[prop] = value;
        }
    }
    getLayerIndexInCurrentMap(game, layerObj) {
        const map = this.maps[game.currentmap];
        if (!map) return -1;
        return map.layer.indexOf(layerObj);
    }

    getObjectTypeIndexInCurrentMap(game, layerIndex, objectTypeObj) {
        const map = this.maps[game.currentmap];
        if (!map) return -1;
        if (!map.layer[layerIndex]) return -1;
        return map.layer[layerIndex].objectype.indexOf(objectTypeObj);
    }
    getObjectTypeLocationInCurrentMap(game, objectTypeObj) {
        const map = this.maps[game.currentmap];
        if (!map) return { layerIndex: -1, objectTypeIndex: -1 };

        for (let i = 0; i < map.layer.length; i++) {
            const idx = map.layer[i].objectype.indexOf(objectTypeObj);
            if (idx !== -1) {
                return { layerIndex: i, objectTypeIndex: idx };
            }
        }

        return { layerIndex: -1, objectTypeIndex: -1 };
    }
    getObjectTypeLocationByNameInCurrentMap(game, objectTypeObj) {
        const map = this.maps[game.currentmap];
        if (!map) return { layerName: null, objectTypeName: null };

        for (let i = 0; i < map.layer.length; i++) {
            const type = map.layer[i].objectype.find(t => t === objectTypeObj);
            if (type) {
                return {
                    layerName: map.layer[i].name,
                    objectTypeName: type.name
                };
            }
        }

        return { layerName: null, objectTypeName: null };
    }
    syncLayerOrderFromCurrentMap(game) {
        const currentMap = this.maps[game.currentmap];
        if (!currentMap) return;

        const order = currentMap.layer.map(l => l.name);

        for (let i = 0; i < this.maps.length; i++) {
            if (i === game.currentmap) continue;

            this.maps[i].layer.sort((a, b) => {
                return order.indexOf(a.name) - order.indexOf(b.name);
            });
        }
    }
    getAnimationLocationInCurrentMap(game, animationObj) {
        const map = this.maps[game.currentmap];
        if (!map) {
            return { layerName: null, objectTypeName: null, animationIndex: -1 };
        }

        for (let i = 0; i < map.layer.length; i++) {
            const layer = map.layer[i];

            for (let i2 = 0; i2 < layer.objectype.length; i2++) {
                const type = layer.objectype[i2];
                const animIndex = type.images.indexOf(animationObj);

                if (animIndex !== -1) {
                    return {
                        layerName: layer.name,
                        objectTypeName: type.name,
                        animationIndex: animIndex
                    };
                }
            }
        }

        return { layerName: null, objectTypeName: null, animationIndex: -1 };
    }
    setAnimationSpeedInAllMaps(layerName, objectTypeName, animationIndex, speed) {
        if (layerName == null || objectTypeName == null || animationIndex < 0) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (!layer) continue;

            const type = layer.objectype.find(t => t.name === objectTypeName);
            if (!type) continue;

            if (!type.images[animationIndex]) continue;

            type.images[animationIndex].speed = speed;
        }
    }
    removeAnimationFromAllMaps(layerName, objectTypeName, animationIndex) {
        if (layerName == null || objectTypeName == null || animationIndex < 0) return;

        for (let i = 0; i < this.maps.length; i++) {
            const layer = this.maps[i].layer.find(l => l.name === layerName);
            if (!layer) continue;

            const type = layer.objectype.find(t => t.name === objectTypeName);
            if (!type) continue;

            if (animationIndex >= 0 && animationIndex < type.images.length) {
                type.images.splice(animationIndex, 1);
            }
        }
    }
    openAllMapsAndLayers() {
        if(this.startstart==true)return;
        
        
        for (let i = 0; i < this.maps.length; i++) {
            this.maps[i].open = true;
            this.startstart=true;
        }
    }
}
