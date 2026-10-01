import * as THREE from "three";

// Central time and lighting controller. Sky continues to own rendering its
// procedural dome and background texture; this class only supplies its state.
export class EnvironmentSystem {
  constructor({ scene, sky }) {
    this.scene = scene;
    this.sky = sky;
    this.timeOfDay = 0.25; // 0 = midnight, .25 = sunrise, .5 = noon.
    this.dayDuration = 360;
    this.timeScale = 10;
    this.sunDistance = 200;
    this.sunIntensity = 2;
    this.sunDirection = new THREE.Vector3();
    this.moonDirection = new THREE.Vector3();
    this.fogColor = new THREE.Color();
    this.horizonColor = new THREE.Color();
    this.nightFogColor = new THREE.Color(0x091125);
    this.dayFogColor = new THREE.Color(0x9ec9f2);
    // Match the procedural sky at its horizon, including its dedicated
    // dawn/dusk palette. This is intentionally separate from scene fog.
    this.nightHorizonColor = new THREE.Color(0.035, 0.065, 0.14);
    this.dayHorizonColor = new THREE.Color(0.66, 0.85, 1.0);
    this.dawnHorizonColor = new THREE.Color(1.0, 0.38, 0.14);
    this.duskHorizonColor = new THREE.Color(0.48, 0.17, 0.62);
    this.twilightHorizonColor = new THREE.Color();
    this.nightHemisphereColor = new THREE.Color(0x1b2945);
    this.dayHemisphereColor = new THREE.Color(0xffffff);
    this.hemisphereGroundColor = new THREE.Color(0x1b2534);
    this.nearGrassTint = new THREE.Color(1, 1, 1);
    this.farGrassTint = new THREE.Color(1, 1, 1);
    // Grass keeps its daytime albedo.  Away from direct sun, use restrained
    // blue-grey tints so it reads cooler and less saturated rather than blue.
    this.nightNearGrassTint = new THREE.Color(0.18, 0.23, 0.27);
    this.dayNearGrassTint = new THREE.Color(1, 1, 1);
    this.twilightNearGrassTint = new THREE.Color(0.54, 0.60, 0.61);
    this.sunsetNearGrassTint = new THREE.Color(0.72, 0.62, 0.49);
    this.nightFarGrassTint = new THREE.Color(0.32, 0.38, 0.42);
    this.dayFarGrassTint = new THREE.Color(1, 1, 1);
    this.twilightFarGrassTint = new THREE.Color(0.60, 0.65, 0.67);
    this.sunsetFarGrassTint = new THREE.Color(0.72, 0.61, 0.46);
    this.sun = sky.findDirectionalLight();
    this.moon = new THREE.DirectionalLight(0xaec8ff, 0);
    this.moon.name = "Moonlight";
    this.moon.castShadow = false;
    this.scene.add(this.moon);
    this.hemisphere = null;
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

  update(delta) {
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
    const horizonDusk = 1 - THREE.MathUtils.smoothstep(-0.15, 0.15, this.sunDirection.x);
    // The sun travels toward negative X after noon, making this horizon band
    // sunset only; sunrise retains the cool twilight treatment.
    const sunset = twilight * THREE.MathUtils.smoothstep(-0.15, 0.55, -this.sunDirection.x);
    this.fogColor.lerpColors(this.nightFogColor, this.dayFogColor, daylight);
    this.horizonColor.lerpColors(this.nightHorizonColor, this.dayHorizonColor, daylight);
    this.twilightHorizonColor.lerpColors(this.dawnHorizonColor, this.duskHorizonColor, horizonDusk);
    this.horizonColor.lerp(this.twilightHorizonColor, twilight * 0.68);
    this.nearGrassTint.lerpColors(this.nightNearGrassTint, this.dayNearGrassTint, daylight);
    this.nearGrassTint.lerp(this.twilightNearGrassTint, twilight * 0.52);
    this.nearGrassTint.lerp(this.sunsetNearGrassTint, sunset * 0.18);
    this.farGrassTint.lerpColors(this.nightFarGrassTint, this.dayFarGrassTint, daylight);
    this.farGrassTint.lerp(this.twilightFarGrassTint, twilight * 0.48);
    this.farGrassTint.lerp(this.sunsetFarGrassTint, sunset * 0.15);

    if (this.sun) {
      this.sun.position.copy(this.sunDirection).multiplyScalar(this.sunDistance);
      this.sun.intensity = this.sunIntensity * daylight;
      this.sun.visible = daylight > 0.001;
      this.sun.updateMatrixWorld();
    }
    this.moon.position.copy(this.moonDirection).multiplyScalar(this.sunDistance);
    this.moon.intensity = 1.5 * moonlight;
    this.moon.visible = moonlight > 0.001;
    this.moon.updateMatrixWorld();
    if (this.hemisphere) {
      this.hemisphere.intensity = THREE.MathUtils.lerp(1.5, 1.5, daylight);
      this.hemisphere.color.lerpColors(this.nightHemisphereColor, this.dayHemisphereColor, daylight);
      this.hemisphere.groundColor.copy(this.hemisphereGroundColor);
    }

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
