const offscreenCanvas = document.createElement('canvas');
const offCtx = offscreenCanvas.getContext('2d');

class MapRenderer {
    constructor(ctx) {
        this.ctx = ctx;
    }

    drawMap(gameClient,scale,app) {
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
                    this.drawObject(obj, objectType, map,app);
                }
                
            }
        }
    }

    drawObject(obj, objectType,map,app) {
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

        if (obj.isvisable&&!(obj.buildProgress&&obj.buildProgress<1)) {
            try { this.drawSelectRing(ctx, obj, zoom, camerax, cameray,app); } catch (e) {}
        }

        ctx.save();
        ctx.globalAlpha = obj.alpha ?? 1;
        ctx.scale(renderScale, renderScale);
        ctx.translate(camerax + cx, cameray + cy);
        ctx.rotate(rad);
        if (obj.flipped) ctx.scale(-1, 1);

        if (sprite) {
            if (obj.buildProgress&&obj.buildProgress<1) {
                ctx.fillStyle = "rgba(0,0,0,0.15)";
                ctx.fillRect(-w / 2, -h / 2, w, h);

                ctx.fillStyle = "rgba(80,60,40,0.5)";
                ctx.fillRect(-w / 2, -h / 2 + h - 8, w, 8);


                this.drawBuildingProgress(ctx, sprite, -w / 2, -h / 2, w, h, obj.buildProgress);
                
            }
            else if (obj.flashTimer > 0 && obj.isvisable) {
                this.drawTinted(ctx, sprite, obj.flashTimercolor || "red", w, h);
            } else if (obj.water && obj.isvisable) {
                const bob = Math.sin(performance.now() * 0.003) * 3;
                ctx.drawImage(sprite, -w / 2, -h / 2 + bob, w, h);
            }
            else if (obj.isvisable) {
                ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
            }
        } else {
            ctx.fillStyle = "green";
            ctx.fillRect(-w / 2, -h / 2, w, h);
        }

        ctx.restore();

        if (obj.selected&&obj.hp>0) {
          //  ctx.save();
         //   ctx.scale(renderScale, renderScale);
          //  ctx.lineWidth = 10;
          //  ctx.strokeStyle = "black";
            
            
         //   ctx.strokeRect(camerax + (cx - ax), cameray + (cy - ay), ax * 2, ay * 2);
         //   ctx.lineWidth = 2;
         //  ctx.strokeStyle = "blue";
         //   if (obj.type.startsWith("r")) ctx.strokeStyle = "red";
         //   if (obj.type.startsWith("y")) ctx.strokeStyle = "yellow";
         //   if (obj.type.startsWith("g")) ctx.strokeStyle = "lime";
         //   ctx.strokeRect(camerax + (cx - ax), cameray + (cy - ay), ax * 2, ay * 2);
          //  ctx.restore();
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
    drawSelectRing(ctx, o, zoom, camX, camY,app) {
        const type = o.type || "";

        if (type === "farm" || type === "rfarm" || type === "gfarm" || type === "yfarm") return;

        const scale = 1 + zoom / 100;

        if (o.isBuilding || type === "gold" || type === "berry" || type === "stone") {
            let cx = o.x + o.w / 2;
            let cy = o.y + o.h * 0.75;

            if (
                type === "barrack" || type === "rbarrack" || type === "ybarrack" || type === "gbarrack" ||
                type === "tower" || type === "rtower" || type === "ytower" || type === "gtower" ||
                type === "townhall" || type === "rtownhall" || type === "ytownhall" || type === "gtownhall"
            ) {
                cy = o.y + o.h * 0.50;
            }

            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.scale(scale, scale);

            ctx.beginPath();
            if (type === "townhall" || type === "rtownhall" || type === "gtownhall" || type === "ytownhall") {
                ctx.ellipse(cx + camX - 60, cy + camY - 30, o.w * 0.25, o.h * 0.25, -0.4, 0, Math.PI * 2);
            } else {
                ctx.ellipse(cx + camX - 20, cy + camY - 30, o.w * 0.35, o.h * 0.45, -0.4, 0, Math.PI * 2);
            }
            ctx.fillStyle = "rgba(0,0,0,.44)";
            ctx.fill();
            ctx.restore();
        }
        else if (o.hp > 0 && (o.kind === "dynamic" || type === "tree")) {
            const rx = o.renderX ?? o.x;
            const ry = o.renderY ?? o.y;
            const cx = rx + o.w / 2;
            const cy = ry + o.h * 0.95;

            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.scale(scale, scale);

            ctx.beginPath();
            if (type === "tree") {
                ctx.ellipse(cx + camX - 10, cy + camY - o.h / 2, o.w * 0.25, o.h * 0.50, -0.2, 0, Math.PI * 2);
            } else {
                ctx.ellipse(cx + camX, cy + camY, o.w * 0.45, o.h * 0.15, 0, 0, Math.PI * 2);
            }
            ctx.fillStyle = "rgba(0,0,0,.44)";
            ctx.fill();

            if (type.endsWith("worker") || type.endsWith("warrior") || (type === "sheep" && o.owner === app.myId)) {
                const selected = o.selected;
                const t = performance.now() * 0.005;
                const pulse = selected ? (1 + Math.sin(t) * 0.08) : 1;

                let color = "blue";
                if (o.owner === 2) color = "red";
                if (o.owner === 3) color = "yellow";
                if (o.owner === 4) color = "lime";

                ctx.globalAlpha = 1;

                ctx.beginPath();
                ctx.ellipse(cx + camX, cy + camY, o.w * 0.65 * pulse, o.h * 0.30 * pulse, 0, 0, Math.PI * 2);
                ctx.strokeStyle = "black";
                ctx.lineWidth = selected ? 20 : 3;
                ctx.stroke();

                ctx.beginPath();
                ctx.ellipse(cx + camX, cy + camY, o.w * 0.55 * pulse, o.h * 0.25 * pulse, 0, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = selected ? 16 : 3;
                ctx.stroke();
            }

            ctx.restore();
        }
    }
}