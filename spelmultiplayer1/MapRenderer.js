const offscreenCanvas = document.createElement('canvas');
const offCtx = offscreenCanvas.getContext('2d');

class MapRenderer {
    constructor(ctx) {
        this.ctx = ctx;
    }

    drawMap(gameClient,scale) {
        const map = gameClient.maps[gameClient.currentmap];
        if (!map) return;

        for (const layer of map.layer) {
            if (!layer.objectTypes) continue;

            for (const objectType of layer.objectTypes) {
                if (!objectType.objects) continue;
                
                if (objectType.sprites) {
                    for (const sprite of objectType.sprites) {
                        if (sprite?.updateanimation) sprite.updateanimation(scale);
                    }
                }
                for (const obj of objectType.objects) {
                    this.drawObject(obj, objectType, map);
                }
                
            }
        }
    }

    drawObject(obj, objectType,map) {
        const ctx = this.ctx;

        const zoom = map.zoom || 0;
        const renderScale = 1 + zoom / 100;
        const camerax = map.camerax || 0;
        const cameray = map.cameray || 0;

        const x = Number(obj.renderX ?? obj.x ?? 0);
        const y = Number(obj.renderY ?? obj.y ?? 0);
        const w = Number(obj.w ?? obj.dimx ?? 0);
        const h = Number(obj.h ?? obj.dimy ?? 0);

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return;
        if (w <= 0 || h <= 0) return;

        const cx = x + w / 2;
        const cy = y + h / 2;

        let rad = Number(obj.r ?? 0) + Number(obj.rotimage ?? 0);
        if (Math.abs(rad) > Math.PI * 2) rad *= Math.PI / 180;

        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const ax = Math.abs(c) * w / 2 + Math.abs(s) * h / 2;
        const ay = Math.abs(s) * w / 2 + Math.abs(c) * h / 2;

        const viewW = ctx.canvas.width / renderScale;
        const viewH = ctx.canvas.height / renderScale;
        const viewL = -camerax;
        const viewT = -cameray;

        if (
            cx + ax < viewL ||
            cx - ax > viewL + viewW ||
            cy + ay < viewT ||
            cy - ay > viewT + viewH
        ) {
            obj.isonscreen = false;
            return;
        }

        obj.isonscreen = true;

        if (obj.flashTimer > 0) obj.flashTimer--;

        const sprite = objectType.sprites?.[obj.animation]?.getimage?.();

        if (obj.isvisable) {
            try { this.drawSelectRing(ctx, obj, zoom, camerax, cameray); } catch (e) {}
        }

        ctx.save();
        ctx.globalAlpha = obj.alpha ?? 1;
        ctx.scale(renderScale, renderScale);
        ctx.translate(camerax + cx, cameray + cy);
        ctx.rotate(rad);
        if (obj.flipped) ctx.scale(-1, 1);

        if (sprite) {
            if (obj.flashTimer > 0 && obj.isvisable) {
                this.drawTinted(ctx, sprite, obj.flashTimercolor || "white", w, h);
            } else if (obj.water && obj.isvisable) {
                const bob = Math.sin(performance.now() * 0.003) * 3;
                ctx.drawImage(sprite, -w / 2, -h / 2 + bob, w, h);
            } else if (obj.isvisable) {
                ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
            }

            if (obj.drawunfinished && !obj.isvisable) {
                ctx.fillStyle = "rgba(0,0,0,0.15)";
                ctx.fillRect(-w / 2, -h / 2, w, h);

                ctx.fillStyle = "rgba(80,60,40,0.5)";
                ctx.fillRect(-w / 2, -h / 2 + h - 8, w, 8);


                this.drawBuildingProgress(ctx, sprite, -w / 2, -h / 2, w, h, obj.buildProgress);
                
            }
        } else {
            ctx.fillStyle = "green";
            ctx.fillRect(-w / 2, -h / 2, w, h);
        }

        ctx.restore();

        if (obj.selected) {
            ctx.save();
            ctx.scale(renderScale, renderScale);
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ff00";
            ctx.strokeRect(camerax + (cx - ax), cameray + (cy - ay), ax * 2, ay * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "black";
            ctx.strokeRect(camerax + (cx - ax), cameray + (cy - ay), ax * 2, ay * 2);
            ctx.restore();
        }
        if (obj.alertT > 0) {
            ctx.save();
            ctx.scale(renderScale, renderScale);
            ctx.font = "bold 60px serif";
            ctx.fillStyle = "red";
            ctx.fillText("!", camerax + cx - 10, cameray + y - 20);
            ctx.restore();
        }
    }

    drawTinted(ctx, sprite, tint, w, h) {
        const offCanvas = offscreenCanvas;

        if (offCanvas.width !== sprite.width || offCanvas.height !== sprite.height) {
            offCanvas.width = sprite.width;
            offCanvas.height = sprite.height;
        }

        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        offCtx.drawImage(sprite, 0, 0);
        offCtx.globalCompositeOperation = "source-atop";
        offCtx.fillStyle = tint;
        offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
        offCtx.globalCompositeOperation = "source-over";

        try {
            ctx.drawImage(offCanvas, -w / 2, -h / 2, w, h);
        } catch (e) {}
    }
    drawBuildingProgress(ctx, img, x, y, w, h, progress) {
        progress = Math.max(0, Math.min(1, progress));

        const visibleH = h * progress;
        if (visibleH <= 0) return;

        const srcX = 0;
        const srcY = img.height - img.height * progress;
        const srcW = img.width;
        const srcH = img.height * progress;

        const dstX = x;
        const dstY = y + (h - visibleH);
        const dstW = w;
        const dstH = visibleH;

        ctx.drawImage(
            img,
            srcX, srcY, srcW, srcH,
            dstX, dstY, dstW, dstH
        );
    }
    drawSelectRing(ctx, o,zoom, camX, camY){

        if(o.type=="farm"||o.type=="rfarm"||o.type=="gfarm"||o.type=="yfarm")return;

        // Alltid-på, subtil "ground contact" för byggnader (så de inte ser svävande ut)
        if (o.kind==="dynamic") {
            let cx=o.x+o.dimx/2, cy=o.y+o.dimy*0.75;
            if(o.type=="barrack"||o.type=="rbarrack"||o.type=="ybarrack"||o.type=="gbarrack"||o.type=="tower"||o.type=="rtower"||o.type=="ytower"||o.type=="gtower"||o.type=="townhall")cy=o.y+o.dimy*0.50;
            ctx.save(); ctx.globalAlpha=0.6;
            ctx.scale(1 + zoom / 100, 1 + zoom / 100);
            ctx.beginPath(); 
            if (o.type === "townhall" || o.type === "rtownhall" || o.type === "gtownhall" || o.type === "ytownhall")ctx.ellipse(cx+camX-60, cy+camY-30, o.dimx*0.25, o.dimy*0.25, -0.4, 0, Math.PI*2);
            else ctx.ellipse(cx+camX-20, cy+camY-30, o.dimx*0.35, o.dimy*0.45, -0.4, 0, Math.PI*2);
            ctx.fillStyle="rgba(0,0,0,.44)"; ctx.fill(); 
            ctx.restore();
        }  
        else if(o.selectable&&!o.dead){  
            const cx=o.x+o.dimx/2, cy=o.y+o.dimy*0.95;
            ctx.save(); ctx.globalAlpha=0.6;

            ctx.scale(1 + zoom / 100, 1 + zoom / 100);
            ctx.beginPath(); 

            if(o.type=="tree")ctx.ellipse(cx+camX-10, cy+camY-o.dimy/2, o.dimx*0.25, o.dimy*0.50, -0.2, 0, Math.PI*2);
            else ctx.ellipse(cx+camX, cy+camY, o.dimx*0.45, o.dimy*0.15, 0, 0, Math.PI*2);
            ctx.fillStyle="rgba(0,0,0,.44)"; ctx.fill(); 

            // TEAM RING
            if ((o.type || "").endsWith("worker") || (o.type || "").endsWith("warrior")){ 
                ctx.globalAlpha = 1;

                ctx.beginPath();
                ctx.ellipse(cx+camX, cy+camY, o.dimx*0.65, o.dimy*0.30, 0, 0, Math.PI*2);
                ctx.strokeStyle = "black";
                ctx.lineWidth = 3;
                ctx.stroke();

                ctx.beginPath();
                ctx.ellipse(cx+camX, cy+camY, o.dimx*0.55, o.dimy*0.25, 0, 0, Math.PI*2);
                ctx.strokeStyle = "blue";
                if(o.name.startsWith("r"))ctx.strokeStyle = "red";if(o.name.startsWith("y"))ctx.strokeStyle = "yellow";if(o.name.startsWith("g"))ctx.strokeStyle = "lime";

                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            ctx.restore();
        }
    }
}