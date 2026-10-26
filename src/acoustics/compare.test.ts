import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../model/defaults'
import { compareSimInput, curveFrom, defaultSlices, findSlice, isDefaultSlice, medianDb, modeDelta, nearestAnalytic, strongestModes } from './compare'
import type { SimMode, SimResult } from './fdtd'

const result = (modes: SimMode[], avg: number[] = [10, 20, 30]): SimResult =>
  ({
    model: 'FDTD estimate',
    freqs: Float32Array.from([50, 120, 250]),
    avgDb: Float32Array.from(avg),
    probesDb: [],
    modes,
    dx: 34,
    resolutionMm: 8.5,
    slices: [],
  })
const mode = (f: number, level: number): SimMode => ({ f, level, q: 10, axis: 'x' })

describe('compare helpers', () => {
  it('takes the median from 100 Hz up to fMax', () => {
    expect(medianDb(result([], [99, 20, 30]), 1000)).toBe(25)
  })

  it('gives a curve relative to a reference level, from 20 Hz', () => {
    const c = curveFrom(result([], [10, 20, 30]).freqs, Float32Array.from([10, 20, 30]), 20, 1000)
    expect(c.x).toEqual([50, 120, 250])
    expect(c.y).toEqual([-10, 0, 10])
  })

  it('picks the strongest modes by level and handles none', () => {
    const r = result([mode(100, 5), mode(200, 9), mode(300, 7)])
    expect(strongestModes(r, 2).map((m) => m.f)).toEqual([200, 300])
    expect(strongestModes(result([]), 5)).toEqual([])
  })

  it('matches a mode to the nearest one within 3 percent, otherwise it is new', () => {
    const cmp = result([mode(100, 5)])
    expect(modeDelta(mode(102, 8), cmp)).toBe(3)
    expect(modeDelta(mode(120, 8), cmp)).toBeNull()
    expect(modeDelta(mode(102, 8), null)).toBeNull()
  })

  it('finds the nearest analytic mode of the untilted cavity', () => {
    const d = defaultDesign()
    d.dims.mode = 'inside'
    d.dims.innerSource = 'manual'
    d.dims.inner = { x: 1000, y: 600, z: 400 }
    const a = nearestAnalytic(d, 172, 1000)
    expect(a?.f).toBeCloseTo(171.5, 0)
    expect(nearestAnalytic(d, 5000, 1000)).toBeNull()
  })

  it('simulates the compare design with the current settings', () => {
    const cur = defaultDesign()
    cur.sim.fMax = 600
    cur.sim.probes = [{ x: 100, y: 100, z: 100 }]
    const cmp = defaultDesign()
    cmp.sim.fMax = 1500
    const { d, opts } = compareSimInput(cur, cmp)
    expect(opts.fMax).toBe(600)
    expect(d.sim.probes).toEqual(cur.sim.probes)
    expect(d.sim.cabId).toBe(cmp.sim.cabId) // the current cab is not in the compare design
    cmp.cabs.push({ ...cmp.cabs[0], id: cur.sim.cabId })
    expect(compareSimInput(cur, cmp).d.sim.cabId).toBe(cur.sim.cabId)
    expect(cmp.sim.fMax).toBe(1500) // input untouched
  })

  it('defaults to the mid-plane of each axis at the three lowest analytic modes', () => {
    const d = defaultDesign()
    d.dims.mode = 'inside'
    d.dims.innerSource = 'manual'
    d.dims.inner = { x: 1000, y: 600, z: 400 }
    const s = defaultSlices(d, 1000)
    expect(s).toHaveLength(9)
    const fs = s.filter((x) => x.axis === 'y').map((x) => x.f)
    ;[171.5, 285.8, 333.3].forEach((f, i) => expect(fs[i]).toBeCloseTo(f, 0))
    expect(s.find((x) => x.axis === 'z')?.at).toBe(200)
    expect(isDefaultSlice(d, { ...s[0] }, 1000)).toBe(true)
    expect(isDefaultSlice(d, { ...s[0], at: s[0].at + 5 }, 1000)).toBe(false)
  })

  it('finds a slice by plane, position and frequency', () => {
    const sl = { axis: 'y' as const, at: 300, f: 171.5, w: 1, h: 1, values: new Float32Array(1) }
    expect(findSlice([sl], { axis: 'y', at: 300.004, f: 171.5 })).toBe(sl)
    expect(findSlice([sl], { axis: 'x', at: 300, f: 171.5 })).toBeUndefined()
    expect(findSlice(undefined, { axis: 'y', at: 300, f: 171.5 })).toBeUndefined()
  })
})
