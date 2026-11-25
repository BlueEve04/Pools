import * as THREE from 'three';
import { mulberry32 } from './textures.js';
import { WATER_Y } from './config.js';
import {
  createLightShaft,
  LightShafts,
  DustField,
  sampleBeamDust,
  createLifeRing,
} from './effects.js';

const BASE_Y = -0.9;

export const FLOORS = {
  hall: -0.55,
  roomB: -0.30,
  roomC: -0.10,
  corridor: -0.35,
  rotunda: -0.55,
  threshold: -0.45,
};

/* ------------------------------------------------------------------ *
 *  Geometry / UV helpers
 * ------------------------------------------------------------------ */

function metricPlaneUV(geo, w, h) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  }
  uv.needsUpdate = true;
}

function metricBoxUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const sizes = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = sizes[face];
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  }
  uv.needsUpdate = true;
}

function metricCylinderUV(geo, radius, height, arcFraction = 1) {
  const uv = geo.attributes.uv;
  const circ = Math.PI * 2 * radius * arcFraction;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * height);
  }
  uv.needsUpdate = true;
}

function makeBox(w, h, d, material, x, y, z, { cast = true, receive = true } = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  metricBoxUV(geo, w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  Walls with arched openings
 * ------------------------------------------------------------------ */

function wallGeometry(length, topWorldY, thickness, openings) {
  const H = topWorldY - BASE_Y;
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0);
  shape.lineTo(length / 2, 0);
  shape.lineTo(length / 2, H);
  shape.lineTo(-length / 2, H);
  shape.closePath();

  for (const op of openings) {
    const r = op.width / 2;
    const cx = op.localX;
    const bottom = Math.max(0.02, (op.bottomY ?? BASE_Y) - BASE_Y);
    const spring = Math.max(bottom + 0.05, op.springY - BASE_Y);
    const hole = new THREE.Path();
    hole.moveTo(cx - r, bottom);
    hole.lineTo(cx - r, spring);
    hole.absarc(cx, spring, r, Math.PI, 0, true);
    hole.lineTo(cx + r, bottom);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 44,
    steps: 1,
  });
  return geo;
}

function wallColliderGaps(openings, offset) {
  return openings
    .filter((o) => o.passable !== false)
    .map((o) => [o.at - o.width / 2, o.at + o.width / 2])
    .sort((a, b) => a[0] - b[0]);
}

function pushIntervals(colliders, start, end, gaps, makeRect) {
  let cursor = start;
  for (const [g0, g1] of gaps) {
    const a = Math.max(start, g0);
    const b = Math.min(end, g1);
    if (b <= cursor) continue;
    if (a > cursor) makeRect(cursor, a);
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) makeRect(cursor, end);
}

function buildWallX({
  parent, material, centerX, zStart, length, thickness, topY,
  openings = [], colliders = null, castShadow = true, receiveShadow = true,
}) {
  const geo = wallGeometry(
    length,
    topY,
    thickness,
    openings.map((o) => ({
      localX: o.at - centerX,
      width: o.width,
      springY: o.springY,
      bottomY: o.bottomY,
    })),
  );
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(centerX, BASE_Y, zStart);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);

  if (colliders) {
    const gaps = wallColliderGaps(openings);
    pushIntervals(colliders, -length / 2, length / 2, gaps, (a, b) => {
      if (b - a < 0.015) return;
      colliders.push({
        type: 'box',
        minX: centerX + a,
        maxX: centerX + b,
        minZ: zStart,
        maxZ: zStart + thickness,
      });
    });
  }
  return mesh;
}

function buildWallZ({
  parent, material, centerZ, xStart, length, thickness, topY, side,
  openings = [], colliders = null, castShadow = true, receiveShadow = true,
}) {
  const dir = side === 'east' ? 1 : -1;
  const geo = wallGeometry(
    length,
    topY,
    thickness,
    openings.map((o) => ({
      localX: dir > 0 ? o.at - centerZ : -(o.at - centerZ),
      width: o.width,
      springY: o.springY,
      bottomY: o.bottomY,
    })),
  );
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  mesh.position.set(xStart, BASE_Y, centerZ);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);

  if (colliders) {
    const gaps = wallColliderGaps(openings);
    pushIntervals(colliders, -length / 2, length / 2, gaps, (a, b) => {
      if (b - a < 0.015) return;
      colliders.push({
        type: 'box',
        minX: dir > 0 ? xStart : xStart - thickness,
        maxX: dir > 0 ? xStart + thickness : xStart,
        minZ: centerZ + a,
        maxZ: centerZ + b,
      });
    });
  }
  return mesh;
}

function buildCeiling({
  parent, material, x0, x1, z0, z1, y, thickness, holes = [],
}) {
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.lineTo(w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.lineTo(-w / 2, d / 2);
  shape.closePath();

  for (const h of holes) {
    const hx = h.x - cx;
    const hz = h.z - cz;
    const hw = h.w / 2;
    const hd = h.d / 2;
    const path = new THREE.Path();
    path.moveTo(hx - hw, hz - hd);
    path.lineTo(hx - hw, hz + hd);
    path.lineTo(hx + hw, hz + hd);
    path.lineTo(hx + hw, hz - hd);
    path.closePath();
    shape.holes.push(path);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
    steps: 1,
  });
  geo.rotateX(Math.PI / 2);

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx, y + thickness, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  Caustics
 * ------------------------------------------------------------------ */

export function createCausticMaterial() {
  return new THREE.ShaderMaterial({
    name: 'CausticMaterial',
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xbdf5e8) },
      uIntensity: { value: 0.42 },
      uScale: { value: 0.55 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUvW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vUvW = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uScale;
      varying vec2 vUvW;

      float caustic(vec2 uv, float time) {
        vec2 p = uv * 1.55;
        p = mod(p, 6.28318) - 250.0;
        vec2 i = p;
        float c = 1.0;
        float inten = 0.005;
        for (int n = 0; n < 4; n++) {
          float t = time * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
        }
        c /= 4.0;
        c = 1.17 - pow(c, 1.4);
        return clamp(pow(abs(c), 7.0), 0.0, 1.4);
      }

      void main() {
        vec2 p = vUvW * uScale;
        float c = caustic(p, uTime * 0.55);
        c += caustic(p * 1.73 + 11.0, uTime * 0.39) * 0.55;
        c *= 0.72;
        vec3 col = uColor * c * uIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}


function createWallCausticMaterial() {
  return new THREE.ShaderMaterial({
    name: 'WallCausticMaterial',
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xcaf4e6) },
      uIntensity: { value: 0.17 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;

      float caustic(vec2 uv, float time) {
        vec2 p = uv * 1.25;
        p = mod(p, 6.28318) - 250.0;
        vec2 i = p;
        float c = 1.0;
        float inten = 0.005;
        for (int n = 0; n < 3; n++) {
          float t = time * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
        }
        c /= 3.0;
        c = 1.17 - pow(c, 1.4);
        return clamp(pow(abs(c), 7.0), 0.0, 1.2);
      }

      void main() {
        float height = vUv.y;
        float fade = smoothstep(0.02, 0.22, height) * (1.0 - smoothstep(0.6, 2.1, height));
        float c = caustic(vUv * vec2(1.0, 1.35), uTime * 0.42);
        c += caustic(vUv * vec2(1.8, 2.2) + 7.0, uTime * 0.3) * 0.35;
        gl_FragColor = vec4(uColor * c * fade * uIntensity, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function addWallCaustics({ parent, material, planes, cylinders }) {
  for (const p of planes) {
    const geo = new THREE.PlaneGeometry(p.w, p.h);
    metricPlaneUV(geo, p.w, p.h);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(p.x, WATER_Y + (p.y ?? p.h / 2), p.z);
    mesh.rotation.y = p.rotY ?? 0;
    mesh.renderOrder = 1;
    parent.add(mesh);
  }
  for (const c of cylinders) {
    const geo = new THREE.CylinderGeometry(c.r, c.r, c.h, c.seg ?? 32, 1, true, c.thetaStart ?? 0, c.thetaLength ?? Math.PI * 2);
    metricCylinderUV(geo, c.r, c.h, c.arcFraction ?? 1);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(c.x, WATER_Y + (c.y ?? c.h / 2), c.z);
    mesh.renderOrder = 1;
    parent.add(mesh);
  }
}

function addCausticPlane(parent, material, { x, z, w, d, y, circle = false }) {
  const geo = circle
    ? new THREE.CircleGeometry(w / 2, 64)
    : new THREE.PlaneGeometry(w, d);
  if (circle) metricPlaneUV(geo, w, d);
  else metricPlaneUV(geo, w, d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.renderOrder = 1;
  parent.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  Skylights
 * ------------------------------------------------------------------ */

function addSkylight({ parent, materials, list, skylights, ceilingY, sunOffset, dustPositions, shafts, intensity, seedBase }) {
  const rand = mulberry32(seedBase);
  skylights.forEach((s, idx) => {
    /* glass pane above the opening */
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(s.w + 0.05, s.d + 0.05), materials.skylight);
    pane.rotation.x = -Math.PI / 2;
    pane.position.set(s.x, ceilingY + 0.42, s.z);
    parent.add(pane);

    /* mullions inside the light well */
    const barMat = materials.whiteMetal;
    const barY = ceilingY + 0.16;
    const barH = 0.07;
    const barT = 0.055;
    const longX = s.w >= s.d;
    const longLen = longX ? s.w : s.d;
    const shortLen = longX ? s.d : s.w;
    const count = longLen > 3 ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? 0 : (i / (count - 1) - 0.5) * 0.62;
      if (longX) {
        const bar = makeBox(s.w * 0.98, barH, barT, barMat,
          s.x, barY, s.z + f * s.d, { cast: true, receive: false });
        parent.add(bar);
      } else {
        const bar = makeBox(barT, barH, s.d * 0.98, barMat,
          s.x + f * s.w, barY, s.z, { cast: true, receive: false });
        parent.add(bar);
      }
    }
    /* one cross bar */
    if (longX) {
      parent.add(makeBox(barT, barH, s.d * 0.96, barMat, s.x, barY + 0.035, s.z, { cast: true, receive: false }));
    } else {
      parent.add(makeBox(s.w * 0.96, barH, barT, barMat, s.x, barY + 0.035, s.z, { cast: true, receive: false }));
    }

    /* light shaft */
    const height = ceilingY - 0.06;
    const ox = sunOffset.x * (height / 7.4);
    const oz = sunOffset.z * (height / 7.4);
    const beam = {
      x: s.x,
      y: 0.06,
      z: s.z,
      height,
      topW: s.w - 0.1,
      topD: s.d - 0.1,
      bottomW: s.w + 0.9,
      bottomD: s.d + 0.75,
      offsetX: ox,
      offsetZ: oz,
    };
    const shaft = createLightShaft({
      ...beam,
      intensity,
      color: new THREE.Color(1.0, 0.94, 0.82),
      seed: idx * 1.7 + seedBase * 0.01,
    });
    parent.add(shaft);
    shafts.push(shaft);

    /* dust */
    const area = s.w * s.d;
    const dn = Math.round(THREE.MathUtils.clamp(area * 5.0, 40, 300));
    dustPositions.push(...sampleBeamDust(beam, dn, seedBase + idx * 977));
    void rand;
  });
}

/* ------------------------------------------------------------------ *
 *  Props
 * ------------------------------------------------------------------ */

function addLadder(parent, materials, { x, z, topY, bottomY, along = 'x', rotationY = 0 }) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotationY;
  const height = topY - bottomY;
  const halfW = 0.29;
  const railGeo = new THREE.CylinderGeometry(0.024, 0.024, height, 12);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, materials.metal);
    rail.position.set(along === 'x' ? s * halfW : 0, (topY + bottomY) / 2, along === 'x' ? 0 : s * halfW);
    rail.castShadow = true;
    rail.receiveShadow = true;
    g.add(rail);
  }
  const rungs = 6;
  for (let i = 0; i < rungs; i++) {
    const y = topY - 0.12 - (i / (rungs - 1)) * (height - 0.24);
    const rung = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, halfW * 2, 10),
      materials.metal,
    );
    if (along === 'x') {
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, y, 0);
    } else {
      rung.rotation.x = Math.PI / 2;
      rung.position.set(0, y, 0);
    }
    rung.castShadow = true;
    g.add(rung);
  }
  parent.add(g);
  return g;
}

function addBench(parent, materials, woodMat, colliders) {
  const bench = new THREE.Group();
  bench.position.set(-6.4, 0.35, 12.25);
  const seat = makeBox(2.2, 0.09, 0.52, woodMat, 0, 0.44, 0);
  bench.add(seat);
  for (const sx of [-0.85, 0.85]) {
    for (const sz of [-0.18, 0.18]) {
      bench.add(makeBox(0.08, 0.44, 0.08, woodMat, sx, 0.22, sz));
    }
  }
  const back = makeBox(2.2, 0.42, 0.07, woodMat, 0, 0.72, 0.24);
  back.rotation.x = 0.06;
  bench.add(back);
  const towel = makeBox(0.56, 0.09, 0.38, materials.plaster, -0.55, 0.52, 0.02);
  towel.rotation.y = 0.18;
  bench.add(towel);
  parent.add(bench);
  colliders.push({ type: 'box', minX: -7.6, maxX: -5.2, minZ: 11.85, maxZ: 12.65 });
  return bench;
}

/* ------------------------------------------------------------------ *
 *  World
 * ------------------------------------------------------------------ */


export function buildWorld(scene, materials) {
  const root = new THREE.Group();
  scene.add(root);

  const colliders = [];
  const zones = [];
  const shafts = [];
  const dustPositions = [];
  const skylightSets = [];

  const causticMat = createCausticMaterial();
  const wallCausticMat = createWallCausticMaterial();
  const sunOffset = new THREE.Vector3(-1.30, 0, -0.74);

  const plasterCeiling = materials.plaster.clone();
  plasterCeiling.side = THREE.DoubleSide;
  plasterCeiling.emissive = new THREE.Color(0x5f5746);
  plasterCeiling.emissiveIntensity = 0.55;
  const wallDouble = materials.wall.clone();
  wallDouble.side = THREE.DoubleSide;
  const domeMat = materials.dome.clone();
  domeMat.side = THREE.DoubleSide;
  domeMat.emissive = new THREE.Color(0x5a5240);
  domeMat.emissiveIntensity = 0.22;

  /* ================= HALL A ================= */
  const HALL = { x0: -23, x1: 23, z0: -14, z1: 14, top: 7.4 };

  buildWallX({
    parent: root, material: materials.wall,
    centerX: 0, zStart: 14, length: 47.2, thickness: 0.6, topY: HALL.top,
    openings: [
      { at: -6.5, width: 2.4, springY: 2.5, bottomY: 1.15, passable: false },
      { at: 6.5, width: 2.4, springY: 2.5, bottomY: 1.15, passable: false },
    ],
    colliders,
  });
  buildWallX({
    parent: root, material: materials.wall,
    centerX: 0, zStart: -14.6, length: 47.2, thickness: 0.6, topY: HALL.top,
    openings: [{ at: 0, width: 4.8, springY: 1.2 }],
    colliders,
  });
  buildWallZ({
    parent: root, material: materials.wall, side: 'east',
    centerZ: 0, xStart: 23, length: 28, thickness: 0.6, topY: HALL.top,
    openings: [
      { at: -6, width: 4.2, springY: 2.4 },
      { at: 6, width: 4.2, springY: 2.4 },
    ],
    colliders,
  });
  buildWallZ({
    parent: root, material: materials.wall, side: 'west',
    centerZ: 0, xStart: -23, length: 28, thickness: 0.6, topY: HALL.top,
    openings: [{ at: 0, width: 5.0, springY: 2.2 }],
    colliders,
  });

  const hallSkylights = [
    { x: 0, z: -8, w: 9, d: 4.5 },
    { x: 0, z: 0, w: 9, d: 4.5 },
    { x: 0, z: 8, w: 9, d: 4.5 },
  ];
  /* ceiling beams */
  {
    for (const bz of [-12, -4, 4, 12]) {
      const beam = makeBox(46, 0.34, 0.46, materials.plaster, 0, 7.23, bz);
      root.add(beam);
    }
  }

  buildCeiling({
    parent: root, material: plasterCeiling,
    x0: -23.6, x1: 23.6, z0: -14.6, z1: 14.6,
    y: HALL.top, thickness: 0.35, holes: hallSkylights,
  });
  skylightSets.push({ skylights: hallSkylights, ceilingY: HALL.top, intensity: 0.07, seed: 11 });

  /* hall floor */
  {
    const geo = new THREE.PlaneGeometry(46.4, 29.2);
    metricPlaneUV(geo, 46.4, 29.2);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, materials.mosaic);
    floor.position.set(0, FLOORS.hall, 0);
    floor.receiveShadow = true;
    root.add(floor);
    addCausticPlane(root, causticMat, {
      x: 0, z: 0, w: 46, d: 28, y: FLOORS.hall + 0.02,
    });
    /* submerged stair treads */
    addCausticPlane(root, causticMat, {
      x: 0, z: 9.45, w: 12.9, d: 0.48, y: -0.104,
    });
    addCausticPlane(root, causticMat, {
      x: 0, z: 8.95, w: 12.9, d: 0.48, y: -0.334,
    });
    zones.push({ minX: -23.4, maxX: 23.4, minZ: -14.8, maxZ: 14.8, y: FLOORS.hall });
  }

  /* platform and steps */
  {
    const platW = 18, platD = 3.8;
    const plat = makeBox(platW, 0.9, platD,
      [materials.wall, materials.wall, materials.floor, materials.wall, materials.wall, materials.wall],
      0, FLOORS.hall + 0.45, 12.1);
    root.add(plat);
    zones.push({ minX: -9, maxX: 9, minZ: 10.2, maxZ: 14.0, y: 0.35 });

    const steps = [
      { y: 0.12, z: 9.95, d: 0.5 },
      { y: -0.11, z: 9.45, d: 0.5 },
      { y: -0.34, z: 8.95, d: 0.5 },
    ];
    for (const s of steps) {
      const h = s.y - FLOORS.hall;
      const step = makeBox(13, h, s.d,
        [materials.wall, materials.wall, materials.floor, materials.wall, materials.wall, materials.wall],
        0, FLOORS.hall + h / 2, s.z);
      root.add(step);
      zones.push({ minX: -6.5, maxX: 6.5, minZ: s.z - s.d / 2, maxZ: s.z + s.d / 2, y: s.y });
    }

    /* a small bull-nose lip along the platform edge */
    const lip = makeBox(18.06, 0.05, 0.12, materials.floor, 0, 0.305, 10.17);
    root.add(lip);
  }

  /* south-wall niches */
  {
    const backerGeo = new THREE.PlaneGeometry(34, 6);
    metricPlaneUV(backerGeo, 34, 6);
    const nicheMat = materials.wall.clone();
    nicheMat.color.set(0xd8d0c1);
    nicheMat.envMapIntensity = 0.4;
    const backer = new THREE.Mesh(backerGeo, nicheMat);
    backer.rotation.y = Math.PI;
    backer.position.set(0, 2.7, 14.55);
    backer.castShadow = true;
    backer.receiveShadow = true;
    root.add(backer);
    for (const sx of [-6.5, 6.5]) {
      const sill = makeBox(2.7, 0.08, 0.16, materials.floor, sx, 1.11, 13.93);
      root.add(sill);
    }
  }

  /* hall cornice */
  {
    const h = 0.24;
    const yy = 6.88;
    const d = 0.14;
    const c = (w, dd, x, z) => {
      const m = makeBox(w, h, dd, materials.plaster, x, yy, z, { cast: true });
      root.add(m);
    };
    c(46.6, d, 0, 13.93);
    c(46.6, d, 0, -13.93);
    c(d, 28, 22.93, 0);
    c(d, 28, -22.93, 0);
  }

  /* hall columns */
  {
    const shaftGeo = new THREE.CylinderGeometry(0.52, 0.58, 7.0, 36, 1, false);
    metricCylinderUV(shaftGeo, 0.55, 7.0);
    const baseGeo = new THREE.CylinderGeometry(0.86, 0.92, 0.45, 36, 1, false);
    metricCylinderUV(baseGeo, 0.89, 0.45);
    const capGeo = new THREE.CylinderGeometry(0.8, 0.52, 0.5, 36, 1, false);
    metricCylinderUV(capGeo, 0.66, 0.5);
    const bandGeo = new THREE.CylinderGeometry(0.605, 0.605, 0.46, 36, 1, true);
    metricCylinderUV(bandGeo, 0.605, 0.46);

    for (const x of [-11.5, 11.5]) {
      for (const z of [-10, -5, 0, 5, 10]) {
        const base = new THREE.Mesh(baseGeo, materials.wall);
        base.position.set(x, FLOORS.hall + 0.225, z);
        base.castShadow = true; base.receiveShadow = true;
        root.add(base);

        const shaft = new THREE.Mesh(shaftGeo, materials.wall);
        shaft.position.set(x, -0.1 + 3.5, z);
        shaft.castShadow = true; shaft.receiveShadow = true;
        root.add(shaft);

        const cap = new THREE.Mesh(capGeo, materials.wall);
        cap.position.set(x, 7.15, z);
        cap.castShadow = true; cap.receiveShadow = true;
        root.add(cap);

        const band = new THREE.Mesh(bandGeo, materials.accent);
        band.position.set(x, WATER_Y + 0.15, z);
        band.receiveShadow = true;
        root.add(band);

        colliders.push({ type: 'circle', x, z, r: 0.9 });
      }
    }
  }

  addBench(root, materials, new THREE.MeshStandardMaterial({
    color: 0xb8ae9b, roughness: 0.72, metalness: 0.0,
  }), colliders);

  addLadder(root, materials, { x: 9.16, z: 11.5, topY: 1.05, bottomY: -0.55, along: 'z' });

  /* ================= ROOM B (east) ================= */
  const ROOMB = { x0: 23.6, x1: 40, z0: -9, z1: 9, top: 5.4 };
  buildWallX({
    parent: root, material: materials.wall,
    centerX: 31.8, zStart: -9.6, length: 16.4, thickness: 0.6, topY: ROOMB.top,
    colliders,
  });
  buildWallX({
    parent: root, material: materials.wall,
    centerX: 31.8, zStart: 9, length: 16.4, thickness: 0.6, topY: ROOMB.top,
    colliders,
  });
  buildWallZ({
    parent: root, material: materials.wall, side: 'east',
    centerZ: 0, xStart: 40, length: 18, thickness: 0.6, topY: ROOMB.top,
    openings: [
      { at: -4, width: 3.0, springY: 3.2, bottomY: 1.2, passable: false },
      { at: 4, width: 3.0, springY: 3.2, bottomY: 1.2, passable: false },
    ],
    colliders,
  });

  const roomBSkylights = [{ x: 31.8, z: 0, w: 6.2, d: 2.6 }];
  buildCeiling({
    parent: root, material: plasterCeiling,
    x0: 23.6, x1: 40.6, z0: -9.6, z1: 9.6,
    y: ROOMB.top, thickness: 0.35, holes: roomBSkylights,
  });
  skylightSets.push({ skylights: roomBSkylights, ceilingY: ROOMB.top, intensity: 0.055, seed: 23 });

  {
    const geo = new THREE.PlaneGeometry(17.6, 19.2);
    metricPlaneUV(geo, 17.6, 19.2);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, materials.mosaic);
    floor.position.set(31.6, FLOORS.roomB, 0);
    floor.receiveShadow = true;
    root.add(floor);
    addCausticPlane(root, causticMat, {
      x: 31.8, z: 0, w: 16.4, d: 18, y: FLOORS.roomB + 0.02,
    });
    zones.push({ minX: 22.8, maxX: 40.4, minZ: -9.8, maxZ: 9.8, y: FLOORS.roomB });
  }

  /* window mullions + sky backdrop */
  {
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), materials.sky);
    backdrop.rotation.y = -Math.PI / 2;
    backdrop.position.set(41.6, 4.2, 0);
    root.add(backdrop);

    for (const wz of [-4, 4]) {
      const group = new THREE.Group();
      group.position.set(40.25, 0, wz);
      const vbar = makeBox(0.07, 3.4, 0.07, materials.metal, 0, 2.85, 0);
      group.add(vbar);
      const hbar = makeBox(0.04, 0.07, 2.9, materials.metal, 0, 2.55, 0);
      group.add(hbar);
      root.add(group);
    }

    /* sill ledge along the window wall */
    const ledgeW = 0.62;
    const ledge = makeBox(ledgeW, 0.4, 17.2,
      [materials.mosaic, materials.mosaic, materials.floor, materials.wall, materials.mosaic, materials.mosaic],
      39.69, FLOORS.roomB + 0.2, 0);
    root.add(ledge);
    zones.push({ minX: 39.3, maxX: 40.1, minZ: -8.6, maxZ: 8.6, y: FLOORS.roomB + 0.4 });

    addLadder(root, materials, { x: 39.25, z: 1.6, topY: 1.15, bottomY: -0.2, along: 'z', rotationY: 0 });
  }

  /* life ring */
  const lifeRing = createLifeRing(32.6, 2.1);
  lifeRing.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  root.add(lifeRing.group);

  /* ================= ROOM C (west) ================= */
  const ROOMC = { x0: -33.6, x1: -23.6, z0: -6, z1: 12, top: 5.0 };
  buildWallX({
    parent: root, material: materials.wall,
    centerX: -28.9, zStart: -6.6, length: 10.6, thickness: 0.6, topY: ROOMC.top,
    colliders,
  });
  buildWallX({
    parent: root, material: materials.wall,
    centerX: -28.9, zStart: 12, length: 10.6, thickness: 0.6, topY: ROOMC.top,
    colliders,
  });
  buildWallZ({
    parent: root, material: materials.wall, side: 'west',
    centerZ: 3, xStart: -33.6, length: 18, thickness: 0.6, topY: ROOMC.top,
    openings: [
      { at: 0, width: 1.8, springY: 1.6, bottomY: 0.7, passable: false },
      { at: 4.5, width: 1.8, springY: 1.6, bottomY: 0.7, passable: false },
      { at: 9, width: 1.8, springY: 1.6, bottomY: 0.7, passable: false },
    ],
    colliders,
  });

  /* niche backer */
  {
    const backerGeo = new THREE.PlaneGeometry(21, 7);
    metricPlaneUV(backerGeo, 21, 7);
    const nicheMat2 = materials.wall.clone();
    nicheMat2.color.set(0xc6c0b3);
    nicheMat2.envMapIntensity = 0.35;
    const backer = new THREE.Mesh(backerGeo, nicheMat2);
    backer.rotation.y = Math.PI / 2;
    backer.position.set(-34.15, 2.0, 3);
    backer.castShadow = true;
    backer.receiveShadow = true;
    root.add(backer);
  }

  const roomCSkylights = [
    { x: -28.9, z: 0.5, w: 2.2, d: 2.2 },
    { x: -28.9, z: 4.5, w: 2.2, d: 2.2 },
    { x: -28.9, z: 8.5, w: 2.2, d: 2.2 },
  ];
  buildCeiling({
    parent: root, material: plasterCeiling,
    x0: -34.2, x1: -23.6, z0: -6.6, z1: 12.6,
    y: ROOMC.top, thickness: 0.35, holes: roomCSkylights,
  });
  skylightSets.push({ skylights: roomCSkylights, ceilingY: ROOMC.top, intensity: 0.04, seed: 37 });

  {
    const geo = new THREE.PlaneGeometry(11.2, 19.2);
    metricPlaneUV(geo, 11.2, 19.2);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, materials.floor);
    floor.position.set(-28.6, FLOORS.roomC, 3);
    floor.receiveShadow = true;
    root.add(floor);
    addCausticPlane(root, causticMat, {
      x: -28.6, z: 3, w: 10, d: 18, y: FLOORS.roomC + 0.02,
    });
    zones.push({ minX: -34.4, maxX: -22.8, minZ: -6.8, maxZ: 12.8, y: FLOORS.roomC });
  }

  /* room C piers */
  {
    for (const x of [-30.6, -26.6]) {
      for (const z of [1.5, 5.5, 9.5]) {
        const base = makeBox(0.98, 0.25, 0.98, materials.wall, x, -0.1 + 0.125, z);
        root.add(base);
        const shaft = makeBox(0.7, 4.65, 0.7, materials.wall, x, 0.15 + 2.325, z);
        root.add(shaft);
        const cap = makeBox(0.96, 0.2, 0.96, materials.wall, x, 4.9, z);
        root.add(cap);
        colliders.push({ type: 'box', minX: x - 0.52, maxX: x + 0.52, minZ: z - 0.52, maxZ: z + 0.52 });
      }
    }
  }

  /* ================= CORRIDOR ================= */
  const CORR = { x0: -2.8, x1: 2.8, z0: -27, z1: -14.6, top: 4.2 };
  buildWallZ({
    parent: root, material: materials.wall, side: 'west',
    centerZ: -20.8, xStart: -2.8, length: 12.4, thickness: 0.5, topY: CORR.top,
    colliders,
  });
  buildWallZ({
    parent: root, material: materials.wall, side: 'east',
    centerZ: -20.8, xStart: 2.8, length: 12.4, thickness: 0.5, topY: CORR.top,
    colliders,
  });

  const corridorSkylights = [
    { x: 0, z: -24.6, w: 1.8, d: 1.8 },
    { x: 0, z: -21.1, w: 1.8, d: 1.8 },
    { x: 0, z: -17.6, w: 1.8, d: 1.8 },
  ];
  buildCeiling({
    parent: root, material: plasterCeiling,
    x0: -3.3, x1: 3.3, z0: -27.6, z1: -14.6,
    y: CORR.top, thickness: 0.3, holes: corridorSkylights,
  });
  skylightSets.push({ skylights: corridorSkylights, ceilingY: CORR.top, intensity: 0.03, seed: 53 });

  {
    const geo = new THREE.PlaneGeometry(6.0, 12.8);
    metricPlaneUV(geo, 6.0, 12.8);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, materials.floor);
    floor.position.set(0, FLOORS.corridor, -20.8);
    floor.receiveShadow = true;
    root.add(floor);
    addCausticPlane(root, causticMat, {
      x: 0, z: -20.8, w: 5.6, d: 12.4, y: FLOORS.corridor + 0.02,
    });
    zones.push({ minX: -3.2, maxX: 3.2, minZ: -27.4, maxZ: -14.4, y: FLOORS.corridor });
  }

  /* corridor ribs */
  {
    const ribGeo = new THREE.TorusGeometry(2.8, 0.085, 8, 40, Math.PI);
    for (const z of [-25.4, -22.2, -19.0, -15.8]) {
      const rib = new THREE.Mesh(ribGeo, materials.plaster);
      rib.scale.y = 0.46;
      rib.position.set(0, 2.55, z);
      rib.castShadow = true;
      rib.receiveShadow = true;
      root.add(rib);
    }
  }

  /* ================= PORTAL + ROTUNDA ================= */
  buildWallX({
    parent: root, material: materials.wall,
    centerX: 0, zStart: -27.6, length: 5.56, thickness: 0.6, topY: 6.5,
    openings: [{ at: 0, width: 3.6, springY: 1.6 }],
    colliders,
  });

  /* threshold step */
  {
    const step = makeBox(6.0, 0.2, 1.6, materials.floor, 0, -0.55, -27.4, { cast: false });
    root.add(step);
    zones.push({ minX: -3, maxX: 3, minZ: -28.2, maxZ: -27.0, y: FLOORS.threshold });
    addCausticPlane(root, causticMat, {
      x: 0, z: -27.4, w: 5.9, d: 1.5, y: FLOORS.threshold + 0.004,
    });
  }

  const ROT = { x: 0, z: -35, r: 8, top: 6.5 };
  const gapHalf = Math.asin(2.78 / ROT.r);

  /* rotunda floor */
  {
    const geo = new THREE.CircleGeometry(7.95, 96);
    metricPlaneUV(geo, 15.9, 15.9);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, materials.mosaic);
    floor.position.set(ROT.x, FLOORS.rotunda, ROT.z);
    floor.receiveShadow = true;
    root.add(floor);
    addCausticPlane(root, causticMat, {
      x: ROT.x, z: ROT.z, w: 15.8, d: 15.8, y: FLOORS.rotunda + 0.02, circle: true,
    });
    zones.push({ minX: -8.4, maxX: 8.4, minZ: -43.4, maxZ: -26.8, y: FLOORS.rotunda });
  }

  /* rotunda wall */
  {
    const cylinder = new THREE.CylinderGeometry(
      ROT.r, ROT.r, ROT.top - BASE_Y, 96, 1, true,
      gapHalf, Math.PI * 2 - gapHalf * 2,
    );
    metricCylinderUV(cylinder, ROT.r, ROT.top - BASE_Y, 1 - gapHalf / Math.PI);
    const wall = new THREE.Mesh(cylinder, wallDouble);
    wall.position.set(ROT.x, (ROT.top + BASE_Y) / 2, ROT.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    root.add(wall);

    const cornice = new THREE.Mesh(new THREE.TorusGeometry(7.97, 0.07, 8, 96), materials.whiteMetal);
    cornice.rotation.x = Math.PI / 2;
    cornice.position.set(ROT.x, 6.4, ROT.z);
    root.add(cornice);

  }

  /* dome */
  {
    const domeHeight = 4.35;
    const oculusR = 1.2;
    const phiMax = Math.acos(oculusR / ROT.r);
    const pts = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * phiMax;
      pts.push(new THREE.Vector2(ROT.r * Math.cos(phi), domeHeight * Math.sin(phi)));
    }
    const domeGeo = new THREE.LatheGeometry(pts, 96);
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(ROT.x, ROT.top, ROT.z);
    dome.castShadow = true;
    dome.receiveShadow = true;
    root.add(dome);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(oculusR, 0.075, 8, 64), materials.whiteMetal);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(ROT.x, ROT.top + domeHeight, ROT.z);
    root.add(rim);

    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 48), materials.oculus);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(ROT.x, ROT.top + domeHeight + 0.12, ROT.z);
    root.add(disc);

    /* oculus shaft */
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(1.0, 0.93, 0.78) },
        uIntensity: { value: 0.02 },
        uSeed: { value: 5.3 },
        uEdgeFade: { value: 0.0 },
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
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          float h = clamp(vUv.y, 0.0, 1.0);
          float a = pow(h, 1.1) * uIntensity * (0.9 + 0.1 * sin(uTime * 0.4 + uSeed));
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const shaftGeo = new THREE.CylinderGeometry(oculusR * 0.98, 2.9, 10.75, 48, 1, true);
    const oculusShaft = new THREE.Mesh(shaftGeo, shaftMat);
    oculusShaft.position.set(ROT.x, ROT.top + domeHeight - 10.75 / 2 - 0.06, ROT.z);
    oculusShaft.renderOrder = 4;
    root.add(oculusShaft);
    shafts.push(oculusShaft);

    /* dust in the oculus beam */
    const beam = {
      x: ROT.x, z: ROT.z,
      y: 0.05, height: ROT.top + domeHeight - 0.2,
      topW: 2.4, topD: 2.4, bottomW: 5.6, bottomD: 5.6,
      offsetX: 0, offsetZ: 0,
    };
    dustPositions.push(...sampleBeamDust(beam, 170, 7311));
  }

  const rotundaRing = { x: ROT.x, z: ROT.z, r: ROT.r, gapHalf };

  /* ================= SKYLIGHTS ================= */
  for (const set of skylightSets) {
    addSkylight({
      parent: root,
      materials,
      skylights: set.skylights,
      ceilingY: set.ceilingY,
      sunOffset,
      dustPositions,
      shafts,
      intensity: set.intensity,
      seedBase: set.seed,
    });
  }

  /* ================= WATERLINE BANDS ================= */
  {
    const bandH = 0.27;
    const bandT = 0.03;
    const bandY = WATER_Y + 0.145;
    const band = (w, d, x, z) => {
      const m = makeBox(w, bandH, d, materials.accent, x, bandY, z, { cast: false });
      root.add(m);
    };
    /* hall */
    band(46, bandT, 0, 13.985);
    band(20.2, bandT, -12.9, -13.985);
    band(20.2, bandT, 12.9, -13.985);
    band(bandT, 5.9, 22.985, -11.05);
    band(bandT, 7.8, 22.985, 0);
    band(bandT, 5.9, 22.985, 11.05);
    band(bandT, 11.5, -22.985, -8.25);
    band(bandT, 11.5, -22.985, 8.25);
    /* room B */
    band(16.4, bandT, 31.8, -8.985);
    band(16.4, bandT, 31.8, 8.985);
    /* room C */
    band(10, bandT, -28.6, -5.985);
    band(10, bandT, -28.6, 11.985);
    /* corridor */
    band(bandT, 12.4, -2.785, -20.8);
    band(bandT, 12.4, 2.785, -20.8);
    /* rotunda */
    const bandGeo = new THREE.CylinderGeometry(7.985, 7.985, bandH, 96, 1, true, gapHalf, Math.PI * 2 - gapHalf * 2);
    metricCylinderUV(bandGeo, 7.985, bandH, 1 - gapHalf / Math.PI);
    const bandMat = materials.accent.clone();
    bandMat.side = THREE.DoubleSide;
    const rband = new THREE.Mesh(bandGeo, bandMat);
    rband.position.set(ROT.x, bandY, ROT.z);
    root.add(rband);
  }

  /* ================= DOME DETAILS ================= */
  {
    const phiMax = Math.acos(1.2 / 8);
    const domeHeight = 4.35;
    const ribMat = materials.plaster;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      const pts = [];
      for (let j = 0; j <= 26; j++) {
        const phi = (j / 26) * phiMax;
        const rr = (8 - 0.035) * Math.cos(phi);
        pts.push(new THREE.Vector3(
          ROT.x + Math.sin(a) * rr,
          ROT.top + domeHeight * Math.sin(phi) + 0.015,
          ROT.z + Math.cos(a) * rr,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const rib = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.075, 5, false), ribMat);
      rib.castShadow = false;
      rib.receiveShadow = true;
      root.add(rib);
    }
    for (const phi of [0.45, 0.85, 1.2]) {
      const rr = 7.985 * Math.cos(phi);
      const yy = ROT.top + domeHeight * Math.sin(phi) + 0.02;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.05, 6, 96), ribMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(ROT.x, yy, ROT.z);
      root.add(ring);
    }
  }

  /* ================= LIGHTING ================= */
  const hemi = new THREE.HemisphereLight(0xe4e8de, 0xa79c86, 0.36);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffdfb2, 3.4);
  sun.position.set(14, 80, 8);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -56;
  sun.shadow.camera.right = 56;
  sun.shadow.camera.top = 56;
  sun.shadow.camera.bottom = -56;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 4.5;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0xdfe9e2, 0.2);
  fill.position.set(-35, 28, -18);
  scene.add(fill);

  const aquaBounce = new THREE.PointLight(0x63c9bc, 6, 34, 2);
  aquaBounce.position.set(0, 0.7, 0);
  scene.add(aquaBounce);

  const roomBWarm = new THREE.PointLight(0xffe8c6, 12, 24, 2);
  roomBWarm.position.set(36, 3.8, 0);
  scene.add(roomBWarm);

  const oculusSpot = new THREE.SpotLight(0xfff0d4, 60, 22, 0.3, 0.75, 2);
  oculusSpot.position.set(ROT.x, ROT.top + 4.2, ROT.z);
  oculusSpot.target.position.set(ROT.x, 0, ROT.z);
  scene.add(oculusSpot);
  scene.add(oculusSpot.target);

  const domeLight = new THREE.PointLight(0xffe2b8, 22, 13, 2);
  domeLight.position.set(ROT.x, ROT.top + 3.5, ROT.z);
  scene.add(domeLight);


  /* ================= WALL CAUSTICS ================= */
  {
    const P = [];
    const C = [];
    const causticPlane = (w, h, x, z, rotY) => P.push({ w, h, x, z, rotY });

    /* hall */
    causticPlane(46, 1.0, 0, 13.984, Math.PI);
    causticPlane(20.2, 2.2, -12.9, -13.984, 0);
    causticPlane(20.2, 2.2, 12.9, -13.984, 0);
    causticPlane(5.9, 2.2, 22.984, -11.05, -Math.PI / 2);
    causticPlane(7.8, 2.2, 22.984, 0, -Math.PI / 2);
    causticPlane(5.9, 2.2, 22.984, 11.05, -Math.PI / 2);
    causticPlane(11.5, 2.2, -22.984, -8.25, Math.PI / 2);
    causticPlane(11.5, 2.2, -22.984, 8.25, Math.PI / 2);
    /* room B */
    causticPlane(16.4, 2.2, 31.8, -8.984, 0);
    causticPlane(16.4, 2.2, 31.8, 8.984, Math.PI);
    /* room C */
    causticPlane(10, 1.6, -28.6, -5.984, 0);
    causticPlane(10, 1.6, -28.6, 11.984, Math.PI);
    /* corridor */
    causticPlane(12.4, 1.9, 2.784, -20.8, -Math.PI / 2);
    causticPlane(12.4, 1.9, -2.784, -20.8, Math.PI / 2);
    /* hall columns */
    for (const x of [-11.5, 11.5]) {
      for (const z of [-10, -5, 0, 5, 10]) {
        C.push({ x, z, r: 0.62, h: 1.45, y: 0.725, seg: 32 });
      }
    }
    /* rotunda */
    C.push({
      x: 0, z: ROT.z, r: 7.95, h: 2.2, y: 1.1, seg: 96,
      thetaStart: gapHalf, thetaLength: Math.PI * 2 - gapHalf * 2,
      arcFraction: 1 - gapHalf / Math.PI,
    });

    addWallCaustics({ parent: root, material: wallCausticMat, planes: P, cylinders: C });
  }

  /* ================= AGGREGATE EFFECTS ================= */
  const dust = new DustField(dustPositions, { fov: 66 });
  root.add(dust.points);

  const shaftSystem = new LightShafts(shafts);

  /* ================= UPDATE ================= */
  const clockTime = { t: 0 };

  function update(t, dt) {
    clockTime.t = t;
    causticMat.uniforms.uTime.value = t;
    wallCausticMat.uniforms.uTime.value = t;
    shaftSystem.update(t);
    dust.update(t);
    lifeRing.update(t, dt, world.water);
    if (world.water) {
      // random drips, biased around the player
      world.dripAccum = (world.dripAccum || 0) + dt;
      if (world.dripAccum > 1.3 + Math.random() * 1.8) {
        world.dripAccum = 0;
        const cam = world.camera;
        if (cam) {
          const px = cam.position.x - 10 + Math.random() * 20;
          const pz = cam.position.z - 8 + Math.random() * 20;
          world.water.addRipple(px, pz, 0.22 + Math.random() * 0.25);
        } else {
          world.water.addRipple(-15 + Math.random() * 30, -20 + Math.random() * 25, 0.3);
        }
      }
    }
    if (materials.skylight.map) {
      materials.skylight.map.offset.x = Math.sin(t * 0.012) * 0.02;
      materials.skylight.map.offset.y = Math.cos(t * 0.009) * 0.02;
    }
    sun.intensity = 3.4 * (1 + Math.sin(t * 0.1) * 0.015);
    aquaBounce.intensity = 6 * (0.9 + 0.1 * Math.sin(t * 0.3));
    void clockTime;
  }

  const world = {
    root,
    colliders,
    zones,
    rotundaRing,
    causticMat,
    dust,
    shafts: shaftSystem,
    sun,
    fill,
    lifeRing,
    defaultFloor: FLOORS.hall,
    water: null,
    camera: null,
    dripAccum: 0,
    update,
    setViewport(height, fov, pixelRatio) {
      dust.setViewport(height, fov, pixelRatio);
    },
  };

  return world;
}
