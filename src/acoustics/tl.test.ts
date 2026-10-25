import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Gap, Layer, StackItem } from '../model/schema'
import {
  OCTAVES,
  THIRD_OCTAVES,
  TL_MODEL_LABEL,
  escape,
  escapeLevel,
  leaf,
  tlLeaf,
  tlStack,
  toOctaves,
} from './tl'

const lib = defaultLibrary()
const mdf = (t: number): Layer => ({ kind: 'layer', materialId: 'mdf', thickness: t })
const gap = (p: Partial<Gap> = {}): Gap => ({
  kind: 'gap',
  width: 25,
  decoupling: 'clips',
  fill: 'insulation',
  fillMaterialId: 'rockwool',
  ...p,
})
const at = (thirds: number[], f: number) => thirds[THIRD_OCTAVES.indexOf(f)]
const massLaw = (m: number, f: number) => 20 * Math.log10(m * f) - 47

describe('leaf and tlLeaf', () => {
  it('18 mm MDF has m = 13.5 and mass-law TL at 500 Hz', () => {
    const l = leaf([mdf(18)], lib)
    expect(l.m).toBeCloseTo(13.5, 6)
    expect(tlLeaf(l, 500)).toBeCloseTo(29.6, 0)
    expect(Math.abs(tlLeaf(l, 500) - 29.6)).toBeLessThan(0.5)
  })
  it('dips at coincidence and interpolates between fc/2 and fc', () => {
    const l = leaf([mdf(18)], lib)
    const lo = massLaw(l.m, l.fc / 2)
    expect(tlLeaf(l, l.fc / 2)).toBeCloseTo(lo, 6)
    const hi = tlLeaf(l, l.fc)
    const mid = tlLeaf(l, (l.fc * 3) / 4)
    expect(mid).toBeCloseTo((lo + hi) / 2, 6)
    expect(hi).toBeLessThan(massLaw(l.m, l.fc))
  })
  it('empty layer list gives TL 0', () => {
    expect(tlStack([], lib).thirds.every((v) => v === 0)).toBe(true)
  })
})

describe('tlStack', () => {
  const dbl = (p: Partial<Gap> = {}): StackItem[] => [mdf(18), gap(p), mdf(18)]
  it('single leaf uses the mass law label', () => {
    const r = tlStack([mdf(18)], lib)
    expect(r.f0).toBeNull()
    expect(r.model).toBe(TL_MODEL_LABEL.single)
    expect(TL_MODEL_LABEL.single).toBe('Mass law estimate')
  })
  it('double leaf f0 near 146 Hz and mass law below it', () => {
    const r = tlStack(dbl(), lib)
    expect(r.model).toBe('Sharp double-leaf estimate')
    expect(Math.abs((r.f0 as number) - 146)).toBeLessThan(2)
    expect(Math.abs(at(r.thirds, 100) - massLaw(27, 100))).toBeLessThan(0.5)
  })
  it('beats a single 36 mm leaf at 1000 Hz', () => {
    const d = tlStack(dbl(), lib)
    const s = tlStack([mdf(36)], lib)
    expect(at(d.thirds, 1000)).toBeGreaterThan(at(s.thirds, 1000))
  })
  it('empty fill is lower at 500 Hz and equal below f0', () => {
    const ins = tlStack(dbl(), lib)
    const emp = tlStack(dbl({ fill: 'empty' }), lib)
    expect(at(emp.thirds, 500)).toBeLessThan(at(ins.thirds, 500))
    expect(at(emp.thirds, 100)).toBeCloseTo(at(ins.thirds, 100), 9)
  })
  it('strips decoupling is lower than clips above f0, never below the mass-law line', () => {
    const clips = tlStack(dbl(), lib)
    const strips = tlStack(dbl({ decoupling: 'strips', fill: 'empty' }), lib)
    expect(at(strips.thirds, 500)).toBeLessThan(at(clips.thirds, 500))
    THIRD_OCTAVES.forEach((f, i) => {
      expect(strips.thirds[i]).toBeGreaterThanOrEqual(massLaw(27, f) - 1e-9)
    })
  })
  it('gap with one empty side acts as a single leaf of the other side', () => {
    const r = tlStack([gap(), mdf(18)], lib)
    expect(r.f0).toBeNull()
    expect(at(r.thirds, 500)).toBeCloseTo(29.6, 0)
  })
  it('single is the mean of thirds 100 to 3150', () => {
    const r = tlStack([mdf(18)], lib)
    const sel = r.thirds.filter((_, i) => THIRD_OCTAVES[i] >= 100 && THIRD_OCTAVES[i] <= 3150)
    expect(r.single).toBeCloseTo(sel.reduce((a, b) => a + b, 0) / sel.length, 9)
  })
})

describe('toOctaves', () => {
  it('energy-means three thirds around each octave', () => {
    const thirds = THIRD_OCTAVES.map(() => 30)
    expect(toOctaves(thirds)).toEqual(OCTAVES.map(() => 30))
    const t2 = thirds.slice()
    t2[THIRD_OCTAVES.indexOf(1000) - 1] = 40
    const e = toOctaves(t2)[3]
    expect(e).toBeCloseTo(-10 * Math.log10((10 ** -4 + 2 * 10 ** -3) / 3), 9)
  })
})

describe('escape', () => {
  it('escapeLevel: Lin 115, TLc 40, S 4 m2, r 1 gives 67.0', () => {
    const lout = escapeLevel(115, 40, 4, 1)
    expect(lout).toBeCloseTo(67.0, 1)
    expect(60 - lout).toBeCloseTo(-7.0, 1)
  })
  it('escapeLevel falls 6 dB per doubling of distance', () => {
    expect(escapeLevel(115, 40, 4, 1) - escapeLevel(115, 40, 4, 2)).toBeCloseTo(6.02, 2)
  })
  it('escape returns per-octave values and worst margin', () => {
    const d = structuredClone(defaultDesign())
    const r = escape(d, lib)
    expect(r.tlBox).toHaveLength(6)
    expect(r.lout).toHaveLength(6)
    expect(r.margin).toHaveLength(6)
    expect(r.worst).toBe(Math.min(...r.margin))
    r.margin.forEach((m, i) => expect(m).toBeCloseTo(d.escape.outsideTarget - r.lout[i], 9))
  })
  it('thicker walls improve the margin', () => {
    const a = structuredClone(defaultDesign())
    const b = structuredClone(defaultDesign())
    b.wallDefault = [mdf(25), mdf(25), mdf(25)]
    expect(escape(b, lib).worst).toBeGreaterThan(escape(a, lib).worst)
  })
})
