import { PRESETS, presetParams } from './presets.js';
import { buildChain, loadWorklets, renderOffline } from './chain.js';
import { measureLufs, samplePeakDb } from './loudness.js';
import { encodeWav } from './wav.js';

const $ = (id) => document.getElementById(id);
const dbToGain = (d) => Math.pow(10, d / 20);

// [path, label, min, max, step, unit, log?]
const SECTIONS = [
  { title: 'Input', items: [['inputGain', 'Input gain', -24, 24, 0.5, 'dB']] },
  { title: 'High-pass', items: [['highpass', 'Frekuensi', 20, 400, 1, 'Hz', true]] },
  { title: 'EQ 4 band', items: [
    ['lowShelf.freq', 'Low shelf · frek', 40, 400, 1, 'Hz', true], ['lowShelf.gain', 'Low shelf · gain', -12, 12, 0.5, 'dB'],
    ['lowMid.freq', 'Low-mid · frek', 100, 1000, 1, 'Hz', true], ['lowMid.gain', 'Low-mid · gain', -12, 12, 0.5, 'dB'], ['lowMid.q', 'Low-mid · Q', 0.3, 4, 0.1, ''],
    ['presence.freq', 'Presence · frek', 1000, 8000, 10, 'Hz', true], ['presence.gain', 'Presence · gain', -12, 12, 0.5, 'dB'], ['presence.q', 'Presence · Q', 0.3, 4, 0.1, ''],
    ['highShelf.freq', 'High shelf · frek', 4000, 16000, 10, 'Hz', true], ['highShelf.gain', 'High shelf · gain', -12, 12, 0.5, 'dB'],
  ] },
  { title: 'De-esser', toggle: 'deesser.enabled', items: [
    ['deesser.freq', 'Frekuensi', 3000, 12000, 50, 'Hz', true], ['deesser.threshold', 'Threshold', -60, 0, 1, 'dB'], ['deesser.amount', 'Reduksi maks', 0, 12, 0.5, 'dB'],
  ] },
  { title: 'Compressor', items: [
    ['compressor.threshold', 'Threshold', -60, 0, 0.5, 'dB'], ['compressor.ratio', 'Ratio', 1, 20, 0.1, ':1'],
    ['compressor.attack', 'Attack', 0.001, 0.2, 0.001, 's'], ['compressor.release', 'Release', 0.02, 1, 0.01, 's'],
    ['compressor.knee', 'Knee', 0, 40, 1, 'dB'], ['compressor.makeup', 'Makeup', 0, 18, 0.5, 'dB'],
  ] },
  { title: 'Stereo width', items: [['width', 'Lebar', 0, 200, 1, '%']] },
  { title: 'Reverb', toggle: 'reverb.enabled', select: ['reverb.type', 'Tipe', { room: 'Room', hall: 'Hall', plate: 'Plate' }], items: [
    ['reverb.decay', 'Decay', 0.2, 6, 0.1, 's'], ['reverb.mix', 'Mix', 0, 0.6, 0.01, ''],
  ] },
  { title: 'Output', items: [['targetLufs', 'Target LUFS', -24, -8, 0.5, 'LUFS'], ['ceiling', 'Ceiling', -6, 0, 0.1, 'dBFS']] },
];

const getP = (o, path) => path.split('.').reduce((a, k) => a[k], o);
const setP = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

const S = {
  params: presetParams('murotal'), ctx: null, buffer: null, name: 'audio',
  chain: null, src: null, wetG: null, dryG: null, master: null, analyser: null,
  playing: false, startAt: 0, offset: 0, mode: 'B',
  origLufs: null, procLufs: null, normDb: 0, analysisValid: false, analysisToken: 0,
};
const inputs = {};

// ---------- UI kontrol ----------
function fmt(v, unit) {
  if (unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : Math.round(v) + ' Hz';
  if (unit === 's') return v < 0.1 ? (v * 1000).toFixed(0) + ' ms' : v.toFixed(2) + ' s';
  if (unit === ':1') return v.toFixed(1) + ':1';
  if (unit === '') return Number(v).toFixed(2);
  return (+v).toFixed(1) + ' ' + unit;
}
const toSlider = (v, min, max, log) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
const fromSlider = (s, min, max, step, log) => {
  let v = log ? min * Math.pow(max / min, s / 1000) : +s;
  return Math.round(v / step) * step;
};

function buildControls() {
  const host = $('controls');
  for (const sec of SECTIONS) {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    if (sec.toggle) {
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.onchange = () => { setP(S.params, sec.toggle, cb.checked); fs.classList.toggle('off', !cb.checked); onParam(); };
      inputs[sec.toggle] = { el: cb, fs, kind: 'check' };
      lg.append(cb);
    }
    lg.append(sec.title); fs.append(lg);
    if (sec.select) {
      const [path, label, opts] = sec.select;
      const d = document.createElement('div'); d.className = 'row';
      const l = document.createElement('label'); l.textContent = label;
      const s = document.createElement('select');
      for (const k in opts) s.add(new Option(opts[k], k));
      s.onchange = () => { setP(S.params, path, s.value); onParam(); };
      inputs[path] = { el: s, kind: 'select' };
      d.append(l, s); fs.append(d);
    }
    for (const [path, label, min, max, step, unit, log] of sec.items) {
      const d = document.createElement('div'); d.className = 'ctl';
      const id = 'c_' + path.replace('.', '_');
      const l = document.createElement('label'); l.textContent = label; l.htmlFor = id;
      const out = document.createElement('output');
      const r = document.createElement('input'); r.type = 'range'; r.id = id;
      r.min = log ? 0 : min; r.max = log ? 1000 : max; r.step = log ? 1 : step;
      r.oninput = () => {
        const v = fromSlider(r.value, min, max, step, log);
        setP(S.params, path, v); out.textContent = fmt(v, unit); onParam();
      };
      inputs[path] = { el: r, out, kind: 'range', min, max, unit, log };
      d.append(l, out, r); fs.append(d);
    }
    host.append(fs);
  }
}

function syncControls() {
  for (const path in inputs) {
    const c = inputs[path], v = getP(S.params, path);
    if (c.kind === 'check') { c.el.checked = !!v; c.fs.classList.toggle('off', !v); }
    else if (c.kind === 'select') c.el.value = v;
    else { c.el.value = toSlider(v, c.min, c.max, c.log); c.out.textContent = fmt(v, c.unit); }
  }
}

function initPresets() {
  const sel = $('preset');
  for (const k in PRESETS) sel.add(new Option(PRESETS[k].label, k));
  sel.onchange = () => { S.params = presetParams(sel.value); syncControls(); onParam(); };
}

// ---------- Audio ----------
function onParam() {
  S.analysisValid = false;
  if (S.chain) S.chain.update(S.params, S.normDb);
  scheduleAnalysis();
  updateStats();
}

async function ensureCtx() {
  if (S.ctx) return S.ctx;
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
  S.ctx = ctx;
  await loadWorklets(ctx);
  S.master = new GainNode(ctx);
  S.analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  S.wetG = new GainNode(ctx); S.dryG = new GainNode(ctx, { gain: 0 });
  S.chain = buildChain(ctx, S.params, S.normDb);
  S.chain.output.connect(S.wetG);
  S.wetG.connect(S.master); S.dryG.connect(S.master);
  S.master.connect(S.analyser); S.analyser.connect(ctx.destination);
  return ctx;
}

function toStereo(ctx, buf) {
  if (buf.numberOfChannels === 2) return buf;
  const out = ctx.createBuffer(2, buf.length, buf.sampleRate);
  out.copyToChannel(buf.getChannelData(0), 0);
  out.copyToChannel(buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0), 1);
  return out;
}

$('file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  stop(); S.offset = 0;
  $('fileLabel').textContent = 'Memuat ' + f.name + '…';
  try {
    const ctx = await ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const ab = await f.arrayBuffer();
    const buf = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    S.buffer = toStereo(ctx, buf);
    S.name = f.name.replace(/\.[^.]+$/, '');
    $('fileLabel').textContent = f.name + ' · ' + timeStr(buf.duration) + ' · ' + buf.sampleRate + ' Hz';
    for (const id of ['play', 'btnA', 'btnB', 'export']) $(id).disabled = false;
    S.origLufs = measureLufs(S.buffer);
    S.analysisValid = false;
    drawWave(); updateStats(); scheduleAnalysis(0);
  } catch (err) {
    console.error(err);
    $('fileLabel').textContent = 'Gagal memuat file: ' + (err.message || err);
  }
};

function position() {
  if (!S.buffer) return 0;
  const p = S.playing ? S.offset + (S.ctx.currentTime - S.startAt) : S.offset;
  return Math.min(p, S.buffer.duration);
}
function play() {
  if (!S.buffer) return;
  if (S.ctx.state === 'suspended') S.ctx.resume();
  if (S.offset >= S.buffer.duration) S.offset = 0;
  const src = new AudioBufferSourceNode(S.ctx, { buffer: S.buffer });
  src.connect(S.chain.input); src.connect(S.dryG);
  src.onended = () => { if (S.src === src) { S.offset = position(); S.playing = false; S.src = null; $('play').textContent = '▶ Putar'; } };
  src.start(0, S.offset);
  S.src = src; S.startAt = S.ctx.currentTime; S.playing = true;
  $('play').textContent = '⏸ Jeda';
}
function stop() {
  if (S.src) { const s = S.src; S.offset = position(); S.src = null; try { s.stop(); } catch {} s.disconnect(); }
  S.playing = false; $('play').textContent = '▶ Putar';
}
function seek(t) {
  const was = S.playing; stop(); S.offset = Math.max(0, Math.min(t, S.buffer.duration)); if (was) play();
}
$('play').onclick = () => (S.playing ? stop() : play());

function dryMatchDb() {
  // level-match: samakan loudness sinyal asli dengan hasil master
  if (S.origLufs == null || !isFinite(S.origLufs)) return 0;
  const target = S.analysisValid && isFinite(S.procLufs) ? S.procLufs : S.params.targetLufs;
  return Math.max(-24, Math.min(24, target - S.origLufs));
}
function applyAB() {
  if (!S.ctx) return;
  const t = S.ctx.currentTime;
  S.wetG.gain.setTargetAtTime(S.mode === 'B' ? 1 : 0, t, 0.008);
  S.dryG.gain.setTargetAtTime(S.mode === 'A' ? dbToGain(dryMatchDb()) : 0, t, 0.008);
  $('btnA').classList.toggle('on', S.mode === 'A');
  $('btnB').classList.toggle('on', S.mode === 'B');
}
$('btnA').onclick = () => { S.mode = 'A'; applyAB(); };
$('btnB').onclick = () => { S.mode = 'B'; applyAB(); };

// ---------- Analisis loudness (offline) ----------
let analysisTimer = 0;
function scheduleAnalysis(delay = 1200) {
  if (!S.buffer) return;
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(runAnalysis, delay);
}
async function analyze(params) {
  const pass1 = await renderOffline(S.buffer, params, 0);
  const l1 = measureLufs(pass1);
  const normDb = isFinite(l1) ? Math.max(-30, Math.min(30, params.targetLufs - l1)) : 0;
  return { l1, normDb };
}
async function runAnalysis() {
  const token = ++S.analysisToken;
  const params = structuredClone(S.params);
  $('stats').textContent = 'Menganalisis loudness…';
  try {
    const { normDb } = await analyze(params);
    if (token !== S.analysisToken) return;
    S.normDb = $('normalize').checked ? normDb : 0;
    S.procLufs = $('normalize').checked ? params.targetLufs : null;
    S.analysisValid = JSON.stringify(params) === JSON.stringify(S.params);
    if (S.chain) S.chain.update(S.params, S.normDb);
    applyAB(); updateStats();
  } catch (e) { console.error(e); $('stats').textContent = 'Analisis gagal: ' + e.message; }
}
$('normalize').onchange = () => { S.analysisValid = false; scheduleAnalysis(0); };

function updateStats() {
  if (!S.buffer) return;
  const parts = [];
  if (isFinite(S.origLufs)) parts.push(`Asli: ${S.origLufs.toFixed(1)} LUFS`);
  parts.push(`Gain normalisasi: ${S.normDb >= 0 ? '+' : ''}${S.normDb.toFixed(1)} dB`);
  parts.push(`A/B match: ${dryMatchDb().toFixed(1)} dB`);
  if (!S.analysisValid) parts.push('(analisis menunggu…)');
  $('stats').textContent = parts.join(' · ');
}

// ---------- Ekspor ----------
$('export').onclick = async () => {
  const btn = $('export'), st = $('exportStatus');
  btn.disabled = true;
  try {
    const params = structuredClone(S.params);
    let normDb = 0;
    if ($('normalize').checked) {
      st.textContent = 'Tahap 1/2: analisis loudness…';
      normDb = (await analyze(params)).normDb;
    }
    st.textContent = 'Tahap 2/2: render…';
    const out = await renderOffline(S.buffer, params, normDb);
    st.textContent = 'Menyusun WAV…';
    const lufs = measureLufs(out), pk = samplePeakDb(out);
    const blob = encodeWav(out, +$('fmt').value);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${S.name}_master.wav`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    st.textContent = `Selesai · ${lufs.toFixed(1)} LUFS · peak ${pk.toFixed(2)} dBFS · ${(blob.size / 1048576).toFixed(1)} MB`;
  } catch (e) {
    console.error(e); st.textContent = 'Render gagal: ' + (e.message || e);
  } finally { btn.disabled = false; }
};

// ---------- Waveform & meter ----------
const cv = $('wave');
let peaks = null;
function drawWave() {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  if (!S.buffer) return;
  const n = Math.floor(w), d0 = S.buffer.getChannelData(0), d1 = S.buffer.getChannelData(1);
  const step = Math.max(1, Math.floor(d0.length / n));
  peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(d0.length, j + step); j < e; j += 4) {
      const a = Math.max(Math.abs(d0[j]), Math.abs(d1[j])); if (a > m) m = a;
    }
    peaks[i] = m;
  }
}
function paintWave() {
  const g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const w = cv.width, h = cv.height;
  g.clearRect(0, 0, w, h);
  if (!peaks) return;
  const css = getComputedStyle(document.documentElement);
  const pos = position() / S.buffer.duration;
  for (let i = 0; i < peaks.length; i++) {
    const x = i * dpr, ph = Math.max(1, peaks[i] * h * 0.95);
    g.fillStyle = i / peaks.length < pos ? css.getPropertyValue('--wave-b') : css.getPropertyValue('--wave');
    g.fillRect(x, (h - ph) / 2, Math.max(1, dpr * 0.8), ph);
  }
}
window.addEventListener('resize', () => { drawWave(); });
cv.addEventListener('pointerdown', (e) => {
  if (!S.buffer) return;
  const r = cv.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * S.buffer.duration);
});

const timeStr = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let clipUntil = 0;
const tbuf = new Float32Array(2048);
function tick() {
  if (S.buffer) $('time').textContent = `${timeStr(position())} / ${timeStr(S.buffer.duration)}`;
  paintWave();
  if (S.analyser) {
    S.analyser.getFloatTimeDomainData(tbuf);
    let p = 0; for (let i = 0; i < tbuf.length; i++) { const a = Math.abs(tbuf[i]); if (a > p) p = a; }
    const db = 20 * Math.log10(p || 1e-9);
    $('meterBar').style.width = Math.max(0, Math.min(100, ((db + 48) / 48) * 100)) + '%';
    const now = performance.now();
    if (p >= 0.999) clipUntil = now + 1500;
    $('clip').classList.toggle('on', now < clipUntil);
  }
  requestAnimationFrame(tick);
}

buildControls();
initPresets();
syncControls();
requestAnimationFrame(tick);
