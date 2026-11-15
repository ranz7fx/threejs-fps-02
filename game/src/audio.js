// audio.js — every sound is synthesized with WebAudio: oscillators for
// tones and filtered noise buffers for gunshots and explosions. No audio
// files, no network. The context is created on the first user gesture.
export class Synth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) {
      return false;
    }
  }

  _noise(dur, filterFreq, gain, type) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type || 'lowpass';
    flt.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, gain, type, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // distance in metres: further shots are quieter and duller
  shot(weapon, dist) {
    if (!this.ctx) return;
    const vol = Math.max(0.08, 1 - (dist || 0) / 70);
    if (weapon === 'rifle') { this._noise(0.14, 2400, 0.85 * vol); this._tone(150, 0.09, 0.4 * vol, 'square', 60); }
    else if (weapon === 'smg') { this._noise(0.09, 3200, 0.6 * vol); this._tone(190, 0.06, 0.3 * vol, 'square', 80); }
    else { this._noise(0.11, 2000, 0.7 * vol); this._tone(130, 0.08, 0.35 * vol, 'square', 55); }
  }

  dryfire() { this._tone(1200, 0.04, 0.12, 'square'); }
  reload() { this._tone(500, 0.05, 0.12, 'square'); setTimeout(() => this._tone(700, 0.05, 0.12, 'square'), 180); }
  hit(headshot) { this._tone(headshot ? 2100 : 1500, 0.06, 0.22, 'sine'); }
  kill() { this._tone(880, 0.1, 0.2, 'sine'); setTimeout(() => this._tone(1320, 0.14, 0.2, 'sine'), 90); }
  hurt() { this._tone(110, 0.18, 0.3, 'sawtooth', 70); }
  explosion() {
    this._noise(0.9, 300, 1.0);
    this._tone(70, 0.7, 0.6, 'sine', 30);
  }
  plantBeep() { this._tone(950, 0.09, 0.2, 'sine'); }
  defuseBeep() { this._tone(1150, 0.09, 0.2, 'sine'); }
  bombTick() { this._tone(1250, 0.05, 0.14, 'square'); }
  roundWin() {
    this._tone(523, 0.14, 0.22, 'sine');
    setTimeout(() => this._tone(659, 0.14, 0.22, 'sine'), 140);
    setTimeout(() => this._tone(784, 0.24, 0.24, 'sine'), 280);
  }
  roundLose() {
    this._tone(392, 0.16, 0.22, 'sine');
    setTimeout(() => this._tone(330, 0.22, 0.22, 'sine'), 160);
    setTimeout(() => this._tone(262, 0.34, 0.22, 'sine'), 320);
  }
  buy() { this._tone(660, 0.07, 0.18, 'sine'); setTimeout(() => this._tone(990, 0.09, 0.18, 'sine'), 70); }
  step() { this._noise(0.05, 500, 0.05); }
}
