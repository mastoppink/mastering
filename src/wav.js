export function encodeWav(buffer, bits = 16) {
  const nch = buffer.numberOfChannels, len = buffer.length, sr = buffer.sampleRate;
  const bps = bits / 8, block = nch * bps, dataSize = len * block;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * block, true); v.setUint16(32, block, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  const chans = [];
  for (let c = 0; c < nch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  const max = bits === 16 ? 32767 : 8388607;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      let s = chans[c][i];
      if (bits === 16) s += (Math.random() - Math.random()) / 32768; // TPDF dither
      s = Math.max(-1, Math.min(1, s));
      const q = Math.round(s * max);
      if (bits === 16) { v.setInt16(o, q, true); o += 2; }
      else { v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3; }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
