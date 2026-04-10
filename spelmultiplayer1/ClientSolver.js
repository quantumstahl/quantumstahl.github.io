const slideMode = "full"; // "platformer" | "full"

// ==== Simultaneous Collision Solver (Jacobi/PBD-lite) ====
function _aabbFrom(x,y,w,h,rDeg){
  if (!rDeg) return {x, y, w, h};
  const cs = getRotatedRectangleCorners(x, y, w, h, rDeg);
  let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  for (let i=0;i<4;i++){
    const c = cs[i];
    if(c.x<minx)minx=c.x; if(c.y<miny)miny=c.y; if(c.x>maxx)maxx=c.x; if(c.y>maxy)maxy=c.y;
  }
  return {x:minx, y:miny, w:maxx-minx, h:maxy-miny};
}

// sätt detta nära dina konstanter
const SOLVER_CELL = 100;     // 2^7 — välj 64/128/256 efter smak
const GRID_OFFS   = 1<<15;   // för att packa ev. negativa index tryggt

function _pack(ix, iy){
  // packa till ett 32-bitars tal: [iy+OFFS | ix+OFFS]
  return ((iy + GRID_OFFS) << 16) | ((ix + GRID_OFFS) & 0xFFFF);
}

class HashGrid {
  constructor(cell = SOLVER_CELL){
    this.cell = cell;
    this.invCell = 1 / cell;
    this._map = new Map();            // <-- döp om
    this._seenStamp = 1;
    this._bucketStamp = 1;
  }
  clear(){ this._map.clear(); this._seenStamp = this._bucketStamp = 1; }

  beginInsertCycle(){
    this._bucketStamp = (this._bucketStamp + 1) | 0;
    if (!this._bucketStamp) this._bucketStamp = 1;
  }

  _bucket(ix, iy){
    const k = _pack(ix, iy);
    let b = this._map.get(k);         // <-- använd _map
    if (!b){ b = { arr: [], stamp: 0 }; this._map.set(k, b); }
    if (b.stamp !== this._bucketStamp){ b.arr.length = 0; b.stamp = this._bucketStamp; }
    return b.arr;
  }

  insert(proxy){
    const a = (proxy.type === 'static')
      ? (proxy._aabb || _aabbFrom(proxy.x, proxy.y, proxy.w, proxy.h, proxy.r||0))
      :  _aabbFrom(proxy.x, proxy.y, proxy.w, proxy.h, proxy.r||0);

    proxy._aabb = a;
    if (proxy._hgSeen !== 0) proxy._hgSeen = 0;

    const inv = this.invCell;
    const x1 = Math.floor(a.x * inv);
    const y1 = Math.floor(a.y * inv);
    const x2 = Math.floor((a.x + a.w) * inv);
    const y2 = Math.floor((a.y + a.h) * inv);

    for (let iy=y1; iy<=y2; iy++){
      for (let ix=x1; ix<=x2; ix++){
        this._bucket(ix, iy).push(proxy);   // <-- rätt: _bucket(), inte buckets()
      }
    }
  }

  query(aabb, out = []){
    this._seenStamp = (this._seenStamp + 1) | 0;
    if (!this._seenStamp) this._seenStamp = 1;
    const stamp = this._seenStamp;

    const inv = this.invCell;
    const x1 = Math.floor(aabb.x * inv);
    const y1 = Math.floor(aabb.y * inv);
    const x2 = Math.floor((aabb.x + aabb.w) * inv);
    const y2 = Math.floor((aabb.y + aabb.h) * inv);

    for (let iy=y1; iy<=y2; iy++){
      for (let ix=x1; ix<=x2; ix++){
        const b = this._map.get(_pack(ix, iy));  // <-- _map
        if (!b) continue;
        const arr = b.arr;
        for (let i=0; i<arr.length; i++){
          const p = arr[i];
          if (p._hgSeen !== stamp){ p._hgSeen = stamp; out.push(p); }
        }
      }
    }
    return out;
  }
}


function _axesFromCorners(cs){
  const ex1 = cs[1].x - cs[0].x, ey1 = cs[1].y - cs[0].y;
  const ex2 = cs[2].x - cs[1].x, ey2 = cs[2].y - cs[1].y;
  const L1 = Math.hypot(ex1,ey1)||1, L2 = Math.hypot(ex2,ey2)||1;
  return [{x:-ey1/L1, y:ex1/L1}, {x:-ey2/L2, y:ex2/L2}];
}

function obbObbMTV(A, B){
  const Ac = A._corners || getRotatedRectangleCorners(A.x,A.y,A.w,A.h,A.r||0);
  const Bc = B._corners || getRotatedRectangleCorners(B.x,B.y,B.w,B.h,B.r||0);
  const axes = (A._axes || _axesFromCorners(Ac)).concat(B._axes || _axesFromCorners(Bc));

  // warm start med förra normalen
  if (A._lastN){
    const n = A._lastN;
    let amin=Infinity, amax=-Infinity, bmin=Infinity, bmax=-Infinity;
    for (let i=0;i<4;i++){
      const da = Ac[i].x*n.x + Ac[i].y*n.y; if (da<amin) amin=da; if (da>amax) amax=da;
      const db = Bc[i].x*n.x + Bc[i].y*n.y; if (db<bmin) bmin=db; if (db>bmax) bmax=db;
    }
    if (amax <= bmin || bmax <= amin) return null;
  }

  let bestDepth = Infinity, bestAxis = null;

  for (let k=0;k<axes.length;k++){
    const ax = axes[k];
    let amin=Infinity, amax=-Infinity, bmin=Infinity, bmax=-Infinity;
    for (let i=0;i<4;i++){
      const da = Ac[i].x*ax.x + Ac[i].y*ax.y; if (da<amin) amin=da; if (da>amax) amax=da;
      const db = Bc[i].x*ax.x + Bc[i].y*ax.y; if (db<bmin) bmin=db; if (db>bmax) bmax=db;
    }
    if (amax <= bmin || bmax <= amin) return null;
    const overlap = Math.min(amax - bmin, bmax - amin);
    if (overlap < bestDepth){ bestDepth = overlap; bestAxis = ax; }
  }
  const centerA = {x:A.x + A.w/2, y:A.y + A.h/2};
  const centerB = {x:B.x + B.w/2, y:B.y + B.h/2};
  const AB = {x:centerB.x - centerA.x, y:centerB.y - centerA.y};
  const sign = (AB.x*bestAxis.x + AB.y*bestAxis.y) >= 0 ? +1 : -1;

  const n = {x:bestAxis.x*sign, y:bestAxis.y*sign};
  A._lastN = n; B._lastN = {x:-n.x, y:-n.y};
  return { n, depth: bestDepth };
}

function circleCircleMTV(A, B) {
  const ar = (A.radius != null) ? A.radius : Math.min(A.w, A.h) * 0.5;
  const br = (B.radius != null) ? B.radius : Math.min(B.w, B.h) * 0.5;

  let dx = B.x - A.x;
  let dy = B.y - A.y;
  let distSq = dx * dx + dy * dy;
  const r = ar + br;

  if (distSq >= r * r) return null;

  let dist = Math.sqrt(distSq);
  let nx, ny;

  if (dist > 0.0001) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    // exakt overlap: ta normal från relativ rörelse
    const rvx = (B.ref?._wantdx || 0) - (A.ref?._wantdx || 0);
    const rvy = (B.ref?._wantdy || 0) - (A.ref?._wantdy || 0);
    const rl = Math.hypot(rvx, rvy);

    if (rl > 0.0001) {
      nx = rvx / rl;
      ny = rvy / rl;
    } else {
      // sista fallback: stabil riktning från id
      nx = (A.id < B.id) ? 1 : -1;
      ny = 0;
    }

    dist = 0;
  }

  return {
    n: { x: nx, y: ny },
    depth: r - dist
  };
}


const PEN_SLOP   = 0;   // px som ignoreras (dead-zone) – minskar chatter
const BETA       = 2;  // 0..1, hur stor del av återstående pen som tas per frame
const MAX_CORR_PX= 32.0;   // max px per par och kropp per iteration (skydd mot “skott”)

const STEP_EPS   = 2;   // hur mycket under topp vi tolererar (px)
const STEP_MAX   = 21;   // hur mycket över topp vi får "kliva upp" (px)
const SIDE_SKIN  = 1.0; // valfritt: skär av statiska sidkanter lite
var gamee=null;
const SimSolver = {
    ITER: 4,

    step(game) {
        gamee=game;
        if (!game.world) return;

        const stat = [];
        const dyn = [];
        const ghosts = [];

        let uid = 1;

        const solids = game.world.solids || [];
        const dynamics = game.world.dynamic || [];
        const ghostList = game.world.ghosts || [];

        // Statics
        for (let i = 0; i < solids.length; i++) {
            const o = solids[i];
            if (!o || o.dead) continue;

            o.resetContacts();
            o.hitWallX = false;
            o.hitWallY = false;
            o.wasstaticblocked = false;
            o.wasdynblocked = false;
            o._triggered = false;

            const p = (o.bottomsolid ?? 100) / 100;
            const baseH = Math.max(1, Math.floor(o.h * p));

            const S = {
                id: uid++,
                type: "static",
                invMass: 0,
                x: o.x,
                y: o.y + (o.h - baseH),
                w: o.w,
                h: baseH,
                r: o.r || 0,
                ref: o
            };

            if (isAxisAlignedRot(S.r)) {
                S._corners = null;
                S._aabb = axisAlignedBoxFromProxy(S);
                S._axes = null;
            } else {
                S._corners = getRotatedRectangleCorners(S.x, S.y, S.w, S.h, S.r);
                S._aabb = _aabbFrom(S.x, S.y, S.w, S.h, S.r);
                S._axes = _axesFromCorners(S._corners);
            }

            stat.push(S);
        }

        // Ghosts
        for (let i = 0; i < ghostList.length; i++) {
            const o = ghostList[i];
            if (!o || o.dead) continue;

            o.resetContacts();
            o.hitWallX = false;
            o.hitWallY = false;
            o.wasstaticblocked = false;
            o.wasdynblocked = false;
            o._triggered = false;

            const G = {
                id: uid++,
                type: "ghost",
                invMass: 0,
                x: o.x,
                y: o.y,
                w: o.w,
                h: o.h,
                r: o.r || 0,
                ref: o
            };

            if (isAxisAlignedRot(G.r)) {
                G._corners = null;
                G._aabb = axisAlignedBoxFromProxy(G);
            } else {
                G._corners = getRotatedRectangleCorners(G.x, G.y, G.w, G.h, G.r);
                G._aabb = _aabbFrom(G.x, G.y, G.w, G.h, G.r);
            }

            ghosts.push(G);
        }
          
          
// Dynamics
        for (let i = 0; i < dynamics.length; i++) {
            const o = dynamics[i];
            if (!o || o.dead) continue;

            o.resetContacts();
            o.hitWallX = false;
            o.hitWallY = false;
            o.wasstaticblocked = false;
            o.wasdynblocked = false;
            o._triggered = false;
            o.slide = false;

const startX =  o.x;
const startY =  o.y;
const wantdx = (o._wantdx||0), wantdy = (o._wantdy||0);
let predX  = startX + wantdx;
let predY  = startY + wantdy;

let solidX = predX, solidY = predY, solidW = o.w, solidH = o.h;
let insetOffX = 0, insetOffY = 0;
// ====== DUAL-CUT: dela kroppen i ghost-front + dyn-back ======
const dualPct = Math.max(0, Math.min(o.dual|0, 100));
const hasDual = (!o.ghost && ((o.r|0) === 0) && dualPct > 0);
const dualPx = Math.max(1, Math.floor(o.w * (dualPct / 100)));

let ghostFront = null; // {x,y,w,h}
if (hasDual){
  const p = dualPct / 100;
const wx = (o._wantdx || 0);

// använd verklig rörelseriktning för dual-split
let moveDir;

  moveDir = getDualFacing(o); // fallback när objektet står still


const dir = o.backwarddual
  ? (moveDir === "right" ? "left" : "right")
  : moveDir;
  // Om dual-sidan bytt håll sedan förra frame:
// flytta hela kroppen så att solid-delen inte "byter plats" mitt i ett objekt


const turnedHoriz =
  o._lastDualDir &&
  o._lastDualDir !== dir &&
  ((o._lastDualDir === "left" && dir === "right") ||
   (o._lastDualDir === "right" && dir === "left"));

const shouldCompensate =
  turnedHoriz &&
  Math.abs(o._wantdx || 0) > 0.001 &&
  Math.abs(wantdx) >= 0.5;

if (shouldCompensate&&o.compensate==1){
  if (o._lastDualDir === "right" && dir === "left"){
    predX -= dualPx;
    solidX -= dualPx;
  } else if (o._lastDualDir === "left" && dir === "right"){
    predX += dualPx;
    solidX += dualPx;
  }
}
else if(shouldCompensate){
    o.compensate=1;
}
else{o.compensate=0;}

o._lastDualDir = dir;
const W = o.w, H = o.h;

  if (dir === 'right'){
    const gw = Math.max(1, Math.floor(W * p));
    const sw = Math.max(1, W - gw);
    ghostFront = { x: predX + sw, y: predY, w: gw, h: H };
    solidX = predX; solidW = sw;
    insetOffX = 0;              // bakdel börjar vid predX → ingen kompensation

  } else if (dir === 'left'){
    const gw = Math.max(1, Math.floor(W * p));
    const sw = Math.max(1, W - gw);
    ghostFront = { x: predX, y: predY, w: gw, h: H };
    solidX = predX + gw; solidW = sw;
    insetOffX = gw;             // *** VIKTIGT: komp för att bakdel flyttats till höger ***

  } else if (dir === 'down'){
    const gh = Math.max(1, Math.floor(H * p));
    const sh = Math.max(1, H - gh);
    ghostFront = { x: predX, y: predY + sh, w: W, h: gh };
    solidY = predY; solidH = sh;
    insetOffY = 0;              // bakdel startar vid predY

  } else if (dir === 'up'){
    const gh = Math.max(1, Math.floor(H * p));
    const sh = Math.max(1, H - gh);
    ghostFront = { x: predX, y: predY, w: W, h: gh };
    solidY = predY + gh; solidH = sh;
    insetOffY = gh;             // *** VIKTIGT: komp för att bakdel flyttats ned ***
  }
}

// === DYN-proxy: alltid bakdelen (eller hela kroppen om ingen dual) ===
let P= { id:uid++, type:'dyn', invMass:1, x:solidX, y:solidY, sx:startX, sy:startY, w:solidW, h:solidH, r:o.r||0, ref:o };

P._insetOffX = insetOffX;
P._insetOffY = insetOffY;
P._corners = null;
P._aabb    = { x:P.x, y:P.y, w:P.w, h:P.h };
P._solvedStatics = false;
dyn.push(P);

// === GHOST-proxy: endast om dual och ghostFront finns ===
if (ghostFront){
  const G = { id:uid++, type:'ghost', invMass:0, x:ghostFront.x, y:ghostFront.y, w:ghostFront.w, h:ghostFront.h, r:0, ref:o };
  if (isAxisAlignedRot(G.r)) {
  G._corners = null;
  G._aabb    = axisAlignedBoxFromProxy(G);
} else {
  G._corners = getRotatedRectangleCorners(G.x,G.y,G.w,G.h,G.r||0);
  G._aabb    = _aabbFrom(G.x,G.y,G.w,G.h,G.r||0);
}
  G._ghostClass = 'dualFront';   // <— inte "nose": detta är CUT-fronten
  G._owner = o;
  ghosts.push(G);
}


        
      }
     
    markGhostsDirty();
    markStaticsDirty();
// Bygg stat-grid EN gång per frame (som innan)
const { gridStat, gridGhost } = _ensureStaticGrids(stat, ghosts);

for (let i = 0; i < dyn.length; i++) {
  solveDynVsStaticsSequential(dyn[i], gridStat);
}

// Skapa ett återanvänt dyn-grid (en instans) för alla iterationer
const gridDyn = new HashGrid(SOLVER_CELL);
// 2) Iterera Jacobi


for (let it = 0; it < this.ITER; it++) {
  // — Hashgrid för dynamics (billig reset via bucket-stamp) —
  gridDyn.beginInsertCycle();
  for (let i = 0; i < dyn.length; i++) gridDyn.insert(dyn[i]);
  
  
  
  
  
  
  

  // Change A: init per-ref ackumulatorer (sloppa Map/ensure)
  for (let i = 0; i < dyn.length; i++) {
    const r = dyn[i].ref;
    r.__dx = 0;
    r.__dy = 0;
    
  }

  // Återanvänd små arrayer för att undvika GC
  const tmpStat = [], tmpDyn = [];
  const itrScale = (BETA / this.ITER); // Baumgarte per iteration
  for (let ai = 0; ai < dyn.length; ai++) {
    
    const A = dyn[ai];
   // if (A._solvedStatics) continue;






    // --------- A mot statics ---------
    tmpStat.length = 0;
    const aAABB = A._aabb || _aabbFrom(A.x, A.y, A.w, A.h, A.r || 0);
    const nearStat = gridStat.query(aAABB, tmpStat);
    
    for (let bi = 0; bi < nearStat.length; bi++) {
      const B = nearStat[bi];
      if (A._axisSolved && isAxisAlignedRot(A.r) && isAxisAlignedRot(B.r)) {
  continue;
}
      

      
      // Change C: billig AABB-reject
      const aAABB = A._aabb || _aabbFrom(A.x,A.y,A.w,A.h,A.r||0);
      const bAABB = B._aabb || _aabbFrom(B.x,B.y,B.w,B.h,B.r||0);
      if (!aabbOverlapRect(aAABB, bAABB)) continue;
      // Change C: snabb MTV för orerade, annars OBB
      let contact;
if (isAxisAlignedRot(A.r) && isAxisAlignedRot(B.r)) {
  const AA = axisAlignedBoxFromProxy(A);
  const BB = axisAlignedBoxFromProxy(B);
  contact = aabbAabbMTV(AA, BB);
} else {
  contact = obbObbMTV(A, B);
}
      if (!contact) continue;
      // --- Skip MTV om överlappningen ligger endast i ghost-delen ---

     

                    





      


      
      
      
      
      
      
      
      // Stabilisering: dead-zone + skala ner per iteration
      let dpth = contact.depth - PEN_SLOP;
      if (dpth <= 0) continue;
      dpth *= itrScale;

      const n = contact.n;
      


      
      const invA = A.invMass, invB = B.invMass, invSum = invA + invB || 1;

      // Per-kropp korrigering
      let cAx = -n.x * dpth * (invA / invSum);
      let cAy = -n.y * dpth * (invA / invSum);
if (A.ref && B.type === 'static' && !isAxisAlignedRot(B.r)) {
  const wx = A.ref._wantdx || 0;
  const wy = A.ref._wantdy || 0;
  const mostlyHorizontal = Math.abs(wx) > Math.abs(wy) * 1.2;
  const groundedish = !!A.ref.hitWallY;

  // tillåt inte sneda objekt att trycka ner kroppen i marken
  if ((mostlyHorizontal || groundedish) && cAy > 0) {
    cAy = 0;
  }
}

      if (Math.abs(n.x) > 0) {
  A.ref.hitWallX = true;
} else if(Math.abs(n.y)>0){
  A.ref.hitWallY = true;
}


      // Klampa max per par/kropp/varv
      const lenA = Math.hypot(cAx, cAy);
      if (lenA > MAX_CORR_PX) { const s = MAX_CORR_PX / lenA; cAx *= s; cAy *= s; }

      // Change A: ackumulera direkt
      A.ref.__dx += cAx;  A.ref.__dy += cAy;

      if (B.type === 'dyn') {
        let cBx =  n.x * dpth * (invB / invSum);
        let cBy =  n.y * dpth * (invB / invSum);
        const lenB = Math.hypot(cBx, cBy);
        if (lenB > MAX_CORR_PX) { const s = MAX_CORR_PX / lenB; cBx *= s; cBy *= s; }
        B.ref.__dx += cBx;  B.ref.__dy += cBy;
      }

      if (B.type === 'static' && !isAxisAlignedRot(B.r) && A.ref) {
  A.ref._contactNormals.push(n);
}
if(B.type === 'dyn'){
      if (A.ref) _pushCollisionLog(true,A.ref, (B.ref || B), n, false, dpth, A._aabb, B._aabb);
      if (B.ref) _pushCollisionLog(true,B.ref, (A.ref || A), { x: -n.x, y: -n.y }, false, dpth, A._aabb, B._aabb);
  }
  if(B.type === 'static'){
      if (A.ref) _pushCollisionLog(false,A.ref, (B.ref || B), n, false, dpth, A._aabb, B._aabb);
      if (B.ref) _pushCollisionLog(false,B.ref, (A.ref || A), { x: -n.x, y: -n.y }, false, dpth, A._aabb, B._aabb);
      
      
      
  }
    }
    
// --------- A mot andra dynamics ---------
    tmpDyn.length = 0;
    const nearDyn = gridDyn.query(aAABB, tmpDyn);

    for (let bi = 0; bi < nearDyn.length; bi++) {
      const B = nearDyn[bi];
      // Change B: behandla varje par exakt en gång
      if (B.id <= A.id) continue;

      // Change C: billig AABB-reject
      const aAABB = A._aabb || _aabbFrom(A.x,A.y,A.w,A.h,A.r||0);
      const bAABB = B._aabb || _aabbFrom(B.x,B.y,B.w,B.h,B.r||0);
      if (!aabbOverlapRect(aAABB, bAABB)) continue;

      // Snabbgren: aabb/obb/circle
      let contact;
      if ((A.invMass == 0) || (B.invMass == 0)) {
  if (isAxisAlignedRot(A.r) && isAxisAlignedRot(B.r)) {
    const AA = axisAlignedBoxFromProxy(A);
    const BB = axisAlignedBoxFromProxy(B);
    contact = aabbAabbMTV(AA, BB);
  } else {
    contact = obbObbMTV(A, B);
  }
} else {
  contact = circleCircleMTV(A, B);
}
      if (!contact) continue;
      // Stabilisering
      let dpth = contact.depth - PEN_SLOP;
      if (dpth <= 0) continue;
      dpth *= itrScale;

      const n = contact.n;
      const invA = A.invMass, invB = B.invMass, invSum = invA + invB || 1;

      // A-korrigering
      let cAx = -n.x * dpth * (invA / invSum);
      let cAy = -n.y * dpth * (invA / invSum);
      let L = Math.hypot(cAx, cAy);
      if (L > MAX_CORR_PX) { const s = MAX_CORR_PX / L; cAx *= s; cAy *= s; }
      A.ref.__dx += cAx;  A.ref.__dy += cAy;

      // B-korrigering
      let cBx =  n.x * dpth * (invB / invSum);
      let cBy =  n.y * dpth * (invB / invSum);
      L = Math.hypot(cBx, cBy);
      if (L > MAX_CORR_PX) { const s = MAX_CORR_PX / L; cBx *= s; cBy *= s; }
      B.ref.__dx += cBx;  B.ref.__dy += cBy;

      if (A.ref) _pushCollisionLog(true,A.ref, (B.ref || B), n, false, dpth, A._aabb, B._aabb);
      if (B.ref) _pushCollisionLog(true,B.ref, (A.ref || A), { x: -n.x, y: -n.y }, false, dpth, A._aabb, B._aabb);
      A.ref.wasdynblocked=true;
      B.ref.wasdynblocked=true;
    }
  }


  // — Applicera och uppdatera cache inför nästa iteration —

  for (let i = 0; i < dyn.length; i++) {
    const d = dyn[i];
    d.x += d.ref.__dx;
    d.y += d.ref.__dy;

if (isAxisAlignedRot(d.r)) {
  d._corners = null;
  d._aabb    = axisAlignedBoxFromProxy(d);
} else {
  d._corners = getRotatedRectangleCorners(d.x, d.y, d.w, d.h, d.r||0);
  d._aabb    = _aabbFrom(d.x, d.y, d.w, d.h, d.r||0);
}

      
  }


}
    
        // --- NYTT: trigger-pass mot ghost ---
    for (let i=0;i<dyn.length;i++){
      const D = dyn[i];              // färdiga, slid:ade positioner
      const aabbD = _aabbFrom(D.x, D.y, D.w, D.h, D.r||0);
      
            
      
      const nearG = gridGhost.query(aabbD);
      for (let gi=0; gi<nearG.length; gi++){
        const G = nearG[gi];


        // Overlap? använd OBB-test (ingen MTV appliceras!)
        const contact = obbObbMTV(D, G);
        if (!contact) continue;
      
        // Logga åt båda hållen, men flytta INTE
       if(G._ghostClass !== 'dualFront') _pushCollisionLog(true,D.ref, (G.ref || G), contact.n, true);
        _pushCollisionLog(true,G.ref, (D.ref || D), {x:-contact.n.x, y:-contact.n.y}, true);

        // valfritt: flagga som triggerad den här framen
        if (D.ref) D.ref._triggered = true;
        if (G.ref) G.ref._triggered = true;
      }
    }
  if (!gridStat) return; // säkerhet

  const LOOT_ITER = 3;        // få varv räcker
  const MAX_STEP  = 20;       // max px per korrigering
  const EPS_PEN   = 0.05;     // liten dead-zone

  for (let gi=0; gi<ghosts.length; gi++){
    const G = ghosts[gi];
    if (!G) continue;


    // Kör några varv MTV-resolv mot statics
    for (let it=0; it<LOOT_ITER; it++){
      const aabbG = G._aabb || _aabbFrom(G.x, G.y, G.w, G.h, G.r||0);
      const nearS = gridStat.query(aabbG);

      let moved = false;

      for (let si=0; si<nearS.length; si++){
        const S = nearS[si];

        // snabb AABB-reject
        const aabbS = S._aabb || _aabbFrom(S.x, S.y, S.w, S.h, S.r||0);
        if (!aabbOverlapRect(aabbG, aabbS)) continue;

        // MTV (snabb för orerade)
        const contact = (((S.r|0)===0) && ((G.r|0)===0))
          ? aabbAabbMTV({x:G.x,y:G.y,w:G.w,h:G.h}, S)
          : obbObbMTV({x:G.x,y:G.y,w:G.w,h:G.h,r:G.r||0}, S);

        if (!contact) continue;

        // skala & klampa så det inte “skjuter” iväg
        let depth = contact.depth - EPS_PEN;
        if (depth <= 0) continue;
        if (depth > MAX_STEP) depth = MAX_STEP;

       // G.x -= contact.n.x * depth;
       // G.y -= contact.n.y * depth;

        // uppdatera cache
        G._aabb = { x:G.x, y:G.y, w:G.w, h:G.h };
        G._corners = null;

        moved = true;

        // logga valfritt som "ghost" på lootens ägare/ref
        if (G.ref) _pushCollisionLog(true,G.ref, (S.ref || S), contact.n, true);
      }

      if (!moved) break;
    }

    // skriv tillbaka till loot-objektet
    if (G.ref){
      G.ref.x = G.x; G.ref.y = G.y;
      G.ref.freex = G.ref.x; G.ref.freey = G.ref.y;
    }
  }

    // 3) skriv tillbaka
    for (let i=0;i<dyn.length;i++){
      const d = dyn[i];
      const o = d.ref;
      const wantdx = (o._wantdx||0), wantdy = (o._wantdy||0);


   
      const corrx = (d.x - (d.sx || d.x)) - wantdx;
      const corry = (d.y - (d.sy || d.y)) - wantdy;
      const movedN = Math.hypot(corrx, corry);
        o.blocked=false;
        o.blockedx=false;
        o.blockedy=false;
     
    
     if(!o.slide){
        o.blocked  = movedN > 0;
        o.blockedx = o.blocked && Math.abs(d.x - o.x) < Math.abs(wantdx);
        o.blockedy = o.blocked && Math.abs(d.y - o.y) < Math.abs(wantdy);
     }
        
      
      o.savedx=o.x;
      o.savedy=o.y;
      
      
      

      o.x = d.x - (d._insetOffX || 0);
        o.y = d.y - (d._insetOffY || 0);
        o.freex = o.x; o.freey = o.y;
        
        o.stuck=false;
        var diff = Math.abs( o.savedx - o.x );
        var diff2 = Math.abs( o.savedy - o.y );
        if( diff2 < 0.1 &&diff < 0.1) {
            o.stuck=true;
        }
        
        
    }

    
   
    
    
  }
};
function aabbAabbMTV(A, B){
    
  const ax1 = A.x,        ay1 = A.y;
  const ax2 = A.x + A.w,  ay2 = A.y + A.h;
  const bx1 = B.x,        by1 = B.y;
  const bx2 = B.x + B.w,  by2 = B.y + B.h;

  const ox = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  if (ox <= 0) return null;

  const oy = Math.min(ay2, by2) - Math.max(ay1, by1);
  if (oy <= 0) return null;

  // Normal ska peka från A -> B
  if (ox < oy){
    const acx = A.x + A.w * 0.5;
    const bcx = B.x + B.w * 0.5;
    const nx  = (acx < bcx) ? +1 : -1;   // <-- fix: var fel tecken
    return { n:{x:nx, y:0}, depth:ox };
  } else {
    const acy = A.y + A.h * 0.5;
    const bcy = B.y + B.h * 0.5;
    const ny  = (acy < bcy) ? +1 : -1;   // <-- fix: var fel tecken
    return { n:{x:0, y:ny}, depth:oy };
  }
}
function aabbOverlapRect(a, b){
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
// --- module scope ---
let _gridStat = null, _gridGhost = null;
let _statStamp = 0, _ghostStamp = 0;

function markStaticsDirty(){ _statStamp++;gamee.needsPathRebuild = true; }  // call when you move/rate/add/remove statics
function markGhostsDirty(){  _ghostStamp++; } // call when ghost volumes change

function _ensureStaticGrids(stat, ghosts){
  if (!_gridStat || _gridStat._builtFor !== _statStamp){
    _gridStat = new HashGrid(SOLVER_CELL);
    for (let i=0;i<stat.length;i++) _gridStat.insert(stat[i]);
    _gridStat._builtFor = _statStamp;
  }
  if (!_gridGhost || _gridGhost._builtFor !== _ghostStamp){
    _gridGhost = new HashGrid(SOLVER_CELL);
    for (let i=0;i<ghosts.length;i++) _gridGhost.insert(ghosts[i]);
    _gridGhost._builtFor = _ghostStamp;
  }
   // <<< NYTT: gör grids åtkomliga från index.html / spel-AI
  window.G5 = window.G5 || {};
  window.G5.gridStat = _gridStat;
  window.G5.gridGhost = _gridGhost;
  
  
  
  return { gridStat:_gridStat, gridGhost:_gridGhost };
}
// Hur brant droppen ska kännas (1 = linjär, 2 = lite rundare)



// ===== LOS / Raycast helpers (snabb) =====
function _segAABB(ax, ay, bx, by, pad = 2){
  const minx = Math.min(ax, bx) - pad;
  const miny = Math.min(ay, by) - pad;
  const maxx = Math.max(ax, bx) + pad;
  const maxy = Math.max(ay, by) + pad;
  return { x:minx, y:miny, w:(maxx-minx), h:(maxy-miny) };
}

// Segment vs AABB (slab test). Returnerar t (0..1) för första hit, eller null.
function segmentAabbHit(ax, ay, bx, by, r){
  let tmin = 0, tmax = 1;
  const dx = bx - ax, dy = by - ay;

  if (Math.abs(dx) < 1e-9){
    if (ax < r.x || ax > r.x + r.w) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (r.x - ax) * inv;
    let t2 = (r.x + r.w - ax) * inv;
    if (t1 > t2){ const tmp=t1; t1=t2; t2=tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-9){
    if (ay < r.y || ay > r.y + r.h) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (r.y - ay) * inv;
    let t2 = (r.y + r.h - ay) * inv;
    if (t1 > t2){ const tmp=t1; t1=t2; t2=tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > 1) return null;
  return tmin;
}
function segmentObbHit(ax, ay, bx, by, S, pad = 0){
  // S: {x,y,w,h,r} där x,y = top-left och r i grader
  const cx = S.x + S.w * 0.5;
  const cy = S.y + S.h * 0.5;

  const th = (S.r || 0) * Math.PI / 180;
  const c = Math.cos(-th), s = Math.sin(-th); // inverse ration

  // world -> local
  const ax0 = ax - cx, ay0 = ay - cy;
  const bx0 = bx - cx, by0 = by - cy;

  const lax = ax0 * c - ay0 * s;
  const lay = ax0 * s + ay0 * c;
  const lbx = bx0 * c - by0 * s;
  const lby = bx0 * s + by0 * c;

  // axis-aligned box i local space, centrerad vid 0,0
  const r = {
    x: -S.w * 0.5 - pad,
    y: -S.h * 0.5 - pad,
    w:  S.w + pad * 2,
    h:  S.h + pad * 2
  };

  return segmentAabbHit(lax, lay, lbx, lby, r);
}
function raycastStatics(gridStat, ax, ay, bx, by, opts = {}){
  if (!gridStat) return null;
  const pad = (opts.pad ?? 2);
  const aabb = _segAABB(ax, ay, bx, by, pad);

  const cand = gridStat.query(aabb);
  let bestT = Infinity;
  let best = null;

  for (let i=0;i<cand.length;i++){
    const S = cand[i];
    if (opts.filter && opts.filter(S) === false) continue;

    let t = null;
    if ((S.r || 0) !== 0){
      t = segmentObbHit(ax, ay, bx, by, S, 0);
    } else {
      const r = S._aabb || { x:S.x, y:S.y, w:S.w, h:S.h };
      t = segmentAabbHit(ax, ay, bx, by, r);
    }

    if (t === null) continue;
    if (t < bestT){ bestT = t; best = S; }
  }

  if (!best) return null;
  return best;
}

function hasLineOfSight(gridStat, ax, ay, bx, by, opts = {}){
  return raycastStatics(gridStat, ax, ay, bx, by, opts) === null;
}

function pointInAabb(px, py, r){
  return px >= r.x && px <= r.x + r.w &&
         py >= r.y && py <= r.y + r.h;
}

function pointInObb(px, py, o){
  const r = o.r || 0;
  if ((r | 0) === 0){
    return px >= o.x && px <= o.x + o.w &&
           py >= o.y && py <= o.y + o.h;
  }

  const cx = o.x + o.w * 0.5;
  const cy = o.y + o.h * 0.5;
  const th = -r * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);

  const dx = px - cx;
  const dy = py - cy;

  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;

  return lx >= -o.w * 0.5 && lx <= o.w * 0.5 &&
         ly >= -o.h * 0.5 && ly <= o.h * 0.5;
}
function getDualFacing(o){
  const wx = (o._wantdx || 0);

  // flippeddir = vad flipped:true betyder för just detta objekt
  // ex: "left" => flipped true betyder left
  //     "right" => flipped true betyder right

  if (typeof o.flipped === "boolean") {
    // Om vi ännu inte vet hur flipped ska tolkas, försök lära från rörelse
    if (o.flippeddir == null) {
      if (Math.abs(wx) > 0.001) {
        const moving = (wx > 0) ? "right" : "left";

        // Om objektet rör sig åt moving när flipped=true,
        // då betyder flipped=true => moving
        o.flippeddir = o.flipped ? moving : (moving === "right" ? "left" : "right");
      }
    }

    // När vi vet hur flipped ska tolkas
    if (o.flippeddir === "left") {
      return o.flipped ? "left" : "right";
    }
    if (o.flippeddir === "right") {
      return o.flipped ? "right" : "left";
    }
  }

  // fallback: rörelse
  if (Math.abs(wx) > 0.001) {
    return (wx > 0) ? "right" : "left";
  }

  // fallback: senast kända
  if (o._dualFacing === "left" || o._dualFacing === "right") {
    return o._dualFacing;
  }

  return "right";
}
function normDeg(rr){
  let r = rr % 360;
  if (r < 0) r += 360;
  return r;
}

function isAxisAlignedRot(rr){
  const r = normDeg(rr || 0);
  return r === 0 || r === 90 || r === 180 || r === 270;
}

function axisAlignedBoxFromProxy(P){
  const r = normDeg(P.r || 0);

  if (r === 0 || r === 180){
    return { x:P.x, y:P.y, w:P.w, h:P.h };
  }

  // 90 / 270 => swap w/h runt centrum
  const cx = P.x + P.w * 0.5;
  const cy = P.y + P.h * 0.5;
  const w = P.h;
  const h = P.w;

  return {
    x: cx - w * 0.5,
    y: cy - h * 0.5,
    w, h
  };
}

function solveDynVsStaticsSequential(A, gridStat){
  const o = A.ref;
  if (!o) return;
  o.slide=false;
  const dx = o._wantdx || 0;
  const dy = o._wantdy || 0;
  const dist = Math.hypot(dx, dy);

  const STEP = 4; // testa 2..6
  const steps = Math.max(1, Math.ceil(dist / STEP));
  const baseSx = dx / steps;
const baseSy = dy / steps;

  // börja från startposition för solid-delen
  A.x = (A.sx || 0) + (A._insetOffX || 0);
  A.y = (A.sy || 0) + (A._insetOffY || 0);
  
  
  if (A.ref && A.ref._stepRemain !== 0) {
  const STEP_PER_FRAME = 100;
  const remain = A.ref._stepRemain;

  if (remain > 0) {
    const take = Math.min(STEP_PER_FRAME, remain);
    A.y += take;
    A.ref._stepRemain -= take;
    if (A.ref._stepRemain < 0.001) A.ref._stepRemain = 0;
  } else {
    const take = Math.min(STEP_PER_FRAME, -remain);
    A.y -= take;
    A.ref._stepRemain += take;
    if (A.ref._stepRemain > -0.001) A.ref._stepRemain = 0;
  }

  A._aabb = { x: A.x, y: A.y, w: A.w, h: A.h };
}
if (A.ref && A.ref._stepLock > 0) A.ref._stepLock--;
  
  
  
  
  
  
  

  if (isAxisAlignedRot(A.r)) {
    A._corners = null;
    A._aabb = axisAlignedBoxFromProxy(A);
  } else {
    A._corners = getRotatedRectangleCorners(A.x, A.y, A.w, A.h, A.r || 0);
    A._aabb = _aabbFrom(A.x, A.y, A.w, A.h, A.r || 0);
  }

  const tmp = [];

  for (let step = 0; step < steps; step++) {
      let stepDx = baseSx;
let stepDy = baseSy;

o._contactNormals.length = 0;
    // === X först ===
    if (stepDx  !== 0) {
      A.x += stepDx ;

      if (isAxisAlignedRot(A.r)) {
        A._corners = null;
        A._aabb = axisAlignedBoxFromProxy(A);
      } else {
        A._corners = getRotatedRectangleCorners(A.x, A.y, A.w, A.h, A.r || 0);
        A._aabb = _aabbFrom(A.x, A.y, A.w, A.h, A.r || 0);
      }

      tmp.length = 0;
      const near = gridStat.query(A._aabb, tmp);

      for (let i = 0; i < near.length; i++) {
        const S = near[i];

        let contact;
        let AA, SS;

        if (isAxisAlignedRot(A.r) && isAxisAlignedRot(S.r)) {
          AA = axisAlignedBoxFromProxy(A);
          SS = axisAlignedBoxFromProxy(S);
          if (!aabbOverlapRect(AA, SS)) continue;
          contact = aabbAabbMTV(AA, SS);
        } else {
          AA = A._aabb;
          SS = S._aabb || _aabbFrom(S.x, S.y, S.w, S.h, S.r || 0);
          if (!aabbOverlapRect(AA, SS)) continue;
          contact = obbObbMTV(A, S);
        }

        if (!contact) continue;
        o.wasstaticblocked=true;

//NYTT
if (o.stuck&&o.blockedy&&Math.abs(contact.n.x) > 0.9 && (A.x - (A.sx || A.x) || 0) !== 0) {
  const wantdx = (A.ref?._wantdx || 0);
  const moveX = A.x - (A.sx || A.x);
const dir = moveX >= 0 ? 1 : -1;

  const x0 = A.x, y0 = A.y;
  let best = 0;
  let useStepDown = false;



const ang = (S.r || 0) * Math.PI / 180;
const t1 = { x: Math.cos(ang), y: Math.sin(ang) };
const t2 = { x: -t1.x, y: -t1.y };

let tangent = null;
if (dir > 0) {
  tangent = (t1.x >= t2.x) ? t1 : t2;
} else {
  tangent = (t1.x <= t2.x) ? t1 : t2;
}

let goingUphill = false;
let goingDownhill = false;

if (Math.abs((S.r || 0) % 90) > 0.001) {
  goingUphill = tangent.y < -0.001;
  goingDownhill = tangent.y > 0.001;
} else {
  // raka objekt / sömfall: avgör med probes istället
  goingUphill = true;
  goingDownhill = true;
}
  for (let step = 1; step <= STEP_MAX; step++) {

    // =========================
    // UPHILL -> testa STEP UP
    // =========================
    if (goingUphill) {
      const testUp = { x: x0, y: y0 - step, w: A.w, h: A.h, r: A.r || 0 };

      let upBlocked = false;

      // fri från S
      if (obbObbMTV(testUp, S)) {
        upBlocked = true;
      }

      // fri från andra statics
      if (!upBlocked) {
        const near2 = gridStat.query(
          _aabbFrom(testUp.x, testUp.y, testUp.w, testUp.h, testUp.r || 0)
        );
        for (let k = 0; k < near2.length; k++) {
          const S2 = near2[k];
          if (S2 === S) continue;
          if (obbObbMTV(testUp, S2)) {
            upBlocked = true;
            break;
          }
        }
      }

      if (!upBlocked) {
        best = step;
        useStepDown = false;
        break;
      }
    }

    // ===========================
    // DOWNHILL -> testa STEP DOWN
    // ===========================
    if (goingDownhill) {
      const testDown = { x: x0, y: y0 + step, w: A.w, h: A.h, r: A.r || 0 };

      let downBlocked = false;

      // fri från S
      if (obbObbMTV(testDown, S)) {
        downBlocked = true;
      }

      // fri från andra statics
      if (!downBlocked) {
        const nearD = gridStat.query(
          _aabbFrom(testDown.x, testDown.y, testDown.w, testDown.h, testDown.r || 0)
        );
        for (let k = 0; k < nearD.length; k++) {
          const S2 = nearD[k];
          if (S2 === S) continue;
          if (obbObbMTV(testDown, S2)) {
            downBlocked = true;
            break;
          }
        }
      }

      if (!downBlocked) {
        best = step;
        useStepDown = true;
        break;
      }
    }

    // nästan plan yta -> ingen auto step här
    if (!goingUphill && !goingDownhill) {
      break;
    }
  }

  if (best > 0) {
    if (useStepDown) {
     if (Math.abs((S.r || 0) % 90) > 0.001) A.ref._stepRemain = (A.ref._stepRemain || 0) - best ;
     else{  A.ref._stepRemain = (A.ref._stepRemain || 0) - best +10;}
    } else {
      A.ref._stepRemain = (A.ref._stepRemain || 0) + best - 10;
    }

    A.ref._stepLock = 100;
    continue;
  }
}









        // logga FÖRE push-out, medan overlap verkligen finns
        _pushCollisionLog(false,o, S.ref, contact.n, false, contact.depth, AA, SS);

        // pusha ut direkt
        A.x -= contact.n.x * contact.depth;
        A.y -= contact.n.y * contact.depth;
        
        // TOP-DOWN SLIDE LOGIK:

        if ((S.r || 0) !== 0 && !isAxisAlignedRot(S.r)) {
            o._contactNormals.push(contact.n);
          }
        if (Math.abs(contact.n.x) > 0.5) o.hitWallX = true;

        if (isAxisAlignedRot(A.r)) {
          A._corners = null;
          A._aabb = axisAlignedBoxFromProxy(A);
        } else {
          A._corners = getRotatedRectangleCorners(A.x, A.y, A.w, A.h, A.r || 0);
          A._aabb = _aabbFrom(A.x, A.y, A.w, A.h, A.r || 0);
        }
      }
    }

const inputX = o._wantdx || 0;
const inputY = o._wantdy || 0;
const inputLen = Math.hypot(inputX, inputY);
const DEADZONE = 0.5;

if (o._contactNormals.length > 0 && inputLen > DEADZONE) {

  if (slideMode === "platformer") {
    if (Math.abs(inputX) > DEADZONE) {
      const assistY = getSlopeAssistY(o._contactNormals, inputX, 0);
      stepDy += assistY * Math.abs(stepDx) * 1.05;
      if(S.ref.r!==0)o.slide=true;
    }
  }
}


    // === Y sedan ===
    if (stepDy !== 0) {
      A.y += stepDy;

      if (isAxisAlignedRot(A.r)) {
        A._corners = null;
        A._aabb = axisAlignedBoxFromProxy(A);
      } else {
        A._corners = getRotatedRectangleCorners(A.x, A.y, A.w, A.h, A.r || 0);
        A._aabb = _aabbFrom(A.x, A.y, A.w, A.h, A.r || 0);
      }

      tmp.length = 0;
      const near = gridStat.query(A._aabb, tmp);

      for (let i = 0; i < near.length; i++) {
        const S = near[i];

        let contact;
        let AA, SS;

        if (isAxisAlignedRot(A.r) && isAxisAlignedRot(S.r)) {
          AA = axisAlignedBoxFromProxy(A);
          SS = axisAlignedBoxFromProxy(S);
          if (!aabbOverlapRect(AA, SS)) continue;
          contact = aabbAabbMTV(AA, SS);
        } else {
          AA = A._aabb;
          SS = S._aabb || _aabbFrom(S.x, S.y, S.w, S.h, S.r || 0);
          if (!aabbOverlapRect(AA, SS)) continue;
          contact = obbObbMTV(A, S);
        }

        if (!contact) continue;
        o.wasstaticblocked=true;


//NYTT
let goingUphill = false;
let goingDownhill = false;
if (o.stuck&&o.blockedy&&Math.abs(contact.n.x) > 0.9 && (A.x - (A.sx || A.x) || 0) !== 0) {
  const wantdx = (A.ref?._wantdx || 0);
  const moveX = A.x - (A.sx || A.x);
const dir = moveX >= 0 ? 1 : -1;

  const x0 = A.x, y0 = A.y;
  let best = 0;
  let useStepDown = false;



const ang = (S.r || 0) * Math.PI / 180;
const t1 = { x: Math.cos(ang), y: Math.sin(ang) };
const t2 = { x: -t1.x, y: -t1.y };

let tangent = null;
if (dir > 0) {
  tangent = (t1.x >= t2.x) ? t1 : t2;
} else {
  tangent = (t1.x <= t2.x) ? t1 : t2;
}



if (Math.abs((S.r || 0) % 90) > 0.001) {
  goingUphill = tangent.y < -0.001;
  goingDownhill = tangent.y > 0.001;
} else {
  // raka objekt / sömfall: avgör med probes istället
  goingUphill = true;
  goingDownhill = true;
}


  for (let step = 1; step <= STEP_MAX; step++) {

    // =========================
    // UPHILL -> testa STEP UP
    // =========================
    if (goingUphill) {
      const testUp = { x: x0, y: y0 - step, w: A.w, h: A.h, r: A.r || 0 };

      let upBlocked = false;

      // fri från S
      if (obbObbMTV(testUp, S)) {
        upBlocked = true;
      }

      // fri från andra statics
      if (!upBlocked) {
        const near2 = gridStat.query(
          _aabbFrom(testUp.x, testUp.y, testUp.w, testUp.h, testUp.r || 0)
        );
        for (let k = 0; k < near2.length; k++) {
          const S2 = near2[k];
          if (S2 === S) continue;
          if (obbObbMTV(testUp, S2)) {
            upBlocked = true;
            break;
          }
        }
      }

      if (!upBlocked) {
        best = step;
        useStepDown = false;
        break;
      }
    }

    // ===========================
    // DOWNHILL -> testa STEP DOWN
    // ===========================
    if (goingDownhill) {
      const testDown = { x: x0, y: y0 + step, w: A.w, h: A.h, r: A.r || 0 };

      let downBlocked = false;

      // fri från S
      if (obbObbMTV(testDown, S)) {
        downBlocked = true;
      }

      // fri från andra statics
      if (!downBlocked) {
        const nearD = gridStat.query(
          _aabbFrom(testDown.x, testDown.y, testDown.w, testDown.h, testDown.r || 0)
        );
        for (let k = 0; k < nearD.length; k++) {
          const S2 = nearD[k];
          if (S2 === S) continue;
          if (obbObbMTV(testDown, S2)) {
            downBlocked = true;
            break;
          }
        }
      }

      if (!downBlocked) {
        best = step;
        useStepDown = true;
        break;
      }
    }

    // nästan plan yta -> ingen auto step här
    if (!goingUphill && !goingDownhill) {
      break;
    }
  }

  if (best > 0) {
    if (useStepDown) {
     if (Math.abs((S.r || 0) % 90) > 0.001) A.ref._stepRemain = (A.ref._stepRemain || 0) - best ;
      else{  A.ref._stepRemain = (A.ref._stepRemain || 0) - best +10;}
    } else {
      A.ref._stepRemain = (A.ref._stepRemain || 0) + best - 10;
    }

    A.ref._stepLock = 100;
    continue;
  }
}











        // logga FÖRE push-out
        _pushCollisionLog(false,o, S.ref, contact.n, false, contact.depth, AA, SS);

        A.x -= contact.n.x * contact.depth;
        A.y -= contact.n.y * contact.depth;
        // TOP-DOWN SLIDE LOGIK:
if (slideMode === "full") {
  // Krock i X -> lägg över på Y
 // if(o.name=="worker")alert("X");
  const dot = stepDx * contact.n.y;

  if (S.ref.r !== 0) o.slide = true;
  
  if(goingUphill){
    if(o._wantdy > 0){
          if (o._wantdx > 0) stepDy -= dot;
          else stepDy += dot;
    }
    else{
        if (o._wantdx > 0) stepDy += dot;
        else stepDy -= dot;

    }
  }
  if(goingDownhill){
    if(o._wantdy > 0){
          if (o._wantdx > 0) stepDy += dot;
          else stepDy -= dot;
    }
    else{
        if (o._wantdx > 0) stepDy -= dot;
        else stepDy += dot;

    }
      
      
      
      
  }
  
  
  
  
}
        if (Math.abs(contact.n.y) > 0.5) o.hitWallY = true;

        if ((S.r || 0) !== 0 && !isAxisAlignedRot(S.r)) {
          o._contactNormals.push(contact.n);
        }

        if (isAxisAlignedRot(A.r)) {
          A._corners = null;
          A._aabb = axisAlignedBoxFromProxy(A);
        } else {
          A._corners = getRotatedRectangleCorners(A.x, A.y, A.w, A.h, A.r || 0);
          A._aabb = _aabbFrom(A.x, A.y, A.w, A.h, A.r || 0);
        }
      }
    }
  }









  A._solvedStatics = true;
}
function _pushCollisionLog(isDyn = false,targetRef, otherRef, n, isGhost = false, depth = 0, aabbA = null, aabbB = null){
  if (!targetRef || !otherRef) return;

  if (isGhost){
      
      if(targetRef.contactsGhost.ghost1===otherRef||targetRef.contactsGhost.ghost2===otherRef||targetRef.contactsGhost.ghost3===otherRef)return;
      
      
      if(targetRef.contactsGhost.ghost1===null)
          targetRef.contactsGhost.ghost1= otherRef;
      else if(targetRef.contactsGhost.ghost2===null)
          targetRef.contactsGhost.ghost2= otherRef;
      else if(targetRef.contactsGhost.ghost3===null)
          targetRef.contactsGhost.ghost3= otherRef;
    return;
  }

  let dir;

  if (aabbA && aabbB && Math.abs(n.x) > Math.abs(n.y)) {
    const aTop = aabbA.y, aBot = aabbA.y + aabbA.h;
    const bTop = aabbB.y, bBot = aabbB.y + aabbB.h;
    const overlapY = Math.min(aBot, bBot) - Math.max(aTop, bTop);

    const minH = Math.min(aabbA.h, aabbB.h);
    const MIN_SIDE_OVERLAP = Math.max(2, minH * 0.35);

    if (overlapY > 0 && overlapY < MIN_SIDE_OVERLAP) {
      return;
    }
  }

  if (Math.abs(n.x) > Math.abs(n.y)){
    dir = (n.x > 0) ? "right" : "left";
  } else {
    dir = (n.y > 0) ? "down" : "up";
  }

  const bucket = isDyn ? targetRef.contactsDyn : targetRef.contactsSolid;

  // spara bara första eller starkaste; börja enkelt med första
  if (!bucket[dir]) {
    bucket[dir] = otherRef;
  }
}
function getSlopeAssistY(normals, moveX, moveY){
  const moveLen = Math.hypot(moveX, moveY);
  if (!normals || normals.length === 0 || moveLen < 0.0001) return 0;

  const dirx = moveX / moveLen;
  const diry = moveY / moveLen;

  let bestT = null;
  let bestDot = -Infinity;

  for (let i = 0; i < normals.length; i++){
    const n = normals[i];
    if (!n) continue;

    const nl = Math.hypot(n.x, n.y) || 1;
    const nx = n.x / nl;
    const ny = n.y / nl;

    const t1 = { x: -ny, y:  nx };
    const t2 = { x:  ny, y: -nx };

    const d1 = t1.x * dirx + t1.y * diry;
    const d2 = t2.x * dirx + t2.y * diry;

    if (d1 > bestDot){ bestDot = d1; bestT = t1; }
    if (d2 > bestDot){ bestDot = d2; bestT = t2; }
  }

  if (!bestT || bestDot <= 0.001) return 0;

  return bestT.y;
}
function classifySlopeByProbe(A, x0, y0, dir, S, gridStat, STEP_MAX) {
  for (let step = 1; step <= STEP_MAX; step++) {
    const testUp = { x: x0 + dir, y: y0 - step, w: A.w, h: A.h, r: A.r || 0 };
    let upFree = true;

    const nearU = gridStat.query(_aabbFrom(testUp.x, testUp.y, testUp.w, testUp.h, testUp.r || 0));
    for (let i = 0; i < nearU.length; i++) {
      if (obbObbMTV(testUp, nearU[i])) {
        upFree = false;
        break;
      }
    }
    if (upFree) return "uphill";

    const testDown = { x: x0 + dir, y: y0 + step, w: A.w, h: A.h, r: A.r || 0 };
    let downFree = true;

    const nearD = gridStat.query(_aabbFrom(testDown.x, testDown.y, testDown.w, testDown.h, testDown.r || 0));
    for (let i = 0; i < nearD.length; i++) {
      if (obbObbMTV(testDown, nearD[i])) {
        downFree = false;
        break;
      }
    }
    if (downFree) return "downhill";
  }

  return "flat";
}
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