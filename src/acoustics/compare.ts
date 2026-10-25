import { resolveDims } from '../geometry/dimensions'
import type { Design } from '../model/schema'
import { rectModes, type Mode } from './analytic'
import type { SimMode, SimOptions, SimResult } from './fdtd'

const MATCH = 0.03 // a mode within 3 percent of another counts as the same mode
const MEDIAN_FROM = 100 // Hz

/** Median of the average response from 100 Hz up to fMax: the 0 dB line of the relative-level plots. */
export function medianDb(r: SimResult, fMax: number): number {
  const v = Array.from(r.freqs, (f, i) => [f, r.avgDb[i]] as const)
    .filter(([f]) => f >= MEDIAN_FROM && f <= fMax)
    .map(([, db]) => db)
    .sort((a, b) => a - b)
  if (v.length === 0) return 0
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** A response curve from fMin to fMax in dB relative to `ref`. */
export function curveFrom(freqs: Float32Array, db: Float32Array, ref: number, fMax: number, fMin = 20): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  freqs.forEach((f, i) => {
    if (f < fMin || f > fMax) return
    x.push(f)
    y.push(db[i] - ref)
  })
  return { x, y }
}

export const strongestModes = (r: SimResult, n: number): SimMode[] => [...r.modes].sort((a, b) => b.level - a.level).slice(0, n)

/** Level change of a mode against the nearest compare mode; null when there is no compare or no match. */
export function modeDelta(m: SimMode, compare: SimResult | null): number | null {
  if (!compare) return null
  let best: SimMode | null = null
  for (const c of compare.modes) {
    if (Math.abs(c.f - m.f) / c.f <= MATCH && (!best || Math.abs(c.f - m.f) < Math.abs(best.f - m.f))) best = c
  }
  return best ? m.level - best.level : null
}

/** Closest rigid-wall mode of the untilted box to frequency f, within 10 percent. */
export function nearestAnalytic(d: Design, f: number, fMax: number): Mode | null {
  let best: Mode | null = null
  for (const m of rectModes(resolveDims(d).inner, fMax * 1.1)) {
    if (!best || Math.abs(m.f - f) < Math.abs(best.f - f)) best = m
  }
  return best && Math.abs(best.f - f) / f <= 0.1 ? best : null
}

/**
 * The compare design always runs with the current sim settings (absolute levels depend on the grid):
 * same fMax and probes, and the current sim cab when the compare design has it.
 */
export function compareSimInput(current: Design, compare: Design): { d: Design; opts: SimOptions } {
  const d = structuredClone(compare)
  d.sim.fMax = current.sim.fMax
  d.sim.probes = structuredClone(current.sim.probes)
  if (current.sim.cabId === '' || d.cabs.some((c) => c.id === current.sim.cabId)) d.sim.cabId = current.sim.cabId
  return { d, opts: { fMax: current.sim.fMax } }
}
