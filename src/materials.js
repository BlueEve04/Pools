import * as THREE from 'three';
import {
  createTileTextures,
  createPlasterTextures,
  createSkyTexture,
  createSkylightTexture,
} from './textures.js';

function setMetricRepeat(set, meters, anisotropy) {
  for (const key of Object.keys(set)) {
    const t = set[key];
    t.repeat.set(1 / meters, 1 / meters);
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}

/**
 * Tint opaque surfaces that are below the water plane. This makes submerged
 * stair risers / wall bases read as underwater even though the water itself
 * is only a single surface.
 */
export function applyUnderwaterTint(material, waterY = 0) {
  if (!material || material.userData.underwaterTint) return;
  material.userData.underwaterTint = true;
  const prevCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);
    shader.uniforms.uWaterLevel = { value: waterY };
    shader.vertexShader = `varying vec3 vUWPos;
` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
  vUWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
    );
    shader.fragmentShader = `uniform float uWaterLevel;
varying vec3 vUWPos;
` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      {
        float uwDepth = max(0.0, uWaterLevel - vUWPos.y);
        float uwFade = smoothstep(0.0, 0.05, uwDepth);
        float uwK = clamp(uwDepth / 0.7, 0.0, 1.0);
        float uwAmt = uwFade * (0.28 + 0.34 * uwK);
        vec3 uwTint = vec3(0.52, 0.84, 0.81);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uwTint, uwAmt);
      }`
    );
  };
  material.customProgramCacheKey = () => 'underwater-v1-' + waterY;
  material.needsUpdate = true;
}

export function createMaterials(renderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  /* ---------------- ceramic sets ---------------- */

  const wallSet = createTileTextures({
    size: 1024,
    tiles: 12,
    palette: [
      [233, 226, 211], [238, 231, 216], [228, 220, 204], [241, 234, 220],
      [231, 224, 209], [236, 228, 212],
    ],
    rareTiles: [[222, 226, 214], [240, 231, 212]],
    rareChance: 0.04,
    groutColor: [200, 193, 179],
    groutRatio: 0.04,
    tileRoughness: [0.34, 0.5],
    groutRoughness: 0.66,
    normalStrength: 1.15,
    tileRadius: 1.1,
    seed: 20261124,
    patinaStrength: 0.7,
    speckles: 0.00045,
  });
  setMetricRepeat(wallSet, 1.8, anisotropy);

  const floorSet = createTileTextures({
    size: 1024,
    tiles: 6,
    palette: [
      [233, 225, 207], [239, 232, 216], [228, 220, 202], [243, 236, 222],
      [231, 223, 205], [236, 228, 211],
    ],
    rareTiles: [[240, 230, 208], [227, 219, 201]],
    rareChance: 0.08,
    groutColor: [176, 169, 152],
    groutRatio: 0.04,
    tileRoughness: [0.22, 0.4],
    groutRoughness: 0.6,
    normalStrength: 2.3,
    tileRadius: 1.0,
    veins: true,
    seed: 77103,
    patinaStrength: 0.9,
  });
  setMetricRepeat(floorSet, 2.4, anisotropy);

  const mosaicSet = createTileTextures({
    size: 1024,
    tiles: 16,
    palette: [
      [104, 200, 190], [82, 186, 178], [122, 211, 201], [70, 173, 169],
      [140, 220, 210], [92, 194, 184], [58, 158, 158], [116, 206, 197],
    ],
    rareTiles: [[166, 230, 219], [50, 145, 148], [32, 129, 136]],
    rareChance: 0.09,
    groutColor: [202, 226, 217],
    groutRatio: 0.032,
    tileRoughness: [0.16, 0.34],
    groutRoughness: 0.56,
    normalStrength: 2.2,
    tileRadius: 0.8,
    seed: 4407,
    patinaStrength: 0.5,
    speckles: 0.00045,
  });
  setMetricRepeat(mosaicSet, 0.72, anisotropy);

  const accentSet = createTileTextures({
    size: 512,
    tiles: 8,
    palette: [
      [44, 143, 140], [52, 160, 155], [35, 126, 128], [64, 174, 165],
      [78, 184, 173], [30, 112, 118],
    ],
    rareTiles: [[26, 100, 108], [96, 196, 183]],
    rareChance: 0.08,
    groutColor: [198, 222, 213],
    groutRatio: 0.035,
    tileRoughness: [0.13, 0.28],
    groutRoughness: 0.52,
    normalStrength: 3.0,
    tileRadius: 0.8,
    seed: 551,
    patinaStrength: 0.5,
    speckles: 0.00045,
  });
  setMetricRepeat(accentSet, 0.4, anisotropy);

  const plasterSet = createPlasterTextures({ size: 512, seed: 9007 });
  setMetricRepeat(plasterSet, 3.0, anisotropy);

  /* ---------------- materials ---------------- */

  const wall = new THREE.MeshStandardMaterial({
    map: wallSet.map,
    normalMap: wallSet.normalMap,
    normalScale: new THREE.Vector2(0.2, 0.2),
    roughnessMap: wallSet.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.8,
  });

  const floor = new THREE.MeshPhysicalMaterial({
    map: floorSet.map,
    normalMap: floorSet.normalMap,
    normalScale: new THREE.Vector2(0.34, 0.34),
    roughnessMap: floorSet.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.32,
    envMapIntensity: 0.85,
  });

  const mosaic = new THREE.MeshStandardMaterial({
    map: mosaicSet.map,
    normalMap: mosaicSet.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: mosaicSet.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.95,
  });

  const accent = new THREE.MeshStandardMaterial({
    map: accentSet.map,
    normalMap: accentSet.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: accentSet.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });

  const plaster = new THREE.MeshStandardMaterial({
    map: plasterSet.map,
    normalMap: plasterSet.normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: plasterSet.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.75,
    color: 0xf7f1e4,
  });

  const dome = plaster.clone();
  dome.color.set(0xd5e5dd);
  dome.envMapIntensity = 0.9;

  const metal = new THREE.MeshStandardMaterial({
    color: 0xdde4e0,
    metalness: 0.92,
    roughness: 0.26,
    envMapIntensity: 1.3,
  });

  const whiteMetal = new THREE.MeshStandardMaterial({
    color: 0xece9df,
    metalness: 0.35,
    roughness: 0.42,
    envMapIntensity: 0.9,
  });

  const skyTexture = createSkyTexture();
  skyTexture.anisotropy = anisotropy;
  const sky = new THREE.MeshBasicMaterial({
    map: skyTexture,
    color: new THREE.Color(1.35, 1.35, 1.3),
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });

  const skylightTexture = createSkylightTexture();
  skylightTexture.anisotropy = anisotropy;
  const skylight = new THREE.MeshBasicMaterial({
    map: skylightTexture,
    color: new THREE.Color(1.6, 1.62, 1.58),
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });

  const oculus = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3.4, 3.25, 3.0),
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });

  const ringBuoy = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.52,
    metalness: 0.0,
    envMapIntensity: 0.8,
  });

  return {
    wall, floor, mosaic, accent, plaster, dome,
    metal, whiteMetal, sky, skylight, oculus, ringBuoy,
    anisotropy,
  };
}
