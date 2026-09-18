// Three.js addons are ES modules in current releases. The game/editor remain
// classic scripts, so expose the modern module APIs before loading them.
const THREE_VERSION = "0.186.0";
const threeUrl = `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`;
const addonsUrl = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/`;

const [three, { GLTFLoader }, { GLTFExporter }] = await Promise.all([
    import(threeUrl),
    import(`${addonsUrl}loaders/GLTFLoader.js`),
    import(`${addonsUrl}exporters/GLTFExporter.js`)
]);

window.THREE = { ...three, GLTFLoader, GLTFExporter };

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
