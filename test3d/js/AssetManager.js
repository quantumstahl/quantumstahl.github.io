class AssetManager {
    constructor() {
        this.gltfLoader = new THREE.GLTFLoader();

        this.gltfLoader.register((parser) => {
            for (const node of parser.json.nodes || []) {
                // Older MaxPaint3D exports store pivot metadata as an object.
                // Current GLTFLoader reserves `extras.pivot` for its array-based
                // exporter container format and otherwise subtracts it as NaN.
                // The node's standard glTF transforms already contain the pose.
                if (node.extras?.pivot && !Array.isArray(node.extras.pivot)) {
                    delete node.extras.pivot;
                }
            }

            return { name: "CatAdventureLegacyPivotCompatibility" };
        });

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
                                obj.material = this.cloneMaterial(obj.material);
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
                obj.material = this.cloneMaterial(obj.material);
            }
        });

        return clone;
    }

    clear() {
        this.cache.clear();
    }

    cloneMaterial(material) {
        const clone = source => {
            const result = source.clone();
            // Preserve the r140 appearance. The old project explicitly used
            // LinearEncoding for these color maps; NoColorSpace is its current
            // API equivalent.
            if (result.map) result.map.colorSpace = THREE.NoColorSpace;
            result.needsUpdate = true;
            return result;
        };

        return Array.isArray(material) ? material.map(clone) : clone(material);
    }
}
window.AssetManager = AssetManager;
