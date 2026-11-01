// Peso virtual: uma bola "dentro" do controle que rola com a inclinação.
// O rolar e as batidas nas paredes são reproduzidos nos atuadores hápticos (USB)
// ou, sem áudio, nos motores clássicos.

export class BallSim {
  constructor(ds, audio) {
    this.ds = ds;
    this.audio = audio;
    this.cfg = { mass: 0.6, bounce: 0.45, friction: 0.35, sensitivity: 1, invertX: false, invertY: false, twoD: true, intensity: 1 };
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.running = false;
    this.impacts = [];
    this._last = 0;
    this._onInput = () => this.step();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this.ds.addEventListener('input', this._onInput);
    this._buildRoll();
  }

  stop() {
    this.running = false;
    this.ds.removeEventListener('input', this._onInput);
    if (this.roll) {
      const t = this.audio.ctx.currentTime;
      this.roll.gain.gain.setTargetAtTime(0, t, 0.02);
      const r = this.roll;
      setTimeout(() => { try { r.src.stop(); } catch { /* ignore */ } r.gain.disconnect(); }, 200);
      this.roll = null;
    }
    this.ds.setRumble(0, 0);
  }

  set(patch) {
    Object.assign(this.cfg, patch);
    if (this.roll && 'mass' in patch) this._tuneRoll();
  }

  _buildRoll() {
    const a = this.audio;
    if (!a.ready) return;
    const ctx = a.ctx;
    const src = ctx.createBufferSource();
    src.buffer = a._noiseBuffer(); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    hum.connect(humGain);
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(lp); lp.connect(gain); humGain.connect(gain);
    const gl = ctx.createGain(), gr = ctx.createGain();
    gain.connect(gl); gain.connect(gr);
    gl.connect(a.hapL); gr.connect(a.hapR);
    src.start(); hum.start();
    this.roll = { src, lp, hum, humGain, gain, gl, gr };
    this._tuneRoll();
  }

  _tuneRoll() {
    const m = this.cfg.mass, r = this.roll, t = this.audio.ctx.currentTime;
    // bola pesada = ronco grave; bola leve = chiado mais agudo
    r.lp.frequency.setTargetAtTime(500 - m * 420, t, 0.05);
    r.hum.frequency.setTargetAtTime(70 - m * 40, t, 0.05);
    r.humGain.gain.setTargetAtTime(0.15 + m * 0.9, t, 0.05);
  }

  step() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (!dt) return;
    const c = this.cfg, acc = this.ds.state.accel;
    const G = 9 * c.sensitivity;
    // componente da gravidade no plano do controle
    let ax = -acc[0] * G * (c.invertX ? -1 : 1);
    let ay = c.twoD ? acc[2] * G * (c.invertY ? -1 : 1) : 0;
    const fr = 0.4 + c.friction * 4;
    this.vx += (ax - this.vx * fr) * dt;
    this.vy += (ay - this.vy * fr) * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const hits = [];
    if (this.x > 1) { hits.push({ v: this.vx, pan: 1 }); this.x = 1; this.vx = -this.vx * c.bounce; }
    if (this.x < -1) { hits.push({ v: -this.vx, pan: -1 }); this.x = -1; this.vx = -this.vx * c.bounce; }
    if (this.y > 1) { hits.push({ v: this.vy, pan: this.x }); this.y = 1; this.vy = -this.vy * c.bounce; }
    if (this.y < -1) { hits.push({ v: -this.vy, pan: this.x }); this.y = -1; this.vy = -this.vy * c.bounce; }
    if (!c.twoD) { this.y = 0; this.vy = 0; }
    const speed = Math.hypot(this.vx, this.vy);
    this._render(speed, hits.filter((h) => h.v > 0.15));
  }

  _render(speed, hits) {
    const c = this.cfg, a = this.audio;
    const rollAmt = Math.min(1, speed / 2.5) * c.intensity;
    const pan = Math.max(-1, Math.min(1, this.x));
    const wl = Math.min(1, Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2);
    const wr = Math.min(1, Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2);
    if (a.ready && this.roll) {
      const t = a.ctx.currentTime;
      this.roll.gain.gain.setTargetAtTime(rollAmt * 0.9, t, 0.03);
      this.roll.gl.gain.setTargetAtTime(wl, t, 0.02);
      this.roll.gr.gain.setTargetAtTime(wr, t, 0.02);
      for (const h of hits) {
        const amp = Math.min(1, h.v / 2.2) * c.intensity;
        const f = 85 - c.mass * 55;
        a.pulse({ freq: f, freqEnd: f * 0.6, dur: 0.06 + c.mass * 0.1, amp, pan: h.pan, attack: 0.001, release: 0.05 + c.mass * 0.08 });
        if (c.mass < 0.4) a.grain({ dur: 0.012, amp: amp * 0.8, pan: h.pan, lowpass: 1200 });
      }
    } else if (this.ds.connected) {
      // sem hápticos HD: motor esquerdo = lado esquerdo, direito = lado direito
      let L = rollAmt * wl * 120, R = rollAmt * wr * 120;
      for (const h of hits) {
        const k = Math.min(1, h.v / 2.2) * 255;
        if (h.pan < 0) L = Math.max(L, k); else R = Math.max(R, k);
      }
      this.ds.setRumble(L, R);
    }
    for (const h of hits) this.impacts.push({ x: this.x, y: this.y, at: performance.now(), v: h.v });
    if (this.impacts.length > 12) this.impacts.shift();
  }
}
