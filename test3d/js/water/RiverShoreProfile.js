// Small, smooth bank offsets in metres. Seeded by persisted body id and path
// distance, independent of frame time, terrain LOD and runtime randomness.
export function applyRiverShoreProfile(samples, id) {
  let hash = 2166136261;
  for (let i=0;i<id.length;i++) hash=Math.imul(hash^id.charCodeAt(i),16777619);
  const phase=(hash>>>0)/4294967296*Math.PI*2;
  for (const p of samples) {
    const half=p.width*.5, amplitude=Math.min(1.25,half*.055);
    p.leftWidth=half+amplitude*(.65*Math.sin(p.distance/17+phase)+.35*Math.sin(p.distance/41+phase*1.7));
    p.rightWidth=half+amplitude*(.65*Math.sin(p.distance/23+phase+1.9)+.35*Math.sin(p.distance/47-phase));
    p.width=p.leftWidth+p.rightWidth;
  }
}
