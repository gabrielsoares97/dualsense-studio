// Volume que o Windows aplica aos dispositivos de som do DualSense.
// Se a saída estiver em 0% ou muda, os hápticos HD e o alto-falante não tocam.
import { h, slider, toggle, button } from './ui.js';

export class WindowsAudio extends EventTarget {
  constructor() { super(); this.items = null; this.error = null; this.busy = false; }
  get render() { return this.items?.find((i) => i.flow === 'render') || null; }
  get capture() { return this.items?.find((i) => i.flow === 'capture') || null; }

  async refresh() {
    try {
      const r = await fetch('/api/windows-audio');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      this.items = j; this.error = null;
    } catch (e) {
      this.error = e.message;
    }
    this.dispatchEvent(new Event('change'));
  }

  async set(flow, patch) {
    this.busy = true;
    try {
      const r = await fetch('/api/windows-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow, ...patch }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      this.items = j; this.error = null;
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false;
      this.dispatchEvent(new Event('change'));
    }
  }
}

// Painel compacto: avisa quando o volume do Windows bloqueia o som e permite ajustar.
export function windowsAudioPanel(app, flow) {
  const wa = app.winAudio;
  const isRender = flow === 'render';
  const warn = h('div', { class: 'notice warn', hidden: true });
  const fix = button(isRender ? 'Ajustar para 100%' : 'Ativar e ajustar para 100%', () => wa.set(flow, { volume: 100, mute: false }), { variant: 'primary small' });
  const vol = slider({
    label: isRender ? 'Volume do Windows para o DualSense' : 'Volume do Windows para o microfone do DualSense',
    min: 0, max: 100, value: 0, format: (v) => `${v}%`,
    onChange: (v) => wa.set(flow, { volume: v }),
  });
  const mute = toggle({ label: 'Mudo no Windows', onChange: (v) => wa.set(flow, { mute: v }) });
  const el = h('div', { class: 'stack' }, warn, h('div', { class: 'grid two' }, vol, mute));
  const render = () => {
    // pelo Bluetooth o som não passa pelo mixer do Windows
    el.hidden = app.audio.mode === 'bt' || (app.ds.connected && app.ds.transport === 'bt');
    const it = isRender ? wa.render : wa.capture;
    if (wa.error && !wa.items) {
      warn.hidden = false;
      warn.className = 'notice';
      warn.replaceChildren('Não foi possível ler o volume do Windows (o programa precisa ser aberto pelo "Iniciar DualSense Studio.bat").');
      vol.hidden = mute.hidden = true;
      return;
    }
    if (!it) { warn.hidden = true; vol.hidden = mute.hidden = true; return; }
    vol.hidden = mute.hidden = false;
    vol.set(it.volume);
    mute.set(it.mute);
    const blocked = it.mute || it.volume < (isRender ? 100 : 30);
    warn.hidden = !blocked;
    warn.className = 'notice warn';
    if (blocked) {
      warn.replaceChildren(
        h('span', {}, isRender
          ? `O Windows está enviando o som para o DualSense com volume ${it.mute ? 'mudo' : it.volume + '%'}. Os hápticos HD saem por esse mesmo canal, então ficam ${it.volume === 0 || it.mute ? 'desligados' : 'fracos'}. O volume do alto-falante continua controlado separadamente aqui no programa.`
          : `O Windows está capturando o microfone do DualSense com volume ${it.mute ? 'mudo' : it.volume + '%'}.`),
        fix);
    }
  };
  wa.addEventListener('change', render);
  app.audio.addEventListener('ready', render);
  app.ds.addEventListener('connect', render);
  render();
  return el;
}
