/* Procedural poolroom ambience, water footsteps and drips. */

export class PoolAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.enabled = true;
    this.master = null;
    this.wet = null;
    this.dry = null;
    this.dripTimeout = null;
    this.ambientNodes = [];
  }

  ensureContext() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0.0;
    this.master.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.dry.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 2.8, 2.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.wet.connect(convolver);
    convolver.connect(this.master);

    this.buildAmbience();
    return true;
  }

  makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        data[i] = last * env * 0.55;
      }
    }
    return buffer;
  }

  makeNoiseBuffer(ctx, seconds = 6) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.018 * white) / 1.018;
        data[i] = brown * 3.2;
      }
    }
    return buffer;
  }

  noiseSource(loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(this.ctx, loop ? 6 : 0.5);
    src.loop = loop;
    return src;
  }

  buildAmbience() {
    const ctx = this.ctx;

    /* deep room rumble */
    const rumbleSrc = this.noiseSource();
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 190;
    rumbleFilter.Q.value = 0.5;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.055;
    rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(this.dry);
    rumbleSrc.start();

    /* air / distant water */
    const airSrc = this.noiseSource();
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 780;
    airFilter.Q.value = 0.55;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.014;
    airSrc.connect(airFilter).connect(airGain).connect(this.dry);
    airSrc.start();

    /* slow lapping swell */
    const lapSrc = this.noiseSource();
    const lapFilter = ctx.createBiquadFilter();
    lapFilter.type = 'lowpass';
    lapFilter.frequency.value = 420;
    lapFilter.Q.value = 0.7;
    const lapGain = ctx.createGain();
    lapGain.gain.value = 0.022;
    lapSrc.connect(lapFilter).connect(lapGain).connect(this.dry);
    lapSrc.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.065;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain);
    lfoGain.connect(lapGain.gain);
    lfo.start();

    /* very quiet hum */
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 54;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.007;
    hum.connect(humGain).connect(this.dry);
    hum.start();

    /* wet send */
    const wetSend = ctx.createGain();
    wetSend.gain.value = 0.35;
    rumbleGain.connect(wetSend);
    airGain.connect(wetSend);
    wetSend.connect(this.wet);

    this.ambientNodes = [rumbleSrc, airSrc, lapSrc, lfo, hum];

    this.scheduleDrip();
  }

  scheduleDrip() {
    if (!this.ctx) return;
    clearTimeout(this.dripTimeout);
    this.dripTimeout = setTimeout(() => {
      if (this.enabled && this.ctx.state === 'running') this.drip();
      this.scheduleDrip();
    }, 5500 + Math.random() * 7000);
  }

  drip() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = 620 + Math.random() * 520;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.42, t + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.016, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    osc.connect(gain).connect(pan);
    pan.connect(this.wet);
    pan.connect(this.dry);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  splash(volume = 0.09, duration = 0.24) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(ctx, duration);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 500;
    bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 0.5 - 0.25;
    src.connect(hp).connect(bp).connect(gain).connect(pan);
    pan.connect(this.dry);
    pan.connect(this.wet);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  step({ water, strength = 0.7, type = 'step' }) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.enabled) return;
    if (type === 'splash') {
      this.splash(0.13 * Math.min(1.5, strength), 0.5);
      return;
    }
    if (water) {
      this.splash(0.045 * Math.min(1.4, strength), 0.2);
    } else {
      /* soft heel tap on tile */
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx, 0.09);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1500 + Math.random() * 700;
      filter.Q.value = 2.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.022, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      src.connect(filter).connect(gain).connect(this.wet);
      src.start(t);
      src.stop(t + 0.1);
    }
  }

  async start() {
    if (!this.ensureContext()) return false;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) { /* ignore */ }
    }
    this.started = true;
    if (this.enabled) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.9, this.ctx.currentTime + 1.2);
    }
    return true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(on ? 0.9 : 0.0, t + 0.8);
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }
}
