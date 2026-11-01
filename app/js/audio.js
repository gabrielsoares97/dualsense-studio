// Áudio do DualSense.
// USB: placa de som de 4 canais (1-2 = fones/alto-falante, 3-4 = atuadores hápticos esquerdo/direito)
//      e microfone estéreo de 48 kHz.
// Bluetooth: o mesmo barramento de 4 canais é capturado por um AudioWorklet e enviado em
//      relatórios HID (bt-audio.js); o microfone chega em Opus dentro dos relatórios de entrada.
import { BtAudioLink } from './bt-audio.js';

const DS_LABEL = /DualSense|Wireless Controller/i;
const ALIAS_IDS = new Set(['default', 'communications', '']);

export class AudioEngine extends EventTarget {
  constructor(ds) {
    super();
    this.ds = ds;
    this.bt = ds ? new BtAudioLink(ds) : null;
    this.mode = null; // 'usb' | 'bt'
    this.ctx = null;
    this.ready = false;
    this.hapticsAvailable = false;
    this.error = null;
    this.outputId = null;
    this.inputId = null;
    this.mic = null; // { stream, source, analyser }
    this._loops = new Map();
    this._noise = null;
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this._onDeviceChange());
  }

  async _findDevices() {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const out = devs.find((d) => d.kind === 'audiooutput' && DS_LABEL.test(d.label) && !ALIAS_IDS.has(d.deviceId));
    const inp = devs.find((d) => d.kind === 'audioinput' && DS_LABEL.test(d.label) && !ALIAS_IDS.has(d.deviceId));
    return { out, inp, labelsVisible: devs.some((d) => d.label) };
  }

  // Precisa de um gesto do usuário (clique) por causa da política de autoplay.
  async init() {
    if (this.ready) { await this.ctx.resume(); return true; }
    this.error = null;
    if (this.ds?.connected && this.ds.transport === 'bt') return this._initBt();
    try {
      let found = await this._findDevices();
      if (!found.labelsVisible || !found.out) {
        // Sem permissão de microfone o navegador esconde os nomes dos dispositivos.
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
        found = await this._findDevices();
      }
      if (!found.out) throw new Error(this.ds?.connected
        ? 'A placa de som USB do DualSense não apareceu. Reconecte o cabo ou use o controle só pelo Bluetooth.'
        : 'Conecte o controle primeiro (pelo cabo USB ou pelo Bluetooth) e depois ative o áudio.');
      this.outputId = found.out.deviceId;
      this.inputId = found.inp?.deviceId || null;
      this.outputLabel = found.out.label;
      this.inputLabel = found.inp?.label || null;

      const ctx = new AudioContext({ sinkId: this.outputId, latencyHint: 'interactive', sampleRate: 48000 });
      await ctx.resume();
      this.ctx = ctx;
      const channels = ctx.destination.maxChannelCount;
      this.hapticsAvailable = channels >= 4;
      ctx.destination.channelCount = Math.min(4, channels);
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'discrete';

      this.merger = ctx.createChannelMerger(4);
      this.merger.connect(ctx.destination);
      this._buildBuses();
      this.mode = 'usb';
      this.ready = true;
      this._scheduler = setInterval(() => this._tick(), 25);
      this.dispatchEvent(new CustomEvent('ready'));
      return true;
    } catch (e) {
      this.error = e.name === 'NotAllowedError'
        ? 'O navegador bloqueou o acesso ao áudio. Permita o microfone para este site (ícone do cadeado na barra de endereço) e tente de novo.'
        : (e.message || String(e));
      this.dispatchEvent(new CustomEvent('error', { detail: this.error }));
      return false;
    }
  }

  // Pelo Bluetooth não há placa de som: o grafo roda sem saída física e um AudioWorklet
  // entrega cada bloco de 10,67 ms para virar relatório HID.
  async _initBt() {
    try {
      if (!BtAudioLink.supported()) throw new Error('Este navegador não tem os recursos de áudio necessários para o Bluetooth (WebCodecs). Use o Chrome ou o Edge atualizados.');
      // A saída padrão do PC serve só de relógio (o modo sem saída do Chrome anda mais devagar
      // que o tempo real e deixaria o som picotado). Nada é tocado nela: o worklet devolve silêncio.
      const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      await ctx.resume();
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(new URL('./bt-tap-worklet.js', import.meta.url));
      this.merger = ctx.createChannelMerger(4);
      const tap = new AudioWorkletNode(ctx, 'ds-bt-tap', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 4, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      });
      this.merger.connect(tap);
      // a ligação até a saída só mantém o worklet processando; o ganho zero garante silêncio no PC
      const mute = ctx.createGain();
      mute.gain.value = 0;
      tap.connect(mute);
      mute.connect(ctx.destination);
      this.bt.reset();
      this.bt.attach(tap);
      this.tap = tap;
      this._buildBuses();
      this.mode = 'bt';
      this.hapticsAvailable = true;
      this.outputLabel = 'DualSense pelo Bluetooth';
      this.inputLabel = 'Microfone do DualSense pelo Bluetooth';
      this.ready = true;
      this._scheduler = setInterval(() => this._tick(), 25);
      this.dispatchEvent(new CustomEvent('ready'));
      return true;
    } catch (e) {
      this.error = e.message || String(e);
      this.dispatchEvent(new CustomEvent('error', { detail: this.error }));
      return false;
    }
  }

  _buildBuses() {
    const ctx = this.ctx;
    // Barramento do alto-falante/fones (estéreo -> canais 1 e 2)
    this.speaker = ctx.createGain();
    this.speaker.channelCount = 2;
    this.speaker.channelCountMode = 'explicit';
    this.speaker.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    this.speaker.connect(split);
    split.connect(this.merger, 0, 0);
    split.connect(this.merger, 1, 1);

    // Atuadores hápticos (mono cada) -> canais 3 e 4
    this.hapL = ctx.createGain();
    this.hapR = ctx.createGain();
    for (const g of [this.hapL, this.hapR]) { g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; }
    this.hapL.connect(this.merger, 0, 2);
    this.hapR.connect(this.merger, 0, 3);
    this.setHapticMaster(0.9);
  }

  async _onDeviceChange() {
    if (!this.ready || this.mode === 'bt') return;
    const { out } = await this._findDevices();
    if (!out) {
      this.shutdown();
      this.error = 'O áudio do controle foi desconectado.';
      this.dispatchEvent(new CustomEvent('error', { detail: this.error }));
    }
  }

  shutdown() {
    clearInterval(this._scheduler);
    this.stopAll();
    this.stopMic();
    try { this.ctx?.close(); } catch { /* ignore */ }
    this.bt?.reset();
    this.ctx = null;
    this.ready = false;
    this.mode = null;
    this._noise = null;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setHapticMaster(v) {
    this.hapticMaster = v;
    if (!this.ctx) return;
    this.hapL.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    this.hapR.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }
  setSpeakerGain(v) {
    if (this.ctx) this.speaker.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  // --- Blocos de síntese ---
  _noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  // Conecta um nó aos dois atuadores com panorama (-1 esquerda .. +1 direita).
  _toHaptics(node, pan = 0) {
    const gl = this.ctx.createGain(), gr = this.ctx.createGain();
    // no centro os dois atuadores ficam em 100%; nas pontas só um lado vibra
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    gl.gain.value = Math.min(1, Math.cos(a) * Math.SQRT2);
    gr.gain.value = Math.min(1, Math.sin(a) * Math.SQRT2);
    node.connect(gl); node.connect(gr);
    gl.connect(this.hapL); gr.connect(this.hapR);
    return { gl, gr };
  }

  _source(wave, freq) {
    if (wave === 'noise') {
      const s = this.ctx.createBufferSource();
      s.buffer = this._noiseBuffer();
      s.loop = true;
      s.loopStart = Math.random();
      return s;
    }
    const o = this.ctx.createOscillator();
    o.type = wave || 'sine';
    o.frequency.value = freq || 150;
    return o;
  }

  // Pulso háptico com envelope. Retorna o tempo final.
  pulse({ at = 0, dur = 0.08, freq = 150, freqEnd = null, wave = 'sine', amp = 1, pan = 0,
    attack = 0.004, release = 0.04, lowpass = null, highpass = null, target = 'haptics' } = {}) {
    if (!this.ready) return 0;
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, at || ctx.currentTime);
    const src = this._source(wave, freq);
    if (freqEnd && src.frequency) src.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    let node = src;
    if (lowpass) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      if (typeof lowpass === 'number') f.frequency.value = lowpass;
      else { f.frequency.setValueAtTime(lowpass[0], t); f.frequency.exponentialRampToValueAtTime(lowpass[1], t + dur); }
      node.connect(f); node = f;
    }
    if (highpass) {
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = highpass;
      node.connect(f); node = f;
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + Math.min(attack, dur));
    env.gain.setValueAtTime(amp, t + Math.max(attack, dur - release));
    env.gain.linearRampToValueAtTime(0, t + dur);
    node.connect(env);
    if (target === 'speaker') {
      if (pan) {
        const p = ctx.createStereoPanner(); p.pan.value = pan;
        env.connect(p); p.connect(this.speaker);
      } else env.connect(this.speaker);
    } else this._toHaptics(env, pan);
    src.start(t);
    src.stop(t + dur + 0.02);
    src.onended = () => env.disconnect();
    return t + dur;
  }

  // Ruído filtrado curto ("grão" de textura).
  grain({ at = 0, dur = 0.02, amp = 0.6, pan = 0, lowpass = 300, highpass = 20 } = {}) {
    return this.pulse({ at, dur, wave: 'noise', amp, pan, lowpass, highpass, attack: 0.002, release: dur * 0.7 });
  }

  // --- Padrões em loop / únicos ---
  play(id, fn, { loop = false } = {}) {
    if (!this.ready) return;
    this.stop(id);
    const start = this.ctx.currentTime + 0.03;
    if (!loop) {
      const end = fn(start, this);
      this._loops.set(id, { oneShot: true, end });
      setTimeout(() => { if (this._loops.get(id)?.oneShot) { this._loops.delete(id); this._emitLoops(); } }, (end - start + 0.1) * 1000);
    } else {
      this._loops.set(id, { fn, next: start, loop: true });
    }
    this._emitLoops();
    this._tick();
  }
  stop(id) {
    const l = this._loops.get(id);
    if (!l) return;
    this._loops.delete(id);
    if (l.cleanup) l.cleanup();
    this._emitLoops();
  }
  isPlaying(id) { return this._loops.has(id); }
  _emitLoops() { this.dispatchEvent(new CustomEvent('loops', { detail: [...this._loops.keys()] })); }
  _tick() {
    if (!this.ready) return;
    const horizon = this.ctx.currentTime + 0.25;
    for (const l of this._loops.values()) {
      if (!l.loop) continue;
      let guard = 0;
      while (l.next < horizon && guard++ < 50) {
        const len = l.fn(l.next, this);
        l.next += Math.max(0.02, len || 0.5);
      }
    }
  }

  // Gerador contínuo por atuador: onda + modulação de amplitude + pulsos liga/desliga.
  generator(side) {
    if (!this.ready) return null;
    this._gens ||= {};
    if (this._gens[side]) return this._gens[side];
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    const am = ctx.createGain(); am.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain);
    lfo.start();
    const gate = ctx.createGain(); gate.gain.value = 1;
    am.connect(gate); gate.connect(out);
    out.connect(side === 'left' ? this.hapL : side === 'right' ? this.hapR : this.speaker);
    const g = {
      side, out, am, lfo, lfoDepth, gate, src: null, wave: null,
      params: { wave: 'sine', freq: 120, amp: 0.6, amRate: 0, amDepth: 0, onMs: 0, offMs: 0 },
      running: false,
    };
    const rebuild = () => {
      if (g.src) { try { g.src.stop(); } catch { /* ignore */ } g.src.disconnect(); }
      g.src = this._source(g.params.wave, g.params.freq);
      if (g.params.wave === 'noise') {
        g.filter = ctx.createBiquadFilter(); g.filter.type = 'lowpass'; g.filter.frequency.value = g.params.freq * 2;
        g.src.connect(g.filter); g.filter.connect(am);
      } else { g.filter = null; g.src.connect(am); }
      g.src.start();
      g.wave = g.params.wave;
    };
    g.set = (patch) => {
      Object.assign(g.params, patch);
      const p = g.params, t = ctx.currentTime;
      if (!g.src || g.wave !== p.wave) rebuild();
      if (g.src.frequency) g.src.frequency.setTargetAtTime(p.freq, t, 0.01);
      if (g.filter) g.filter.frequency.setTargetAtTime(p.freq * 2, t, 0.01);
      const depth = Math.max(0, Math.min(1, p.amDepth));
      am.gain.setTargetAtTime(1 - depth / 2, t, 0.01);
      lfoDepth.gain.setTargetAtTime(depth / 2, t, 0.01);
      lfo.frequency.setTargetAtTime(p.amRate, t, 0.01);
      out.gain.setTargetAtTime(g.running ? p.amp : 0, t, 0.015);
      g._schedGate();
    };
    g._schedGate = () => {
      clearInterval(g._gateTimer);
      const p = g.params;
      gate.gain.cancelScheduledValues(ctx.currentTime);
      gate.gain.setValueAtTime(1, ctx.currentTime);
      if (!(p.onMs > 0 && p.offMs > 0) || !g.running) return;
      let next = ctx.currentTime + 0.02;
      const sched = () => {
        while (next < ctx.currentTime + 0.3) {
          gate.gain.setValueAtTime(1, next);
          gate.gain.setValueAtTime(0, next + p.onMs / 1000);
          next += (p.onMs + p.offMs) / 1000;
        }
      };
      sched();
      g._gateTimer = setInterval(sched, 50);
    };
    g.start = () => { g.running = true; g.set({}); };
    g.stop = () => { g.running = false; clearInterval(g._gateTimer); out.gain.setTargetAtTime(0, ctx.currentTime, 0.015); };
    this._gens[side] = g;
    return g;
  }

  stopAll() {
    for (const id of [...this._loops.keys()]) this.stop(id);
    if (this._gens) Object.values(this._gens).forEach((g) => g.stop());
    this.stopStream();
  }

  // --- Fluxos de áudio -> hápticos / alto-falante ---
  // kind: 'file' | 'system' | 'mic'. Retorna um controlador com stop().
  async startStream(kind, { file = null, toHaptics = true, toSpeaker = false, lowpass = 250, gain = 1.5, loop = false } = {}) {
    if (!this.ready) throw new Error('Ative o áudio primeiro.');
    this.stopStream();
    const ctx = this.ctx;
    let source, cleanup = () => {};
    if (kind === 'file') {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = loop;
      source.onended = () => { if (this.stream?.source === source) this.stopStream(); };
      source.start();
      cleanup = () => { try { source.stop(); } catch { /* ignore */ } };
    } else if (kind === 'system') {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include' });
      if (!media.getAudioTracks().length) {
        media.getTracks().forEach((t) => t.stop());
        throw new Error('Nenhum áudio foi compartilhado. Escolha "Tela inteira" e marque "Compartilhar áudio do sistema".');
      }
      source = ctx.createMediaStreamSource(media);
      media.getAudioTracks()[0].addEventListener('ended', () => this.stopStream());
      cleanup = () => media.getTracks().forEach((t) => t.stop());
    } else if (kind === 'mic') {
      const m = await this.startMic();
      source = m.source;
    }
    const nodes = [];
    const targets = [];
    const link = (dest) => { source.connect(dest); targets.push(dest); };
    const stereo = ctx.createChannelSplitter(2);
    const hgain = ctx.createGain(); hgain.gain.value = gain;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; lp.Q.value = 0.7;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = lowpass; lp2.Q.value = 0.7;
    const hg2 = ctx.createGain(); hg2.gain.value = gain;
    if (toHaptics) {
      link(stereo);
      stereo.connect(lp, 0); lp.connect(hgain); hgain.connect(this.hapL);
      stereo.connect(lp2, 1); lp2.connect(hg2); hg2.connect(this.hapR);
    }
    if (toSpeaker) link(this.speaker);
    nodes.push(stereo, hgain, lp, lp2, hg2);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    link(analyser);
    this.stream = {
      kind, source, analyser,
      setLowpass: (f) => { lp.frequency.setTargetAtTime(f, ctx.currentTime, 0.02); lp2.frequency.setTargetAtTime(f, ctx.currentTime, 0.02); },
      setGain: (g) => { hgain.gain.setTargetAtTime(g, ctx.currentTime, 0.02); hg2.gain.setTargetAtTime(g, ctx.currentTime, 0.02); },
      stop: () => {
        cleanup();
        // desconecta só o que este fluxo ligou (o microfone continua com o medidor e o monitor)
        targets.forEach((d) => { try { source.disconnect(d); } catch { /* ignore */ } });
        nodes.forEach((n) => n.disconnect());
      },
    };
    this.dispatchEvent(new CustomEvent('stream', { detail: kind }));
    return this.stream;
  }

  stopStream() {
    if (!this.stream) return;
    const s = this.stream;
    this.stream = null;
    s.stop();
    this.dispatchEvent(new CustomEvent('stream', { detail: null }));
  }

  // --- Microfone do controle ---
  async startMic() {
    if (this.mic) return this.mic;
    if (!this.ready) throw new Error('Ative o áudio primeiro.');
    const constraints = {
      audio: {
        deviceId: this.inputId ? { exact: this.inputId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 2, sampleRate: 48000,
      },
    };
    const stream = this.mode === 'bt' ? await this.bt.openMic() : await navigator.mediaDevices.getUserMedia(constraints);
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.15;
    source.connect(analyser);
    const monitor = this.ctx.createGain();
    monitor.gain.value = 0;
    source.connect(monitor);
    monitor.connect(this.speaker);
    this.mic = { stream, source, analyser, monitor, freq: new Float32Array(analyser.frequencyBinCount), time: new Float32Array(analyser.fftSize) };
    this.dispatchEvent(new CustomEvent('mic', { detail: true }));
    return this.mic;
  }

  stopMic() {
    if (!this.mic) return;
    if (this.stream?.kind === 'mic') this.stopStream();
    if (this.mode === 'bt') this.bt.closeMic();
    else this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic.source.disconnect();
    this.mic = null;
    this.dispatchEvent(new CustomEvent('mic', { detail: false }));
  }

  // Monitor: 'off' | 'controller' (fones/alto-falante do controle) | 'pc' (saída padrão do Windows)
  setMicMonitor(where, volume = 1) {
    if (!this.mic) return;
    const t = this.ctx.currentTime;
    this.mic.monitor.gain.setTargetAtTime(where === 'controller' ? volume : 0, t, 0.02);
    if (where === 'pc') {
      if (!this._pcCtx) {
        this._pcCtx = new AudioContext();
        this._pcSrc = this._pcCtx.createMediaStreamSource(this.mic.stream);
        this._pcGain = this._pcCtx.createGain();
        this._pcSrc.connect(this._pcGain); this._pcGain.connect(this._pcCtx.destination);
      }
      this._pcGain.gain.value = volume;
    } else if (this._pcCtx) {
      this._pcCtx.close();
      this._pcCtx = null;
    }
  }

  // Nível (dBFS) e análise de sopro. Retorna métricas do quadro atual.
  analyzeMic() {
    const m = this.mic;
    if (!m) return null;
    m.analyser.getFloatTimeDomainData(m.time);
    let sum = 0, peak = 0;
    for (let i = 0; i < m.time.length; i++) { const v = m.time[i]; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
    const rms = Math.sqrt(sum / m.time.length);
    m.analyser.getFloatFrequencyData(m.freq);
    const binHz = this.ctx.sampleRate / m.analyser.fftSize;
    const band = (lo, hi) => [Math.max(1, Math.floor(lo / binHz)), Math.min(m.freq.length - 1, Math.ceil(hi / binHz))];
    // energia em graves (o sopro no microfone é um ruído forte e grave)
    const [l0, l1] = band(30, 500);
    let low = 0;
    for (let i = l0; i <= l1; i++) low += 10 ** (m.freq[i] / 10);
    low /= (l1 - l0 + 1);
    // planura espectral (ruído ~ 1, voz/música ~ 0)
    const [f0, f1] = band(80, 4000);
    let logSum = 0, linSum = 0, n = 0;
    for (let i = f0; i <= f1; i++) { const p = 10 ** (m.freq[i] / 10) + 1e-12; logSum += Math.log(p); linSum += p; n++; }
    const flatness = Math.exp(logSum / n) / (linSum / n);
    // razão graves/agudos
    const [h0, h1] = band(2000, 8000);
    let high = 0;
    for (let i = h0; i <= h1; i++) high += 10 ** (m.freq[i] / 10);
    high /= (h1 - h0 + 1);
    return {
      rmsDb: 20 * Math.log10(rms + 1e-9),
      peakDb: 20 * Math.log10(peak + 1e-9),
      lowDb: 10 * Math.log10(low + 1e-12),
      tilt: 10 * Math.log10((low + 1e-12) / (high + 1e-12)),
      flatness,
    };
  }

  // --- Alto-falante ---
  tone({ freq = 440, dur = 0.6, wave = 'sine', amp = 0.5, at = 0, pan = 0 } = {}) {
    return this.pulse({ freq, dur, wave, amp, at, pan, attack: 0.01, release: Math.min(0.2, dur / 2), target: 'speaker' });
  }

  melody() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    let t = this.now + 0.05;
    notes.forEach((f, i) => { this.tone({ freq: f, dur: i === notes.length - 1 ? 0.5 : 0.16, wave: 'triangle', amp: 0.45, at: t }); t += 0.17; });
    return t;
  }

  sweep({ from = 150, to = 6000, dur = 3, amp = 0.4 } = {}) {
    return this.pulse({ freq: from, freqEnd: to, dur, amp, attack: 0.05, release: 0.2, target: 'speaker' });
  }

  async playFileOnSpeaker(file) {
    return this.startStream('file', { file, toHaptics: false, toSpeaker: true });
  }

  // Gravação do microfone. Retorna Promise<Blob> ao chamar stop().
  record() {
    if (!this.mic) throw new Error('Ligue o microfone primeiro.');
    const rec = new MediaRecorder(this.mic.stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType })); });
    rec.start();
    return { stop: () => { rec.stop(); return done; }, recorder: rec };
  }

  async playBlob(blob, where = 'controller') {
    if (where === 'pc') {
      const a = new Audio(URL.createObjectURL(blob));
      await a.play();
      return;
    }
    const buf = await this.ctx.decodeAudioData(await blob.arrayBuffer());
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.speaker);
    s.start();
  }
}
