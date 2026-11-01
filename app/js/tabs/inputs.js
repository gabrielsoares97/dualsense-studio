import { h, block, grid, readout, button, canvas, palette } from '../ui.js';
import { BUTTON_NAMES } from '../mapping.js';

const BTN_ORDER = ['cross', 'circle', 'square', 'triangle', 'up', 'down', 'left', 'right', 'l1', 'r1', 'l2', 'r2', 'l3', 'r3',
  'create', 'options', 'ps', 'touchpad', 'mute', 'fnL', 'fnR', 'paddleL', 'paddleR'];
const SHORT = { cross: '✕ Cruz', circle: '○ Círculo', square: '□ Quadrado', triangle: '△ Triângulo', up: '↑', down: '↓', left: '←', right: '→',
  l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', l3: 'L3', r3: 'R3', create: 'Create', options: 'Options', ps: 'PS', touchpad: 'Touchpad',
  mute: 'Microfone', fnL: 'Fn esq.', fnR: 'Fn dir.', paddleL: 'Pá esq.', paddleR: 'Pá dir.' };

export default {
  id: 'inputs',
  label: 'Entradas',
  title: 'Entradas',
  desc: 'Tudo o que o controle envia ao PC, ao vivo: botões, analógicos, gatilhos e touchpad com até dois dedos.',
  build(app) {
    const { ds } = app;
    const cells = {};
    const presses = {};
    const btnGrid = h('div', { class: 'btn-grid' }, BTN_ORDER.map((k) => {
      presses[k] = 0;
      const count = h('span', { class: 'num', style: { color: 'var(--ink-2)', fontSize: '12px' } }, '');
      const c = h('div', { class: 'btn-cell', title: BUTTON_NAMES[k] }, h('span', {}, SHORT[k]), count, h('span', { class: 'dot' }));
      c.count = count;
      cells[k] = c;
      return c;
    }));
    ds.addEventListener('buttondown', (e) => { presses[e.detail]++; const c = cells[e.detail]; if (c) c.count.textContent = '×' + presses[e.detail]; });

    // analógicos
    const sticks = ['left', 'right'].map((side) => {
      const cv = canvas('viz', 1);
      const ro = { x: readout('X'), y: readout('Y'), ang: readout('Ângulo'), dist: readout('Distância') };
      return { side, cv, ro, trail: [], max: [] };
    });
    const clearTrails = () => sticks.forEach((s) => { s.trail = []; s.max = new Array(72).fill(0); });
    clearTrails();

    // gatilhos analógicos
    const trig = ['l2', 'r2'].map((k) => {
      const fill = h('i');
      const val = readout(k.toUpperCase(), '0');
      const pct = readout('Curso', '0%');
      return { k, fill, val, pct, el: h('div', { class: 'stack' }, h('div', { class: 'row', style: { gap: '24px' } }, val, pct), h('div', { class: 'meter', style: { height: '18px' } }, fill)) };
    });

    // touchpad
    const pad = canvas('viz dark', 1920 / 1080);
    const fingersRo = [0, 1].map((i) => readout(`Dedo ${i + 1}`, '—'));
    const padTrails = [[], []];

    const el = h('div', {},
      block('Botões', 'Aperte qualquer botão para ver acender. O contador mostra quantas vezes cada um foi pressionado nesta sessão.', btnGrid),
      block('Analógicos', 'Gire os analógicos até o limite para desenhar o contorno e conferir a circularidade e a zona morta.',
        grid('two', sticks.map((s) => h('div', { class: 'stack' },
          h('h3', {}, s.side === 'left' ? 'Analógico esquerdo' : 'Analógico direito'),
          h('div', { style: { maxWidth: '300px' } }, s.cv),
          h('div', { class: 'readouts' }, Object.values(s.ro))))),
        h('div', { class: 'row', style: { marginTop: '12px' } }, button('Limpar contorno', clearTrails))),
      block('Gatilhos analógicos', 'Valor bruto de 0 a 255. O ponto em que o L2/R2 passa a contar como "apertado" é definido pelo próprio controle.',
        grid('two', trig.map((t) => t.el))),
      block('Touchpad', 'Resolução de 1920 × 1080 com dois dedos simultâneos. O clique é o próprio touchpad afundando.',
        pad, h('div', { class: 'readouts', style: { marginTop: '12px' } }, fingersRo)),
    );

    const drawStick = (s, x, y, pressed) => {
      const c = s.cv, g = c.getContext('2d'), p = palette();
      const W = c.width, H = c.height, r = W * 0.42, cx = W / 2, cy = H / 2;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = p.line; g.lineWidth = 1 * (c.dpr || 1);
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
      // contorno máximo por direção
      g.fillStyle = `rgb(${p.accentRgb} / 0.12)`; g.strokeStyle = `rgb(${p.accentRgb} / 0.5)`;
      g.beginPath();
      s.max.forEach((m, i) => { const a = (i / s.max.length) * Math.PI * 2; const px = cx + Math.cos(a) * m * r, py = cy + Math.sin(a) * m * r; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath(); g.fill(); g.stroke();
      // rastro
      g.strokeStyle = `rgb(${p.accentRgb} / 0.35)`; g.beginPath();
      s.trail.forEach(([tx, ty], i) => { const px = cx + tx * r, py = cy + ty * r; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.stroke();
      g.fillStyle = pressed ? p.accent : p.ink;
      g.beginPath(); g.arc(cx + x * r, cy + y * r, (pressed ? 9 : 6) * (c.dpr || 1), 0, Math.PI * 2); g.fill();
    };

    const drawPad = (st) => {
      const c = pad, g = c.getContext('2d'), p = palette(), W = c.width, H = c.height, d = c.dpr || 1;
      g.fillStyle = st.buttons.touchpad ? `rgb(${p.accentRgb} / 0.25)` : '#20242c';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgb(255 255 255 / 0.06)'; g.lineWidth = d;
      for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo((W * i) / 8, 0); g.lineTo((W * i) / 8, H); g.stroke(); }
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (H * i) / 4); g.lineTo(W, (H * i) / 4); g.stroke(); }
      st.touch.forEach((t, i) => {
        const tr = padTrails[i];
        if (t.active) { tr.push([t.x, t.y]); if (tr.length > 60) tr.shift(); } else if (tr.length) tr.shift();
        g.strokeStyle = `rgb(${p.accentRgb} / 0.6)`; g.lineWidth = 3 * d; g.lineCap = 'round'; g.beginPath();
        tr.forEach(([x, y], j) => { const px = (x / 1919) * W, py = (y / 1079) * H; j ? g.lineTo(px, py) : g.moveTo(px, py); });
        g.stroke();
        if (t.active) {
          const px = (t.x / 1919) * W, py = (t.y / 1079) * H;
          g.fillStyle = p.accent; g.beginPath(); g.arc(px, py, 18 * d, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fff'; g.font = `600 ${14 * d}px ${p.font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(i + 1), px, py);
        }
      });
    };

    return {
      el,
      frame(st) {
        const b = st.buttons;
        const edge = ds.model === 'DualSense Edge';
        for (const k of BTN_ORDER) {
          cells[k].classList.toggle('on', !!b[k]);
          if (['fnL', 'fnR', 'paddleL', 'paddleR'].includes(k)) cells[k].hidden = !edge;
        }
        const vals = [[st.lx, st.ly, b.l3], [st.rx, st.ry, b.r3]];
        sticks.forEach((s, i) => {
          const [rx, ry, pr] = vals[i];
          const x = (rx - 128) / 127.5, y = (ry - 128) / 127.5;
          s.trail.push([x, y]); if (s.trail.length > 90) s.trail.shift();
          const mag = Math.hypot(x, y), ang = Math.atan2(y, x);
          const bin = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * s.max.length) % s.max.length;
          if (mag > s.max[bin]) s.max[bin] = Math.min(1.1, mag);
          s.ro.x.set(rx); s.ro.y.set(ry);
          s.ro.ang.set(mag > 0.08 ? `${Math.round(((-ang * 180) / Math.PI + 360) % 360)}°` : '—');
          s.ro.dist.set(`${Math.round(Math.min(1, mag) * 100)}%`);
          drawStick(s, x, y, pr);
        });
        trig.forEach((t) => {
          const v = st[t.k];
          t.fill.style.width = (v / 255) * 100 + '%';
          t.fill.style.opacity = b[t.k] ? '1' : '0.65';
          t.val.set(v); t.pct.set(Math.round((v / 255) * 100) + '%' + (b[t.k] ? ' (apertado)' : ''));
        });
        st.touch.forEach((t, i) => fingersRo[i].set(t.active ? `x ${t.x}  y ${t.y}  (id ${t.id})` : 'Sem toque'));
        drawPad(st);
      },
    };
  },
};
