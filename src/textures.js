import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Deterministic noise helpers
 * ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2i(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

function pnoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const wrap = (n, p) => ((n % p) + p) % p;
  const x0 = wrap(xi, period), x1 = wrap(xi + 1, period);
  const y0 = wrap(yi, period), y1 = wrap(yi + 1, period);
  const v00 = hash2i(x0, y0, seed);
  const v10 = hash2i(x1, y0, seed);
  const v01 = hash2i(x0, y1, seed);
  const v11 = hash2i(x1, y1, seed);
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

function pfbm(x, y, period, octaves, seed) {
  let value = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    value += pnoise(x * freq, y * freq, period * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

/* ------------------------------------------------------------------ *
 *  Canvas helpers
 * ------------------------------------------------------------------ */

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function shade(c, f) {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

function toTexture(canvas, srgb, anisotropy = 8) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/* Tileable grime / mineral blotches, used as a multiply overlay. */
function makePatinaCanvas(size, seed, strength = 1) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n1 = pfbm(u * 4, v * 4, 4, 4, seed);
      const n2 = pfbm(u * 16 + 7.3, v * 16 + 3.1, 16, 2, seed + 57);
      let b = 232 - (1 - n1) * 50 * strength - (1 - n2) * 10 * strength;
      b = Math.max(150, Math.min(252, b));
      const i = (y * size + x) * 4;
      d[i] = b;
      d[i + 1] = b;
      d[i + 2] = b * 0.995;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function heightToNormalCanvas(heightCanvas, strength, size) {
  const src = heightCanvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(size, size);
  const dst = img.data;
  const h = (x, y) => {
    const xx = ((x % size) + size) % size;
    const yy = ((y % size) + size) % size;
    return src[(yy * size + xx) * 4] / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      let nx = -dx;
      let ny = dy;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const nz = inv;
      const i = (y * size + x) * 4;
      dst[i] = (nx * 0.5 + 0.5) * 255;
      dst[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/* ------------------------------------------------------------------ *
 *  Ceramic tile sets
 * ------------------------------------------------------------------ */

export function createTileTextures(opts = {}) {
  const {
    size = 1024,
    tiles = 12,
    palette = [[238, 233, 220]],
    rareTiles = [],
    rareChance = 0.04,
    groutColor = [182, 176, 160],
    groutRatio = 0.05,
    tileRoughness = [0.2, 0.36],
    groutRoughness = 0.62,
    seed = 1,
    normalStrength = 3.0,
    tileRadius = 1.2,
    veins = false,
    speckles = 0.0016,
    glaze = 0.09,
    patinaStrength = 1,
  } = opts;

  const rand = mulberry32(seed);
  const pitch = size / tiles;
  const groutPx = Math.max(1.4, pitch * groutRatio);

  const colorC = makeCanvas(size);
  const color = colorC.getContext('2d');
  const heightC = makeCanvas(size);
  const height = heightC.getContext('2d');
  const roughC = makeCanvas(size);
  const rough = roughC.getContext('2d');

  /* grout bed */
  color.fillStyle = rgb(groutColor);
  color.fillRect(0, 0, size, size);
  height.fillStyle = '#1a1a1a';
  height.fillRect(0, 0, size, size);
  const gr = groutRoughness * 255;
  rough.fillStyle = `rgb(${gr | 0},${gr | 0},${gr | 0})`;
  rough.fillRect(0, 0, size, size);

  const inset = groutPx * 0.5;
  const tileW = pitch - groutPx;
  const radius = Math.max(0.6, tileRadius * pitch / 85);

  for (let j = 0; j < tiles; j++) {
    for (let i = 0; i < tiles; i++) {
      const x = i * pitch + inset;
      const y = j * pitch + inset;
      const w = tileW;
      const hh = tileW;

      let base = palette[Math.floor(rand() * palette.length)];
      if (rareTiles.length && rand() < rareChance) {
        base = rareTiles[Math.floor(rand() * rareTiles.length)];
      }
      const tint = shade(base, 0.965 + rand() * 0.06);
      if (rand() < 0.18) tint[2] = Math.min(255, tint[2] + 1.6); // faint cool cast

      /* ---- color ---- */
      roundRect(color, x, y, w, hh, radius);
      color.fillStyle = rgb(tint);
      color.fill();

      if (glaze > 0) {
        const gx = x + rand() * w * 0.6;
        const gy = y + rand() * hh * 0.6;
        const g = color.createRadialGradient(gx, gy, 0, gx, gy, pitch * 0.8);
        g.addColorStop(0, `rgba(255,255,255,${glaze})`);
        g.addColorStop(0.55, 'rgba(255,255,255,0.012)');
        g.addColorStop(1, 'rgba(0,0,0,0.028)');
        color.fillStyle = g;
        color.fill();
      }

      /* bevel highlight / shade */
      color.save();
      roundRect(color, x + 0.5, y + 0.5, w - 1, hh - 1, radius);
      color.clip();
      color.strokeStyle = 'rgba(255,255,255,0.13)';
      color.lineWidth = 1.2;
      color.beginPath();
      color.moveTo(x, y + hh);
      color.lineTo(x, y);
      color.lineTo(x + w, y);
      color.stroke();
      color.strokeStyle = 'rgba(20,18,12,0.10)';
      color.beginPath();
      color.moveTo(x + w, y);
      color.lineTo(x + w, y + hh);
      color.lineTo(x, y + hh);
      color.stroke();
      color.restore();

      /* faint stone veins */
      if (veins && rand() < 0.5) {
        color.save();
        roundRect(color, x, y, w, hh, radius);
        color.clip();
        const nv = 1 + (rand() < 0.35 ? 1 : 0);
        for (let k = 0; k < nv; k++) {
          color.strokeStyle = `rgba(120,112,96,${0.045 + rand() * 0.05})`;
          color.lineWidth = 0.6 + rand() * 0.9;
          color.beginPath();
          const sx = x + rand() * w, sy = y + rand() * hh;
          color.moveTo(sx, sy);
          color.bezierCurveTo(
            sx + (rand() - 0.4) * w, sy + (rand() - 0.5) * hh,
            sx + (rand() - 0.6) * w, sy + (rand() - 0.5) * hh,
            sx + (rand() - 0.5) * w, sy + (rand() - 0.5) * hh
          );
          color.stroke();
        }
        color.restore();
      }

      /* grout shadow hugging the tile */
      roundRect(color, x, y, w, hh, radius);
      color.strokeStyle = 'rgba(46,40,30,0.10)';
      color.lineWidth = 1;
      color.stroke();

      /* ---- roughness ---- */
      const rv = tileRoughness[0] + rand() * (tileRoughness[1] - tileRoughness[0]);
      roundRect(rough, x, y, w, hh, radius);
      rough.fillStyle = `rgb(${(rv * 255) | 0},${(rv * 255) | 0},${(rv * 255) | 0})`;
      rough.fill();

      /* ---- height ---- */
      roundRect(height, x, y, w, hh, radius);
      height.fillStyle = '#b4b4b4';
      height.fill();
      const bIn = Math.max(1, groutPx * 0.42);
      roundRect(height, x + bIn, y + bIn, w - bIn * 2, hh - bIn * 2, radius * 0.8);
      height.fillStyle = '#e6e6e6';
      height.fill();
    }
  }

  /* fine speckle / mineral dust */
  const nSpeck = Math.floor(size * size * speckles);
  for (let k = 0; k < nSpeck; k++) {
    const x = rand() * size, y = rand() * size;
    color.fillStyle = rand() < 0.5
      ? `rgba(255,255,255,${0.03 + rand() * 0.05})`
      : `rgba(70,62,50,${0.022 + rand() * 0.04})`;
    const s = rand() < 0.85 ? 1 : 1.6;
    color.fillRect(x, y, s, s);
  }

  /* mineral patina multiply */
  const patina = makePatinaCanvas(256, seed + 91, patinaStrength);
  color.save();
  color.globalCompositeOperation = 'multiply';
  color.globalAlpha = 0.52;
  color.imageSmoothingEnabled = true;
  color.drawImage(patina, 0, 0, size, size);
  color.restore();

  /* soften height, then derive normal */
  const blurred = makeCanvas(size);
  const bctx = blurred.getContext('2d');
  bctx.filter = `blur(${Math.max(0.8, size / 700)}px)`;
  bctx.drawImage(heightC, 0, 0);
  const normalMap = toTexture(heightToNormalCanvas(blurred, normalStrength, size), false);
  const roughnessMap = toTexture(roughC, false);
  const map = toTexture(colorC, true);

  return { map, normalMap, roughnessMap };
}

/* ------------------------------------------------------------------ *
 *  Plaster (ceiling, dome)
 * ------------------------------------------------------------------ */

export function createPlasterTextures({ size = 512, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const colorC = makeCanvas(size);
  const color = colorC.getContext('2d');
  const img = color.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const big = pfbm(u * 3, v * 3, 3, 3, seed);
      const fine = pfbm(u * 48 + 4.2, v * 48 + 8.7, 48, 2, seed + 33);
      let b = 234 - (1 - big) * 15 - (1 - fine) * 7;
      b += (rand() - 0.5) * 2.2;
      const warm = 0.992 + big * 0.008;
      const i = (y * size + x) * 4;
      d[i] = b;
      d[i + 1] = b * 0.998;
      d[i + 2] = b * warm * 0.972;
      d[i + 3] = 255;
    }
  }
  color.putImageData(img, 0, 0);

  /* height for a very soft surface bump */
  const heightC = makeCanvas(size);
  const hctx = heightC.getContext('2d');
  const hImg = hctx.createImageData(size, size);
  const hd = hImg.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = pfbm(u * 24, v * 24, 24, 3, seed + 5) * 0.7 + pfbm(u * 64, v * 64, 64, 2, seed + 8) * 0.3;
      const b = 128 + n * 80;
      const i = (y * size + x) * 4;
      hd[i] = hd[i + 1] = hd[i + 2] = b;
      hd[i + 3] = 255;
    }
  }
  hctx.putImageData(hImg, 0, 0);

  const roughC = makeCanvas(size);
  const rctx = roughC.getContext('2d');
  const rImg = rctx.createImageData(size, size);
  const rd = rImg.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = pfbm(u * 6, v * 6, 6, 3, seed + 21);
      const g = 208 + n * 26;
      const i = (y * size + x) * 4;
      rd[i] = rd[i + 1] = rd[i + 2] = g;
      rd[i + 3] = 255;
    }
  }
  rctx.putImageData(rImg, 0, 0);

  return {
    map: toTexture(colorC, true),
    normalMap: toTexture(heightToNormalCanvas(heightC, 0.9, size), false),
    roughnessMap: toTexture(roughC, false),
  };
}

/* ------------------------------------------------------------------ *
 *  Sky / skylight textures
 * ------------------------------------------------------------------ */

export function createSkyTexture({ w = 768, h = 1024, seed = 12 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#9ec6d1');
  g.addColorStop(0.34, '#c7dde0');
  g.addColorStop(0.62, '#e7e9de');
  g.addColorStop(0.84, '#f7efdc');
  g.addColorStop(1.0, '#fbf5e7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* sun glow */
  const sx = w * 0.66, sy = h * 0.34;
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.55);
  sun.addColorStop(0, 'rgba(255,252,240,0.95)');
  sun.addColorStop(0.18, 'rgba(255,250,235,0.55)');
  sun.addColorStop(0.55, 'rgba(255,248,232,0.16)');
  sun.addColorStop(1, 'rgba(255,248,232,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  /* soft cloud shelves */
  ctx.save();
  ctx.filter = `blur(${Math.round(w * 0.045)}px)`;
  for (let i = 0; i < 14; i++) {
    const cx = rand() * w;
    const cy = h * (0.08 + rand() * 0.34);
    const rx = w * (0.1 + rand() * 0.24);
    const ry = rx * (0.16 + rand() * 0.18);
    ctx.fillStyle = `rgba(255,255,250,${0.05 + rand() * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const t = toTexture(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function createSkylightTexture({ size = 512, seed = 31 } = {}) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#f2f8f4');
  g.addColorStop(1, '#eaf3ef');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.filter = `blur(${Math.round(size * 0.06)}px)`;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(206,224,224,${0.05 + rand() * 0.11})`;
    ctx.beginPath();
    ctx.ellipse(rand() * size, rand() * size, size * (0.1 + rand() * 0.3), size * (0.05 + rand() * 0.12), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const t = toTexture(c, true);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* ------------------------------------------------------------------ *
 *  Small sprites
 * ------------------------------------------------------------------ */

export function createDustTexture(size = 64) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ *
 *  Environment map (equirectangular gradient for PBR reflections)
 * ------------------------------------------------------------------ */

export function createEnvironmentTexture({ w = 1024, h = 512, seed = 77 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rand = mulberry32(seed);

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#b5d1d5');
  g.addColorStop(0.28, '#cfe3e2');
  g.addColorStop(0.47, '#f4f0e1');
  g.addColorStop(0.52, '#fdf7e7');
  g.addColorStop(0.62, '#e6e2d3');
  g.addColorStop(0.8, '#c0b6a1');
  g.addColorStop(1.0, '#9c9383');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* sun bloom */
  const sx = w * 0.62, sy = h * 0.2;
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.24);
  sun.addColorStop(0, 'rgba(255,252,242,1)');
  sun.addColorStop(0.15, 'rgba(255,248,232,0.85)');
  sun.addColorStop(0.5, 'rgba(255,244,224,0.22)');
  sun.addColorStop(1, 'rgba(255,244,224,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  /* cloud haze near the horizon */
  ctx.save();
  ctx.filter = `blur(${Math.round(w * 0.02)}px)`;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(255,255,248,${0.04 + rand() * 0.09})`;
    ctx.beginPath();
    ctx.ellipse(rand() * w, h * (0.3 + rand() * 0.15), w * (0.08 + rand() * 0.2), h * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}
