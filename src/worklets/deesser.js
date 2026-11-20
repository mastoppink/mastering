// De-esser split-band: band sibilan (bandpass) dideteksi; saat melewati threshold,
// sebagian band itu dikurangi dari sinyal asli (tanpa delay -> fase tetap rapat).
class DeEsser extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.p = Object.assign({ enabled: true, freq: 7000, threshold: -28, amount: 6 }, opts.processorOptions || {});
    this.s = [new Float64Array(4), new Float64Array(4)];
    this.env = 0;
    this.att = Math.exp(-1 / (0.001 * sampleRate));
    this.rel = Math.exp(-1 / (0.06 * sampleRate));
    this.calc();
    this.port.onmessage = (e) => { Object.assign(this.p, e.data); this.calc(); };
  }
  calc() {
    const f = Math.min(this.p.freq, sampleRate * 0.45);
    const w = 2 * Math.PI * f / sampleRate, al = Math.sin(w) / (2 * 1.4), a0 = 1 + al;
    this.c = [al / a0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0];
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = out[0].length, nc = out.length;
    const get = (c) => inp[Math.min(c, inp.length - 1)];
    if (!this.p.enabled || this.p.amount <= 0) {
      for (let c = 0; c < nc; c++) out[c].set(get(c));
      return true;
    }
    const [b0, b2, a1, a2] = this.c, thr = this.p.threshold, amt = this.p.amount;
    const bp = [0, 0];
    for (let i = 0; i < n; i++) {
      let det = 0;
      for (let c = 0; c < nc; c++) {
        const s = this.s[c], x = get(c)[i];
        const y = b0 * x + b2 * s[1] - a1 * s[2] - a2 * s[3];
        s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y;
        bp[c] = y;
        const a = Math.abs(y); if (a > det) det = a;
      }
      const k = det > this.env ? this.att : this.rel;
      this.env = k * this.env + (1 - k) * det;
      const over = 20 * Math.log10(this.env + 1e-12) - thr;
      const red = over > 0 ? Math.min(amt, over * 0.75) : 0;
      const g = Math.pow(10, -red / 20);
      for (let c = 0; c < nc; c++) out[c][i] = get(c)[i] - bp[c] * (1 - g);
    }
    return true;
  }
}
registerProcessor('deesser', DeEsser);
