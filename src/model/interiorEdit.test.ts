import { describe, expect, it } from 'vitest'
import { createAppStore } from './store'
import { defaultDesign, defaultLibrary } from './defaults'
import type { Design } from './schema'
import { rescale } from '../geometry/facets'
import { editFacetWidth, ensureInterior, newInterior, rescaleInteriors, setFacetCount, setSplitAxis } from './interiorEdit'
import { resolveDims } from '../geometry/dimensions'
import { widthError } from '../geometry/facets'

const LIB = defaultLibrary()

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
    const wi = ensureInterior(d, 'left', LIB)
    expect(wi.splitAxis).toBe('y')
    expect(wi.facets).toEqual([{ width: 800, tilt: 0, hinge: 'min' }])
  })

  it('count change re-splits evenly and keeps the sum', () => {
    const d = manual()
    setSplitAxis(d, 'left', 'z', LIB)
    setFacetCount(d, 'left', 3, LIB)
    expect(d.interior.left!.facets.map((f) => f.width)).toEqual([120, 120, 120])
    setFacetCount(d, 'left', 2, LIB)
    expect(d.interior.left!.facets.map((f) => f.width)).toEqual([180, 180])
    setFacetCount(d, 'left', 20, LIB)
    expect(d.interior.left!.facets).toHaveLength(8)
  })

  it('changing the split axis re-splits to the new length', () => {
    const d = manual()
    setSplitAxis(d, 'left', 'z', LIB)
    setFacetCount(d, 'left', 2, LIB)
    setSplitAxis(d, 'left', 'y', LIB)
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
      ...ensureInterior(structuredClone(prev), 'left', LIB, 'z'),
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
    setSplitAxis(prev, 'left', 'z', LIB)
    const same = structuredClone(prev)
    same.dims.inner.x = 900
    rescaleInteriors(prev, same)
    expect(same.interior.left!.facets).toEqual(prev.interior.left!.facets)
    const axis = structuredClone(prev)
    setSplitAxis(axis, 'left', 'y', LIB)
    const before = structuredClone(axis.interior.left)
    rescaleInteriors(prev, axis)
    expect(axis.interior.left).toEqual(before)
  })

  it('falls back to a library sheet when the default panel material is missing', () => {
    const lib = { ...LIB, materials: LIB.materials.filter((m) => m.id !== 'plywood') }
    const wi = ensureInterior(manual(), 'left', lib)
    expect(lib.materials.find((m) => m.id === wi.panelMaterialId)!.kind).toBe('sheet')
  })
})

function memoryBackend() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

function cabDriven() {
  const d = defaultDesign()
  d.door.side = 'front'
  d.interior.left = {
    ...newInterior(d, 'left', LIB, 'z'),
    facets: [{ width: 200, tilt: 5, hinge: 'min' }, { width: 200, tilt: 8, hinge: 'max' }],
  }
  d.interior.back = {
    ...newInterior(d, 'back', LIB, 'x'),
    facets: [{ width: 700, tilt: 6, hinge: 'min' }, { width: 690, tilt: 3, hinge: 'max' }],
  }
  return d
}

const sumsMatch = (d: Design) => {
  const inner = resolveDims(d).inner
  for (const wi of Object.values(d.interior)) expect(widthError(wi!.facets, inner[wi!.splitAxis])).toBeCloseTo(0, 5)
}

describe('cross-wall rescale in cab-driven mode', () => {
  it('keeps every wall summing to its length after a tilt change on another wall', () => {
    const s = createAppStore(memoryBackend())
    s.update((x) => void Object.assign(x, { ...cabDriven(), id: x.id, cabs: x.cabs, dims: x.dims, door: x.door }, { door: { ...x.door, side: 'front' } }))
    s.update((x) => void (x.interior.back!.facets[0].tilt = 18))
    const z0 = resolveDims(s.design.value).inner.z
    expect(z0).toBeGreaterThan(400)
    sumsMatch(s.design.value)
    s.update((x) => void (x.interior.back!.facets[0].tilt = 2))
    sumsMatch(s.design.value)
  })

  it('stays within a few mm of the final dims when the pass cap is hit', () => {
    const prev = cabDriven()
    prev.interior.left!.facets = rescale(prev.interior.left!.facets, resolveDims(prev).inner.z)
    prev.interior.back!.facets = rescale(prev.interior.back!.facets, resolveDims(prev).inner.x)
    const next = structuredClone(prev)
    next.interior.back!.facets[0].tilt = 20
    next.interior.back!.facets[1].tilt = 20
    rescaleInteriors(prev, next, 1)
    const inner = resolveDims(next).inner
    // the cap is not reached with the default (8 passes converge exactly, see above); with 1 pass the intrusion drift stays small
    for (const wi of Object.values(next.interior)) expect(Math.abs(widthError(wi!.facets, inner[wi!.splitAxis]))).toBeLessThan(5)
  })
})
