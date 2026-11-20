// Impulse response sintetis: noise stereo yang meluruh eksponensial.
const cache = new Map();
const TYPES = {
  room: { pre: 0.005, damp: 0.6, density: 1.0 },
  hall: { pre: 0.02, damp: 0.35, density: 1.0 },
  plate: { pre: 0.0, damp: 0.15, density: 1.0 },
};
export function makeImpulse(ctx, type = 'hall', decay = 2) {
  const sr = ctx.sampleRate;
  const key = `${type}|${decay}|${sr}`;
  const t = TYPES[type] || TYPES.hall;
  let data = cache.get(key);
  if (!data) {
    const len = Math.max(1, Math.floor(sr * (decay + t.pre)));
    const pre = Math.floor(sr * t.pre);
    data = [new Float32Array(len), new Float32Array(len)];
    for (let c = 0; c < 2; c++) {
      const d = data[c];
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const tt = (i - pre) / sr;
        const env = Math.exp((-6.9 * tt) / decay);
        // redaman frekuensi tinggi makin kuat seiring waktu
        const a = Math.min(0.97, t.damp * (tt / decay) * 1.5);
        lp = a * lp + (1 - a) * (Math.random() * 2 - 1);
        d[i] = lp * env;
      }
    }
    cache.clear();
    cache.set(key, data);
  }
  const buf = ctx.createBuffer(2, data[0].length, sr);
  buf.copyToChannel(data[0], 0);
  buf.copyToChannel(data[1], 1);
  return buf;
}
