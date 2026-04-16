class DebugPanel {
    constructor() {
        this.enabled = true;

        this.fps = 0;
        this.dt = 0;
        this.lastFrameTime = performance.now();
        this.frameTimes = [];

        this.lastPacketTime = 0;
        this.packetDt = 0;

        this.lines = [];
    }

    beginFrame() {
        const now = performance.now();
        this.dt = now - this.lastFrameTime;
        this.lastFrameTime = now;

        if (this.dt > 0) {
            this.fps = 1000 / this.dt;
        }

        this.frameTimes.push(this.dt);
        if (this.frameTimes.length > 60) {
            this.frameTimes.shift();
        }

        this.lines.length = 0;
    }

    onPacket() {
        const now = performance.now();

        if (this.lastPacketTime !== 0) {
            this.packetDt = now - this.lastPacketTime;
        }

        this.lastPacketTime = now;
    }

    addLine(text) {
        this.lines.push(text);
    }

    draw(ctx, game) {
        if (!this.enabled) return;

        const x = 10;
        const y = 10;
        const width = 220;
        const height = 150;

        ctx.save();

        ctx.globalAlpha = 0.8;
        ctx.fillStyle = "black";
        ctx.fillRect(x, y, width, height);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = "white";
        ctx.strokeRect(x, y, width, height);

        ctx.fillStyle = "white";
        ctx.font = "12px monospace";

        let lineY = y + 18;

        ctx.fillText(`FPS: ${this.fps.toFixed(1)}`, x + 8, lineY);
        lineY += 14;

        ctx.fillText(`dt: ${this.dt.toFixed(2)} ms`, x + 8, lineY);
        lineY += 14;

        ctx.fillText(`packet dt: ${this.packetDt.toFixed(2)} ms`, x + 8, lineY);
        lineY += 14;

        const entityCount = game?.world?.entitiesById?.size || 0;
        ctx.fillText(`entities: ${entityCount}`, x + 8, lineY);
        lineY += 14;

        // exempel: visa snapshots för spelarobjekt eller första objektet
        let snapshotCount = 0;
        if (game?.world?.entitiesById) {
            for (const obj of game.world.entitiesById.values()) {
                if (obj.snapshots) {
                    snapshotCount = obj.snapshots.length;
                    break;
                }
            }
        }

        ctx.fillText(`snapshots: ${snapshotCount}`, x + 8, lineY);
        lineY += 14;

        for (const line of this.lines) {
            ctx.fillText(line, x + 8, lineY);
            lineY += 14;
            if (lineY > y + 80) break;
        }

        // liten graph längst ner
        const graphX = x + 8;
        const graphY = y + 105;
        const graphW = 200;
        const graphH = 35;

        ctx.strokeStyle = "gray";
        ctx.strokeRect(graphX, graphY, graphW, graphH);

        if (this.frameTimes.length > 1) {
            ctx.beginPath();
            for (let i = 0; i < this.frameTimes.length; i++) {
                const v = this.frameTimes[i];

                // clampa för grafen
                const clamped = Math.min(v, 50);
                const px = graphX + (i / 59) * graphW;
                const py = graphY + graphH - (clamped / 50) * graphH;

                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = "lime";
            ctx.stroke();
        }

        // 16.7 ms-linje
        const target60 = graphY + graphH - (16.7 / 50) * graphH;
        ctx.beginPath();
        ctx.moveTo(graphX, target60);
        ctx.lineTo(graphX + graphW, target60);
        ctx.strokeStyle = "yellow";
        ctx.stroke();

        // 33.3 ms-linje
        const target30 = graphY + graphH - (33.3 / 50) * graphH;
        ctx.beginPath();
        ctx.moveTo(graphX, target30);
        ctx.lineTo(graphX + graphW, target30);
        ctx.strokeStyle = "red";
        ctx.stroke();

        ctx.restore();
    }
}