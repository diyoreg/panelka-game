// Music: shuffled pieces of the ambience recording with crossfades (data/tools/split_music.py cut it).
// SFX: synthesized footsteps in the snow, landing, wind, a far traffic hum, distant sirens, steam hiss.
// Snow: a soft low-passed brown noise bed under a quiet wind hiss, it follows the snowfall.
// Indoors (sfx): footsteps on the floor and the stairs, doors, the light switch; the street is muffled.

const XFADE = 7;          // crossfade length, seconds
const MUSIC_DIR = 'audio/';

export class Audio {
  constructor() {
    this.ctx = null;
    this.tracks = [];
    this.order = [];
    this.pos = 0;
    this.current = null;
    this.vol = { music: 0.6, sfx: 0.55 };
    this.listeners = [];
    this.windMul = 0.35;       // the bright wind hiss stays low, the snow bed carries the wind
  }

  async init(settings) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.95;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(c.destination);
    this.musicGain = c.createGain();
    this.sfxGain = c.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.setVolumes(settings);
    this.noise = this.makeNoise();
    this.startAmbience();
    this.loadMusic(true);
  }

  async loadMusic(first) {
    try {
      this.tracks = await (await fetch(MUSIC_DIR + 'tracks.json')).json();
    } catch {
      this.tracks = [];
    }
    this.shuffle();
    this.playNext(first);
  }

  setVolumes(s) {
    this.vol.music = s.music;
    this.vol.sfx = s.sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(s.music * s.music, t, 0.1);
    this.sfxGain.gain.setTargetAtTime(s.sfx * s.sfx, t, 0.1);
  }

  shuffle() {
    this.order = this.tracks.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.pos = 0;
  }

  // Start the next piece and crossfade the old one out
  playNext(first = false) {
    if (!this.tracks.length) return;
    if (this.pos >= this.order.length) {
      const last = this.order[this.order.length - 1];
      this.shuffle();
      if (this.order[0] === last && this.order.length > 1) [this.order[0], this.order[1]] = [this.order[1], this.order[0]];
    }
    const idx = this.order[this.pos++];
    const tr = this.tracks[idx];
    const c = this.ctx;
    const el = new window.Audio();
    el.src = MUSIC_DIR + tr.file;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const src = c.createMediaElementSource(el);
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.musicGain);
    // first piece of a session starts somewhere in the middle, so every launch sounds different
    const startAt = first ? Math.random() * tr.dur * 0.6 : 0;
    const now = c.currentTime;
    const fadeIn = first ? 4 : XFADE;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + fadeIn);
    const item = { el, g, src, tr, idx, switching: false };
    el.addEventListener('loadedmetadata', () => { if (startAt) el.currentTime = startAt; }, { once: true });
    el.addEventListener('timeupdate', () => {
      if (!item.switching && el.duration && el.duration - el.currentTime < XFADE + 0.3) {
        item.switching = true;
        this.playNext();
      }
    });
    el.addEventListener('ended', () => this.drop(item));
    el.play().catch(() => {});
    const old = this.current;
    this.current = item;
    if (old) {
      old.switching = true;
      const t = c.currentTime;
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setValueAtTime(old.g.gain.value, t);
      old.g.gain.linearRampToValueAtTime(0, t + XFADE);
      setTimeout(() => this.drop(old), (XFADE + 0.5) * 1000);
    }
    this.listeners.forEach((f) => f(this.nowPlaying()));
  }

  drop(item) {
    if (item.dropped) return;
    item.dropped = true;
    try { item.el.pause(); item.src.disconnect(); item.g.disconnect(); } catch { /* already gone */ }
    item.el.removeAttribute('src');
    item.el.load();
  }

  nowPlaying() {
    if (!this.current) return null;
    return { n: this.current.idx + 1, total: this.tracks.length };
  }

  onTrack(f) { this.listeners.push(f); }

  // ---------------------------------------------------------------- synth helpers

  makeNoise() {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  startAmbience() {
    const c = this.ctx;
    // wind: band-passed noise with slow moving filter
    const w = this.noiseSrc();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.03;
    w.connect(bp).connect(this.windGain).connect(this.sfxGain);
    w.start();
    this.windFilter = bp;
    // far traffic hum: deep low-passed noise
    const h = this.noiseSrc();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const hg = c.createGain();
    hg.gain.value = 0.05;
    h.connect(lp).connect(hg).connect(this.sfxGain);
    h.start(0, 0.7);
    // steam hiss near vents
    const s = this.noiseSrc();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    this.hissGain = c.createGain();
    this.hissGain.gain.value = 0;
    s.connect(hp).connect(this.hissGain).connect(this.sfxGain);
    s.start(0, 1.3);
    this.nextSiren = 60 + Math.random() * 120;
    // snow bed: brown noise, muffled like a snowy night, silent until it snows
    const sb = c.createBufferSource();
    sb.buffer = this.makeBrown();
    sb.loop = true;
    const slp = c.createBiquadFilter();
    slp.type = 'lowpass';
    slp.frequency.value = 300;
    slp.Q.value = 0.5;
    this.snowGain = c.createGain();
    this.snowGain.gain.value = 0;
    sb.connect(slp).connect(this.snowGain).connect(this.sfxGain);
    sb.start(0, Math.random() * 4);
    this.snowFilter = slp;
  }

  // Brown noise (integrated white noise), 8 s long. The drift is pulled out so both ends meet: the loop does not click.
  makeBrown() {
    const c = this.ctx;
    const n = c.sampleRate * 8;
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 0.998 + (Math.random() * 2 - 1) * 0.04;
      d[i] = v;
    }
    const end = d[n - 1] - d[0];
    let peak = 0;
    for (let i = 0; i < n; i++) {
      d[i] -= d[0] + end * (i / (n - 1));
      peak = Math.max(peak, Math.abs(d[i]));
    }
    for (let i = 0; i < n; i++) d[i] /= peak;
    return b;
  }

  update(dt, { gust = 0.5, steam = 0, snow = 0, indoor = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // behind walls the wind and the snow are a dull murmur
    const out = indoor ? 0.22 : 1;
    this.snowGain.gain.setTargetAtTime(snow > 0 ? (0.03 + snow * 0.07) * (0.85 + gust * 0.3) * out : 0, t, 0.8);
    this.snowFilter.frequency.setTargetAtTime((220 + snow * 160 + gust * 80) * (indoor ? 0.6 : 1), t, 0.8);
    this.windGain.gain.setTargetAtTime((0.015 + gust * 0.04) * this.windMul * out, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(280 + gust * 380, t, 0.8);
    this.hissGain.gain.setTargetAtTime(Math.max(0, steam) * 0.05, t, 0.2);
    this.nextSiren -= dt;
    if (this.nextSiren <= 0) {
      this.siren();
      this.nextSiren = 90 + Math.random() * 200;
    }
  }

  // Very distant siren, heavily muffled
  siren() {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = c.createGain();
    const dur = 7 + Math.random() * 5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const base = 620 + Math.random() * 80;
    const wail = Math.random() < 0.5;
    for (let k = 0; k < dur * 2; k++) {
      const tt = t + k * 0.5;
      if (wail) o.frequency.setValueAtTime(base + Math.sin(k * 0.6) * 220, tt);
      else o.frequency.setValueAtTime(k % 2 ? base : base * 1.32, tt);
    }
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    let node = o.connect(lp).connect(g);
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; node = node.connect(pan); }
    node.connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  step(surface = 'hard', strength = 1) {
    if (!this.ctx) return;
    if (surface === 'snow') { this.crunch(strength); return; }
    if (surface === 'floor') { this.thud(strength); return; }
    if (surface === 'stair') {
      // concrete steps: a sharper heel and a little ring of the stairwell
      this.burst(1800 + Math.random() * 400, 2.5, 0.07 * strength, 0.035);
      this.burst(420, 1.2, 0.1 * strength, 0.12);
      return;
    }
    const c = this.ctx;
    const t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 260 + Math.random() * 120;
    f.Q.value = 1.2;
    const g = c.createGain();
    const v = 0.13 * strength;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(t, Math.random() * 1.5, 0.2);
  }

  // Fresh snow squeaks and crunches: a few short grains of bright noise and a soft thud
  crunch(strength = 1) {
    const c = this.ctx;
    const t = c.currentTime;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.012 + Math.random() * 0.018);
      const s = c.createBufferSource();
      s.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300 + Math.random() * 1700;
      f.Q.value = 0.9;
      const g = c.createGain();
      const v = 0.07 * strength * (1 - i / (n + 1));
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(v, tt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.05 + Math.random() * 0.04);
      s.connect(f).connect(g).connect(this.sfxGain);
      s.start(tt, Math.random() * 1.5, 0.12);
    }
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1 * strength, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.13);
    s.connect(lp).connect(g).connect(this.sfxGain);
    s.start(t, Math.random() * 1.5, 0.2);
  }

  // A footstep on a floor of boards or linoleum: a soft low knock
  thud(strength = 1) {
    this.burst(160 + Math.random() * 60, 0.9, 0.16 * strength, 0.1, 'lowpass');
    this.burst(900 + Math.random() * 300, 1.5, 0.025 * strength, 0.04);
  }

  // short filtered noise: the building block of the knocks, clicks and thuds
  burst(freq, q, vol, len, type = 'bandpass', delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    s.connect(f).connect(g).connect(this.sfxGain);
    s.start(t, Math.random() * 1.5, len + 0.05);
  }

  // a hinge that has not seen oil since 1975
  creak(base, len, vol, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base, t);
    for (let k = 1; k <= 8; k++) o.frequency.linearRampToValueAtTime(base * (1 + 0.25 * Math.sin(k * 1.7) + k * 0.03), t + len * k / 8);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = base * 4;
    f.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + len * 0.2);
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(f).connect(g).connect(this.sfxGain);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  // Doors, the hatch and the light switch (interiors.js)
  sfx(kind) {
    if (!this.ctx) return;
    if (kind === 'switch') {
      this.burst(3200, 3, 0.09, 0.018);
      this.burst(900, 2, 0.05, 0.03);
      return;
    }
    if (kind === 'bump') { this.burst(120, 1, 0.12, 0.12, 'lowpass'); return; }
    const [act, door] = kind.split('_');
    const metal = door === 'entr' || door === 'hatch';
    if (act === 'open') {
      // latch, then the swing
      this.burst(metal ? 1400 : 2600, 4, 0.08, 0.03);
      if (door === 'hatch') { this.burst(300, 2, 0.12, 0.25, 'bandpass', 0.15); this.creak(70, 0.5, 0.025, 0.05); return; }
      this.creak(metal ? 95 : 140 + Math.random() * 60, metal ? 0.9 : 0.55, door === 'bath' || door === 'kit' ? 0.012 : 0.02, 0.05);
    } else {
      // the leaf hits the frame, the latch catches
      this.burst(metal ? 110 : 150, 1, metal ? 0.3 : 0.2, metal ? 0.3 : 0.16, 'lowpass', 0.0);
      this.burst(metal ? 700 : 2200, 3, 0.07, 0.04, 'bandpass', 0.02);
      if (metal) this.burst(1300, 6, 0.05, 0.4, 'bandpass', 0.03);
    }
  }

  land(strength, surface = 'hard') {
    this.step(surface, 1 + strength * 1.8);
  }
}
