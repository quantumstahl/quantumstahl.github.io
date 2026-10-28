import * as THREE from "three";

// NextWorld's gradient, twilight and stars, with circular projected sun/moon
// discs. A tiny sky capture lets materials fade to the actual sky colour.
export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.horizonDistance = 5200;
    this.starMap = new THREE.TextureLoader().load(new URL("../../assets/sky/stars.png", import.meta.url).href);
    this.starMap.colorSpace = THREE.SRGBColorSpace;
    this.starMap.wrapS = this.starMap.wrapT = THREE.RepeatWrapping;
    this.moonMap = new THREE.TextureLoader().load(new URL("../../assets/sky/moon-stylized.png", import.meta.url).href);
    this.moonMap.colorSpace = THREE.SRGBColorSpace;
    this.moonMap.wrapS = this.moonMap.wrapT = THREE.ClampToEdgeWrapping;
    this.moonMap.minFilter = THREE.LinearMipmapLinearFilter;
    this.moonMap.magFilter = THREE.LinearFilter;
    this.dome = this.createDome();
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.backgroundTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.captureSize = new THREE.Vector2();
    this.celestialSize = new THREE.Vector2();
    this.celestialDirection = new THREE.Vector3();
    this.celestialClip = new THREE.Vector4();
    this.skyScene = new THREE.Scene();
    this.captureMaterial = this.dome.material.clone();
    this.captureMaterial.uniforms = this.dome.material.uniforms;
    this.captureMaterial.toneMapped = false;
    this.captureDome = new THREE.Mesh(this.dome.geometry, this.captureMaterial);
    this.captureDome.frustumCulled = false;
    this.captureDome.onBeforeRender = (renderer, _scene, camera) => this.updateCelestialProjection(renderer, camera);
    this.skyScene.add(this.captureDome);
  }

  setEnvironment(values) {
    const uniforms = this.dome.material.uniforms;
    uniforms.uNight.value = THREE.MathUtils.clamp(values.nightAmount, 0, 1);
    uniforms.uStarVisibility.value = THREE.MathUtils.clamp(values.starVisibility, 0, 1);
    uniforms.uSunVisibility.value = THREE.MathUtils.clamp(values.sunVisibility, 0, 1);
    uniforms.uMoonVisibility.value = THREE.MathUtils.clamp(values.moonVisibility, 0, 1);
    if (values.sunDirection) uniforms.uSunDirection.value.copy(values.sunDirection);
    if (values.moonDirection) uniforms.uMoonDirection.value.copy(values.moonDirection);
  }

  setCloudStarOcclusion(map, time) {
    const uniforms = this.dome.material.uniforms;
    uniforms.uCloudMap.value = map;
    uniforms.uCloudCoverage.value = map ? 1 : 0;
    uniforms.uCloudTime.value = time;
  }

  updateHorizonOffset(camera) {
    this.dome.material.uniforms.uHorizonOffset.value = THREE.MathUtils.clamp(camera.position.y / this.horizonDistance, -.3, .3);
  }

  updateCelestialProjection(renderer, camera) {
    const uniforms = this.dome.material.uniforms;
    const target = renderer.getRenderTarget();
    if (target) this.celestialSize.set(target.width, target.height);
    else renderer.getDrawingBufferSize(this.celestialSize);
    const offset = uniforms.uHorizonOffset.value;
    for (const [direction, screen, angularRadius] of [
      [uniforms.uSunDirection.value, uniforms.uSunScreen.value, .045],
      [uniforms.uMoonDirection.value, uniforms.uMoonScreen.value, .038],
    ]) {
      // Invert the sky's height adjustment for the centre only. Applying it
      // to the whole disc stretched its outline as the camera climbed.
      const distance = offset * direction.y + Math.sqrt(1 - offset * offset * (1 - direction.y * direction.y));
      this.celestialDirection.copy(direction).multiplyScalar(distance);
      this.celestialDirection.y -= offset;
      this.celestialDirection.transformDirection(camera.matrixWorldInverse);
      this.celestialClip.set(this.celestialDirection.x, this.celestialDirection.y, this.celestialDirection.z, 0).applyMatrix4(camera.projectionMatrix);
      if (this.celestialClip.w <= 0) { screen.set(0, 0, 1, 0); continue; }
      const inverseW = 1 / this.celestialClip.w;
      // Pixel coordinates make the outline circular at any aspect ratio or
      // screen position. The capture has its own resolution and same shape.
      screen.set(
        (this.celestialClip.x * inverseW * .5 + .5) * this.celestialSize.x,
        (this.celestialClip.y * inverseW * .5 + .5) * this.celestialSize.y,
        Math.tan(angularRadius) * camera.projectionMatrix.elements[5] * inverseW * this.celestialSize.y * .5,
        1,
      );
    }
  }

  renderBackground(renderer, camera) {
    this.updateHorizonOffset(camera);
    renderer.getDrawingBufferSize(this.captureSize);
    const scale = Math.min(1, 512 / Math.max(this.captureSize.x, this.captureSize.y));
    const width = Math.max(1, Math.round(this.captureSize.x * scale));
    const height = Math.max(1, Math.round(this.captureSize.y * scale));
    if (this.backgroundTarget.width !== width || this.backgroundTarget.height !== height) this.backgroundTarget.setSize(width, height);
    const target = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.backgroundTarget);
      renderer.clear();
      this.captureDome.position.copy(camera.position);
      renderer.render(this.skyScene, camera);
    } finally {
      renderer.setRenderTarget(target);
    }
  }

  dispose() {
    this.dome.removeFromParent();
    this.captureDome.removeFromParent();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.captureMaterial.dispose();
    this.starMap.dispose();
    this.moonMap.dispose();
    this.backgroundTarget.dispose();
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
        uStarMap: { value: this.starMap },
        uMoonMap: { value: this.moonMap },
        uCloudTime: { value: 0 },
        uCloudCoverage: { value: 0 },
        uHorizonOffset: { value: 0 },
        uSunScreen: { value: new THREE.Vector4(0, 0, 1, 0) },
        uMoonScreen: { value: new THREE.Vector4(0, 0, 1, 0) },
        uSunDirection: { value: new THREE.Vector3(-0.45, 0.62, -0.38).normalize() },
        uMoonDirection: { value: new THREE.Vector3(0.42, 0.48, -0.62).normalize() }
    },
      vertexShader: /* glsl */`
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = clip.xyww;
        }
      `,
      fragmentShader: /* glsl */`
varying vec3 vDirection;
uniform float uNight;
uniform float uStarVisibility;
uniform float uSunVisibility;
uniform float uMoonVisibility;
uniform sampler2D uCloudMap;
uniform sampler2D uStarMap;
uniform sampler2D uMoonMap;
uniform float uCloudTime;
uniform float uCloudCoverage;
uniform float uHorizonOffset;

uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform vec4 uSunScreen;
uniform vec4 uMoonScreen;

#define PI 3.14159265359

vec3 lunarSurface(vec2 uv) {
    // Fit the painted disc inside its transparent border. The shader's
    // circular mask supplies the silhouette, avoiding stray painted flecks
    // and tiny alpha variations within the generated surface.
    vec3 linearColor = texture2D(uMoonMap, uv * .455 + vec2(.5, .503)).rgb;
    // This sky outputs display RGB directly; Three samples sRGB textures in
    // linear space. Convert back once to preserve the painted colours.
    vec3 painted = mix(1.055 * pow(linearColor, vec3(1.0 / 2.4)) - .055,
                       linearColor * 12.92, lessThanEqual(linearColor, vec3(.0031308)));
    float z = sqrt(max(0.0, 1.0 - dot(uv, uv)));
    return painted * (.86 + .14 * sqrt(z));
}

float cloudStarOcclusion(vec3 d) {
    // Keep this transform in lockstep with Clouds.js. The sky is rendered to
    // the background texture before the cloud mesh, so its stars need the
    // same alpha mask that will be drawn immediately afterwards.
    const float horizon = 0.55;
    const float cloudScaleX = 3.0;
    const float cloudScaleY = 6.2;
    vec2 uv = vec2(
        atan(d.z, d.x) * 0.15915494 + 0.5,
        d.y * 0.5 + 0.5
    );
    float cloudY = horizon + (uv.y - horizon) * cloudScaleY;
    vec2 mapUv = vec2(
        fract(uv.x * cloudScaleX - 0.2028 * uCloudTime * 0.0118),
        clamp(cloudY, 0.0, 1.0)
    );
    float cloud = texture2D(uCloudMap, mapUv).a;
    float horizonCloudFade = smoothstep(horizon - 0.046, horizon + 0.020, uv.y);
    float alpha = cloud * 0.8 * horizonCloudFade;

    return smoothstep(0.003, 0.04, alpha);
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
vec2 sunUv = (gl_FragCoord.xy - uSunScreen.xy) / max(uSunScreen.z, .001);
float sunRadius = length(sunUv);
float sunAA = max(fwidth(sunRadius) * .65, .001);
float sunDisc = (1.0 - smoothstep(1.0 - sunAA, 1.0 + sunAA, sunRadius)) * uSunScreen.w;
float sunHalo = exp(-max(sunRadius - 1.0, 0.0) * 3.2) * (1.0 - sunDisc)
              * (.16 + twilight * .48) * uSunScreen.w;
float sunLimb = sqrt(max(0.0, 1.0 - sunRadius * sunRadius));
vec3 sunSurface = mix(vec3(1.0, .73, .34), vec3(1.0, .97, .82), .35 + .65 * sunLimb);
sunSurface = mix(sunSurface, vec3(1.0, .56, .20), twilight * .45);

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
            0.00,
            0.05,
            y
        );

    vec2 starUv = vec2(
        atan(d.z, d.x) * 0.15915494 + 0.5,
        acos(clamp(d.y, -1.0, 1.0)) / PI
    );
    // stars.png is a 2:1 equirectangular map; remove its near-black base
    // before adding the remaining star light to the night gradient.
    vec2 repeatedStarUv = starUv * 7.0;

    vec3 stars = max(texture2D(uStarMap, repeatedStarUv).rgb - vec3(0.012), vec3(0.0));

    float cloudMask = cloudStarOcclusion(d) * uCloudCoverage;
    stars *= 1.5 * starMask * uStarVisibility * (1.0 - cloudMask);

    night +=stars;

    // ==================================================
    // MOON
    // ==================================================

    vec2 moonUv = (gl_FragCoord.xy - uMoonScreen.xy) / max(uMoonScreen.z, .001);
    float moonRadius = length(moonUv);
    float moonAA = max(fwidth(moonRadius) * .65, .001);
    float moonDisc = (1.0 - smoothstep(1.0 - moonAA, 1.0 + moonAA, moonRadius)) * uMoonScreen.w;
    float moonHalo = exp(-max(moonRadius - 1.0, 0.0) * 3.5) * (1.0 - moonDisc) * uMoonScreen.w;
    vec3 moonSurface = vec3(0.0);
    // Surface work is confined to the small visible disc, keeping the rest
    // of the sky inexpensive. The pattern stays attached as the moon moves.
    if (moonDisc * uMoonVisibility > .001) moonSurface = lunarSurface(moonUv);

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
    color = mix(color, sunSurface, sunDisc * uSunVisibility);
    color += vec3(0.28, 0.42, 0.72) * moonHalo * .16 * uMoonVisibility;
    color = mix(color, moonSurface, moonDisc * uMoonVisibility);

    gl_FragColor =
        vec4(color, 1.0);
}
`
      
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
    dome.name = "Shader sky";
    dome.renderOrder = -1000;
    dome.onBeforeRender = (renderer, _scene, camera) => {
      // Keep the sky as a bubble around the camera so its horizon wraps around
      // the player at the fog boundary rather than becoming a flat line.
      dome.position.copy(camera.position);
      dome.updateMatrixWorld(true);
      this.updateHorizonOffset(camera);
      this.updateCelestialProjection(renderer, camera);
    };
    return dome;
  }
}
