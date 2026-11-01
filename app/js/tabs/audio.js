import { h, block, grid, slider, toggle, segmented, button, notice } from '../ui.js';
import { speakerRaw, headphoneRaw, resolveOutputPath } from '../state.js';
import { windowsAudioPanel } from '../winaudio.js';

export default {
  id: 'audio',
  label: 'Alto-falante e fones',
  title: 'Alto-falante e fones',
  desc: 'O controle tem um alto-falante embutido e uma entrada P2 para fone ou headset. Pelo cabo, ele aparece como uma placa de som; pelo Bluetooth, o programa comprime o som (Opus) e envia sem fio.',
  build(app) {
    const { ds, audio, cfg } = app;
    const A = cfg.audio;
    const pushAudioControl = () => ds.setAudioControl({ outputPath: resolveOutputPath(cfg, ds.state.plug.headphones) });
    const ensure = async () => audio.ready || (await app.enableAudio());

    const gate = notice('', 'warn');
    const updateGate = () => gate.set(audio.ready ? '' : 'Ative o áudio (botão na barra lateral) para tocar sons de teste. Os volumes e o caminho de saída funcionam mesmo sem isso.', 'warn');
    audio.addEventListener('ready', updateGate);
    updateGate();

    const path = segmented({
      label: 'Para onde vai o som',
      options: [
        { value: 'auto', label: 'Automático' }, { value: 3, label: 'Só alto-falante' }, { value: 0, label: 'Fone estéreo' },
        { value: 1, label: 'Fone mono' }, { value: 2, label: 'Fone e alto-falante' },
      ],
      value: A.outputPath,
      onChange: (v) => { A.outputPath = v; pushAudioControl(); app.save(); },
      hint: 'No automático, o som vai para o fone quando há algo plugado na entrada P2 e para o alto-falante quando não há.',
    });

    const spk = slider({ label: 'Volume do alto-falante', min: 0, max: 100, value: A.speakerVol, format: (v) => `${v}%`, onInput: (v) => { A.speakerVol = v; ds.setSpeakerVolume(speakerRaw(v)); app.save(); } });
    const hp = slider({ label: 'Volume do fone', min: 0, max: 100, value: A.headphoneVol, format: (v) => `${v}%`, onInput: (v) => { A.headphoneVol = v; ds.setHeadphoneVolume(headphoneRaw(v)); app.save(); } });
    const pregain = slider({ label: 'Reforço do alto-falante', min: 0, max: 7, value: A.pregain, format: (v) => (v ? `+${v}` : 'Nenhum'), onInput: (v) => { A.pregain = v; ds.setAudioControl2({ speakerPregain: v }); app.save(); }, hint: 'Ganho extra do amplificador interno. Valores altos podem distorcer.' });
    const spkMute = toggle({ label: 'Silenciar alto-falante', value: A.speakerMute, onChange: (v) => { A.speakerMute = v; ds.setPower({ speakerMute: v }); app.save(); } });
    const hpMute = toggle({ label: 'Silenciar fone', value: A.headphoneMute, onChange: (v) => { A.headphoneMute = v; ds.setPower({ headphoneMute: v }); app.save(); } });

    const freq = slider({ label: 'Frequência do tom', min: 80, max: 8000, step: 10, value: 440, format: (v) => `${v} Hz` });
    const fileInput = h('input', { type: 'file', accept: 'audio/*,video/*', hidden: true });
    const fileMsg = notice('');
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f || !(await ensure())) return;
      try { await audio.playFileOnSpeaker(f); fileMsg.set(`Tocando "${f.name}" no controle.`, 'ok'); } catch (e) { fileMsg.set('Não foi possível tocar este arquivo: ' + e.message, 'error'); }
    });
    audio.addEventListener('stream', (e) => { if (!e.detail) fileMsg.set(''); });

    const jack = h('dl', { class: 'kv' });
    const el = h('div', {},
      h('div', { style: { marginTop: '22px' } }, gate),
      block('Saída', '', path,
        grid('two', h('div', { class: 'stack' }, spk, pregain, spkMute), h('div', { class: 'stack' }, hp, hpMute))),
      block('Volume no Windows', 'O Windows aplica o próprio volume antes de o som chegar ao controle. Deixe em 100% e regule pelo volume do alto-falante e do fone acima, que também preserva a força dos hápticos.',
        windowsAudioPanel(app, 'render')),
      block('Testar som', 'Os sons saem pelo caminho escolhido acima.',
        h('div', { class: 'row' },
          button('Tocar tom', async () => (await ensure()) && audio.tone({ freq: freq.get(), dur: 0.8 })),
          button('Melodia', async () => (await ensure()) && audio.melody()),
          button('Varredura de graves a agudos', async () => (await ensure()) && audio.sweep({})),
          button('Só lado esquerdo do fone', async () => (await ensure()) && audio.tone({ freq: 523, dur: 0.6, pan: -1 })),
          button('Só lado direito do fone', async () => (await ensure()) && audio.tone({ freq: 659, dur: 0.6, pan: 1 }))),
        h('div', { style: { maxWidth: '420px', marginTop: '12px' } }, freq)),
      block('Tocar um arquivo no controle', 'Música, efeitos ou o áudio de um vídeo. O alto-falante do controle é mono e pequeno, então os graves somem. Pelo Bluetooth há cerca de 0,1 s de atraso.',
        h('div', { class: 'row' }, button('Escolher arquivo', () => fileInput.click()), button('Parar', () => audio.stopStream(), { variant: 'ghost' }), fileInput),
        h('div', { style: { marginTop: '12px' } }, fileMsg)),
      block('Entrada P2', 'Detectada ao vivo pelo controle.', jack),
    );

    app.refreshers.add(() => { path.set(A.outputPath); spk.set(A.speakerVol); hp.set(A.headphoneVol); pregain.set(A.pregain); spkMute.set(A.speakerMute); hpMute.set(A.headphoneMute); });

    let lastKey = '';
    return {
      el,
      frame(st) {
        const outPath = resolveOutputPath(cfg, st.plug.headphones);
        const names = ['Fone estéreo', 'Fone mono', 'Fone e alto-falante', 'Só alto-falante'];
        const key = `${st.plug.headphones}${st.plug.mic}${outPath}${audio.outputLabel}`;
        if (key === lastKey) return;
        lastKey = key;
        jack.replaceChildren(
          h('dt', {}, 'Fone plugado'), h('dd', {}, st.plug.headphones ? 'Sim' : 'Não'),
          h('dt', {}, 'Microfone do headset'), h('dd', {}, st.plug.mic ? 'Sim' : 'Não'),
          h('dt', {}, 'Saída atual'), h('dd', {}, names[outPath]),
          h('dt', {}, 'Dispositivo de som'), h('dd', {}, audio.outputLabel || '—'));
      },
    };
  },
};
