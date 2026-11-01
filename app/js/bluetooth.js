// Detecta quando o controle está ligado por Bluetooth E pelo cabo ao mesmo tempo.
// Nessa situação o DualSense desliga a placa de som USB: hápticos HD, alto-falante e
// microfone ficam mudos (motores, gatilhos e luzes continuam funcionando).
// A solução é derrubar só o link Bluetooth; o pareamento continua salvo.

const AUTO_KEY = 'dualsense-studio:bt-auto';

export class BluetoothLink extends EventTarget {
  constructor(ds) {
    super();
    this.ds = ds;
    this.devices = [];
    this.available = true;
    this.busy = false;
    try { this.auto = localStorage.getItem(AUTO_KEY) === '1'; } catch { this.auto = false; }
    ds.addEventListener('connect', () => this.check());
    ds.addEventListener('disconnect', () => { this.devices = []; this._emit(); });
    // o controle pode voltar a se conectar sozinho pelo Bluetooth, então confere de tempos em tempos
    setInterval(() => { if (ds.connected && ds.transport === 'usb' && !document.hidden) this.check(); }, 15000);
  }

  setAuto(on) {
    this.auto = on;
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (on && this.conflict) this.disconnect();
  }

  // Link Bluetooth ativo deste mesmo controle enquanto ele também está no cabo.
  get conflict() {
    if (!this.ds.connected || this.ds.transport !== 'usb') return null;
    const mine = this.ds.pairing?.mac;
    return this.devices.find((d) => d.connected && (!mine || d.mac.toUpperCase() === mine.toUpperCase())) || null;
  }

  _emit() { this.dispatchEvent(new Event('change')); }

  async check() {
    if (this.busy) return;
    try {
      const r = await fetch('/api/bluetooth');
      if (!r.ok) throw new Error();
      this.devices = (await r.json()).devices || [];
      this.available = true;
    } catch {
      this.available = false;
    }
    this._emit();
    if (this.auto && this.conflict) await this.disconnect();
  }

  async disconnect() {
    const target = this.conflict;
    if (!target || this.busy) return false;
    this.busy = true;
    this._emit();
    try {
      const r = await fetch('/api/bluetooth/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac: target.mac }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      this.devices = j.devices || [];
      this.lastResult = j.result;
      return j.result === 'ok';
    } catch (e) {
      this.lastResult = e.message;
      return false;
    } finally {
      this.busy = false;
      this._emit();
    }
  }
}
