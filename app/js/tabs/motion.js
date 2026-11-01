import { h, block, grid, readout, button, canvas, palette, toggle } from '../ui.js';

// Filtro de Mahony: junta giroscópio (rápido) e acelerômetro (referência da gravidade).
class Orientation {
  constructor() { this.q = [1, 0, 0, 0]; this.kp = 1.2; this.ki = 0.02; this.e = [0, 0, 0]; }
  reset() { this.q = [1, 0, 0, 0]; this.e = [0, 0, 0]; }
  update(gx, gy, gz, ax, ay, az, dt) {
    let [q0, q1, q2, q3] = this.q;
    const n = Math.hypot(ax, ay, az);
    if (n > 0.3 && n < 3) {
      ax /= n; ay /= n; az /= n;
      const vx = 2 * (q1 * q3 - q0 * q2), vy = 2 * (q0 * q1 + q2 * q3), vz = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3;
      const ex = ay * vz - az * vy, ey = az * vx - ax * vz, ez = ax * vy - ay * vx;
      this.e[0] += ex * this.ki * dt; this.e[1] += ey * this.ki * dt; this.e[2] += ez * this.ki * dt;
      gx += this.kp * ex + this.e[0]; gy += this.kp * ey + this.e[1]; gz += this.kp * ez + this.e[2];
    }
    const hx = 0.5 * dt;
    const nq0 = q0 + (-q1 * gx - q2 * gy - q3 * gz) * hx;
    const nq1 = q1 + (q0 * gx + q2 * gz - q3 * gy) * hx;
    const nq2 = q2 + (q0 * gy - q1 * gz + q3 * gx) * hx;
    const nq3 = q3 + (q0 * gz + q1 * gy - q2 * gx) * hx;
    const m = Math.hypot(nq0, nq1, nq2, nq3);
    this.q = [nq0 / m, nq1 / m, nq2 / m, nq3 / m];
  }
  rotate([x, y, z]) {
    const [w, a, b, c] = this.q;
    const ix = w * x + b * z - c * y, iy = w * y + c * x - a * z, iz = w * z + a * y - b * x, iw = -a * x - b * y - c * z;
    return [ix * w + iw * -a + iy * -c - iz * -b, iy * w + iw * -b + iz * -a - ix * -c, iz * w + iw * -c + ix * -b - iy * -a];
  }
}

// Modelo simplificado do controle: caixas (corpo e empunhaduras) + touchpad.
const box = (x0, x1, y0, y1, z0, z1, color) => {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [[4, 5, 6, 7], [0, 3, 2, 1], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]].map((f) => ({ pts: f.map((i) => v[i]), color }));
};
const MODEL = [
  ...box(-0.8, 0.8, -0.12, 0.42, -0.11, 0.11, 'body'),
  ...box(-0.86, -0.42, -0.62, -0.08, -0.13, 0.09, 'body'),
  ...box(0.42, 0.86, -0.62, -0.08, -0.13, 0.09, 'body'),
  { pts: [[-0.3, 0.06, 0.112], [0.3, 0.06, 0.112], [0.3, 0.4, 0.112], [-0.3, 0.4, 0.112]], color: 'pad' },
  { pts: [[-0.34, 0.06, 0.113], [-0.31, 0.06, 0.113], [-0.31, 0.4, 0.113], [-0.34, 0.4, 0.113]], color: 'light' },
  { pts: [[0.31, 0.06, 0.113], [0.34, 0.06, 0.113], [0.34, 0.4, 0.113], [0.31, 0.4, 0.113]], color: 'light' },
];

export default {
  id: 'motion',
  label: 'Movimento',
  title: 'Giroscópio e acelerômetro',
  desc: 'Sensores de movimento de 6 eixos, já convertidos com a calibração de fábrica do seu controle: rotação em graus por segundo e aceleração em g.',
  build(app) {
    const { ds } = app;
    const ori = new Orientation();
    const view = canvas('viz dark', 16 / 10);
    const graph = canvas('viz', 3.2);
    const ro = {
      pitch: readout('Arfagem (X)'), yaw: readout('Guinada (Y)'), roll: readout('Rolagem (Z)'),
      ax: readout('Aceleração X'), ay: readout('Aceleração Y'), az: readout('Aceleração Z'),
      tiltX: readout('Inclinação lateral'), tiltY: readout('Inclinação frontal'), total: readout('Força total'),
      ts: readout('Relógio do sensor'), temp: readout('Temperatura'),
    };
    const hist = [];
    let last = performance.now();
    let showGraph = true;

    ds.addEventListener('input', () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = ds.state, D = Math.PI / 180;
      // eixos do DualSense (x direita, y para cima, z para o jogador) -> x direita, y frente, z para cima
      ori.update(s.gyro[0] * D, -s.gyro[2] * D, s.gyro[1] * D, s.accel[0], -s.accel[2], s.accel[1], dt);
      if (showGraph) { hist.push([...s.gyro, ...s.accel]); if (hist.length > 500) hist.shift(); }
    });

    const calibBtn = button('Zerar giroscópio', async (e, b) => {
      b.disabled = true; b.textContent = 'Deixe o controle parado…';
      const r = await ds.calibrateGyroRest(1200);
      b.disabled = false; b.textContent = 'Zerar giroscópio';
      app.toast(`Giroscópio zerado com ${r.samples} amostras`);
    });

    const el = h('div', {},
      block('Orientação ao vivo', 'Mova o controle e o modelo acompanha. A guinada (girar na horizontal) deriva devagar com o tempo, porque não existe bússola no controle; use "Recentralizar".',
        view,
        h('div', { class: 'row', style: { marginTop: '12px' } },
          button('Recentralizar', () => ori.reset()),
          calibBtn,
          button('Restaurar calibração', () => { ds.gyroOffset = [0, 0, 0]; app.toast('Usando só a calibração de fábrica'); }, { variant: 'ghost' }))),
      block('Leituras', 'A rotação usa a calibração de fábrica lida do controle. "Zerar giroscópio" remove a pequena deriva que sobra com ele parado.',
        h('div', { class: 'readouts' }, Object.values(ro))),
      block('Gráfico dos últimos 2 segundos', 'Linhas cheias: rotação (°/s, escala ±500). Linhas tracejadas: aceleração (g, escala ±2).',
        graph,
        h('div', { style: { marginTop: '10px' } }, toggle({ label: 'Atualizar gráfico', value: true, onChange: (v) => { showGraph = v; } }))),
    );

    const drawView = () => {
      const c = view, g = c.getContext('2d'), W = c.width, H = c.height, d = c.dpr || 1;
      g.clearRect(0, 0, W, H);
      const p = palette();
      // câmera um pouco acima e atrás do jogador
      const cam = (v) => {
        const [x, y, z] = ori.rotate(v);
        const a = 0.95; // inclinação da câmera
        const y2 = y * Math.cos(a) - z * Math.sin(a), z2 = y * Math.sin(a) + z * Math.cos(a);
        const depth = 3.2 - y2;
        const k = (Math.min(W, H * 1.6) * 0.62) / depth;
        return [W / 2 + x * k, H / 2 - z2 * k, depth];
      };
      const light = [0.3, -0.4, 0.86];
      const faces = MODEL.map((f) => {
        const pr = f.pts.map(cam);
        const wp = f.pts.map((v) => ori.rotate(v));
        const u = wp[1].map((v, i) => v - wp[0][i]), w = wp[2].map((v, i) => v - wp[0][i]);
        const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const nl = Math.hypot(...nrm) || 1;
        const shade = Math.max(0.25, (nrm[0] * light[0] + nrm[1] * light[1] + nrm[2] * light[2]) / nl);
        return { pr, depth: pr.reduce((s, q) => s + q[2], 0) / pr.length, shade, color: f.color };
      }).sort((a, b) => b.depth - a.depth);
      const o = ds.out;
      for (const f of faces) {
        g.beginPath();
        f.pr.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        if (f.color === 'light') g.fillStyle = `rgb(${o.r} ${o.g} ${o.b})`;
        else if (f.color === 'pad') g.fillStyle = `rgb(${200 * f.shade + 40} ${203 * f.shade + 40} ${210 * f.shade + 40})`;
        else { const v = Math.round(150 + 95 * f.shade); g.fillStyle = `rgb(${v} ${v + 2} ${v + 6})`; }
        g.fill();
        g.strokeStyle = 'rgb(0 0 0 / 0.18)'; g.lineWidth = d; g.stroke();
      }
      // eixo da gravidade
      g.fillStyle = 'rgb(255 255 255 / 0.55)'; g.font = `${12 * d}px ${p.font}`;
      g.fillText('gravidade', 12 * d, H - 12 * d);
    };

    const drawGraph = () => {
      const c = graph, g = c.getContext('2d'), W = c.width, H = c.height, d = c.dpr || 1, p = palette();
      g.clearRect(0, 0, W, H);
      g.strokeStyle = p.line2; g.lineWidth = d;
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      const colors = [p.cir, p.tri, p.cro];
      const n = hist.length;
      for (let ch = 0; ch < 6; ch++) {
        g.strokeStyle = colors[ch % 3]; g.lineWidth = 1.6 * d;
        g.setLineDash(ch >= 3 ? [5 * d, 4 * d] : []);
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const v = hist[i][ch];
          const y = H / 2 - (ch < 3 ? v / 500 : v / 2) * (H / 2 - 4 * d);
          const x = (i / 499) * W;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.setLineDash([]);
      g.font = `${11 * d}px ${p.font}`; g.fillStyle = p.ink2;
      ['X', 'Y', 'Z'].forEach((t, i) => { g.fillStyle = colors[i]; g.fillText(t, W - (40 - i * 12) * d, 14 * d); });
    };

    return {
      el,
      frame(s) {
        const f = (v, u, dgt = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dgt)} ${u}`;
        ro.pitch.set(f(s.gyro[0], '°/s')); ro.yaw.set(f(s.gyro[1], '°/s')); ro.roll.set(f(s.gyro[2], '°/s'));
        ro.ax.set(f(s.accel[0], 'g', 3)); ro.ay.set(f(s.accel[1], 'g', 3)); ro.az.set(f(s.accel[2], 'g', 3));
        ro.tiltX.set(`${Math.round((Math.atan2(-s.accel[0], s.accel[1]) * 180) / Math.PI)}°`);
        ro.tiltY.set(`${Math.round((Math.atan2(s.accel[2], s.accel[1]) * 180) / Math.PI)}°`);
        ro.total.set(`${Math.hypot(...s.accel).toFixed(3)} g`);
        ro.ts.set(String(s.sensorTs));
        ro.temp.set(`${s.temperature} °C`);
        drawView();
        if (showGraph) drawGraph();
      },
    };
  },
};
