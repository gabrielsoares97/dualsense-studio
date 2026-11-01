import { h, block, grid, slider, toggle, segmented, button, canvas, palette, notice, readout } from '../ui.js';
import { windowsAudioPanel } from '../winaudio.js';

const s = (tag, props = {}, ...kids) => h(tag, { ...props, svg: true }, ...kids);

function pinwheel() {
  const blades = s('g', { class: 'blades' }, ...[0, 90, 180, 270].map((a, i) => s('path', {
    d: 'M75 75 L75 18 Q102 30 75 75 Z',
    transform: `rotate(${a} 75 75)`,
    fill: ['var(--cir)', 'var(--tri)', 'var(--cro)', 'var(--squ)'][i],
  })), s('circle', { cx: 75, cy: 75, r: 5, fill: 'var(--paper)', stroke: 'var(--ink-2)' }));
  const svg = s('svg', { viewBox: '0 0 150 150', class: 'pinwheel', 'aria-hidden': 'true' },
    s('line', { x1: 75, y1: 75, x2: 75, y2: 150, stroke: 'var(--ink-2)', 'stroke-width': 3 }), blades);
  svg.blades = blades;
  return svg;
}

export default {
  id: 'mic',
  label: 'Microfone e sopro',
  title: 'Microfone e sopro',
  desc: 'O controle tem microfones embutidos (e aceita o microfone de um headset). Aqui você ajusta a captura, ouve, grava e testa a detecção de sopro, como nos jogos do PS5.',
  build(app) {
    const { ds, audio, lights, cfg } = app;
    const M = cfg.mic;
    const msg = notice('');

    const micToggle = button('Ligar microfone', async (e, b) => {
      if (audio.mic) { audio.stopMic(); return; }
      if (!audio.ready && !(await app.enableAudio())) return;
      try { await audio.startMic(); msg.set(''); } catch (err) { msg.set('Não foi possível abrir o microfone: ' + err.message, 'error'); }
    }, { variant: 'primary' });
    audio.addEventListener('mic', (e) => { micToggle.textContent = e.detail ? 'Desligar microfone' : 'Ligar microfone'; micToggle.classList.toggle('primary', !e.detail); });

    const levelFill = h('i'), levelPeak = h('b');
    const levelRo = readout('Nível', '—');
    const spectrum = canvas('viz', 4);

    const setCtl = (patch) => ds.setAudioControl(patch);
    const vol = slider({ label: 'Ganho do microfone', min: 0, max: 64, value: M.volume, format: (v) => `${Math.round((v / 64) * 100)}%`, onInput: (v) => { M.volume = v; ds.setMicVolume(v); app.save(); }, hint: 'Ajustado dentro do controle, antes de chegar ao PC.' });
    const source = segmented({
      label: 'Qual microfone usar', options: [{ value: 0, label: 'Automático' }, { value: 1, label: 'Do controle' }, { value: 2, label: 'Do headset' }],
      value: M.select, onChange: (v) => { M.select = Number(v); setCtl({ micSelect: M.select }); app.save(); },
    });
    const echo = toggle({ label: 'Cancelamento de eco', value: M.echo, onChange: (v) => { M.echo = v; setCtl({ echoCancel: v }); app.save(); }, hint: 'Remove do microfone o som que sai do próprio alto-falante.' });
    const noise = toggle({ label: 'Redução de ruído', value: M.noise, onChange: (v) => { M.noise = v; setCtl({ noiseCancel: v }); app.save(); }, hint: 'Deixe desligado para a detecção de sopro funcionar melhor.' });
    const beam = toggle({ label: 'Foco direcional (beamforming)', value: M.beamforming, onChange: (v) => { M.beamforming = v; ds.setAudioControl2({ beamforming: v }); app.save(); }, hint: 'Experimental: combina os microfones para focar na direção da sua voz.' });
    const inPath = segmented({
      label: 'Roteamento interno da captura (experimental)', small: true,
      options: [{ value: 0, label: 'Conversa + reconhecimento' }, { value: 1, label: 'Só conversa' }, { value: 2, label: 'Só reconhecimento' }],
      value: M.inputPath, onChange: (v) => { M.inputPath = Number(v); setCtl({ inputPath: M.inputPath }); app.save(); },
    });
    const mute = toggle({ label: 'Microfone silenciado', value: M.mute, onChange: (v) => { M.mute = v; ds.setPower({ micMute: v }); ds.setMicLed(v ? 1 : cfg.micLed); app.save(); } });
    const muteBtn = toggle({ label: 'O botão de microfone do controle silencia e ativa', value: M.muteButtonToggles, onChange: (v) => { M.muteButtonToggles = v; app.save(); } });

    let monitorWhere = 'off', monitorVol = 0.8;
    const monitor = segmented({
      label: 'Ouvir o microfone', options: [{ value: 'off', label: 'Desligado' }, { value: 'controller', label: 'No fone do controle' }, { value: 'pc', label: 'Nas caixas do PC' }],
      value: 'off',
      onChange: async (v) => {
        monitorWhere = v;
        if (v !== 'off' && !audio.mic) {
          if (!audio.ready && !(await app.enableAudio())) return;
          await audio.startMic();
        }
        audio.setMicMonitor(v, monitorVol);
      },
      hint: 'No alto-falante do controle dá microfonia; prefira um fone.',
    });
    const monVol = slider({ label: 'Volume de retorno', min: 0, max: 150, value: 80, format: (v) => `${v}%`, onInput: (v) => { monitorVol = v / 100; audio.setMicMonitor(monitorWhere, monitorVol); } });

    // gravação
    let rec = null, recBlob = null, recStart = 0;
    const recTime = h('span', { class: 'num' }, '0,0 s');
    const playCtl = button('Ouvir no controle', () => recBlob && audio.playBlob(recBlob, 'controller'));
    const playPc = button('Ouvir no PC', () => recBlob && audio.playBlob(recBlob, 'pc'));
    const download = h('a', { class: 'btn ghost', download: 'gravacao-dualsense.webm', hidden: true }, 'Baixar gravação');
    const recBtn = button('Gravar', async (e, b) => {
      if (rec) {
        recBlob = await rec.stop();
        rec = null;
        b.textContent = 'Gravar';
        download.href = URL.createObjectURL(recBlob);
        download.hidden = false;
        playCtl.disabled = playPc.disabled = false;
        return;
      }
      if (!audio.mic) {
        if (!audio.ready && !(await app.enableAudio())) return;
        await audio.startMic();
      }
      rec = audio.record();
      recStart = performance.now();
      b.textContent = 'Parar gravação';
    });
    playCtl.disabled = playPc.disabled = true;

    // sopro
    const wheel = pinwheel();
    let angle = 0, blow = 0, spin = 0;
    const blowCfg = { sensitivity: 60, haptics: true, light: true };
    const blowFill = h('i');
    const blowState = h('p', { class: 'num', style: { textAlign: 'center', fontSize: '20px', margin: '6px 0 0' } }, 'Ligue o microfone e sopre');
    const metrics = { low: readout('Energia grave'), flat: readout('Ruído (planura)'), tilt: readout('Graves × agudos') };
    let blowHaptic = null;
    const ensureBlowHaptic = () => {
      if (blowHaptic || !audio.ready) return;
      const ctx = audio.ctx;
      const src = ctx.createBufferSource(); src.buffer = audio._noiseBuffer(); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(audio.hapL); g.connect(audio.hapR);
      src.start();
      blowHaptic = g;
    };

    const el = h('div', {},
      h('div', { class: 'row', style: { marginTop: '22px' } }, micToggle), h('div', { style: { marginTop: '10px' } }, msg),
      block('Nível e espectro', 'O espectro vai de 20 Hz (esquerda) a 20 kHz (direita), em escala logarítmica.',
        h('div', { class: 'row', style: { gap: '18px', alignItems: 'center' } }, levelRo, h('div', { class: 'meter', style: { flex: '1', minWidth: '200px', height: '16px' } }, levelFill, levelPeak)),
        h('div', { style: { marginTop: '12px' } }, spectrum)),
      block('Sopro', 'Sopre na parte de baixo do controle, perto do botão de microfone, como em Astro\'s Playroom. O cata-vento gira com a força do sopro.',
        grid('two',
          h('div', { class: 'surface', style: { textAlign: 'center' } }, wheel, blowState, h('div', { class: 'meter', style: { marginTop: '10px' } }, blowFill)),
          h('div', { class: 'stack' },
            slider({ label: 'Sensibilidade', min: 0, max: 100, value: blowCfg.sensitivity, format: (v) => `${v}%`, onInput: (v) => { blowCfg.sensitivity = v; } }),
            toggle({ label: 'Vibrar enquanto sopra', value: blowCfg.haptics, onChange: (v) => { blowCfg.haptics = v; } }),
            toggle({ label: 'Acender a lightbar enquanto sopra', value: blowCfg.light, onChange: (v) => { blowCfg.light = v; } }),
            h('div', { class: 'readouts' }, Object.values(metrics))))),
      block('Configurações do microfone', 'Estes ajustes ficam gravados no controle enquanto ele estiver ligado.',
        grid('two', h('div', { class: 'stack' }, vol, source, inPath), h('div', { class: 'stack' }, mute, muteBtn, echo, noise, beam)),
        h('div', { style: { marginTop: '16px' } }, windowsAudioPanel(app, 'capture'))),
      block('Ouvir', '', grid('two', monitor, monVol)),
      block('Gravar', 'Grava o microfone do controle e toca de volta onde você quiser.',
        h('div', { class: 'row' }, recBtn, recTime, playCtl, playPc, download)),
    );

    app.refreshers.add(() => { vol.set(M.volume); source.set(M.select); echo.set(M.echo); noise.set(M.noise); beam.set(M.beamforming); inPath.set(M.inputPath); mute.set(M.mute); muteBtn.set(M.muteButtonToggles); });

    let peak = -100, peakAt = 0;
    let silentSince = 0, silentWarned = false;
    const drawSpectrum = () => {
      const c = spectrum, g = c.getContext('2d'), W = c.width, H = c.height, d = c.dpr || 1, p = palette();
      g.clearRect(0, 0, W, H);
      if (!audio.mic) return;
      const f = audio.mic.freq, binHz = audio.ctx.sampleRate / audio.mic.analyser.fftSize;
      g.fillStyle = p.accent;
      const bars = 96;
      for (let i = 0; i < bars; i++) {
        const lo = 20 * Math.pow(1000, i / bars), hi = 20 * Math.pow(1000, (i + 1) / bars);
        let m = -140;
        for (let k = Math.floor(lo / binHz); k <= Math.ceil(hi / binHz) && k < f.length; k++) m = Math.max(m, f[k]);
        const v = Math.max(0, Math.min(1, (m + 100) / 80));
        const bw = W / bars;
        g.fillRect(i * bw + d, H - v * H, bw - 2 * d, v * H);
      }
    };

    return {
      el,
      hide() { if (blowHaptic) blowHaptic.gain.value = 0; },
      frame() {
        if (rec) recTime.textContent = ((performance.now() - recStart) / 1000).toFixed(1).replace('.', ',') + ' s';
        const m = audio.analyzeMic();
        drawSpectrum();
        if (!m) { levelFill.style.width = '0%'; levelRo.set('—'); silentSince = 0; return; }
        // Silêncio digital absoluto (zeros) não é "sala quieta": o sinal está bloqueado antes de chegar ao PC.
        if (m.peakDb < -150) {
          silentSince ||= performance.now();
          if (performance.now() - silentSince > 2000 && !silentWarned) {
            silentWarned = true;
            msg.set('O microfone do controle está entregando silêncio total (nem o chiado de fundo chega). Confira: o LED laranja do botão de microfone deve estar apagado; o volume do Windows abaixo não pode estar em 0% ou mudo; e, se o controle também estiver pareado por Bluetooth com este PC, desligue o Bluetooth ou remova o pareamento e use só o cabo. Com as duas conexões ativas, o áudio pode ficar preso no Bluetooth.', 'warn');
          }
        } else if (silentWarned) { silentWarned = false; silentSince = 0; msg.set(''); } else silentSince = 0;
        const pct = (db) => Math.max(0, Math.min(100, ((db + 70) / 70) * 100));
        levelFill.style.width = pct(m.rmsDb) + '%';
        const now = performance.now();
        if (m.peakDb > peak || now - peakAt > 1500) { peak = m.peakDb; peakAt = now; }
        levelPeak.style.left = pct(peak) + '%';
        levelRo.set(`${m.rmsDb.toFixed(0)} dB`);

        // detecção de sopro: ruído forte, grave e "plano" (sem tom de voz)
        const thr = -22 - (blowCfg.sensitivity / 100) * 38;
        const raw = m.lowDb > thr && m.flatness > 0.12 && m.tilt > 4 ? Math.min(1, (m.lowDb - thr) / 22 + 0.25) : 0;
        blow = raw > blow ? blow + (raw - blow) * 0.45 : blow * 0.9;
        metrics.low.set(`${m.lowDb.toFixed(0)} dB`);
        metrics.flat.set(m.flatness.toFixed(2));
        metrics.tilt.set(`${m.tilt.toFixed(0)} dB`);
        spin = spin * 0.97 + blow * 0.9;
        angle = (angle + spin * 14) % 360;
        wheel.blades.setAttribute('transform', `rotate(${angle.toFixed(1)} 75 75)`);
        blowFill.style.width = blow * 100 + '%';
        blowState.textContent = blow > 0.15 ? (blow > 0.65 ? 'Soprando forte!' : 'Soprando') : 'Sopre no controle';
        if (blowCfg.haptics && audio.ready) {
          ensureBlowHaptic();
          blowHaptic?.gain.setTargetAtTime(blow > 0.12 ? blow * 0.9 : 0, audio.ctx.currentTime, 0.03);
        } else if (blowHaptic) blowHaptic.gain.value = 0;
        if (blowCfg.light && blow > 0.15) {
          const v = Math.round(80 + blow * 175);
          lights.pulse(`#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}ff`, 80);
        }
      },
    };
  },
};
