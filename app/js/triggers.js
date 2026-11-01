// Efeitos dos gatilhos adaptativos (L2/R2).
// Cada efeito gera 11 bytes: [modo, 10 parâmetros]. O curso do gatilho é dividido em 10 zonas (0-9).
// Codificação baseada no TriggerEffectGenerator de Nielk1 (engenharia reversa do firmware).

export const MODE = {
  OFF: 0x05, FEEDBACK: 0x21, WEAPON: 0x25, VIBRATION: 0x26,
  BOW: 0x22, GALLOPING: 0x23, MACHINE: 0x27,
  SIMPLE_FEEDBACK: 0x01, SIMPLE_WEAPON: 0x02, SIMPLE_VIBRATION: 0x06,
  LIMITED_FEEDBACK: 0x11, LIMITED_WEAPON: 0x12,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

function packZones(mode, values, extra = {}) {
  // values: 10 valores 0..8 (0 = zona inativa). Força/amplitude salva como (v-1) em 3 bits por zona.
  let active = 0;
  let zones = 0; // até 30 bits, cabe em Number com segurança
  for (let i = 0; i < 10; i++) {
    const v = clamp(values[i], 0, 8);
    if (v > 0) {
      active |= 1 << i;
      zones += ((v - 1) & 7) * 2 ** (3 * i);
    }
  }
  const b = new Uint8Array(11);
  if (!active) { b[0] = MODE.OFF; return b; }
  b[0] = mode;
  b[1] = active & 0xff; b[2] = (active >> 8) & 0xff;
  b[3] = zones % 256; b[4] = Math.floor(zones / 2 ** 8) % 256;
  b[5] = Math.floor(zones / 2 ** 16) % 256; b[6] = Math.floor(zones / 2 ** 24) % 256;
  if (extra.b9 != null) b[9] = extra.b9;
  if (extra.b10 != null) b[10] = extra.b10;
  return b;
}

const startStop = (start, end) => (1 << start) | (1 << end);

export const effects = {
  off() {
    const b = new Uint8Array(11); b[0] = MODE.OFF; return b;
  },
  // Resistência contínua a partir de uma posição.
  feedback({ position = 0, strength = 8 }) {
    position = clamp(position, 0, 9); strength = clamp(strength, 0, 8);
    const v = Array.from({ length: 10 }, (_, i) => (i >= position ? strength : 0));
    return packZones(MODE.FEEDBACK, v);
  },
  // Resistência diferente em cada zona.
  zones({ strengths = [] }) {
    return packZones(MODE.FEEDBACK, strengths);
  },
  // Resistência que cresce/diminui linearmente entre duas posições.
  slope({ start = 0, end = 9, startStrength = 1, endStrength = 8 }) {
    start = clamp(start, 0, 8); end = clamp(end, start + 1, 9);
    startStrength = clamp(startStrength, 1, 8); endStrength = clamp(endStrength, 1, 8);
    const v = new Array(10).fill(0);
    const slope = (endStrength - startStrength) / (end - start);
    for (let i = start; i < 10; i++) v[i] = i <= end ? Math.round(startStrength + slope * (i - start)) : endStrength;
    return packZones(MODE.FEEDBACK, v);
  },
  // Gatilho de arma: resiste entre início e fim e "estala" ao passar do ponto de ruptura.
  weapon({ start = 2, end = 5, strength = 8 }) {
    start = clamp(start, 2, 7); end = clamp(end, start + 1, 8); strength = clamp(strength, 0, 8);
    if (!strength) return effects.off();
    const b = new Uint8Array(11), z = startStop(start, end);
    b[0] = MODE.WEAPON; b[1] = z & 0xff; b[2] = z >> 8; b[3] = strength - 1;
    return b;
  },
  // Arco: resistência que aumenta e depois "solta" com força de retorno.
  bow({ start = 1, end = 6, strength = 6, snap = 8 }) {
    start = clamp(start, 0, 7); end = clamp(end, start + 1, 8);
    strength = clamp(strength, 0, 8); snap = clamp(snap, 0, 8);
    if (!strength || !snap) return effects.off();
    const b = new Uint8Array(11), z = startStop(start, end);
    const pair = ((strength - 1) & 7) | (((snap - 1) & 7) << 3);
    b[0] = MODE.BOW; b[1] = z & 0xff; b[2] = z >> 8; b[3] = pair & 0xff; b[4] = pair >> 8;
    return b;
  },
  // Galope: dois "cascos" batendo em ciclo dentro da faixa.
  galloping({ start = 0, end = 9, firstFoot = 2, secondFoot = 5, frequency = 4 }) {
    start = clamp(start, 0, 8); end = clamp(end, start + 1, 9);
    firstFoot = clamp(firstFoot, 0, 6); secondFoot = clamp(secondFoot, firstFoot + 1, 7);
    frequency = clamp(frequency, 1, 255);
    const b = new Uint8Array(11), z = startStop(start, end);
    const ratio = (secondFoot & 7) | ((firstFoot & 7) << 3);
    b[0] = MODE.GALLOPING; b[1] = z & 0xff; b[2] = z >> 8; b[3] = ratio; b[4] = frequency;
    return b;
  },
  // Vibração a partir de uma posição.
  vibration({ position = 0, amplitude = 8, frequency = 30 }) {
    position = clamp(position, 0, 9); amplitude = clamp(amplitude, 0, 8); frequency = clamp(frequency, 0, 255);
    if (!amplitude || !frequency) return effects.off();
    const v = Array.from({ length: 10 }, (_, i) => (i >= position ? amplitude : 0));
    return packZones(MODE.VIBRATION, v, { b9: frequency });
  },
  // Vibração com amplitude diferente em cada zona.
  vibrationZones({ amplitudes = [], frequency = 30 }) {
    frequency = clamp(frequency, 1, 255);
    return packZones(MODE.VIBRATION, amplitudes, { b9: frequency });
  },
  // Máquina: alterna entre duas amplitudes com frequência e período.
  machine({ start = 1, end = 9, amplitudeA = 1, amplitudeB = 7, frequency = 5, period = 3 }) {
    start = clamp(start, 0, 8); end = clamp(end, start + 1, 9);
    amplitudeA = clamp(amplitudeA, 0, 7); amplitudeB = clamp(amplitudeB, 0, 7);
    frequency = clamp(frequency, 1, 255); period = clamp(period, 0, 255);
    const b = new Uint8Array(11), z = startStop(start, end);
    const pair = (amplitudeA & 7) | ((amplitudeB & 7) << 3);
    b[0] = MODE.MACHINE; b[1] = z & 0xff; b[2] = z >> 8; b[3] = pair; b[4] = frequency; b[5] = period;
    return b;
  },
  // Modos antigos do firmware, com parâmetros diretos (sem zonas).
  simpleFeedback({ start = 0x40, strength = 0xa0 }) {
    const b = new Uint8Array(11); b[0] = MODE.SIMPLE_FEEDBACK; b[1] = clamp(start, 0, 255); b[2] = clamp(strength, 0, 255); return b;
  },
  simpleWeapon({ start = 0x40, end = 0xa0, strength = 0xff }) {
    const b = new Uint8Array(11); b[0] = MODE.SIMPLE_WEAPON; b[1] = clamp(start, 0, 255); b[2] = clamp(end, 0, 255); b[3] = clamp(strength, 0, 255); return b;
  },
  simpleVibration({ frequency = 30, strength = 0xff, start = 0 }) {
    const b = new Uint8Array(11); b[0] = MODE.SIMPLE_VIBRATION; b[1] = clamp(frequency, 0, 255); b[2] = clamp(strength, 0, 255); b[3] = clamp(start, 0, 255); return b;
  },
  raw({ bytes = [0x05] }) {
    const b = new Uint8Array(11);
    for (let i = 0; i < 11 && i < bytes.length; i++) b[i] = clamp(bytes[i], 0, 255);
    return b;
  },
};

// Definição dos parâmetros de cada modo para a interface.
const P = (key, label, min, max, def, extra = {}) => ({ key, label, min, max, def, ...extra });
export const MODES = [
  { id: 'off', name: 'Desligado', desc: 'Gatilho livre, sem resistência.', params: [] },
  { id: 'feedback', name: 'Resistência', desc: 'Resistência constante a partir de um ponto do curso.', params: [
    P('position', 'Começa na zona', 0, 9, 2), P('strength', 'Força', 1, 8, 6)] },
  { id: 'slope', name: 'Rampa', desc: 'A resistência muda gradualmente ao longo do curso, como uma mola.', params: [
    P('start', 'Zona inicial', 0, 8, 0), P('end', 'Zona final', 1, 9, 9),
    P('startStrength', 'Força inicial', 1, 8, 1), P('endStrength', 'Força final', 1, 8, 8)] },
  { id: 'zones', name: 'Zonas livres', desc: 'Desenhe a força de cada uma das 10 zonas do curso.', params: [], zones: 'strengths' },
  { id: 'weapon', name: 'Arma', desc: 'Resistência até o ponto de ruptura e depois um estalo, como um gatilho de verdade.', params: [
    P('start', 'Começa na zona', 2, 7, 3), P('end', 'Ruptura na zona', 3, 8, 6), P('strength', 'Força', 1, 8, 8)] },
  { id: 'bow', name: 'Arco', desc: 'Tensão crescente como uma corda de arco, que empurra de volta ao soltar.', params: [
    P('start', 'Começa na zona', 0, 7, 1), P('end', 'Termina na zona', 1, 8, 6),
    P('strength', 'Tensão', 1, 8, 6), P('snap', 'Retorno', 1, 8, 8)] },
  { id: 'galloping', name: 'Galope', desc: 'Batidas ritmadas como os cascos de um cavalo.', params: [
    P('start', 'Começa na zona', 0, 8, 0), P('end', 'Termina na zona', 1, 9, 9),
    P('firstFoot', 'Primeira batida', 0, 6, 2), P('secondFoot', 'Segunda batida', 1, 7, 5),
    P('frequency', 'Ritmo (Hz)', 1, 40, 4)] },
  { id: 'vibration', name: 'Vibração', desc: 'O gatilho vibra a partir de um ponto do curso.', params: [
    P('position', 'Começa na zona', 0, 9, 0), P('amplitude', 'Intensidade', 1, 8, 6), P('frequency', 'Frequência (Hz)', 1, 255, 30)] },
  { id: 'vibrationZones', name: 'Vibração por zonas', desc: 'Intensidade de vibração diferente em cada zona.', params: [
    P('frequency', 'Frequência (Hz)', 1, 255, 40)], zones: 'amplitudes' },
  { id: 'machine', name: 'Máquina', desc: 'Alterna entre duas intensidades, como um motor ou uma metralhadora.', params: [
    P('start', 'Começa na zona', 0, 8, 1), P('end', 'Termina na zona', 1, 9, 9),
    P('amplitudeA', 'Intensidade A', 0, 7, 1), P('amplitudeB', 'Intensidade B', 0, 7, 7),
    P('frequency', 'Frequência (Hz)', 1, 255, 5), P('period', 'Período', 0, 255, 3)] },
  { id: 'simpleFeedback', name: 'Resistência simples (legado)', desc: 'Modo antigo do firmware com valores diretos de 0 a 255.', params: [
    P('start', 'Início', 0, 255, 64), P('strength', 'Força', 0, 255, 160)] },
  { id: 'simpleWeapon', name: 'Arma simples (legado)', desc: 'Modo antigo de arma com início, fim e força de 0 a 255.', params: [
    P('start', 'Início', 0, 255, 64), P('end', 'Fim', 0, 255, 160), P('strength', 'Força', 0, 255, 255)] },
  { id: 'simpleVibration', name: 'Vibração simples (legado)', desc: 'Modo antigo de vibração com valores diretos.', params: [
    P('frequency', 'Frequência', 0, 255, 30), P('strength', 'Intensidade', 0, 255, 255), P('start', 'Início', 0, 255, 0)] },
  { id: 'raw', name: 'Bytes manuais', desc: 'Envie os 11 bytes do efeito diretamente (modo + 10 parâmetros), para experimentar.', params: [], raw: true },
];

export function defaultParams(modeId) {
  const m = MODES.find((x) => x.id === modeId) || MODES[0];
  const p = {};
  for (const d of m.params) p[d.key] = d.def;
  if (m.zones === 'strengths') p.strengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  if (m.zones === 'amplitudes') p.amplitudes = [0, 0, 2, 4, 6, 8, 6, 4, 2, 0];
  if (m.raw) p.bytes = [0x21, 0xfe, 0x03, 0xf8, 0xff, 0xff, 0x3f, 0, 0, 0, 0];
  return p;
}

export function buildEffect(modeId, params) {
  const fn = effects[modeId] || effects.off;
  return fn(params || {});
}

// Força (0..8) aproximada por zona, só para desenhar a visualização.
export function zoneProfile(modeId, p) {
  const z = new Array(10).fill(0);
  const fill = (from, to, v) => { for (let i = from; i <= to && i < 10; i++) z[i] = v; };
  switch (modeId) {
    case 'feedback': fill(p.position, 9, p.strength); break;
    case 'zones': for (let i = 0; i < 10; i++) z[i] = p.strengths?.[i] || 0; break;
    case 'slope': {
      const s = (p.endStrength - p.startStrength) / Math.max(1, p.end - p.start);
      for (let i = p.start; i < 10; i++) z[i] = i <= p.end ? p.startStrength + s * (i - p.start) : p.endStrength;
      break;
    }
    case 'weapon': fill(p.start, p.end, p.strength); break;
    case 'bow': for (let i = p.start; i <= p.end; i++) z[i] = (p.strength * (i - p.start + 1)) / (p.end - p.start + 1); break;
    case 'galloping': fill(p.start, p.end, 3); break;
    case 'vibration': fill(p.position, 9, p.amplitude); break;
    case 'vibrationZones': for (let i = 0; i < 10; i++) z[i] = p.amplitudes?.[i] || 0; break;
    case 'machine': fill(p.start, p.end, Math.max(p.amplitudeA, p.amplitudeB) + 1); break;
    case 'simpleFeedback': fill(Math.floor((p.start / 256) * 10), 9, (p.strength / 255) * 8); break;
    case 'simpleWeapon': fill(Math.floor((p.start / 256) * 10), Math.floor((p.end / 256) * 10), (p.strength / 255) * 8); break;
    case 'simpleVibration': fill(Math.floor((p.start / 256) * 10), 9, (p.strength / 255) * 8); break;
    default: break;
  }
  return z;
}

export const KIND = { feedback: 'force', zones: 'force', slope: 'force', weapon: 'force', bow: 'force', simpleFeedback: 'force', simpleWeapon: 'force',
  galloping: 'vibe', vibration: 'vibe', vibrationZones: 'vibe', machine: 'vibe', simpleVibration: 'vibe' };

// Status reportado pelo controle (nibble alto do byte de status), por efeito ativo.
export function describeStatus(effect, status) {
  const map = {
    1: ['Sem carga', 'Aplicando resistência'],
    2: ['Pronto', 'Disparando', 'Disparado'],
    3: ['Parado', 'Vibrando'],
  };
  if (!effect) return 'Sem efeito';
  return (map[effect] && map[effect][status]) || `Estado ${status}`;
}
export const EFFECT_NAMES = { 0: 'Nenhum', 1: 'Resistência', 2: 'Arma', 3: 'Vibração' };

export const PRESETS = [
  { name: 'Arco e flecha', mode: 'bow', params: { start: 1, end: 7, strength: 7, snap: 8 } },
  { name: 'Pistola', mode: 'weapon', params: { start: 4, end: 6, strength: 7 } },
  { name: 'Espingarda', mode: 'weapon', params: { start: 2, end: 7, strength: 8 } },
  { name: 'Metralhadora', mode: 'machine', params: { start: 2, end: 9, amplitudeA: 3, amplitudeB: 7, frequency: 11, period: 2 } },
  { name: 'Rifle automático', mode: 'vibration', params: { position: 3, amplitude: 8, frequency: 18 } },
  { name: 'Freio ABS', mode: 'vibration', params: { position: 4, amplitude: 6, frequency: 60 } },
  { name: 'Acelerador', mode: 'slope', params: { start: 0, end: 9, startStrength: 1, endStrength: 5 } },
  { name: 'Mola dura', mode: 'slope', params: { start: 0, end: 9, startStrength: 2, endStrength: 8 } },
  { name: 'Travado', mode: 'feedback', params: { position: 0, strength: 8 } },
  { name: 'Areia movediça', mode: 'zones', params: { strengths: [1, 2, 2, 3, 4, 5, 5, 6, 7, 8] } },
  { name: 'Degraus', mode: 'zones', params: { strengths: [2, 0, 5, 0, 8, 0, 5, 0, 2, 0] } },
  { name: 'Cavalo galopando', mode: 'galloping', params: { start: 0, end: 9, firstFoot: 2, secondFoot: 5, frequency: 5 } },
  { name: 'Motor ligado', mode: 'vibrationZones', params: { frequency: 35, amplitudes: [3, 3, 4, 4, 5, 5, 6, 6, 7, 8] } },
  { name: 'Batimento', mode: 'machine', params: { start: 0, end: 9, amplitudeA: 0, amplitudeB: 6, frequency: 2, period: 5 } },
  { name: 'Corda de violão', mode: 'weapon', params: { start: 5, end: 6, strength: 3 } },
  { name: 'Pedal de bicicleta', mode: 'galloping', params: { start: 2, end: 8, firstFoot: 3, secondFoot: 6, frequency: 2 } },
];
