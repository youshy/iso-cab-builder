import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design, WallInterior } from '../model/schema'
import { resolveDims } from './dimensions'
import { buildScene } from './mesh'
import { isAir } from './space'
import {
  inactiveTreatmentWarnings, panelTreatmentThickness, surfaceOffsetAt, wallTreatmentThickness,
} from './treatments'

const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  return d
}
const treat = (d: Design, surface: Design['treatments'][number]['surface'], thickness: number, id = `t${d.treatments.length}`) =>
  d.treatments.push({ id, surface, materialId: 'rockwool', thickness })
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
const panel = (d: Design) => {
  d.sim.cabId = '' // keep the cab out of the air checks
  d.panels.push({
    id: 'p1', normal: 'x', position: 100, u0: 0, u1: 1000, v0: 0, v1: 400,
    layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }, { kind: 'layer', materialId: 'plywood', thickness: 50 }],
    insulation: null,
  })
}

describe('treatment thickness', () => {
  it('sums wall treatments and ignores the door wall', () => {
    const d = base()
    treat(d, { wall: 'back' }, 50)
    treat(d, { wall: 'back' }, 10)
    treat(d, { wall: 'front' }, 30)
    expect(wallTreatmentThickness(d, 'back')).toBe(60)
    expect(wallTreatmentThickness(d, 'left')).toBe(0)
    expect(wallTreatmentThickness(d, 'front')).toBe(0)
    expect(inactiveTreatmentWarnings(d)).toHaveLength(1)
    expect(inactiveTreatmentWarnings(d)[0]).toMatch(/front/)
  })
  it('panel treatment per side', () => {
    const d = base()
    panel(d)
    treat(d, { panelId: 'p1', side: 'pos' }, 30)
    expect(panelTreatmentThickness(d, 'p1', 'pos')).toBe(30)
    expect(panelTreatmentThickness(d, 'p1', 'neg')).toBe(0)
  })
})

describe('dimensions with treatments', () => {
  it('outside mode: free depth drops by the treatment', () => {
    const d = base()
    d.dims.mode = 'outside'
    d.dims.outer = { x: 1500, y: 1100, z: 500 }
    const before = resolveDims(d).free.z
    treat(d, { wall: 'back' }, 50)
    expect(resolveDims(d).free.z).toBe(before - 50)
  })
  it('inside/cab: inner grows by the treatment', () => {
    const d = base()
    const before = resolveDims(d).inner.z
    treat(d, { wall: 'back' }, 50)
    const r = resolveDims(d)
    expect(r.inner.z).toBe(before + 50)
    expect(r.grownBy.z).toBe(50)
  })
})

describe('surfaceOffsetAt / isAir', () => {
  it('follows the facet face plus the treatment', () => {
    const d = base()
    d.interior.left = leftFacets()
    treat(d, { wall: 'left' }, 30)
    expect(surfaceOffsetAt(d, 'left', 0)).toBeCloseTo(42)
    expect(surfaceOffsetAt(d, 'left', 180)).toBeCloseTo(64.1, 1)
    expect(isAir(d, { x: 40, y: 500, z: 10 })).toBe(false)
    expect(isAir(d, { x: 50, y: 500, z: 10 })).toBe(true)
  })
  it('panel treatment extends the slab on its side', () => {
    const d = base()
    panel(d)
    treat(d, { panelId: 'p1', side: 'pos' }, 30)
    expect(isAir(d, { x: 190, y: 200, z: 100 })).toBe(false)
    expect(isAir(d, { x: 200, y: 200, z: 100 })).toBe(true)
  })
  it('panel treatment on the neg side', () => {
    const d = base()
    panel(d)
    treat(d, { panelId: 'p1', side: 'neg' }, 30)
    expect(isAir(d, { x: 75, y: 200, z: 100 })).toBe(false)
    expect(isAir(d, { x: 65, y: 200, z: 100 })).toBe(true)
  })
  it('door wall treatment is ignored', () => {
    const d = base()
    treat(d, { wall: 'front' }, 50)
    expect(surfaceOffsetAt(d, 'front', 0)).toBe(0)
    expect(resolveDims(d)).toEqual(resolveDims(base()))
  })
})

describe('buildScene treatments', () => {
  const lib = defaultLibrary()
  it('flat wall: a 50 mm box on the inner face', () => {
    const d = base()
    treat(d, { wall: 'back' }, 50)
    const s = buildScene(d, lib).solids.filter((x) => x.kind === 'treatment')
    expect(s).toHaveLength(1)
    expect(s[0].wall).toBe('back')
    const zs = s[0].vertices.filter((_, i) => i % 3 === 2)
    expect(Math.min(...zs)).toBeCloseTo(0)
    expect(Math.max(...zs)).toBeCloseTo(50)
  })
  it('faceted wall: treatment sits on the facet face', () => {
    const d = base()
    d.interior.left = leftFacets()
    treat(d, { wall: 'left' }, 30)
    const s = buildScene(d, lib).solids.filter((x) => x.kind === 'treatment')
    expect(s).toHaveLength(2)
    const xs = s[0].vertices.filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs)).toBeCloseTo(12)
    expect(Math.max(...xs)).toBeCloseTo(12 + 30 + 180 * Math.tan((4 * Math.PI) / 180))
  })
  it('panel treatment is a box beside the slab', () => {
    const d = base()
    panel(d)
    treat(d, { panelId: 'p1', side: 'pos' }, 30)
    const s = buildScene(d, lib).solids.find((x) => x.kind === 'treatment')!
    const xs = s.vertices.filter((_, i) => i % 3 === 0)
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([168, 198])
  })
  it('door wall treatment emits nothing', () => {
    const d = base()
    treat(d, { wall: 'front' }, 50)
    expect(buildScene(d, lib).solids.some((x) => x.kind === 'treatment')).toBe(false)
  })
})
