import * as THREE from "three";
import { Sky } from "./Sky.js";
import { Clouds } from "./Clouds.js";
import { createEnvironmentUniforms } from "./EnvironmentShader.js";
import { normalizeEnvironmentSettings } from "./EnvironmentSettings.js";

// NextWorld's solar arc and twilight ramps, adapted to MaxWorld's custom
// material lighting. No shadow maps or dependencies on NextWorld's loader.
export class EnvironmentSystem {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = normalizeEnvironmentSettings(settings);
    this.timeOfDay = this.settings.timeOfDay;
    this.sky = new Sky(scene);
    this.clouds = new Clouds(scene);
    this.sunDirection = new THREE.Vector3();
    this.moonDirection = new THREE.Vector3();
    this.uniforms = createEnvironmentUniforms();
    this.uniforms.uSkyBackground.value = this.sky.backgroundTarget.texture;
    this.uniforms.uSkyFadeEnabled.value = true;
    this.sun = new THREE.DirectionalLight(0xffefd0, 1.35);
    this.moon = new THREE.DirectionalLight(0xb8ceff, .25);
    this.fill = new THREE.HemisphereLight(0xb9d9ed, 0x4d3c29, 1.15);
    this.sun.name = "Sunlight";
    this.moon.name = "Moonlight";
    scene.add(this.sun, this.moon, this.fill);
    this.dayTint = new THREE.Color(1, 1, 1);
    // Linear moon/sky fill. Display-space terrain converts this illumination
    // before output, keeping grass and rock details readable after sunset.
    this.nightTint = new THREE.Color(.32, .42, .62);
    this.twilightTint = new THREE.Color(1.08, .78, .62);
    this.update(0);
  }

  bindMaterial(material) {
    Object.assign(material.uniforms, this.uniforms);
  }

  configure(changes) {
    this.settings = normalizeEnvironmentSettings({ ...this.settings, ...changes });
    if (changes.timeOfDay !== undefined) this.timeOfDay = this.settings.timeOfDay;
    this.update(0);
  }

  update(delta) {
    // Day length is wall-clock seconds, independent of terrain frame rate.
    // Clouds retain their own capped animation step after a suspended tab.
    const elapsed = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    if (this.settings.cycleEnabled) this.timeOfDay = (this.timeOfDay + elapsed / this.settings.dayDuration) % 1;
    const angle = (this.timeOfDay - .25) * Math.PI * 2;
    this.sunDirection.set(Math.cos(angle), Math.sin(angle), -.35).normalize();
    this.moonDirection.copy(this.sunDirection).multiplyScalar(-1);
    const daylight = THREE.MathUtils.smoothstep(this.sunDirection.y, -.30, .10);
    const stars = 1 - THREE.MathUtils.smoothstep(this.sunDirection.y, -.10, .05);
    const twilight = 1 - THREE.MathUtils.smoothstep(Math.abs(this.sunDirection.y), .03, .32);
    const sunset = twilight * THREE.MathUtils.smoothstep(-this.sunDirection.x, -.15, .55);
    this.uniforms.uLightDirection.value.copy(daylight >= .5 ? this.sunDirection : this.moonDirection);
    this.uniforms.uEnvironmentTint.value.lerpColors(this.nightTint, this.dayTint, daylight);
    this.uniforms.uEnvironmentTint.value.lerp(this.twilightTint, twilight * daylight * .32);
    this.sun.position.copy(this.sunDirection).multiplyScalar(100);
    this.sun.intensity = 1.35 * daylight;
    this.moon.position.copy(this.moonDirection).multiplyScalar(100);
    this.moon.intensity = .30 * (1 - daylight);
    this.fill.intensity = THREE.MathUtils.lerp(.22, 1.15, daylight);
    this.clouds.setEnvironment({ daylight, sunset, sunDirection: this.sunDirection });
    this.clouds.update(elapsed);
    this.sky.setCloudStarOcclusion(this.clouds.cloudMap, this.clouds.time);
    this.sky.setEnvironment({
      nightAmount: 1 - daylight,
      starVisibility: stars,
      sunVisibility: THREE.MathUtils.smoothstep(this.sunDirection.y, -.30, -.03),
      moonVisibility: THREE.MathUtils.smoothstep(this.moonDirection.y, -.30, -.03),
      sunDirection: this.sunDirection,
      moonDirection: this.moonDirection,
    });
  }

  beforeRender(renderer, camera) {
    renderer.getDrawingBufferSize(this.uniforms.uSkyResolution.value);
    this.sky.renderBackground(renderer, camera);
  }

  dispose() {
    this.sky.dispose();
    this.clouds.dispose();
    this.scene.remove(this.sun, this.moon, this.fill);
    this.sun.dispose();
    this.moon.dispose();
  }
}
