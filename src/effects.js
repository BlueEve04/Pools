import * as THREE from 'three';
import { createDustTexture, mulberry32 } from './textures.js';
import { WATER_Y } from './config.js';

/* ------------------------------------------------------------------ *
 *  Volumetric light shafts
 * ------------------------------------------------------------------ */

const ShaftShader = {
  name: 'ShaftShader',
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(1.0, 0.94, 0.82) },
    uIntensity: { value: 0.075 },
    uSeed: { value: 0 },
    uEdgeFade: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uSeed;
    uniform float uEdgeFade;
    varying vec2 vUv;
    varying vec3 vWorld;

    void main() {
      float h = clamp(vUv.y, 0.0, 1.0);
      float vertical = pow(h, 2.2);
      float edge = mix(1.0, smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x), uEdgeFade);
      float breath = 0.86 + 0.14 * sin(uTime * 0.33 + uSeed + h * 3.2 + vUv.x * 2.0);
      float a = vertical * edge * breath * uIntensity;
      gl_FragColor = vec4(uColor * a, a);
    }
  `,
};

/**
 * Rectangular frustum for a skylight shaft. Local origin is the bottom centre;
 * the top is `height` above, shifted by (offsetX, offsetZ) toward the sun.
 */
export function createShaftGeometry(topW, topD, bottomW, bottomD, height, offsetX, offsetZ) {
  const positions = [];
  const uvs = [];
  const indices = [];

  const top = [
    [-topW / 2, height, -topD / 2],
    [topW / 2, height, -topD / 2],
    [topW / 2, height, topD / 2],
    [-topW / 2, height, topD / 2],
  ];
  const bottom = [
    [-bottomW / 2 + offsetX, 0, -bottomD / 2 + offsetZ],
    [bottomW / 2 + offsetX, 0, -bottomD / 2 + offsetZ],
    [bottomW / 2 + offsetX, 0, bottomD / 2 + offsetZ],
    [-bottomW / 2 + offsetX, 0, bottomD / 2 + offsetZ],
  ];

  const faces = [
    [0, 1], [1, 2], [2, 3], [3, 0],
  ];

  for (const [a, b] of faces) {
    const base = positions.length / 3;
    const t0 = top[a], t1 = top[b], b0 = bottom[a], b1 = bottom[b];
    positions.push(...t0, ...t1, ...b1, ...b0);
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    // oriented so both sides are visible; winding does not matter (DoubleSide)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createLightShaft({
  topW, topD, bottomW, bottomD, height, offsetX = 0, offsetZ = 0,
  x, y, z, intensity = 0.075, color, seed = 0,
}) {
  const geo = createShaftGeometry(topW, topD, bottomW, bottomD, height, offsetX, offsetZ);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(ShaftShader.uniforms),
    vertexShader: ShaftShader.vertexShader,
    fragmentShader: ShaftShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  mat.uniforms.uIntensity.value = intensity;
  mat.uniforms.uSeed.value = seed;
  if (color) mat.uniforms.uColor.value.copy(color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.renderOrder = 4;
  mesh.frustumCulled = true;
  return mesh;
}

export class LightShafts {
  constructor(meshes) {
    this.meshes = meshes;
    this.materials = meshes.map((m) => m.material);
  }
  update(t) {
    for (const m of this.materials) m.uniforms.uTime.value = t;
  }
}

/* ------------------------------------------------------------------ *
 *  Dust motes
 * ------------------------------------------------------------------ */

export function sampleBeamDust(beam, count, seed) {
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rand(), 0.85);
    const y = beam.y + t * beam.height;
    const w = THREE.MathUtils.lerp(beam.bottomW, beam.topW, t);
    const d = THREE.MathUtils.lerp(beam.bottomD, beam.topD, t);
    const ox = beam.offsetX * (1 - t);
    const oz = beam.offsetZ * (1 - t);
    out.push(
      beam.x + ox + (rand() - 0.5) * w * 0.9,
      y,
      beam.z + oz + (rand() - 0.5) * d * 0.9,
    );
  }
  return out;
}

export class DustField {
  constructor(positions, { pixelRatio = 1, viewportHeight = 1000, fov = 68 } = {}) {
    const count = positions.length / 3;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const phase = new Float32Array(count);
    const size = new Float32Array(count);
    const rand = mulberry32(1234567);
    for (let i = 0; i < count; i++) {
      phase[i] = rand();
      size[i] = 0.008 + rand() * 0.02;
    }
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: createDustTexture(64) },
        uScaleY: { value: 1000 },
        uOpacity: { value: 0.32 },
      },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        uniform float uScaleY;
        varying float vA;
        void main() {
          vec3 p = position;
          float ph = aPhase * 6.28318;
          p.x += sin(uTime * 0.10 + ph * 1.7) * 0.32;
          p.z += cos(uTime * 0.083 + ph * 2.3) * 0.32;
          p.y += sin(uTime * 0.05 + ph) * 0.45;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScaleY / max(0.2, -mv.z), 0.5, 9.0);
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.7 + ph * 3.1));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying float vA;
        void main() {
          vec4 tex = texture2D(uMap, gl_PointCoord);
          vec3 c = vec3(1.0, 0.96, 0.87) * tex.a * vA * uOpacity;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.setViewport(viewportHeight, fov, pixelRatio);
  }

  setViewport(viewportHeight, fov, pixelRatio = 1) {
    this.material.uniforms.uScaleY.value =
      (viewportHeight * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  update(t) {
    this.material.uniforms.uTime.value = t;
  }
}

/* ------------------------------------------------------------------ *
 *  Floating life ring
 * ------------------------------------------------------------------ */

export function createLifeRing(x = 32.5, z = 2.0) {
  const geo = new THREE.TorusGeometry(0.43, 0.135, 20, 56);
  geo.rotateX(Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = [];
  const orange = new THREE.Color(0xe06a35);
  const white = new THREE.Color(0xefece2);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i);
    let ang = Math.atan2(vz, vx) + Math.PI;
    const seg = ang % (Math.PI / 2);
    const isOrange = seg < 0.78;
    tmp.copy(isOrange ? orange : white);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.0,
    envMapIntensity: 0.8,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.position.set(x, WATER_Y + 0.05, z);
  group.add(mesh);

  let rippleTimer = 0;

  return {
    group,
    update(t, dt, water) {
      group.position.y = WATER_Y + 0.035 + Math.sin(t * 0.65) * 0.018;
      group.rotation.y = t * 0.035;
      group.rotation.x = Math.sin(t * 0.44) * 0.025;
      group.rotation.z = Math.cos(t * 0.37) * 0.025;
      rippleTimer += dt;
      if (rippleTimer > 2.6) {
        rippleTimer = 0;
        water.addRipple(group.position.x, group.position.z, 0.3);
      }
    },
  };
}
