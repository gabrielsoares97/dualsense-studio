// Padrões hápticos HD. Cada padrão agenda pulsos no AudioEngine.
// Em loop, fn(t) devolve a duração do ciclo; nos únicos, devolve o instante final.

const R = (a, b) => a + Math.random() * (b - a);

function step(a, t, pan, { lowpass = 400, grains = 7, spread = 0.11, amp = 0.55 } = {}) {
  for (let i = 0; i < grains; i++) {
    a.grain({ at: t + (i / grains) * spread + R(0, 0.01), dur: R(0.012, 0.03), amp: amp * R(0.6, 1) * (1 - i / (grains * 1.4)), pan, lowpass: lowpass * R(0.8, 1.2) });
  }
}

// Varredura de panorama com pulsos curtos sobrepostos (dá a sensação de algo se movendo dentro do controle).
function sweep(a, t, from, to, dur, { freq = 42, amp = 0.8, grainAmp = 0.35, lowpass = 140 } = {}) {
  const n = Math.round(dur / 0.03);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const pan = from + (to - from) * k;
    a.pulse({ at: t + i * 0.03, freq, dur: 0.06, amp: amp * Math.sin(Math.PI * Math.min(1, k * 1.2 + 0.1)), pan, attack: 0.02, release: 0.03 });
    if (Math.random() < 0.6) a.grain({ at: t + i * 0.03 + R(0, 0.02), dur: 0.02, amp: grainAmp * R(0.5, 1), pan, lowpass });
  }
}

export const HAPTIC_PRESETS = [
  { id: 'heartbeat', name: 'Batimento cardíaco', loop: true, fn: (t, a) => {
    a.pulse({ at: t, freq: 55, dur: 0.1, amp: 1, release: 0.07 });
    a.pulse({ at: t + 0.2, freq: 45, dur: 0.12, amp: 0.7, release: 0.09 });
    return 0.95;
  } },
  { id: 'heartfast', name: 'Coração acelerado', loop: true, fn: (t, a) => {
    a.pulse({ at: t, freq: 60, dur: 0.07, amp: 1, release: 0.05 });
    a.pulse({ at: t + 0.13, freq: 50, dur: 0.08, amp: 0.75, release: 0.06 });
    return 0.42;
  } },
  { id: 'rain', name: 'Chuva', loop: true, fn: (t, a) => {
    for (let i = 0; i < 10; i++) a.grain({ at: t + R(0, 0.5), dur: R(0.008, 0.025), amp: R(0.15, 0.6), pan: R(-1, 1), lowpass: R(250, 650) });
    return 0.5;
  } },
  { id: 'storm', name: 'Tempestade', loop: true, fn: (t, a) => {
    for (let i = 0; i < 26; i++) a.grain({ at: t + R(0, 1), dur: R(0.01, 0.03), amp: R(0.3, 0.8), pan: R(-1, 1), lowpass: R(300, 700) });
    if (Math.random() < 0.2) a.pulse({ at: t + R(0, 0.8), wave: 'noise', dur: R(1.2, 2.2), amp: 1, lowpass: [320, 35], attack: 0.04, release: 1.3, pan: R(-0.5, 0.5) });
    return 1;
  } },
  { id: 'waves', name: 'Ondas do mar', loop: true, fn: (t, a) => {
    a.pulse({ at: t, wave: 'noise', lowpass: [90, 320], dur: 3, amp: 0.75, attack: 1.7, release: 1.2, pan: -0.6 });
    a.pulse({ at: t + 3, wave: 'noise', lowpass: [90, 320], dur: 3, amp: 0.75, attack: 1.7, release: 1.2, pan: 0.6 });
    return 6;
  } },
  { id: 'rolling', name: 'Bola pesada rolando', loop: true, fn: (t, a) => {
    sweep(a, t, -1, 1, 1.5);
    a.pulse({ at: t + 1.5, freq: 50, freqEnd: 30, dur: 0.18, amp: 1, pan: 1, release: 0.15 });
    sweep(a, t + 2, 1, -1, 1.5);
    a.pulse({ at: t + 3.5, freq: 50, freqEnd: 30, dur: 0.18, amp: 1, pan: -1, release: 0.15 });
    return 4;
  } },
  { id: 'marble', name: 'Bolinha de gude', loop: true, fn: (t, a) => {
    sweep(a, t, -1, 1, 0.9, { freq: 160, amp: 0.25, grainAmp: 0.5, lowpass: 900 });
    a.pulse({ at: t + 0.9, freq: 260, dur: 0.03, amp: 0.9, pan: 1, release: 0.025 });
    sweep(a, t + 1.2, 1, -1, 0.9, { freq: 160, amp: 0.25, grainAmp: 0.5, lowpass: 900 });
    a.pulse({ at: t + 2.1, freq: 260, dur: 0.03, amp: 0.9, pan: -1, release: 0.025 });
    return 2.4;
  } },
  { id: 'steps-grass', name: 'Passos na grama', loop: true, fn: (t, a) => {
    step(a, t, -0.8); step(a, t + 0.5, 0.8);
    return 1;
  } },
  { id: 'steps-sand', name: 'Passos na areia', loop: true, fn: (t, a) => {
    step(a, t, -0.8, { lowpass: 160, grains: 12, spread: 0.2, amp: 0.7 });
    step(a, t + 0.55, 0.8, { lowpass: 160, grains: 12, spread: 0.2, amp: 0.7 });
    return 1.1;
  } },
  { id: 'steps-metal', name: 'Passos no metal', loop: true, fn: (t, a) => {
    a.pulse({ at: t, freq: 190, dur: 0.09, amp: 0.8, pan: -0.8, release: 0.08 });
    a.grain({ at: t, dur: 0.02, amp: 0.6, pan: -0.8, lowpass: 900 });
    a.pulse({ at: t + 0.5, freq: 175, dur: 0.09, amp: 0.8, pan: 0.8, release: 0.08 });
    a.grain({ at: t + 0.5, dur: 0.02, amp: 0.6, pan: 0.8, lowpass: 900 });
    return 1;
  } },
  { id: 'clock', name: 'Relógio', loop: true, fn: (t, a) => {
    a.pulse({ at: t, wave: 'square', freq: 320, dur: 0.015, amp: 0.7, pan: -1, attack: 0.001, release: 0.01 });
    a.pulse({ at: t + 0.5, wave: 'square', freq: 250, dur: 0.015, amp: 0.7, pan: 1, attack: 0.001, release: 0.01 });
    return 1;
  } },
  { id: 'engine', name: 'Motor em marcha lenta', loop: true, fn: (t, a) => {
    for (let k = 0; k < 5; k++) a.pulse({ at: t + k * 0.04, wave: 'sawtooth', freq: R(28, 34), dur: 0.036, amp: R(0.45, 0.75), lowpass: 170, attack: 0.003, release: 0.02 });
    return 0.2;
  } },
  { id: 'purr', name: 'Gato ronronando', loop: true, fn: (t, a) => {
    const n = 30;
    for (let k = 0; k < n; k++) a.grain({ at: t + k / 26, dur: 0.03, amp: 0.65 * Math.sin((Math.PI * (k + 0.5)) / n), lowpass: 110 });
    return 1.35;
  } },
  { id: 'quake', name: 'Terremoto', loop: true, fn: (t, a) => {
    for (let k = 0; k < 4; k++) a.pulse({ at: t + k * 0.12, wave: 'noise', dur: 0.3, amp: R(0.4, 1), lowpass: 60, pan: R(-0.6, 0.6), attack: 0.05, release: 0.2 });
    a.pulse({ at: t, freq: R(18, 30), dur: 0.5, amp: R(0.3, 0.7), attack: 0.1, release: 0.2 });
    return 0.48;
  } },
  { id: 'pingpong', name: 'Pingue-pongue', loop: true, fn: (t, a) => {
    a.pulse({ at: t, freq: 210, dur: 0.03, amp: 0.9, pan: -1, release: 0.025 });
    a.pulse({ at: t + 0.45, freq: 210, dur: 0.03, amp: 0.9, pan: 1, release: 0.025 });
    return 0.9;
  } },
  { id: 'bubbles', name: 'Bolhas', loop: true, fn: (t, a) => {
    for (let i = 0; i < 4; i++) { const f = R(70, 120); a.pulse({ at: t + R(0, 0.4), freq: f, freqEnd: f * 2.4, dur: 0.05, amp: R(0.4, 0.8), pan: R(-1, 1), release: 0.03 }); }
    return 0.4;
  } },
  { id: 'explosion', name: 'Explosão', loop: false, fn: (t, a) => {
    a.pulse({ at: t, wave: 'noise', dur: 1.8, amp: 1, lowpass: [700, 35], attack: 0.004, release: 1.6 });
    a.pulse({ at: t, freq: 42, freqEnd: 20, dur: 1.2, amp: 1, release: 1 });
    return t + 1.8;
  } },
  { id: 'gunshot', name: 'Tiro', loop: false, fn: (t, a) => {
    a.pulse({ at: t, wave: 'noise', dur: 0.05, amp: 1, lowpass: 1000, attack: 0.001, release: 0.04 });
    a.pulse({ at: t, freq: 75, freqEnd: 35, dur: 0.2, amp: 1, attack: 0.001, release: 0.17 });
    return t + 0.2;
  } },
  { id: 'burst', name: 'Rajada', loop: false, fn: (t, a) => {
    for (let i = 0; i < 10; i++) {
      a.pulse({ at: t + i * 0.08, wave: 'noise', dur: 0.04, amp: 0.9, lowpass: 900, attack: 0.001, release: 0.03, pan: R(-0.3, 0.3) });
      a.pulse({ at: t + i * 0.08, freq: 70, freqEnd: 40, dur: 0.07, amp: 0.8, attack: 0.001, release: 0.06 });
    }
    return t + 0.85;
  } },
  { id: 'sword', name: 'Espadas se chocando', loop: false, fn: (t, a) => {
    a.pulse({ at: t, freq: 240, dur: 0.25, amp: 0.8, attack: 0.001, release: 0.24 });
    a.pulse({ at: t, freq: 330, dur: 0.18, amp: 0.5, attack: 0.001, release: 0.17 });
    a.grain({ at: t, dur: 0.03, amp: 1, lowpass: 1200 });
    return t + 0.3;
  } },
  { id: 'bounce', name: 'Bola quicando', loop: false, fn: (t, a) => {
    let at = t, gap = 0.55, amp = 1;
    for (let i = 0; i < 9; i++) {
      a.pulse({ at, freq: 60, freqEnd: 35, dur: 0.08, amp, attack: 0.001, release: 0.07 });
      at += gap; gap *= 0.7; amp *= 0.75;
    }
    return at;
  } },
  { id: 'dice', name: 'Dados rolando', loop: false, fn: (t, a) => {
    let at = t;
    for (let i = 0; i < 18; i++) {
      const pan = -1 + (2 * i) / 17;
      a.pulse({ at, freq: R(180, 260), dur: 0.02, amp: R(0.5, 1) * (1 - i / 24), pan, attack: 0.001, release: 0.015 });
      at += 0.03 + i * 0.006 + R(0, 0.02);
    }
    return at;
  } },
  { id: 'shock', name: 'Choque elétrico', loop: false, fn: (t, a) => {
    for (let k = 0; k < 16; k++) a.pulse({ at: t + k * 0.05, wave: 'square', freq: 110, dur: R(0.02, 0.05), amp: R(0.4, 1), pan: R(-1, 1), attack: 0.002, release: 0.01 });
    return t + 0.85;
  } },
  { id: 'notify', name: 'Notificação', loop: false, fn: (t, a) => {
    a.pulse({ at: t, freq: 210, dur: 0.05, amp: 0.8, release: 0.04 });
    a.pulse({ at: t + 0.12, freq: 210, dur: 0.05, amp: 0.8, release: 0.04 });
    return t + 0.2;
  } },
  { id: 'success', name: 'Confirmação', loop: false, fn: (t, a) => {
    [150, 200, 260].forEach((f, i) => a.pulse({ at: t + i * 0.09, freq: f, dur: 0.06, amp: 0.8, release: 0.04 }));
    return t + 0.3;
  } },
  { id: 'error', name: 'Erro', loop: false, fn: (t, a) => {
    a.pulse({ at: t, wave: 'square', freq: 90, dur: 0.12, amp: 0.8, release: 0.03 });
    a.pulse({ at: t + 0.18, wave: 'square', freq: 90, dur: 0.12, amp: 0.8, release: 0.03 });
    return t + 0.32;
  } },
  { id: 'countdown', name: 'Contagem regressiva', loop: false, fn: (t, a) => {
    for (let i = 0; i < 3; i++) a.pulse({ at: t + i, freq: 180, dur: 0.06, amp: 0.8, release: 0.04 });
    a.pulse({ at: t + 3, freq: 60, dur: 0.8, amp: 1, release: 0.3 });
    return t + 3.8;
  } },
];

// Texturas para sentir arrastando o dedo no touchpad.
// spacing = distância em pixels do touchpad entre "grãos"; o resto define o grão.
export const TEXTURES = [
  { id: 'wood', name: 'Madeira', spacing: 70, grain: { kind: 'pulse', freq: 140, dur: 0.018, amp: 0.7 } },
  { id: 'gravel', name: 'Cascalho', spacing: 35, grain: { kind: 'grain', lowpass: 500, dur: 0.02, amp: 0.8, jitter: 0.6 } },
  { id: 'sand', name: 'Lixa / areia', spacing: 10, grain: { kind: 'grain', lowpass: 900, dur: 0.008, amp: 0.45, jitter: 0.5 } },
  { id: 'ribbed', name: 'Ondulado', spacing: 120, grain: { kind: 'pulse', freq: 70, dur: 0.05, amp: 1 } },
  { id: 'fabric', name: 'Tecido', spacing: 6, grain: { kind: 'grain', lowpass: 250, dur: 0.01, amp: 0.25, jitter: 0.3 } },
  { id: 'ice', name: 'Gelo', spacing: 220, grain: { kind: 'pulse', freq: 300, dur: 0.012, amp: 0.35 } },
  { id: 'zipper', name: 'Zíper', spacing: 18, grain: { kind: 'pulse', freq: 230, dur: 0.01, amp: 0.8 } },
];
