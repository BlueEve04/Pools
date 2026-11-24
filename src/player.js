import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_HEIGHT = 1.68;
const RADIUS = 0.32;
const MAX_STEP = 0.52;

export class Player {
  constructor({ camera, domElement, world, spawn, onStep }) {
    this.camera = camera;
    this.world = world;
    this.onStep = onStep || (() => {});
    this.spawn = spawn;

    this.controls = new PointerLockControls(camera, domElement);
    this.controls.pointerSpeed = 0.82;
    this.controls.minPolarAngle = 0.16;
    this.controls.maxPolarAngle = Math.PI - 0.16;

    this.keys = new Set();
    this.active = false;
    this.locked = false;

    this.pos = { x: spawn.x, z: spawn.z };
    this.velocity = new THREE.Vector2();
    this.groundY = spawn.y;
    this.bobPhase = 0;
    this.bobAmp = 0;
    this.stepDist = 0;
    this.inWater = spawn.y < -0.06;
    this.falling = false;
    this.fallDistance = 0;

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.tmp = new THREE.Vector3();

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === domElement;
    });

    this.updateCamera(0);
  }

  lock() {
    this.controls.lock();
  }

  unlock() {
    this.controls.unlock();
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.velocity.set(0, 0);
      this.keys.clear();
    }
  }

  teleport(x, z, groundY = null) {
    this.pos.x = x;
    this.pos.z = z;
    const g = groundY !== null ? groundY : this.groundAt(x, z);
    this.groundY = g;
    this.inWater = g < -0.06;
    this.velocity.set(0, 0);
    this.updateCamera(0);
  }

  lookAt(x, y, z) {
    this.camera.lookAt(x, y, z);
  }

  groundAt(x, z) {
    let best = this.world.defaultFloor;
    let found = false;
    for (const zone of this.world.zones) {
      if (x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ) {
        if (!found || zone.y > best) best = zone.y;
        found = true;
      }
    }
    return best;
  }

  blocked(x, z) {
    const r = RADIUS;
    for (const c of this.world.colliders) {
      if (c.type === 'box') {
        if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
      } else if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        const rr = c.r + r;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }

    const ring = this.world.rotundaRing;
    if (ring && z < -27.0) {
      const dx = x - ring.x;
      const dz = z - ring.z;
      const d = Math.hypot(dx, dz);
      if (d > ring.r - r - 0.04) {
        const ang = Math.atan2(dx, dz);
        if (Math.abs(ang) > ring.gapHalf + 0.015) return true;
      }
    }

    return false;
  }

  updateCamera(bobOffset = 0) {
    const lat = this.bobLat || 0;
    this.camera.position.set(
      this.pos.x + this.right.x * lat,
      this.groundY + EYE_HEIGHT + this.groundY * 0 + bobOffset,
      this.pos.z + this.right.z * lat,
    );
  }

  update(dt, time) {
    if (!this.active) return;

    /* ---- orientation vectors ---- */
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();

    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();

    const k = this.keys;
    let ix = 0;
    let iz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;

    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const wantMove = ix !== 0 || iz !== 0;

    const baseSpeed = sprint ? 3.45 : 2.05;
    const waterFactor = this.inWater ? 0.7 : 1.0;
    const speed = baseSpeed * waterFactor;

    let wishX = 0;
    let wishZ = 0;
    if (wantMove) {
      const inv = 1 / Math.hypot(ix, iz);
      ix *= inv;
      iz *= inv;
      wishX = (this.forward.x * iz + this.right.x * ix) * speed;
      wishZ = (this.forward.z * iz + this.right.z * ix) * speed;
    }

    const accel = 1 - Math.exp(-dt * (wantMove ? 10.5 : 7.5));
    this.velocity.x += (wishX - this.velocity.x) * accel;
    this.velocity.y += (wishZ - this.velocity.y) * accel;
    if (this.velocity.lengthSq() < 1e-5) this.velocity.set(0, 0);

    /* ---- axis separated movement + step limit ---- */
    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    const oldGround = this.groundY;

    const nx = this.pos.x + this.velocity.x * dt;
    if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
    else this.velocity.x *= 0.1;

    const nz = this.pos.z + this.velocity.y * dt;
    if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
    else this.velocity.y *= 0.1;

    const groundNow = this.groundAt(this.pos.x, this.pos.z);
    if (groundNow - oldGround > MAX_STEP) {
      this.pos.x = prevX;
      this.pos.z = prevZ;
      this.velocity.set(0, 0);
    }

    const targetGround = this.groundAt(this.pos.x, this.pos.z);
    const wasInWater = this.inWater;
    this.inWater = targetGround < -0.06;

    /* falling splash */
    if (targetGround < this.groundY - 0.32) {
      this.falling = true;
      this.fallDistance = Math.max(this.fallDistance, this.groundY - targetGround);
    }
    const fallRate = targetGround < this.groundY ? 12.0 : 15.0;
    this.groundY += (targetGround - this.groundY) * (1 - Math.exp(-dt * fallRate));
    if (this.falling && Math.abs(targetGround - this.groundY) < 0.07) {
      if (this.inWater && this.fallDistance > 0.3) {
        this.onStep({
          type: 'splash',
          water: true,
          x: this.pos.x,
          z: this.pos.z,
          strength: Math.min(1.4, 0.5 + this.fallDistance * 0.6),
        });
      }
      this.falling = false;
      this.fallDistance = 0;
    }

    /* ---- bob + footsteps ---- */
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.y);
    const moving = hSpeed > 0.25;
    if (moving) {
      this.bobPhase += hSpeed * dt * 2.15;
      this.stepDist += hSpeed * dt;
      const stride = this.inWater ? 1.08 : 0.82;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.onStep({
          type: 'step',
          water: this.inWater,
          x: this.pos.x,
          z: this.pos.z,
          strength: sprint ? 1.0 : 0.7,
        });
      }
    }

    const targetAmp = moving ? (this.inWater ? 0.042 : 0.021) * (sprint ? 1.35 : 1) : 0;
    this.bobAmp += (targetAmp - this.bobAmp) * (1 - Math.exp(-dt * 5));
    const bob = Math.sin(this.bobPhase * 2.0) * this.bobAmp;
    this.bobLat = Math.cos(this.bobPhase) * this.bobAmp * 0.6;

    /* subtle water sway */
    let sway = 0;
    if (this.inWater && !moving) {
      sway = Math.sin(time * 0.9) * 0.006;
    }

    this.updateCamera(bob + sway);

    void wasInWater;
  }
}
