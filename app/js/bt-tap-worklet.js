// Roda na thread de áudio: junta 512 quadros (10,67 ms a 48 kHz) do barramento de 4 canais
// (1-2 alto-falante, 3-4 hápticos) e entrega à página, que monta os relatórios do Bluetooth.
// O relógio do áudio dita o ritmo, então o envio não depende de timers da página.
class DsBtTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 0;
    this.alloc();
  }

  alloc() {
    this.spk = new Float32Array(1024);
    this.hap = new Float32Array(1024);
  }

  process(inputs) {
    const inp = inputs[0] || [];
    const len = inp[0] ? inp[0].length : 128;
    const c0 = inp[0], c1 = inp[1], c2 = inp[2], c3 = inp[3];
    for (let i = 0; i < len; i++) {
      const j = (this.n + i) * 2;
      this.spk[j] = c0 ? c0[i] : 0;
      this.spk[j + 1] = c1 ? c1[i] : 0;
      this.hap[j] = c2 ? c2[i] : 0;
      this.hap[j + 1] = c3 ? c3[i] : 0;
    }
    this.n += len;
    if (this.n >= 512) {
      this.port.postMessage({ spk: this.spk, hap: this.hap }, [this.spk.buffer, this.hap.buffer]);
      this.alloc();
      this.n = 0;
    }
    return true;
  }
}

registerProcessor('ds-bt-tap', DsBtTap);
