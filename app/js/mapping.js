// Modo PC: usa o controle como mouse e teclado no Windows.
// O navegador não pode gerar cliques/teclas, então os comandos vão para o servidor local,
// que os repassa a um processo auxiliar (tools/input-helper.ps1, SendInput do Windows).

const VK = {
  Enter: 0x0d, Esc: 0x1b, Espaço: 0x20, Tab: 0x09, Backspace: 0x08, Shift: 0x10, Ctrl: 0x11, Alt: 0x12, Windows: 0x5b,
  '←': 0x25, '↑': 0x26, '→': 0x27, '↓': 0x28, Delete: 0x2e, Home: 0x24, End: 0x23, 'Page Up': 0x21, 'Page Down': 0x22,
  Insert: 0x2d, 'Print Screen': 0x2c,
};
const MEDIA = {
  'Tocar/pausar mídia': 0xb3, 'Próxima faixa': 0xb0, 'Faixa anterior': 0xb1, 'Parar mídia': 0xb2,
  'Aumentar volume': 0xaf, 'Diminuir volume': 0xae, 'Silenciar som': 0xad, 'Voltar (navegador)': 0xa6, 'Avançar (navegador)': 0xa7,
};
const COMBOS = {
  'Alt + Tab': [0x12, 0x09], 'Win + Tab': [0x5b, 0x09], 'Win + D (área de trabalho)': [0x5b, 0x44], 'Win + G (Game Bar)': [0x5b, 0x47],
  'Win + Shift + S (captura)': [0x5b, 0x10, 0x53], 'Alt + F4': [0x12, 0x73], 'Ctrl + C': [0x11, 0x43], 'Ctrl + V': [0x11, 0x56],
  'Ctrl + Z': [0x11, 0x5a], 'Ctrl + Tab': [0x11, 0x09], 'Ctrl + W': [0x11, 0x57],
};

export const ACTIONS = (() => {
  const list = [
    { value: 'none', label: 'Nada', group: 'Geral' },
    { value: 'mouse:l', label: 'Clique esquerdo', group: 'Mouse' },
    { value: 'mouse:r', label: 'Clique direito', group: 'Mouse' },
    { value: 'mouse:m', label: 'Clique do meio', group: 'Mouse' },
    { value: 'wheel:120', label: 'Rolar para cima', group: 'Mouse' },
    { value: 'wheel:-120', label: 'Rolar para baixo', group: 'Mouse' },
  ];
  for (const [n, v] of Object.entries(VK)) list.push({ value: 'key:' + v, label: n, group: 'Teclas' });
  for (let c = 0x41; c <= 0x5a; c++) list.push({ value: 'key:' + c, label: String.fromCharCode(c), group: 'Letras' });
  for (let d = 0; d <= 9; d++) list.push({ value: 'key:' + (0x30 + d), label: String(d), group: 'Números' });
  for (let f = 1; f <= 12; f++) list.push({ value: 'key:' + (0x6f + f), label: 'F' + f, group: 'Funções' });
  for (const [n, v] of Object.entries(MEDIA)) list.push({ value: 'key:' + v, label: n, group: 'Mídia' });
  for (const [n, v] of Object.entries(COMBOS)) list.push({ value: 'key:' + v.join('+'), label: n, group: 'Atalhos' });
  return list;
})();

export const BUTTON_NAMES = {
  cross: 'Cruz (✕)', circle: 'Círculo (○)', square: 'Quadrado (□)', triangle: 'Triângulo (△)',
  up: 'Direcional ↑', down: 'Direcional ↓', left: 'Direcional ←', right: 'Direcional →',
  l1: 'L1', r1: 'R1', l2: 'L2 (apertado)', r2: 'R2 (apertado)', l3: 'L3 (clique do analógico)', r3: 'R3 (clique do analógico)',
  create: 'Create', options: 'Options', ps: 'Botão PS', touchpad: 'Clique do touchpad', mute: 'Botão de microfone',
  fnL: 'Fn esquerdo (Edge)', fnR: 'Fn direito (Edge)', paddleL: 'Pá traseira esquerda (Edge)', paddleR: 'Pá traseira direita (Edge)',
};

export function defaultMapping() {
  return {
    buttons: {
      cross: 'mouse:l', square: 'mouse:r', circle: 'key:27', triangle: 'key:91',
      up: 'key:38', down: 'key:40', left: 'key:37', right: 'key:39',
      l1: 'key:166', r1: 'key:167', l2: 'none', r2: 'none', l3: 'mouse:m', r3: 'none',
      create: 'key:91+68', options: 'key:13', ps: 'none', touchpad: 'mouse:l', mute: 'none',
      fnL: 'none', fnR: 'none', paddleL: 'none', paddleR: 'none',
    },
    touchpad: { mouse: true, sensitivity: 1, twoFingerRightClick: true, twoFingerScroll: true },
    gyro: { enabled: false, sensitivity: 14, activation: 'r1', invertX: false, invertY: false },
    leftStick: { mode: 'mouse', speed: 1100, deadzone: 0.12 },
    rightStick: { mode: 'scroll', speed: 1100, deadzone: 0.12 },
  };
}

export class Mapper extends EventTarget {
  constructor(ds) {
    super();
    this.ds = ds;
    this.cfg = defaultMapping(); // substituído pelo objeto da configuração em applyConfig
    this.enabled = false; // estado da sessão, não vai para o perfil
    this.token = null;
    this.held = new Set(); // ações seguradas no momento (para soltar tudo ao desligar)
    this.acc = { x: 0, y: 0, wheel: 0, hwheel: 0 };
    this.queue = [];
    this.inflight = false;
    this.status = 'off';
    this.lastTouch = null;
    this.stickKeys = { left: new Set(), right: new Set() };
    this._last = 0;
    ds.addEventListener('input', () => this._onInput());
    ds.addEventListener('buttondown', (e) => this._onButton(e.detail, true));
    ds.addEventListener('buttonup', (e) => this._onButton(e.detail, false));
    ds.addEventListener('disconnect', () => this.releaseAll());
  }

  async setEnabled(on) {
    if (on) {
      try {
        const r = await fetch('/api/input/start', { method: 'POST' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'falha ao iniciar');
        this.token = j.token;
        this.enabled = true;
        this._setStatus('on');
      } catch (e) {
        this.enabled = false;
        this._setStatus('error', 'O servidor local não respondeu. Abra o DualSense Studio pelo arquivo "Iniciar DualSense Studio.bat". (' + e.message + ')');
      }
    } else {
      this.releaseAll();
      this.enabled = false;
      this._setStatus('off');
    }
  }

  _setStatus(s, msg = '') {
    this.status = s;
    this.dispatchEvent(new CustomEvent('status', { detail: { status: s, message: msg } }));
  }

  _push(line) {
    this.queue.push(line);
    this._pump();
  }

  // Envia assim que possível, sem timers (continua funcionando com a janela em segundo plano).
  _pump() {
    if (this.inflight || !this.token) return;
    const ax = Math.trunc(this.acc.x), ay = Math.trunc(this.acc.y);
    if (ax || ay) { this.queue.push(`m ${ax} ${ay}`); this.acc.x -= ax; this.acc.y -= ay; }
    const w = Math.trunc(this.acc.wheel);
    if (Math.abs(w) >= 10) { this.queue.push(`w ${w}`); this.acc.wheel -= w; }
    const hw = Math.trunc(this.acc.hwheel);
    if (Math.abs(hw) >= 10) { this.queue.push(`hw ${hw}`); this.acc.hwheel -= hw; }
    if (!this.queue.length) return;
    const body = this.queue.join('\n');
    this.queue = [];
    this.inflight = true;
    fetch('/api/input', { method: 'POST', headers: { 'X-DS-Token': this.token, 'Content-Type': 'text/plain' }, body })
      .then((r) => { if (r.status === 401 || r.status === 409) this.token = null; })
      .catch(() => { /* servidor fechado */ })
      .finally(() => { this.inflight = false; if (this.queue.length) this._pump(); });
  }

  _action(action, down) {
    if (!action || action === 'none') return;
    const [kind, arg] = action.split(':');
    if (kind === 'mouse') this._push(`${down ? 'md' : 'mu'} ${arg}`);
    else if (kind === 'wheel') { if (down) this._push(`w ${arg}`); }
    else if (kind === 'key') {
      const keys = arg.split('+');
      if (down) keys.forEach((k) => this._push(`kd ${k}`));
      else [...keys].reverse().forEach((k) => this._push(`ku ${k}`));
    }
    if (kind !== 'wheel') { if (down) this.held.add(action); else this.held.delete(action); }
  }

  releaseAll() {
    for (const a of [...this.held]) this._action(a, false);
    this.held.clear();
    for (const side of ['left', 'right']) { for (const k of this.stickKeys[side]) this._push(`ku ${k}`); this.stickKeys[side].clear(); }
  }

  _onButton(name, down) {
    if (!this.enabled) return;
    if (name === 'touchpad' && this.cfg.touchpad.twoFingerRightClick) {
      const fingers = this.ds.state.touch.filter((t) => t.active).length;
      if (down && fingers >= 2) { this._touchAction = 'mouse:r'; this._action('mouse:r', true); return; }
      if (!down && this._touchAction) { this._action(this._touchAction, false); this._touchAction = null; return; }
    }
    this._action(this.cfg.buttons[name], down);
  }

  _stick(x, y, cfg, side, dt) {
    const mag = Math.hypot(x, y);
    if (cfg.mode === 'wasd' || cfg.mode === 'arrows') {
      const keys = cfg.mode === 'wasd' ? { up: 0x57, down: 0x53, left: 0x41, right: 0x44 } : { up: 0x26, down: 0x28, left: 0x25, right: 0x27 };
      const want = new Set();
      if (y < -0.5) want.add(keys.up); if (y > 0.5) want.add(keys.down);
      if (x < -0.5) want.add(keys.left); if (x > 0.5) want.add(keys.right);
      const cur = this.stickKeys[side];
      for (const k of cur) if (!want.has(k)) { this._push(`ku ${k}`); cur.delete(k); }
      for (const k of want) if (!cur.has(k)) { this._push(`kd ${k}`); cur.add(k); }
      return;
    }
    if (mag < cfg.deadzone) return;
    const k = Math.pow((mag - cfg.deadzone) / (1 - cfg.deadzone), 2) / mag;
    if (cfg.mode === 'mouse') { this.acc.x += x * k * cfg.speed * dt; this.acc.y += y * k * cfg.speed * dt; }
    else if (cfg.mode === 'scroll') { this.acc.wheel += -y * k * cfg.speed * dt; this.acc.hwheel += x * k * cfg.speed * dt; }
  }

  _onInput() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._last || now)) / 1000);
    this._last = now;
    if (!this.enabled || !this.token) return;
    const s = this.ds.state, c = this.cfg;

    // touchpad
    const fingers = s.touch.filter((t) => t.active);
    if (c.touchpad.mouse && fingers.length) {
      const f = fingers[0];
      const key = fingers.length + ':' + f.id;
      if (this.lastTouch && this.lastTouch.key === key) {
        const dx = f.x - this.lastTouch.x, dy = f.y - this.lastTouch.y;
        if (fingers.length >= 2 && c.touchpad.twoFingerScroll) { this.acc.wheel += -dy * 2.2 * c.touchpad.sensitivity; this.acc.hwheel += dx * 2.2 * c.touchpad.sensitivity; }
        else if (fingers.length === 1) { this.acc.x += dx * 0.75 * c.touchpad.sensitivity; this.acc.y += dy * 0.75 * c.touchpad.sensitivity; }
      }
      this.lastTouch = { key, x: f.x, y: f.y };
    } else this.lastTouch = null;

    // giroscópio
    const g = c.gyro;
    if (g.enabled) {
      const b = s.buttons;
      const active = g.activation === 'always' || (g.activation === 'r1' && b.r1) || (g.activation === 'l1' && b.l1)
        || (g.activation === 'l2' && s.l2 > 40) || (g.activation === 'r2' && s.r2 > 40) || (g.activation === 'touch' && fingers.length > 0);
      if (active) {
        const yaw = s.gyro[1], pitch = s.gyro[0];
        const soft = (v) => (Math.abs(v) < 0.8 ? v * (Math.abs(v) / 0.8) : v); // reduz tremor
        this.acc.x += -soft(yaw) * g.sensitivity * dt * (g.invertX ? -1 : 1);
        this.acc.y += -soft(pitch) * g.sensitivity * dt * (g.invertY ? -1 : 1);
      }
    }

    const n = (v) => (v - 128) / 127;
    this._stick(n(s.lx), n(s.ly), c.leftStick, 'left', dt);
    this._stick(n(s.rx), n(s.ry), c.rightStick, 'right', dt);
    this._pump();
  }
}
