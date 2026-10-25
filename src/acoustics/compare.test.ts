import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../model/defaults'
import { compareSimInput, curveFrom, medianDb, modeDelta, nearestAnalytic, strongestModes } from './compare'
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
})
