import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design, Library, WallInterior } from '../model/schema'
import { resolveDims } from '../geometry/dimensions'
import { rectModes } from './analytic'
import { simulate, type SimMode, type SimResult } from './fdtd'

const C = 343
const dxAt = (fMax: number) => C / (10 * fMax) * 1000 // mm

const lib = (): Library => {
  const l = defaultLibrary()
  l.materials.push({
    id: 'rigid', name: 'Rigid', kind: 'sheet', density: 600, thicknesses: [18],
    youngsModulus: 1e9, lossFactor: 0, absorption: [0, 0, 0, 0, 0, 0],
  })
  return l
}

/** Rigid rectangular cavity: no cab, no facets, no panels, door on the front so every other wall is usable. */
const box = (x: number, y: number, z: number): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  d.dims.mode = 'inside'
  d.dims.innerSource = 'manual'
  d.dims.inner = { x, y, z }
  d.wallDefault = [{ kind: 'layer', materialId: 'rigid', thickness: 18 }]
  d.sim.cabId = ''
  return d
}

const twoFacets = (): WallInterior => ({
  splitAxis: 'z',
  facets: [
    { width: 200, tilt: 7, hinge: 'min' },
    { width: 200, tilt: 7, hinge: 'max' },
  ],
  panelMaterialId: 'rigid',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})

/** First mode of each group whose members lie within 3% of the group's first mode. */
function distinctModes(fs: number[], n: number): number[] {
  const out: number[] = []
  for (const f of fs) if (out.length === 0 || f >= out[out.length - 1] * 1.03) out.push(f)
  return out.slice(0, n)
}

const nearest = (modes: SimMode[], f: number) =>
  modes.reduce((a, m) => (Math.abs(m.f - f) < Math.abs(a.f - f) ? m : a))

const strongest = (r: SimResult, n: number) => [...r.modes].sort((a, b) => b.level - a.level).slice(0, n)
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length

describe('simulate (FDTD)', { timeout: 60_000 }, () => {
  it('rigid box: first 20 distinct analytic modes each have a sim peak within 2%', () => {
    const d = box(1000, 600, 400)
    const r = simulate(d, lib(), { fMax: 1000, duration: 1 })
    const want = distinctModes(rectModes(resolveDims(d).inner, 1000, C).map((m) => m.f), 20)
    expect(want).toHaveLength(20)
    const misses = want.filter((f) => Math.abs(nearest(r.modes, f).f - f) / f > 0.02)
    expect(misses).toEqual([])
  })

  it('a dx/4 wall shift moves the lowest mode by about the analytic amount', () => {
    const fMax = 1000
    const quarter = dxAt(fMax) / 4
    const a = box(1000, 600, 400)
    const b = box(1000 - quarter, 600, 400)
    const fa = nearest(simulate(a, lib(), { fMax, duration: 1 }).modes, (C / 2) / 1.0).f
    const fb = nearest(simulate(b, lib(), { fMax, duration: 1 }).modes, (C / 2) / 1.0).f
    const expected = (C / 2) * (1000 / resolveDims(b).inner.x - 1)
    expect(expected).toBeCloseTo(1.49, 1)
    const shift = fb - fa
    expect(shift).toBeGreaterThan(0)
    expect(Math.abs(shift - expected)).toBeLessThanOrEqual(0.4 * expected)
  })

  it('rockwool on the back wall lowers the strongest peaks and their q', () => {
    const rigid = box(1000, 600, 400)
    const treated = box(1000, 600, 400)
    treated.treatments = [{ id: 't1', surface: { wall: 'back' }, materialId: 'rockwool', thickness: 50 }]
    const rr = strongest(simulate(rigid, lib(), { fMax: 1000 }), 5)
    const rt = strongest(simulate(treated, lib(), { fMax: 1000 }), 5)
    expect(mean(rt.map((m) => m.level))).toBeLessThanOrEqual(mean(rr.map((m) => m.level)) - 3)
    const q = (ms: SimMode[]) => mean(ms.map((m) => m.q).filter((x) => Number.isFinite(x)))
    expect(q(rt)).toBeLessThan(q(rr))
  })

  it('tilted facets on the left wall move at least one peak by 1% or more', () => {
    const flat = box(1000, 600, 400)
    const faceted = box(1000, 600, 400)
    faceted.interior.left = twoFacets()
    const mf = simulate(flat, lib(), { fMax: 1000 }).modes
    const mt = simulate(faceted, lib(), { fMax: 1000 }).modes
    const moved = mf.slice(0, 10).filter((m) => Math.abs(nearest(mt, m.f).f - m.f) / m.f >= 0.01)
    expect(moved.length).toBeGreaterThan(0)
  })

  it('reports grid, probes, slices, axis labels and progress', () => {
    const d = box(1000, 600, 400)
    d.sim.probes = [{ x: 500, y: 300, z: 200 }, { x: 100, y: 100, z: 100 }]
    const progress: number[] = []
    const r = simulate(d, lib(), { fMax: 1000, slices: [{ axis: 'y', at: 300, f: 171.5 }] }, (p) => progress.push(p))
    expect(r.model).toBe('FDTD estimate')
    expect(r.dx).toBeCloseTo(dxAt(1000), 6)
    expect(r.resolutionMm).toBeCloseTo(r.dx / 4, 6)
    expect(r.freqs.length).toBe(r.avgDb.length)
    expect(r.freqs[r.freqs.length - 1]).toBeLessThanOrEqual(1000)
    expect(r.probesDb).toHaveLength(2)
    expect(r.probesDb[0].length).toBe(r.freqs.length)
    expect(r.slices).toHaveLength(1)
    const s = r.slices[0]
    expect(s.values.length).toBe(s.w * s.h)
    expect(s.w).toBe(Math.ceil(1000 / r.dx))
    expect(s.h).toBe(Math.ceil(400 / r.dx))
    expect(nearest(r.modes, 171.5).axis).toBe('x')
    expect(nearest(r.modes, 285.8).axis).toBe('y')
    expect(Math.abs(nearest(r.modes, 619.0).f - 619.0)).toBeLessThan(0.02 * 619.0)
    expect(nearest(r.modes, 619.0).axis).toBeNull()
    expect(progress.length).toBeGreaterThan(1)
    expect(progress[progress.length - 1]).toBe(1)
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true)
  })

  it('stays bounded over a long lossless run with cut cells, a thin panel and an open-back cab', () => {
    const l = lib()
    l.materials.find((m) => m.id === 'plywood')!.absorption = [0, 0, 0, 0, 0, 0]
    const d = box(733.3, 517.1, 455.5)
    d.interior.top = { ...twoFacets(), splitAxis: 'x', facets: [{ width: 300, tilt: 13.3, hinge: 'max' }, { width: 433.3, tilt: 4.1, hinge: 'min' }] }
    d.interior.left = { ...twoFacets(), facets: [{ width: 155.5, tilt: 9.7, hinge: 'min' }, { width: 300, tilt: 2.2, hinge: 'max' }] }
    d.panels = [{ id: 'p', normal: 'z', position: 401.7, u0: 0, u1: 400, v0: 0, v1: 250, layers: [{ kind: 'layer', materialId: 'rigid', thickness: 12 }], insulation: null }]
    d.cabs[0] = { ...d.cabs[0], w: 400, h: 300, d: 250, back: 'open', speakers: [{ x: 200, y: 150 }] }
    d.sim.cabId = d.cabs[0].id
    const r = simulate(d, l, { fMax: 1000, duration: 1 })
    expect(r.avgDb.every((v) => Number.isFinite(v))).toBe(true)
    expect(Math.max(...r.avgDb)).toBeLessThan(60)
  })

  it('default design (cab inside) runs; an open-back cab changes the result', () => {
    const d = structuredClone(defaultDesign())
    const closed = simulate(d, defaultLibrary(), { fMax: 1000 })
    expect(closed.avgDb.every((v) => Number.isFinite(v))).toBe(true)
    d.cabs[0].back = 'open'
    const open = simulate(d, defaultLibrary(), { fMax: 1000 })
    const diff = Math.max(...closed.avgDb.map((v, i) => Math.abs(v - open.avgDb[i])))
    expect(diff).toBeGreaterThan(3)
  })
})
