import * as THREE from "three";

// A single camera-following sphere with a procedural day/night shader.
// It stays one draw call regardless of map size and needs no image assets.
export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.defaultBackground = scene.background?.clone?.() ?? new THREE.Color(0x8fb3d9);
    this.mode = "day";
    this.dome = this.createDome();
    this.scene.add(this.dome);
    this.captureSize = new THREE.Vector2();
    this.savedViewport = new THREE.Vector4();
    this.savedScissor = new THREE.Vector4();
    this.updateSunDirection(this.findDirectionalLight());
    this.backgroundTarget = new THREE.WebGLRenderTarget(256, 128, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    this.skyScene = new THREE.Scene();
    // The visible dome stays in the main scene; this clone shares its exact
    // shader and material for the background render texture.
    this.captureDome = new THREE.Mesh(this.dome.geometry, this.dome.material);
    this.skyScene.add(this.captureDome);
  }
  apply(config) { this.setMode(config?.mode); }
  setMode(mode) {
    this.mode = mode === "night" ? "night" : "day";
    this.setEnvironment({
      nightAmount: this.mode === "night" ? 1 : 0,
      starVisibility: this.mode === "night" ? 1 : 0,
      sunVisibility: this.mode === "night" ? 0 : 1,
      moonVisibility: this.mode === "night" ? 1 : 0,
      fogColor: new THREE.Color(this.mode === "night" ? 0x091125 : 0x9ec9f2)
    });
  }
  setEnvironment({ nightAmount, starVisibility, sunVisibility, moonVisibility, sunDirection, moonDirection, fogColor }) {
    const uniforms = this.dome.material.uniforms;
    if (nightAmount !== undefined) uniforms.uNight.value = THREE.MathUtils.clamp(nightAmount, 0, 1);
    if (starVisibility !== undefined) uniforms.uStarVisibility.value = THREE.MathUtils.clamp(starVisibility, 0, 1);
    if (sunVisibility !== undefined) uniforms.uSunVisibility.value = THREE.MathUtils.clamp(sunVisibility, 0, 1);
    if (moonVisibility !== undefined) uniforms.uMoonVisibility.value = THREE.MathUtils.clamp(moonVisibility, 0, 1);
    if (sunDirection) uniforms.uSunDirection.value.copy(sunDirection).normalize();
    if (moonDirection) uniforms.uMoonDirection.value.copy(moonDirection).normalize();
    // Built-in Three.js fog uses this colour. Matching it to the shader's
    // horizon lets every fog-enabled material disappear into the sky.
    if (fogColor) this.scene.fog?.color.copy(fogColor);
    this.scene.background = this.defaultBackground;
  }

  // The CatAdventure fade shader, fed by a live low-resolution render of this
  // procedural sky. It samples the exact background colour at the fragment's
  // screen UV instead of approximating a sky gradient in every material.
resizeBackgroundTarget(width, height) {
    const w = 256;
    const h = Math.max(
        1,
        Math.round(w * height / width)
    );

    if (this.backgroundTarget.width !== w || this.backgroundTarget.height !== h) this.backgroundTarget.setSize(w, h);
}
renderBackground(renderer, camera) {

    renderer.getDrawingBufferSize(this.captureSize);

    this.resizeBackgroundTarget(
        this.captureSize.x,
        this.captureSize.y
    );

    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.backgroundTarget);
    renderer.clear();

    this.captureDome.position.copy(camera.position);

    renderer.render(
        this.skyScene,
        camera
    );

    renderer.setRenderTarget(oldTarget);

    // VIKTIGT:
    // exakt samma texture som fade-materialen använder
    // blir nu också den synliga bakgrunden
    this.scene.background =
        this.backgroundTarget.texture;
}

addBackgroundFadeToMaterial(material, backgroundTexture = this.backgroundTarget.texture) {
        // Water is a custom shader, but exposes a compatible fade hook. This
        // compiles the fade code only for render modes that request it.
        if (material?.userData.addBackgroundFade) {
            return material.userData.addBackgroundFade(backgroundTexture, this.scene.fog);
        }
        // This hook patches Three's built-in material shader chunks. Custom
        // ShaderMaterials (such as procedural water) do not expose those fog
        // uniforms/chunks, so applying it would make the renderer read an
        // undefined fog uniform.
        if (!material || material.isShaderMaterial) return null;
        if (material.userData.backgroundFadeAdded) {
            return material.userData.backgroundFadeUniforms;
        }

        const uniforms = {
        uBackgroundTexture: { value: backgroundTexture },
        };
        const previousOnBeforeCompile = material.onBeforeCompile;
        // Capture this before replacing the hook. Three's default cache key is
        // based on onBeforeCompile, so retaining the old key prevents a tree,
        // dry-grass, or billboard-grass shader from sharing the wrong program.
        const previousProgramKey = material.customProgramCacheKey?.() || "";
        material.fog = true;

        material.onBeforeCompile = (shader, renderer) => {
        previousOnBeforeCompile?.call(material, shader, renderer);
        shader.uniforms.uBackgroundTexture = uniforms.uBackgroundTexture;

        shader.vertexShader = shader.vertexShader.replace(
        `#include <common>`,
        `#include <common>
        varying vec4 vClipPosition;
        `
        );

        shader.vertexShader = shader.vertexShader.replace(
        `#include <fog_vertex>`,
        `#include <fog_vertex>
        vClipPosition = gl_Position;
        `
        );

        shader.fragmentShader = shader.fragmentShader.replace(
        `#include <clipping_planes_pars_fragment>`,
        `#include <clipping_planes_pars_fragment>
        uniform sampler2D uBackgroundTexture;
        varying vec4 vClipPosition;
        `
        );

     shader.fragmentShader = shader.fragmentShader.replace(
  `#include <fog_fragment>`,
  /* glsl */ `
  #ifdef USE_FOG

    #ifdef FOG_EXP2

      float fogFactor =
        1.0 -
        exp(
          -fogDensity *
          fogDensity *
          vFogDepth *
          vFogDepth
        );

    #else

      float fogFactor =
        smoothstep(
          fogNear,
          fogFar,
          vFogDepth
        );

    #endif


    // Vanlig billig fog större delen av vägen.
    vec3 fogTarget = fogColor;


    // Den exakta sky-texturen behövs egentligen
    // bara nära slutet av faden.
    // Sampling earlier keeps dawn/dusk horizon colours intact in mid-distance fog.
    if (fogFactor > 0.20) {

      vec2 vCoords =
        vClipPosition.xy /
        vClipPosition.w;

      vCoords =
        vCoords * 0.5 + 0.5;


      vec3 backgroundColor =
        texture2D(
          uBackgroundTexture,
          vCoords
        ).rgb;


      float exactSky =
        smoothstep(
          0.20,
          0.75,
          fogFactor
        );


      fogTarget =
        mix(
          fogColor,
          backgroundColor,
          exactSky
        );
    }


    gl_FragColor.rgb =
      mix(
        gl_FragColor.rgb,
        fogTarget,
        fogFactor
      );

  #endif
  `
);
        };

        material.customProgramCacheKey = () => `${previousProgramKey}|background-fade-v2`;
        material.userData.backgroundFadeAdded = true;
        material.userData.backgroundFadeUniforms = uniforms;
        material.needsUpdate = true;

    return uniforms;
    }
  renderToTexture(renderer, camera) {
    this.renderBackground(renderer, camera);
  }
  findDirectionalLight() {
    let light = null;
    this.scene.traverse(item => { if (!light && item.isDirectionalLight) light = item; });
    return light;
  }
  updateSunDirection(sun = this.findDirectionalLight()) {
    if (!sun?.isDirectionalLight || !sun.target) return false;

    // DirectionalLight points from its position toward its target. The sky
    // needs the inverse: the direction from the world toward the visible sun.
    sun.updateWorldMatrix(true, false);
    sun.target.updateWorldMatrix(true, false);
    const sunPosition = sun.getWorldPosition(new THREE.Vector3());
    const targetPosition = sun.target.getWorldPosition(new THREE.Vector3());
    const sunDirection = sunPosition.sub(targetPosition);
    if (sunDirection.lengthSq() < 1e-8) return false;
    sunDirection.normalize();
    this.dome.material.uniforms.uSunDirection.value.copy(sunDirection);

    // Keep the moon on the opposing side of the sky, but above the horizon.
    const moonDirection = sunDirection.clone();
    //moonDirection.y = Math.max(0.22, Math.abs(sunDirection.y) * 0.8);
    this.dome.material.uniforms.uMoonDirection.value.copy(moonDirection.normalize());
    return true;
  }
  createDome() {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uNight: { value: 0 },
        uStarVisibility: { value: 0 },
        uSunVisibility: { value: 1 },
        uMoonVisibility: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(-0.45, 0.62, -0.38).normalize() },
        uMoonDirection: { value: new THREE.Vector3(0.42, 0.48, -0.62).normalize() }
    },
      vertexShader: /* glsl */`
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
varying vec3 vDirection;
uniform float uNight;
uniform float uStarVisibility;
uniform float uSunVisibility;
uniform float uMoonVisibility;

uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;

#define PI 3.14159265359

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(
        n,
        hash21(p + n + 17.17)
    );
}

// --------------------------------------------------
// Stars
// --------------------------------------------------

float starLayer(vec3 d, float scale, float threshold) {

    // Direction -> spherical UV
    float lon = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    float lat = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;

    vec2 uv = vec2(lon * 2.0, lat);

    vec2 p = uv * scale;
    vec2 cell = floor(p);
    vec2 local = fract(p) - 0.5;

    float rnd = hash21(cell);

    if (rnd < threshold)
        return 0.0;

    vec2 offset =
        (hash22(cell + 4.7) - 0.5) * 0.65;

    vec2 delta = local - offset;

    float dist = length(delta);

    // Olika storlek på stjärnorna
    float size =
        mix(
            0.025,
            0.10,
            pow(hash21(cell + 23.1), 8.0)
        );

    // Antialiasing
    float aa = max(fwidth(dist), 0.001);

    float star =
        1.0 -
        smoothstep(
            size,
            size + aa * 1.5,
            dist
        );

    float brightness =
        mix(
            0.35,
            1.5,
            pow(hash21(cell + 91.7), 3.0)
        );

    return star * brightness;
}


void main() {

    vec3 d = normalize(vDirection);

    float y = clamp(d.y, -1.0, 1.0);

    // ==================================================
    // DAY SKY
    // ==================================================

    vec3 horizonColor =
        vec3(0.62, 0.79, 0.95);

    vec3 midSkyColor =
        vec3(0.18, 0.53, 0.88);

    vec3 zenithColor =
        vec3(0.025, 0.20, 0.53);

    float upper =
        smoothstep(0.0, 0.85, y);

    vec3 day =
        mix(
            horizonColor,
            midSkyColor,
            smoothstep(0.0, 0.38, y)
        );

    day =
        mix(
            day,
            zenithColor,
            pow(upper, 0.8)
        );


    // -----------------------------------------------
    // Horizon haze
    // -----------------------------------------------

float horizonFade = 1.0 - smoothstep(0.0, 0.10, abs(y));

// Svagare och blåare haze
day += vec3(0.04, 0.06, 0.08) * horizonFade;


    // -----------------------------------------------
    // Sun
    // -----------------------------------------------

vec3 sunDirection = normalize(uSunDirection);
float sunDot = max(dot(d, sunDirection), 0.0);

// Stor men mjuk glow
float sunGlow = pow(sunDot, 10.0);

// Mindre tydligare solskiva
float sunDisc = smoothstep(
    cos(0.050),
    cos(0.040),
    sunDot
);

// Varm glow runt solen



    // ==================================================
    // NIGHT SKY
    // ==================================================

    vec3 nightHorizon =
        vec3(0.035, 0.065, 0.14);

    vec3 nightTop =
        vec3(0.0015, 0.004, 0.022);

    vec3 night =
        mix(
            nightHorizon,
            nightTop,
            pow(
                clamp(y * 0.5 + 0.5, 0.0, 1.0),
                0.8
            )
        );


    // -----------------------------------------------
    // High resolution stars
    // -----------------------------------------------

    float starMask =
        smoothstep(
            -0.10,
            0.10,
            y
        );

    float stars = 0.0;

    // Många små stjärnor
    stars +=
        starLayer(
            d,
            900.0,
            0.965
        ) * 0.60;

    // Färre lite starkare
    stars +=
        starLayer(
            d,
            420.0,
            0.985
        ) * 1.10;

    // Några stora
    stars +=
        starLayer(
            d,
            180.0,
            0.994
        ) * 1.45;

    stars *= starMask * uStarVisibility;


    // Lite färgvariation
    vec3 starColor =
        vec3(0.78, 0.87, 1.0);

    night +=
        starColor *
        stars;


    // ==================================================
    // MOON
    // ==================================================

    vec3 moonDirection = normalize(uMoonDirection);
    float moonDot = max(dot(d, moonDirection), 0.0);

    // Hårdare månskiva
    float moonDisc = smoothstep(
        cos(0.040),
        cos(0.036),
        moonDot
    );

    // Liten mjuk halo utanför
    float moonHalo = smoothstep(
        cos(0.085),
        cos(0.040),
        moonDot
    ) - moonDisc;

    // Basfärg natt


    // ==================================================
    // Final mix
    // ==================================================

    vec3 color =
        mix(
            day,
            night,
            uNight
        );

    // Give dawn and dusk a horizon palette of their own. Draw the sun and
    // moon after the sky blend, so each remains visible at the horizon while
    // the day and night layers are transitioning.
    float twilight = 1.0 - smoothstep(0.03, 0.32, abs(sunDirection.y));
    float horizonBand = 1.0 - smoothstep(0.0, 0.42, abs(y));
    float dusk = 1.0 - smoothstep(-0.15, 0.15, sunDirection.x);
    vec3 twilightColor = mix(vec3(1.0, 0.38, 0.14), vec3(0.48, 0.17, 0.62), dusk);
    color = mix(color, twilightColor, twilight * horizonBand * 0.68);

    color += vec3(1.0, 0.47, 0.16) * sunGlow * 0.45 * uSunVisibility;
    color = mix(color, vec3(1.0, 0.88, 0.58), sunDisc * uSunVisibility);
    color += vec3(0.28, 0.42, 0.86) * moonHalo * 0.35 * uMoonVisibility;
    color = mix(color, vec3(0.72, 0.84, 1.0), moonDisc * uMoonVisibility);

    gl_FragColor =
        vec4(color, 1.0);
}
`
      
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), material);
    dome.name = "Shader sky";
    dome.renderOrder = -1000;
    dome.onBeforeRender = (_renderer, _scene, camera) => {
      dome.position.copy(camera.position);
    };
    return dome;
  }
}
