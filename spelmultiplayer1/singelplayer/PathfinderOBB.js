class PathfinderOBB {
    constructor() {
        this.gridCache = new Map();
        this.pathCache = new Map();

        this.GRID_CACHE_MAX = 64;
        this.PATH_CACHE_MAX = 300;

        this._astarWS = {
            g: new Float32Array(0),
            f: new Float32Array(0),
            came: new Int32Array(0),
            pos: new Int32Array(0),
            heap: []
        };

        this._obbIdSeq = 1;
        this.obbCache = null;
    }

    setObstacles(obbs, bucket = 96) {
        const prepped = (obbs || []).map(o => this.prepOBB(o));
        const index = this.buildObbIndex(prepped, bucket);
        const key = `len:${prepped.length}`;
        this.obbCache = { prepped, index, key };
    }

    clearCaches() {
        this.gridCache.clear();
        this.pathCache.clear();
    }

    findPath(start, goal, obbs = null, opt = {}) {
        const cell = opt.cell ?? 24;
        const inflate = opt.inflate ?? 16;
        const pad = opt.pad ?? 240;
        const maxGrid = opt.maxGrid ?? 512;
        const smooth = opt.smooth ?? true;

        const idx = opt.obbIndex || this.obbCache?.index || null;
        const allPrepped = idx?.prepped || (obbs || []).map(o => this.prepOBB(o));
        const obbKey = opt.obbKey || this.obbCache?.key || `len:${allPrepped.length}`;

        const planWith = (obstacles, snapR = 12, smoothInput) => {
            let minx = Math.min(start.x, goal.x) - pad;
            let miny = Math.min(start.y, goal.y) - pad;
            let maxx = Math.max(start.x, goal.x) + pad;
            let maxy = Math.max(start.y, goal.y) + pad;

            for (const O of obstacles) {
                const b = O.bounds;
                if (b.x1 < minx) minx = b.x1;
                if (b.y1 < miny) miny = b.y1;
                if (b.x2 > maxx) maxx = b.x2;
                if (b.y2 > maxy) maxy = b.y2;
            }

            ({ minx, miny, maxx, maxy } = this.clampBoundsToGrid(minx, miny, maxx, maxy, cell, maxGrid));

            const gKey = this.gridCacheKey(minx, miny, maxx, maxy, cell, inflate, obbKey);
            let grid = this.gridCacheGet(gKey);

            if (!grid) {
                grid = this.buildGridOBB(minx, miny, maxx, maxy, cell, obstacles, inflate);
                this.gridCacheSet(gKey, grid);
            }

            const Sg = this.snapToWalkable(grid, this.worldToGrid(grid, start), snapR);
            const Gg = this.snapToWalkable(grid, this.worldToGrid(grid, goal), snapR);

            const key = this.pathCacheKey(grid, Sg, Gg, obbKey);
            const cached = this.pathCacheGet(key);
            if (cached) return cached;

            const raw = this.astar(grid, Sg, Gg, 1.05);
            if (!raw) return null;

            const cells = smooth ? this.smoothPath(grid, raw, smoothInput) : raw;
            const path = cells.map(c => this.gridToWorld(grid, c.gx, c.gy));

            this.pathCacheSet(key, path);
            return path;
        };

        const relevant = allPrepped;

        let path = planWith(relevant, 12, idx || relevant);
        if (path) return path;

        path = planWith(relevant, 36, idx || relevant);
        if (path) return path;

        path = planWith(allPrepped, 12, idx || allPrepped);
        if (path) return path;

        return planWith(allPrepped, 48, idx || allPrepped);
    }

    gridCacheKey(minx, miny, maxx, maxy, cell, inflatePx, obbKey) {
        const ax = Math.floor(minx / cell);
        const ay = Math.floor(miny / cell);
        const bx = Math.floor(maxx / cell);
        const by = Math.floor(maxy / cell);
        return `${ax},${ay},${bx},${by}|c${cell}|i${inflatePx}|${obbKey}`;
    }

    gridCacheGet(key) {
        const v = this.gridCache.get(key);
        if (!v) return null;
        this.gridCache.delete(key);
        this.gridCache.set(key, v);
        return v;
    }

    gridCacheSet(key, grid) {
        this.gridCache.set(key, grid);
        if (this.gridCache.size > this.GRID_CACHE_MAX) {
            const first = this.gridCache.keys().next().value;
            this.gridCache.delete(first);
        }
    }

    pathCacheKey(grid, Sg, Gg, obbKey) {
        return `${grid.minx | 0},${grid.miny | 0},${grid.w}x${grid.h}|${Sg.gx},${Sg.gy}->${Gg.gx},${Gg.gy}|${obbKey || ""}`;
    }

    pathCacheGet(key) {
        const v = this.pathCache.get(key);
        if (!v) return null;
        this.pathCache.delete(key);
        this.pathCache.set(key, v);
        return v;
    }

    pathCacheSet(key, value) {
        this.pathCache.set(key, value);
        if (this.pathCache.size > this.PATH_CACHE_MAX) {
            const first = this.pathCache.keys().next().value;
            this.pathCache.delete(first);
        }
    }

    buildGridOBB(minx, miny, maxx, maxy, cell, OBBs, inflatePx) {
        const w = Math.max(1, Math.ceil((maxx - minx) / cell));
        const h = Math.max(1, Math.ceil((maxy - miny) / cell));
        const walk = new Uint8Array(w * h);
        walk.fill(1);

        for (const O of OBBs) {
            const b = O.bounds;
            const gx1 = Math.max(0, Math.floor((b.x1 - minx - inflatePx) / cell));
            const gy1 = Math.max(0, Math.floor((b.y1 - miny - inflatePx) / cell));
            const gx2 = Math.min(w - 1, Math.floor((b.x2 - minx + inflatePx) / cell));
            const gy2 = Math.min(h - 1, Math.floor((b.y2 - miny + inflatePx) / cell));

            for (let gy = gy1; gy <= gy2; gy++) {
                const cy = miny + gy * cell + cell / 2;
                for (let gx = gx1; gx <= gx2; gx++) {
                    const cx = minx + gx * cell + cell / 2;
                    if (this.pointInOBBInflated(cx, cy, O, inflatePx)) {
                        walk[gy * w + gx] = 0;
                    }
                }
            }
        }

        return { w, h, minx, miny, cell, walk };
    }

    pointInOBBInflated(x, y, O, inflate) {
        const dx = x - O.cx;
        const dy = y - O.cy;
        const lx = O.cos * dx + O.sin * dy;
        const ly = -O.sin * dx + O.cos * dy;
        return Math.abs(lx) <= (O.hw + inflate) && Math.abs(ly) <= (O.hh + inflate);
    }

    worldToGrid(grid, p) {
        let gx = Math.floor((p.x - grid.minx) / grid.cell);
        let gy = Math.floor((p.y - grid.miny) / grid.cell);
        gx = Math.max(0, Math.min(grid.w - 1, gx));
        gy = Math.max(0, Math.min(grid.h - 1, gy));
        return { gx, gy };
    }

    gridToWorld(grid, gx, gy) {
        return {
            x: grid.minx + gx * grid.cell + grid.cell / 2,
            y: grid.miny + gy * grid.cell + grid.cell / 2
        };
    }

    snapToWalkable(grid, cell, maxR) {
        const { w, h, walk } = grid;
        const start = cell.gy * w + cell.gx;
        if (walk[start]) return cell;

        const seen = new Uint8Array(w * h);
        const q = [{ gx: cell.gx, gy: cell.gy, d: 0 }];
        seen[start] = 1;

        const DIRS = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [1, -1], [-1, 1], [1, 1]
        ];

        for (let i = 0; i < q.length; i++) {
            const c = q[i];
            const idx = c.gy * w + c.gx;

            if (walk[idx]) return { gx: c.gx, gy: c.gy };
            if (c.d >= maxR) continue;

            for (const [ox, oy] of DIRS) {
                const nx = c.gx + ox;
                const ny = c.gy + oy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

                const n = ny * w + nx;
                if (seen[n]) continue;

                seen[n] = 1;
                q.push({ gx: nx, gy: ny, d: c.d + 1 });
            }
        }

        return cell;
    }

    dilate(walk, w, h, r) {
        const out = walk.slice();
        for (let gy = 0; gy < h; gy++) {
            for (let gx = 0; gx < w; gx++) {
                if (!walk[gy * w + gx]) {
                    for (let oy = -r; oy <= r; oy++) {
                        const yy = gy + oy;
                        if (yy < 0 || yy >= h) continue;

                        for (let ox = -r; ox <= r; ox++) {
                            const xx = gx + ox;
                            if (xx < 0 || xx >= w) continue;
                            out[yy * w + xx] = 0;
                        }
                    }
                }
            }
        }
        walk.set(out);
    }

    clampBoundsToGrid(minx, miny, maxx, maxy, cell, maxCells) {
        let w = Math.ceil((maxx - minx) / cell);
        let h = Math.ceil((maxy - miny) / cell);

        if (w <= maxCells && h <= maxCells) {
            return { minx, miny, maxx, maxy };
        }

        const cx = (minx + maxx) / 2;
        const cy = (miny + maxy) / 2;
        const halfW = (maxCells * cell) / 2;
        const halfH = (maxCells * cell) / 2;

        return {
            minx: cx - halfW,
            miny: cy - halfH,
            maxx: cx + halfW,
            maxy: cy + halfH
        };
    }

    wsEnsure(N) {
        if (this._astarWS.g.length < N) {
            this._astarWS.g = new Float32Array(N);
            this._astarWS.f = new Float32Array(N);
            this._astarWS.came = new Int32Array(N);
            this._astarWS.pos = new Int32Array(N);
        }

        this._astarWS.g.fill(Infinity, 0, N);
        this._astarWS.f.fill(Infinity, 0, N);
        this._astarWS.came.fill(-1, 0, N);
        this._astarWS.pos.fill(-1, 0, N);
        this._astarWS.heap.length = 0;

        return this._astarWS;
    }

    astar(grid, Sg, Gg, W = 1.05) {
        const { w, h, walk } = grid;
        const N = w * h;
        const sIdx = Sg.gy * w + Sg.gx;
        const gIdx = Gg.gy * w + Gg.gx;

        if (!walk[sIdx] || !walk[gIdx]) return null;

        const ws = this.wsEnsure(N);
        const gScore = ws.g;
        const fScore = ws.f;
        const came = ws.came;
        const pos = ws.pos;
        const heap = ws.heap;

        const swap = (i, j) => {
            const a = heap[i], b = heap[j];
            heap[i] = b;
            heap[j] = a;
            pos[a] = j;
            pos[b] = i;
        };

        const up = (i) => {
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (fScore[heap[p]] <= fScore[heap[i]]) break;
                swap(i, p);
                i = p;
            }
        };

        const down = (i) => {
            for (;;) {
                let l = i * 2 + 1;
                let r = l + 1;
                let m = i;

                if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
                if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
                if (m === i) break;

                swap(i, m);
                i = m;
            }
        };

        const push = (idx) => {
            heap.push(idx);
            pos[idx] = heap.length - 1;
            up(heap.length - 1);
        };

        const pop = () => {
            const top = heap[0];
            const last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                pos[last] = 0;
                down(0);
            }
            pos[top] = -1;
            return top;
        };

        const dec = (idx) => up(pos[idx]);

        const heur = (idx) => {
            const gx = idx % w;
            const gy = (idx - gx) / w;
            const dx = Math.abs(gx - Gg.gx);
            const dy = Math.abs(gy - Gg.gy);
            const F = Math.SQRT2 - 1;
            return W * ((dx < dy) ? F * dx + dy : F * dy + dx);
        };

        gScore[sIdx] = 0;
        fScore[sIdx] = heur(sIdx);
        push(sIdx);

        const walkAt = (x, y) => walk[y * w + x];

        while (heap.length) {
            const cur = pop();

            if (cur === gIdx) {
                const out = [];
                for (let u = cur; u !== -1; u = came[u]) {
                    const gx = u % w;
                    const gy = (u - gx) / w;
                    out.push({ gx, gy });
                }
                out.reverse();
                return out;
            }

            const cgx = cur % w;
            const cgy = (cur - cgx) / w;
            const gc = gScore[cur];

            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    if (!ox && !oy) continue;

                    const nx = cgx + ox;
                    const ny = cgy + oy;

                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    if (!walkAt(nx, ny)) continue;

                    if (ox && oy) {
                        if (!walkAt(cgx, ny) || !walkAt(nx, cgy)) continue;
                    }

                    const nIdx = ny * w + nx;
                    const cost = (ox && oy) ? Math.SQRT2 : 1;
                    const tent = gc + cost;

                    if (tent < gScore[nIdx]) {
                        const old = fScore[nIdx];
                        came[nIdx] = cur;
                        gScore[nIdx] = tent;
                        fScore[nIdx] = tent + heur(nIdx);

                        if (pos[nIdx] === -1) push(nIdx);
                        else if (fScore[nIdx] < old) dec(nIdx);
                    }
                }
            }
        }

        return null;
    }

    losBlockedOBB(A, B, idxOrArray) {
        const x1 = Math.min(A.x, B.x);
        const x2 = Math.max(A.x, B.x);
        const y1 = Math.min(A.y, B.y);
        const y2 = Math.max(A.y, B.y);

        const list = (idxOrArray && idxOrArray.table)
            ? this.queryObbsInAABB(idxOrArray, x1, y1, x2, y2)
            : (idxOrArray || []);

        for (let i = 0; i < list.length; i++) {
            const O = list[i];
            const b = O.bounds;

            if (x2 < b.x1 || x1 > b.x2 || y2 < b.y1 || y1 > b.y2) continue;
            if (this.segmentHitsOBB(A, B, O)) return true;
        }

        return false;
    }

    gridRayClear(grid, A, B) {
        const a = this.worldToGrid(grid, A);
        const b = this.worldToGrid(grid, B);

        let x0 = a.gx, y0 = a.gy;
        const x1 = b.gx, y1 = b.gy;
        const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
        const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;

        let err = dx + dy;
        const walk = grid.walk;
        const w = grid.w;

        for (;;) {
            if (!walk[y0 * w + x0]) return false;
            if (x0 === x1 && y0 === y1) break;

            const e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                err += dx;
                y0 += sy;
            }
        }

        return true;
    }

    smoothPath(grid, pathCells, idxOrArray) {
        if (!pathCells || pathCells.length <= 2) return pathCells;

        const out = [pathCells[0]];
        let i = 0;

        while (i < pathCells.length - 1) {
            let j = pathCells.length - 1;
            const Pi = this.gridToWorld(grid, pathCells[i].gx, pathCells[i].gy);

            for (; j > i + 1; j--) {
                const Pj = this.gridToWorld(grid, pathCells[j].gx, pathCells[j].gy);
                if (!this.gridRayClear(grid, Pi, Pj)) continue;
                if (!this.losBlockedOBB(Pi, Pj, idxOrArray)) break;
            }

            out.push(pathCells[j]);
            i = j;
        }

        return out;
    }

    prepOBB(s) {
        if (s && s.kind === "obb" && typeof s.cos === "number") return s;

        const angle = s.angleRad || 0;
        const c = Math.cos(angle);
        const t = Math.sin(angle);
        const hw = s.w * 0.5;
        const hh = s.h * 0.5;
        const cx = s.cx;
        const cy = s.cy;

        const corners = [
            { x: cx - hw * c + hh * t, y: cy - hw * t - hh * c },
            { x: cx + hw * c + hh * t, y: cy + hw * t - hh * c },
            { x: cx + hw * c - hh * t, y: cy + hw * t + hh * c },
            { x: cx - hw * c - hh * t, y: cy - hw * t + hh * c }
        ];

        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        for (let i = 0; i < 4; i++) {
            const p = corners[i];
            if (p.x < x1) x1 = p.x;
            if (p.y < y1) y1 = p.y;
            if (p.x > x2) x2 = p.x;
            if (p.y > y2) y2 = p.y;
        }

        const ob = {
            kind: "obb",
            cx,
            cy,
            hw,
            hh,
            cos: c,
            sin: t,
            bounds: { x1, y1, x2, y2 }
        };

        ob._id = s._id || (this._obbIdSeq++);
        return ob;
    }

    buildObbIndex(prepped, bucket = 96) {
        if (!prepped || !prepped.length) {
            return { table: [], gx1: 0, gy1: 0, W: 0, H: 0, bucket, prepped };
        }

        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const o of prepped) {
            const b = o.bounds;
            if (b.x1 < minx) minx = b.x1;
            if (b.y1 < miny) miny = b.y1;
            if (b.x2 > maxx) maxx = b.x2;
            if (b.y2 > maxy) maxy = b.y2;
        }

        const gx1 = Math.floor(minx / bucket);
        const gy1 = Math.floor(miny / bucket);
        const gx2 = Math.floor(maxx / bucket);
        const gy2 = Math.floor(maxy / bucket);

        const W = Math.max(1, gx2 - gx1 + 1);
        const H = Math.max(1, gy2 - gy1 + 1);

        const table = new Array(W * H);
        for (let i = 0; i < table.length; i++) table[i] = [];

        const push = (bx, by, ob) => {
            table[(by - gy1) * W + (bx - gx1)].push(ob);
        };

        for (const ob of prepped) {
            const b = ob.bounds;
            const bx1 = Math.floor(b.x1 / bucket);
            const by1 = Math.floor(b.y1 / bucket);
            const bx2 = Math.floor(b.x2 / bucket);
            const by2 = Math.floor(b.y2 / bucket);

            for (let by = by1; by <= by2; by++) {
                for (let bx = bx1; bx <= bx2; bx++) {
                    push(bx, by, ob);
                }
            }
        }

        return { table, gx1, gy1, W, H, bucket, prepped };
    }

    queryObbsInAABB(idx, x1, y1, x2, y2) {
        if (!idx || !idx.table.length) return [];

        const bx1 = Math.max(0, Math.floor(x1 / idx.bucket) - idx.gx1);
        const by1 = Math.max(0, Math.floor(y1 / idx.bucket) - idx.gy1);
        const bx2 = Math.min(idx.W - 1, Math.floor(x2 / idx.bucket) - idx.gx1);
        const by2 = Math.min(idx.H - 1, Math.floor(y2 / idx.bucket) - idx.gy1);

        const seen = new Set();
        const out = [];

        for (let by = by1; by <= by2; by++) {
            for (let bx = bx1; bx <= bx2; bx++) {
                const cell = idx.table[by * idx.W + bx];
                for (let i = 0; i < cell.length; i++) {
                    const ob = cell[i];
                    if (!seen.has(ob._id)) {
                        seen.add(ob._id);
                        out.push(ob);
                    }
                }
            }
        }

        return out;
    }

    pointInOBB(x, y, O) {
        const dx = x - O.cx;
        const dy = y - O.cy;
        const lx = O.cos * dx + O.sin * dy;
        const ly = -O.sin * dx + O.cos * dy;
        return Math.abs(lx) <= O.hw && Math.abs(ly) <= O.hh;
    }

    segmentHitsOBB(A, B, O) {
        const Ax = O.cos * (A.x - O.cx) + O.sin * (A.y - O.cy);
        const Ay = -O.sin * (A.x - O.cx) + O.cos * (A.y - O.cy);
        const Bx = O.cos * (B.x - O.cx) + O.sin * (B.y - O.cy);
        const By = -O.sin * (B.x - O.cx) + O.cos * (B.y - O.cy);

        return this.segmentAABB(Ax, Ay, Bx, By, -O.hw, -O.hh, O.hw, O.hh);
    }

    segmentAABB(x0, y0, x1, y1, rx1, ry1, rx2, ry2) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        let t0 = 0;
        let t1 = 1;

        const p = [-dx, dx, -dy, dy];
        const q = [x0 - rx1, rx2 - x0, y0 - ry1, ry2 - y0];

        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) {
                if (q[i] < 0) return false;
            } else {
                const r = q[i] / p[i];
                if (p[i] < 0) {
                    if (r > t1) return false;
                    if (r > t0) t0 = r;
                } else {
                    if (r < t0) return false;
                    if (r < t1) t1 = r;
                }
            }
        }

        return true;
    }
}