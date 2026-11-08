// Funzioni pure su Float32Array: niente DOM, niente Web Audio (testate in Node).

// ponytail: tarare dopo l'uso reale; 0.02 ≈ −34 dBFS
export const TRIM_THRESHOLD = 0.02;
export const TRIM_MARGIN_MS = 50;

// Copia invertita di ogni canale (l'input resta intatto)
export const reverseChannels = channels => channels.map(c => c.slice().reverse());

// Toglie il silenzio in testa e in coda, lascia un margine; tutto silenzio → vuoto
export function trimSilence(samples, sampleRate, { threshold = TRIM_THRESHOLD, marginMs = TRIM_MARGIN_MS } = {}) {
  const loud = x => Math.abs(x) > threshold;
  const first = samples.findIndex(loud);
  if (first < 0) return samples.subarray(0, 0);
  const last = samples.findLastIndex(loud);
  const m = Math.round(marginMs * sampleRate / 1000);
  return samples.subarray(Math.max(0, first - m), Math.min(samples.length, last + 1 + m));
}

// Picco assoluto per colonna, in [0,1]
export function peaks(samples, columns) {
  const n = samples.length, out = new Float32Array(columns);
  for (let i = 0; i < columns && n; i++) {
    const start = Math.min(n - 1, Math.floor(i * n / columns));
    const end = Math.max(start + 1, Math.floor((i + 1) * n / columns));
    let max = 0;
    for (let j = start; j < end; j++) max = Math.max(max, Math.abs(samples[j]));
    out[i] = Math.min(1, max);
  }
  return out;
}

// WAV PCM 16 bit mono
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => {
    const s = Math.max(-1, Math.min(1, x));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  });
  return buf;
}
