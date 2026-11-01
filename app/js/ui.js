// Pequenos construtores de interface (sem framework).

export function h(tag, props = {}, ...children) {
  const el = document.createElementNS(tag === 'svg' || props?.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let uid = 0;
const nextId = () => 'f' + ++uid;

export function slider({ label, min = 0, max = 100, step = 1, value = 0, format = (v) => v, onInput, onChange, hint, disabled }) {
  const id = nextId();
  const out = h('output', { for: id }, format(value));
  const input = h('input', { type: 'range', id, min, max, step, value, disabled });
  const wrap = h('div', { class: 'field slider' },
    h('div', { class: 'field-head' }, h('label', { for: id }, label), out),
    input,
    hint && h('p', { class: 'hint' }, hint));
  const fill = () => input.style.setProperty('--p', ((Number(input.value) - min) / (max - min || 1)) * 100 + '%');
  input.addEventListener('input', () => { out.textContent = format(Number(input.value)); fill(); onInput?.(Number(input.value)); });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  fill();
  wrap.set = (v) => { input.value = v; out.textContent = format(Number(input.value)); fill(); };
  wrap.get = () => Number(input.value);
  wrap.setRange = (lo, hi) => { min = lo; max = hi; input.min = lo; input.max = hi; fill(); };
  wrap.input = input;
  return wrap;
}

export function toggle({ label, value = false, onChange, hint }) {
  const id = nextId();
  const input = h('input', { type: 'checkbox', id, role: 'switch' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange?.(input.checked));
  const wrap = h('div', { class: 'field toggle' },
    h('label', { for: id }, input, h('span', { class: 'switch', 'aria-hidden': 'true' }), h('span', { class: 'toggle-text' }, label)),
    hint && h('p', { class: 'hint' }, hint));
  wrap.set = (v) => { input.checked = !!v; };
  wrap.get = () => input.checked;
  wrap.input = input;
  return wrap;
}

export function segmented({ label, options, value, onChange, hint, small }) {
  const name = nextId();
  const group = h('div', { class: 'seg' + (small ? ' seg-small' : ''), role: 'radiogroup', 'aria-label': label || name });
  const inputs = options.map((o) => {
    const id = nextId();
    const input = h('input', { type: 'radio', name, id, value: String(o.value) });
    input.checked = String(o.value) === String(value);
    input.addEventListener('change', () => input.checked && onChange?.(o.value));
    group.append(input, h('label', { for: id, title: o.title }, o.label));
    return input;
  });
  const wrap = h('div', { class: 'field' }, label && h('div', { class: 'field-head' }, h('span', { class: 'label' }, label)), group, hint && h('p', { class: 'hint' }, hint));
  wrap.set = (v) => inputs.forEach((i) => { i.checked = i.value === String(v); });
  return wrap;
}

export function select({ label, options, value, onChange, hint }) {
  const id = nextId();
  const sel = h('select', { id }, options.map((o) => h('option', { value: String(o.value) }, o.label)));
  sel.value = String(value);
  sel.addEventListener('change', () => {
    const o = options.find((x) => String(x.value) === sel.value);
    onChange?.(o ? o.value : sel.value);
  });
  const wrap = h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('label', { for: id }, label)), sel, hint && h('p', { class: 'hint' }, hint));
  wrap.set = (v) => { sel.value = String(v); };
  wrap.el = sel;
  return wrap;
}

export function button(label, onClick, { variant = '', title, pressed } = {}) {
  const b = h('button', { type: 'button', class: 'btn ' + variant, title }, label);
  if (pressed != null) b.setAttribute('aria-pressed', String(!!pressed));
  b.addEventListener('click', (e) => onClick?.(e, b));
  return b;
}

export function block(title, desc, ...children) {
  return h('section', { class: 'block' },
    h('header', { class: 'block-head' }, h('h2', {}, title), desc && h('p', {}, desc)),
    ...children);
}

export function row(...children) { return h('div', { class: 'row' }, ...children); }
export function grid(cls, ...children) { return h('div', { class: 'grid ' + (cls || '') }, ...children); }

export function readout(label, value = '—') {
  const v = h('span', { class: 'ro-value' }, value);
  const el = h('div', { class: 'ro' }, h('span', { class: 'ro-label' }, label), v);
  el.set = (x) => { if (v.textContent !== String(x)) v.textContent = x; };
  return el;
}

export function notice(text, kind = 'info') {
  const el = h('div', { class: 'notice ' + kind, role: kind === 'error' ? 'alert' : 'status' }, text);
  el.set = (t, k = kind) => { el.textContent = t; el.className = 'notice ' + k; el.hidden = !t; };
  if (!text) el.hidden = true;
  return el;
}

let toastBox;
export function toast(msg, kind = 'info', ms = 3200) {
  toastBox ||= document.body.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' }));
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// Canvas que acompanha o tamanho do elemento e a densidade de pixels.
export function canvas(cls, aspect) {
  const c = h('canvas', { class: cls });
  if (aspect) c.style.aspectRatio = String(aspect);
  const ro = new ResizeObserver(() => {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    c.dpr = dpr;
  });
  ro.observe(c);
  return c;
}

export function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// Cores do tema para desenhar em canvas (com cache curto, já que o destaque muda ao vivo).
let palCache = null, palAt = 0;
export function palette() {
  const now = performance.now();
  if (!palCache || now - palAt > 400) {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    palCache = {
      ink: g('--ink'), ink2: g('--ink-2'), line: g('--line'), line2: g('--line-2'), paper: g('--paper'),
      shell2: g('--shell-2'), accent: g('--accent'), accentRgb: g('--accent-rgb'), core: g('--core'),
      tri: g('--tri'), cir: g('--cir'), cro: g('--cro'), squ: g('--squ'), font: g('--display'),
    };
    palAt = now;
  }
  return palCache;
}

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export function hsv(hDeg, s, v) {
  const f = (n) => { const k = (n + hDeg / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
