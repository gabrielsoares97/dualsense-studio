// Protocolo HID do DualSense (USB e Bluetooth).
// Offsets validados contra o controle real (relatório de entrada 0x01 USB / 0x31 BT,
// saída 0x02 USB / 0x31 BT) e baseados no driver hid-playstation do Linux.

export const VID = 0x054c;
export const PID_DUALSENSE = 0x0ce6;
export const PID_EDGE = 0x0df2;
export const HID_FILTERS = [
  { vendorId: VID, productId: PID_DUALSENSE },
  { vendorId: VID, productId: PID_EDGE },
];

// Offsets dentro do bloco "comum" do relatório de saída (47 bytes).
export const O = {
  FLAG0: 0, FLAG1: 1, MOTOR_R: 2, MOTOR_L: 3,
  VOL_HP: 4, VOL_SPK: 5, VOL_MIC: 6, AUDIO: 7, MIC_LED: 8, POWER: 9,
  TRIG_R: 10, TRIG_L: 21, HOST_TS: 32, MOTOR_POWER: 36, AUDIO2: 37, FLAG2: 38,
  HAPTIC_LPF: 39, LIGHT_SETUP: 41, LED_BRIGHT: 42, PLAYER: 43, RED: 44, GREEN: 45, BLUE: 46,
};
export const COMMON_SIZE = 47;

// Grupo de configuração -> [byte de flag, bit].
export const GROUP_FLAGS = {
  trigR: [O.FLAG0, 0x04], trigL: [O.FLAG0, 0x08],
  volHp: [O.FLAG0, 0x10], volSpk: [O.FLAG0, 0x20], volMic: [O.FLAG0, 0x40], audio: [O.FLAG0, 0x80],
  micLed: [O.FLAG1, 0x01], power: [O.FLAG1, 0x02], lightbar: [O.FLAG1, 0x04], release: [O.FLAG1, 0x08],
  player: [O.FLAG1, 0x10], hapticLpf: [O.FLAG1, 0x20], motorPower: [O.FLAG1, 0x40], audio2: [O.FLAG1, 0x80],
  ledBright: [O.FLAG2, 0x01], lightFade: [O.FLAG2, 0x02],
};

export function defaultOutput() {
  return {
    rumbleL: 0, rumbleR: 0, rumbleV2: true,
    trigR: new Uint8Array([0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    trigL: new Uint8Array([0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    volHp: 0x64, volSpk: 0x64, volMic: 0x40,
    micSelect: 0, echoCancel: false, noiseCancel: false, outputPath: 0, inputPath: 0,
    micLed: 0,
    power: { touch: false, motion: false, haptic: false, audio: false, micMute: false, speakerMute: false, headphoneMute: false, hapticMute: false },
    triggerPowerReduction: 0, rumblePowerReduction: 0,
    speakerPregain: 0, beamforming: false,
    hapticLpf: false,
    lightFade: 0,
    ledBright: 0,
    player: 0b00100, playerFade: false,
    r: 0, g: 80, b: 255,
  };
}

export function buildCommon(out, groups) {
  const c = new Uint8Array(COMMON_SIZE);
  for (const g of groups) {
    const f = GROUP_FLAGS[g];
    if (f) c[f[0]] |= f[1];
  }
  if (groups.has('rumble')) {
    c[O.FLAG0] |= 0x02; // usa vibração "clássica" em vez dos hápticos por áudio
    if (out.rumbleV2) c[O.FLAG2] |= 0x04; else c[O.FLAG0] |= 0x01;
  }
  c[O.MOTOR_R] = out.rumbleR;
  c[O.MOTOR_L] = out.rumbleL;
  c[O.VOL_HP] = out.volHp & 0x7f;
  c[O.VOL_SPK] = out.volSpk & 0xff;
  c[O.VOL_MIC] = out.volMic & 0xff;
  c[O.AUDIO] = (out.micSelect & 3) | (out.echoCancel ? 0x04 : 0) | (out.noiseCancel ? 0x08 : 0)
    | ((out.outputPath & 3) << 4) | ((out.inputPath & 3) << 6);
  c[O.MIC_LED] = out.micLed;
  const p = out.power;
  c[O.POWER] = (p.touch ? 0x01 : 0) | (p.motion ? 0x02 : 0) | (p.haptic ? 0x04 : 0) | (p.audio ? 0x08 : 0)
    | (p.micMute ? 0x10 : 0) | (p.speakerMute ? 0x20 : 0) | (p.headphoneMute ? 0x40 : 0) | (p.hapticMute ? 0x80 : 0);
  c.set(out.trigR.subarray(0, 11), O.TRIG_R);
  c.set(out.trigL.subarray(0, 11), O.TRIG_L);
  c[O.MOTOR_POWER] = (out.triggerPowerReduction & 0x0f) | ((out.rumblePowerReduction & 0x0f) << 4);
  c[O.AUDIO2] = (out.speakerPregain & 0x07) | (out.beamforming ? 0x08 : 0);
  c[O.HAPTIC_LPF] = out.hapticLpf ? 0x01 : 0;
  c[O.LIGHT_SETUP] = out.lightFade;
  c[O.LED_BRIGHT] = out.ledBright;
  c[O.PLAYER] = (out.player & 0x1f) | (out.playerFade ? 0 : 0x20);
  c[O.RED] = out.r; c[O.GREEN] = out.g; c[O.BLUE] = out.b;
  return c;
}

// --- CRC32 (Bluetooth) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

// Retorna { id, data } pronto para HIDDevice.sendReport (data sem o report id).
export function wrapOutput(common, transport, seq) {
  if (transport === 'usb') return { id: 0x02, data: common };
  const full = new Uint8Array(78);
  full[0] = 0x31;
  full[1] = (seq & 0x0f) << 4;
  full[2] = 0x10;
  full.set(common, 3);
  let crc = crc32([0xa2]);
  crc = ~crc32(full.subarray(0, 74), crc) >>> 0;
  full[74] = crc & 0xff; full[75] = (crc >>> 8) & 0xff; full[76] = (crc >>> 16) & 0xff; full[77] = (crc >>> 24) & 0xff;
  return { id: 0x31, data: full.subarray(1) };
}

// --- Áudio pelo Bluetooth ---
// Pelo Bluetooth não existe placa de som: hápticos, alto-falante e microfone viajam dentro
// de relatórios HID. Cada relatório é uma cadeia de pacotes [id|0x80, tamanho, dados...]:
//   0x11 cabeçalho da sessão (byte de microfone: 0xFF abre, 0xFE fecha; contador)
//   0x12 hápticos: 32 quadros estéreo s8 a 3 kHz (64 bytes)
//   0x13 alto-falante / 0x16 fone: um quadro Opus de 10 ms, 200 bytes (160 kbps CBR)
// Formato conferido com SAxense (egormanga) e PadForge (hifihedgehog).
export const BT_AUDIO = {
  HAPTIC_ID: 0x32, HAPTIC_SIZE: 142, SPEAKER_ID: 0x35, SPEAKER_SIZE: 334,
  OPUS_BYTES: 200, BUFFER_LEN: 48, LANE_SPEAKER: 0x13, LANE_HEADSET: 0x16,
  TICK_MS: (512 / 48000) * 1000, MIC_OPUS_BYTES: 71,
};

function finishBtReport(r) {
  let crc = crc32([0xa2]);
  crc = ~crc32(r.subarray(0, r.length - 4), crc) >>> 0;
  r[r.length - 4] = crc & 0xff; r[r.length - 3] = (crc >>> 8) & 0xff;
  r[r.length - 2] = (crc >>> 16) & 0xff; r[r.length - 1] = (crc >>> 24) & 0xff;
  return r;
}

// haptic: Int8Array(64) ou null; opus: Uint8Array ou null. Retorna o relatório completo (com id).
export function buildBtAudioReport({ seq, counter, micOpen, haptic = null, opus = null, lane = BT_AUDIO.LANE_SPEAKER }) {
  const speaker = !!opus;
  const r = new Uint8Array(speaker ? BT_AUDIO.SPEAKER_SIZE : BT_AUDIO.HAPTIC_SIZE);
  r[0] = speaker ? BT_AUDIO.SPEAKER_ID : BT_AUDIO.HAPTIC_ID;
  r[1] = (seq & 0x0f) << 4;
  r[2] = 0x11 | 0x80; r[3] = 7;
  r[4] = micOpen ? 0xff : 0xfe;
  r[9] = BT_AUDIO.BUFFER_LEN;
  r[10] = counter & 0xff;
  let at = 11;
  if (haptic || !speaker) {
    r[at] = 0x12 | 0x80; r[at + 1] = 64;
    if (haptic) r.set(new Uint8Array(haptic.buffer, haptic.byteOffset, 64), at + 2);
    at += 66;
  }
  if (speaker) {
    r[at] = lane | 0x80; r[at + 1] = BT_AUDIO.OPUS_BYTES;
    r.set(opus.subarray(0, BT_AUDIO.OPUS_BYTES), at + 2);
  }
  return finishBtReport(r);
}

// Abre/fecha o microfone pelo Bluetooth (0x32 com hápticos zerados).
export function buildBtMicToggle(open, counter) {
  const r = new Uint8Array(BT_AUDIO.HAPTIC_SIZE);
  r[0] = BT_AUDIO.HAPTIC_ID; r[1] = 0;
  r[2] = 0x11 | 0x80; r[3] = 7; r[4] = open ? 0xff : 0xfe;
  r[9] = BT_AUDIO.BUFFER_LEN; r[10] = counter & 0xff;
  r[11] = 0x12 | 0x80; r[12] = 64;
  return finishBtReport(r);
}

// --- Entrada ---
export function makeInputState() {
  return {
    lx: 128, ly: 128, rx: 128, ry: 128, l2: 0, r2: 0, seq: 0,
    buttons: {
      up: false, down: false, left: false, right: false,
      square: false, cross: false, circle: false, triangle: false,
      l1: false, r1: false, l2: false, r2: false, create: false, options: false, l3: false, r3: false,
      ps: false, touchpad: false, mute: false, fnL: false, fnR: false, paddleL: false, paddleR: false,
    },
    gyroRaw: [0, 0, 0], accelRaw: [0, 0, 0],
    gyro: [0, 0, 0], // graus/s: pitch, yaw, roll
    accel: [0, 0, 0], // g: x, y, z
    sensorTs: 0, temperature: 0,
    touch: [{ active: false, id: 0, x: 0, y: 0 }, { active: false, id: 0, x: 0, y: 0 }],
    touchTs: 0,
    trigR: { stop: 0, status: 0 }, trigL: { stop: 0, status: 0 }, effectR: 0, effectL: 0,
    battery: { level: 0, raw: 0, status: 0 },
    plug: { headphones: false, mic: false, micMuted: false, usbData: false, usbPower: false, externalMic: false, hapticLpf: false },
    full: false,
  };
}

// dv = DataView do relatório SEM o report id; o = offset base (USB 0, BT 1 por causa do byte de tag)
export function parseInput(dv, o, s, calib) {
  if (dv.byteLength < o + 55) return false;
  const u8 = (i) => dv.getUint8(o + i);
  const s16 = (i) => dv.getInt16(o + i, true);
  s.lx = u8(0); s.ly = u8(1); s.rx = u8(2); s.ry = u8(3); s.l2 = u8(4); s.r2 = u8(5); s.seq = u8(6);
  const b0 = u8(7), b1 = u8(8), b2 = u8(9), b = s.buttons;
  const hat = b0 & 0x0f;
  b.up = hat === 7 || hat === 0 || hat === 1;
  b.right = hat >= 1 && hat <= 3;
  b.down = hat >= 3 && hat <= 5;
  b.left = hat >= 5 && hat <= 7;
  b.square = !!(b0 & 0x10); b.cross = !!(b0 & 0x20); b.circle = !!(b0 & 0x40); b.triangle = !!(b0 & 0x80);
  b.l1 = !!(b1 & 0x01); b.r1 = !!(b1 & 0x02); b.l2 = !!(b1 & 0x04); b.r2 = !!(b1 & 0x08);
  b.create = !!(b1 & 0x10); b.options = !!(b1 & 0x20); b.l3 = !!(b1 & 0x40); b.r3 = !!(b1 & 0x80);
  b.ps = !!(b2 & 0x01); b.touchpad = !!(b2 & 0x02); b.mute = !!(b2 & 0x04);
  b.fnL = !!(b2 & 0x10); b.fnR = !!(b2 & 0x20); b.paddleL = !!(b2 & 0x40); b.paddleR = !!(b2 & 0x80);

  for (let i = 0; i < 3; i++) {
    s.gyroRaw[i] = s16(15 + i * 2);
    s.accelRaw[i] = s16(21 + i * 2);
    if (calib) {
      const g = calib.gyro[i], a = calib.accel[i];
      s.gyro[i] = g.denom ? (s.gyroRaw[i] * g.numer) / g.denom : s.gyroRaw[i] / 16.4;
      s.accel[i] = a.denom ? ((s.accelRaw[i] - a.bias) * a.numer) / a.denom : s.accelRaw[i] / 8192;
    } else {
      s.gyro[i] = s.gyroRaw[i] / 16.4;
      s.accel[i] = s.accelRaw[i] / 8192;
    }
  }
  s.sensorTs = dv.getUint32(o + 27, true);
  s.temperature = dv.getInt8(o + 31);
  for (let k = 0; k < 2; k++) {
    const p = 32 + k * 4, t = s.touch[k];
    const c = u8(p);
    t.active = !(c & 0x80);
    t.id = c & 0x7f;
    t.x = u8(p + 1) | ((u8(p + 2) & 0x0f) << 8);
    t.y = (u8(p + 2) >> 4) | (u8(p + 3) << 4);
  }
  s.touchTs = u8(40);
  const tr = u8(41), tl = u8(42), fx = u8(47);
  s.trigR.stop = tr & 0x0f; s.trigR.status = tr >> 4;
  s.trigL.stop = tl & 0x0f; s.trigL.status = tl >> 4;
  s.effectR = fx & 0x0f; s.effectL = fx >> 4;
  const pw = u8(52);
  s.battery.raw = pw & 0x0f;
  s.battery.status = pw >> 4;
  s.battery.level = Math.min(100, s.battery.raw * 10 + 5);
  const pl = u8(53), pl2 = u8(54);
  s.plug.headphones = !!(pl & 0x01); s.plug.mic = !!(pl & 0x02); s.plug.micMuted = !!(pl & 0x04);
  s.plug.usbData = !!(pl & 0x08); s.plug.usbPower = !!(pl & 0x10);
  s.plug.externalMic = !!(pl2 & 0x01); s.plug.hapticLpf = !!(pl2 & 0x02);
  s.full = true;
  return true;
}

// Relatório simples do Bluetooth (0x01, antes de pedir a calibração): só sticks e botões.
export function parseSimpleBT(dv, s) {
  if (dv.byteLength < 9) return;
  s.lx = dv.getUint8(0); s.ly = dv.getUint8(1); s.rx = dv.getUint8(2); s.ry = dv.getUint8(3);
  s.l2 = dv.getUint8(7); s.r2 = dv.getUint8(8);
}

export const BATTERY_STATUS = {
  0: 'Descarregando', 1: 'Carregando', 2: 'Carga completa',
  0xa: 'Tensão anormal', 0xb: 'Temperatura anormal', 0xf: 'Erro de carga',
};

// --- Relatórios de recurso (feature reports). dv inclui o report id no byte 0. ---
export function featureView(dv, id) {
  // O Chrome no Windows entrega o report id no byte 0; se não vier, alinha.
  if (dv.getUint8(0) === id) return dv;
  const buf = new Uint8Array(dv.byteLength + 1);
  buf[0] = id;
  buf.set(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), 1);
  return new DataView(buf.buffer);
}

export function parseCalibration(dv) {
  const s = (i) => dv.getInt16(i, true);
  const pitchBias = s(1), yawBias = s(3), rollBias = s(5);
  const pitchPlus = s(7), pitchMinus = s(9), yawPlus = s(11), yawMinus = s(13), rollPlus = s(15), rollMinus = s(17);
  const speedPlus = s(19), speedMinus = s(21);
  const acc = [[s(23), s(25)], [s(27), s(29)], [s(31), s(33)]];
  const speed2x = speedPlus + speedMinus;
  const gyroAxis = (plus, minus, bias) => ({ bias: 0, numer: speed2x, denom: Math.abs(plus - bias) + Math.abs(minus - bias) });
  const raw = { pitchBias, yawBias, rollBias, pitchPlus, pitchMinus, yawPlus, yawMinus, rollPlus, rollMinus, speedPlus, speedMinus,
    accXPlus: acc[0][0], accXMinus: acc[0][1], accYPlus: acc[1][0], accYMinus: acc[1][1], accZPlus: acc[2][0], accZMinus: acc[2][1] };
  return {
    gyro: [gyroAxis(pitchPlus, pitchMinus, pitchBias), gyroAxis(yawPlus, yawMinus, yawBias), gyroAxis(rollPlus, rollMinus, rollBias)],
    accel: acc.map(([plus, minus]) => {
      const range = plus - minus;
      return { bias: plus - range / 2, numer: 2, denom: range };
    }),
    raw,
  };
}

const ascii = (dv, from, len) => {
  let str = '';
  for (let i = from; i < from + len && i < dv.byteLength; i++) {
    const c = dv.getUint8(i);
    if (c) str += String.fromCharCode(c);
  }
  return str.trim().replace(/\s+/g, ' ');
};
const hex = (v, n) => '0x' + v.toString(16).toUpperCase().padStart(n, '0');

export function parseFirmware(dv) {
  const update = dv.getUint16(44, true);
  return {
    buildDate: ascii(dv, 1, 11),
    buildTime: ascii(dv, 12, 8),
    fwType: dv.getUint16(20, true),
    swSeries: dv.getUint16(22, true),
    hwInfo: hex(dv.getUint32(24, true), 8),
    fwVersion: hex(dv.getUint32(28, true), 8),
    updateVersion: `${(update >> 8).toString(16)}.${(update & 0xff).toString(16).padStart(2, '0')}`,
    updateRaw: update,
    fwVersion1: hex(dv.getUint32(48, true), 8),
    fwVersion2: hex(dv.getUint32(52, true), 8),
    fwVersion3: hex(dv.getUint32(56, true), 8),
  };
}

const macAt = (dv, from) => {
  const parts = [];
  for (let i = from + 5; i >= from; i--) parts.push(dv.getUint8(i).toString(16).toUpperCase().padStart(2, '0'));
  return parts.join(':');
};

export function parsePairing(dv) {
  return { mac: macAt(dv, 1), host: dv.byteLength >= 16 ? macAt(dv, 10) : null };
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function fromHex(str) {
  const clean = str.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ' ').trim();
  if (!clean) return new Uint8Array();
  return Uint8Array.from(clean.split(/\s+/).flatMap((tok) => tok.match(/.{1,2}/g)).map((h) => parseInt(h, 16)));
}
