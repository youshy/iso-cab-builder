import { describe, it, expect } from 'vitest';
import { rectModes } from './analytic';
import { spectrum, findPeaks } from './spectrum';

describe('rectModes', () => {
  it('lists the lowest modes of a 1000x600x400 mm box', () => {
    const m = rectModes({ x: 1000, y: 600, z: 400 }, 450);
    const exp = [
      { f: 171.5, n: [1, 0, 0], kind: 'axial' },
      { f: 285.8, n: [0, 1, 0], kind: 'axial' },
      { f: 333.4, n: [1, 1, 0], kind: 'tangential' },
      { f: 343.0, n: [2, 0, 0], kind: 'axial' },
    ];
    exp.forEach((e, i) => {
      expect(m[i].f).toBeCloseTo(e.f, 0);
      expect(Math.abs(m[i].f - e.f)).toBeLessThan(0.2);
      expect(m[i].n).toEqual(e.n);
      expect(m[i].kind).toBe(e.kind);
    });
    expect(m.every((x) => x.f <= 450)).toBe(true);
    expect(m.every((x) => x.kind !== 'oblique')).toBe(true);
    const big = rectModes({ x: 1000, y: 600, z: 400 }, 600);
    const obl = big.find((x) => x.kind === 'oblique');
    expect(obl?.n).toEqual([1, 1, 1]);
    expect(obl!.f).toBeCloseTo(543.5, 0);
    expect(big.some((x) => x.n.every((v) => v === 0))).toBe(false);
  });
});

describe('spectrum + findPeaks', () => {
  it('finds two sines within 0.5 Hz', () => {
    const fs = 8000;
    const s = new Float32Array(fs);
    for (let i = 0; i < s.length; i++) {
      const t = i / fs;
      s[i] = Math.sin(2 * Math.PI * 100 * t) + Math.sin(2 * Math.PI * 237 * t);
    }
    const { freqs, db } = spectrum(s, fs);
    const p = findPeaks(freqs, db, { minProminence: 40, fMin: 50, fMax: 500 });
    expect(p.length).toBe(2);
    expect(Math.abs(p[0].f - 100)).toBeLessThan(0.5);
    expect(Math.abs(p[1].f - 237)).toBeLessThan(0.5);
  });

  // Hann windowing biases q of decaying signals up as duration grows beyond ~5 tau.
  it('estimates q of a decaying sine', () => {
    const fs = 8000, tau = 0.05, f0 = 200;
    const s = new Float32Array(Math.round(fs * 5 * tau));
    for (let i = 0; i < s.length; i++) {
      const t = i / fs;
      s[i] = Math.exp(-t / tau) * Math.sin(2 * Math.PI * f0 * t);
    }
    const { freqs, db } = spectrum(s, fs);
    const p = findPeaks(freqs, db, { fMin: 50, fMax: 1000 });
    expect(p.length).toBeGreaterThan(0);
    const top = p.reduce((a, b) => (b.level > a.level ? b : a));
    expect(Math.abs(top.f - f0)).toBeLessThan(2);
    const q = Math.PI * f0 * tau;
    expect(Math.abs(top.q - q) / q).toBeLessThan(0.2);
  });

  it('tail window keeps q accurate for a long decaying record', () => {
    const fs = 8000, tau = 0.05, f0 = 200;
    const s = new Float32Array(Math.round(fs * 20 * tau));
    for (let i = 0; i < s.length; i++) s[i] = Math.exp(-i / fs / tau) * Math.sin(2 * Math.PI * f0 * (i / fs));
    const { freqs, db } = spectrum(s, fs, { window: 'tail' });
    const top = findPeaks(freqs, db, { minProminence: 20, fMin: 50, fMax: 1000 }).sort((a, b) => b.level - a.level)[0];
    const q = Math.PI * f0 * tau;
    expect(Math.abs(top.q - q) / q).toBeLessThan(0.2);
  });

  it('returns NaN q when no -3 dB crossing exists', () => {
    const freqs = Float32Array.from([0, 1, 2, 3, 4]);
    const db = Float32Array.from([9, 9.5, 10, 9.6, 9.7]);
    const p = findPeaks(freqs, db, { minProminence: 0.1 });
    expect(p.length).toBeGreaterThan(0);
    expect(Number.isNaN(p[0].q)).toBe(true);
  });
});
