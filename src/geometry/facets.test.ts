import { describe, expect, it } from 'vitest'
import type { Facet, WallInterior } from '../model/schema'
import {
  facetOffsetAt,
  maxIntrusion,
  packingDepth,
  panelLength,
  rebalance,
  rescale,
  splitEvenly,
  steps,
  widthError,
} from './facets'

const f = (width: number, tilt: number, hinge: 'min' | 'max' = 'min'): Facet => ({ width, tilt, hinge })
const wall = (facets: Facet[]): WallInterior => ({
  splitAxis: 'x',
  facets,
  panelMaterialId: 'ply',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})
const sum = (a: Facet[]) => a.reduce((s, x) => s + x.width, 0)

describe('facet geometry', () => {
  it('packing depth and panel length', () => {
    expect(packingDepth(f(180, 4))).toBeCloseTo(12.59, 2)
    expect(panelLength(f(180, 4))).toBeCloseTo(180.44, 2)
  })

  const w = wall([f(180, 4, 'min'), f(180, 7, 'max')])
  it('offsets', () => {
    expect(facetOffsetAt(w, 0)).toBeCloseTo(12, 5)
    expect(facetOffsetAt(w, 179.9)).toBeCloseTo(24.58, 2)
    expect(facetOffsetAt(w, 180)).toBeCloseTo(34.1, 2)
    expect(facetOffsetAt(w, 360)).toBeCloseTo(12, 5)
    expect(facetOffsetAt(w, -5)).toBeCloseTo(12, 5)
    expect(facetOffsetAt(w, 999)).toBeCloseTo(12, 5)
  })
  it('max intrusion and steps', () => {
    expect(maxIntrusion(w)).toBeCloseTo(34.1, 2)
    expect(maxIntrusion(null)).toBe(0)
    expect(maxIntrusion(wall([f(100, 0), f(100, 0)]))).toBe(12)
    const st = steps(w)
    expect(st).toHaveLength(1)
    expect(st[0].s).toBe(180)
    expect(st[0].delta).toBeCloseTo(9.5, 1)
  })
  it('unequal widths allowed', () => {
    expect(widthError([f(120, 5), f(240, 3)], 360)).toBe(0)
  })
  it('splitEvenly', () => {
    const r = splitEvenly(360, 7)
    expect(r.reduce((a, b) => a + b, 0)).toBe(360)
    expect(Math.min(...r)).toBeGreaterThanOrEqual(51)
  })
  it('rebalance', () => {
    const base = [f(180, 0), f(180, 0)]
    expect(rebalance(base, 0, 120, 360)?.map((x) => x.width)).toEqual([120, 240])
    expect(rebalance(base, 1, 100, 360)?.map((x) => x.width)).toEqual([260, 100])
    expect(rebalance(base, 0, 355, 360)).toBeNull()
  })
  it('rescale', () => {
    expect(rescale([f(120, 5), f(240, 3)], 300).map((x) => x.width)).toEqual([100, 200])
    const r = rescale([f(100, 0), f(100, 0), f(100, 0)], 200)
    expect(sum(r)).toBe(200)
  })
})
