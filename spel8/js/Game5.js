"use strict";
const BUILDING_NAMES2   = new Set(["base","bar","rbase","rbar","house","rhouse","goldmine","tree","water"]);
const PROJECTILE_NAMES = new Set(["arrow","bolt","bullet","proj","missile"]); // lägg till dina namn

function isBuilding(o){ return !!o && BUILDING_NAMES2.has(o.name); }
function isProjectile(o){ return !!o && PROJECTILE_NAMES.has(o.name); }
// "Unit" = rörlig enhet som vi vill enhet-enhet-krocka
function isUnit(o){ return !!o && (o.canMove === true || (!isBuilding(o) && !isProjectile(o))); }

function shouldCollide(A, B){
  // pilar / projektiler kolliderar inte med något i solvern (du kan hantera träffar separat)
  if (isProjectile(A.ref) || isProjectile(B.ref)) return false;

  // enhet ↔ byggnad: JA
  if (isUnit(A.ref) && isBuilding(B.ref)) return true;
  if (isUnit(B.ref) && isBuilding(A.ref)) return true;

  // enhet ↔ enhet: JA
  if (isUnit(A.ref) && isUnit(B.ref)) return true;

  // byggnad ↔ byggnad: onödigt
  return false;
}

// ==== Simultaneous Collision Solver (Jacobi/PBD-lite) ====
const SOLVER_CELL = 96;
function _bpKey(ix, iy){ return ix + ":" + iy; }
function _aabbFrom(x,y,w,h,rotDeg){
  if (!rotDeg) return {x, y, w, h};
  const cs = getRotatedRectangleCorners(x, y, w, h, rotDeg);
  let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
  for (let i=0;i<4;i++){
    const c = cs[i];
    if(c.x<minx)minx=c.x; if(c.y<miny)miny=c.y; if(c.x>maxx)maxx=c.x; if(c.y>maxy)maxy=c.y;
  }
  return {x:minx, y:miny, w:maxx-minx, h:maxy-miny};
}
function _cellsForAABB(a){
  const x1 = Math.floor(a.x / SOLVER_CELL);
  const y1 = Math.floor(a.y / SOLVER_CELL);
  const x2 = Math.floor((a.x + a.w) / SOLVER_CELL);
  const y2 = Math.floor((a.y + a.h) / SOLVER_CELL);
  const out = [];
  for (let iy=y1; iy<=y2; iy++) for (let ix=x1; ix<=x2; ix++) out.push(_bpKey(ix,iy));
  return out;
}
class HashGrid {
  constructor(cell=SOLVER_CELL){ this.cell = cell; this.map = new Map(); }
  clear(){ this.map.clear(); }
  insert(proxy){
    const aabb = proxy._aabb || _aabbFrom(proxy.x, proxy.y, proxy.w, proxy.h, proxy.rot||0);
    proxy._aabb = aabb;
    for (const k of _cellsForAABB(aabb)){
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(proxy);
    }
  }
  query(aabb){
    const seen = new Set(), out=[];
    for (const k of _cellsForAABB(aabb)){
      const arr = this.map.get(k); if (!arr) continue;
      for (let i=0;i<arr.length;i++){ const p = arr[i]; if(!seen.has(p.id)){ seen.add(p.id); out.push(p); } }
    }
    return out;
  }
}
function _dot(a,b){ return a.x*b.x + a.y*b.y; }
function _len(v){ return Math.hypot(v.x, v.y); }
function _norm(v){ const L=_len(v)||1; return {x:v.x/L, y:v.y/L}; }

function obbObbMTV(A, B){
  const axes = [];
  const Ac = A._corners || getRotatedRectangleCorners(A.x, A.y, A.w, A.h, A.rot||0);
  const Bc = B._corners || getRotatedRectangleCorners(B.x, B.y, B.w, B.h, B.rot||0);
  // Bygg 8 axlar utan extra allokeringar i loopen
  for (let i=0;i<4;i++){
    const p1=Ac[i], p2=Ac[(i+1)&3];
    const ex=p2.x-p1.x, ey=p2.y-p1.y;
    const n=_norm({x:-ey,y:ex}); axes.push(n);
  }
  for (let i=0;i<4;i++){
    const p1=Bc[i], p2=Bc[(i+1)&3];
    const ex=p2.x-p1.x, ey=p2.y-p1.y;
    const n=_norm({x:-ey,y:ex}); axes.push(n);
  }

  let bestDepth = Infinity, bestAxis = null;

  // lokal projektion utan onödiga closure-allokeringar
  for (let k=0;k<axes.length;k++){
    const ax = axes[k];
    let amin=Infinity, amax=-Infinity, bmin=Infinity, bmax=-Infinity;

    for (let i=0;i<4;i++){
      const pa=Ac[i]; const da = pa.x*ax.x + pa.y*ax.y;
      if (da<amin) amin=da; if (da>amax) amax=da;
      const pb=Bc[i]; const db = pb.x*ax.x + pb.y*ax.y;
      if (db<bmin) bmin=db; if (db>bmax) bmax=db;
    }
    if (amax <= bmin || bmax <= amin) return null;
    const overlap = Math.min(amax - bmin, bmax - amin);
    if (overlap < bestDepth){ bestDepth = overlap; bestAxis = ax; }
  }
  const centerA = {x:A.x + A.w/2, y:A.y + A.h/2};
  const centerB = {x:B.x + B.w/2, y:B.y + B.h/2};
  const AB = {x:centerB.x - centerA.x, y:centerB.y - centerA.y};
  const sign = (_dot(bestAxis, AB) >= 0) ? +1 : -1;
  return { n: {x:bestAxis.x*sign, y:bestAxis.y*sign}, depth: bestDepth };
}

function circleCircleMTV(A,B){
  const ax=A.x+A.w*0.5, ay=A.y+A.h*0.5;
  const bx=B.x+B.w*0.5, by=B.y+B.h*0.5;
  const dx=bx-ax, dy=by-ay;
  const d2 = dx*dx + dy*dy;
  const rA = Math.min(A.w,A.h)*0.5*1.2;
  const rB = Math.min(B.w,B.h)*0.5*1.2;
  const R  = rA + rB;
  if (d2 > R*R) return null;         // snabb exit
  const dist = Math.sqrt(d2) || 1;
  return { n:{x:dx/dist, y:dy/dist}, depth: R - dist };
}

const MIN_PEN= 0;
const SimSolver = {
  ITER: 3,
  STATIC_INV_MASS: 0.0,
  DYN_INV_MASS: 1.0,

  step(game){
    const map = game.maps[game.currentmap];
    const stat = [];
    const dyn  = [];
    let uid = 1;

    // 1) Samla proxies
    for (let li=0; li<map.layer.length; li++){
      const layer = map.layer[li];
      if (layer.fysics === false) continue;            // helt utanför fysik
      for (let oti=0; oti<layer.objectype.length; oti++){
        const ot = layer.objectype[oti];
        for (let oi=0; oi<ot.objects.length; oi++){
          const o = ot.objects[oi];
          if (layer.ghost || o.ghost) continue;

          const base = { w:o.dimx, h:o.dimy, rot:o.rot||0, ref:o };

          if (layer.solid === true ){
            // cachea hörn/AABB för statics en gång
            const S = { id:uid++, type:'static', invMass:0.0, x:o.x, y:o.y, ...base };
            S._corners = S._corners || getRotatedRectangleCorners(S.x, S.y, S.w, S.h, S.rot||0);
            S._aabb    = S._aabb    || _aabbFrom(S.x, S.y, S.w, S.h, S.rot||0);
            stat.push(S);
            continue;
          }

          // Projektiler hoppar vi över i solvern (träfflogik i din egen kod)
          if (isProjectile(o)) continue;

          // Rörliga enheter (dynamics)
          const startX = o.x, startY = o.y;
          const wantdx = (o._wantdx||0), wantdy = (o._wantdy||0);
          let P;
          if (isBuilding(o)) P = { id:uid++, type:'dyn', invMass:0, x:startX + wantdx, y:startY + wantdy, sx:startX, sy:startY, ...base };
          else               P = { id:uid++, type:'dyn', invMass:1, x:startX + wantdx, y:startY + wantdy, sx:startX, sy:startY, ...base };

          // nollställ kollisionslistor som din övriga kod läser
          o.hadcollidedobj    = o.hadcollidedobj || [];
          o.hadcollidedobj.length = 0;
          o.collideslistan    = o.collideslistan    || [];
          o.collideslistandir = o.collideslistandir || [];
          o.collideslistanobj = o.collideslistanobj || [];
          o.collideslistan.length = o.collideslistandir.length = o.collideslistanobj.length = 0;

          o._contactNormals = o._contactNormals || [];
          o._contactNormals.length = 0;

          dyn.push(P);
        }
      }
    }

    // Bygg stat-grid EN gång och återanvänd (i iterationer + slide)
    const gridStat = new HashGrid(SOLVER_CELL);
    for (let i=0;i<stat.length;i++) gridStat.insert(stat[i]);

    // 2) Iterera Jacobi
    for (let it=0; it<this.ITER; it++){
      // Kopiera stat-buckets; lägg bara in dyn varje varv
      const g = new HashGrid(SOLVER_CELL);
      g.map = new Map(gridStat.map);
      for (let i=0;i<dyn.length;i++) g.insert(dyn[i]);

      const disp = new Map();
      const seen = new Set();
      const ensure = (k)=>{ if(!disp.has(k)) disp.set(k,{x:0,y:0}); return disp.get(k); };

      for (let ai=0; ai<dyn.length; ai++){
        const A = dyn[ai];
        const aabbA = _aabbFrom(A.x, A.y, A.w, A.h, A.rot||0);
        const near = g.query(aabbA);
        for (let bi=0; bi<near.length; bi++){
          const B = near[bi];
          if (A.id === B.id) continue;
          const key = (Math.min(A.id,B.id) << 16) | Math.max(A.id,B.id);
          if (B.type==='dyn' && seen.has(key)) continue;

          // Krockmask
          if (!shouldCollide(A, B)) continue;

          // Narrowphase
          let contact = null;
          if (B.type==='static') contact = obbObbMTV(A,B);
          else { if(B.invMass==0||A.invMass==0) contact = obbObbMTV(A,B); else contact = circleCircleMTV(A,B); }
          if (!contact || contact.depth < MIN_PEN) continue;

          // Spara normal för slide när det är roterad static
          if (B.type === 'static' && (B.rot || 0) !== 0) {
            A.ref._contactNormals.push(contact.n);
          }

          if (B.type==='dyn') seen.add(key);

          // Dela MTV
          const n = contact.n, dpth = contact.depth;
          const invA = A.invMass, invB = B.invMass, invSum = invA + invB || 1;
          const corrA = {x: -n.x * dpth * (invA/invSum), y: -n.y * dpth * (invA/invSum)};
          const corrB = {x:  n.x * dpth * (invB/invSum), y:  n.y * dpth * (invB/invSum)};
          const vA = ensure(A.ref); vA.x += corrA.x; vA.y += corrA.y;
          if (B.type==='dyn'){ const vB = ensure(B.ref); vB.x += corrB.x; vB.y += corrB.y; }

          // loggning för din logik (slide/AI)
          if (A.ref){
            A.ref.hadcollidedobj.push(B.ref || B);
            A.ref.collideslistanobj.push(B.ref || B);
            const dir = Math.abs(n.x) > Math.abs(n.y) ? (n.x>0?'left':'right') : (n.y>0?'up':'down');
            A.ref.collideslistandir.push(dir);
            A.ref.collideslistan.push(B.ref?.name || 'any');
          }
        }
      }

      // applicera iterationens förskjutningar
      if (disp.size === 0) break; // tidig brytning utan att ändra resultat
      for (let i=0;i<dyn.length;i++){
        const d = dyn[i];
        const v = disp.get(d.ref); if (!v) continue;
        d.x += v.x; d.y += v.y;
      }
    }

    let stopper=false;
    // --- Riktad slide längs roterade statics (aligna med o.direction) ---
    const gStat = gridStat; // återanvänd stat-grid
    for (let i=0;i<dyn.length;i++){
      const d = dyn[i];
      const o = d.ref;
      if (!o || !o._contactNormals || o._contactNormals.length === 0) continue;
      
      
    
      // 1) bestäm önskad riktning (o.direction kan vara vinkel eller vektor)
      let dirx=0, diry=0;
      if (typeof o.direction === 'number'){
        const r = o.direction * Math.PI/180;
        dirx = Math.cos(r); diry = Math.sin(r);
      } else if (o.direction && typeof o.direction.x === 'number'){
        const L = Math.hypot(o.direction.x, o.direction.y) || 1;
        dirx = o.direction.x/L; diry = o.direction.y/L;
      } else {
        const wx = o._wantdx||0, wy = o._wantdy||0;
        const L = Math.hypot(wx, wy) || 1;
        dirx = wx/L; diry = wy/L;
      }

      // 2) välj tangent som bäst följer riktningen
      let bestT = null, bestDot = -Infinity;
      for (let ni=0; ni<o._contactNormals.length; ni++){
        const n = o._contactNormals[ni];
        const t1 = {x:-n.y, y:n.x};
        const t2 = {x: n.y, y:-n.x};
        const d1 = t1.x*dirx + t1.y*diry;
        const d2 = t2.x*dirx + t2.y*diry;
        if (d1 > bestDot){ bestDot = d1; bestT = t1; }
        if (d2 > bestDot){ bestDot = d2; bestT = t2; }
      }
      if (!bestT || bestDot <= 0.01) { o._contactNormals.length = 0; continue; }

      // 3) KONSTANT SLIDEFART längs tangent, oberoende av "tryck in i väggen"
      const wantx = o._wantdx||0, wanty = o._wantdy||0;
      const baseSpeed = Math.hypot(wantx, wanty);
      if (baseSpeed < 0.01){ o._contactNormals.length = 0; continue; }

      // rikta sliden så att den följer o.direction (eller _want, fallback)
      const sign = (dirx*bestT.x + diry*bestT.y) >= 0 ? 1 : -1;

      // valfri ratt: skala om sliden (1.0 = samma som basfart)
      const SLIDE_SPEED_FACTOR = 1.0;

      // konstant fart längs tangent (i stället för projektion)
      const vt = baseSpeed * SLIDE_SPEED_FACTOR * sign;
      const dx = bestT.x * vt, dy = bestT.y * vt;

      // 4) testa att flytta längs tangenten utan att tränga in i statics
      const test = { x: d.x + dx, y: d.y + dy, w:d.w, h:d.h, rot:d.rot };
      const near = gStat.query(_aabbFrom(test.x, test.y, test.w, test.h, test.rot||0));
      let blocked = false;
      for (let si=0; si<near.length; si++){
        const S = near[si];
        if (obbObbMTV(test, S)) { blocked = true; break; }
      }
      if (!blocked){
        d.x = test.x; d.y = test.y;   // Apply slide i solvernivå
        
      }
      o.rakna=0; 
      o.rakna2=0;
      stopper=true;
      // rensa normals för nästa frame
      o._contactNormals.length = 0;
    }

    // 3) skriv tillbaka
    for (let i=0;i<dyn.length;i++){
      const d = dyn[i];
      const o = d.ref;
      const wantdx = (o._wantdx||0), wantdy = (o._wantdy||0);
      const corrx = (d.x - o.x) - wantdx;
      const corry = (d.y - o.y) - wantdy;
      const movedN = Math.hypot(corrx, corry);

      if(stopper===false){
        o.blocked  = movedN > 0.25;
        o.blockedx = o.blocked && Math.abs(d.x - o.x) < Math.abs(wantdx);
        o.blockedy = o.blocked && Math.abs(d.y - o.y) < Math.abs(wantdy);
      } else {
        o.blocked=false;
        o.blockedx=false;
        o.blockedy=false;
      }

      o.x = d.x; o.y = d.y;
      o.freex = o.x; o.freey = o.y;
    }
  }
};




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
        if (max1 <= min2 || max2 <= min1) {
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
function _dot(a,b){ return a.x*b.x + a.y*b.y; }
function _len(v){ return Math.hypot(v.x, v.y); }
function _norm(v){ const L=_len(v)||1; return {x:a(v.x/L), y:a(v.y/L)}; function a(n){return +n;} } // undvik NaN

function getTwoNormals(x,y,w,h,rotDeg){
  const r=(rotDeg||0)*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
  return [ _norm({x:c,y:s}), _norm({x:-s,y:c}) ];
}

function dirToVec(dir){
  if (dir==="left")  return {x:-1,y:0};
  if (dir==="right") return {x: 1,y:0};
  if (dir==="up")    return {x: 0,y:-1}; // byt till +1 om din "up" = +y
  if (dir==="down")  return {x: 0,y: 1};
  return null;
}

// Overlap-test UTAN sidoeffekter under provsteg
function overlapsNoSideEffects(game, mapIndex, o){
  const A=o.hadcollidedobj?.slice()||[];
  const L=o.collideslistan?.slice()||[];
  const D=o.collideslistandir?.slice()||[];
  const O=o.collideslistanobj?.slice()||[];
  const hit = (
    o.collideslist(game.maps, mapIndex, "left")  ||
    o.collideslist(game.maps, mapIndex, "right") ||
    o.collideslist(game.maps, mapIndex, "up")    ||
    o.collideslist(game.maps, mapIndex, "down")
  );
  o.hadcollidedobj=A; o.collideslistan=L; o.collideslistandir=D; o.collideslistanobj=O;
  return hit;
}

// Pressad mot väggen? (av sig själv eller andra)
function isPressedAgainst(game, mapIndex, o, n, want){
  if (_dot(want,n) < 0) return true; // egen rörelse trycker in
  const ox=o.x, oy=o.y;
  const over = (
    o.collideslist(game.maps, mapIndex, "left")  ||
    o.collideslist(game.maps, mapIndex, "right") ||
    o.collideslist(game.maps, mapIndex, "up")    ||
    o.collideslist(game.maps, mapIndex, "down")
  );
  o.x=ox; o.y=oy;
  if (over) return true;              // står i kontakt/penetration
  if (o.blockedx || o.blockedy) return true; // axel-block denna frame
  return false;
}

// Mjuk sweep längs given tangent (testar kollision per litet steg)
function sweepAlong(game, mapIndex, o, baseX, baseY, tx, ty, desiredLen, step){
  let traveled=0, cx=baseX, cy=baseY;
  const EPS=1e-4;
  const ox=o.x, oy=o.y;
  while (traveled + EPS < desiredLen){
    const st = Math.min(step, desiredLen - traveled);
    o.x = cx + tx*st; o.y = cy + ty*st;
    const over = overlapsNoSideEffects(game, mapIndex, o);
    if (over){
      // liten finjust-binära för sista biten
      let lo=0, hi=st;
      for (let i=0;i<4;i++){
        const mid=(lo+hi)*0.5;
        o.x = cx + tx*mid; o.y = cy + ty*mid;
        if (!overlapsNoSideEffects(game, mapIndex, o)) lo=mid; else hi=mid;
      }
      cx += tx*lo; cy += ty*lo; traveled += lo;
      break;
    }
    cx += tx*st; cy += ty*st; traveled += st;
  }
  o.x=ox; o.y=oy;
  return {x:cx, y:cy, travel:traveled};
}


"use strict";

// === Broadphase grid helpers (added) ===
function _bpKey(ix, iy){ return ix + ":" + iy; }
function _aabbOf(o){
    const w = o.dimx, h = o.dimy;
    const rot = (o.rot||0) % 360;
    if (!rot) return { x:o.x, y:o.y, w, h };
    // Use existing engine helper to compute rotated corners
    const corners = getRotatedRectangleCorners(o.x, o.y, w, h, rot);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i=0;i<corners.length;i++){
        const c = corners[i];
        if (c.x < minx) minx = c.x;
        if (c.y < miny) miny = c.y;
        if (c.x > maxx) maxx = c.x;
        if (c.y > maxy) maxy = c.y;
    }
    return { x:minx, y:miny, w:(maxx-minx), h:(maxy-miny) };
}
function _cellsFor(aabb){
    const x1 = Math.floor(aabb.x / BP_CELL);
    const y1 = Math.floor(aabb.y / BP_CELL);
    const x2 = Math.floor((aabb.x + aabb.w) / BP_CELL);
    const y2 = Math.floor((aabb.y + aabb.h) / BP_CELL);
    const out = [];
    for (let iy=y1; iy<=y2; iy++){
        for (let ix=x1; ix<=x2; ix++){
            out.push(_bpKey(ix,iy));
        }
    }
    return out;
}
// === End helpers ===

var cursorX;
var cursorY;
var game;
let counterru = 0;
var colli;
let counter;
let dragSelectStart = null;
let dragSelectEnd = null;
let lastPanX = null;
let lastPanY = null;
let dragWasActive = false;
let tapTimeout = null;
let allowSingleTap = true;

class Game5 {
    
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
            
            if (typeof window.allowSelection === "function" && !window.allowSelection()) {
                return;
            }
            let nothing=true;
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
                                var units=game.getAllObjects().filter(o => o.selected);
                               if(object.selectable&& units.length===0){
                                object.selected=true;}
                                if(object.selectable){
                                    nothing=false;
                                    let canmove=false;
                                    for(let u of units){if(u.iscontrollable)canmove=true;}
                                    if(canmove==false){for(let u of units){u.selected=false;}object.selected=true;}
                                    if(canmove==true&&object.iscontrollable){for(let u of units){u.selected=false;}object.selected=true;}
                                }
                                
                        }
                        
                        if (e.touches.length > 1) {
                            let touch1x = e.touches[1].clientX / zoomFactor;
                            let touch1y = e.touches[1].clientY / zoomFactor;
                            if (game.collideCircleWithRotatedRectangle(touch1x, touch1y, 10, calcX, calcY, Number(object.dimx), Number(object.dimy), calcRot)) {
                                object.mousepressed = true;
                                var units=game.getAllObjects().filter(o => o.selected);
                               if(object.selectable&& units.length===0){
                                object.selected=true;}
                                if(object.selectable){
                                    nothing=false;
                                    let canmove=false;
                                    for(let u of units){if(u.iscontrollable)canmove=true;}
                                    if(canmove==false){for(let u of units){u.selected=false;}object.selected=true;}
                                    if(canmove==true&&object.iscontrollable){for(let u of units){u.selected=false;}object.selected=true;}
                                }
                            }
                        }
                    }
                }
            }
            if(nothing==true){
                let canmove=false;
                var units=game.getAllObjects().filter(o => o.selected);
                for(let u of units){if(u.canMove&&u.iscontrollable)canmove=true;}
                if(canmove==false){for(let u of units){u.selected=false;}}
                
                
            }
            
            
            if (e.touches.length === 1) {
                const x = e.touches[0].clientX / zoomFactor - currentMap.camerax;
                const y = e.touches[0].clientY / zoomFactor - currentMap.cameray;
                dragSelectStart = { x, y };
                dragSelectEnd = null;
            }
            if (e.touches.length === 2) {
                lastPanX = e.touches[0].clientX;
                lastPanY = e.touches[0].clientY;
            }
            if (e.touches.length === 1) {
                allowSingleTap = true;

                // Vänta 150ms för att se om ett andra finger läggs till
                tapTimeout = setTimeout(() => {
                    tapTimeout = null;
                }, 150);
            } else {
                allowSingleTap = false;

                // Andra fingret kom – avbryt eventuell förflyttning
                if (tapTimeout !== null) {
                    clearTimeout(tapTimeout);
                    tapTimeout = null;
                }
            }
            
            
        });
        canvas.addEventListener("touchmove", function(e) {
            if (e.touches.length === 1 && dragSelectStart) {
                const currentMap = game.maps[game.currentmap];
                const zoomFactor = 1 + (1 * currentMap.zoom / 100);
                const x = e.touches[0].clientX / zoomFactor - currentMap.camerax;
                const y = e.touches[0].clientY / zoomFactor - currentMap.cameray;
                dragSelectEnd = { x, y };
                dragWasActive = true;
            }
            if (e.touches.length === 2 && lastPanX !== null && lastPanY !== null) {
                const currentMap = game.maps[game.currentmap];

                const deltaX = e.touches[0].clientX - lastPanX;
                const deltaY = e.touches[0].clientY - lastPanY;

                currentMap.camerax += deltaX;
                currentMap.cameray += deltaY;

                lastPanX = e.touches[0].clientX;
                lastPanY = e.touches[0].clientY;

                e.preventDefault(); // förhindra att sidan scrollar
            }
        });
        canvas.addEventListener("touchend", function(e) {
            e.preventDefault();
            if (typeof window.allowSelection === "function" && !window.allowSelection()) {
                return;
            }
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
                const selectedstuff = game.getAllObjects().filter(o => o.selected);
                const movableSelected = selectedstuff.filter(o => o.canMove);
                if (movableSelected.length > 0) {
                    for (let w of selectedstuff) {
                        if (!w.canMove) w.selected = false;
                    }
                }
            }
            dragSelectStart = null;
            dragSelectEnd = null;
            
            
            
            if (e.changedTouches.length === 1 && !dragWasActive&&allowSingleTap) {
                const currentMap = game.maps[game.currentmap];
                const zoomFactor = 1 + (1 * currentMap.zoom / 100);
                const x = e.changedTouches[0].clientX / zoomFactor - currentMap.camerax;
                const y = e.changedTouches[0].clientY / zoomFactor - currentMap.cameray;

                var units=game.getAllObjects().filter(o => o.selected && o.canMove&&o.iscontrollable);
                
                
                game.issueFormationMove(units, x, y);
            }
            if (e.touches.length < 2) {
                lastPanX = null;
                lastPanY = null;
            }
            
            dragWasActive = false;
            
        });
        
        canvas.addEventListener("mousedown", function(e) {
            e.preventDefault();
            
            if (typeof window.allowSelection === "function" && !window.allowSelection()) {
                return;
            }
            
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
                var units=game.getAllObjects().filter(o => o.selected && o.canMove&&o.iscontrollable);
                
                
                game.issueFormationMove(units, mouseX - currentMap.camerax, mouseY - currentMap.cameray);
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
                const selectedstuff = game.getAllObjects().filter(o => o.selected);
                const movableSelected = selectedstuff.filter(o => o.canMove);
                if (movableSelected.length > 0) {
                    for (let w of selectedstuff) {
                        if (!w.canMove) w.selected = false;
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
                        game.getlastObjecttype().objects.push(new Objectx(Number(lines[i + 1]), Number(lines[i + 2]), Number(lines[i + 3]), Number(lines[i + 4]), Number(lines[i + 5]), JSON.parse(lines[i + 6])));
                        i = i + 6;
                        game.getlastobject().name=game.getlastObjecttype().name;
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
     //   try {
            Prof.section("Collision", ()=> {
            this.updateUnitMovement();
            this.collitionengine();
              });
            
            
            
            
        
        Prof.section("Draw", ()=> {
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
        
        updateAndDrawFX(ctx);
         });
        
      //  } catch (error) {}
    }
    collitionengine() {


    // 2. Beräkna rakna
    for (let i2 = 0; i2 < this.maps[this.currentmap].layer.length; i2++) {
        for (let i3 = 0; i3 < this.maps[this.currentmap].layer[i2].objectype.length; i3++) {
            for (let o of this.maps[this.currentmap].layer[i2].objectype[i3].objects) {
                if (this.maps[this.currentmap].layer[i2].fysics == false || this.maps[this.currentmap].layer[i2].solid) {
                    o.rakna = 0;
                    o.rakna2 = 0;
                } else if (this.maps[this.currentmap].layer[i2].ghost == true || o.ghost == true) {
                    o.rakna = 0;
                    o.rakna2 = 0;
                    o.collideslist(this.maps, this.currentmap, "ghost");
                } else {
                    o.rakna = o.x - o.freex;
                    o.rakna2 = o.y - o.freey;
                    o._wantdx = o.rakna;   // <--- NYTT
                    o._wantdy = o.rakna2;  // <--- NYTT
                    o.x = o.freex;
                    o.y = o.freey;
                }
                if (o.rakna !== 0 || o.rakna2 !== 0){ o.hadcollidedobj.length = 0;}
                o.collideslistan.length = 0;
                o.collideslistandir.length = 0;
                o.collideslistanobj.length = 0;
            }
        }
    }

    // 3. Kör förflyttning + subpixlar
    SimSolver.step(this);
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
                return obj.collideslistanobj[i];
            else if (obj.collideslistan[i] == name)
                return obj.collideslistanobj[i];
        }
        return null;
    }
    
    collideswith(obj, name, dir) {
        for (let i = 0; i < obj.collideslistan.length; i++) {
            if(dir=="any"){
                if (name == "any") {
                    return obj.collideslistanobj[i];
                }
                else if (obj.collideslistan[i] == name)
                    return obj.collideslistanobj[i];
            }
            else{
                if (name == "any") {
                    if (obj.collideslistandir[i] == dir)
                        return obj.collideslistanobj[i];
                }
                else if (obj.collideslistan[i] == name && obj.collideslistandir[i] == dir)
                    return obj.collideslistanobj[i];
            }
        }
        return null;
    }
    collideswithanoterobject(obj, obj2) {
        for (let i = 0; i < obj.collideslistanobj.length; i++) {
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
        objtype.objects.push(new Objectx(x, y, dimx, dimy, rot, fliped));
        objtype.objects[objtype.objects.length-1].name=objtype.name;
        return objtype.objects[objtype.objects.length-1];
    }
    removeobject(objtype, obj) {
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
    updateUnitMovement() {
        const objects = this.getAllObjects();

        for (let obj of objects) {
            if (obj.targetX !== null && obj.targetY !== null) {

                let go=false;
                if(obj.pretargetX!==obj.targetX||obj.pretargetY!==obj.targetY){go=true;}
                
                obj.pretargetX=obj.targetX;
                obj.pretargetY=obj.targetY;

                const dx = obj.targetX - obj.x;
                const dy = obj.targetY - obj.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                 obj.y += ((dy / dist) * obj.speed);
                 obj.x += ((dx / dist) * obj.speed);

                 if (dist > 1){
                    if (Math.abs(dx) > Math.abs(dy)) {
                        if(go==true)obj.direction = dx > 0 ? "right" : "left";
                        if(!obj.blockedx||go)obj.directiony=dy > 0 ? "down" : "up";
                        if(!obj.blockedy||go)obj.directionx=dx > 0 ? "right" : "left";
                    } else {
                        if(go==true)obj.direction = dy > 0 ? "down" : "up";
                        if(!obj.blockedy||go)obj.directionx=dx > 0 ? "right" : "left";
                        if(!obj.blockedx||go)obj.directiony=dy > 0 ? "down" : "up";
                    }
                }


                    
    
                
                
                
                
                let stop=false; 
                for (let c of obj.collideslistanobj) {


                   if ((obj.targetObject && c == obj.targetObject)){ obj.blocked=false;obj.blocked1=0;stop=true;} // Ignorera target
                   if(obj.workobject&&c==obj.workobject){ obj.blocked=false;obj.blocked1=0;stop=true;} 
                   if(obj.deliveryTarget&&c==obj.deliveryTarget){obj.blocked=false;obj.blocked1=0;stop=true;}
                }

                //väj åt sidan

                if(stop==false&&obj.blocked){
                        obj.blockedcounter++;
                        
                        
                    //    if((obj.blockedx==true&&obj.blockedy==false)||(obj.blockedy==true&&obj.blockedx==false)){
                            
                            if(obj.blockedcounter==175){if(Math.floor(Math.random() * 2)==0){if(obj.direction=="left")obj.direction="right";else if(obj.direction=="right")obj.direction="left";else if(obj.direction=="down")obj.direction="up";else if(obj.direction=="up")obj.direction="down";}}
                            if(obj.blockedcounter==350){if(Math.floor(Math.random() * 2)==0){if(obj.direction=="left")obj.direction="right";else if(obj.direction=="right")obj.direction="left";else if(obj.direction=="down")obj.direction="up";else if(obj.direction=="up")obj.direction="down";}}
                        
                            
                            if(obj.direction=="left"){if(obj.directiony=="up"){obj.y += obj.rakna;}if(obj.directiony=="down"){obj.y -= obj.rakna;}}
                            if(obj.direction=="right"){if(obj.directiony=="up"){obj.y -= obj.rakna;}if(obj.directiony=="down"){obj.y += obj.rakna;}}
                            if(obj.direction=="up"){if(obj.directionx=="left"){obj.x += obj.rakna2;}if(obj.directionx=="right"){obj.x -= obj.rakna2;}}
                            if(obj.direction=="down"){if(obj.directionx=="left"){obj.x -= obj.rakna2;}if(obj.directionx=="right"){obj.x += obj.rakna2;}}
                        //}
                        

                        
                        if(obj.blockedcounter>525){
                            obj.blockedcounter=0;
                            
                            
                        }

                }
                else{obj.blockedcounter=0;
                    if (dist > 1){
                    if (Math.abs(dx) > Math.abs(dy)) {
                        obj.direction = dx > 0 ? "right" : "left";
                    } else {
                        obj.direction = dy > 0 ? "down" : "up";

                    }
                }
                
                
                }



            } else {
                obj.targetX = null;
                obj.targetY = null;
            }
            
        }
    }
    isPathClear(worker) {
    const dx = worker.targetX - worker.x;
    const dy = worker.targetY - worker.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const steps = Math.ceil(dist / worker.speed); // antal små steg
    const stepX = dx / steps;
    const stepY = dy / steps;

    let buffx = worker.x;
    let buffy = worker.y;

    for (let i = 0; i < 1; i++) {
        buffx += stepX;
        buffy += stepY;

        const oldX = worker.x;
        const oldY = worker.y;
        worker.x = buffx;
        worker.y = buffy;

        if (worker.collidestest()) {
            worker.x = oldX;
            worker.y = oldY;
            return false;
        }

        worker.x = oldX;
        worker.y = oldY;
    }
    return true;
}
    
    issueFormationMove(units, targetX, targetY, spacing = 50) {
    if (units.length === 0) return;

    const cols = Math.ceil(Math.sqrt(units.length));
    const rows = Math.ceil(units.length / cols);

    const startX = targetX - ((cols - 1) * spacing) / 2;
    const startY = targetY - ((rows - 1) * spacing) / 2;

    // Beräkna medelpunkt för enheterna
    let avgX = 0, avgY = 0;
    for (let u of units) {
        avgX += u.x;
        avgY += u.y;
    }
    avgX /= units.length;
    avgY /= units.length;

    // Färdriktning (vektor från medelpunkt → mål)
    const dirX = targetX - avgX;
    const dirY = targetY - avgY;
    const dirLength = Math.sqrt(dirX * dirX + dirY * dirY);
    const normX = dirX / dirLength;
    const normY = dirY / dirLength;

    // Skapa positionsmatris
    const positions = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (positions.length >= units.length) break;
            positions.push({
                x: startX + col * spacing,
                y: startY + row * spacing
            });
        }
    }

    // Sortera enheter baserat på projicerat avstånd i färdriktningen (längst bort först)
    const sortedUnits = [...units].sort((a, b) => {
    const da = (targetX - a.x) * normX + (targetY - a.y) * normY;
    const db = (targetX - b.x) * normX + (targetY - b.y) * normY;
    return db - da; // längst bak först
});

    // Sortera positioner baserat på riktning (närmast i färdriktning först)
    const sortedPositions = [...positions].sort((a, b) => {
        const da = (a.x - targetX) * normX + (a.y - targetY) * normY;
        const db = (b.x - targetX) * normX + (b.y - targetY) * normY;
        return da - db; // närmast först
    });

    // Tilldela positioner
    for (let i = 0; i < sortedUnits.length; i++) {
        const unit = sortedUnits[i];
        const pos = sortedPositions[i];
        unit.targetX = pos.x;
        unit.targetY = pos.y;
        unit.targetObject = null;
        unit.path = null;
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
    getAllObjectsoftype(objtype){
        
        const list = [];


                    list.push(...objtype.objects);


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
        const scale = 1 + (zoom / 100);
        const viewW = ctx.canvas.width  / scale;
        const viewH = ctx.canvas.height / scale;
        const viewL = -camerax;  // vy-rektangel i världsenheter
        const viewT = -cameray;

        // små helpers
        const toNum = (v, d=0) => (typeof v === "number" ? v : (v!=null ? Number(v) : d)) || d;
        const toRad = (aLike) => {
          let a = toNum(aLike, 0);
          if (Math.abs(a) > Math.PI*2) a *= Math.PI/180; // grader -> rad
          return a;
        };

        for (let i = 0; i < this.objects.length; i++) {
          const o = this.objects[i];
          o.isonscreen = false;

          // bild?
          const img = this.images?.[o.animation]?.getimage?.();
          if (!img) continue;

          // storlek & mitt
          const w  = toNum(o.dimx, 0);
          const h  = toNum(o.dimy, 0);
          const cx = o.x + w/2;
          const cy = o.y + h/2;

          // rotation (stöd string/deg)
          const rad = toRad(o.rot ?? o.rotation ?? o.angle ?? 0);
          const c = Math.cos(rad), s = Math.sin(rad);

          // roterad AABB-extents
          const ax = Math.abs(c)*w/2 + Math.abs(s)*h/2;
          const ay = Math.abs(s)*w/2 + Math.abs(c)*h/2;

          const objL = cx - ax, objT = cy - ay, objR = cx + ax, objB = cy + ay;

          // snabb culling mot viewport i världsenheter
          if (objR < viewL || objL > viewL + viewW || objB < viewT || objT > viewT + viewH) {
            continue; // helt utanför, rita inte
          }

          // on-screen
          o.isonscreen = true;

          // valfri: selektionsring innan spriten
          try { drawSelectRing(ctx, o, zoom, camerax, cameray); } catch(e){}

          // ===== RITA SPRITE =====
          ctx.save();
          ctx.scale(scale, scale);
          // flytta till objektets center i skärm-koordinater
          ctx.translate(camerax + cx, cameray + cy);
          ctx.rotate(rad);
          if (o.fliped === true) ctx.scale(-1, 1);
          // rita bilden centrerad
          ctx.drawImage(img, -w/2, -h/2, w, h);
          ctx.restore();

          // ===== (valfritt) markeringsram när selected =====
          if (o.selected) {
            ctx.save();
            ctx.scale(scale, scale);
            // rita AABB för den roterade spriten (matchar culling)
            ctx.lineWidth = 4;
            ctx.strokeStyle = "#00ff00";
            ctx.strokeRect(camerax + (cx - ax), cameray + (cy - ay), ax*2, ay*2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "black";
            ctx.strokeRect(camerax + (cx - ax), cameray + (cy - ay), ax*2, ay*2);
            ctx.restore();
          }

          // ===== ghost-byggen (oförändrat, men du kan rotera om du vill) =====
          if (o.ghost && o.name !== "tree") {
            let valid = true;
            try { if (typeof window.isBuildPlacementValid === "function") valid = !!window.isBuildPlacementValid(o); } catch(e){}
            ctx.save();
            ctx.scale(scale, scale);
            ctx.strokeStyle = valid ? "lime" : "red";
            ctx.lineWidth = 2;
            // vill du att rutan ska matcha rotationen exakt kan du använda samma transform som för spriten
            ctx.strokeRect(camerax + o.x, cameray + o.y, w, h);
            ctx.restore();
          }
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

class Objectx {
    constructor(x, y, dimx, dimy, rot, fliped) {
        this.name=name;
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
        this._contactNormals=[];
        this.rakna = 0;
        this.rakna2 = 0;
        this.animation = 0;
        this.fliped = fliped;
        this.mousepressed = false;
        this.ghost = false;
        this.health = 100;
        this.maxhealth = null;
        this.counter = 0;
        this.counter2 = 0;
        this.counter3 = 0;
        this.counter4 = 0;
        this.counter5 = 0;
        this.isonscreen=false;
        this.selected = false;
        this.targetX = null;
        this.targetY = null;
        this.pretargetX=null;
        this.pretargetY=null;
        
        this.speed = 1.25;
        this.selectable = false;
        this.direction = "up";
        this.canMove = true;
        this.buildProgress=0;
        this.workobject=null;
        this.buildobject=null;
        this.deliveryTarget=null;
        this.returning=false;
        this.blocked=false;
        this.blocked1=0;
        this.targetObject=null;
        this.occupied=false;
        this.blockedcounter=0;
        this.buildQueue=null;
        this.buildTimer=0;
        this.directionx="left";
        this.directiony="up";
        this.lockDirection=false;
        this.aiHoldTarget=false;
        this.followTarget=false;
        this.iscontrollable=false;
        this._prevHP=null;
        this._slowUntilMs=null;
        this._ax =null;
        this._ay =null;
        this.blockedx=false;
        this.blockedy=false;
        this.resty=0;
        this.restx=0;
        this._wantdx=0;
        this._wantdy=0;
    }
    collidestest(){


        // 2) Fallback till ursprunglig O(N)-svep (oförändrad logik)
        for (let i2 = 0; i2 < game.maps[game.currentmap].layer.length; i2++) {
          let layer = game.maps[game.currentmap].layer[i2];
          for (let i3 = 0; i3 < layer.objectype.length; i3++) {
            let objType = layer.objectype[i3];
            for (let i4 = 0; i4 < objType.objects.length; i4++) {
              const o = objType.objects[i4];
              if (o === this || layer.fysics == false) continue;

              if (o.rot == 0 && this.rot == 0) {
                if (this.collideswithfast(o)) {
                  if (layer.ghost == true || o.ghost == true) { /* ignorera ghost */ }
                  else { return true; }
                }
              } else {
                if (this.collideswith(o)) {
                  if (layer.ghost == true || o.ghost == true) { /* ignorera ghost */ }
                  else { return true; }
                }
              }
            }
          }
        }
        return false;
    }
    
    
    
    
    
    collideslist(maps, currentmap, dir) {
       
        // Fallback to original O(N) sweep if grid missing

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
                                    for(var u of this.collideslistanobj){if(u===objType.objects[i4])return false;}
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    this.hadcollidedobj.push(objType.objects[i4]);
                                    
                                    objType.objects[i4].collideslistan.push(this.name);
                                    objType.objects[i4].collideslistandir.push("ghost");
                                    objType.objects[i4].collideslistanobj.push(this);
                                    objType.objects[i4].hadcollidedobj.push(this);
                                    
                                }
                                else {
                                    for(var u of this.collideslistanobj){if(u===objType.objects[i4])return true;}
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    this.hadcollidedobj.push(objType.objects[i4]);
                                    
                     
                                    objType.objects[i4].collideslistan.push(this.name);
                                    if(dir=="up")objType.objects[i4].collideslistandir.push("down");
                                    else if(dir=="down")objType.objects[i4].collideslistandir.push("up");
                                    else if(dir=="left")objType.objects[i4].collideslistandir.push("right");
                                    else if(dir=="right")objType.objects[i4].collideslistandir.push("left");
                                    objType.objects[i4].collideslistanobj.push(this);
                                    objType.objects[i4].hadcollidedobj.push(this);
                                    
                                    
                                    return true;
                                }
                            }
                        }
                        else {
                            
                            const rsum = 0.5*Math.hypot(this.dimx||0, this.dimy||0) + 0.5*Math.hypot(objType.objects[i4].dimx||0, objType.objects[i4].dimy||0);
                            const dx = (objType.objects[i4].x + (objType.objects[i4].dimx||0)*0.5) - (this.x + (this.dimx||0)*0.5);
                            const dy = (objType.objects[i4].y + (objType.objects[i4].dimy||0)*0.5) - (this.y + (this.dimy||0)*0.5);
                            if ((dx*dx + dy*dy) > (rsum*rsum)) continue;
                            
                            if (this.collideswith(objType.objects[i4])) {
                                if (maps[currentmap].layer[i2].ghost == true || objType.objects[i4].ghost == true) {
                                    for(var u of this.collideslistanobj){if(u===objType.objects[i4])return false;}
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push("ghost");
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    this.hadcollidedobj.push(objType.objects[i4]);
                                    
                                    objType.objects[i4].collideslistan.push(this.name);
                                    objType.objects[i4].collideslistandir.push("ghost");
                                    objType.objects[i4].collideslistanobj.push(this);
                                    objType.objects[i4].hadcollidedobj.push(this);
                                    
                                }
                                else {
                                    for(var u of this.collideslistanobj){if(u===objType.objects[i4])return true;}
                                    this.collideslistan.push(objType.name);
                                    this.collideslistandir.push(dir);
                                    this.collideslistanobj.push(objType.objects[i4]);
                                    this.hadcollidedobj.push(objType.objects[i4]);
                                    
                                    objType.objects[i4].collideslistan.push(this.name);
                                    if(dir=="up")objType.objects[i4].collideslistandir.push("down");
                                    else if(dir=="down")objType.objects[i4].collideslistandir.push("up");
                                    else if(dir=="left")objType.objects[i4].collideslistandir.push("right");
                                    else if(dir=="right")objType.objects[i4].collideslistandir.push("left");
                                    objType.objects[i4].collideslistanobj.push(this);
                                    objType.objects[i4].hadcollidedobj.push(this);
                                    
                                    
                                    
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
        if (!(this.x >= obj.x + obj.dimx ||
            this.x + this.dimx <= obj.x ||
            this.y >= obj.y + obj.dimy ||
            this.y + this.dimy <= obj.y)) {
          return true;
      }
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


const FX = {
  dmg: [],   // {x,y,vy,life,alpha,text,color,scale}
  hit: [],   // {x,y,vx,vy,life,alpha,size}
  pushDmg(d) { this.dmg.push(d); if (this.dmg.length > 200) this.dmg.shift(); },
  pushHit(h) { this.hit.push(h); if (this.hit.length > 300) this.hit.shift(); }
};

// world → screen (matchar hur du redan räknar zoom/camera)
function worldToScreen(wx, wy) {
  const m = game.maps[game.currentmap];
  const zoom = 1 + (1 * m.zoom / 100);
  return { x: (wx + m.camerax) * zoom, y: (wy + m.cameray) * zoom, zoom };
}

// Spawna ett “100” som flyter upp och bleknar
function spawnDamageNumber(amount, wx, wy, opts = {}) {
  const color = opts.color || (amount >= 0 ? "#ff4d4d" : "#4dff4d"); // heal = grön
  const scale = opts.scale || 1;
  FX.pushDmg({
    x: wx, y: wy, vy: -0.25, life: 650, alpha: 1,
    text: (amount >= 0 ? "-" : "+") + Math.abs(amount),
    color, scale
  });
}

// Spawna en liten “hit puff” (flera partiklar)
function spawnHitParticles(wx, wy, count = 6) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 0.8 + Math.random() * 0.6;
    FX.pushHit({
      x: wx, y: wy,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 0.3,
      life: 350 + Math.random() * 200,
      alpha: 1,
      size: 2 + Math.random() * 3
    });
  }
}

// Uppdatera + rita (kalla från din game-loop)
function updateAndDrawFX(ctx) {
  const now = Date.now();
  // === Update ===
  // Damage numbers
  for (let i = FX.dmg.length - 1; i >= 0; i--) {
    const d = FX.dmg[i];
    const dt = 16; // approx per frame
    d.life -= dt;
    d.y += d.vy;
    d.vy -= 0.005;                           // lite easing uppåt
    d.alpha = Math.max(0, d.life / 650);     // fade
    if (d.life <= 0) FX.dmg.splice(i, 1);
  }
  // Hit particles
  for (let i = FX.hit.length - 1; i >= 0; i--) {
    const p = FX.hit[i];
    const dt = 16;
    p.life -= dt;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.02;                            // “gravity”
    p.alpha = Math.max(0, p.life / 400);     // fade
    if (p.life <= 0) FX.hit.splice(i, 1);
  }

  // === Draw ===
  // slå av antialias för skarpare text på små tal, valfritt
  ctx.save();
  // Partiklar först
  for (const p of FX.hit) {
    const s = worldToScreen(p.x, p.y);
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.size * s.zoom * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = "#ffcc66"; // låt bli att styla per-partikel för prestanda
    ctx.fill();
  }
  // Damage numbers överst
  for (const d of FX.dmg) {
    const s = worldToScreen(d.x, d.y);
    ctx.globalAlpha = d.alpha;
    ctx.font = `${Math.round(16 * d.scale * s.zoom)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 3;
    ctx.strokeText(d.text, s.x, s.y);
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, s.x, s.y);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}


function drawSelectRing(ctx, o,zoom, camX, camY){
    
    const isBuilding =
    o.name === "base" || o.name === "bar" || o.name === "rbase" || o.name === "rbar"|| o.name === "goldmine"|| o.name === "house"|| o.name === "rhouse";

  // Alltid-på, subtil "ground contact" för byggnader (så de inte ser svävande ut)
  if (isBuilding) {
    const cx=o.x+o.dimx/2, cy=o.y+o.dimy*0.75;
    ctx.save(); ctx.globalAlpha=0.6;
    ctx.scale(1 + (1 * zoom / 100), 1 + (1 * zoom / 100));
    ctx.beginPath(); ctx.ellipse(cx+camX, cy+camY, o.dimx*0.45, o.dimy*0.35, 0, 0, Math.PI*2);
    ctx.fillStyle="rgba(0,0,0,.9)"; ctx.fill(); ctx.restore();
  }  
  else if(o.selectable){  
    
    
    
    
  const cx=o.x+o.dimx/2, cy=o.y+o.dimy*0.95;
  ctx.save(); ctx.globalAlpha=0.6;
  ctx.scale(1 + (1 * zoom / 100), 1 + (1 * zoom / 100));
  ctx.beginPath(); ctx.ellipse(cx+camX, cy+camY, o.dimx*0.45, o.dimy*0.15, 0, 0, Math.PI*2);
  ctx.fillStyle="rgba(0,0,0,.9)"; ctx.fill(); ctx.restore();
  }
}