// Efeitos animados da lightbar (calculados no PC e enviados ~30 vezes por segundo).
import { hexToRgb, hsv } from './ui.js';

export const LIGHT_MODES = [
  { id: 'static', name: 'Cor fixa' },
  { id: 'breathe', name: 'Respirar' },
  { id: 'rainbow', name: 'Arco-íris' },
  { id: 'blink', name: 'Piscar' },
  { id: 'alternate', name: 'Alternar duas cores' },
  { id: 'fire', name: 'Chama' },
  { id: 'siren', name: 'Sirene' },
  { id: 'battery', name: 'Nível da bateria' },
  { id: 'triggers', name: 'Segue os gatilhos' },
  { id: 'motion', name: 'Segue a inclinação' },
  { id: 'touch', name: 'Segue o dedo no touchpad' },
  { id: 'sound', name: 'Pulsa com o som' },
  { id: 'off', name: 'Apagada' },
];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export class LightEngine {
  constructor(ds, audio) {
    this.ds = ds;
    this.audio = audio;
    this.cfg = { mode: 'static', color: '#2f6bff', color2: '#ff3d7f', brightness: 100, speed: 50 };
    this.flash = null;
    this.current = [47, 107, 255];
    this._t0 = performance.now();
    setInterval(() => this.tick(), 33);
  }

  set(patch) { Object.assign(this.cfg, patch); this.tick(); }

  // Sobreposição temporária (ex.: reação ao sopro ou ao botão).
  pulse(color, ms = 250) { this.flash = { color: hexToRgb(color), until: performance.now() + ms }; }

  level() {
    const a = this.audio;
    if (!a?.ready) return 0;
    let an = a.stream?.analyser || a.mic?.analyser;
    if (!an) return 0;
    const buf = this._buf && this._buf.length === an.fftSize ? this._buf : (this._buf = new Float32Array(an.fftSize));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9);
    return Math.max(0, Math.min(1, (db + 55) / 45));
  }

  compute() {
    const c = this.cfg, st = this.ds.state;
    const t = (performance.now() - this._t0) / 1000;
    const sp = 0.15 + (c.speed / 100) * 2.5; // ciclos por segundo
    const c1 = hexToRgb(c.color), c2 = hexToRgb(c.color2);
    switch (c.mode) {
      case 'off': return [0, 0, 0];
      case 'breathe': { const k = 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(t * sp * Math.PI)); return c1.map((v) => v * k); }
      case 'rainbow': return hsv((t * sp * 90) % 360, 1, 1);
      case 'blink': return Math.floor(t * sp * 2) % 2 ? [0, 0, 0] : c1;
      case 'alternate': return mix(c1, c2, 0.5 - 0.5 * Math.cos(t * sp * Math.PI));
      case 'fire': { const n = 0.55 + 0.45 * Math.random(); return [255 * n, 70 * n * Math.random() + 20 * n, 0]; }
      case 'siren': return Math.floor(t * sp * 3) % 2 ? [255, 0, 20] : [0, 40, 255];
      case 'battery': {
        const lv = st.battery.level / 100;
        const base = lv > 0.5 ? mix([255, 200, 0], [0, 220, 70], (lv - 0.5) * 2) : mix([255, 0, 0], [255, 200, 0], lv * 2);
        const charging = st.battery.status === 1;
        const k = charging ? 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * 2.5)) : 1;
        return base.map((v) => v * k);
      }
      case 'triggers': {
        const k = Math.max(st.l2, st.r2) / 255;
        const side = st.r2 >= st.l2 ? c2 : c1;
        return mix([12, 12, 16], side, k);
      }
      case 'motion': {
        const [ax, ay, az] = st.accel;
        const hue = ((Math.atan2(ax, ay) * 180) / Math.PI + 360) % 360;
        const v = Math.max(0.25, Math.min(1, 0.6 + az * 0.6));
        return hsv(hue, 1, v);
      }
      case 'touch': {
        const f = st.touch.find((p) => p.active);
        if (!f) return c1.map((v) => v * 0.15);
        return hsv((f.x / 1920) * 360, 1, 1 - (f.y / 1080) * 0.8);
      }
      case 'sound': { const k = this.level(); return mix(c1.map((v) => v * 0.06), c2, k); }
      default: return c1;
    }
  }

  tick() {
    if (!this.ds.connected) return;
    let rgb = this.compute();
    if (this.flash) {
      if (performance.now() < this.flash.until) rgb = this.flash.color;
      else this.flash = null;
    }
    const k = this.cfg.brightness / 100;
    rgb = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
    this.current = rgb;
    this.ds.setLightbar(rgb[0], rgb[1], rgb[2]);
  }
}
