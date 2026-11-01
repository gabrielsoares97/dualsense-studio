import { h, block, grid, slider, toggle, segmented, select, button } from '../ui.js';
import { LIGHT_MODES } from '../lights.js';

const SWATCHES = ['#2f6bff', '#00b7ff', '#00e0c6', '#18d24a', '#b6ff00', '#ffd400', '#ff8a00', '#ff3b30', '#ff2d8a', '#b44dff', '#7a5cff', '#ffffff'];
const PLAYER_PRESETS = [
  { name: 'Jogador 1', mask: 0b00100 }, { name: 'Jogador 2', mask: 0b01010 }, { name: 'Jogador 3', mask: 0b10101 },
  { name: 'Jogador 4', mask: 0b11011 }, { name: 'Todos', mask: 0b11111 }, { name: 'Nenhum', mask: 0 },
];
const USES_COLOR2 = new Set(['alternate', 'triggers', 'sound']);
const USES_SPEED = new Set(['breathe', 'rainbow', 'blink', 'alternate', 'siren']);

export default {
  id: 'lights',
  label: 'Luzes',
  title: 'Luzes',
  desc: 'A lightbar ao redor do touchpad aceita qualquer cor RGB. Abaixo dela ficam os cinco LEDs de jogador, e o botão de microfone tem o próprio LED laranja.',
  build(app) {
    const { ds, lights, cfg } = app;
    const L = cfg.lights;
    const commit = () => { lights.set(L); app.save(); };

    const color1 = h('input', { type: 'color', value: L.color, 'aria-label': 'Cor principal' });
    const color2 = h('input', { type: 'color', value: L.color2, 'aria-label': 'Segunda cor' });
    color1.addEventListener('input', () => { L.color = color1.value; commit(); });
    color2.addEventListener('input', () => { L.color2 = color2.value; commit(); });
    const swatches = h('div', { class: 'swatches' }, SWATCHES.map((c) => h('button', {
      type: 'button', style: { background: c }, title: c, 'aria-label': 'Usar ' + c,
      onclick: () => { L.color = c; color1.value = c; commit(); },
    })));
    const color2Field = h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('span', { class: 'label' }, 'Segunda cor')), color2);
    const speed = slider({ label: 'Velocidade', min: 0, max: 100, value: L.speed, format: (v) => `${v}%`, onInput: (v) => { L.speed = v; commit(); } });
    const mode = select({
      label: 'Efeito', options: LIGHT_MODES.map((m) => ({ value: m.id, label: m.name })), value: L.mode,
      onChange: (v) => { L.mode = v; syncModeUi(); commit(); },
    });
    const syncModeUi = () => { color2Field.hidden = !USES_COLOR2.has(L.mode); speed.hidden = !USES_SPEED.has(L.mode); };
    syncModeUi();
    const brightness = slider({ label: 'Brilho', min: 0, max: 100, value: L.brightness, format: (v) => `${v}%`, onInput: (v) => { L.brightness = v; commit(); } });

    // LEDs de jogador
    const P = cfg.player;
    const ledBtns = [0, 1, 2, 3, 4].map((i) => {
      const b = h('button', { type: 'button', 'aria-label': `LED ${i + 1}`, 'aria-pressed': String(!!(P.mask & (1 << i))) });
      b.addEventListener('click', () => { P.mask ^= 1 << i; pushPlayer(); });
      return b;
    });
    const pushPlayer = () => {
      ledBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(!!(P.mask & (1 << i)))));
      ds.setPlayerLeds(P.mask, P.fade);
      app.save();
    };

    const micLed = segmented({
      label: 'LED do botão de microfone',
      options: [{ value: 0, label: 'Apagado' }, { value: 1, label: 'Aceso' }, { value: 2, label: 'Piscando' }],
      value: cfg.micLed,
      onChange: (v) => { cfg.micLed = Number(v); ds.setMicLed(cfg.mic.mute ? 1 : cfg.micLed); app.save(); },
      hint: 'Enquanto o microfone estiver silenciado pelo botão, o LED fica aceso.',
    });

    const el = h('div', {},
      block('Lightbar', 'Cor e efeito animado. Os efeitos rodam enquanto esta janela estiver aberta.',
        grid('two',
          h('div', { class: 'stack' },
            h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('span', { class: 'label' }, 'Cor principal')),
              h('div', { class: 'row' }, color1, swatches)),
            mode, color2Field),
          h('div', { class: 'stack' }, brightness, speed)),
        h('div', { class: 'row', style: { marginTop: '14px' } },
          button('Acender com transição', () => ds.lightbarFade(1)),
          button('Apagar com transição', () => ds.lightbarFade(2)),
          h('span', { class: 'hint' }, 'Transições feitas pelo próprio firmware do controle.'))),
      block('LEDs de jogador', 'Clique nos LEDs para ligar ou desligar cada um.',
        h('div', { class: 'row', style: { gap: '22px' } },
          h('div', { class: 'leds-picker' }, ledBtns),
          h('div', { class: 'chips' }, PLAYER_PRESETS.map((pp) => h('button', { type: 'button', class: 'chip', onclick: () => { P.mask = pp.mask; pushPlayer(); } }, pp.name)))),
        grid('two',
          segmented({
            label: 'Brilho dos LEDs', small: true,
            options: [{ value: 0, label: 'Alto' }, { value: 1, label: 'Médio' }, { value: 2, label: 'Baixo' }],
            value: P.brightness, onChange: (v) => { P.brightness = Number(v); ds.setLedBrightness(P.brightness); app.save(); },
          }),
          toggle({ label: 'Acender com transição suave', value: P.fade, onChange: (v) => { P.fade = v; pushPlayer(); } }))),
      block('Microfone', '', micLed),
      block('Restaurar', 'Devolve o controle das luzes ao firmware (útil se algum programa deixou as luzes travadas).',
        button('Restaurar luzes do controle', () => { ds.releaseLeds(); app.toast('Luzes restauradas'); })),
    );

    app.refreshers.add(() => {
      color1.value = L.color; color2.value = L.color2; mode.set(L.mode); brightness.set(L.brightness); speed.set(L.speed); syncModeUi();
      ledBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(!!(P.mask & (1 << i)))));
      micLed.set(cfg.micLed);
    });
    return { el };
  },
};
