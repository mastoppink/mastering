// Brickwall limiter lookahead: min-filter + release + box-smoothing, sinyal ditunda L-1 sampel.
// Menjamin |out| <= ceiling (sample peak).
class Limiter extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions || {};
    this.ceil = Math.pow(10, (o.ceiling ?? -1) / 20);
    this.relC = 1 - Math.exp(-1 / ((o.release ?? 0.08) * sampleRate));
    const L = this.L = Math.max(2, Math.round((o.lookahead ?? 0.003) * sampleRate));
    this.dl = [new Float32Array(L), new Float32Array(L)]; this.dp = 0;
    this.qi = new Float64Array(L + 2); this.qv = new Float64Array(L + 2);
    this.qh = 0; this.qt = 0; this.qn = 0; this.cap = L + 2;
    this.box = new Float64Array(L).fill(1); this.bp = 0; this.bsum = L;
    this.g = 1; this.idx = 0;
    this.port.onmessage = (e) => { if (e.data.ceiling != null) this.ceil = Math.pow(10, e.data.ceiling / 20); };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const n = out[0].length, L = this.L, cap = this.cap;
    const x0 = inp && inp[0], x1 = inp && (inp[1] || inp[0]);
    for (let i = 0; i < n; i++) {
      const a = x0 ? x0[i] : 0, b = x1 ? x1[i] : 0;
      const pk = Math.max(Math.abs(a), Math.abs(b));
      const raw = pk > this.ceil ? this.ceil / pk : 1;
      const idx = this.idx++;
      // deque minimum geser
      while (this.qn > 0) {
        const back = (this.qt - 1 + cap) % cap;
        if (this.qv[back] >= raw) { this.qt = back; this.qn--; } else break;
      }
      this.qi[this.qt] = idx; this.qv[this.qt] = raw; this.qt = (this.qt + 1) % cap; this.qn++;
      while (this.qi[this.qh] <= idx - L) { this.qh = (this.qh + 1) % cap; this.qn--; }
      const m = this.qv[this.qh];
      this.g = Math.min(m, this.g + (1 - this.g) * this.relC);
      this.bsum += this.g - this.box[this.bp]; this.box[this.bp] = this.g; this.bp = (this.bp + 1) % L;
      const gain = Math.min(1, this.bsum / L);
      // delay L-1: ambil sampel tertua, tulis yang baru
      const rp = this.dp;
      this.dl[0][rp] = a; this.dl[1][rp] = b;
      const op = (rp + 1) % L;
      this.dp = op;
      let ya = this.dl[0][op] * gain, yb = this.dl[1][op] * gain;
      // pengaman akhir terhadap galat pembulatan
      if (ya > this.ceil) ya = this.ceil; else if (ya < -this.ceil) ya = -this.ceil;
      if (yb > this.ceil) yb = this.ceil; else if (yb < -this.ceil) yb = -this.ceil;
      out[0][i] = ya; if (out[1]) out[1][i] = yb;
    }
    return true;
  }
}
registerProcessor('limiter', Limiter);
