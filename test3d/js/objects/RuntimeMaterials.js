import * as THREE from 'three';

export function canUseLambertMaterial(material) {
  return !!(material?.isMeshStandardMaterial && !material.isMeshPhysicalMaterial &&
    material.metalness === 0 && material.roughness === 1 &&
    !material.normalMap && !material.bumpMap && !material.displacementMap &&
    !material.roughnessMap && !material.metalnessMap && !material.envMap &&
    !material.userData.gltfExtensions);
}

// Opt-in per library AND per material. Standard loading remains the default.
export function runtimeMaterial(source, mode = 'standard') {
  if (mode !== 'hinted-lambert' || source.userData.maxpaint?.runtimeLighting !== 'lambert' || !canUseLambertMaterial(source)) return source;
  const material = new THREE.MeshLambertMaterial();
  THREE.Material.prototype.copy.call(material, source);
  for (const key of ['map', 'alphaMap', 'aoMap', 'aoMapIntensity', 'lightMap', 'lightMapIntensity',
    'emissiveMap', 'emissiveIntensity', 'wireframe', 'flatShading', 'fog']) material[key] = source[key];
  material.color.copy(source.color); material.emissive.copy(source.emissive);
  return material;
}
