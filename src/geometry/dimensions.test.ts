import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../model/defaults'
import type { Design, WallInterior } from '../model/schema'
import { autoDoorSide, doorWall } from '../doors/side'
import { cabFootprint, resolveDims } from './dimensions'
import { cavities, leafGroups, splitStack, stackThickness } from './walls'
import type { Gap, Layer } from '../model/schema'

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

describe('leafGroups and cavities', () => {
  const L = (materialId: string, thickness: number): Layer => ({ kind: 'layer', materialId, thickness })
  const G = (width: number): Gap => ({ kind: 'gap', width, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' })
  const triple = [L('plywood', 18), G(25), L('mdf', 18), L('mdf', 12), G(40), L('mdf', 18)]
  it('splits layers between cavities, outside-in', () => {
    expect(leafGroups(triple)).toEqual([[L('plywood', 18)], [L('mdf', 18), L('mdf', 12)], [L('mdf', 18)]])
    expect(cavities(triple).map((g) => g.width)).toEqual([25, 40])
  })
  it('a stack without cavities is one group', () => {
    const s = [L('plywood', 18), L('mdf', 18)]
    expect(leafGroups(s)).toEqual([s])
    expect(cavities(s)).toEqual([])
  })
  it('splitStack keeps shell, first gap and liner; middle holds the groups between', () => {
    const r = splitStack(triple)
    expect(r.shell).toEqual([L('plywood', 18)])
    expect(r.gap?.width).toBe(25)
    expect(r.liner).toEqual([L('mdf', 18)])
    expect(r.middle).toEqual([[L('mdf', 18), L('mdf', 12)]])
    expect(splitStack([L('a', 1)])).toEqual({ shell: [L('a', 1)], gap: null, liner: [], middle: [] })
    expect(splitStack([L('a', 1), G(5), L('b', 2)]).middle).toEqual([])
  })
})

describe('cab rotation sizing', () => {
  it('footprint swaps at 90 degrees and is the diagonal extent at 45', () => {
    const cab = { w: 1350, d: 360 }
    expect(cabFootprint(cab, 0)).toEqual({ w: 1350, d: 360 })
    const q = cabFootprint(cab, 90)
    expect(q.w).toBeCloseTo(360, 6)
    expect(q.d).toBeCloseTo(1350, 6)
    const e = cabFootprint(cab, 45)
    expect(e.w).toBeCloseTo(1209.2, 1)
    expect(e.d).toBeCloseTo(1209.2, 1)
  })
  it('inside/cab sizing follows the rotated footprint and the cab height', () => {
    const d = base()
    d.cabYaw = 90
    const r = resolveDims(d)
    expect(r.inner.x).toBeCloseTo(360 + 40, 1)
    expect(r.inner.z).toBeCloseTo(1350 + 40, 1)
    expect(r.inner.y).toBe(base().dims.inner.y)
    d.cabYaw = 45
    expect(resolveDims(d).inner.x).toBeCloseTo(1209.2 + 40, 1)
  })
})
