// Current Three.js addons are ES modules. Expose the required APIs before
// loading MaxPaint3DV3's existing classic scripts in their original order.
const THREE_VERSION = "0.186.0";
const threeUrl = `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`;
const addonsUrl = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/`;

const [three, { OBJLoader }, { MTLLoader }, { GLTFExporter }, { mergeGeometries }] = await Promise.all([
    import(threeUrl),
    import(`${addonsUrl}loaders/OBJLoader.js`),
    import(`${addonsUrl}loaders/MTLLoader.js`),
    import(`${addonsUrl}exporters/GLTFExporter.js`),
    import(`${addonsUrl}utils/BufferGeometryUtils.js`)
]);

window.THREE = { ...three, OBJLoader, MTLLoader, GLTFExporter, mergeGeometries };

function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

for (const script of document.querySelectorAll("script[data-classic-src]")) {
    await loadClassicScript(script.dataset.classicSrc);
}

const startup = document.querySelector("script[data-startup]");
if (startup) {
    const script = document.createElement("script");
    script.textContent = startup.textContent;
    document.body.appendChild(script);
}
