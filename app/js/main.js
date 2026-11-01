import { DualSense } from './controller.js';
import { AudioEngine } from './audio.js';
import { LightEngine } from './lights.js';
import { BallSim } from './ball.js';
import { Mapper } from './mapping.js';
import { createBench } from './bench.js';
import { WindowsAudio } from './winaudio.js';
import { BluetoothLink } from './bluetooth.js';
import { loadLocal, saveLocal, applyConfig, resolveOutputPath } from './state.js';
import { BATTERY_STATUS } from './protocol.js';
import { h, button, toast } from './ui.js';

import inputs from './tabs/inputs.js';
import motion from './tabs/motion.js';
import triggers from './tabs/triggers.js';
import haptics from './tabs/haptics.js';
import lightsTab from './tabs/lights.js';
import audioTab from './tabs/audio.js';
import mic from './tabs/mic.js';
import pcmode from './tabs/pcmode.js';
import advanced from './tabs/advanced.js';
import info from './tabs/info.js';
import profiles from './tabs/profiles.js';

const TABS = [inputs, motion, triggers, haptics, lightsTab, audioTab, mic, pcmode, advanced, info, profiles];

const ds = new DualSense();
const audio = new AudioEngine(ds);
const lights = new LightEngine(ds, audio);
const ball = new BallSim(ds, audio);
const mapper = new Mapper(ds);

const winAudio = new WindowsAudio();
const btLink = new BluetoothLink(ds);

const app = {
  ds, audio, lights, ball, mapper, winAudio, btLink,
  cfg: loadLocal(),
  save() { saveLocal(this.cfg); },
  apply() { applyConfig(this, this.cfg); },
  toast,
  // abas avisam umas às outras quando a configuração muda por fora (ex.: carregar perfil)
  refreshers: new Set(),
  refreshAll() { this.refreshers.forEach((fn) => fn()); },
  async enableAudio() {
    const ok = await audio.init();
    winAudio.refresh();
    if (ok) { audio.setHapticMaster(this.cfg.audio.hapticMaster / 100); toast('Áudio do controle ativado'); }
    else toast(audio.error, 'error', 6000);
    renderSide();
    return ok;
  },
};
mapper.cfg = app.cfg.mapping;
window.dualsenseStudio = app; // útil para depuração no console

// ---------- tema ----------
const themeBtn = document.getElementById('theme-btn');
const savedTheme = (() => { try { return localStorage.getItem('dualsense-studio:theme'); } catch { return null; } })();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('dualsense-studio:theme', next); } catch { /* ignore */ }
});

// ---------- bancada (lado esquerdo) ----------
const bench = createBench();
document.getElementById('stage').append(bench.el);

const statusEl = document.getElementById('status');
const statusCells = {};
for (const [k, label] of [['conn', 'Conexão'], ['battery', 'Bateria'], ['rate', 'Relatórios'], ['audio', 'Áudio'], ['jack', 'Fone P2'], ['model', 'Modelo']]) {
  const v = h('span', { class: 'v' }, '—');
  statusEl.append(h('div', {}, h('span', { class: 'k' }, label), v));
  statusCells[k] = v;
}
const setCell = (k, text, cls = '') => {
  const c = statusCells[k];
  if (c.textContent !== text) c.textContent = text;
  if (c.className !== 'v ' + cls) c.className = 'v ' + cls;
};

const actions = document.getElementById('side-actions');
const note = document.getElementById('side-note');

// Aviso de conexão dupla (Bluetooth + cabo), que desliga o áudio USB do controle.
const btAlert = h('div', { class: 'side-alert', hidden: true });
note.after(btAlert);
function renderBtAlert() {
  const c = btLink.conflict;
  btAlert.hidden = !c && !btLink.busy;
  if (btAlert.hidden) return;
  const btn = button(btLink.busy ? 'Desconectando…' : 'Usar só o cabo', async () => {
    const ok = await btLink.disconnect();
    toast(ok ? 'Bluetooth desconectado. Hápticos, alto-falante e microfone liberados.' : 'Não foi possível desconectar: ' + btLink.lastResult, ok ? 'info' : 'error', 6000);
  }, { variant: 'primary small' });
  btn.disabled = btLink.busy;
  const auto = h('label', { class: 'side-check' }, h('input', { type: 'checkbox', checked: btLink.auto || null, onchange: (e) => btLink.setAuto(e.target.checked) }), 'Fazer isso sempre que eu ligar o cabo');
  btAlert.replaceChildren(
    h('p', {}, 'O controle também está conectado por Bluetooth. Com as duas conexões, ele desliga o som pelo cabo: hápticos HD, alto-falante e microfone ficam mudos. Use só o cabo, ou tire o cabo para usar tudo pelo Bluetooth.'),
    h('div', { class: 'row' }, btn), auto);
}
btLink.addEventListener('change', renderBtAlert);

function renderSide() {
  actions.replaceChildren();
  if (!DualSense.supported()) {
    note.textContent = 'Este navegador não tem WebHID. Abra pelo Chrome ou Edge usando "Iniciar DualSense Studio.bat".';
    return;
  }
  if (ds.connected) {
    actions.append(button('Desconectar', () => ds.disconnect()));
  } else {
    actions.append(button('Conectar controle', async () => {
      try {
        const ok = await ds.requestConnect();
        if (!ok && ds.lastError) toast('Não foi possível abrir o controle: ' + ds.lastError.message, 'error', 6000);
      } catch (e) {
        if (e.name !== 'NotFoundError') toast(e.message, 'error');
      }
    }, { variant: 'primary' }));
  }
  if (!audio.ready) actions.append(button('Ativar áudio e hápticos', () => app.enableAudio(), { variant: ds.connected ? 'primary' : '' }));
  note.textContent = ds.connected
    ? ''
    : 'Conecte o DualSense pelo cabo USB ou pelo Bluetooth e clique em "Conectar controle". Na janela que abrir, escolha "DualSense Wireless Controller".';
}

ds.addEventListener('connect', async () => {
  bench.setEdge(ds.model === 'DualSense Edge');
  app.apply();
  renderSide();
  app.refreshAll();
  toast(`${ds.model} conectado por ${ds.transport === 'usb' ? 'USB' : 'Bluetooth'}`);
  // o caminho do áudio muda entre cabo (placa de som) e Bluetooth (relatórios HID)
  const want = ds.transport === 'bt' ? 'bt' : 'usb';
  if (audio.ready && audio.mode !== want) {
    audio.shutdown();
    await app.enableAudio();
  }
});
ds.addEventListener('disconnect', () => {
  renderSide();
  toast('Controle desconectado');
  ball.stop();
});

// Botão de microfone alterna o mudo, como no PS5.
ds.addEventListener('buttondown', (e) => {
  if (e.detail !== 'mute' || !app.cfg.mic.muteButtonToggles) return;
  const m = app.cfg.mic;
  m.mute = !m.mute;
  ds.setPower({ micMute: m.mute });
  ds.setMicLed(m.mute ? 1 : app.cfg.micLed);
  app.save();
  app.refreshAll();
  toast(m.mute ? 'Microfone silenciado' : 'Microfone ativado');
});

// Caminho de áudio automático conforme o fone P2.
let lastPlug = null;
ds.addEventListener('input', () => {
  const p = ds.state.plug.headphones;
  if (p !== lastPlug) {
    lastPlug = p;
    if (app.cfg.audio.outputPath === 'auto') ds.setAudioControl({ outputPath: resolveOutputPath(app.cfg, p) });
  }
});

audio.addEventListener('error', () => renderSide());

// ---------- navegação ----------
const tabsNav = document.getElementById('tabs');
const main = document.getElementById('main');
const views = new Map();
let current = null;

function show(id) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  if (current?.view?.hide) current.view.hide();
  let view = views.get(tab.id);
  if (!view) {
    view = tab.build(app);
    views.set(tab.id, view);
  }
  main.replaceChildren(h('div', { class: 'view' },
    h('header', { class: 'view-head' }, h('h1', {}, tab.title), h('p', {}, tab.desc)),
    view.el));
  current = { tab, view };
  view.show?.();
  for (const b of tabsNav.children) {
    if (b.dataset.id === tab.id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  try { localStorage.setItem('dualsense-studio:tab', tab.id); } catch { /* ignore */ }
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}

const liveDots = {};
for (const t of TABS) {
  const dot = h('span', { class: 'live', 'aria-hidden': 'true' });
  liveDots[t.id] = dot;
  tabsNav.append(h('button', { type: 'button', 'data-id': t.id, onclick: () => show(t.id) }, t.label, dot));
}

// ---------- quadro a quadro ----------
let lastAccent = '';
function setAccent(r, g, b) {
  const m = Math.max(r, g, b);
  if (m < 20) { r = 120; g = 130; b = 150; } else { const k = 255 / m; r *= k; g *= k; b *= k; }
  // escurece um pouco cores muito claras para o texto continuar legível
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const key = `${r | 0} ${g | 0} ${b | 0}`;
  if (key === lastAccent) return;
  lastAccent = key;
  const root = document.documentElement.style;
  root.setProperty('--accent', `rgb(${key})`);
  root.setProperty('--accent-rgb', key);
  root.setProperty('--accent-ink', lum > 0.62 ? '#11151b' : '#fff');
}

function frame() {
  const st = ds.state;
  bench.update(st, ds.connected ? ds.out : null);
  if (ds.connected) {
    setAccent(ds.out.r, ds.out.g, ds.out.b);
    setCell('conn', ds.transport === 'usb' ? 'USB' : 'Bluetooth', 'good');
    const bs = st.battery.status;
    setCell('battery', st.full ? `${st.battery.level}%${bs === 1 ? ' carregando' : bs === 2 ? ' cheia' : ''}` : '—', bs > 2 ? 'bad' : '');
    statusCells.battery.title = BATTERY_STATUS[bs] || '';
    setCell('rate', `${ds.reportRate} Hz`);
    setCell('jack', st.plug.headphones ? (st.plug.mic ? 'Headset' : 'Fone') : 'Vazio');
    setCell('model', ds.model === 'DualSense Edge' ? 'Edge' : 'DualSense');
  } else {
    setCell('conn', 'Nenhuma', 'bad');
    for (const k of ['battery', 'rate', 'jack', 'model']) setCell(k, '—');
  }
  setCell('audio', audio.ready ? (audio.mode === 'bt' ? 'Bluetooth' : audio.hapticsAvailable ? 'USB 4 canais' : 'Estéreo') : 'Desligado', audio.ready ? 'good' : '');
  liveDots.haptics.classList.toggle('on', audio.ready && (audio._loops.size > 0 || !!audio.stream || ball.running));
  liveDots.pcmode.classList.toggle('on', mapper.enabled);
  liveDots.mic.classList.toggle('on', !!audio.mic);
  current?.view?.frame?.(st);
  requestAnimationFrame(frame);
}

renderSide();
winAudio.refresh();
navigator.mediaDevices?.addEventListener?.('devicechange', () => winAudio.refresh());
let initialTab = 'inputs';
try { initialTab = localStorage.getItem('dualsense-studio:tab') || 'inputs'; } catch { /* ignore */ }
show(initialTab);
requestAnimationFrame(frame);
ds.autoConnect().then(renderSide);
