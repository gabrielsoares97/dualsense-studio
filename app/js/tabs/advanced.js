import { h, block, grid, toggle, button, readout, notice } from '../ui.js';
import { buildCommon, toHex, fromHex, BATTERY_STATUS } from '../protocol.js';

const ALL = new Set(['rumble', 'trigR', 'trigL', 'volHp', 'volSpk', 'volMic', 'audio', 'micLed', 'power', 'lightbar', 'player', 'hapticLpf', 'motorPower', 'audio2', 'ledBright']);
const LABELS = ['flags 0', 'flags 1', 'motor dir.', 'motor esq.', 'vol. fone', 'vol. falante', 'vol. mic', 'áudio', 'LED mic', 'energia',
  ...Array(11).fill('gatilho R2'), ...Array(11).fill('gatilho L2'), 'tempo', 'tempo', 'tempo', 'tempo', 'força motores', 'áudio 2', 'flags 2',
  'filtro háptico', '?', 'transição', 'brilho LEDs', 'LEDs jogador', 'vermelho', 'verde', 'azul'];

export default {
  id: 'advanced',
  label: 'Energia e avançado',
  title: 'Energia e avançado',
  desc: 'Economia de bateria desligando partes do controle, além de ferramentas para quem quer mexer direto nos bytes que o PC troca com ele.',
  build(app) {
    const { ds, cfg } = app;
    const P = cfg.power;
    const pw = (key, label, hint) => toggle({ label, hint, value: P[key], onChange: (v) => { P[key] = v; ds.setPower({ [key]: v }); app.save(); } });
    const toggles = [
      pw('touch', 'Desligar o touchpad', 'O touchpad para de enviar toques (o clique continua funcionando).'),
      pw('motion', 'Desligar giroscópio e acelerômetro', 'Os sensores de movimento param de medir.'),
      pw('haptic', 'Desligar os atuadores hápticos', 'Economiza energia; vibração e hápticos param.'),
      pw('audio', 'Desligar o áudio do controle', 'Desliga alto-falante, fone e microfone.'),
      pw('hapticMute', 'Silenciar os hápticos', 'Corta o sinal dos atuadores sem desligá-los.'),
    ];

    const bat = { level: readout('Carga'), status: readout('Estado'), raw: readout('Leitura bruta'), usb: readout('USB') };

    // editor do relatório de saída
    const ta = h('textarea', { rows: 4, spellcheck: 'false' });
    const fill = () => { ta.value = toHex(buildCommon(ds.out, ALL)); };
    const rawMsg = notice('');
    const send = async () => {
      const bytes = fromHex(ta.value);
      if (bytes.length !== 47) { rawMsg.set(`O bloco precisa ter exatamente 47 bytes (tem ${bytes.length}).`, 'error'); return; }
      try { await ds.sendRawCommon(bytes); rawMsg.set('Enviado.', 'ok'); } catch (e) { rawMsg.set(e.message, 'error'); }
    };
    const legend = h('div', { class: 'hexview' }, LABELS.map((l, i) => h('span', {}, h('b', {}, String(i).padStart(2, '0')), ' ', l, i < LABELS.length - 1 ? '   ' : '')));

    // visualizador do relatório de entrada
    const hexIn = h('div', { class: 'hexview' });
    let paused = false;
    let prev = null;

    const el = h('div', {},
      block('Economia de energia', 'Cada item desligado aumenta a duração da bateria no Bluetooth.', grid('two', toggles)),
      block('Bateria', '', h('div', { class: 'readouts' }, Object.values(bat))),
      block('Relatório de entrada ao vivo', 'Os bytes que o controle envia a cada ~4 ms. Os destacados mudaram desde o último quadro.',
        hexIn,
        h('div', { class: 'row', style: { marginTop: '10px' } }, toggle({ label: 'Pausar', onChange: (v) => { paused = v; } }))),
      block('Relatório de saída manual', 'Edite os 47 bytes do bloco de comandos e envie. Os bytes 0, 1 e 38 dizem ao controle quais campos aplicar. Use com cuidado: valores inválidos podem travar efeitos até religar o controle.',
        ta,
        h('div', { class: 'row', style: { margin: '10px 0' } }, button('Preencher com o estado atual', fill), button('Enviar ao controle', send, { variant: 'primary' })),
        rawMsg,
        h('details', { style: { marginTop: '10px' } }, h('summary', {}, 'Mapa dos bytes'), legend)),
    );
    fill();
    app.refreshers.add(() => toggles.forEach((t, i) => t.set(P[['touch', 'motion', 'haptic', 'audio', 'hapticMute'][i]])));

    return {
      el,
      show() { ds.captureRaw = true; },
      hide() { ds.captureRaw = false; },
      frame(st) {
        bat.level.set(st.full ? `${st.battery.level}%` : '—');
        bat.status.set(BATTERY_STATUS[st.battery.status] || `Código ${st.battery.status}`);
        bat.raw.set(`${st.battery.raw}/10`);
        bat.usb.set(st.plug.usbData ? 'Dados' : st.plug.usbPower ? 'Só energia' : 'Desconectado');
        if (paused || !ds.lastRaw) return;
        const cur = ds.lastRaw;
        const parts = [h('span', {}, `ID 0x${ds.lastRawId.toString(16).padStart(2, '0')}  `)];
        for (let i = 0; i < cur.length; i++) {
          const txt = cur[i].toString(16).padStart(2, '0') + ' ';
          parts.push(prev && prev[i] !== cur[i] ? h('b', {}, txt) : txt);
        }
        prev = cur;
        hexIn.replaceChildren(...parts);
      },
    };
  },
};
