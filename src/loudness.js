// ITU-R BS.1770-4: K-weighting + gating (absolut -70 LUFS, relatif -10 LU).
function biquad(x, b, a) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function kCoeffs(fs) {
  // tahap 1: high shelf
  let G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.9744509555319;
  let A = Math.pow(10, G / 40), w = 2 * Math.PI * fc / fs, al = Math.sin(w) / (2 * Q), cs = Math.cos(w), sA = Math.sqrt(A);
  let a0 = (A + 1) - (A - 1) * cs + 2 * sA * al;
  const b1 = [A * ((A + 1) + (A - 1) * cs + 2 * sA * al) / a0, -2 * A * ((A - 1) + (A + 1) * cs) / a0, A * ((A + 1) + (A - 1) * cs - 2 * sA * al) / a0];
  const a1 = [1, 2 * ((A - 1) - (A + 1) * cs) / a0, ((A + 1) - (A - 1) * cs - 2 * sA * al) / a0];
  // tahap 2: high pass
  Q = 0.5003270373253953; fc = 38.13547087613982;
  w = 2 * Math.PI * fc / fs; al = Math.sin(w) / (2 * Q); cs = Math.cos(w); a0 = 1 + al;
  const b2 = [1, -2, 1];
  const a2 = [1, -2 * cs / a0, (1 - al) / a0];
  return { b1, a1, b2, a2 };
}
export function measureLufs(buffer) {
  const fs = buffer.sampleRate, k = kCoeffs(fs);
  const seg = Math.round(fs * 0.1);
  const nseg = Math.floor(buffer.length / seg);
  if (nseg < 4) return -Infinity;
  const segPow = new Float64Array(nseg);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const y = biquad(biquad(buffer.getChannelData(c), k.b1, k.a1), k.b2, k.a2);
    for (let s = 0; s < nseg; s++) {
      let sum = 0;
      for (let i = s * seg, e = i + seg; i < e; i++) sum += y[i] * y[i];
      segPow[s] += sum;
    }
  }
  const blocks = [];
  for (let s = 0; s + 4 <= nseg; s++) {
    const z = (segPow[s] + segPow[s + 1] + segPow[s + 2] + segPow[s + 3]) / (4 * seg);
    blocks.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => L(z) > -70);
  if (!abs.length) return -Infinity;
  const relThr = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter((z) => L(z) > relThr);
  if (!rel.length) return -Infinity;
  return L(rel.reduce((a, b) => a + b, 0) / rel.length);
}
export function samplePeakDb(buffer) {
  let p = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  }
  return 20 * Math.log10(p || 1e-12);
}
