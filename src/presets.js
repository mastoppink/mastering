export const DEFAULTS = {
  inputGain: 0,
  highpass: 30,
  lowShelf: { freq: 120, gain: 0 },
  lowMid: { freq: 300, gain: 0, q: 1.0 },
  presence: { freq: 3000, gain: 0, q: 1.0 },
  highShelf: { freq: 10000, gain: 0 },
  deesser: { enabled: false, freq: 7000, threshold: -28, amount: 6 },
  compressor: { threshold: -18, ratio: 2, attack: 0.015, release: 0.15, knee: 6, makeup: 0 },
  width: 100,
  reverb: { enabled: false, type: 'hall', decay: 2.0, mix: 0.1 },
  targetLufs: -16,
  ceiling: -1,
};

export const PRESETS = {
  murotal: {
    label: 'Murotal', highpass: 90,
    lowShelf: { freq: 120, gain: 0 }, lowMid: { freq: 300, gain: -3, q: 1.0 },
    presence: { freq: 3500, gain: 2, q: 1.0 }, highShelf: { freq: 10000, gain: 2 },
    deesser: { enabled: true, freq: 7000, threshold: -28, amount: 6 },
    compressor: { threshold: -18, ratio: 2.5, attack: 0.015, release: 0.15, knee: 6 },
    width: 100, reverb: { enabled: true, type: 'hall', decay: 2.5, mix: 0.15 },
    targetLufs: -16, ceiling: -1,
  },
  relaxing: {
    label: 'Musik Relaxing', highpass: 30,
    lowShelf: { freq: 120, gain: 1 }, lowMid: { freq: 300, gain: 0, q: 1.0 },
    presence: { freq: 2500, gain: -1, q: 0.8 }, highShelf: { freq: 12000, gain: 1 },
    deesser: { enabled: false },
    compressor: { threshold: -20, ratio: 1.5, attack: 0.03, release: 0.3, knee: 10 },
    width: 105, reverb: { enabled: true, type: 'hall', decay: 3.0, mix: 0.2 },
    targetLufs: -18, ceiling: -1,
  },
  narasi: {
    label: 'Narasi / Bercerita', highpass: 80,
    lowShelf: { freq: 120, gain: 0 }, lowMid: { freq: 250, gain: -3, q: 1.0 },
    presence: { freq: 3000, gain: 3, q: 1.0 }, highShelf: { freq: 8000, gain: 1.5 },
    deesser: { enabled: true, freq: 6000, threshold: -30, amount: 4 },
    compressor: { threshold: -20, ratio: 3, attack: 0.01, release: 0.12, knee: 4 },
    width: 100, reverb: { enabled: true, type: 'room', decay: 0.6, mix: 0.05 },
    targetLufs: -16, ceiling: -1,
  },
  musik: {
    label: 'Musik (Umum)', highpass: 25,
    lowShelf: { freq: 80, gain: 1.5 }, lowMid: { freq: 350, gain: -2, q: 1.0 },
    presence: { freq: 3000, gain: 1.5, q: 0.9 }, highShelf: { freq: 12000, gain: 2 },
    deesser: { enabled: true, freq: 7000, threshold: -24, amount: 2 },
    compressor: { threshold: -14, ratio: 2, attack: 0.03, release: 0.2, knee: 6 },
    width: 110, reverb: { enabled: false },
    targetLufs: -14, ceiling: -1,
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function merge(base, over) {
  const out = structuredClone(base);
  for (const k in over) {
    if (k === 'label') continue;
    out[k] = isObj(over[k]) && isObj(out[k]) ? merge(out[k], over[k]) : over[k];
  }
  return out;
}
export const presetParams = (key) => merge(DEFAULTS, PRESETS[key]);
