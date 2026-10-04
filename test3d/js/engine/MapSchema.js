const newId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export const WORLD_CHUNK_SIZE = 50;
export const WORLD_CHUNK_RADIUS = 2;

// Version 2 manifests intentionally contain no per-vertex terrain or placed
// object arrays. Those live in chunks/x_z.json and are fetched on demand.
export function isChunkedWorld(data) { return data?.version === 2 && Array.isArray(data?.chunks); }

export function createChunkedWorldManifest(data = {}) {
  return {
    version: 2,
    name: data.name ?? "Untitled World",
    chunkSize: WORLD_CHUNK_SIZE,
    chunkRadius: WORLD_CHUNK_RADIUS,
    chunks: Array.isArray(data.chunks) && data.chunks.length
      ? data.chunks.map(chunk => ({ x: Number(chunk.x) || 0, z: Number(chunk.z) || 0, decorative: Boolean(chunk.decorative) }))
      : [{ x: 0, z: 0, decorative: true }],
    editor: { showGrid: data.editor?.showGrid ?? true, autoCreateChunks: data.editor?.autoCreateChunks ?? true },
    sky: data.sky ?? { mode: "day", timeOfDay: 0.25, dayDuration: 360 },
    terrain: {
      enabled: data.terrain?.enabled ?? true,
      resolution: Math.max(2, Math.min(100, Number(data.terrain?.resolution) || 50)),
      color: data.terrain?.color ?? 0x638450,
      textures: data.terrain?.textures ?? [],
      activeTexture: Number(data.terrain?.activeTexture) || 0
    },
    water: data.water ?? { enabled: true, level: -0.5, color: 0x3b86c4, opacity: 0.72 },
    grass: data.grass ?? { enabled: true, density: 2.5 },
    layers: (data.layers ?? []).map(layer => new MapLayer(layer))
  };
}

export class MapObject {
  constructor(data = {}) {
    this.id = data.id ?? newId();
    this.name = data.name ?? "";
    this.position = { x: data.x ?? data.position?.x ?? 0, y: data.y ?? data.position?.y ?? 0, z: data.z ?? data.position?.z ?? 0 };
    this.rotation = { x: data.rotX ?? data.rotation?.x ?? 0, y: data.rotY ?? data.rotation?.y ?? 0, z: data.rotZ ?? data.rotation?.z ?? 0 };
    const uniformScale = data.scale ?? 1;
    this.scale = { x: data.scaleX ?? data.scale?.x ?? uniformScale, y: data.scaleY ?? data.scale?.y ?? uniformScale, z: data.scaleZ ?? data.scale?.z ?? uniformScale };
    this.properties = structuredClone(data.properties ?? {});
  }
}

export class AssetType {
  constructor(data = {}) {
    this.id = data.id ?? newId();
    this.name = data.name ?? "Untitled asset";
    this.glb = data.glb ?? null;
    this.shape = data.shape ?? null;
    this.collision = data.collision ?? "solid";
    const shadowMode = data.render?.shadowMode ?? (data.render?.castShadow ?? data.castShadow ?? true ? "real" : "none");
    this.render = { castShadow: shadowMode === "real", shadowMode: ["real", "fake", "none"].includes(shadowMode) ? shadowMode : "real", receiveShadow: data.render?.receiveShadow ?? true, instanced: data.render?.instanced ?? data.instanced ?? true };
    this.editor = { visible: data.editor?.visible ?? data.visibleInEditor ?? true };
    this.instances = (data.instances ?? []).map(instance => new MapObject(instance));
  }
}

export class MapLayer {
  constructor(data = {}) {
    this.id = data.id ?? newId();
    this.name = data.name ?? "Layer";
    this.visible = data.visible ?? true;
    this.assetTypes = (data.assetTypes ?? data.types ?? []).map(type => new AssetType(type));
  }
}

export class WorldMap {
  constructor(data = {}) {
    this.version = 1;
    this.name = data.name ?? "Untitled World";
    this.editor = { showGrid: data.editor?.showGrid ?? true, autoCreateChunks: data.editor?.autoCreateChunks ?? true };
    const savedTimeOfDay = Number(data.sky?.timeOfDay);
    const savedDayDuration = Number(data.sky?.dayDuration);
    this.sky = {
      mode: data.sky?.mode === "night" ? "night" : "day",
      timeOfDay: Number.isFinite(savedTimeOfDay) ? ((savedTimeOfDay % 1) + 1) % 1 : (data.sky?.mode === "night" ? 0 : 0.25),
      dayDuration: Number.isFinite(savedDayDuration) ? Math.max(30, savedDayDuration) : 360
    };
    // Texture paint is stored per terrain vertex. A 64-segment, 200m terrain
    // has 3.125m between paint points, which makes narrow paths impossible.
    // 128 segments keeps a practical 1.56m paint grid with one quarter of
    // the geometry cost of the former 256-segment editor grid.
    const savedTerrainSegments = data.terrain?.segments ?? 64;
    const terrainSegments = 192;
    const terrainVertexCount = (terrainSegments + 1) ** 2;
    const savedHeights = data.terrain?.heights ?? [];
    const savedColors = data.terrain?.colors ?? [];
    const savedWidth = savedTerrainSegments + 1;
    const sourceIndexFor = index => {
      const x = index % (terrainSegments + 1), z = Math.floor(index / (terrainSegments + 1));
      return Math.round(z / terrainSegments * savedTerrainSegments) * savedWidth + Math.round(x / terrainSegments * savedTerrainSegments);
    };
    // Older maps stored a single `texture`; retain it as the first splat layer.
    const savedLayers = Array.isArray(data.terrain?.textures) && data.terrain.textures.length
      ? data.terrain.textures : (data.terrain?.texture?.src ? [data.terrain.texture] : []);
    this.terrain = {
      enabled: data.terrain?.enabled ?? true,
      size: data.terrain?.size ?? 200,
      segments: terrainSegments,
      color: data.terrain?.color ?? 0x638450,
      heights: Array.from({ length: terrainVertexCount }, (_, index) => Number(savedHeights[sourceIndexFor(index)]) || 0),
      // One compact colour per terrain vertex.  This is deliberately map data
      // rather than an image file, so painted ground works in both editor and game.
      colors: Array.from({ length: terrainVertexCount }, (_, index) => Number(savedColors[sourceIndexFor(index)]) || (data.terrain?.color ?? 0x638450)),
      textures: savedLayers.slice(0, 8).filter(layer => layer?.src).map(layer => ({
        src: layer.src,
        scale: Number(layer.scale) || 16,
        mask: Array.from({ length: terrainVertexCount }, (_, index) => Math.min(1, Math.max(0, Number(layer.mask?.[sourceIndexFor(index)]) || 0)))
      })),
      activeTexture: Math.min(Math.max(0, savedLayers.length - 1), Math.min(7, Math.max(0, Number(data.terrain?.activeTexture) || 0)))
    };
    this.water = {
      enabled: data.water?.enabled ?? true,
      level: data.water?.level ?? -0.5,
      color: data.water?.color ?? 0x3b86c4,
      opacity: data.water?.opacity ?? 0.72
    };
    this.grass = {
      enabled: data.grass?.enabled ?? true,
      density: Math.min(8, Math.max(.25, Number(data.grass?.density) || 2.5)),
      points: (data.grass?.points ?? []).map(point => ({ x: Number(point.x) || 0, z: Number(point.z) || 0, scale: Math.min(2, Math.max(.2, Number(point.scale) || 1)), height: Math.min(2, Math.max(.2, Number(point.height) || 1)), rotation: Number(point.rotation) || 0 }))
    };
    this.layers = (data.layers ?? []).map(layer => new MapLayer(layer));
  }
}

export function deserializeWorld(data) {
  if (isChunkedWorld(data)) return createChunkedWorldManifest(data);
  // An empty/missing JSON map should still give the editor a usable tree.
  if (!data || !Array.isArray(data.layers) || data.layers.length === 0) return createDefaultWorld();
  return new WorldMap(data);
}
export function serializeWorld(world) { return JSON.stringify(world, null, 2); }
export function createDefaultWorld() { return new WorldMap({ name: "New World", layers: [{ name: "Objects", assetTypes: [] }] }); }
