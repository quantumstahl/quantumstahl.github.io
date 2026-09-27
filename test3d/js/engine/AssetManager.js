import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Adapted from CatAdventure: cache source GLBs, then clone a fresh scene per map object.
export class AssetManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.localUrls = new Map();
  }

  // Used by the editor for a local preview. The saved map still references
  // assets/name.glb, so putting that file in NextWorld/assets makes it work in
  // both the editor and the game after a reload.
  registerFile(path, file) {
    this.localUrls.get(path) && URL.revokeObjectURL(this.localUrls.get(path));
    this.localUrls.set(path, URL.createObjectURL(file));
    this.cache.delete(path);
  }

  loadGLB(path) {
    if (!path) return Promise.resolve(null);
    if (!this.cache.has(path)) {
      const source = this.localUrls.get(path) ?? path;
      this.cache.set(path, this.loader.loadAsync(source).then(gltf => {
        const scene = gltf.scene;
        scene.userData.animations = gltf.animations ?? [];
        scene.traverse(object => {
          if (object.isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        return scene;
      }));
    }
    return this.cache.get(path);
  }

  async createInstance(path, { cloneMaterials = false } = {}) {
    const source = await this.loadGLB(path);
    if (!source) return null;
    const instance = source.clone(true);
    instance.userData.animations = source.userData.animations;
    if (cloneMaterials) instance.traverse(object => {
      if (object.isMesh && object.material) {
        object.material = Array.isArray(object.material)
          ? object.material.map(material => material.clone())
          : object.material.clone();
      }
    });
    return instance;
  }
}
