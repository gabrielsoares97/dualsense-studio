// Configuração completa do controle (é o que vai para os perfis).
import { buildEffect, defaultParams } from './triggers.js';
import { defaultMapping } from './mapping.js';
import { hexToRgb } from './ui.js';

const STORAGE_KEY = 'dualsense-studio:config';

export function defaultConfig() {
  return {
    version: 1,
    lights: { mode: 'static', color: '#2f6bff', color2: '#ff3d7f', brightness: 100, speed: 50 },
    player: { mask: 0b00100, fade: true, brightness: 0 },
    micLed: 0,
    triggers: {
      left: { mode: 'off', params: {} },
      right: { mode: 'off', params: {} },
    },
    triggerPower: 0,
    rumble: { power: 0, v2: 'auto' },
    audio: { outputPath: 'auto', speakerVol: 80, headphoneVol: 80, pregain: 2, speakerMute: false, headphoneMute: false, hapticMaster: 90 },
    mic: { volume: 64, select: 0, echo: false, noise: false, beamforming: false, inputPath: 0, mute: false, muteButtonToggles: true },
    power: { touch: false, motion: false, haptic: false, audio: false, hapticMute: false },
    hapticLpf: false,
    mapping: defaultMapping(),
  };
}

// Mescla profunda: chaves que faltam no perfil salvo vêm do padrão.
function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = k in base ? merge(base[k], extra[k]) : extra[k];
  }
  return out;
}

export function normalizeConfig(raw) {
  const cfg = merge(defaultConfig(), raw || {});
  for (const side of ['left', 'right']) {
    const t = cfg.triggers[side];
    t.params = { ...defaultParams(t.mode), ...(t.params || {}) };
  }
  return cfg;
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeConfig(null);
  }
}

let saveTimer;
export function saveLocal(cfg) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* armazenamento indisponível */ }
  }, 300);
}

export const speakerRaw = (pct) => (pct <= 0 ? 0 : Math.round(0x3d + ((0x64 - 0x3d) * pct) / 100));
export const headphoneRaw = (pct) => Math.round((0x7f * pct) / 100);

// Caminho de saída: 0 = fones estéreo, 1 = fones mono, 2 = fones (mono) + alto-falante, 3 = só alto-falante
export function resolveOutputPath(cfg, headphonesPlugged) {
  const p = cfg.audio.outputPath;
  if (p === 'auto') return headphonesPlugged ? 0 : 3;
  return Number(p);
}

// Empurra toda a configuração para o controle e para os motores de efeito.
export function applyConfig(app, cfg) {
  const { ds, lights, mapper, audio } = app;
  lights.set(cfg.lights);
  if (cfg.lights.mode === 'static') {
    const [r, g, b] = hexToRgb(cfg.lights.color).map((v) => Math.round((v * cfg.lights.brightness) / 100));
    ds.setLightbar(r, g, b);
  }
  ds.setPlayerLeds(cfg.player.mask, cfg.player.fade);
  ds.setLedBrightness(cfg.player.brightness);
  ds.setMicLed(cfg.micLed);
  ds.setTrigger('left', buildEffect(cfg.triggers.left.mode, cfg.triggers.left.params));
  ds.setTrigger('right', buildEffect(cfg.triggers.right.mode, cfg.triggers.right.params));
  ds.setMotorPower(cfg.triggerPower, cfg.rumble.power);
  if (cfg.rumble.v2 !== 'auto') ds.setRumbleV2(cfg.rumble.v2 === 'v2');
  ds.setSpeakerVolume(speakerRaw(cfg.audio.speakerVol));
  ds.setHeadphoneVolume(headphoneRaw(cfg.audio.headphoneVol));
  ds.setAudioControl2({ speakerPregain: cfg.audio.pregain, beamforming: cfg.mic.beamforming });
  ds.setMicVolume(cfg.mic.volume);
  ds.setAudioControl({
    micSelect: cfg.mic.select, echoCancel: cfg.mic.echo, noiseCancel: cfg.mic.noise,
    outputPath: resolveOutputPath(cfg, ds.state.plug.headphones), inputPath: cfg.mic.inputPath,
  });
  ds.setPower({ ...cfg.power, micMute: cfg.mic.mute, speakerMute: cfg.audio.speakerMute, headphoneMute: cfg.audio.headphoneMute });
  ds.setHapticLpf(cfg.hapticLpf);
  if (audio.ready) audio.setHapticMaster(cfg.audio.hapticMaster / 100);
  mapper.cfg = cfg.mapping;
}

// Copia uma configuração para dentro da atual sem trocar os objetos internos,
// assim as abas que guardam referências (ex.: cfg.lights) continuam válidas.
export function assignConfig(target, source) {
  for (const k of Object.keys(source)) {
    const s = source[k], t = target[k];
    if (s && typeof s === 'object' && !Array.isArray(s) && t && typeof t === 'object' && !Array.isArray(t)) assignConfig(t, s);
    else target[k] = Array.isArray(s) ? structuredClone(s) : s;
  }
  return target;
}
