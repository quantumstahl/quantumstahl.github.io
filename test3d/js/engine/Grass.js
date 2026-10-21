import * as THREE from "three";

// Dense near-camera grass: one generated crossed-card blade mesh, rendered as
// an InstancedMesh. The old gras.glb remains available for medium-distance
// vegetation and is deliberately not used here.
export class Grass {
  constructor(scene) {
    this.scene = scene; this.root = new THREE.Group(); this.root.name = "Near painted grass"; this.scene.add(this.root);
    // Render the actual blades out to 200 m. There is intentionally no
    // distant ground-shader substitute: grass beyond this range is absent.
    this.radius = 200;
    this.fadeStart = 160; this.fadeEnd = 200;
    this.maxVisible = window.mobileProfile ? 120000 : 320000;
    // Applies to newly painted grass only. Saved paint remains untouched.
    this.paintDensityMultiplier = 0.1;
    this.tramplePosition = new THREE.Vector3(1e6, 0, 1e6); this.trampleRadius = 2.00; this.trampleFlatten = 1.5; this.trampleBend = 0.80;
    this.environmentTint = new THREE.Color(0.00, 0.00, 0.00);
    this.matrix = new THREE.Matrix4(); this.position = new THREE.Vector3(); this.rotation = new THREE.Quaternion(); this.scale = new THREE.Vector3(); this.lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity); this.lastCameraDirection = new THREE.Vector3(); this.cameraDirection = new THREE.Vector3(); this.viewPoint = new THREE.Vector3(); this.viewProjection = new THREE.Matrix4(); this.frustum = new THREE.Frustum(); this.hasCameraDirection = false; this.dirty = true; this.visibilityRefreshElapsed = Infinity; this.visibilityRefreshInterval = 0.125; this.sunDirection = new THREE.Vector3(.4, .8, .2).normalize(); this.sunPosition = new THREE.Vector3(); this.sunTargetPosition = new THREE.Vector3(); this.sunBacklight = 1; this.backlightCameraPosition = new THREE.Vector3();
    this.geometry = this.createBladeGeometry(); this.material = this.createMaterial();
    this.grassSphere = new THREE.Sphere();
    this.createMesh();
    this.grassGrid = new Map();
    this.gridCellSize = 5;
    this.gridDirty = true;
    this.chunkGrassSignature = "";
    // A streamed chunk normally carries a full-size (but all-zero) mask.
    // Remember whether a revision contains any paint so an empty map never
    // walks every terrain vertex just to discover that there is no grass.
    this.chunkMaskPaintState = new WeakMap();

    this.environmentsun=true;
    this.pendingGrassGridBuild = null;
    this.pendingChunkPointBuild = null;
    this.grassBuildPointsPerFrame = 5000;
    this.grassBuildCellsPerFrame = 12;
  }
createBladeGeometry() {

    const positions = [];
    const colors = [];

    const blades = 30;

    const baseColor = new THREE.Color(0x35582A);
    const tipColor  = new THREE.Color(0x779746);
    for (let blade = 0; blade < blades; blade++) {

        const angle = blade * 2.39996;

        const radial =
            blade === 0
                ? 0
                : 0.04 + (blade % 5) * 0.025;

        const cx = Math.cos(angle) * radial;
        const cz = Math.sin(angle) * radial;

        const height =
            0.60 + (blade % 30) * 0.04;

        const baseWidth =
            0.100 + (blade % 30) * 0.003;

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

    // Lambert supplies Three's supported shadow receiver uniforms. Its final
    // lighting result is replaced below, leaving only the shadow mask.
    const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        color: 0xffffff
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
                    hgt 
                    
                   ;


                mvPosition.x += w;
                mvPosition.z += w * 0.4;


                vec4 grassWorldPosition = modelMatrix * mvPosition;
                vGrassWorldPosition = grassWorldPosition.xyz;
                mvPosition = viewMatrix * grassWorldPosition;


                gl_Position =
                    projectionMatrix *
                    mvPosition;
                `
            )
            .replace(
                "#include <worldpos_vertex>",
                `
                // Use the wind/trample-adjusted blade position for shadows.
                vec4 worldPosition = grassWorldPosition;
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
                diffuseColor.rgb += uEnvironmentTint/2.5+savecolor;

                
                    diffuseColor.rgb *=((-1.00+uEnvironmentSun)*0.60)+0.75;
                

                
                // blade when the camera is looking toward the sun.
                vec3 viewToBlade = normalize(vGrassWorldPosition - uBacklightCameraPosition);
                float towardSun = smoothstep(0.52, 0.94, dot(viewToBlade, uSunDirection));
                float tipGlow = smoothstep(0.48, 0.95, vBladeTip) * towardSun * uSunBacklight;
                diffuseColor.rgb += vec3(0.21, 0.075, 0.018) * tipGlow;
                vec3 unlitGrassColor = diffuseColor.rgb;
                `
            )
            .replace(
                "#include <opaque_fragment>",
                `
                // Keep authored day/night colour. Read the renderer's real
                // directional shadow map directly, but never its sunlight.
                float grassShadow = 1.0;
                #if NUM_DIR_LIGHT_SHADOWS > 0
                    DirectionalLightShadow grassDirectionalLight = directionalLightShadows[0];
                    grassShadow = receiveShadow ? getShadow(
                        directionalShadowMap[0],
                        grassDirectionalLight.shadowMapSize,
                        grassDirectionalLight.shadowIntensity,
                        grassDirectionalLight.shadowBias,
                        grassDirectionalLight.shadowRadius,
                        vDirectionalShadowCoord[0]
                    ) : 1.0;
                #endif
                outgoingLight = unlitGrassColor * mix(0.58, 1.0, grassShadow);
                #include <opaque_fragment>
                `
            );

        material.userData.grassShader = shader;
    };


    material.customProgramCacheKey = () =>
        "next-world-grass-height-lod-trample-backlight-environment-unlit-shadow-receiver-v10";


    return material;
}
  async apply(config, terrain) {

    this.config = config;
    this.terrain = terrain;
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
    // The renderer is one shared InstancedMesh; skip identical chunk data.
    const signature = this.getChunkGrassSignature(chunks);
    if (signature === this.chunkGrassSignature) return;
    this.chunkGrassSignature = signature;
    // Build the active window's blade list incrementally so a chunk crossing
    // cannot monopolise one mobile frame.
    this.pendingChunkPointBuild = { chunks: [...chunks], index: 0, points: [] };
    this.pendingGrassGridBuild = null;
    this.gridDirty = true;
    this.dirty = true;
  }

  processChunkPointBuild() {
    const job = this.pendingChunkPointBuild;
    if (!job) return;
    if (job.index < job.chunks.length) {
      const chunk = job.chunks[job.index++];
      job.points.push(...this.getChunkRenderPoints(chunk));
      return;
    }
    this.config.points = job.points;
    this.pendingChunkPointBuild = null;
    this.queueGrassGridRebuild();
  }

  getChunkRenderPoints(chunk) {
    const mask = chunk.grass?.mask;
    if (!this.hasChunkMaskPaint(chunk, mask)) return chunk.grass?.points ?? [];
    const tile = this.terrain?.tiles?.get(`${chunk.x},${chunk.z}`);
    const positions = tile?.mesh.geometry.getAttribute("position");
    const resolution = this.terrain?.config?.resolution ?? 50;
    if (!tile || !Array.isArray(mask) || mask.length !== positions?.count) return chunk.grass?.points ?? [];
    const density = Number(this.chunkedConfig?.density) || .25;
    const random = seed => {
      const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return value - Math.floor(value);
    };
    const triangleArea = (a, b, c) => {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
      return Math.hypot(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx
      ) * .5;
    };
    const points = [];
    for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
      const index = z * (resolution + 1) + x;
      const right = index + 1, below = index + resolution + 1, belowRight = below + 1;
      // A stretched Rockify bridge is still made of the original grid quads.
      // Generate blades over the quad's *rendered* triangles instead of only
      // within its old, fixed-size height-map cell.
      const coverage = (
        (Number(mask[index]) || 0) + (Number(mask[right]) || 0) +
        (Number(mask[below]) || 0) + (Number(mask[belowRight]) || 0)
      ) * .25;
      if (coverage <= 0.001) continue;
      const seed = (chunk.x * 73856093 + chunk.z * 19349663 + index * 83492791) >>> 0;
      const vertex = vertexIndex => ({
        x: tile.mesh.position.x + positions.getX(vertexIndex),
        y: tile.mesh.position.y + positions.getY(vertexIndex),
        z: tile.mesh.position.z + positions.getZ(vertexIndex)
      });
      const topLeft = vertex(index), topRight = vertex(right);
      const bottomLeft = vertex(below), bottomRight = vertex(belowRight);
      const firstArea = triangleArea(topLeft, topRight, bottomLeft);
      const secondArea = triangleArea(topRight, bottomRight, bottomLeft);
      const surfaceArea = firstArea + secondArea;
      // A cap protects editor responsiveness if a single Rockify operation
      // produces an unusually large or malformed quad.
      const count = Math.min(24, Math.floor(density * surfaceArea * coverage + random(seed)));
      for (let bladeIndex = 0; bladeIndex < count; bladeIndex++) {
        const bladeSeed = seed + bladeIndex * 1013;
        const useFirst = random(bladeSeed + 1) * surfaceArea < firstArea;
        const a = useFirst ? topLeft : topRight;
        const b = useFirst ? topRight : bottomRight;
        const c = bottomLeft;
        const root = Math.sqrt(random(bladeSeed + 2));
        const weightA = 1 - root, weightB = root * (1 - random(bladeSeed + 3)), weightC = 1 - weightA - weightB;
        points.push({
          x: a.x * weightA + b.x * weightB + c.x * weightC,
          y: a.y * weightA + b.y * weightB + c.y * weightC,
          z: a.z * weightA + b.z * weightB + c.z * weightC,
          scale: .7 + random(bladeSeed + 4) * .6,
          height: .75 + random(bladeSeed + 5) * .35,
          rotation: random(bladeSeed + 6) * Math.PI * 2
        });
      }
    }
    return points;
  }

  hasChunkMaskPaint(chunk, mask = chunk.grass?.mask) {
    if (!Array.isArray(mask) || !mask.length) return false;
    const revision = Number(chunk.grass?.revision) || 0;
    const cached = this.chunkMaskPaintState.get(chunk);
    if (cached?.mask === mask && cached.revision === revision) return cached.hasPaint;
    const hasPaint = mask.some(value => Number(value) > .001);
    this.chunkMaskPaintState.set(chunk, { mask, revision, hasPaint });
    return hasPaint;
  }

  updateMaskDrivenNearGrass(point, radius, chunks) {
    // Rebuild only the render cells touched by this dab. The authoritative
    // complete mask-to-blade rebuild still runs after release, but this gives
    // the brush immediate near-grass feedback without rebuilding every chunk.
    if (this.gridDirty) return;
    const padding = this.gridCellSize;
    const minX = point.x - radius - padding, maxX = point.x + radius + padding;
    const minZ = point.z - radius - padding, maxZ = point.z + radius + padding;
    const intersects = chunk => {
      const mesh = this.terrain.tiles?.get(`${chunk.x},${chunk.z}`)?.mesh;
      const bounds = mesh?.geometry.boundingBox;
      // Keep live feedback working when a Rockify deck lies outside the
      // original chunk footprint.
      return !bounds || (
        maxX >= mesh.position.x + bounds.min.x && minX <= mesh.position.x + bounds.max.x &&
        maxZ >= mesh.position.z + bounds.min.z && minZ <= mesh.position.z + bounds.max.z
      );
    };
    const replacement = chunks
      .filter(intersects)
      .flatMap(chunk => this.getChunkRenderPoints(chunk))
      .filter(blade => blade.x >= minX && blade.x <= maxX && blade.z >= minZ && blade.z <= maxZ);
    this.config.points = this.config.points
      .filter(blade => blade.x < minX || blade.x > maxX || blade.z < minZ || blade.z > maxZ)
      .concat(replacement);

    const minCellX = Math.floor(minX / this.gridCellSize), maxCellX = Math.floor(maxX / this.gridCellSize);
    const minCellZ = Math.floor(minZ / this.gridCellSize), maxCellZ = Math.floor(maxZ / this.gridCellSize);
    const byCell = new Map();
    for (const blade of this.config.points) {
      const cellX = Math.floor(blade.x / this.gridCellSize), cellZ = Math.floor(blade.z / this.gridCellSize);
      if (cellX < minCellX || cellX > maxCellX || cellZ < minCellZ || cellZ > maxCellZ) continue;
      const key = `${cellX},${cellZ}`;
      const blades = byCell.get(key) ?? [];
      blades.push(blade);
      byCell.set(key, blades);
    }
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      const blades = byCell.get(`${cellX},${cellZ}`) ?? [];
      const column = this.grassGrid.get(cellX);
      const cell = column?.get(cellZ);
      if (!blades.length) {
        if (cell) column.delete(cellZ);
        if (column && !column.size) this.grassGrid.delete(cellX);
        continue;
      }
      const target = cell ?? this.getOrCreateGrassCell(cellX, cellZ);
      target.blades = blades;
      this.rebuildGrassCell(cellX, cellZ, target);
    }
    this.dirty ||= this.isNearGrassPoint(point, radius);
  }

  paintTerrainMask(point, radius, canPaintAt) {
    if (!this.terrain?.tiles || radius <= 0) return false;
    let changed = false;
    for (const tile of this.terrain.tiles.values()) {
      const { chunk, mesh } = tile;
      const positions = mesh.geometry.getAttribute("position");
      const normals = mesh.geometry.getAttribute("normal");
      const count = positions.count;
      // Rockify can push a bridge outside its source chunk. Test the current
      // mesh bounds, not the chunk's original height-map square.
      const bounds = mesh.geometry.boundingBox;
      if (!bounds || point.x + radius < mesh.position.x + bounds.min.x || point.x - radius > mesh.position.x + bounds.max.x || point.z + radius < mesh.position.z + bounds.min.z || point.z - radius > mesh.position.z + bounds.max.z || point.y + radius < mesh.position.y + bounds.min.y || point.y - radius > mesh.position.y + bounds.max.y) continue;
      chunk.grass ??= { points: [] };
      if (!Array.isArray(chunk.grass.mask) || chunk.grass.mask.length !== count) {
        chunk.grass.mask = Array(count).fill(0);
        const resolution = this.terrain.config?.resolution ?? 50;
        const spacing = this.terrain.chunkSize / resolution;
        for (const blade of chunk.grass.points ?? []) {
          const localX = Math.round((blade.x - chunk.x * this.terrain.chunkSize) / spacing);
          const localZ = Math.round((blade.z - chunk.z * this.terrain.chunkSize) / spacing);
          if (localX >= 0 && localX <= resolution && localZ >= 0 && localZ <= resolution) chunk.grass.mask[localZ * (resolution + 1) + localX] = 1;
        }
      }
      let tileChanged = false;
      for (let index = 0; index < count; index++) {
        const x = mesh.position.x + positions.getX(index);
        const y = mesh.position.y + positions.getY(index);
        const z = mesh.position.z + positions.getZ(index);
        // A 3D brush chooses the clicked bridge deck and leaves terrain below
        // an overhang alone. This is only vertex arithmetic, not raycasting.
        const distance = Math.hypot(x - point.x, y - point.y, z - point.z);
        if (distance > radius || Math.abs(normals?.getY(index) ?? 1) <= 0.85) continue;
        const next = Math.max(
          Number(chunk.grass.mask[index]) || 0,
          (1 - distance / radius) ** 2 * this.grassPaintFalloff(radius)
        );
        if (next <= (Number(chunk.grass.mask[index]) || 0) + 0.001) continue;
        chunk.grass.mask[index] = next;
        changed = true;
        tileChanged = true;
      }
      if (tileChanged) chunk.grass.revision = (Number(chunk.grass.revision) || 0) + 1;
    }
    return changed;
  }

  eraseTerrainMask(point, radius) {
    if (!this.terrain?.tiles || radius <= 0) return false;
    let changed = false;
    for (const tile of this.terrain.tiles.values()) {
      const { chunk, mesh } = tile;
      const mask = chunk.grass?.mask;
      if (!Array.isArray(mask)) continue;
      const positions = mesh.geometry.getAttribute("position");
      let tileChanged = false;
      for (let index = 0; index < Math.min(mask.length, positions.count); index++) {
        const x = mesh.position.x + positions.getX(index), y = mesh.position.y + positions.getY(index), z = mesh.position.z + positions.getZ(index);
        if (Math.hypot(x - point.x, y - point.y, z - point.z) > radius || !(Number(mask[index]) > 0)) continue;
        mask[index] = 0;
        changed = true;
        tileChanged = true;
      }
      if (tileChanged) chunk.grass.revision = (Number(chunk.grass.revision) || 0) + 1;
    }
    return changed;
  }
  getChunkGrassSignature(chunks) {
    return chunks
      .map(chunk => `${chunk.x},${chunk.z}:${chunk.grass?.points?.length ?? 0}:${chunk.grass?.revision ?? 0}:${chunk._decorativeOuterEdges?.join("") ?? ""}:${chunk._decorativeOuterCorners?.join("") ?? ""}`)
      .sort()
      .join("|");
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
  isNearGrassPoint(point, padding = 0) {
    // The card-blade mesh is populated around the camera. A distant paint
    // stroke remains in the grid for later visits without forcing an
    // immediate visible-instance upload.
    if (!Number.isFinite(this.lastCamera.x) || !Number.isFinite(this.lastCamera.z)) return true;
    const range = this.radius + padding + this.gridCellSize;
    return (point.x - this.lastCamera.x) ** 2 + (point.z - this.lastCamera.z) ** 2 <= range ** 2;
  }
  paintChunked(point, radius, getChunkAt, chunks, canPaintAt = () => true) {
    if (!this.chunkedConfig?.enabled || radius <= 0) return false;
    const maskChanged = this.paintTerrainMask(point, radius, canPaintAt);
    if (this.terrain?.tiles) {
      if (maskChanged) {
        this.updateMaskDrivenNearGrass(point, radius, chunks);
      }
      return maskChanged;
    }
    const count = this.grassPaintCount(radius, this.chunkedConfig.density);
    const maxPerCell = this.maximumBladesPerCell(this.chunkedConfig.density);
    const occupancy = this.getGrassCellOccupancy(chunks.flatMap(chunk => chunk.grass?.points ?? []));
    const paintedBlades = [];
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * radius;
      const x = point.x + Math.cos(angle) * distance;
      const z = point.z + Math.sin(angle) * distance;
      if (!canPaintAt({ x, z })) continue;
      const chunk = getChunkAt({ x, z });
      if (!chunk) continue;
      chunk.grass ??= { points: [] };
      chunk.grass.points ??= [];
      const cellKey = this.grassCellKey(x, z);
      if ((occupancy.get(cellKey) ?? 0) >= maxPerCell) continue;
      const blade = {
        x, z,
        y: this.terrain?.getHeightAt({ x, z }) ?? 0,
        scale: 0.7 + Math.random() * 0.6,
        height: 0.75 + Math.random() * 0.35,
        rotation: Math.random() * Math.PI * 2
      };
      chunk.grass.points.push(blade);
      occupancy.set(cellKey, (occupancy.get(cellKey) ?? 0) + 1);
      paintedBlades.push({ blade, chunk });
    }

    if (!paintedBlades.length) return maskChanged;

    // Painting used to call setChunkedChunks for every brush dab. That copies
    // all active chunks and queues a complete grid rebuild, which makes dense
    // maps feel progressively slower. Update only the cells this dab touched;
    // full rebuilds remain reserved for streaming or an in-progress initial
    // build, where the authoritative chunk snapshot is required.
    if (this.gridDirty) {
      this.setChunkedChunks(chunks);
      return true;
    }

    const changedCells = new Map();
    let needsNearGrassRefresh = false;
    for (const { blade, chunk } of paintedBlades) {
      const renderBlade = blade;
      this.config.points.push(renderBlade);
      const cellX = Math.floor(renderBlade.x / this.gridCellSize);
      const cellZ = Math.floor(renderBlade.z / this.gridCellSize);
      const cell = this.getOrCreateGrassCell(cellX, cellZ);
      cell.blades.push(renderBlade);
      changedCells.set(`${cellX},${cellZ}`, { cellX, cellZ, cell });
      needsNearGrassRefresh ||= this.isNearGrassPoint(renderBlade);
    }
    for (const { cellX, cellZ, cell } of changedCells.values()) this.rebuildGrassCell(cellX, cellZ, cell);
    this.chunkGrassSignature = this.getChunkGrassSignature(chunks);
    this.dirty ||= needsNearGrassRefresh;
    return true;
  }
  eraseChunked(point, radius, chunks) {
    const radiusSq = radius ** 2;
    let changed = this.eraseTerrainMask(point, radius);
    for (const chunk of chunks) {
      const points = chunk.grass?.points ?? [];
      const kept = points.filter(blade => (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq);
      if (kept.length !== points.length) { chunk.grass.points = kept; changed = true; }
    }
    if (!changed) return false;
    // Keep the renderer-side point list in sync with the saved chunks.
    this.config.points = this.config.points.filter(blade =>
      (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq
    );
    if (this.gridDirty) {
      this.setChunkedChunks(chunks);
      return true;
    }

    // Match the local update used by painting, rather than rebuilding every
    // active chunk after each erase dab.
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
        cell.blades = cell.blades.filter(blade =>
          (blade.x - point.x) ** 2 + (blade.z - point.z) ** 2 > radiusSq
        );
        if (cell.blades.length) this.rebuildGrassCell(cellX, cellZ, cell);
        else column.delete(cellZ);
      }
      if (column.size === 0) this.grassGrid.delete(cellX);
    }
    this.chunkGrassSignature = this.getChunkGrassSignature(chunks);
    this.dirty ||= this.isNearGrassPoint(point, radius);
    if (this.terrain?.tiles) this.updateMaskDrivenNearGrass(point, radius, chunks);
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

      const count = this.grassPaintCount(radius, config.density);

      const paintedBlades = [];
      const maxPerCell = this.maximumBladesPerCell(config.density);
      const occupancy = this.getGrassCellOccupancy(config.points);

      for (let i = 0; i < count; i++) {

          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * radius;

          const x = point.x + Math.cos(angle) * distance;
          const z = point.z + Math.sin(angle) * distance;

          const y = terrain?.getHeightAt({
              x,
              z
          }) ?? 0;

          const cellKey = this.grassCellKey(x, z);
          if ((occupancy.get(cellKey) ?? 0) >= maxPerCell) continue;

          const blade = {
              x,
              y,
              z,

              scale: 0.7 + Math.random() * 0.6,
              height: 0.75 + Math.random() * 0.35,
              rotation: Math.random() * Math.PI * 2
          };

          config.points.push(blade);
          occupancy.set(cellKey, (occupancy.get(cellKey) ?? 0) + 1);
          paintedBlades.push(blade);
      }

      if (!paintedBlades.length) return false;

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
      this.dirty = true;

      return true;
  }
  grassCellKey(x, z) {
    return `${Math.floor(x / this.gridCellSize)},${Math.floor(z / this.gridCellSize)}`;
  }
  maximumBladesPerCell(density) {
    // Density is blades per square metre; cap one 5m render cell at that
    // density so repeated brush strokes fill gaps instead of stacking layers.
    return Math.max(1, Math.round((Number(density) || 0.25) * this.gridCellSize ** 2));
  }
  grassPaintFalloff(radius) {
    // Up to a 10 m brush retains the authored density. Larger brushes place
    // progressively fewer blades per square metre while retaining a uniform,
    // random distribution across the whole stamp.
    return this.paintDensityMultiplier * Math.min(1, 10 / Math.max(10, radius));
  }
  grassPaintCount(radius, density) {
    return Math.max(3, Math.round(radius * radius * (Number(density) || 0.25) * this.grassPaintFalloff(radius)));
  }
  getGrassCellOccupancy(points = []) {
    const occupancy = new Map();
    for (const blade of points) {
      const key = this.grassCellKey(blade.x, blade.z);
      occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    }
    return occupancy;
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
    this.dirty = true;
    return true;
  }
update(delta, camera) {
    
    if (!this.config?.enabled || !camera || !this.mesh)
        return;
    this.visibilityRefreshElapsed += delta;
    // During streaming, run exactly one construction stage per frame. Running
    // a point conversion, terrain-mask upload and grid rebuild together made
    // their individually modest costs add up to a visible mobile hitch.
if (this.pendingChunkPointBuild) this.processChunkPointBuild();
    else this.processGrassGridRebuild();
    // Wind animation runs every frame.
    const shader = this.material.userData.grassShader;

    if (shader) {
        shader.uniforms.uGrassTime.value += delta;
        camera.getWorldPosition(this.backlightCameraPosition);
        
    }
    camera.getWorldDirection(this.cameraDirection);

    const cameraStill =
        this.lastCamera.distanceToSquared(camera.position) < 4;

    const viewStill =
        this.hasCameraDirection &&
        this.lastCameraDirection.dot(this.cameraDirection) > 0.995;

    // Don't rebuild instance matrices unnecessarily.
    if (!this.dirty && cameraStill && viewStill) {
        return;
    }
    // Copying tens of thousands of instance matrices is a CPU upload spike.
    // Keep wind smooth, but limit visible-cell refreshes while moving.
    if (!this.dirty && this.visibilityRefreshElapsed < this.visibilityRefreshInterval) {
        return;
    }

    this.lastCamera.copy(camera.position);
    this.lastCameraDirection.copy(this.cameraDirection);

    this.hasCameraDirection = true;
    this.dirty = false;
    this.visibilityRefreshElapsed = 0;


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
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.root.add(this.mesh);

}
}
