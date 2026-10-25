/** Hann-windowed, zero-padded magnitude spectrum (dB) and peak picking. */

export type Peak = { f: number; level: number; q: number };

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function spectrum(signal: Float32Array, fs: number): { freqs: Float32Array; db: Float32Array } {
  const len = signal.length;
  let n = 1;
  while (n < len) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const denom = Math.max(1, len - 1);
  for (let i = 0; i < len; i++) re[i] = signal[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom));
  fft(re, im);
  const bins = (n >> 1) + 1;
  const freqs = new Float32Array(bins);
  const db = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    freqs[k] = (k * fs) / n;
    db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12);
  }
  return { freqs, db };
}

/** Prominence of local max at i: peak minus the higher of the two side minima. */
function prominence(db: Float32Array, i: number): number {
  const p = db[i];
  let lMin = p;
  for (let j = i - 1; j >= 0 && db[j] <= p; j--) if (db[j] < lMin) lMin = db[j];
  let rMin = p;
  for (let j = i + 1; j < db.length && db[j] <= p; j++) if (db[j] < rMin) rMin = db[j];
  return p - Math.max(lMin, rMin);
}

/** Frequency where the curve falls to `thr` walking in `dir`, or null if it never does before a valley/end. */
function crossing(freqs: Float32Array, db: Float32Array, from: number, dir: 1 | -1, thr: number): number | null {
  for (let j = from; j + dir >= 0 && j + dir < db.length; j += dir) {
    const a = db[j], b = db[j + dir];
    if (b <= thr) {
      const t = (a - thr) / (a - b);
      return freqs[j] + t * (freqs[j + dir] - freqs[j]);
    }
    if (b > a) return null; // started rising: next peak
  }
  return null;
}

export function findPeaks(
  freqs: Float32Array,
  db: Float32Array,
  opts: { minProminence?: number; fMin?: number; fMax?: number } = {},
): Peak[] {
  const minProm = opts.minProminence ?? 6;
  const fMin = opts.fMin ?? -Infinity;
  const fMax = opts.fMax ?? Infinity;
  const out: Peak[] = [];
  for (let i = 1; i < db.length - 1; i++) {
    if (!(db[i] > db[i - 1] && db[i] >= db[i + 1])) continue;
    if (prominence(db, i) < minProm) continue;
    const a = db[i - 1], b = db[i], c = db[i + 1];
    const den = a - 2 * b + c;
    const d = den === 0 ? 0 : (0.5 * (a - c)) / den;
    const df = freqs[i + 1] - freqs[i];
    const f = freqs[i] + d * df;
    if (f < fMin || f > fMax) continue;
    const level = b - 0.25 * (a - c) * d;
    const thr = level - 3;
    const lo = crossing(freqs, db, i, -1, thr);
    const hi = crossing(freqs, db, i, 1, thr);
    let bw: number;
    if (lo !== null && hi !== null) bw = hi - lo;
    else if (lo !== null) bw = 2 * (f - lo);
    else if (hi !== null) bw = 2 * (hi - f);
    else bw = Infinity;
    out.push({ f, level, q: bw > 0 ? f / bw : Infinity });
  }
  return out.sort((x, y) => x.f - y.f);
}
