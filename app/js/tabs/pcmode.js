import { h, block, grid, slider, toggle, select, button, notice } from '../ui.js';
import { ACTIONS, BUTTON_NAMES, defaultMapping } from '../mapping.js';
import { assignConfig } from '../state.js';

function actionSelect(value, onChange) {
  const sel = h('select', {});
  const groups = new Map();
  for (const a of ACTIONS) {
    if (!groups.has(a.group)) groups.set(a.group, h('optgroup', { label: a.group }));
    groups.get(a.group).append(h('option', { value: a.value }, a.label));
  }
  sel.append(...groups.values());
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

const STICK_MODES = [
  { value: 'none', label: 'Nada' }, { value: 'mouse', label: 'Mover o mouse' }, { value: 'scroll', label: 'Rolar a página' },
  { value: 'wasd', label: 'Teclas W A S D' }, { value: 'arrows', label: 'Setas do teclado' },
];

const MEDIA_PRESET = {
  cross: 'key:179', circle: 'key:27', square: 'key:173', triangle: 'none', up: 'key:175', down: 'key:174',
  left: 'key:177', right: 'key:176', l1: 'key:177', r1: 'key:176', options: 'key:13', touchpad: 'mouse:l',
};

export default {
  id: 'pcmode',
  label: 'Modo PC',
  title: 'Modo PC: mouse e teclado',
  desc: 'Use o controle para navegar no Windows: o touchpad vira mouse, o giroscópio pode mirar e cada botão pode apertar a tecla que você quiser.',
  build(app) {
    const { mapper } = app;
    const m = () => app.cfg.mapping;
    const save = () => app.save();
    const status = notice('');
    const enable = toggle({
      label: 'Usar o controle como mouse e teclado',
      value: mapper.enabled,
      onChange: async (v) => {
        await mapper.setEnabled(v);
        enable.set(mapper.enabled);
      },
    });
    mapper.addEventListener('status', (e) => {
      const { status: s, message } = e.detail;
      status.set(s === 'error' ? message : s === 'on' ? 'Ativo. Os comandos vão para a janela que estiver em primeiro plano.' : '', s === 'error' ? 'error' : 'ok');
      enable.set(mapper.enabled);
    });

    const body = h('div', {});
    const nameEls = {};
    const render = () => {
      const c = m();
      const tp = c.touchpad, gy = c.gyro;
      const stickUi = (key, title) => {
        const st = c[key];
        return h('div', { class: 'surface stack' }, h('h3', {}, title),
          select({ label: 'Função', options: STICK_MODES, value: st.mode, onChange: (v) => { st.mode = v; save(); } }),
          slider({ label: 'Velocidade', min: 100, max: 4000, step: 50, value: st.speed, format: (v) => `${v}`, onInput: (v) => { st.speed = v; save(); } }),
          slider({ label: 'Zona morta', min: 0, max: 40, value: Math.round(st.deadzone * 100), format: (v) => `${v}%`, onInput: (v) => { st.deadzone = v / 100; save(); } }));
      };
      const table = h('div', { class: 'map-table' });
      for (const [k, label] of Object.entries(BUTTON_NAMES)) {
        const name = h('div', { class: 'name' }, h('span', { class: 'dot' }), label);
        nameEls[k] = name;
        table.append(name, actionSelect(c.buttons[k] || 'none', (v) => { c.buttons[k] = v; save(); }));
      }
      body.replaceChildren(
        block('Touchpad', 'Um dedo move o cursor. O clique do touchpad usa a ação definida para ele lá embaixo.',
          grid('two',
            h('div', { class: 'stack' },
              toggle({ label: 'Touchpad move o mouse', value: tp.mouse, onChange: (v) => { tp.mouse = v; save(); } }),
              toggle({ label: 'Clique com dois dedos = clique direito', value: tp.twoFingerRightClick, onChange: (v) => { tp.twoFingerRightClick = v; save(); } }),
              toggle({ label: 'Arrastar com dois dedos rola a página', value: tp.twoFingerScroll, onChange: (v) => { tp.twoFingerScroll = v; save(); } })),
            slider({ label: 'Sensibilidade', min: 20, max: 400, step: 5, value: tp.sensitivity * 100, format: (v) => `${v}%`, onInput: (v) => { tp.sensitivity = v / 100; save(); } }))),
        block('Giroscópio', 'Mire movendo o controle, como em jogos de tiro no PS5. Girar para os lados move na horizontal; inclinar para cima e para baixo, na vertical.',
          grid('two',
            h('div', { class: 'stack' },
              toggle({ label: 'Giroscópio move o mouse', value: gy.enabled, onChange: (v) => { gy.enabled = v; save(); } }),
              select({
                label: 'Quando', value: gy.activation,
                options: [{ value: 'always', label: 'Sempre' }, { value: 'r1', label: 'Segurando R1' }, { value: 'l1', label: 'Segurando L1' },
                  { value: 'l2', label: 'Segurando L2' }, { value: 'r2', label: 'Segurando R2' }, { value: 'touch', label: 'Com um dedo no touchpad' }],
                onChange: (v) => { gy.activation = v; save(); },
              })),
            h('div', { class: 'stack' },
              slider({ label: 'Sensibilidade', min: 2, max: 60, value: gy.sensitivity, format: (v) => `${v} px por grau`, onInput: (v) => { gy.sensitivity = v; save(); } }),
              toggle({ label: 'Inverter horizontal', value: gy.invertX, onChange: (v) => { gy.invertX = v; save(); } }),
              toggle({ label: 'Inverter vertical', value: gy.invertY, onChange: (v) => { gy.invertY = v; save(); } })))),
        block('Analógicos', '', grid('two', stickUi('leftStick', 'Analógico esquerdo'), stickUi('rightStick', 'Analógico direito'))),
        block('Botões', 'O ponto acende quando o botão está apertado. Atalhos com várias teclas são pressionados em ordem e soltos ao contrário.',
          h('div', { class: 'row', style: { marginBottom: '14px' } },
            button('Padrão para área de trabalho', () => { assignConfig(app.cfg.mapping, defaultMapping()); save(); render(); }),
            button('Controle de mídia', () => { Object.assign(m().buttons, MEDIA_PRESET); save(); render(); }),
            button('Limpar todos os botões', () => { for (const k in m().buttons) m().buttons[k] = 'none'; save(); render(); }, { variant: 'ghost' })),
          table),
      );
    };
    render();
    app.refreshers.add(render);

    const el = h('div', {},
      h('div', { class: 'surface stack', style: { marginTop: '24px' } }, enable, status,
        h('p', { class: 'hint' }, 'Jogos que já leem o controle podem receber o comando duas vezes (do controle e do teclado). Desligue o Modo PC antes de jogar. Os comandos param quando o DualSense Studio é fechado.')),
      body,
    );

    return {
      el,
      frame(st) {
        for (const k in nameEls) nameEls[k].classList.toggle('on', !!st.buttons[k]);
      },
    };
  },
};
