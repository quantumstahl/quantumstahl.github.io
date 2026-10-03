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
    this.backgroundTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    // The capture is sampled by scene materials before the main renderer's
    // tone-mapping pass, so it must remain in the linear working space.
    this.backgroundTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.skyScene = new THREE.Scene();
    // The capture uses the same shader uniforms as the visible dome, but must
    // not tone-map them. Otherwise dawn/dusk colours are tone-mapped into the
    // render target and then tone-mapped once more with the fogged material.
    this.captureMaterial = this.dome.material.clone();
    this.captureMaterial.uniforms = this.dome.material.uniforms;
    this.captureMaterial.toneMapped = false;
    this.captureDome = new THREE.Mesh(this.dome.geometry, this.captureMaterial);
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
  setCloudStarOcclusion(cloudMap, time) {
    const uniforms = this.dome.material.uniforms;
    uniforms.uCloudMap.value = cloudMap ?? null;
    uniforms.uCloudTime.value = time ?? 0;
    uniforms.uCloudCoverage.value = cloudMap ? 1 : 0;
  }
  updateHorizonOffset(camera) {
    // Raise the celestial texture as camera height falls, and lower it as the
    // player climbs. The dome itself stays camera-centred for a round horizon.
    const fogFar = this.scene.fog?.far ?? 70;
    this.dome.material.uniforms.uHorizonOffset.value = THREE.MathUtils.clamp(
      camera.position.y / fogFar,
      -0.3,
      0.3
    );
  }

  // The CatAdventure fade shader, fed by a live low-resolution render of this
  // procedural sky. It samples the exact background colour at the fragment's
  // screen UV instead of approximating a sky gradient in every material.
resizeBackgroundTarget(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    if (this.backgroundTarget.width !== w || this.backgroundTarget.height !== h) this.backgroundTarget.setSize(w, h);
}
renderBackground(renderer, camera) {

    this.updateHorizonOffset(camera);

    renderer.getDrawingBufferSize(this.captureSize);

    this.resizeBackgroundTarget(
        this.captureSize.x,
        this.captureSize.y
    );

    const oldTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.backgroundTarget);
    renderer.clear();

    // This is a camera-centred sky bubble, matching the circular fog boundary
    // around the player instead of projecting a flat world-height horizon.
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

    // Every fogged material, including terrain and far grass, must blend to
    // the same captured sky. A separate fogColor-to-sky transition creates a
    // second horizontal band before the clouded horizon.
    vec2 vCoords = vClipPosition.xy / vClipPosition.w;
    vCoords = vCoords * 0.5 + 0.5;
    vec3 fogTarget = texture2D(uBackgroundTexture, vCoords).rgb;

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
        uCloudMap: { value: null },
        uCloudTime: { value: 0 },
        uCloudCoverage: { value: 0 },
        uHorizonOffset: { value: 0 },
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
uniform sampler2D uCloudMap;
uniform float uCloudTime;
uniform float uCloudCoverage;
uniform float uHorizonOffset;

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

    float lon = atan(d.z, d.x) / (2.0 * PI) + 0.5;
    float lat = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;

    vec2 uv = vec2(lon * 2.0, lat);
    vec2 p = uv * scale;

    // Screen-space pixel footprint.
    // Viktigt: beräknas från kontinuerliga p, INTE från fract/local/dist.
    float pixelSize = max(
        length(dFdx(p)),
        length(dFdy(p))
    );

    // Skyddar även mot enorma derivatives vid atan-seamen.
    pixelSize = clamp(pixelSize, 0.0015, 0.035);

    vec2 cell  = floor(p);
    vec2 local = fract(p) - 0.5;

    float rnd = hash21(cell);
    float hasStar = step(threshold, rnd);

    vec2 offset =
        (hash22(cell + 4.7) - 0.5) * 0.65;

    vec2 delta = local - offset;
    float dist = length(delta);

    float randomSize =
        mix(
            0.3,
            0.301,
            pow(hash21(cell + 23.1), 8.0)
        );

    // Gör aldrig stjärnan mycket mindre än en pixel.
    // Detta stoppar nästan allt temporal flicker.
   float size = max(
    randomSize,
    pixelSize * 0.75
);

float aa = max(
    pixelSize * 0.6,
    0.002
);

    float star =
        1.0 -
        smoothstep(
            size,
            size + aa * 1.5,
            dist
        );

    float brightness =
        mix(
            1.0,
            5.5,
            pow(hash21(cell + 91.7), 3.0)
        );

    return star * brightness * hasStar;
}

float cloudStarOcclusion(vec3 d) {
    // This duplicates the Clouds.js UV transform so stars are removed from
    // the sky before the soft, alpha-blended cloud layer is drawn on top.
    const float horizon = 0.502;
    vec2 uv = vec2(
        atan(d.z, d.x) * 0.15915494 + 0.5,
        d.y * 0.5 + 0.5
    );
    float cloudY = horizon + (uv.y - horizon) * 6.2;
    vec2 mapUv = vec2(
        fract(uv.x * 3.0 - 0.2028 * uCloudTime * 0.0118),
        clamp(cloudY, 0.0, 1.0)
    );
    float cloud = texture2D(uCloudMap, mapUv).a;
    
    return smoothstep(0.003, 0.04, cloud) ;
}


void main() {

    vec3 d = normalize(vDirection + vec3(0.0, uHorizonOffset, 0.0));

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

// A broad, subtle halo only while the sun is near the horizon. The disc is
// still visible in daylight, but the atmospheric glow belongs to dawn/dusk.
float twilight = 1.0 - smoothstep(0.05, 0.35, abs(sunDirection.y));
float sunGlow = pow(sunDot, 7.0) * twilight;
// Make the twilight bloom visibly brighter than the surrounding orange sky.
// It extends to about twice the sun disc's radius and is additive below.
float sunHalo = smoothstep(0.985, 0.999, sunDot) * twilight;

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
            0.900
        ) * 1.00;

  


    float cloudMask = cloudStarOcclusion(d) * uCloudCoverage;
    stars *= starMask * uStarVisibility * (1.0 - cloudMask);


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
    float horizonBand = 1.0 - smoothstep(0.0, 0.42, abs(y));
    float dusk = 1.0 - smoothstep(-0.15, 0.15, sunDirection.x);
    vec3 twilightColor = mix(vec3(1.0, 0.38, 0.14), vec3(0.48, 0.17, 0.62), dusk);
    color = mix(color, twilightColor, twilight * horizonBand * 0.68);

    color += vec3(1.0, 0.62, 0.24) * sunHalo * 1.10 * uSunVisibility;
    color += vec3(1.0, 0.82, 0.48) * sunGlow * 0.85 * uSunVisibility;
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
      // Keep the sky as a bubble around the camera so its horizon wraps around
      // the player at the fog boundary rather than becoming a flat line.
      dome.position.copy(camera.position);
      this.updateHorizonOffset(camera);
    };
    return dome;
  }
}
