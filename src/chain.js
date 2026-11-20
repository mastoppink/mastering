import { makeImpulse } from './reverb.js';

const dbToGain = (d) => Math.pow(10, d / 20);
export const LIMITER_LOOKAHEAD = 0.003;

const loaded = new WeakSet();
export async function loadWorklets(ctx) {
  if (loaded.has(ctx)) return;
  await ctx.audioWorklet.addModule(new URL('./worklets/deesser.js', import.meta.url));
  await ctx.audioWorklet.addModule(new URL('./worklets/limiter.js', import.meta.url));
  loaded.add(ctx);
}

/**
 * Membangun rantai efek. Dipakai oleh AudioContext (preview) maupun
 * OfflineAudioContext (ekspor) sehingga hasilnya identik.
 * @returns {{input: AudioNode, output: AudioNode, update(p, normDb): void}}
 */
export function buildChain(ctx, params, normDb = 0) {
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const set = (param, v) => {
    if (offline) param.value = v;
    else param.setTargetAtTime(v, ctx.currentTime, 0.015);
  };
  const stereo = { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' };
  const gain = () => new GainNode(ctx, stereo);
  const bq = (type) => new BiquadFilterNode(ctx, { type, ...stereo });

  const inGain = gain();
  const hp = bq('highpass'); hp.Q.value = 0.707;
  const ls = bq('lowshelf'), lm = bq('peaking'), pr = bq('peaking'), hs = bq('highshelf');

  const deess = new AudioWorkletNode(ctx, 'deesser', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], ...stereo,
    processorOptions: { ...params.deesser },
  });

  const comp = new DynamicsCompressorNode(ctx, stereo);
  const makeup = gain();

  // Stereo width (matriks M/S)
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  const gLL = new GainNode(ctx), gRL = new GainNode(ctx), gLR = new GainNode(ctx), gRR = new GainNode(ctx);
  split.connect(gLL, 0); split.connect(gLR, 0);
  split.connect(gRL, 1); split.connect(gRR, 1);
  gLL.connect(merge, 0, 0); gRL.connect(merge, 0, 0);
  gLR.connect(merge, 0, 1); gRR.connect(merge, 0, 1);

  // Reverb dry/wet
  const dry = gain(), wet = gain(), sum = gain();
  const conv = new ConvolverNode(ctx, { ...stereo, disableNormalization: false });
  merge.connect(dry); merge.connect(conv); conv.connect(wet);
  dry.connect(sum); wet.connect(sum);

  const norm = gain();
  const limiter = new AudioWorkletNode(ctx, 'limiter', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], ...stereo,
    processorOptions: { ceiling: params.ceiling, release: 0.08, lookahead: LIMITER_LOOKAHEAD },
  });

  inGain.connect(hp); hp.connect(ls); ls.connect(lm); lm.connect(pr); pr.connect(hs);
  hs.connect(deess); deess.connect(comp); comp.connect(makeup); makeup.connect(split);
  sum.connect(norm); norm.connect(limiter);

  let irKey = '';
  function update(p, nDb = normDb) {
    normDb = nDb;
    set(inGain.gain, dbToGain(p.inputGain));
    set(hp.frequency, p.highpass);
    set(ls.frequency, p.lowShelf.freq); set(ls.gain, p.lowShelf.gain);
    set(lm.frequency, p.lowMid.freq); set(lm.gain, p.lowMid.gain); set(lm.Q, p.lowMid.q);
    set(pr.frequency, p.presence.freq); set(pr.gain, p.presence.gain); set(pr.Q, p.presence.q);
    set(hs.frequency, p.highShelf.freq); set(hs.gain, p.highShelf.gain);
    deess.port.postMessage({ ...p.deesser });
    const c = p.compressor;
    set(comp.threshold, c.threshold); set(comp.ratio, c.ratio); set(comp.knee, c.knee);
    comp.attack.value = c.attack; comp.release.value = c.release;
    set(makeup.gain, dbToGain(c.makeup || 0));
    const w = p.width / 100;
    set(gLL.gain, (1 + w) / 2); set(gRR.gain, (1 + w) / 2);
    set(gRL.gain, (1 - w) / 2); set(gLR.gain, (1 - w) / 2);
    const r = p.reverb;
    const key = `${r.type}|${r.decay}`;
    if (r.enabled && key !== irKey) { conv.buffer = makeImpulse(ctx, r.type, r.decay); irKey = key; }
    set(wet.gain, r.enabled ? r.mix : 0);
    set(dry.gain, 1);
    set(norm.gain, dbToGain(normDb));
    limiter.port.postMessage({ ceiling: p.ceiling });
  }
  update(params, normDb);

  return {
    input: inGain, output: limiter, update,
    disconnect() { limiter.disconnect(); },
  };
}

/** Render offline seluruh buffer melalui rantai yang sama. */
export async function renderOffline(buffer, params, normDb = 0) {
  const tail = params.reverb.enabled ? params.reverb.decay : 0;
  const latency = Math.round(LIMITER_LOOKAHEAD * buffer.sampleRate);
  const len = buffer.length + Math.round(tail * buffer.sampleRate) + latency;
  const ctx = new OfflineAudioContext(2, len, buffer.sampleRate);
  await loadWorklets(ctx);
  const src = new AudioBufferSourceNode(ctx, { buffer });
  const chain = buildChain(ctx, params, normDb);
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}
