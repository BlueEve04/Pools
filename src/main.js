import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMaterials, applyUnderwaterTint } from './materials.js';
import { createEnvironmentTexture } from './textures.js';
import { buildWorld } from './world.js';
import { Water } from './water.js';
import { Player } from './player.js';
import { createPost } from './postfx.js';
import { PoolAudio } from './audio.js';
import { WATER_Y, WATER_MAX_DEPTH } from './config.js';

const app = document.getElementById('app');
const loaderEl = document.getElementById('loader');
const introEl = document.getElementById('intro');
const enterBtn = document.getElementById('enterBtn');
const hudEl = document.getElementById('hud');
const soundBtn = document.getElementById('soundBtn');
const toastEl = document.getElementById('toast');

const params = new URLSearchParams(location.search);
const lowQuality = params.get('quality') === 'low';
const isTouch = window.matchMedia('(pointer: coarse)').matches;

/* ------------------------------------------------------------------ *
 *  Renderer / scene
 * ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd7e6e1);
scene.fog = new THREE.FogExp2(0xd7e6e1, 0.0068);

const camera = new THREE.PerspectiveCamera(
  66,
  window.innerWidth / window.innerHeight,
  0.06,
  260,
);
camera.position.set(6.2, 2.02, 10.8);
camera.lookAt(-2, 1.25, -6);

/* environment */
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envSource = createEnvironmentTexture();
  const envRT = pmrem.fromEquirectangular(envSource);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.24;
  envSource.dispose();
  pmrem.dispose();
}

/* ------------------------------------------------------------------ *
 *  Content
 * ------------------------------------------------------------------ */

const materials = createMaterials(renderer);
const world = buildWorld(scene, materials);

/* Submerged opaque geometry needs a subtle water absorption tint. */
{
  const tinted = new Set();
  world.root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of list) {
      if (tinted.has(mat)) continue;
      if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
        tinted.add(mat);
        applyUnderwaterTint(mat, WATER_Y);
      }
    }
  });
}

const water = new Water(renderer);
scene.add(water.mesh);
world.water = water;
world.camera = camera;
water.setDepthMapFromZones(world.zones, { waterY: WATER_Y, maxDepth: WATER_MAX_DEPTH });
water.setAtmosphere(scene.fog.color, scene.fog.density);
water.setSun(new THREE.Vector3(14, 80, 8).normalize(), new THREE.Color(0xffeed2));

const audio = new PoolAudio();

const player = new Player({
  camera,
  domElement: renderer.domElement,
  world,
  spawn: { x: 6.2, z: 10.8, y: 0.35 },
  onStep: (info) => {
    audio.step(info);
    if (info.water) {
      water.addRipple(info.x, info.z, info.type === 'splash' ? 1.3 : 0.55);
    }
  },
});

const post = createPost(renderer, scene, camera);

/* ------------------------------------------------------------------ *
 *  Resize
 * ------------------------------------------------------------------ */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(lowQuality ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h);

  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  const scale = lowQuality ? 0.45 : 0.6;
  water.setSize(
    Math.min(2048, Math.max(320, Math.floor(buf.x * scale))),
    Math.min(2048, Math.max(180, Math.floor(buf.y * scale))),
    buf.x,
    buf.y,
  );
  world.setViewport(h, camera.fov, renderer.getPixelRatio());
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ *
 *  UI
 * ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(msg, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function updateSoundLabel() {
  soundBtn.textContent = audio.enabled ? '◍ 声音 开' : '◌ 声音 关';
}

async function toggleSound() {
  if (!audio.started) {
    await audio.start();
    updateSoundLabel();
    toast('环境声 · 开');
    return;
  }
  const on = audio.toggle();
  updateSoundLabel();
  toast(on ? '环境声 · 开' : '环境声 · 关');
}

soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSound();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) toggleSound();
});

let introActive = true;
let hasEntered = false;

function hideIntro() {
  introEl.classList.remove('show');
}

function showIntro() {
  enterBtn.innerHTML = hasEntered ? '<span>继 续 漫 游</span>' : '<span>进 入 水 域</span>';
  introEl.classList.add('show');
}

/* touch orbit fallback */
let orbit = null;
if (isTouch) {
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.055;
  orbit.target.set(0, 1.5, -1);
  orbit.minDistance = 2;
  orbit.maxDistance = 60;
  orbit.maxPolarAngle = Math.PI / 2 - 0.03;
  orbit.autoRotateSpeed = 0.18;
  orbit.enabled = false;
}

function startTouchMode() {
  introActive = false;
  hasEntered = true;
  hideIntro();
  hudEl.classList.add('show');
  camera.position.set(10.5, 4.6, 17.5);
  if (orbit) {
    orbit.target.set(-1, 1.2, -2);
    orbit.autoRotate = true;
    orbit.enabled = true;
    orbit.update();
  }
  audio.start();
}

function enterWorld() {
  audio.start();
  if (isTouch) {
    startTouchMode();
    return;
  }
  hideIntro();
  player.controls.lock();
}

enterBtn.addEventListener('click', enterWorld);

document.addEventListener('pointerlockerror', () => {
  showIntro();
  toast('无法锁定鼠标，请再试一次');
});

player.controls.addEventListener('lock', () => {
  introActive = false;
  hasEntered = true;
  player.setActive(true);
  player.updateCamera(0);
  hideIntro();
  hudEl.classList.add('show');
  updateSoundLabel();
});

player.controls.addEventListener('unlock', () => {
  player.setActive(false);
  hudEl.classList.remove('show');
  showIntro();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && player.active && e.shiftKey) {
    player.teleport(6.2, 10.8);
  }
});

/* ------------------------------------------------------------------ *
 *  Loop
 * ------------------------------------------------------------------ */

let started = false;
let elapsed = 0;
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (!Number.isFinite(dt) || dt < 0) return;
  elapsed += dt;

  if (!player.active && introActive && !isTouch) {
    const s = elapsed;
    camera.position.set(
      6.2 + Math.sin(s * 0.11) * 0.32,
      2.06 + Math.sin(s * 0.33) * 0.012,
      12.5 + Math.cos(s * 0.09) * 0.12,
    );
    camera.lookAt(-1.5 + Math.sin(s * 0.05) * 1.2, 1.42, -5);
  }

  if (isTouch && orbit) {
    orbit.update();
  }

  player.update(dt, elapsed);
  water.update(elapsed, camera);
  world.update(elapsed, dt);

  /* refract the underwater scene; hide additive air effects for this pass */
  const shaftVisibility = world.shafts.meshes.map((m) => m.visible);
  world.shafts.meshes.forEach((m) => { m.visible = false; });
  const dustVisible = world.dust.points.visible;
  world.dust.points.visible = false;
  water.renderRefraction(renderer, scene, camera);
  world.shafts.meshes.forEach((m, i) => { m.visible = shaftVisibility[i]; });
  world.dust.points.visible = dustVisible;

  post.update(elapsed);
  post.render();

  if (!started) {
    started = true;
    setTimeout(() => {
      loaderEl.classList.add('done');
      setTimeout(() => {
        if (!hasEntered) introEl.classList.add('show');
      }, 550);
    }, 120);
  }
}
requestAnimationFrame(animate);

/* ------------------------------------------------------------------ *
 *  Debug / screenshot API
 * ------------------------------------------------------------------ */

function hideAllUI() {
  loaderEl.classList.add('done');
  introEl.classList.remove('show');
  hudEl.classList.remove('show');
  toastEl.classList.remove('show');
}

window.__pool = {
  scene, camera, renderer, world, water, player, post, materials, audio,
  setView(x, y, z, tx, ty, tz, opts = {}) {
    introActive = false;
    player.setActive(false);
    hideAllUI();
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
    if (opts.fov) {
      camera.fov = opts.fov;
      camera.updateProjectionMatrix();
      resize();
    }
    water.update(performance.now() / 1000, camera);
  },
  hideUI: hideAllUI,
  resetIntro() {
    introActive = true;
    hideAllUI();
    introEl.classList.add('show');
  },
  info() {
    const r = renderer.info;
    return {
      calls: r.render.calls,
      triangles: r.render.triangles,
      points: r.render.points,
      geometries: r.memory.geometries,
      textures: r.memory.textures,
    };
  },
  setShadowSize(n) {
    world.sun.shadow.mapSize.set(n, n);
    if (world.sun.shadow.map) {
      world.sun.shadow.map.dispose();
      world.sun.shadow.map = null;
    }
  },
  setExposure(v) {
    renderer.toneMappingExposure = v;
  },
  setBloom(strength, radius, threshold) {
    post.bloom.strength = strength;
    if (radius !== undefined) post.bloom.radius = radius;
    if (threshold !== undefined) post.bloom.threshold = threshold;
  },
};
