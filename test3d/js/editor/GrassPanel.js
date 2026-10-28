export class GrassPanel {
  constructor(root, grass, materialData, { onEdit }) {
    Object.assign(this, { root, grass });
    this.inputs = new Map();
    const add = (title, key, type, min, max, step, parent=root) => {
      const label = document.createElement("label");
      const name = document.createElement("span"); name.textContent = title;
      const input = document.createElement("input"); input.type=type; input.dataset.grass=key;
      input.setAttribute("aria-label",title);
      if (min!==undefined) { input.min=min; input.max=max; input.step=step; }
      label.append(name,input); parent.append(label); this.inputs.set(key,input);
      input.addEventListener("change",()=>{
        if (!input.checkValidity()) { input.reportValidity(); this.render(); return; }
        const value=type==="checkbox"?input.checked:type==="color"?input.value:Number(input.value);
        const flowerCoverage=key.startsWith("flowerCoverage");
        const coverageKey=flowerCoverage?"flowerMaterialCoverage":"materialCoverage";
        const index=flowerCoverage?Number(key.slice(14)):Number(key.slice(8));
        const patch=flowerCoverage || key.startsWith("coverage") ? { [coverageKey]:grass.settings[coverageKey].map((n,i)=>i===index?value:n) } : { [key]:value };
        onEdit(patch); this.render();
      });
      return name;
    };
    add("Enable grass","enabled","checkbox");
    add("Tufts per m²","density","number",0,2,.05);
    add("Near distance (m)","nearDistance","number",4,80,1);
    add("Density fade starts (m)","farDistance","number",8,180,1);
    add("Maximum distance (m)","maxDistance","number",12,250,1);
    add("LOD overlap (m)","transition","number",1,16,1);
    const label=document.createElement("label"); label.textContent="Cell size";
    const select=document.createElement("select"); select.dataset.grass="cellSize"; select.setAttribute("aria-label","Grass cell size");
    for (const size of [32,16]) { const option=document.createElement("option"); option.value=size; option.textContent=`${size} m`; select.append(option); }
    label.append(select); root.append(label); this.inputs.set("cellSize",select);
    select.addEventListener("change",()=>{ onEdit({cellSize:Number(select.value)}); this.render(); });
    add("Grass scale","scale","number",.05,2,.01);
    add("Random variation","variation","range",0,1,.05);
    add("Wind strength","windStrength","range",0,3,.05);
    add("Wind speed","windSpeed","range",0,4,.05);
    add("Root color","baseColor","color"); add("Tip color","tipColor","color");
    add("World vegetation seed","seed","number",0,4294967295,1);
    add("Maximum slope (degrees)","maxSlope","number",0,60,1);
    const title=document.createElement("h3"); title.className="inspector-title"; title.textContent="Material coverage"; root.append(title);
    add("Unpainted ground","baseCoverage","range",0,1,.05);
    this.coverageNames=materialData.materials.map((m,i)=>add(m.name,`coverage${i}`,"range",0,1,.05));
    const flowerPanel=document.createElement("details"),flowerTitle=document.createElement("summary");
    flowerPanel.className="material-panel";flowerTitle.className="inspector-title";flowerTitle.textContent="Meadow flowers";
    flowerPanel.append(flowerTitle);root.append(flowerPanel);
    add("Enable flowers","flowersEnabled","checkbox",undefined,undefined,undefined,flowerPanel);
    add("Flowers per m²","flowerDensity","number",0,.25,.001,flowerPanel);
    add("Flower scale","flowerScale","number",.1,3,.05,flowerPanel);
    add("Flower size variation","flowerVariation","range",0,1,.05,flowerPanel);
    add("Flower draw distance (m)","flowerDistance","number",4,250,1,flowerPanel);
    add("Flowers on unpainted ground","flowerBaseCoverage","range",0,1,.05,flowerPanel);
    this.flowerCoverageNames=materialData.materials.map((m,i)=>add(`Flowers · ${m.name}`,`flowerCoverage${i}`,"range",0,1,.05,flowerPanel));
    const flowerHelp=document.createElement("p");flowerHelp.textContent="Yellow, purple and white blooms share grass wind and terrain placement. Flower coverage is separate; keep paths at zero to exclude flowers.";flowerPanel.append(flowerHelp);
    const debugLabel=document.createElement("label"); debugLabel.className="sky-cycle"; debugLabel.textContent="Grass performance statistics";
    const debug=document.createElement("input"); debug.type="checkbox"; debug.checked=grass.diagnostics;
    debug.addEventListener("change",()=>{ grass.diagnostics=debug.checked; }); debugLabel.append(debug); root.append(debugLabel);
    const help=document.createElement("p"); help.textContent="Zero excludes grass from that painted material, including blended paths. Higher values control density. Grass is regenerated from the seed; individual tufts are never saved."; root.append(help);
    this.unsubscribe=materialData.onChanged(event=>{ if (event.type==="palette") materialData.materials.forEach((m,i)=>{ this.coverageNames[i].textContent=m.name;this.flowerCoverageNames[i].textContent=`Flowers · ${m.name}`; }); });
    this.render();
  }
  render() {
    const s=this.grass.settings;
    for (const [key,input] of this.inputs) {
      const value=key.startsWith("flowerCoverage")?s.flowerMaterialCoverage[Number(key.slice(14))]:key.startsWith("coverage")?s.materialCoverage[Number(key.slice(8))]:s[key];
      if (input.type==="checkbox") input.checked=value; else input.value=value;
    }
  }
  dispose() { this.unsubscribe(); }
}
