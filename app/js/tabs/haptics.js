import { h, block, grid, slider, toggle, segmented, button, canvas, palette, notice } from '../ui.js';
import { HAPTIC_PRESETS, TEXTURES } from '../haptic-presets.js';
import { windowsAudioPanel } from '../winaudio.js';

const WAVES = [
  { value: 'sine', label: 'Senoide' }, { value: 'square', label: 'Quadrada' }, { value: 'triangle', label: 'Triangular' },
  { value: 'sawtooth', label: 'Dente de serra' }, { value: 'noise', label: 'Ruído' },
];
// frequência em escala logarítmica: 0..100 -> 10..1000 Hz
const toHz = (v) => Math.round(10 * Math.pow(100, v / 100));
const fromHz = (hz) => (Math.log(hz / 10) / Math.log(100)) * 100;

function audioGate(app, content) {
  const msg = notice('', 'warn');
  const btn = button('Ativar áudio e hápticos', () => app.enableAudio(), { variant: 'primary' });
  const gate = h('div', { class: 'notice warn', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '22px' } },
    h('span', {}, 'Os hápticos HD são áudio: pelo cabo vão nos canais 3 e 4 da placa de som do controle, pelo Bluetooth vão dentro dos relatórios sem fio. Ative o áudio para usar esta seção (pelo cabo, o navegador pede acesso ao microfone só para identificar o controle).'), btn);
  const update = () => {
    gate.hidden = app.audio.ready;
    msg.set(app.audio.error || '', 'error');
    content.classList.toggle('disabled-area', !app.audio.ready);
  };
  app.audio.addEventListener('ready', update);
  app.audio.addEventListener('error', update);
  update();
  return h('div', {}, gate, msg);
}

export default {
  id: 'haptics',
  label: 'Vibração e hápticos',
  title: 'Vibração e hápticos',
  desc: 'O DualSense tem dois atuadores de bobina (um em cada empunhadura) capazes de reproduzir texturas, impactos e até sons, além da emulação dos motores de vibração clássicos.',
  build(app) {
    const { ds, audio, ball, cfg } = app;

    // ---- padrões ----
    const presetBtns = new Map();
    const presets = h('div', { class: 'preset-grid' }, HAPTIC_PRESETS.map((p) => {
      const b = h('button', { type: 'button', class: 'preset', 'aria-pressed': 'false' }, p.name, h('small', {}, p.loop ? 'Contínuo' : 'Uma vez'));
      b.addEventListener('click', async () => {
        if (!audio.ready && !(await app.enableAudio())) return;
        const id = 'preset:' + p.id;
        if (audio.isPlaying(id)) audio.stop(id);
        else audio.play(id, p.fn, { loop: p.loop });
      });
      presetBtns.set('preset:' + p.id, b);
      return b;
    }));
    audio.addEventListener('loops', (e) => {
      const active = new Set(e.detail);
      presetBtns.forEach((b, id) => b.setAttribute('aria-pressed', String(active.has(id))));
    });

    // ---- gerador por atuador ----
    const genState = { left: { wave: 'sine', freq: 120, amp: 0.6, amRate: 0, amDepth: 0, onMs: 0, offMs: 0 }, right: { wave: 'sine', freq: 120, amp: 0.6, amRate: 0, amDepth: 0, onMs: 0, offMs: 0 } };
    const genUi = {};
    const genColumn = (side) => {
      const st = genState[side];
      const gen = () => audio.generator(side);
      const push = () => { const g = gen(); if (g) g.set(st); };
      const power = toggle({
        label: side === 'left' ? 'Atuador esquerdo ligado' : 'Atuador direito ligado',
        onChange: async (on) => {
          if (on && !audio.ready && !(await app.enableAudio())) { power.set(false); return; }
          const g = gen(); if (!g) return;
          g.set(st); on ? g.start() : g.stop();
        },
      });
      const ui = {
        power,
        wave: segmented({ label: 'Forma de onda', options: WAVES, value: st.wave, small: true, onChange: (v) => { st.wave = v; push(); } }),
        freq: slider({ label: 'Frequência', min: 0, max: 100, step: 0.5, value: fromHz(st.freq), format: (v) => `${toHz(v)} Hz`, onInput: (v) => { st.freq = toHz(v); push(); } }),
        amp: slider({ label: 'Intensidade', min: 0, max: 100, value: st.amp * 100, format: (v) => `${v}%`, onInput: (v) => { st.amp = v / 100; push(); } }),
        amRate: slider({ label: 'Pulsação suave (modulação)', min: 0, max: 30, step: 0.5, value: st.amRate, format: (v) => (v ? `${v} Hz` : 'Desligada'), onInput: (v) => { st.amRate = v; st.amDepth = v ? Math.max(st.amDepth, 0.8) : 0; ui.amDepth.set(st.amDepth * 100); push(); } }),
        amDepth: slider({ label: 'Profundidade da modulação', min: 0, max: 100, value: st.amDepth * 100, format: (v) => `${v}%`, onInput: (v) => { st.amDepth = v / 100; push(); } }),
        onMs: slider({ label: 'Pulsos: tempo ligado', min: 0, max: 1000, step: 10, value: st.onMs, format: (v) => (v ? `${v} ms` : 'Contínuo'), onInput: (v) => { st.onMs = v; if (v && !st.offMs) { st.offMs = v; ui.offMs.set(v); } push(); } }),
        offMs: slider({ label: 'Pulsos: tempo desligado', min: 0, max: 1000, step: 10, value: st.offMs, format: (v) => `${v} ms`, onInput: (v) => { st.offMs = v; push(); } }),
      };
      genUi[side] = ui;
      return h('div', { class: 'surface stack' }, h('h3', {}, side === 'left' ? 'Esquerdo' : 'Direito'), Object.values(ui));
    };
    const copyGen = (from, to) => {
      Object.assign(genState[to], genState[from]);
      const u = genUi[to], s = genState[to];
      u.wave.set(s.wave); u.freq.set(fromHz(s.freq)); u.amp.set(s.amp * 100); u.amRate.set(s.amRate); u.amDepth.set(s.amDepth * 100); u.onMs.set(s.onMs); u.offMs.set(s.offMs);
      audio.generator(to)?.set(s);
    };

    // ---- peso virtual ----
    const ballView = canvas('viz dark', 16 / 9);
    const ballToggle = button('Começar', async (e, b) => {
      if (ball.running) { ball.stop(); b.textContent = 'Começar'; b.classList.add('primary'); return; }
      if (!audio.ready) await app.enableAudio();
      ball.start(); b.textContent = 'Parar'; b.classList.remove('primary');
    }, { variant: 'primary' });
    const ballUi = grid('three',
      slider({ label: 'Peso da bola', min: 0, max: 100, value: ball.cfg.mass * 100, format: (v) => (v < 30 ? `Leve (${v})` : v > 70 ? `Pesada (${v})` : `Média (${v})`), onInput: (v) => ball.set({ mass: v / 100 }) }),
      slider({ label: 'Quique', min: 0, max: 95, value: ball.cfg.bounce * 100, format: (v) => `${v}%`, onInput: (v) => ball.set({ bounce: v / 100 }) }),
      slider({ label: 'Atrito', min: 0, max: 100, value: ball.cfg.friction * 100, format: (v) => `${v}%`, onInput: (v) => ball.set({ friction: v / 100 }) }),
      slider({ label: 'Sensibilidade à inclinação', min: 20, max: 300, value: ball.cfg.sensitivity * 100, format: (v) => `${v}%`, onInput: (v) => ball.set({ sensitivity: v / 100 }) }),
      slider({ label: 'Intensidade da vibração', min: 0, max: 100, value: ball.cfg.intensity * 100, format: (v) => `${v}%`, onInput: (v) => ball.set({ intensity: v / 100 }) }),
      h('div', { class: 'stack' },
        toggle({ label: 'Mover também para frente e para trás', value: ball.cfg.twoD, onChange: (v) => ball.set({ twoD: v }) }),
        toggle({ label: 'Inverter esquerda/direita', value: ball.cfg.invertX, onChange: (v) => ball.set({ invertX: v }) }),
        toggle({ label: 'Inverter frente/trás', value: ball.cfg.invertY, onChange: (v) => ball.set({ invertY: v }) })),
    );

    // ---- texturas no touchpad ----
    let texture = null;
    let texDist = 0, texLast = null;
    const texChips = h('div', { class: 'chips' }, [{ id: null, name: 'Desligado' }, ...TEXTURES].map((t) => {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(t.id === null) }, t.name);
      b.addEventListener('click', async () => {
        if (t.id && !audio.ready && !(await app.enableAudio())) return;
        texture = t.id ? t : null;
        [...texChips.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      });
      return b;
    }));
    ds.addEventListener('input', () => {
      if (!texture || !audio.ready) return;
      const f = ds.state.touch[0];
      if (!f.active) { texLast = null; return; }
      if (texLast && texLast.id === f.id) {
        const dist = Math.hypot(f.x - texLast.x, f.y - texLast.y);
        texDist += dist;
        const speed = Math.min(1, dist / 40);
        const pan = (f.x / 1919) * 2 - 1;
        const gr = texture.grain;
        let guard = 0;
        while (texDist >= texture.spacing && guard++ < 4) {
          texDist -= texture.spacing;
          const amp = gr.amp * (0.55 + 0.45 * speed) * (gr.jitter ? 1 - Math.random() * gr.jitter : 1);
          if (gr.kind === 'pulse') audio.pulse({ freq: gr.freq, dur: gr.dur, amp, pan, attack: 0.001, release: gr.dur * 0.7 });
          else audio.grain({ dur: gr.dur, amp, pan, lowpass: gr.lowpass });
        }
      }
      texLast = { id: f.id, x: f.x, y: f.y };
    });
    ds.addEventListener('buttondown', (e) => {
      if (e.detail === 'touchpad' && texture && audio.ready) audio.pulse({ freq: 90, dur: 0.05, amp: 1, attack: 0.001, release: 0.04 });
    });

    // ---- som para vibração ----
    const streamCfg = { lowpass: 250, gain: 1.5, toSpeaker: false, loop: false };
    const streamMsg = notice('');
    const streamMeter = h('i');
    const fileInput = h('input', { type: 'file', accept: 'audio/*,video/*', hidden: true });
    const startStream = async (kind, file) => {
      if (!audio.ready && !(await app.enableAudio())) return;
      try {
        await audio.startStream(kind, { file, lowpass: streamCfg.lowpass, gain: streamCfg.gain, toSpeaker: kind === 'file' && streamCfg.toSpeaker, loop: streamCfg.loop });
        streamMsg.set(kind === 'file' ? `Tocando "${file.name}" nos atuadores.` : kind === 'system' ? 'Vibrando com o som do PC. Para parar, clique em "Parar" ou encerre o compartilhamento.' : 'Vibrando com o som do microfone do controle.', 'ok');
      } catch (e) {
        if (e.name !== 'NotAllowedError') streamMsg.set(e.message, 'error');
        else streamMsg.set('Captura cancelada.', 'warn');
      }
    };
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) startStream('file', fileInput.files[0]); fileInput.value = ''; });
    audio.addEventListener('stream', (e) => { if (!e.detail) streamMsg.set(''); });

    // ---- motores clássicos ----
    const rumble = { left: 0, right: 0 };
    const rumbleL = slider({ label: 'Motor pesado (esquerdo, grave)', min: 0, max: 255, value: 0, format: (v) => `${Math.round((v / 255) * 100)}%`, onInput: (v) => { rumble.left = v; ds.setRumble(rumble.left, rumble.right); } });
    const rumbleR = slider({ label: 'Motor leve (direito, agudo)', min: 0, max: 255, value: 0, format: (v) => `${Math.round((v / 255) * 100)}%`, onInput: (v) => { rumble.right = v; ds.setRumble(rumble.left, rumble.right); } });
    const setRumble = (l, r) => { rumble.left = l; rumble.right = r; rumbleL.set(l); rumbleR.set(r); ds.setRumble(l, r); };
    let rumbleAnim = null;
    const animateRumble = (fn, ms) => {
      cancelAnimationFrame(rumbleAnim);
      const t0 = performance.now();
      const stepFn = () => {
        const k = (performance.now() - t0) / ms;
        if (k >= 1) { setRumble(0, 0); return; }
        const [l, r] = fn(k);
        setRumble(Math.round(l), Math.round(r));
        rumbleAnim = requestAnimationFrame(stepFn);
      };
      stepFn();
    };

    const content = h('div', {},
      block('Geral', 'Vale para tudo que toca nos atuadores HD desta página.',
        windowsAudioPanel(app, 'render'),
        h('div', { style: { height: '14px' } }),
        grid('two',
          slider({ label: 'Intensidade geral', min: 0, max: 100, value: cfg.audio.hapticMaster, format: (v) => `${v}%`, onInput: (v) => { cfg.audio.hapticMaster = v; audio.setHapticMaster(v / 100); app.save(); } }),
          h('div', { class: 'stack' },
            toggle({ label: 'Filtro passa-baixa do controle', value: cfg.hapticLpf, onChange: (v) => { cfg.hapticLpf = v; ds.setHapticLpf(v); app.save(); },
              hint: 'Filtro de hardware que suaviza os hápticos e reduz o chiado audível dos atuadores.' }))),
        h('div', { class: 'row', style: { marginTop: '12px' } }, button('Parar todas as vibrações', () => {
          audio.stopAll(); ball.stop(); setRumble(0, 0);
          Object.values(genUi).forEach((u) => u.power.set(false));
          ballToggle.textContent = 'Começar'; ballToggle.classList.add('primary');
        }))),
      block('Padrões prontos', 'Toque para sentir. Os contínuos ficam tocando até você clicar de novo.', presets),
      block('Peso virtual', 'Uma bola "dentro" do controle: incline-o e sinta ela rolar e bater nas laterais. Quanto mais pesada, mais grave e forte a batida.',
        ballView, h('div', { class: 'row', style: { margin: '12px 0' } }, ballToggle), ballUi),
      block('Texturas no touchpad', 'Escolha uma superfície e arraste o dedo pelo touchpad. A vibração sai do lado em que o dedo está.', texChips),
      block('Gerador por atuador', 'Controle cada atuador separadamente. Frequências entre 40 e 300 Hz são as mais sentidas; acima disso o atuador começa a soar como alto-falante.',
        grid('two', genColumn('left'), genColumn('right')),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          button('Copiar esquerdo → direito', () => copyGen('left', 'right')),
          button('Copiar direito → esquerdo', () => copyGen('right', 'left')))),
      block('Som para vibração', 'Transforma qualquer som em háptico: um arquivo, o áudio do PC (jogos, vídeos, música) ou o microfone. Só os graves passam para os atuadores.',
        h('div', { class: 'row' },
          button('Escolher arquivo de áudio', () => fileInput.click()),
          button('Usar o som do PC', () => startStream('system')),
          button('Usar o microfone do controle', () => startStream('mic')),
          button('Parar', () => audio.stopStream(), { variant: 'ghost' }),
          fileInput),
        h('div', { style: { margin: '12px 0' } }, streamMsg),
        grid('two',
          slider({ label: 'Corte de frequência', min: 40, max: 1200, step: 10, value: streamCfg.lowpass, format: (v) => `${v} Hz`, onInput: (v) => { streamCfg.lowpass = v; audio.stream?.setLowpass(v); } }),
          slider({ label: 'Ganho', min: 0, max: 600, step: 10, value: streamCfg.gain * 100, format: (v) => `${v}%`, onInput: (v) => { streamCfg.gain = v / 100; audio.stream?.setGain(v / 100); } }),
          toggle({ label: 'Tocar o arquivo também no alto-falante do controle', value: false, onChange: (v) => { streamCfg.toSpeaker = v; } }),
          toggle({ label: 'Repetir o arquivo', value: false, onChange: (v) => { streamCfg.loop = v; } })),
        h('div', { class: 'meter', style: { marginTop: '12px' } }, streamMeter),
        h('p', { class: 'hint' }, 'No "som do PC", escolha "Tela inteira" e marque "Compartilhar áudio do sistema" na janela do navegador.')),
    );

    const rumbleBlock = block('Motores clássicos (vibração tipo DualShock)', 'Emulação dos dois motores de peso dos controles antigos: o esquerdo é pesado e grave, o direito é leve e agudo. Funciona também por Bluetooth e é o que a maioria dos jogos de PC usa.',
      grid('two', rumbleL, rumbleR),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        button('Pulso curto', () => animateRumble(() => [255, 255], 180)),
        button('Crescendo', () => animateRumble((k) => [k * 255, k * 200], 2000)),
        button('Esquerda → direita', () => animateRumble((k) => [255 * (1 - k), 255 * k], 1600)),
        button('Batimento', () => animateRumble((k) => { const x = (k * 4) % 1; const v = x < 0.12 || (x > 0.25 && x < 0.37) ? 255 : 0; return [v, v * 0.4]; }, 4000)),
        button('Parar motores', () => { cancelAnimationFrame(rumbleAnim); setRumble(0, 0); }, { variant: 'ghost' })),
      grid('two',
        segmented({
          label: 'Tipo de emulação', small: true,
          options: [{ value: 'auto', label: 'Automático' }, { value: 'v2', label: 'Melhorada' }, { value: 'v1', label: 'Clássica' }],
          value: cfg.rumble.v2,
          onChange: (v) => { cfg.rumble.v2 = v; ds.setRumbleV2(v === 'auto' ? (ds.firmware ? ds.firmware.updateRaw >= 0x0221 : true) : v === 'v2'); setRumble(rumble.left, rumble.right); app.save(); },
          hint: 'A melhorada existe a partir do firmware 2.21 e é mais fiel aos motores reais.',
        }),
        segmented({
          label: 'Força máxima dos motores', small: true,
          options: Array.from({ length: 8 }, (_, i) => ({ value: i, label: `${100 - i * 12.5}%` })),
          value: cfg.rumble.power,
          onChange: (v) => { cfg.rumble.power = Number(v); ds.setMotorPower(cfg.triggerPower, cfg.rumble.power); app.save(); },
        })),
    );

    const el = h('div', {}, audioGate(app, content), content, rumbleBlock);

    const drawBall = () => {
      const c = ballView, g = c.getContext('2d'), W = c.width, H = c.height, d = c.dpr || 1, p = palette();
      g.clearRect(0, 0, W, H);
      const bw = W * 0.7, bh = H * 0.62, x0 = (W - bw) / 2, y0 = (H - bh) / 2;
      g.strokeStyle = 'rgb(255 255 255 / 0.18)'; g.lineWidth = 2 * d;
      g.beginPath(); g.roundRect(x0, y0, bw, bh, 40 * d); g.stroke();
      const now = performance.now();
      for (const im of ball.impacts) {
        const age = (now - im.at) / 500;
        if (age > 1) continue;
        g.strokeStyle = `rgb(${p.accentRgb} / ${1 - age})`;
        g.beginPath(); g.arc(x0 + ((im.x + 1) / 2) * bw, y0 + ((im.y + 1) / 2) * bh, (10 + age * 40) * d, 0, Math.PI * 2); g.stroke();
      }
      const r = (12 + ball.cfg.mass * 16) * d;
      const bx = x0 + r + ((ball.x + 1) / 2) * (bw - 2 * r), by = y0 + r + ((ball.y + 1) / 2) * (bh - 2 * r);
      const grd = g.createRadialGradient(bx - r / 3, by - r / 3, r / 6, bx, by, r);
      grd.addColorStop(0, '#fff'); grd.addColorStop(1, p.accent);
      g.fillStyle = grd;
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgb(255 255 255 / 0.55)'; g.font = `${12 * d}px ${p.font}`; g.textAlign = 'left';
      g.fillText(ball.running ? 'Incline o controle' : 'Clique em Começar', 14 * d, H - 14 * d);
    };

    return {
      el,
      frame() {
        drawBall();
        const an = audio.stream?.analyser;
        if (an) {
          const buf = new Float32Array(an.fftSize);
          an.getFloatTimeDomainData(buf);
          let s = 0; for (const v of buf) s += v * v;
          const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9);
          streamMeter.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + '%';
        } else streamMeter.style.width = '0%';
      },
    };
  },
};
