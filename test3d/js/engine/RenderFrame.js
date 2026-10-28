// Sky capture and the world are separate render() calls. Three's automatic
// reset would discard the first pass; reset once per displayed frame instead.
export function renderWorldFrame(renderer, environment, scene, camera) {
  renderer.info.autoReset = false;
  renderer.info.reset();
  environment.beforeRender(renderer, camera);
  renderer.render(scene, camera);
}

export function renderStatsLabel(info) {
  return `${info.triangles.toLocaleString("en-US")} total submitted tris · ${info.calls.toLocaleString("en-US")} draws`;
}
