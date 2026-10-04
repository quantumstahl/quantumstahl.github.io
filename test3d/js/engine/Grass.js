import * as THREE from "three";

// Dense near-camera grass: one generated crossed-card blade mesh, rendered as
// an InstancedMesh. The old gras.glb remains available for medium-distance
// vegetation and is deliberately not used here.
export class Grass {
  constructor(scene) {
    this.scene = scene; this.root = new THREE.Group(); this.root.name = "Near painted grass"; this.scene.add(this.root);
    this.radius = 42; this.fadeStart = 20; this.fadeEnd = 50; this.maxVisible = 24000;
    this.tramplePosition = new THREE.Vector3(1e6, 0, 1e6); this.trampleRadius = 2.00; this.trampleFlatten = 1.5; this.trampleBend = 0.80;
    this.environmentTint = new THREE.Color(0.00, 0.00, 0.00);
    this.textureend=scene.fog.far+200;
    this.matrix = new THREE.Matrix4(); this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion(); this.scale = new THREE.Vector3(); this.lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity); this.lastCameraDirection = new THREE.Vector3(); this.cameraDirection = new THREE.Vector3(); this.viewPoint = new THREE.Vector3(); this.viewProjection = new THREE.Matrix4(); this.frustum = new THREE.Frustum(); this.hasCameraDirection = false; this.dirty = true; this.sunDirection = new THREE.Vector3(.4, .8, .2).normalize(); this.sunPosition = new THREE.Vector3(); this.sunTargetPosition = new THREE.Vector3(); this.sunBacklight = 1; this.backlightCameraPosition = new THREE.Vector3();
    this.geometry = this.createBladeGeometry(); this.material = this.createMaterial(); 
    this.grassSphere = new THREE.Sphere();
    this.createMesh();
    this.grassGrid = new Map();
    this.gridCellSize = 5;
    this.gridDirty = true;
    // Far grass is a broad procedural surface, so 2 m cells retain the
    // appearance while reducing its streamed geometry substantially.
    this.farGrassCellSize = 2;
    // Keep the low-detail surface above small terrain interpolation errors on
    // hills. This is a vertical offset only: it does not add any geometry.
    this.farGrassSurfaceOffset = 0.20;
    this.farGrassOpacity = 1.0;

    this.farGrassMesh = null;
    this.farGrassMaterial = this.createFarGrassMaterial();

    this.farGrassNeedsRebuild = true;
    this.farGrassRebuildTimer = 0;
    this.chunkGrassSignature = "";

    this.environmentsun=true;
    this.pendingGrassGridBuild = null;

    this.grassBuildPointsPerFrame = 5000;
    this.grassBuildCellsPerFrame = 12;

    this.farGrassBuildJob = null;

    // Börja försiktigt på mobil.
    this.farGrassPointsPerFrame = 8000;
    this.farGrassCellsPerFrame = 1000;
  }
  createFarGrassMaterial() {

    const material = new THREE.ShaderMaterial({

        transparent: true,
        depthWrite: false,
        depthTest: true,

        uniforms: {

            uFadeStart: {
                value: this.fadeStart
            },

            uFadeEnd: {
                value: this.fadeEnd
            },

            uTextureEnd: {
                value: this.textureend
            },

            uOpacity: {
                value: this.farGrassOpacity
            },
            uTime:{
              value:0

            },
            uEnvironmentTint: {
              value: this.environmentTint
            },
            uEnvironmentSun: {
              value: this.environmentsun
            },
            uBackgroundTexture: {
              value: new THREE.Texture()
            },
            uFogNear: {
              value: this.scene.fog?.near ?? 50
            },
            uFogFar: {
              value: this.scene.fog?.far ?? 70
            }

        },

        vertexShader: `

            varying vec3 vWorldPosition;
            varying float vCoverage;
            varying float vOuterBackgroundFade;
            varying vec4 vClipPosition;
            varying float vFogDepth;
            attribute float coverage;
            attribute float outerBackgroundFade;

            void main() {

                vec4 worldPosition =
                    modelMatrix * vec4(position, 1.0);

                vWorldPosition = worldPosition.xyz;
                vCoverage = coverage;
                vOuterBackgroundFade = outerBackgroundFade;

                vec4 viewPosition = viewMatrix * worldPosition;
                gl_Position = projectionMatrix * viewPosition;
                vClipPosition = gl_Position;
                vFogDepth = -viewPosition.z;
            }

        `,

        fragmentShader: `

            uniform float uFadeStart;
            uniform float uFadeEnd;
            uniform float uTextureEnd;
            uniform float uOpacity;
            uniform float uTime;
            uniform vec3 uEnvironmentTint;
            uniform float uEnvironmentSun;
            uniform sampler2D uBackgroundTexture;
            uniform float uFogNear;
            uniform float uFogFar;

            varying vec3 vWorldPosition;
            varying float vCoverage;
            varying float vOuterBackgroundFade;
            varying vec4 vClipPosition;
            varying float vFogDepth;


            float hash(vec2 p) {

                return fract(
                    sin(
                        dot(
                            p,
                            vec2(127.1, 311.7)
                        )
                    ) * 43758.5453
                );
            }


            float noise(vec2 p) {

                vec2 i = floor(p);
                vec2 f = fract(p);

                f = f * f * (3.0 - 2.0 * f);

                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));

                return mix(
                    mix(a, b, f.x),
                    mix(c, d, f.x),
                    f.y
                );
            }
            float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    // Smooth interpolation
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(
        mix(a, b, f.x),
        mix(c, d, f.x),
        f.y
    );
}

            void main() {


                vec2 p = vWorldPosition.xz;


float d = distance(vWorldPosition.xz, cameraPosition.xz);

float patches = vnoise(vWorldPosition.xz * 0.15);
float mid     = vnoise(vWorldPosition.xz * 1.3);
float fine    = vnoise(vWorldPosition.xz * vec2(220.0, 110.0));



// Minska de små detaljerna långt bort
fine = mix(fine, 0.5, smoothstep(30.0, 120.0, d));


float grassNoise =
      patches * 0.1
    + mid     * 0.35
    + fine    * 0.90;




    float wave =
        sin(p.x * 0.18 + uTime * 1.4) *
        sin(p.y * 0.11 + uTime * 1.1);

    wave = wave * 0.5 + 0.5;

    grassNoise += (wave - 0.5) * 0.4;
    grassNoise = clamp(grassNoise, 0.0, 1.0);



vec3 darkGrass  = vec3(0.141, 0.325, 0.129);


vec3 lightGrass = vec3(0.467, 0.702, 0.251);

vec3 grassColor = mix(darkGrass, lightGrass, grassNoise);

float grassLOD = smoothstep(2500.0, 55.0, d);

grassColor = mix(grassColor, darkGrass,grassLOD * 0.1);

float macroNoise = noise(vWorldPosition.xz * 0.99); // eller ännu lägre om du vill ha större fält
float macroTint  = mix(0.92, 1.08, macroNoise);

grassColor.rgb *= macroTint;



// mörkare precis när distant grass börjar synas

// Keep the far-grass transition neutral; darkening this edge makes a visible horizon band.





                    vec3 savecolor =grassColor.rgb;
                 grassColor.rgb-=grassColor.rgb;
                grassColor.rgb += uEnvironmentTint+savecolor;

                
                    grassColor.rgb *=((-1.00+uEnvironmentSun)*0.70)+1.0;









                // Bara XZ-avstånd.
                // Höjdskillnader skall inte påverka LOD.

                float distanceToCamera =
                    distance(
                        vWorldPosition.xz,
                        cameraPosition.xz
                    );

                // The far-grass material is custom, so it does not use
                // Three's fog chunk. Blend to the captured sky here instead
                // of fading its alpha toward the older blue fog colour.
                vec2 backgroundUv = vClipPosition.xy / vClipPosition.w * 0.5 + 0.5;
                vec3 backgroundColor = texture2D(uBackgroundTexture, backgroundUv).rgb;
                // Finish far grass before the terrain's own fog reaches the
                // horizon. Keeping both fades on precisely the same boundary
                // leaves a thin, view-dependent green seam at the skyline.
                float farGrassFogNear = uFogNear-1.0;
                float farGrassFogFar = uFogNear;
                float skyFade = smoothstep(farGrassFogNear, farGrassFogFar, vFogDepth);
                float backgroundFade = max(skyFade, vOuterBackgroundFade);
                grassColor = mix(grassColor, backgroundColor, backgroundFade);


                // Börja visa markgräset lite innan
                // 3D-gräset är helt borta.

                float nearFade =
                    smoothstep(
                        uFadeStart - 15.0,
                        uFadeEnd,
                        distanceToCamera
                    );


                // Försvinn väldigt långt bort.

                // Sky-colour blending is the far fade; do not fade alpha a second time.
                float farFade = 1.0;


                float alpha =
                    nearFade *
                    farFade *
                    uOpacity *
                    smoothstep(0.0, 1.0, vCoverage) *
                    (1.0 - backgroundFade);


                if (alpha < 0.01) {
                    discard;
                }


                gl_FragColor =
                    vec4(
                        grassColor,
                        alpha
                    );
            }

        `
    });
    
   material.uniforms.uFogNear.value = this.scene.fog.far;
      material.uniforms.uFogFar.value = this.scene.fog.far;
    return material;
}
rebuildFarGrass() {

    this.farGrassNeedsRebuild = false;
    this.farGrassRebuildTimer = 0;


    if (
        !this.config?.enabled ||
        !this.terrain ||
        !this.config.points?.length
    ) {

        if (this.farGrassMesh) {
            this.farGrassMesh.visible = false;
        }

        return;
    }


    const cellSize =
        this.farGrassCellSize;


    // Samla alla grid-celler där det finns målat gräs.

    const cells =
        new Set();
    const cellOuterFades = new Map();


    for (const blade of this.config.points) {

        const cellX =
            Math.floor(
                blade.x / cellSize
            );

        const cellZ =
            Math.floor(
                blade.z / cellSize
            );

        const key = `${cellX},${cellZ}`;
        cells.add(key);
        cellOuterFades.set(key, Math.max(cellOuterFades.get(key) ?? 0, blade._farOuterFade ?? 0));
    }

    // Include a one-cell border around the painted cells. Coverage values at
    // shared vertices fade that border out, avoiding the hard square outline
    // of the old one-quad-per-cell mesh.
    const renderCells = new Set();

    for (const key of cells) {
        const [cellX, cellZ] = key.split(",").map(Number);

        for (let offsetX = -1; offsetX <= 1; offsetX++) {
            for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
                renderCells.add(`${cellX + offsetX},${cellZ + offsetZ}`);
            }
        }
    }

    const vertexCoverage = (vertexX, vertexZ) => {
        let occupied = 0;

        for (let offsetX = -1; offsetX <= 0; offsetX++) {
            for (let offsetZ = -1; offsetZ <= 0; offsetZ++) {
                if (cells.has(`${vertexX + offsetX},${vertexZ + offsetZ}`)) {
                    occupied++;
                }
            }
        }

        return occupied / 4;
    };

    const vertexOuterFade = (vertexX, vertexZ) => {
        let fade = 0;
        for (let offsetX = -1; offsetX <= 0; offsetX++) {
            for (let offsetZ = -1; offsetZ <= 0; offsetZ++) {
                fade = Math.max(fade, cellOuterFades.get(`${vertexX + offsetX},${vertexZ + offsetZ}`) ?? 0);
            }
        }
        return fade;
    };


    const positions = [];
    const coverage = [];
    const outerBackgroundFade = [];
    const indices = [];

    let vertexIndex = 0;


    for (const key of renderCells) {

        const parts =
            key.split(",");

        const cellX =
            Number(parts[0]);

        const cellZ =
            Number(parts[1]);


        const x0 =
            cellX * cellSize;

        const z0 =
            cellZ * cellSize;

        const x1 =
            x0 + cellSize;

        const z1 =
            z0 + cellSize;


        // Lite ovanför marken för att undvika z-fighting.

        const offsetY = this.farGrassSurfaceOffset;


        const y00 =
            (
                this.terrain.getHeightAt({
                    x: x0,
                    z: z0
                }) ?? 0
            ) + offsetY;


        const y10 =
            (
                this.terrain.getHeightAt({
                    x: x1,
                    z: z0
                }) ?? 0
            ) + offsetY;


        const y11 =
            (
                this.terrain.getHeightAt({
                    x: x1,
                    z: z1
                }) ?? 0
            ) + offsetY;


        const y01 =
            (
                this.terrain.getHeightAt({
                    x: x0,
                    z: z1
                }) ?? 0
            ) + offsetY;


        positions.push(

            x0, y00, z0,
            x1, y10, z0,
            x1, y11, z1,
            x0, y01, z1

        );

        coverage.push(
            vertexCoverage(cellX, cellZ),
            vertexCoverage(cellX + 1, cellZ),
            vertexCoverage(cellX + 1, cellZ + 1),
            vertexCoverage(cellX, cellZ + 1)
        );
        outerBackgroundFade.push(
            vertexOuterFade(cellX, cellZ),
            vertexOuterFade(cellX + 1, cellZ),
            vertexOuterFade(cellX + 1, cellZ + 1),
            vertexOuterFade(cellX, cellZ + 1)
        );


        // Winding uppåt.

        indices.push(

            vertexIndex,
            vertexIndex + 2,
            vertexIndex + 1,

            vertexIndex,
            vertexIndex + 3,
            vertexIndex + 2

        );


        vertexIndex += 4;
    }


    const geometry =
        new THREE.BufferGeometry();


    geometry.setAttribute(

        "position",

        new THREE.Float32BufferAttribute(
            positions,
            3
        )
    );

    geometry.setAttribute(
        "coverage",
        new THREE.Float32BufferAttribute(coverage, 1)
    );
    geometry.setAttribute(
        "outerBackgroundFade",
        new THREE.Float32BufferAttribute(outerBackgroundFade, 1)
    );


    geometry.setIndex(indices);


    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();


    if (!this.farGrassMesh) {

        this.farGrassMesh =
            new THREE.Mesh(
                geometry,
                this.farGrassMaterial
            );


        this.farGrassMesh.name =
            "Far grass ground shader";


        this.farGrassMesh.castShadow = false;
        this.farGrassMesh.receiveShadow = false;


        this.root.add(
            this.farGrassMesh
        );

    } else {

        this.farGrassMesh.geometry.dispose();

        this.farGrassMesh.geometry =
            geometry;

        this.farGrassMesh.visible =
            true;
    }
}
createBladeGeometry() {

    const positions = [];
    const colors = [];

    const blades = 30;

    const baseColor = new THREE.Color(0x245321);
    const tipColor  = new THREE.Color(0x6c973f);
    for (let blade = 0; blade < blades; blade++) {

        const angle = blade * 2.39996;

        const radial =
            blade === 0
                ? 0
                : 0.04 + (blade % 30) * 0.025;

        const cx = Math.cos(angle) * radial;
        const cz = Math.sin(angle) * radial;

        const height =
            0.40 + (blade % 30) * 0.04;

        const baseWidth =
            0.010 + (blade % 7) * 0.003;

        const lean =
            0.05 + (blade % 20) * 0.012;

        const leanX = Math.cos(angle) * lean;
        const leanZ = Math.sin(angle) * lean;

        // Direction sideways from blade
        const rightX =
            Math.cos(angle + Math.PI * 0.5);

        const rightZ =
            Math.sin(angle + Math.PI * 0.5);


        // LEFT BASE
        positions.push(
            cx - rightX * baseWidth,
            0,
            cz - rightZ * baseWidth
        );

        // RIGHT BASE
        positions.push(
            cx + rightX * baseWidth,
            0,
            cz + rightZ * baseWidth
        );

        // TIP
        positions.push(
            cx + leanX,
            height,
            cz + leanZ
        );


        // Base colors
        colors.push(
            baseColor.r,
            baseColor.g,
            baseColor.b
        );

        colors.push(
            baseColor.r,
            baseColor.g,
            baseColor.b
        );

        // Tip color
        colors.push(
            tipColor.r,
            tipColor.g,
            tipColor.b
        );
    }


    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            positions,
            3
        )
    );

    geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
            colors,
            3
        )
    );


    return geometry;
}
buildGrassGrid() {

    this.grassGrid.clear();

    const cellSize = this.gridCellSize;

    // Sortera gräset i celler
    for (const blade of this.config.points) {

        const cellX = Math.floor(blade.x / cellSize);
        const cellZ = Math.floor(blade.z / cellSize);

        let column = this.grassGrid.get(cellX);

        if (!column) {
            column = new Map();
            this.grassGrid.set(cellX, column);
        }

        let cell = column.get(cellZ);

        if (!cell) {
            cell = {
                blades: [],
                matrices: null,
                box: null,
                minY: Infinity,
                maxY: -Infinity
            };

            column.set(cellZ, cell);
        }

        cell.blades.push(blade);

        const y = blade.y ?? 0;

        const grassHeight =
            0.7 *
            blade.scale *
            (blade.height ?? 1);

        cell.minY = Math.min(
            cell.minY,
            y
        );

        cell.maxY = Math.max(
            cell.maxY,
            y + grassHeight
        );
    }


    // Bygg matriser + bounding box EN GÅNG
    for (const [cellX, column] of this.grassGrid) {

        for (const [cellZ, cell] of column) {

            const count = cell.blades.length;

            cell.matrices =
                new Float32Array(count * 16);

            let offset = 0;

            for (const blade of cell.blades) {

                this.position.set(
                    blade.x,
                    blade.y ?? 0,
                    blade.z
                );

                this.rotation.setFromAxisAngle(
                    THREE.Object3D.DEFAULT_UP,
                    blade.rotation
                );

                this.scale.set(
                    blade.scale,
                    blade.scale * (blade.height ?? 1),
                    blade.scale
                );

                this.matrix.compose(
                    this.position,
                    this.rotation,
                    this.scale
                );

                cell.matrices.set(
                    this.matrix.elements,
                    offset
                );

                offset += 16;
            }


            const minX = cellX * cellSize;
            const minZ = cellZ * cellSize;

            const maxX = minX + cellSize;
            const maxZ = minZ + cellSize;

            // Lite extra marginal för vind/gräsets lutning.
            cell.box = new THREE.Box3(
                new THREE.Vector3(
                    minX - 1,
                    cell.minY - 0.2,
                    minZ - 1
                ),
                new THREE.Vector3(
                    maxX + 1,
                    cell.maxY + 1,
                    maxZ + 1
                )
            );

            cell.minX = minX;
            cell.maxX = maxX;
            cell.minZ = minZ;
            cell.maxZ = maxZ;
        }
    }

    this.gridDirty = false;
}


getGrassCell(cellX, cellZ) {
    return this.grassGrid.get(cellX)?.get(cellZ);
}
getOrCreateGrassCell(cellX, cellZ) {
    let column = this.grassGrid.get(cellX);

    if (!column) {
        column = new Map();
        this.grassGrid.set(cellX, column);
    }

    let cell = column.get(cellZ);

    if (!cell) {
        cell = { blades: [], matrices: null, box: null };
        column.set(cellZ, cell);
    }

    return cell;
}
rebuildGrassCell(cellX, cellZ, cell) {
    const cellSize = this.gridCellSize;
    const count = cell.blades.length;

    cell.matrices = new Float32Array(count * 16);

    let minY = Infinity;
    let maxY = -Infinity;
    let offset = 0;

    for (const blade of cell.blades) {
        const y = blade.y ?? 0;
        const grassHeight = 0.7 * blade.scale * (blade.height ?? 1);

        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + grassHeight);

        this.position.set(blade.x, y, blade.z);
        this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, blade.rotation);
        this.scale.set(blade.scale, blade.scale * (blade.height ?? 1), blade.scale);
        this.matrix.compose(this.position, this.rotation, this.scale);
        cell.matrices.set(this.matrix.elements, offset);
        offset += 16;
    }

    const minX = cellX * cellSize;
    const minZ = cellZ * cellSize;

    cell.minX = minX;
    cell.maxX = minX + cellSize;
    cell.minZ = minZ;
    cell.maxZ = minZ + cellSize;
    cell.box = new THREE.Box3(
        new THREE.Vector3(minX - 1, minY - 0.2, minZ - 1),
        new THREE.Vector3(cell.maxX + 1, maxY + 1, cell.maxZ + 1)
    );
}
cacheGroundHeights() {

    if (!this.config?.points || !this.terrain) {
        return;
    }

    for (const blade of this.config.points) {

        if (blade.y !== undefined) {
            continue;
        }

        blade.y =
            this.terrain.getHeightAt({
                x: blade.x,
                z: blade.z
            }) ?? 0;
    }
}
createMaterial() {

    const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide
    });

    material.onBeforeCompile = shader => {

        // När individuella grässtrån börjar försvinna
        shader.uniforms.uFadeStart = { value: this.fadeStart };
        shader.uniforms.uFadeEnd   = { value: this.fadeEnd };

        // Högt gräs börjar bli kortare tidigare
        shader.uniforms.uHeightFadeStart = { value: 0 };
        shader.uniforms.uHeightFadeEnd   = { value: this.fadeStart*1.1 };

        // Hur högt gräset är när det nått mark-shader-området.
        // 0.20 = 20% av normal höjd.
        shader.uniforms.uFarHeight = { value: 0.40 };

        shader.uniforms.uGrassTime = { value: 0 };
        shader.uniforms.uTramplePosition = { value: this.tramplePosition };
        shader.uniforms.uTrampleRadius = { value: this.trampleRadius };
        shader.uniforms.uTrampleFlatten = { value: this.trampleFlatten };
        shader.uniforms.uTrampleBend = { value: this.trampleBend };
        shader.uniforms.uSunDirection = { value: this.sunDirection };
        shader.uniforms.uSunBacklight = { value: this.sunBacklight };
        shader.uniforms.uBacklightCameraPosition = { value: this.backlightCameraPosition };
        // Keep the original green blade palette in the vertex buffer. The
        // changing atmosphere tint is applied in the fragment shader so it
        // works for every instance without rewriting that buffer each frame.
        shader.uniforms.uEnvironmentTint = { value: this.environmentTint };
        shader.uniforms.uEnvironmentSun = { value: this.environmentsun };

        shader.vertexShader = shader.vertexShader

            .replace(
                "#include <common>",
                `
                #include <common>

                uniform float uGrassTime;

                uniform float uFadeStart;
                uniform float uFadeEnd;

                uniform float uHeightFadeStart;
                uniform float uHeightFadeEnd;
                uniform float uFarHeight;
                uniform vec3 uTramplePosition;
                uniform float uTrampleRadius;
                uniform float uTrampleFlatten;
                uniform float uTrampleBend;
                varying float vBladeTip;
                varying vec3 vGrassWorldPosition;
                `
            )

            .replace(
                "#include <begin_vertex>",
                `
                #include <begin_vertex>


                // Position för denna instans i world-space
                vec3 iPos = (
                    modelMatrix *
                    instanceMatrix *
                    vec4(0.0, 0.0, 0.0, 1.0)
                ).xyz;


                float dXZ = distance(
                    iPos.xz,
                    cameraPosition.xz
                );


                // ------------------------------------------------
                // 1. HEIGHT LOD
                //
                // Högt gräs blir gradvis kortare innan vi börjar
                // ta bort individuella strån.
                // ------------------------------------------------

                float heightFade = smoothstep(
                    uHeightFadeStart,
                    uHeightFadeEnd,
                    dXZ-5.0
                );

                float grassHeightScale = mix(
                    1.0,
                    uFarHeight,
                    heightFade
                );

                transformed.y *= grassHeightScale;


                // ------------------------------------------------
                // 2. DENSITY FADE
                //
                // Börjar senare. Slumpmässiga strån försvinner
                // gradvis istället för att hela fältet kapas.
                // ------------------------------------------------

                float keep =
                    1.0 -
                    smoothstep(
                        uFadeStart,
                        uFadeEnd,
                        dXZ
                    );


                float rnd = fract(
                    sin(
                        dot(
                            iPos.xz,
                            vec2(12.9898, 78.233)
                        )
                    ) *
                    43758.5453
                );


                float grow = clamp(
                    (keep * 1.2 - rnd) / 0.2,
                    0.0,
                    1.0
                );


                // När ett strå försvinner krymper hela bladet.
                // Height-LOD däremot ändrar bara Y.
                transformed *= grow;
                vBladeTip = clamp(position.y / 1.55, 0.0, 1.0);
                `
            )

            .replace(
                "#include <project_vertex>",
                `

                vec4 mvPosition =
                    instanceMatrix *
                    vec4(transformed, 1.0);

                // The cat presses nearby blades down and pushes their tips
                // away. This is one shared shader interaction, not per-blade
                // CPU work, so it remains suitable for the instanced mesh.
                vec2 trampleOffset = iPos.xz - uTramplePosition.xz;
                float trampleDistance = length(trampleOffset);
                float trample = 1.0 - smoothstep(uTrampleRadius * 0.35, uTrampleRadius, trampleDistance);
                float bladeTip = clamp(position.y / 1.55, 0.0, 1.0);
                vec2 pushDirection = trampleDistance > 0.001 ? trampleOffset / trampleDistance : vec2(1.0, 0.0);
                mvPosition.xz += pushDirection * trample * bladeTip * uTrampleBend;
                mvPosition.y = mix(mvPosition.y, iPos.y, trample * bladeTip * uTrampleFlatten);


                // ------------------------------------------------
                // WIND
                // ------------------------------------------------

                float hgt = max(position.y * 1.55, 0.0);
                hgt *= hgt;


                float ph =
                    iPos.x * 0.35 +
                    iPos.z * 0.28 +
                    position.x * 17.3 +
                    uGrassTime * 1.6;


                // Kortare distant grass behöver också mindre vind.
                float w =
                    sin(ph) *
                    0.05 *
                    hgt *
                    grassHeightScale *
                    grow;


                mvPosition.x += w;
                mvPosition.z += w * 0.4;


                vec4 grassWorldPosition = modelMatrix * mvPosition;
                vGrassWorldPosition = grassWorldPosition.xyz;
                mvPosition = viewMatrix * grassWorldPosition;


                gl_Position =
                    projectionMatrix *
                    mvPosition;
                `
            );

        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                `
                #include <common>
                uniform vec3 uSunDirection;
                uniform float uSunBacklight;
                uniform vec3 uBacklightCameraPosition;
                uniform vec3 uEnvironmentTint;
                uniform float uEnvironmentSun;
                varying float vBladeTip;
                varying vec3 vGrassWorldPosition;
                `
            )
            .replace(
                "#include <color_fragment>",
                `
                #include <color_fragment>
                vec3 savecolor =diffuseColor.rgb;

               

                diffuseColor.rgb-=diffuseColor.rgb;
                diffuseColor.rgb += uEnvironmentTint+savecolor;

                
                    diffuseColor.rgb *=((-1.00+uEnvironmentSun)*0.70)+1.0;
                

                
                // blade when the camera is looking toward the sun.
                vec3 viewToBlade = normalize(vGrassWorldPosition - uBacklightCameraPosition);
                float towardSun = smoothstep(0.52, 0.94, dot(viewToBlade, uSunDirection));
                float tipGlow = smoothstep(0.48, 0.95, vBladeTip) * towardSun * uSunBacklight;
                diffuseColor.rgb += vec3(0.21, 0.075, 0.018) * tipGlow;
                `
            );

        material.userData.grassShader = shader;
    };


    material.customProgramCacheKey = () =>
        "next-world-grass-height-lod-trample-backlight-environment-v7";


    return material;
}
  async apply(config, terrain) {

    this.config = config;
    this.terrain = terrain;
    this.farGrassNeedsRebuild = true;
    // The streamed far-grass job is advanced from update() in small slices.
    // Do not call the legacy synchronous builder here.
    this.root.visible = Boolean(config?.enabled);

    this.cacheGroundHeights();

    this.gridDirty = true;
    this.dirty = true;
}
  applyChunked(config, terrain, chunks = []) {
    // Keep renderer-only point data separate from the manifest. Each chunk
    // remains the owner of its grass payload and can be discarded on unload.
    this.chunkedConfig = config;
    this.config = { ...config, points: [] };
    this.terrain = terrain;
    this.chunkGrassSignature = "";
    this.setChunkedChunks(chunks);
    this.root.visible = Boolean(config?.enabled);
  }
  setChunkedChunks(chunks = []) {
    if (!this.chunkedConfig) return;
    // The renderer is already one shared InstancedMesh. Avoid rebuilding its
    // grid and the shared far-grass mesh when a stream callback reports the
    // same chunk grass data again.
    const signature = chunks
      .map(chunk => `${chunk.x},${chunk.z}:${chunk.grass?.points?.length ?? 0}:${chunk.grass?.revision ?? 0}:${chunk._decorativeOuterEdges?.join("") ?? ""}:${chunk._decorativeOuterCorners?.join("") ?? ""}`)
      .sort()
      .join("|");
    if (signature === this.chunkGrassSignature) return;
    this.chunkGrassSignature = signature;
    this.config.points = chunks.flatMap(chunk =>
      (chunk.grass?.points ?? []).map(point => ({
        ...point,
        // Only the static far-grass surface reads this value. Near instanced
        // blades retain their original material and do not fade at the edge.
        _farOuterFade: this.getFarOuterFade(chunk, point)
      }))
    );
    this.farGrassNeedsRebuild = true;
    this.queueGrassGridRebuild();
    this.dirty = true;
  }
  queueGrassGridRebuild() {
        this.pendingGrassGridBuild = {
            points: this.config?.points ?? [],
            pointIndex: 0,
            grid: new Map(),

            cells: null,
            cellIndex: 0,

            phase: "points"
        };
    }
    processGrassGridRebuild() {
    const job = this.pendingGrassGridBuild;

    if (!job) return;

    const cellSize = this.gridCellSize;


    // ----------------------------------------
    // PHASE 1
    // Lägg punkter i grid över flera frames
    // ----------------------------------------

    if (job.phase === "points") {

        const end = Math.min(
            job.pointIndex + this.grassBuildPointsPerFrame,
            job.points.length
        );

        for (; job.pointIndex < end; job.pointIndex++) {

            const blade = job.points[job.pointIndex];

            const cellX =
                Math.floor(blade.x / cellSize);

            const cellZ =
                Math.floor(blade.z / cellSize);


            let column = job.grid.get(cellX);

            if (!column) {
                column = new Map();
                job.grid.set(cellX, column);
            }


            let cell = column.get(cellZ);

            if (!cell) {

                cell = {
                    blades: [],
                    matrices: null,
                    box: null,
                    minY: Infinity,
                    maxY: -Infinity
                };

                column.set(cellZ, cell);
            }


            cell.blades.push(blade);

            const y =
                blade.y ?? 0;

            const grassHeight =
                0.7 *
                blade.scale *
                (blade.height ?? 1);


            cell.minY =
                Math.min(cell.minY, y);

            cell.maxY =
                Math.max(
                    cell.maxY,
                    y + grassHeight
                );
        }


        if (job.pointIndex >= job.points.length) {

            job.cells = [];

            for (const [cellX, column] of job.grid) {

                for (const [cellZ, cell] of column) {

                    job.cells.push({
                        cellX,
                        cellZ,
                        cell
                    });

                }
            }

            job.phase = "cells";
        }

        return;
    }


    // ----------------------------------------
    // PHASE 2
    // Bygg matrices några celler per frame
    // ----------------------------------------

    const end = Math.min(
        job.cellIndex + this.grassBuildCellsPerFrame,
        job.cells.length
    );


    for (; job.cellIndex < end; job.cellIndex++) {

        const {
            cellX,
            cellZ,
            cell
        } = job.cells[job.cellIndex];


        const count =
            cell.blades.length;


        cell.matrices =
            new Float32Array(
                count * 16
            );


        let offset = 0;


        for (const blade of cell.blades) {

            const y =
                blade.y ?? 0;


            this.position.set(
                blade.x,
                y,
                blade.z
            );


            this.rotation.setFromAxisAngle(
                THREE.Object3D.DEFAULT_UP,
                blade.rotation
            );


            this.scale.set(
                blade.scale,
                blade.scale * (blade.height ?? 1),
                blade.scale
            );


            this.matrix.compose(
                this.position,
                this.rotation,
                this.scale
            );


            cell.matrices.set(
                this.matrix.elements,
                offset
            );


            offset += 16;
        }


        const minX =
            cellX * cellSize;

        const minZ =
            cellZ * cellSize;


        cell.minX = minX;
        cell.maxX = minX + cellSize;

        cell.minZ = minZ;
        cell.maxZ = minZ + cellSize;


        cell.box =
            new THREE.Box3(

                new THREE.Vector3(
                    cell.minX - 1,
                    cell.minY - 0.2,
                    cell.minZ - 1
                ),

                new THREE.Vector3(
                    cell.maxX + 1,
                    cell.maxY + 1,
                    cell.maxZ + 1
                )

            );
    }


    // ----------------------------------------
    // KLAR
    // Swap först när hela nya gridet är klart
    // ----------------------------------------

    if (job.cellIndex >= job.cells.length) {

        this.grassGrid =
            job.grid;

        this.pendingGrassGridBuild =
            null;

        this.gridDirty =
            false;

        this.dirty =
            true;
    }
}
  getFarOuterFade(chunk, point) {
    if (!chunk._decorative) return 0;
    const edges = chunk._decorativeOuterEdges ?? [0, 0, 0, 0];
    const corners = chunk._decorativeOuterCorners ?? [0, 0, 0, 0];
    if (!edges.some(Boolean) && !corners.some(Boolean)) return 0;

    const size = this.terrain?.chunkSize ?? 50;
    const u = (point.x - chunk.x * size) / size;
    const v = (point.z - chunk.z * size) / size;
    let distance = Infinity;
    if (edges[0]) distance = Math.min(distance, u);
    if (edges[1]) distance = Math.min(distance, 1 - u);
    if (edges[2]) distance = Math.min(distance, 1 - v);
    if (edges[3]) distance = Math.min(distance, v);
    if (corners[0]) distance = Math.min(distance, Math.hypot(u, 1 - v));
    if (corners[1]) distance = Math.min(distance, Math.hypot(1 - u, 1 - v));
    if (corners[2]) distance = Math.min(distance, Math.hypot(u, v));
    if (corners[3]) distance = Math.min(distance, Math.hypot(1 - u, v));
    return 1 - THREE.MathUtils.smoothstep(distance, 0, 0.30);
  }
  paintChunked(point, radius, getChunkAt, chunks) {
    if (!this.chunkedConfig?.enabled || radius <= 0) return false;
    const count = Math.max(3, Math.round(radius * radius * this.chunkedConfig.density));
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * radius;
      const x = point.x + Math.cos(angle) * distance;
      const z = point.z + Math.sin(angle) * distance;
      const chunk = getChunkAt({ x, z });
      if (!chunk) continue;
      chunk.grass ??= { points: [] };
      chunk.grass.points ??= [];
      chunk.grass.points.push({
        x, z,
        y: this.terrain?.getHeightAt({ x, z }) ?? 0,
        scale: 0.7 + Math.random() * 0.6,
        height: 0.75 + Math.random() * 0.35,
        rotation: Math.random() * Math.PI * 2
      });
    }
    this.setChunkedChunks(chunks);
    return true;
  }
  eraseChunked(point, radius, chunks) {
    const radiusSq = radius ** 2;
    let changed = false;
    for (const chunk of chunks) {
      const points = chunk.grass?.points ?? [];
      const kept = points.filter(blade => (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq);
      if (kept.length !== points.length) { chunk.grass.points = kept; changed = true; }
    }
    if (changed) this.setChunkedChunks(chunks);
    return changed;
  }
  setSunDirection(sun) {
    if (!sun?.isDirectionalLight || !sun.target) return false;
    sun.updateWorldMatrix(true, false); sun.target.updateWorldMatrix(true, false); sun.getWorldPosition(this.sunPosition); sun.target.getWorldPosition(this.sunTargetPosition);
    const direction = this.sunPosition.sub(this.sunTargetPosition); if (direction.lengthSq() < 1e-8) return false;
    this.sunDirection.copy(direction.normalize());
    this.sunBacklight = sun.visible ? THREE.MathUtils.clamp(sun.intensity / 2, 0, 1) : 0;
    const shader = this.material.userData.grassShader;
    if (shader) {
      shader.uniforms.uSunDirection.value.copy(this.sunDirection);
      shader.uniforms.uSunBacklight.value = this.sunBacklight;
    }
    return true;
  }
  setEnvironmentTint(grassTint,issunup) {
    if (!grassTint) return;
    
    this.environmentTint.lerp(grassTint,issunup);
   
    this.environmentsun=issunup;
    const shader = this.material.userData.grassShader;
    if (shader) {
      shader.uniforms.uEnvironmentSun.value = this.environmentsun;
      shader.uniforms.uEnvironmentTint.value = this.environmentTint;
    }
    const shader2 = this.farGrassMaterial;
    if (shader2) {
      shader2.uniforms.uEnvironmentSun.value = this.environmentsun;
      shader2.uniforms.uEnvironmentTint.value = this.environmentTint;
    }

  }
  setBackgroundFade(backgroundTexture, fog) {
    if (!backgroundTexture || !this.farGrassMaterial) return;
    const uniforms = this.farGrassMaterial.uniforms;
    uniforms.uBackgroundTexture.value = backgroundTexture;
    uniforms.uFogNear.value = fog?.near ?? 50;
    uniforms.uFogFar.value = fog?.far ?? 70;
  }
  setTramplePosition(position) {
    if (position) this.tramplePosition.copy(position);
    const shader = this.material.userData.grassShader;
    if (!shader) return;
    shader.uniforms.uTramplePosition.value.copy(this.tramplePosition);
    shader.uniforms.uTrampleRadius.value = this.trampleRadius;
    shader.uniforms.uTrampleFlatten.value = this.trampleFlatten;
    shader.uniforms.uTrampleBend.value = this.trampleBend;
  }
  paint(config, terrain, point, radius) {
      if (!config?.enabled || radius <= 0) return false;

      const count = Math.max(
          3,
          Math.round(radius * radius * config.density)
      );

      const paintedBlades = [];

      for (let i = 0; i < count; i++) {

          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * radius;

          const x = point.x + Math.cos(angle) * distance;
          const z = point.z + Math.sin(angle) * distance;

          const y = terrain?.getHeightAt({
              x,
              z
          }) ?? 0;

          const blade = {
              x,
              y,
              z,

              scale: 0.7 + Math.random() * 0.6,
              height: 0.75 + Math.random() * 0.35,
              rotation: Math.random() * Math.PI * 2
          };

          config.points.push(blade);
          paintedBlades.push(blade);
      }

      this.config = config;
      this.terrain = terrain;

      // A brush stroke only changes a few cells. Avoid rebuilding matrices for
      // every painted blade in the world when the existing grid is current.
      if (!this.gridDirty) {
          const changedCells = new Map();

          for (const blade of paintedBlades) {
              const cellX = Math.floor(blade.x / this.gridCellSize);
              const cellZ = Math.floor(blade.z / this.gridCellSize);
              const cell = this.getOrCreateGrassCell(cellX, cellZ);
              cell.blades.push(blade);
              changedCells.set(`${cellX},${cellZ}`, { cellX, cellZ, cell });
          }

          for (const { cellX, cellZ, cell } of changedCells.values()) {
              this.rebuildGrassCell(cellX, cellZ, cell);
          }
      }
      this.farGrassNeedsRebuild = true;
      this.dirty = true;

      return true;
  }
  erase(config, point, radius) {
    if (!config?.enabled || radius <= 0) return false;
    const radiusSq = radius ** 2, before = config.points.length;
    config.points = config.points.filter(blade => (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq);
    if (config.points.length === before) return false;
    this.config = config;

    if (!this.gridDirty) {
        const minCellX = Math.floor((point.x - radius) / this.gridCellSize);
        const maxCellX = Math.floor((point.x + radius) / this.gridCellSize);
        const minCellZ = Math.floor((point.z - radius) / this.gridCellSize);
        const maxCellZ = Math.floor((point.z + radius) / this.gridCellSize);

        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
            const column = this.grassGrid.get(cellX);
            if (!column) continue;

            for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
                const cell = column.get(cellZ);
                if (!cell) continue;

                cell.blades = cell.blades.filter(
                    blade => (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq
                );

                if (cell.blades.length) {
                    this.rebuildGrassCell(cellX, cellZ, cell);
                } else {
                    column.delete(cellZ);
                }
            }

            if (column.size === 0) this.grassGrid.delete(cellX);
        }
    }
    this.farGrassNeedsRebuild = true;
    this.dirty = true;
    return true;
  }
  startFarGrassRebuild() {

    this.farGrassNeedsRebuild = false;
    this.farGrassRebuildTimer = 0;

    if (
        !this.config?.enabled ||
        !this.terrain ||
        !this.config.points?.length
    ) {
        if (this.farGrassMesh) {
            this.farGrassMesh.visible = false;
        }

        this.farGrassBuildJob = null;
        return;
    }

    this.farGrassBuildJob = {

        // Viktigt:
        // använd snapshot så config kan ändras medan bygget pågår.
        points: this.config.points.slice(),

        pointIndex: 0,

        cells: new Set(),
        cellOuterFades: new Map(),

        renderCells: null,
        renderCellArray: null,
        renderCellIndex: 0,
        sourceCellArray: null,
        sourceCellIndex: 0,

        positions: [],
        coverage: [],
        outerBackgroundFade: [],
        indices: [],

        vertexIndex: 0,

        phase: "points"
    };
}
processFarGrassRebuild() {

    const job = this.farGrassBuildJob;

    if (!job) return;


    const cellSize = this.farGrassCellSize;


    // ==========================================================
    // PHASE 1
    // Läs gräspunkter över flera frames.
    // ==========================================================

    if (job.phase === "points") {

        const end = Math.min(
            job.pointIndex + this.farGrassPointsPerFrame,
            job.points.length
        );


        for (
            ;
            job.pointIndex < end;
            job.pointIndex++
        ) {

            const blade =
                job.points[job.pointIndex];


            const cellX =
                Math.floor(
                    blade.x / cellSize
                );

            const cellZ =
                Math.floor(
                    blade.z / cellSize
                );


            const key =
                `${cellX},${cellZ}`;


            job.cells.add(key);


            job.cellOuterFades.set(
                key,
                Math.max(
                    job.cellOuterFades.get(key) ?? 0,
                    blade._farOuterFade ?? 0
                )
            );
        }


        if (job.pointIndex >= job.points.length) {
            job.renderCells = new Set();
            job.sourceCellArray = [...job.cells];
            job.phase = "expand";
        }


        return;
    }

    // Expanding every occupied cell into its 3x3 soft-edge border used to
    // happen in one frame. Spread it across the same build budget.
    if (job.phase === "expand") {
        const end = Math.min(
            job.sourceCellIndex + this.farGrassCellsPerFrame,
            job.sourceCellArray.length
        );
        for (; job.sourceCellIndex < end; job.sourceCellIndex++) {
            const [cellX, cellZ] = job.sourceCellArray[job.sourceCellIndex].split(",").map(Number);
            for (let offsetX = -1; offsetX <= 1; offsetX++) {
                for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
                    job.renderCells.add(`${cellX + offsetX},${cellZ + offsetZ}`);
                }
            }
        }
        if (job.sourceCellIndex < job.sourceCellArray.length) return;
        job.renderCellArray = [...job.renderCells];
        job.phase = "geometry";
        return;
    }


    // ==========================================================
    // Helpers
    // ==========================================================

    const vertexCoverage =
        (vertexX, vertexZ) => {

            let occupied = 0;


            for (
                let offsetX = -1;
                offsetX <= 0;
                offsetX++
            ) {

                for (
                    let offsetZ = -1;
                    offsetZ <= 0;
                    offsetZ++
                ) {

                    if (
                        job.cells.has(
                            `${vertexX + offsetX},${vertexZ + offsetZ}`
                        )
                    ) {

                        occupied++;
                    }
                }
            }


            return occupied / 4;
        };


    const vertexOuterFade =
        (vertexX, vertexZ) => {

            let fade = 0;


            for (
                let offsetX = -1;
                offsetX <= 0;
                offsetX++
            ) {

                for (
                    let offsetZ = -1;
                    offsetZ <= 0;
                    offsetZ++
                ) {

                    fade =
                        Math.max(
                            fade,

                            job.cellOuterFades.get(
                                `${vertexX + offsetX},${vertexZ + offsetZ}`
                            ) ?? 0
                        );
                }
            }


            return fade;
        };


    // ==========================================================
    // PHASE 2
    // Bygg några markceller per frame.
    // ==========================================================

    const end =
        Math.min(

            job.renderCellIndex +
            this.farGrassCellsPerFrame,

            job.renderCellArray.length
        );


    for (
        ;
        job.renderCellIndex < end;
        job.renderCellIndex++
    ) {

        const key =
            job.renderCellArray[
                job.renderCellIndex
            ];


        const parts =
            key.split(",");


        const cellX =
            Number(parts[0]);

        const cellZ =
            Number(parts[1]);


        const x0 =
            cellX * cellSize;

        const z0 =
            cellZ * cellSize;

        const x1 =
            x0 + cellSize;

        const z1 =
            z0 + cellSize;


        const offsetY =
            this.farGrassSurfaceOffset;


        const y00 =
            (
                this.terrain.getHeightAt({
                    x: x0,
                    z: z0
                }) ?? 0
            ) + offsetY;


        const y10 =
            (
                this.terrain.getHeightAt({
                    x: x1,
                    z: z0
                }) ?? 0
            ) + offsetY;


        const y11 =
            (
                this.terrain.getHeightAt({
                    x: x1,
                    z: z1
                }) ?? 0
            ) + offsetY;


        const y01 =
            (
                this.terrain.getHeightAt({
                    x: x0,
                    z: z1
                }) ?? 0
            ) + offsetY;


        job.positions.push(

            x0, y00, z0,
            x1, y10, z0,
            x1, y11, z1,
            x0, y01, z1

        );


        job.coverage.push(

            vertexCoverage(
                cellX,
                cellZ
            ),

            vertexCoverage(
                cellX + 1,
                cellZ
            ),

            vertexCoverage(
                cellX + 1,
                cellZ + 1
            ),

            vertexCoverage(
                cellX,
                cellZ + 1
            )

        );


        job.outerBackgroundFade.push(

            vertexOuterFade(
                cellX,
                cellZ
            ),

            vertexOuterFade(
                cellX + 1,
                cellZ
            ),

            vertexOuterFade(
                cellX + 1,
                cellZ + 1
            ),

            vertexOuterFade(
                cellX,
                cellZ + 1
            )

        );


        job.indices.push(

            job.vertexIndex,
            job.vertexIndex + 2,
            job.vertexIndex + 1,

            job.vertexIndex,
            job.vertexIndex + 3,
            job.vertexIndex + 2

        );


        job.vertexIndex += 4;
    }


    if (
        job.renderCellIndex <
        job.renderCellArray.length
    ) {
        return;
    }


    // ==========================================================
    // PHASE 3
    // Geometry klar.
    // Gör bara själva swapen nu.
    // ==========================================================

    const geometry =
        new THREE.BufferGeometry();


    geometry.setAttribute(

        "position",

        new THREE.Float32BufferAttribute(
            job.positions,
            3
        )

    );


    geometry.setAttribute(

        "coverage",

        new THREE.Float32BufferAttribute(
            job.coverage,
            1
        )

    );


    geometry.setAttribute(

        "outerBackgroundFade",

        new THREE.Float32BufferAttribute(
            job.outerBackgroundFade,
            1
        )

    );


    geometry.setIndex(
        job.indices
    );


    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();


    if (!this.farGrassMesh) {

        this.farGrassMesh =
            new THREE.Mesh(
                geometry,
                this.farGrassMaterial
            );


        this.farGrassMesh.name =
            "Far grass ground shader";


        this.farGrassMesh.castShadow =
            false;

        this.farGrassMesh.receiveShadow =
            false;


        this.root.add(
            this.farGrassMesh
        );

    } else {

        const oldGeometry =
            this.farGrassMesh.geometry;


        this.farGrassMesh.geometry =
            geometry;

        this.farGrassMesh.visible =
            true;


        // dispose först EFTER swap
        oldGeometry?.dispose();
    }


    this.farGrassBuildJob =
        null;


    // Om chunks ändrades medan vi byggde:
    // nästa rebuild startar sedan automatiskt.
}
update(delta, camera) {
    
    if (!this.config?.enabled || !camera || !this.mesh)
        return;
    this.processGrassGridRebuild();
    // Wind animation runs every frame.
    const shader = this.material.userData.grassShader;

    if (shader) {
        shader.uniforms.uGrassTime.value += delta;
        camera.getWorldPosition(this.backlightCameraPosition);
        
    }
    if (this.farGrassMaterial) {
        this.farGrassMaterial.uniforms.uTime.value += delta;
     }
    // Uppdatera distant-grass efter paint/erase.
    // Vänta lite så vi inte bygger om meshen för varje penselpunkt.

    if (this.farGrassNeedsRebuild) {

    this.farGrassRebuildTimer += delta;

    if (
        this.farGrassRebuildTimer > 0.12 &&
        !this.farGrassBuildJob
    ) {
        this.startFarGrassRebuild();
    }
}

this.processFarGrassRebuild();
    camera.getWorldDirection(this.cameraDirection);

    const cameraStill =
        this.lastCamera.distanceToSquared(camera.position) < 1;

    const viewStill =
        this.hasCameraDirection &&
        this.lastCameraDirection.dot(this.cameraDirection) > 0.9995;

    // Don't rebuild instance matrices unnecessarily.
    if (!this.dirty && cameraStill && viewStill) {
        return;
    }

    this.lastCamera.copy(camera.position);
    this.lastCameraDirection.copy(this.cameraDirection);

    this.hasCameraDirection = true;
    this.dirty = false;


    // Update frustum.
    this.viewProjection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
    );

    this.frustum.setFromProjectionMatrix(this.viewProjection);


    const camX = camera.position.x;
    const camZ = camera.position.z;

    const radiusSq = this.radius * this.radius;

    let visibleCount = 0;





const radius = this.radius;


const cellSize = this.gridCellSize;

const minCellX =
    Math.floor((camX - radius) / cellSize);

const maxCellX =
    Math.floor((camX + radius) / cellSize);

const minCellZ =
    Math.floor((camZ - radius) / cellSize);

const maxCellZ =
    Math.floor((camZ + radius) / cellSize);


const target =
    this.mesh.instanceMatrix.array;




const visibleCells = [];
for (
    let cellX = minCellX;
    cellX <= maxCellX;
    cellX++
) {

    const column =
        this.grassGrid.get(cellX);

    if (!column) continue;


    for (
        let cellZ = minCellZ;
        cellZ <= maxCellZ;
        cellZ++
    ) {

        const cell =
            column.get(cellZ);

        if (!cell) continue;


        // ------------------------
        // Distance cull CELL
        // ------------------------

        const nearestX =
            Math.max(
                cell.minX,
                Math.min(camX, cell.maxX)
            );

        const nearestZ =
            Math.max(
                cell.minZ,
                Math.min(camZ, cell.maxZ)
            );

        const dx = nearestX - camX;
        const dz = nearestZ - camZ;

        if (
            dx * dx + dz * dz >
            radiusSq
        ) {
            continue;
        }


        // ------------------------
        // Frustum cull CELL
        // ------------------------

        if (
            !this.frustum.intersectsBox(cell.box)
        ) {
            continue;
        }


        // Keep a candidate; coordinate iteration order must not decide which
        // grass is removed when we hit maxVisible.
        visibleCells.push({ cell, distanceSq: dx * dx + dz * dz });
    }
}

// Copy nearest visible cells first, keeping grass around the player intact.
visibleCells.sort((a, b) => a.distanceSq - b.distanceSq);

for (const { cell } of visibleCells) {
    const remaining =
        this.maxVisible - visibleCount;

    if (remaining <= 0) {
        break;
    }

    const cellCount =
        cell.matrices.length / 16;

    const take =
        Math.min(
            cellCount,
            remaining
        );

    const destinationOffset =
        visibleCount * 16;


    if (take === cellCount) {

            target.set(
                cell.matrices,
                destinationOffset
            );

    } else {

            // Bara sista delcellen behöver subarray.
            target.set(
                cell.matrices.subarray(
                    0,
                    take * 16
                ),
                destinationOffset
            );
        }

    visibleCount += take;
}

this.mesh.count = visibleCount;

const instanceMatrix =
    this.mesh.instanceMatrix;

instanceMatrix.clearUpdateRanges();

instanceMatrix.addUpdateRange(
    0,
    visibleCount * 16
);

instanceMatrix.needsUpdate = true;
}
createMesh() {
    this.mesh = new THREE.InstancedMesh(
        this.geometry,
        this.material,
        this.maxVisible
    );

    this.mesh.name = "Near-camera procedural grass";
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;

    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.root.add(this.mesh);
}
}
