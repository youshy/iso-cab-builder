import { describe, expect, it } from 'vitest'
import { defaultDesign } from './defaults'
import { editFacetWidth, ensureInterior, rescaleInteriors, setFacetCount, setSplitAxis } from './interiorEdit'
import { resolveDims } from '../geometry/dimensions'
import { widthError } from '../geometry/facets'

function manual() {
  const d = defaultDesign()
  d.dims.mode = 'inside'
  d.dims.innerSource = 'manual'
  d.dims.inner = { x: 1000, y: 800, z: 360 }
  return d
}

describe('interior edits', () => {
  it('creates a flat interior spanning the wall', () => {
    const d = manual()
    const wi = ensureInterior(d, 'left')
    expect(wi.splitAxis).toBe('y')
    expect(wi.facets).toEqual([{ width: 800, tilt: 0, hinge: 'min' }])
  })

  it('count change re-splits evenly and keeps the sum', () => {
    const d = manual()
    setSplitAxis(d, 'left', 'z')
    setFacetCount(d, 'left', 3)
    expect(d.interior.left!.facets.map((f) => f.width)).toEqual([120, 120, 120])
    setFacetCount(d, 'left', 2)
    expect(d.interior.left!.facets.map((f) => f.width)).toEqual([180, 180])
    setFacetCount(d, 'left', 20)
    expect(d.interior.left!.facets).toHaveLength(8)
  })

  it('changing the split axis re-splits to the new length', () => {
    const d = manual()
    setSplitAxis(d, 'left', 'z')
    setFacetCount(d, 'left', 2)
    setSplitAxis(d, 'left', 'y')
    expect(d.interior.left!.facets.map((f) => f.width)).toEqual([400, 400])
  })

  it('width edit rebalances, clamps, and reports an impossible neighbour', () => {
    const f = [
      { width: 120, tilt: 4, hinge: 'max' as const },
      { width: 240, tilt: 7, hinge: 'min' as const },
    ]
    expect(editFacetWidth(f, 0, 150, 360)!.map((x) => x.width)).toEqual([150, 210])
    expect(editFacetWidth(f, 0, 999, 360)!.map((x) => x.width)).toEqual([350, 10])
    const three = [
      { width: 100, tilt: 0, hinge: 'min' as const },
      { width: 100, tilt: 0, hinge: 'min' as const },
      { width: 160, tilt: 0, hinge: 'min' as const },
    ]
    expect(editFacetWidth(three, 0, 300, 360)).toBeNull()
    expect(editFacetWidth([f[0]], 0, 50, 360)).toBeNull()
  })

  it('rescales facets when the wall length changes', () => {
    const prev = manual()
    prev.dims.inner.z = 360
    prev.interior.left = {
      ...ensureInterior(structuredClone(prev), 'left', 'z'),
      facets: [
        { width: 120, tilt: 4, hinge: 'min' },
        { width: 240, tilt: 7, hinge: 'max' },
      ],
    }
    const next = structuredClone(prev)
    next.dims.inner.z = 240
    rescaleInteriors(prev, next)
    expect(next.interior.left!.facets.map((f) => f.width)).toEqual([80, 160])
    expect(next.interior.left!.facets.map((f) => f.tilt)).toEqual([4, 7])
    expect(widthError(next.interior.left!.facets, resolveDims(next).inner.z)).toBe(0)
  })

  it('leaves interiors alone when the length is unchanged or the axis was edited', () => {
    const prev = manual()
    setSplitAxis(prev, 'left', 'z')
    const same = structuredClone(prev)
    same.dims.inner.x = 900
    rescaleInteriors(prev, same)
    expect(same.interior.left!.facets).toEqual(prev.interior.left!.facets)
    const axis = structuredClone(prev)
    setSplitAxis(axis, 'left', 'y')
    const before = structuredClone(axis.interior.left)
    rescaleInteriors(prev, axis)
    expect(axis.interior.left).toEqual(before)
  })
})
