// Synthesized sound: gunshots, footsteps, hit confirmations. Other players' sounds are positional.

const SHOT = {
  knife: null,
  pistol: { lp: 4200, decay: 0.12, thump: 150, gain: 0.7 },
  revolver: { lp: 3000, decay: 0.28, thump: 90, gain: 1.0 },
  smg: { lp: 4800, decay: 0.08, thump: 170, gain: 0.55 },
  rifle: { lp: 3600, decay: 0.17, thump: 110, gain: 0.8 },
  dmr: { lp: 3300, decay: 0.22, thump: 100, gain: 0.85 },
  sniper: { lp: 2500, decay: 0.5, thump: 70, gain: 1.0 },
  shotgun: { lp: 2200, decay: 0.32, thump: 80, gain: 1.0 },
  heavy: { lp: 3000, decay: 0.13, thump: 100, gain: 0.75 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos, yaw) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.setValueAtTime(pos[0], t); l.positionY.setValueAtTime(pos[1], t); l.positionZ.setValueAtTime(pos[2], t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  // Output node: straight to master for your own sounds, through a panner for everyone else's.
  out(pos) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.rolloffFactor = 1.1;
    p.maxDistance = 120;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    p.connect(this.master);
    return p;
  }

  noiseHit({ dest, at = 0, lp = 2000, hp = 0, decay = 0.1, gain = 0.5, attack = 0.002 }) {
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    let node = src;
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    f.connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  tone({ dest, at = 0, freq = 440, end = null, type = 'sine', decay = 0.1, gain = 0.3 }) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (end) o.frequency.exponentialRampToValueAtTime(end, t + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  gunshot(def, pos) {
    if (!this.ctx) return;
    const s = SHOT[def.model];
    if (!s) return;
    const dest = this.out(pos);
    const sup = def.suppressed;
    const gain = s.gain * (sup ? 0.4 : 1) * (pos ? 1.6 : 0.55);
    this.noiseHit({ dest, lp: sup ? 1400 : s.lp, decay: s.decay * (sup ? 0.6 : 1), gain });
    this.tone({ dest, freq: s.thump * 1.6, end: s.thump * 0.5, decay: Math.min(0.15, s.decay), gain: gain * 0.8 });
    if (!sup) this.noiseHit({ dest, hp: 3000, lp: 9000, decay: 0.03, gain: gain * 0.5 });
  }

  footstep(pos, own) {
    if (!this.ctx) return;
    const dest = this.out(pos);
    this.noiseHit({ dest, lp: 700 + Math.random() * 300, hp: 120, decay: 0.07, gain: own ? 0.12 : 0.55 });
    this.tone({ dest, freq: 90, end: 50, decay: 0.05, gain: own ? 0.05 : 0.25 });
  }

  land(pos, own) {
    if (!this.ctx) return;
    const dest = this.out(pos);
    this.noiseHit({ dest, lp: 600, decay: 0.12, gain: own ? 0.18 : 0.6 });
  }

  hitConfirm(part, killed) {
    if (!this.ctx) return;
    const d = this.master;
    if (part === 'head') {
      this.tone({ dest: d, freq: 2600, decay: 0.12, gain: 0.22 });
      this.tone({ dest: d, freq: 3900, decay: 0.08, gain: 0.12 });
    } else {
      this.noiseHit({ dest: d, lp: 1100, hp: 300, decay: 0.05, gain: 0.35 });
      this.tone({ dest: d, freq: 320, end: 200, decay: 0.05, gain: 0.15 });
    }
    if (killed) {
      this.tone({ dest: d, at: 0.04, freq: 880, decay: 0.18, gain: 0.18, type: 'triangle' });
      this.tone({ dest: d, at: 0.11, freq: 1320, decay: 0.25, gain: 0.16, type: 'triangle' });
    }
  }

  hurt(head) {
    if (!this.ctx) return;
    this.noiseHit({ dest: this.master, lp: 500, decay: 0.14, gain: 0.5 });
    this.tone({ dest: this.master, freq: head ? 160 : 100, end: 50, decay: 0.12, gain: 0.35 });
  }

  click(at = 0, gain = 0.25) {
    if (!this.ctx) return;
    this.noiseHit({ dest: this.master, at, hp: 2500, lp: 8000, decay: 0.025, gain });
  }

  reload(def) {
    this.click(0.08);
    this.click(Math.max(0.2, def.reload * 0.45), 0.2);
    this.click(Math.max(0.3, def.reload * 0.85), 0.3);
  }

  equip() {
    if (!this.ctx) return;
    this.noiseHit({ dest: this.master, lp: 1500, hp: 400, decay: 0.08, gain: 0.12 });
    this.click(0.1, 0.18);
  }

  swing(heavy) {
    if (!this.ctx) return;
    this.noiseHit({ dest: this.master, lp: heavy ? 1200 : 1800, hp: 500, decay: heavy ? 0.22 : 0.14, gain: 0.2, attack: 0.03 });
  }
}
