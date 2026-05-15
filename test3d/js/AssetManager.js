class AssetManager {
    constructor() {
        this.gltfLoader = new THREE.GLTFLoader();

        // path -> Promise<THREE.Group>
        this.cache = new Map();
    }

    async loadGLB(path) {
        if (!path) return null;

        // Om modellen redan laddas eller är laddad, återanvänd samma promise
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        const promise = new Promise((resolve, reject) => {
            this.gltfLoader.load(
                path,
                (gltf) => {
                    const scene = gltf.scene;
      
                    scene.userData.animations = gltf.animations || [];

                    scene.traverse((obj) => {
                        if (obj.isMesh) {
                            obj.frustumCulled = false;
                            obj.castShadow = true;
                            obj.receiveShadow = true;

                            if (obj.material) {
                                obj.material = obj.material.clone();

                                if (obj.material.map) {
                                    obj.material.map.encoding = THREE.LinearEncoding;
                                    obj.material.map.needsUpdate = true;
                                }

                                obj.material.needsUpdate = true;
                            }
                        }
                    });

                    resolve(scene);
                },
                undefined,
                (err) => {
                    console.error("Failed to load GLB:", path, err);
                    reject(err);
                }
            );
        });

        this.cache.set(path, promise);
        return promise;
    }

    
    
    
    async createInstance(path) {
        const original = await this.loadGLB(path);
        if (!original) return null;

        const clone = original.clone(true);
        
        clone.userData.animations = original.userData.animations || [];
        // Viktigt om modellen har material som annars delas mellan instanser
        clone.traverse((obj) => {
            if (obj.isMesh && obj.material) {
                obj.material = obj.material.clone();
            }
        });

        return clone;
    }

    clear() {
        this.cache.clear();
    }
}
window.AssetManager = AssetManager;