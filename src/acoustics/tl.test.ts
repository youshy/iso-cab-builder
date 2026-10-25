import { describe, expect, it } from 'vitest'
import { wallStack } from '../geometry/walls'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import { doorLayout } from '../doors/doors'
import type { Design, Gap, Layer, StackItem, WallInterior } from '../model/schema'
import {
  OCTAVES,
  absorberInsertion,
  doorStack,
  effectiveWallStack,
  interiorLevel,
  THIRD_OCTAVES,
  TL_MODEL_LABEL,
  escape,
  escapeLevel,
  leaf,
  tlLeaf,
  chainF0s,
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

describe('tlStack with several cavities', () => {
  const ply = (t: number): Layer => ({ kind: 'layer', materialId: 'plywood', thickness: t })
  const triple = (p: Partial<Gap> = {}): StackItem[] => [ply(18), gap(p), mdf(18), gap(p), mdf(18)]
  /** Equal mass and depth, same panels: the triple's two inner MDF sheets back to back. */
  const double = (p: Partial<Gap> = {}): StackItem[] => [ply(18), gap({ width: 50, ...p }), mdf(18), mdf(18)]
  const mTotal = leaf([ply(18)], lib).m + 27
  it('uses the generalised Sharp model and finds one resonance per cavity', () => {
    const r = tlStack(triple(), lib)
    expect(r.model).toBe(TL_MODEL_LABEL.multi)
    expect(TL_MODEL_LABEL.multi).toBe('Multi-leaf estimate (Sharp generalised)')
    expect(r.f0s).toHaveLength(2)
    expect(r.f0s[0]).toBeLessThan(r.f0s[1])
    expect(r.f0).toBe(r.f0s[0])
    expect(tlStack(double(), lib).f0s).toHaveLength(1)
  })
  it('lumped triple-leaf resonances agree with the chain', () => {
    // equal masses m, equal springs s = rho c^2 / d: w^2 = s/m and 3 s/m
    const m = 13.5, s = (1.21 * 343 ** 2) / 0.025
    const r = tlStack([mdf(18), gap(), mdf(18), gap(), mdf(18)], lib)
    expect(r.f0s[0] / (Math.sqrt(s / m) / (2 * Math.PI))).toBeCloseTo(1, 1)
    expect(r.f0s[1] / (Math.sqrt((3 * s) / m) / (2 * Math.PI))).toBeCloseTo(1, 1)
  })
  it('skips cavity standing-wave dips: wide empty cavities still give one f0 per cavity', () => {
    const r = tlStack([ply(18), gap({ width: 100, fill: 'empty' }), mdf(18), gap({ width: 100, fill: 'empty' }), mdf(18)], lib)
    expect(r.f0s).toHaveLength(2)
    expect(r.f0s.every((f) => Math.abs(f / 1715 - 1) > 0.05)).toBe(true)
  })
  it('equal-mass, equal-depth triple is within 6 dB of the double at 500 Hz and 2 kHz', () => {
    const t = tlStack(triple(), lib).thirds
    const d = tlStack(double(), lib).thirds
    for (const f of [500, 2000]) expect(Math.abs(at(t, f) - at(d, f))).toBeLessThan(6)
  })
  it('never exceeds the equivalent double plus 3 dB, never falls below the total-mass mass law', () => {
    for (const p of [{}, { decoupling: 'strips' as const }, { fill: 'empty' as const }]) {
      const r = tlStack(triple(p), lib)
      const eq = tlStack(double(p), lib)
      THIRD_OCTAVES.forEach((f, i) => {
        expect(r.thirds[i]).toBeLessThanOrEqual(Math.max(eq.thirds[i] + 3, massLaw(mTotal, f)) + 1e-9)
        expect(r.thirds[i]).toBeGreaterThanOrEqual(massLaw(mTotal, f) - 1e-9)
      })
    }
  })
  it('chain resonance of a single cavity is within 10% of Sharp', () => {
    const items: StackItem[] = [ply(18), gap(), mdf(18)]
    const sharp = tlStack(items, lib)
    expect(Math.abs(chainF0s(items, lib)[0] - sharp.f0!) / sharp.f0!).toBeLessThan(0.1)
  })
  it('a second 1 mm cavity changes TL at 1 kHz by under 6 dB', () => {
    const one = tlStack([ply(18), gap(), mdf(18), mdf(18)], lib)
    const two = tlStack([ply(18), gap(), mdf(18), gap({ width: 1 }), mdf(18)], lib)
    expect(Math.abs(at(two.thirds, 1000) - at(one.thirds, 1000))).toBeLessThan(6)
  })
  it('single and double leaf report f0s consistently', () => {
    expect(tlStack([mdf(18)], lib).f0s).toEqual([])
    const r = tlStack([mdf(18), gap(), mdf(18)], lib)
    expect(r.f0s).toEqual([r.f0])
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
  it('whole-wall door mode: every wall uses its own stack, no door surface', () => {
    const d = structuredClone(defaultDesign())
    d.door.kind = 'wall'
    const dual = escape(structuredClone(defaultDesign()), lib).tlBox
    const wall = escape(d, lib).tlBox
    // All six walls share one stack and no door area is substituted, so the box TL is that stack's TL.
    toOctaves(tlStack(wallStack(d, 'left'), lib).thirds).forEach((v, i) => expect(wall[i]).toBeCloseTo(v, 9))
    expect(wall).not.toEqual(dual)
  })
  it('door leaves lighter than the wall lower the box TL', () => {
    const base = defaultDesign()
    const light = structuredClone(base)
    const thin: Layer[] = [{ kind: 'layer', materialId: 'plywood', thickness: 9 }]
    light.door.outer.stack = thin
    light.door.inner.stack = thin
    const a = escape(base, lib).tlBox
    const b = escape(light, lib).tlBox
    expect(b).not.toEqual(a)
    expect(b[2]).toBeLessThan(a[2])
  })
})

describe('as-built stacks', () => {
  /** Two facets across the right wall (the default door is on the left, where facets are inactive). */
  const withFacets = (behind: WallInterior['behind']): Design => {
    const d = structuredClone(defaultDesign())
    d.interior.right = {
      splitAxis: 'z',
      facets: [
        { width: 200, tilt: 15, hinge: 'min' },
        { width: 200, tilt: 15, hinge: 'max' },
      ],
      panelMaterialId: 'plywood',
      panelThickness: 12,
      closure: 'fillers',
      behind,
    }
    return d
  }
  const rockwoolOnBack = (): Design => {
    const d = structuredClone(defaultDesign())
    d.treatments.push({ id: 't1', surface: { wall: 'back' }, materialId: 'rockwool', thickness: 50 })
    return d
  }

  it('a bare wall gives exactly the wall stack TL', () => {
    const d = defaultDesign()
    expect(tlStack(effectiveWallStack(d, lib, 'back'), lib)).toEqual(tlStack(wallStack(d, 'back'), lib))
  })
  it('facets add their packing cavity and panel: insulated beats bare at 1 kHz, empty is lower above resonance', () => {
    const d = withFacets('insulation')
    const stack = effectiveWallStack(d, lib, 'right')
    const cav = stack[2] as Gap
    expect(cav.kind).toBe('gap')
    // mean packing depth of a 200 mm facet at 15 degrees: 200 tan 15 / 2
    expect(cav.width).toBeCloseTo((200 * Math.tan((15 * Math.PI) / 180)) / 2, 6)
    expect(cav.decoupling).toBe('strips')
    expect(stack[3]).toEqual({ kind: 'layer', materialId: 'plywood', thickness: 12 })
    const bare = tlStack(wallStack(d, 'right'), lib).thirds
    const ins = tlStack(stack, lib)
    expect(ins.thirds).not.toEqual(bare)
    expect(at(ins.thirds, 1000)).toBeGreaterThanOrEqual(at(bare, 1000))
    const emp = tlStack(effectiveWallStack(withFacets('empty'), lib, 'right'), lib).thirds
    const f = THIRD_OCTAVES.find((x) => x > (ins.f0 as number) * 1.5) as number
    expect(at(emp, f)).toBeLessThan(at(ins.thirds, f))
  })
  it('rockwool 50 on the back adds over 1 dB at 2 kHz and under 0.5 dB at 125 Hz', () => {
    const d = rockwoolOnBack()
    const bare = tlStack(wallStack(d, 'back'), lib).thirds
    const built = tlStack(effectiveWallStack(d, lib, 'back'), lib).thirds
    expect(at(built, 2000) - at(bare, 2000)).toBeGreaterThan(1)
    expect(Math.abs(at(built, 125) - at(bare, 125))).toBeLessThan(0.5)
  })
  it('absorber insertion term is never negative and is capped at 15 dB', () => {
    const thin = { kind: 'absorber' as const, materialId: 'rockwool', thickness: 50 }
    const thick = { kind: 'absorber' as const, materialId: 'rockwool', thickness: 400 }
    THIRD_OCTAVES.forEach((f) => {
      expect(absorberInsertion(thin, f)).toBeGreaterThanOrEqual(0)
      expect(absorberInsertion(thick, f)).toBeLessThanOrEqual(15)
    })
    expect(absorberInsertion(thick, 4000)).toBe(15)
  })
  it('door stack: dual is outer leaf, between space, inner leaf; wall mode has none', () => {
    const d = defaultDesign()
    const s = doorStack(d, lib)!
    const gaps = s.filter((i): i is Gap => i.kind === 'gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].width).toBe(doorLayout(d, lib).betweenDepth)
    const w = structuredClone(d)
    w.door.kind = 'wall'
    expect(doorStack(w, lib)).toBeNull()
  })
})

describe('interior absorption', () => {
  it('interiorLevel: L1m 115, A 0.4 m2 gives 136.0', () => {
    expect(interiorLevel(115, 0.4)).toBeCloseTo(136.0, 1)
  })
  it('rockwool on the back raises absorption and lowers inside and outside levels, more at 1 kHz than 125 Hz', () => {
    const a = escape(defaultDesign(), lib)
    const d = structuredClone(defaultDesign())
    d.treatments.push({ id: 't1', surface: { wall: 'back' }, materialId: 'rockwool', thickness: 50 })
    const b = escape(d, lib)
    expect(a.absorption).toHaveLength(6)
    expect(a.lin).toHaveLength(6)
    const k = OCTAVES.indexOf(1000)
    const lo = OCTAVES.indexOf(125)
    expect(b.absorption[k]).toBeGreaterThan(a.absorption[k])
    expect(a.lin[k] - b.lin[k]).toBeGreaterThan(2)
    expect(a.lout[k] - b.lout[k]).toBeGreaterThan(2)
    expect(a.lout[lo] - b.lout[lo]).toBeLessThan(a.lout[k] - b.lout[k])
    expect(a.lin[lo] - b.lin[lo]).toBeLessThan(a.lin[k] - b.lin[k])
  })
  it('outside level uses the inside level from the absorption', () => {
    const d = defaultDesign()
    const r = escape(d, lib)
    r.lin.forEach((l, i) => expect(l).toBeCloseTo(interiorLevel(d.escape.insideLevel[i], r.absorption[i]), 9))
  })
})

describe('tlStack fc', () => {
  it('is the lowest leaf coincidence frequency, null for no layers', () => {
    const r = tlStack([mdf(18), gap(), mdf(18)], lib)
    expect(r.fc).toBeCloseTo(leaf([mdf(18)], lib).fc, 6)
    expect(tlStack([], lib).fc).toBeNull()
  })
})
