// 极简 WebAudio 合成音效（无需音频文件）
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  }
  _now() { return this.ctx.currentTime; }

  _noise(dur) {
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * dur, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    return src;
  }

  _blip({ freq = 440, type = 'square', dur = 0.1, vol = 0.5, slideTo = null }) {
    if (!this.ctx || this.muted) return;
    const t = this._now();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  _burst({ dur = 0.15, vol = 0.5, freq = 1200, q = 1 }) {
    if (!this.ctx || this.muted) return;
    const t = this._now();
    const src = this._noise(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  shot(id) {
    if (id === 'shotgun') { this._burst({ dur: 0.18, vol: 0.6, freq: 800, q: 0.7 }); this._blip({ freq: 160, slideTo: 60, dur: 0.12, vol: 0.4, type: 'sawtooth' }); }
    else if (id === 'sniper') { this._burst({ dur: 0.22, vol: 0.6, freq: 2500, q: 2 }); this._blip({ freq: 220, slideTo: 70, dur: 0.18, vol: 0.45, type: 'sawtooth' }); }
    else if (id === 'pistol') { this._burst({ dur: 0.08, vol: 0.4, freq: 1600, q: 1.5 }); }
    else { this._burst({ dur: 0.06, vol: 0.35, freq: 1800, q: 1.2 }); this._blip({ freq: 180, slideTo: 90, dur: 0.05, vol: 0.25, type: 'square' }); }
  }
  rocket() { this._blip({ freq: 300, slideTo: 800, dur: 0.4, vol: 0.4, type: 'sawtooth' }); }
  tankFire() { this._burst({ dur: 0.4, vol: 0.7, freq: 400, q: 0.5 }); this._blip({ freq: 110, slideTo: 40, dur: 0.4, vol: 0.6, type: 'sawtooth' }); }
  explosion() { this._burst({ dur: 0.6, vol: 0.8, freq: 220, q: 0.4 }); this._blip({ freq: 80, slideTo: 30, dur: 0.5, vol: 0.5, type: 'sawtooth' }); }
  hurt() { this._blip({ freq: 300, slideTo: 120, dur: 0.18, vol: 0.4, type: 'triangle' }); }
  pickup() { this._blip({ freq: 600, slideTo: 1000, dur: 0.12, vol: 0.4, type: 'sine' }); this._blip({ freq: 900, slideTo: 1300, dur: 0.14, vol: 0.3, type: 'sine' }); }
  engine() { this._blip({ freq: 60, slideTo: 90, dur: 0.6, vol: 0.4, type: 'sawtooth' }); }
}
