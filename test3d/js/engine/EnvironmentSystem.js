import * as THREE from "three";
import { Clouds } from "./Clouds.js";

// Central time and lighting controller. Sky continues to own rendering its
// procedural dome and background texture; this class only supplies its state.
export class EnvironmentSystem {
  constructor({ scene, sky, assets = null }) {
    this.scene = scene;
    this.sky = sky;
    this.assets = assets;
    // EnvironmentSystem owns all time-driven atmosphere layers. Clouds do
    // their own camera following in the render hook, so callers need not pass
    // camera state through the world update path.
    this.clouds = new Clouds(scene);
    this.timeOfDay = 0.25; // 0 = midnight, .25 = sunrise, .5 = noon.
    this.dayDuration = 360;
    this.timeScale = 1.0;
    this.sunDistance = 100;
    // Match the authoring preview's readable direct/ambient balance. The
    // stronger sky fill prevents low-poly foliage from turning nearly black
    // on faces turned away from the sun.
    this.sunIntensity = 5.8;
    // Keep directional silhouettes readable, while allowing enough sky fill
    // through them that foliage and terrain do not crush to near-black.
    this.shadowStrength = 0.50;
    // Kept deliberately below sunlight, but non-zero so the night shadow map
    // has a visible result when the moon becomes the active caster.
    this.moonIntensity = 2.35;
    this.sunDirection = new THREE.Vector3();
    this.moonDirection = new THREE.Vector3();
    this.fogColor = new THREE.Color();
    this.nightFogColor = new THREE.Color(0x091125);
    this.dayFogColor = new THREE.Color(0xffffff);
    // Match the procedural sky at its horizon, including its dedicated
    // dawn/dusk palette. This is intentionally separate from scene fog.
    this.nightHorizonColor = new THREE.Color(7.0, 7.0, 1.0);
    this.dayHorizonColor = new THREE.Color(1.00, 1.00, 1.0);
    this.dawnHorizonColor = new THREE.Color(8.0, 8.0, 1.0);
    this.duskHorizonColor = new THREE.Color(7.0, 7.0, 1.0);
    this.fogHorizonColor = new THREE.Color();

    this.GrassTint = new THREE.Color(0.00, 0.00, 0.15);
    this.savedGrasstint= new THREE.Color(0.00, 0.00, 0.15);
    this.NoGrasstint= new THREE.Color(0.00, 0.00, 0.00);
    this.sun = sky.findDirectionalLight();
    this.moon = new THREE.DirectionalLight(0xbbbbff, 0);
    this.moon.name = "Moonlight";
    this.moon.castShadow = true;
    // Shadow-only MaxPaint proxies use layer 1. Moonlight is the active
    // caster at night, so its shadow camera must see that layer as well.
    this.moon.shadow.camera.layers.enable(1);

    // EnvironmentSystem is created by MapLoader, so the mobile profile is
    // owned by ThreeApp and published on window for shared render systems.
    const shadowSize = window.mobileProfile ? 2048 : 4096;
    this.moon.shadow.mapSize.set(shadowSize, shadowSize); this.moon.shadow.camera.left = this.moon.shadow.camera.bottom = -215; this.moon.shadow.camera.right = this.moon.shadow.camera.top = 215;
    this.moon.shadow.camera.near = 1;
    this.moon.shadow.camera.far = 500;
    this.moon.shadow.bias = 0.0005;
    this.moon.shadow.normalBias = 0.06;

    this.scene.add(this.moon);
    this.sunsun=0.84375;
    
  }

  apply(config = {}) {
    const requestedTime = Number(config.timeOfDay);
    this.timeOfDay = Number.isFinite(requestedTime)
      ? THREE.MathUtils.euclideanModulo(requestedTime, 1)
      : (config.mode === "night" ? 0 : 0.25);
    const requestedDuration = Number(config.dayDuration);
    this.dayDuration = Number.isFinite(requestedDuration)
      ? Math.max(30, requestedDuration)
      : 360;
    this.update(0);
  }

  setTimeOfDay(timeOfDay) {
    this.timeOfDay = THREE.MathUtils.euclideanModulo(timeOfDay, 1);
    this.update(0);
  }

  update(delta, camera = null) {
    this.timeOfDay = THREE.MathUtils.euclideanModulo(
      this.timeOfDay + delta * this.timeScale / this.dayDuration,
      1
    );
    
    // A full revolution gives sunrise, noon, sunset and midnight in a stable
    // world-space arc. The fixed Z component keeps the sun off the exact east/
    // west axis, which makes terrain lighting easier to read.
    const solarAngle = (this.timeOfDay - 0.25) * Math.PI * 2;
    this.sunDirection.set(Math.cos(solarAngle), Math.sin(solarAngle), -0.35).normalize();
    this.moonDirection.copy(this.sunDirection).multiplyScalar(-1);

    // Keep both directional lights present through a broad twilight band.
    // At the horizon (sunDirection.y = 0) each retains most of its strength;
    // they only fade after moving clearly below/above it.
    const daylight = THREE.MathUtils.smoothstep(this.sunDirection.y, -0.30, 0.10);
    const stars = 1 - THREE.MathUtils.smoothstep(this.sunDirection.y, -0.10, 0.05);
    const moonlight = THREE.MathUtils.smoothstep(-this.sunDirection.y, -0.30, 0.10);
    const sunVisibility = THREE.MathUtils.smoothstep(this.sunDirection.y, -0.30, -0.03);
    const moonVisibility = THREE.MathUtils.smoothstep(this.moonDirection.y, -0.30, -0.03);
    const twilight = 1 - THREE.MathUtils.smoothstep(0.03, 0.32, Math.abs(this.sunDirection.y));
    // The sun travels toward negative X after noon, making this horizon band
    // sunset only; sunrise retains the cool twilight treatment.
    const sunset = twilight * THREE.MathUtils.smoothstep(-0.15, 0.55, -this.sunDirection.x);
    // Keep the horizon in lockstep with the daylight ramp. Dawn and dusk
    // now occupy tight windows around the sun crossing the horizon (.25 and
    // .75), rather than bleeding across half of the day cycle.
    const horizonTime = this.timeOfDay;
    if (horizonTime < 0.20 || horizonTime >= 0.85) {
      this.fogHorizonColor.copy(this.nightHorizonColor);
    } else if (horizonTime < 0.25) {
      this.fogHorizonColor.lerpColors(
        this.nightHorizonColor,
        this.dawnHorizonColor,
        THREE.MathUtils.smoothstep(horizonTime, 0.20, 0.25)
      );
    } else if (horizonTime < 0.32) {
      this.fogHorizonColor.lerpColors(
        this.dawnHorizonColor,
        this.dayHorizonColor,
        THREE.MathUtils.smoothstep(horizonTime, 0.25, 0.32)
      );
    } else if (horizonTime < 0.73) {
      this.fogHorizonColor.copy(this.dayHorizonColor);
    } else if (horizonTime < 0.80) {
      this.fogHorizonColor.lerpColors(
        this.dayHorizonColor,
        this.duskHorizonColor,
        THREE.MathUtils.smoothstep(horizonTime, 0.73, 0.80)
      );
    } else {
      this.fogHorizonColor.lerpColors(
        this.duskHorizonColor,
        this.nightHorizonColor,
        THREE.MathUtils.smoothstep(horizonTime, 0.80, 0.85)
      );
    }
    this.fogColor.copy(this.fogHorizonColor);
    this.GrassTint.lerpColors(this.savedGrasstint, this.NoGrasstint, daylight);
    this.sunsun=daylight.valueOf();
    if (this.sun) {
      // Directional-light shadows are bounded by the shadow camera. Centre
      // that volume on the player/editor camera so streamed chunks receive
      // shadows instead of leaving the fixed origin-area cascade.
      if (camera) {
        // A directional map moves with the player.  Snap its centre to a
        // shadow texel so tiny camera-position changes do not make the whole
        // canopy shadow crawl across the terrain.
        const shadowCamera = this.sun.shadow.camera;
        const mapWidth = Math.max(1, this.sun.shadow.mapSize.x || 1);
        const texelSize = (shadowCamera.right - shadowCamera.left) / mapWidth;
        const snap = value => Math.round(value / texelSize) * texelSize;
        this.sun.target.position.set(snap(camera.position.x), 0, snap(camera.position.z));
      }
      this.sun.position.copy(this.sunDirection).multiplyScalar(this.sunDistance).add(this.sun.target.position);
      this.sun.intensity = this.sunIntensity * daylight;
      this.sun.visible = daylight > 0.001;
      // A sun almost level with the terrain creates kilometre-long, hard
      // shadow-map silhouettes. Keep the dawn/dusk light colour, but fade
      // real shadows until the sun has enough altitude to look intentional.
      this.sun.shadow.intensity = this.shadowStrength * THREE.MathUtils.smoothstep(this.sunDirection.y, 0.08, 0.24);
      // Grazing light magnifies shadow-map precision error across the broad,
      // smooth terrain surface. Increase only the normal offset at dawn/dusk
      // to prevent triangular self-shadow bands without weakening midday
      // mountain shadows.
      const grazingSun = 1 - THREE.MathUtils.smoothstep(Math.abs(this.sunDirection.y), 0.06, 0.35);
      this.sun.shadow.normalBias = 0.06 + grazingSun * 0.18;
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();
    }
    this.moon.position.copy(this.moonDirection).multiplyScalar(this.sunDistance);
    // Moonlight should reveal the terrain without reading as a second sun.
    this.moon.intensity = this.moonIntensity * moonlight;
    this.moon.visible = moonlight > 0.001;
    this.moon.shadow.intensity = this.shadowStrength * THREE.MathUtils.smoothstep(this.moonDirection.y, 0.08, 0.24);
    const grazingMoon = 1 - THREE.MathUtils.smoothstep(Math.abs(this.moonDirection.y), 0.06, 0.35);
    this.moon.shadow.normalBias = 0.06 + grazingMoon * 0.18;
    this.moon.updateMatrixWorld();

    // Rendering a directional-light shadow map is a full extra scene pass.
    // During twilight both lights may be visible, but only the stronger one
    // owns the shadow map so their shadows cannot overlap or double the cost.
    const sunCanCast = daylight > 0.001 && this.sun.shadow.intensity > 0.001;
    // A zero intensity moon may still be used as a shadow-only night light
    // in authored scenes, so do not use its colour intensity to gate the
    // depth pass. The sun/mood handoff still guarantees one map at a time.
    const moonCanCast = moonlight > 0.001 && this.moon.shadow.intensity > 0.001;
    const sunOwnsShadows = sunCanCast && (!moonCanCast || daylight >= moonlight);
    this.sun.castShadow = sunOwnsShadows;
    this.moon.castShadow = !sunOwnsShadows && moonCanCast;


    this.clouds.setEnvironment({ daylight, sunset, sunDirection: this.sunDirection });
    this.clouds.update(delta);
    this.sky.setCloudStarOcclusion(this.clouds.cloudMap, this.clouds.time);
    this.sky.setEnvironment({
      nightAmount: 1 - daylight,
      starVisibility: stars,
      sunVisibility,
      moonVisibility,
      sunDirection: this.sunDirection,
      moonDirection: this.moonDirection,
      fogColor: this.fogColor
    });
    this.assets?.setEnvironment({ nightAmount: 1 - daylight });
  }
}
