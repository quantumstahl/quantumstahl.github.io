// Shared authored ownership rule used by rendering and collision. GPU mask
// erosion/readiness does not change the surface's physical triangles.
export const ROCK_COVERAGE_THRESHOLD = .035;
export function rockCellCovered(tile, x, z, threshold = ROCK_COVERAGE_THRESHOLD) {
  const width = tile.segments + 1, a = z * width + x, exposure = tile.rockExposure;
  return !!exposure && Math.max(Math.abs(exposure[a]), Math.abs(exposure[a + 1]), Math.abs(exposure[a + width]), Math.abs(exposure[a + width + 1])) >= threshold;
}
