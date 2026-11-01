import { h, block, grid, slider, select, button, canvas, palette, segmented } from '../ui.js';
import { MODES, PRESETS, buildEffect, defaultParams, zoneProfile, KIND, describeStatus, EFFECT_NAMES } from '../triggers.js';
import { toHex, fromHex } from '../protocol.js';

// Mantém pares início/fim coerentes depois que um parâmetro muda.
function fixOrder(p, a, b, changed) {
  if (!(a in p) || !(b in p)) return;
  if (p[b] <= p[a]) {
    if (changed === a) p[b] = p[a] + 1; else p[a] = p[b] - 1;
  }
}

function zonesEditor(values, onChange) {
  const bars = values.map(() => h('div', { class: 'z' }, h('i'), h('span')));
  const el = h('div', { class: 'zones-editor', role: 'group', 'aria-label': 'Força por zona (arraste para cima e para baixo)' }, bars);
  const paint = () => bars.forEach((b, i) => {
    b.firstChild.style.height = (values[i] / 8) * 100 + '%';
    b.lastChild.textContent = values[i];
  });
  let drag = false;
  const at = (e) => {
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(9, Math.floor(((e.clientX - r.left - 8) / (r.width - 16)) * 10)));
    const v = Math.max(0, Math.min(8, Math.round((1 - (e.clientY - r.top - 8) / (r.height - 16)) * 8)));
    if (values[i] !== v) { values[i] = v; paint(); onChange(values); }
  };
  el.addEventListener('pointerdown', (e) => { drag = true; el.setPointerCapture(e.pointerId); at(e); });
  el.addEventListener('pointermove', (e) => drag && at(e));
  el.addEventListener('pointerup', () => { drag = false; });
  paint();
  el.setValues = (v) => { v.forEach((x, i) => { values[i] = x; }); paint(); };
  return el;
}

function triggerPanel(app, side) {
  const { ds } = app;
  const label = side === 'left' ? 'L2' : 'R2';
  const other = side === 'left' ? 'right' : 'left';
  const cfgT = () => app.cfg.triggers[side];
  const viz = canvas('viz', 2.4);
  const status = h('div', { class: 'trig-status' });
  const desc = h('p', { class: 'hint', style: { minHeight: '2.6em' } });
  const params = h('div', { class: 'stack' });

  const apply = () => {
    const t = cfgT();
    ds.setTrigger(side, buildEffect(t.mode, t.params));
    app.save();
    bytesOut.textContent = toHex(buildEffect(t.mode, t.params));
  };

  const modeSel = select({
    label: 'Efeito',
    options: MODES.map((m) => ({ value: m.id, label: m.name })),
    value: cfgT().mode,
    onChange: (id) => {
      cfgT().mode = id;
      cfgT().params = defaultParams(id);
      renderParams();
      apply();
    },
  });
  const bytesOut = h('code', { class: 'hexview' });

  function renderParams() {
    const t = cfgT();
    const m = MODES.find((x) => x.id === t.mode) || MODES[0];
    t.params = { ...defaultParams(m.id), ...t.params };
    desc.textContent = m.desc;
    params.replaceChildren();
    const sliders = {};
    for (const d of m.params) {
      sliders[d.key] = slider({
        label: d.label, min: d.min, max: d.max, value: t.params[d.key],
        onInput: (v) => {
          t.params[d.key] = v;
          fixOrder(t.params, 'start', 'end', d.key);
          fixOrder(t.params, 'firstFoot', 'secondFoot', d.key);
          for (const k in sliders) sliders[k].set(t.params[k]);
          apply();
        },
      });
      params.append(sliders[d.key]);
    }
    if (m.zones) {
      const key = m.zones;
      params.append(h('div', { class: 'field' },
        h('div', { class: 'field-head' }, h('span', { class: 'label' }, key === 'strengths' ? 'Força em cada zona (0 a 8)' : 'Intensidade em cada zona (0 a 8)')),
        zonesEditor(t.params[key], (v) => { t.params[key] = [...v]; apply(); })));
    }
    if (m.raw) {
      const ta = h('textarea', { rows: 2, spellcheck: 'false' });
      ta.value = toHex(t.params.bytes);
      ta.addEventListener('change', () => { t.params.bytes = Array.from(fromHex(ta.value)).slice(0, 11); ta.value = toHex(t.params.bytes); apply(); });
      params.append(h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('span', { class: 'label' }, '11 bytes em hexadecimal')), ta,
        h('p', { class: 'hint' }, 'O primeiro byte é o modo (05 desliga, 21 resistência, 25 arma, 26 vibração, 22 arco, 23 galope, 27 máquina). Modos de depuração (FC a FE) podem travar o gatilho até reiniciar o controle.')));
    }
  }

  const presetChips = h('div', { class: 'chips' }, PRESETS.map((p) => h('button', {
    type: 'button', class: 'chip',
    onclick: () => {
      cfgT().mode = p.mode;
      cfgT().params = { ...defaultParams(p.mode), ...structuredClone(p.params) };
      modeSel.set(p.mode);
      renderParams();
      apply();
    },
  }, p.name)));

  const el = h('div', { class: 'trig-panel surface' },
    h('div', { class: 'trig-title' }, h('h2', {}, label), status),
    viz,
    modeSel, desc, params,
    h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('span', { class: 'label' }, 'Prontos')), presetChips),
    h('div', { class: 'row' },
      button(`Copiar para ${side === 'left' ? 'R2' : 'L2'}`, () => {
        app.cfg.triggers[other] = structuredClone(cfgT());
        ds.setTrigger(other, buildEffect(cfgT().mode, cfgT().params));
        app.save();
        app.refreshAll();
      }),
      button('Desligar', () => { cfgT().mode = 'off'; cfgT().params = {}; modeSel.set('off'); renderParams(); apply(); }, { variant: 'ghost' })),
    h('div', { class: 'hint' }, 'Bytes enviados: ', bytesOut),
  );

  renderParams();
  bytesOut.textContent = toHex(buildEffect(cfgT().mode, cfgT().params));

  const draw = (st) => {
    const c = viz, g = c.getContext('2d'), W = c.width, H = c.height, d = c.dpr || 1, p = palette();
    const t = cfgT();
    const prof = zoneProfile(t.mode, t.params);
    const kind = KIND[t.mode];
    g.clearRect(0, 0, W, H);
    const pad = 10 * d, top = 18 * d, bottom = H - 22 * d;
    const zw = (W - pad * 2) / 10;
    for (let i = 0; i < 10; i++) {
      const x = pad + i * zw;
      g.fillStyle = p.line2;
      g.fillRect(x + 2 * d, top, zw - 4 * d, bottom - top);
      const v = prof[i] / 8;
      if (v > 0) {
        const hgt = (bottom - top) * v;
        g.fillStyle = kind === 'vibe' ? `rgb(${p.accentRgb} / 0.55)` : p.accent;
        if (kind === 'vibe') {
          // zigue-zague para indicar vibração
          g.beginPath();
          const y0 = bottom - hgt;
          g.moveTo(x + 2 * d, bottom);
          for (let k = 0; k <= 6; k++) g.lineTo(x + 2 * d + ((zw - 4 * d) * k) / 6, y0 + (k % 2 ? 6 * d : 0));
          g.lineTo(x + zw - 2 * d, bottom);
          g.closePath(); g.fill();
        } else g.fillRect(x + 2 * d, bottom - hgt, zw - 4 * d, hgt);
      }
      g.fillStyle = p.ink2; g.font = `${10 * d}px ${p.font}`; g.textAlign = 'center';
      g.fillText(String(i), x + zw / 2, H - 6 * d);
    }
    // posição real do gatilho
    const pos = (side === 'left' ? st.l2 : st.r2) / 255;
    const px = pad + pos * (W - pad * 2);
    g.strokeStyle = p.ink; g.lineWidth = 2 * d;
    g.beginPath(); g.moveTo(px, top - 6 * d); g.lineTo(px, bottom + 2 * d); g.stroke();
    g.fillStyle = p.ink; g.beginPath(); g.moveTo(px - 5 * d, top - 10 * d); g.lineTo(px + 5 * d, top - 10 * d); g.lineTo(px, top - 3 * d); g.fill();
    // ponto onde o motor do gatilho está segurando
    const tr = side === 'left' ? st.trigL : st.trigR;
    const eff = side === 'left' ? st.effectL : st.effectR;
    if (eff && tr.stop < 10) {
      const sx = pad + (tr.stop + 0.5) * zw;
      g.strokeStyle = p.cir; g.setLineDash([3 * d, 3 * d]); g.lineWidth = 1.5 * d;
      g.beginPath(); g.moveTo(sx, top); g.lineTo(sx, bottom); g.stroke(); g.setLineDash([]);
    }
  };

  return {
    el,
    refresh() { modeSel.set(cfgT().mode); renderParams(); bytesOut.textContent = toHex(buildEffect(cfgT().mode, cfgT().params)); },
    frame(st) {
      const tr = side === 'left' ? st.trigL : st.trigR;
      const eff = side === 'left' ? st.effectL : st.effectR;
      const v = side === 'left' ? st.l2 : st.r2;
      const key = `${v}|${eff}|${tr.status}`;
      if (status.dataset.key !== key) {
        status.dataset.key = key;
        status.replaceChildren(
          h('div', {}, 'Curso ', h('b', {}, `${Math.round((v / 255) * 100)}%`)),
          eff
            ? h('div', {}, 'Efeito ativo ', h('b', {}, EFFECT_NAMES[eff] || MODES.find((m) => m.id === cfgT().mode)?.name || `#${eff}`), ', ', describeStatus(eff, tr.status).toLowerCase())
            : h('div', {}, 'Sem efeito ativo'));
      }
      draw(st);
    },
  };
}

export default {
  id: 'triggers',
  label: 'Gatilhos',
  title: 'Gatilhos adaptativos',
  desc: 'Cada gatilho tem um motor que empurra contra o seu dedo. O curso é dividido em 10 zonas (0 = solto, 9 = fundo). A linha vertical mostra onde o seu dedo está agora e a tracejada, onde o motor está segurando.',
  build(app) {
    const panels = [triggerPanel(app, 'left'), triggerPanel(app, 'right')];
    const powerOpts = Array.from({ length: 8 }, (_, i) => ({ value: i, label: `${100 - i * 12.5}%` }));
    const power = segmented({
      label: 'Força máxima dos motores dos gatilhos',
      options: powerOpts, value: app.cfg.triggerPower, small: true,
      onChange: (v) => { app.cfg.triggerPower = Number(v); app.ds.setMotorPower(app.cfg.triggerPower, app.cfg.rumble.power); app.save(); },
      hint: 'Reduz a força de todos os efeitos de uma vez, em passos de 12,5%.',
    });
    const el = h('div', {},
      h('div', { style: { marginTop: '26px' } }, grid('two', panels.map((p) => p.el))),
      block('Geral', 'Ajustes que valem para os dois gatilhos.',
        power,
        h('div', { class: 'row', style: { marginTop: '14px' } },
          button('Desligar os dois gatilhos', () => {
            for (const s of ['left', 'right']) { app.cfg.triggers[s] = { mode: 'off', params: {} }; app.ds.setTrigger(s, buildEffect('off')); }
            app.save(); panels.forEach((p) => p.refresh());
          })),
        h('p', { class: 'hint' }, 'Os efeitos ficam ativos enquanto o controle estiver ligado. Jogos que também controlam os gatilhos substituem estes ajustes enquanto rodam.')),
    );
    app.refreshers.add(() => panels.forEach((p) => p.refresh()));
    return { el, frame(st) { panels.forEach((p) => p.frame(st)); } };
  },
};
