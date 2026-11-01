// Conexão WebHID com o DualSense: leitura de entradas e envio de saídas.
import {
  HID_FILTERS, PID_EDGE, defaultOutput, buildCommon, wrapOutput, makeInputState,
  parseInput, parseSimpleBT, featureView, parseCalibration, parseFirmware, parsePairing,
} from './protocol.js';

// 'rumble' fica de fora: ativar a vibração clássica ao conectar tiraria a prioridade dos hápticos HD.
const ALL_GROUPS = ['trigR', 'trigL', 'volHp', 'volSpk', 'volMic', 'audio', 'micLed', 'power',
  'lightbar', 'player', 'hapticLpf', 'motorPower', 'audio2', 'ledBright'];

const isBluetooth = (device) => device.collections.some((c) =>
  (c.outputReports || []).some((r) => r.reportId === 0x31) || (c.inputReports || []).some((r) => r.reportId === 0x31));

export class DualSense extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.transport = null;
    this.model = 'DualSense';
    this.state = makeInputState();
    this.prevButtons = { ...this.state.buttons };
    this.out = defaultOutput();
    this.calibration = null;
    this.firmware = null;
    this.pairing = null;
    this.dirty = new Set();
    this.btSeq = 0;
    this.reportCount = 0;
    this.reportRate = 0;
    this.lastReportAt = 0;
    this.gyroOffset = [0, 0, 0];
    this._sending = false;
    this._onInput = this._onInput.bind(this);
    this.lastError = null;

    if (navigator.hid) {
      navigator.hid.addEventListener('disconnect', (e) => {
        if (e.device === this.device) this._dropDevice();
      });
      navigator.hid.addEventListener('connect', () => {
        if (!this.device) this.autoConnect();
      });
    }
    setInterval(() => {
      this.reportRate = this.reportCount;
      this.reportCount = 0;
    }, 1000);
  }

  static supported() { return 'hid' in navigator; }
  get connected() { return !!this.device; }

  async requestConnect() {
    const devices = await navigator.hid.requestDevice({ filters: HID_FILTERS });
    if (!devices.length) return false;
    return this._openBest(devices);
  }

  async autoConnect() {
    if (!navigator.hid) return false;
    const devices = (await navigator.hid.getDevices()).filter((d) => HID_FILTERS.some((f) => f.productId === d.productId && f.vendorId === d.vendorId));
    if (!devices.length) return false;
    return this._openBest(devices);
  }

  async _openBest(devices) {
    // USB primeiro: menor latência e é o único modo com hápticos HD por áudio.
    const sorted = [...devices].sort((a, b) => Number(isBluetooth(a)) - Number(isBluetooth(b)));
    for (const d of sorted) {
      try {
        await this._open(d);
        return true;
      } catch (e) {
        this.lastError = e;
        console.warn('Falha ao abrir', d, e);
      }
    }
    return false;
  }

  async _open(device) {
    if (this.device && this.device !== device) await this.disconnect();
    if (!device.opened) await device.open();
    this.device = device;
    this.transport = isBluetooth(device) ? 'bt' : 'usb';
    this.model = device.productId === PID_EDGE ? 'DualSense Edge' : 'DualSense';
    this.state = makeInputState();
    device.addEventListener('inputreport', this._onInput);
    await this._readInfo();
    ALL_GROUPS.forEach((g) => this.dirty.add(g));
    if (this.transport === 'bt') { this.out.lightFade = 2; this.dirty.add('lightFade'); }
    this._flush();
    this.dispatchEvent(new CustomEvent('connect'));
  }

  async _feature(id) {
    try {
      const dv = await this.device.receiveFeatureReport(id);
      return featureView(dv, id);
    } catch (e) {
      console.warn('feature report', id, e);
      return null;
    }
  }

  async _readInfo() {
    // Ler a calibração (0x05) também faz o Bluetooth passar para o relatório completo 0x31.
    const cal = await this._feature(0x05);
    if (cal && cal.byteLength >= 35) this.calibration = parseCalibration(cal);
    const fw = await this._feature(0x20);
    if (fw && fw.byteLength >= 60) {
      this.firmware = parseFirmware(fw);
      this.out.rumbleV2 = this.firmware.updateRaw >= 0x0221;
    }
    const pair = await this._feature(0x09);
    if (pair && pair.byteLength >= 7) this.pairing = parsePairing(pair);
  }

  async disconnect() {
    const d = this.device;
    if (!d) return;
    this._dropDevice();
    try { await d.close(); } catch { /* já fechado */ }
  }

  async forget() {
    const d = this.device;
    await this.disconnect();
    if (d && d.forget) await d.forget();
  }

  _dropDevice() {
    if (this.device) this.device.removeEventListener('inputreport', this._onInput);
    this.device = null;
    this.transport = null;
    this.dispatchEvent(new CustomEvent('disconnect'));
  }

  _onInput(e) {
    const { reportId, data } = e;
    let ok = false;
    if (this.transport === 'usb' && reportId === 0x01) ok = parseInput(data, 0, this.state, this.calibration);
    else if (reportId === 0x31) {
      this.transport = 'bt';
      // Com o microfone aberto, o controle intercala relatórios cujo byte de cabeçalho
      // tem o bit 1 ligado: eles trazem um pacote Opus de 71 bytes no lugar do estado.
      const head = data.getUint8(0);
      if (head & 0x02) {
        const opus = new Uint8Array(data.buffer, data.byteOffset + 2, Math.min(71, data.byteLength - 2)).slice();
        this.dispatchEvent(new CustomEvent('btmic', { detail: opus }));
        return;
      }
      ok = parseInput(data, 1, this.state, this.calibration);
    }
    else if (reportId === 0x01) parseSimpleBT(data, this.state);
    if (!ok) return;
    if (this.captureRaw) { this.lastRaw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(); this.lastRawId = reportId; }
    const g = this.state.gyro;
    for (let i = 0; i < 3; i++) g[i] -= this.gyroOffset[i];
    this.reportCount++;
    this.lastReportAt = performance.now();

    const b = this.state.buttons, p = this.prevButtons;
    for (const k in b) {
      if (b[k] !== p[k]) {
        p[k] = b[k];
        this.dispatchEvent(new CustomEvent(b[k] ? 'buttondown' : 'buttonup', { detail: k }));
      }
    }
    this.dispatchEvent(new CustomEvent('input', { detail: this.state }));
  }

  // --- Saída ---
  _mark(...groups) {
    groups.forEach((g) => this.dirty.add(g));
    this._flush();
  }

  async _flush() {
    if (this._sending || !this.device) return;
    this._sending = true;
    try {
      while (this.dirty.size && this.device) {
        const groups = new Set(this.dirty);
        this.dirty.clear();
        const common = buildCommon(this.out, groups);
        // valores de "uma vez só" não devem ser repetidos no próximo envio
        if (groups.has('lightFade')) this.out.lightFade = 0;
        const { id, data } = wrapOutput(common, this.transport, this.btSeq);
        this.btSeq = (this.btSeq + 1) & 0x0f;
        await this.device.sendReport(id, data);
        await new Promise((r) => setTimeout(r, this.transport === 'bt' ? 12 : 4));
      }
    } catch (e) {
      this.lastError = e;
      console.warn('Falha ao enviar relatório', e);
    } finally {
      this._sending = false;
    }
  }

  // Relatório de áudio do Bluetooth já montado (0x32/0x35, com id e CRC).
  async sendBtAudio(report) {
    if (!this.device || this.transport !== 'bt') return false;
    await this.device.sendReport(report[0], report.subarray(1));
    return true;
  }

  // Envia um bloco comum de 47 bytes montado à mão (aba avançada).
  async sendRawCommon(bytes) {
    if (!this.device) return;
    const common = new Uint8Array(47);
    common.set(bytes.subarray(0, 47));
    const { id, data } = wrapOutput(common, this.transport, this.btSeq);
    this.btSeq = (this.btSeq + 1) & 0x0f;
    await this.device.sendReport(id, data);
  }

  setLightbar(r, g, b) {
    const o = this.out;
    r = r & 0xff; g = g & 0xff; b = b & 0xff;
    if (o.r === r && o.g === g && o.b === b) return;
    o.r = r; o.g = g; o.b = b;
    this._mark('lightbar');
  }
  lightbarFade(mode) { this.out.lightFade = mode; this._mark('lightFade'); }
  releaseLeds() { this._mark('release'); }
  setPlayerLeds(mask, fade = false) { this.out.player = mask & 0x1f; this.out.playerFade = fade; this._mark('player'); }
  setLedBrightness(level) { this.out.ledBright = level; this._mark('ledBright', 'player'); }
  setMicLed(mode) { this.out.micLed = mode; this._mark('micLed'); }

  setRumble(left, right) {
    left = Math.max(0, Math.min(255, left | 0)); right = Math.max(0, Math.min(255, right | 0));
    if (this.out.rumbleL === left && this.out.rumbleR === right) return;
    this.out.rumbleL = left; this.out.rumbleR = right;
    this._mark('rumble');
  }
  setRumbleV2(on) { this.out.rumbleV2 = on; }

  setTrigger(side, bytes) {
    const key = side === 'left' ? 'trigL' : 'trigR';
    this.out[key] = Uint8Array.from(bytes);
    this._mark(key);
  }
  setMotorPower(triggerReduction, rumbleReduction) {
    this.out.triggerPowerReduction = triggerReduction; this.out.rumblePowerReduction = rumbleReduction;
    this._mark('motorPower');
  }
  setHeadphoneVolume(v) { this.out.volHp = v; this._mark('volHp'); }
  setSpeakerVolume(v) { this.out.volSpk = v; this._mark('volSpk'); }
  setMicVolume(v) { this.out.volMic = v; this._mark('volMic'); }
  setAudioControl(patch) { Object.assign(this.out, patch); this._mark('audio'); }
  setAudioControl2(patch) { Object.assign(this.out, patch); this._mark('audio2'); }
  setPower(patch) { Object.assign(this.out.power, patch); this._mark('power'); }
  setHapticLpf(on) { this.out.hapticLpf = on; this._mark('hapticLpf'); }

  // Zera o giroscópio com a média de ~1 s com o controle parado.
  async calibrateGyroRest(ms = 1000) {
    const sum = [0, 0, 0];
    let n = 0;
    const saved = [...this.gyroOffset];
    this.gyroOffset = [0, 0, 0];
    const h = () => { for (let i = 0; i < 3; i++) sum[i] += this.state.gyro[i]; n++; };
    this.addEventListener('input', h);
    await new Promise((r) => setTimeout(r, ms));
    this.removeEventListener('input', h);
    this.gyroOffset = n ? sum.map((s) => s / n) : saved;
    return { samples: n, offset: this.gyroOffset };
  }
}
