// Controle desenhado em SVG que espelha o estado real: botões, analógicos,
// gatilhos, dedos no touchpad, lightbar, LEDs de jogador e LED do microfone.
import { h } from './ui.js';

const s = (tag, props = {}, ...kids) => h(tag, { ...props, svg: true }, ...kids);

const BODY = 'M120 58 C160 50 240 50 280 58 C320 64 345 80 358 120 C372 165 386 215 378 250 C372 278 336 287 317 263 C300 240 288 211 268 201 C245 190 155 190 132 201 C112 211 100 240 83 263 C64 287 28 278 22 250 C14 215 28 165 42 120 C55 80 80 64 120 58 Z';

export function createBench() {
  const parts = {};
  const reg = (key, el) => { parts[key] = el; return el; };

  const dpadArm = (key, x, y, w, ht) => reg(key, s('rect', { class: 'btn-shape', x: x - w / 2, y: y - ht / 2, width: w, height: ht, rx: 3 }));
  const face = (key, cx, cy, glyph) => s('g', { class: 'face face-' + key },
    reg(key, s('circle', { class: 'btn-shape', cx, cy, r: 9.5 })),
    glyph(cx, cy));
  const tri = (cx, cy) => s('path', { class: 'glyph', d: `M${cx} ${cy - 4.6} L${cx + 4.6} ${cy + 3.3} L${cx - 4.6} ${cy + 3.3} Z` });
  const cir = (cx, cy) => s('circle', { class: 'glyph', cx, cy, r: 4.3 });
  const cro = (cx, cy) => s('path', { class: 'glyph', d: `M${cx - 4} ${cy - 4} L${cx + 4} ${cy + 4} M${cx + 4} ${cy - 4} L${cx - 4} ${cy + 4}` });
  const squ = (cx, cy) => s('rect', { class: 'glyph', x: cx - 3.8, y: cy - 3.8, width: 7.6, height: 7.6 });

  const trigger = (key, x) => s('g', { class: 'trigger' },
    s('rect', { class: 'trig-track', x, y: 18, width: 62, height: 13, rx: 6.5 }),
    reg(key + 'fill', s('rect', { class: 'trig-fill', x, y: 18, width: 0, height: 13, rx: 6.5 })),
    s('text', { class: 'trig-label', x: x + 31, y: 28 }, key.toUpperCase()));

  const stick = (key, cx, cy) => s('g', {},
    s('circle', { class: 'stick-well', cx, cy, r: 21 }),
    reg(key, s('g', {}, reg(key + 'cap', s('circle', { class: 'stick-cap', cx, cy, r: 13.5 })), s('circle', { class: 'stick-dot', cx, cy, r: 3 }))));

  const svg = s('svg', { viewBox: '0 0 400 300', class: 'controller', role: 'img', 'aria-label': 'Estado ao vivo do controle' },
    s('defs', {},
      s('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
        s('feGaussianBlur', { stdDeviation: 6 })),
      s('clipPath', { id: 'padclip' }, s('rect', { x: 143, y: 58, width: 114, height: 64, rx: 6 }))),
    trigger('l2', 64), trigger('r2', 274),
    reg('l1', s('rect', { class: 'btn-shape bumper', x: 66, y: 38, width: 60, height: 11, rx: 5.5 })),
    reg('r1', s('rect', { class: 'btn-shape bumper', x: 274, y: 38, width: 60, height: 11, rx: 5.5 })),
    s('path', { class: 'body', d: BODY }),
    s('path', { class: 'core', d: 'M134 120 C150 112 250 112 266 120 C282 130 290 170 268 199 C245 189 155 189 132 199 C110 170 118 130 134 120 Z' }),
    // lightbar: dois filetes ao lado do touchpad
    reg('lightGlow', s('g', { class: 'light-glow', filter: 'url(#glow)' },
      s('path', { d: 'M139 64 C136 84 136 102 141 122', class: 'light-strip' }),
      s('path', { d: 'M261 64 C264 84 264 102 259 122', class: 'light-strip' }))),
    reg('lightL', s('path', { d: 'M139 64 C136 84 136 102 141 122', class: 'light-strip core-strip' })),
    reg('lightR', s('path', { d: 'M261 64 C264 84 264 102 259 122', class: 'light-strip core-strip' })),
    reg('touchpad', s('rect', { class: 'touchpad', x: 143, y: 58, width: 114, height: 64, rx: 6 })),
    reg('fingers', s('g', { 'clip-path': 'url(#padclip)' })),
    reg('players', s('g', {}, ...[0, 1, 2, 3, 4].map((i) => s('circle', { class: 'player-led', cx: 184 + i * 8, cy: 129, r: 2 })))),
    reg('create', s('rect', { class: 'btn-shape small', x: 118, y: 66, width: 7, height: 14, rx: 3.5, transform: 'rotate(-12 121 73)' })),
    reg('options', s('rect', { class: 'btn-shape small', x: 275, y: 66, width: 7, height: 14, rx: 3.5, transform: 'rotate(12 278 73)' })),
    s('g', { class: 'dpad' },
      dpadArm('up', 88, 96, 13, 17), dpadArm('down', 88, 128, 13, 17),
      dpadArm('left', 72, 112, 17, 13), dpadArm('right', 104, 112, 17, 13)),
    face('triangle', 312, 93, tri), face('circle', 331, 112, cir),
    face('cross', 312, 131, cro), face('square', 293, 112, squ),
    stick('l3', 148, 162), stick('r3', 252, 162),
    reg('ps', s('path', { class: 'btn-shape ps', d: 'M193 156 l4 -4 h6 l4 4 v4 l-4 4 h-6 l-4 -4 Z' })),
    reg('mute', s('rect', { class: 'btn-shape mute', x: 192, y: 172, width: 16, height: 6, rx: 3 })),
    s('g', { class: 'speaker' }, ...[0, 1, 2, 3, 4, 5].map((i) => s('circle', { cx: 190 + (i % 3) * 10, cy: 185 + Math.floor(i / 3) * 5, r: 1 }))),
    reg('paddleL', s('rect', { class: 'btn-shape paddle', x: 70, y: 214, width: 8, height: 26, rx: 4 })),
    reg('paddleR', s('rect', { class: 'btn-shape paddle', x: 322, y: 214, width: 8, height: 26, rx: 4 })),
    reg('fnL', s('rect', { class: 'btn-shape paddle', x: 132, y: 186, width: 10, height: 5, rx: 2.5 })),
    reg('fnR', s('rect', { class: 'btn-shape paddle', x: 258, y: 186, width: 10, height: 5, rx: 2.5 })),
  );

  const fingerDots = [0, 1].map(() => {
    const g = s('g', { class: 'finger' }, s('circle', { r: 7 }), s('text', { y: 3 }, ''));
    parts.fingers.append(g);
    return g;
  });

  let edge = false;
  return {
    el: svg,
    setEdge(on) { edge = on; svg.classList.toggle('is-edge', on); },
    update(st, out) {
      const b = st.buttons;
      for (const k of ['up', 'down', 'left', 'right', 'triangle', 'circle', 'cross', 'square', 'l1', 'r1', 'create', 'options', 'ps', 'mute', 'paddleL', 'paddleR', 'fnL', 'fnR']) {
        parts[k].classList.toggle('on', !!b[k]);
      }
      parts.touchpad.classList.toggle('on', b.touchpad);
      for (const [k, v] of [['l2', st.l2], ['r2', st.r2]]) {
        const w = (v / 255) * 62;
        const f = parts[k + 'fill'];
        f.setAttribute('width', w.toFixed(1));
        if (k === 'r2') f.setAttribute('x', (274 + 62 - w).toFixed(1));
        f.classList.toggle('on', b[k]);
      }
      const mv = (key, x, y, pressed) => {
        parts[key].setAttribute('transform', `translate(${(((x - 128) / 128) * 8).toFixed(1)} ${(((y - 128) / 128) * 8).toFixed(1)})`);
        parts[key + 'cap'].classList.toggle('on', pressed);
      };
      mv('l3', st.lx, st.ly, b.l3);
      mv('r3', st.rx, st.ry, b.r3);
      st.touch.forEach((t, i) => {
        const g = fingerDots[i];
        g.style.display = t.active ? '' : 'none';
        if (t.active) {
          g.setAttribute('transform', `translate(${(143 + (t.x / 1919) * 114).toFixed(1)} ${(58 + (t.y / 1079) * 64).toFixed(1)})`);
          g.lastChild.textContent = String(i + 1);
        }
      });
      if (out) {
        const color = `rgb(${out.r},${out.g},${out.b})`;
        for (const k of ['lightL', 'lightR']) parts[k].style.stroke = color;
        parts.lightGlow.style.stroke = color;
        parts.lightGlow.style.opacity = String(Math.max(out.r, out.g, out.b) / 255);
        [...parts.players.children].forEach((c, i) => c.classList.toggle('on', !!(out.player & (1 << i))));
        parts.mute.classList.toggle('led-on', out.micLed === 1);
        parts.mute.classList.toggle('led-pulse', out.micLed === 2);
      }
      if (edge !== svg.classList.contains('is-edge')) svg.classList.toggle('is-edge', edge);
    },
  };
}
