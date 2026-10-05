import * as THREE from "three";
import { Clouds } from "./Clouds.js";

// Central time and lighting controller. Sky continues to own rendering its
// procedural dome and background texture; this class only supplies its state.
export class EnvironmentSystem {
  constructor({ scene, sky }) {
    this.scene = scene;
    this.sky = sky;
    // EnvironmentSystem owns all time-driven atmosphere layers. Clouds do
    // their own camera following in the render hook, so callers need not pass
    // camera state through the world update path.
    this.clouds = new Clouds(scene);
    this.timeOfDay = 0.25; // 0 = midnight, .25 = sunrise, .5 = noon.
    this.dayDuration = 360;
    this.timeScale = 10;
    this.sunDistance = 200;
    this.sunIntensity = 0.5;
    this.moonIntensity = 0.5;
    this.sunDirection = new THREE.Vector3();
    this.moonDirection = new THREE.Vector3();
    this.fogColor = new THREE.Color();
    this.nightFogColor = new THREE.Color(0x091125);
    this.dayFogColor = new THREE.Color(0x9ec9f2);
    // Match the procedural sky at its horizon, including its dedicated
    // dawn/dusk palette. This is intentionally separate from scene fog.
    this.nightHorizonColor = new THREE.Color(0.2, 0.1, 0.4);
    this.dayHorizonColor = new THREE.Color(1.00, 1.00, 1.0);
    this.dawnHorizonColor = new THREE.Color(1.0, 0.38, 0.14);
    this.duskHorizonColor = new THREE.Color(0.48, 0.17, 0.62);
    this.fogHorizonColor = new THREE.Color();
    this.nightHemisphereColor = new THREE.Color(0xffffff);
    this.dayHemisphereColor = new THREE.Color(0xffffff);
    this.hemisphereGroundColor = new THREE.Color(0x000000);
    this.nightHemisphereIntensity = 2.2;
    this.dayHemisphereIntensity = 3.2;
    this.GrassTint = new THREE.Color(0.00, 0.00, 0.09);
    this.savedGrasstint= new THREE.Color(0.00, 0.00, 0.09);
    this.NoGrasstint= new THREE.Color(0.00, 0.00, 0.00);
    this.sun = sky.findDirectionalLight();
    this.moon = new THREE.DirectionalLight(0xaec8ff, 0);
    this.moon.name = "Moonlight";
    this.moon.castShadow = false;
    this.scene.add(this.moon);
    this.hemisphere = null;
    this.sunsun=0.84375;
    scene.traverse(item => { if (!this.hemisphere && item.isHemisphereLight) this.hemisphere = item; });
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
      if (camera) this.sun.target.position.set(camera.position.x, 0, camera.position.z);
      this.sun.position.copy(this.sunDirection).multiplyScalar(this.sunDistance).add(this.sun.target.position);
      this.sun.intensity = this.sunIntensity * daylight;
      this.sun.visible = daylight > 0.001;
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();
    }
    this.moon.position.copy(this.moonDirection).multiplyScalar(this.sunDistance);
    // Moonlight should reveal the terrain without reading as a second sun.
    this.moon.intensity = this.moonIntensity * moonlight;
    this.moon.visible = moonlight > 0.001;
    this.moon.updateMatrixWorld();
    if (this.hemisphere) {
      this.hemisphere.intensity = THREE.MathUtils.lerp(
        this.nightHemisphereIntensity,
        this.dayHemisphereIntensity,
        daylight
      );
      this.hemisphere.color.lerpColors(this.nightHemisphereColor, this.dayHemisphereColor, daylight);
      this.hemisphere.groundColor.copy(this.hemisphereGroundColor);
    }

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
  }
}
