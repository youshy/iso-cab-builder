import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../model/defaults'
import type { Design, WallInterior } from '../model/schema'
import { autoDoorSide, doorWall } from '../doors/side'
import { resolveDims } from './dimensions'
import { stackThickness } from './walls'

const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  return d
}
const leftFacets = (): WallInterior => ({
  splitAxis: 'z',
  facets: [
    { width: 180, tilt: 4, hinge: 'min' },
    { width: 180, tilt: 7, hinge: 'max' },
  ],
  panelMaterialId: 'plywood',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})

describe('door side', () => {
  it('auto picks left for the default cab', () => {
    expect(autoDoorSide(defaultDesign())).toBe('left')
  })
  it('doorWall follows explicit side', () => {
    expect(doorWall(base())).toBe('front')
  })
  it('auto prefers front when it is the smallest opening', () => {
    const d = base()
    d.cabs[0].d = 2000
    expect(autoDoorSide(d)).toBe('front')
  })
})

describe('resolveDims', () => {
  it('inside/manual', () => {
    const d = base()
    d.dims.innerSource = 'manual'
    d.dims.inner = { x: 1400, y: 1000, z: 450 }
    expect(resolveDims(d).outer).toEqual({ x: 1472, y: 1072, z: 522 })
  })
  it('outside', () => {
    const d = base()
    d.dims.mode = 'outside'
    d.dims.outer = { x: 1500, y: 1100, z: 500 }
    const r = resolveDims(d)
    expect(r.inner).toEqual({ x: 1428, y: 1028, z: 428 })
    expect(r.free).toEqual(r.inner)
  })
  it('inside/cab without facets', () => {
    const r = resolveDims(base())
    expect(r.inner).toEqual({ x: 1390, y: 1020, z: 400 })
    expect(r.grownBy).toEqual({ x: 0, y: 0, z: 0 })
  })
  it('inside/cab grows with left facets', () => {
    const d = base()
    d.interior.left = leftFacets()
    const r = resolveDims(d)
    expect(r.inner.x).toBe(1424.1)
    expect(r.grownBy.x).toBe(34.1)
  })
  it('outside with facets reduces free space only', () => {
    const d = base()
    d.dims.mode = 'outside'
    d.dims.outer = { x: 1500, y: 1100, z: 500 }
    d.interior.left = leftFacets()
    const r = resolveDims(d)
    expect(r.inner.x).toBe(1428)
    expect(r.free.x).toBe(1393.9)
    expect(r.grownBy.x).toBe(0)
  })
  it('ignores facets on the door wall', () => {
    const d = base()
    d.door.side = 'left'
    d.interior.left = leftFacets()
    expect(resolveDims(d).inner.x).toBe(1390)
  })
  it('wall override changes outer', () => {
    const d = base()
    d.wallOverrides.left = [{ kind: 'layer', materialId: 'plywood', thickness: 60 }]
    const r = resolveDims(d)
    expect(r.outer.x).toBe(r.inner.x + 96)
  })
})

describe('stackThickness', () => {
  it('counts gap width', () => {
    expect(
      stackThickness([
        { kind: 'layer', materialId: 'plywood', thickness: 18 },
        { kind: 'gap', width: 25, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
        { kind: 'layer', materialId: 'mdf', thickness: 18 },
      ]),
    ).toBe(61)
  })
})
