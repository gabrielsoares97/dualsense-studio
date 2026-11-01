// Áudio do DualSense pelo Bluetooth: hápticos HD, alto-falante/fone e microfone
// empacotados em relatórios HID (ver BT_AUDIO em protocol.js).
import { BT_AUDIO, buildBtAudioReport, buildBtMicToggle } from './protocol.js';

const IDLE_MS = 2000; // para de enviar 2 s depois que o som acaba

export class BtAudioLink {
  constructor(ds) {
    this.ds = ds;
    this.seq = 0;
    this.counter = 0;
    this.micOpen = false;
    this.hapUntil = 0;
    this.spkUntil = 0;
    this.queue = [];
    this.sending = false;
    this.encoder = null;
    this.pending = [];
    this.ts = 0;
    this.stats = { sent: 0, dropped: 0, micFrames: 0, opusBytes: 0, errors: 0 };
    ds.addEventListener('btmic', (e) => this._onMic(e.detail));
  }

  static supported() {
    return 'AudioEncoder' in window && 'AudioWorkletNode' in window;
  }

  attach(tapNode) {
    tapNode.port.onmessage = (e) => this._tick(e.data);
  }

  get active() { return performance.now() < Math.max(this.hapUntil, this.spkUntil); }

  // 0x16 = saída do fone P2, 0x13 = alto-falante interno (o mesmo caminho da configuração de áudio).
  _lane() {
    const o = this.ds.out, plugged = this.ds.state.plug.headphones;
    if (o.outputPath === 3 || !plugged) return BT_AUDIO.LANE_SPEAKER;
    return BT_AUDIO.LANE_HEADSET;
  }

  _tick({ spk, hap }) {
    if (!this.ds.connected || this.ds.transport !== 'bt') return;
    const now = performance.now();
    // hápticos: 48 kHz -> 3 kHz pela média de blocos de 16 amostras, em 8 bits com sinal
    const haptic = new Int8Array(64);
    let signal = false;
    for (let o = 0; o < 32; o++) {
      let l = 0, r = 0;
      for (let k = 0; k < 16; k++) { const j = (o * 16 + k) * 2; l += hap[j]; r += hap[j + 1]; }
      const L = Math.max(-128, Math.min(127, Math.round((l / 16) * 127)));
      const R = Math.max(-128, Math.min(127, Math.round((r / 16) * 127)));
      haptic[o * 2] = L; haptic[o * 2 + 1] = R;
      if (L || R) signal = true;
    }
    if (signal) this.hapUntil = now + IDLE_MS;
    let peak = 0;
    for (let i = 0; i < spk.length; i++) { const a = Math.abs(spk[i]); if (a > peak) peak = a; }
    if (peak > 1e-4) this.spkUntil = now + IDLE_MS;

    const hapOn = now < this.hapUntil, spkOn = now < this.spkUntil;
    if (spkOn && this._ensureEncoder()) this._encode(spk, hapOn ? haptic : null);
    // com o microfone aberto a sessão de áudio precisa de um relatório por tick (cada um leva o byte 0xFF)
    else if (hapOn || this.micOpen) this._enqueue({ haptic });
  }

  _ensureEncoder() {
    if (this.encoder && this.encoder.state === 'configured') return true;
    if (!('AudioEncoder' in window)) return false;
    try {
      this.encoder = new AudioEncoder({
        output: (chunk) => {
          const bytes = new Uint8Array(chunk.byteLength);
          chunk.copyTo(bytes);
          this.stats.opusBytes = bytes.length;
          const p = this.pending.shift() || {};
          // o controle espera exatamente 200 bytes por quadro (CBR 160 kbps)
          const opus = new Uint8Array(BT_AUDIO.OPUS_BYTES);
          opus.set(bytes.subarray(0, BT_AUDIO.OPUS_BYTES));
          this._enqueue({ haptic: p.haptic || null, opus, lane: p.lane });
        },
        error: (e) => { console.warn('Opus', e); this.stats.errors++; this.encoder = null; },
      });
      this.encoder.configure({
        codec: 'opus', sampleRate: 48000, numberOfChannels: 2,
        bitrate: BT_AUDIO.OPUS_BYTES * 8 * 100, bitrateMode: 'constant',
        opus: { frameDuration: 10000, complexity: 5 },
      });
      this.pending = [];
      this.ts = 0;
      return true;
    } catch (e) {
      console.warn('Opus indisponível', e);
      this.encoder = null;
      return false;
    }
  }

  _encode(spk, haptic) {
    const lane = this._lane();
    // o alto-falante é mono: manda o mesmo sinal nos dois canais (estéreo só no fone estéreo)
    const stereo = lane === BT_AUDIO.LANE_HEADSET && this.ds.out.outputPath === 0;
    // o controle consome um quadro de 10 ms a cada 10,67 ms: comprime 512 amostras em 480
    const data = new Float32Array(960);
    for (let i = 0; i < 480; i++) {
      const x = (i * 511) / 479, i0 = Math.floor(x), f = x - i0, i1 = Math.min(511, i0 + 1);
      const L = spk[i0 * 2] * (1 - f) + spk[i1 * 2] * f;
      const R = spk[i0 * 2 + 1] * (1 - f) + spk[i1 * 2 + 1] * f;
      if (stereo) { data[i] = L; data[480 + i] = R; } else { const m = (L + R) / 2; data[i] = m; data[480 + i] = m; }
    }
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 480, numberOfChannels: 2, timestamp: this.ts, data });
    this.ts += 10000;
    this.pending.push({ haptic, lane });
    if (this.pending.length > 8) this.pending.shift();
    this.encoder.encode(ad);
    ad.close();
  }

  _enqueue(item) {
    this.queue.push(item);
    // atrasado não se paga: o firmware descarta rajadas, então joga fora o mais velho
    while (this.queue.length > 3) { this.queue.shift(); this.stats.dropped++; }
    this._pump();
  }

  async _pump() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length && this.ds.connected && this.ds.transport === 'bt') {
        const it = this.queue.shift();
        const report = buildBtAudioReport({ seq: this.seq, counter: this.counter, micOpen: this.micOpen, ...it });
        this.seq = (this.seq + 1) & 0x0f;
        this.counter = (this.counter + 1) & 0xff;
        await this.ds.sendBtAudio(report);
        this.stats.sent++;
      }
    } catch (e) {
      this.stats.errors++;
      console.warn('Falha ao enviar áudio Bluetooth', e);
    } finally {
      this.sending = false;
    }
  }

  // --- Microfone ---
  async _toggleMic(open) {
    const r = buildBtMicToggle(open, this.counter);
    this.counter = (this.counter + 1) & 0xff;
    await this.ds.sendBtAudio(r);
  }

  async openMic() {
    if (!('AudioDecoder' in window) || !('MediaStreamTrackGenerator' in window)) {
      throw new Error('Este navegador não consegue decodificar o microfone pelo Bluetooth. Use o Chrome ou o Edge atualizados.');
    }
    if (this.micStream) return this.micStream;
    this.generator = new MediaStreamTrackGenerator({ kind: 'audio' });
    this.writer = this.generator.writable.getWriter();
    this.decoder = new AudioDecoder({
      output: (frame) => { this.writer.write(frame).catch(() => frame.close()); },
      error: (e) => { console.warn('Opus do microfone', e); this.stats.errors++; },
    });
    // os pacotes vêm marcados como estéreo, mas decodificar como mono é o correto (PadForge mediu ruído no estéreo)
    this.decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1 });
    this.micTs = 0;
    this.micOpen = true;
    this.stats.micFrames = 0;
    await this._toggleMic(true);
    // a abertura não é garantida na primeira tentativa: repete se nada chegar
    let tries = 1;
    this._micRetry = setInterval(() => {
      if (!this.micOpen || this.stats.micFrames > 0 || tries >= 5) { clearInterval(this._micRetry); return; }
      tries++;
      this._toggleMic(true).catch(() => {});
    }, 2000);
    this.micStream = new MediaStream([this.generator]);
    return this.micStream;
  }

  _onMic(bytes) {
    if (!this.decoder || this.decoder.state !== 'configured') return;
    this.stats.micFrames++;
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.micTs, data: bytes }));
      this.micTs += 10000;
    } catch (e) {
      this.stats.errors++;
    }
  }

  async closeMic() {
    clearInterval(this._micRetry);
    if (!this.micStream) return;
    this.micOpen = false;
    try { await this._toggleMic(false); } catch { /* controle já desconectado */ }
    try { this.decoder.close(); } catch { /* ignore */ }
    try { await this.writer.close(); } catch { /* ignore */ }
    this.generator.stop();
    this.micStream = null;
    this.decoder = null;
  }

  reset() {
    this.queue = [];
    this.pending = [];
    this.hapUntil = 0;
    this.spkUntil = 0;
    try { this.encoder?.close(); } catch { /* ignore */ }
    this.encoder = null;
  }
}
