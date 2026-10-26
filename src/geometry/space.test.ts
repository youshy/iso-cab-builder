import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design, WallInterior } from '../model/schema'
import { resolveDims } from './dimensions'
import { cabBox, cabFit, cabPose, cornerFlags, inactiveFacetWarnings, isAir, materialAt, speakerPositions } from './space'
import { activeInterior } from './walls'

const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  return d
}
const facets = (tilt = 7, splitAxis: WallInterior['splitAxis'] = 'z'): WallInterior => ({
  splitAxis,
  facets: [
    { width: 180, tilt, hinge: 'min' },
    { width: 180, tilt, hinge: 'max' },
  ],
  panelMaterialId: 'plywood',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})

describe('cabFit / cabBox', () => {
  it('default design fits; cab on floor and centred', () => {
    const d = base()
    expect(cabFit(d).every((f) => f.fits)).toBe(true)
    const b = cabBox(d, d.cabs[0])
    const { inner } = resolveDims(d)
    expect(b.min.y).toBe(0)
    expect(b.min.x + b.max.x).toBeCloseTo(inner.x)
    expect(b.min.z).toBe(d.dims.clearance)
  })
  it('outside mode too small reports shortBy', () => {
    const d = base()
    d.dims.mode = 'outside'
    // free x = 850 - 72 = 778 < 760 + 40 = 800: short by 22
    d.dims.outer = { x: 850, y: 1300, z: 500 }
    const [f] = cabFit(d)
    expect(f.fits).toBe(false)
    expect(f.shortBy.x).toBeGreaterThan(0)
    expect(f.shortBy.y).toBeGreaterThanOrEqual(0)
    expect(resolveDims(d).free.x).toBeGreaterThanOrEqual(0)
  })
})

describe('isAir', () => {
  it('cavity centre is air only outside the cab', () => {
    const d = base()
    d.sim.cabId = ''
    const { inner } = resolveDims(d)
    expect(isAir(d, { x: inner.x / 2, y: inner.y / 2, z: inner.z / 2 })).toBe(true)
    d.sim.cabId = d.cabs[0].id
    const b = cabBox(d, d.cabs[0])
    expect(isAir(d, { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 })).toBe(false)
  })
  it('point inside a left facet is solid', () => {
    const d = base()
    d.interior.left = facets()
    d.sim.cabId = ''
    const { inner } = resolveDims(d)
    expect(isAir(d, { x: 5, y: inner.y / 2, z: 90 })).toBe(false)
    expect(isAir(d, { x: 100, y: inner.y / 2, z: 90 })).toBe(true)
  })
  it('outside the cavity is not air; panel slab is solid', () => {
    const d = base()
    d.sim.cabId = ''
    expect(isAir(d, { x: -1, y: 10, z: 10 })).toBe(false)
    d.panels.push({
      id: 'p', normal: 'x', position: 500, u0: 0, u1: 400, v0: 0, v1: 300,
      layers: [{ kind: 'layer', materialId: 'mdf', thickness: 18 }],
      insulation: { materialId: 'wool', thickness: 30 },
    })
    expect(isAir(d, { x: 530, y: 100, z: 100 })).toBe(false)
    expect(isAir(d, { x: 560, y: 100, z: 100 })).toBe(true)
    expect(isAir(d, { x: 520, y: 500, z: 100 })).toBe(true)
  })
})

describe('materialAt', () => {
  const lib = defaultLibrary()
  const id = (d: Design, p: { x: number; y: number; z: number }) => materialAt(d, lib, p)?.id ?? null
  it('air is null; untreated walls give the innermost layer, liner side with a gap', () => {
    const d = base()
    d.sim.cabId = ''
    const { inner } = resolveDims(d)
    expect(id(d, { x: inner.x / 2, y: inner.y / 2, z: inner.z / 2 })).toBeNull()
    expect(id(d, { x: -1, y: 100, z: 100 })).toBe('mdf')
    d.wallOverrides.top = [
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
      { kind: 'gap', width: 20, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'osb', thickness: 12 },
    ]
    expect(id(d, { x: 100, y: resolveDims(d).inner.y + 1, z: 100 })).toBe('osb')
  })
  it('treatment beats facet; facet beats wall; cab is plywood', () => {
    const d = base()
    d.interior.left = facets()
    d.treatments = [{ id: 't', surface: { wall: 'left' }, materialId: 'foam', thickness: 30 }]
    expect(id(d, { x: 5, y: 500, z: 90 })).toBe('plywood')
    expect(id(d, { x: 12 + 90 * Math.tan((7 * Math.PI) / 180) + 15, y: 500, z: 90 })).toBe('foam')
    const b = cabBox(d, d.cabs[0])
    expect(id(d, { x: (b.min.x + b.max.x) / 2, y: 100, z: (b.min.z + b.max.z) / 2 })).toBe('plywood')
  })
  it('panel slab with insulation gives the insulation; panel treatment beats panel', () => {
    const d = base()
    d.sim.cabId = ''
    d.panels.push({
      id: 'p', normal: 'x', position: 500, u0: 0, u1: 400, v0: 0, v1: 300,
      layers: [{ kind: 'layer', materialId: 'mdf', thickness: 18 }],
      insulation: null,
    })
    expect(id(d, { x: 510, y: 100, z: 100 })).toBe('mdf')
    d.panels[0].insulation = { materialId: 'rockwool', thickness: 30 }
    expect(id(d, { x: 510, y: 100, z: 100 })).toBe('rockwool')
    d.treatments = [{ id: 't', surface: { panelId: 'p', side: 'neg' }, materialId: 'carpet', thickness: 8 }]
    expect(id(d, { x: 496, y: 100, z: 100 })).toBe('carpet')
  })
})

describe('corner flags and door wall', () => {
  it('flags adjacent tilted walls only', () => {
    const d = base()
    d.interior.left = facets()
    d.interior.top = facets(5, 'z')
    expect(cornerFlags(d)).toEqual([{ walls: ['left', 'top'] }])
    d.interior.right = facets(0)
    d.interior.back = facets(3, 'x')
    expect(cornerFlags(d).length).toBe(3)
  })
  it('door-wall facets are inactive and ignored', () => {
    const d = base()
    d.interior.left = facets()
    const before = resolveDims(d)
    d.door.side = 'left'
    expect(activeInterior(d, 'left')).toBeNull()
    expect(inactiveFacetWarnings(d)).toHaveLength(1)
    expect(resolveDims(d).inner.x).toBeLessThan(before.inner.x)
    d.door.side = 'front'
    expect(inactiveFacetWarnings(d)).toHaveLength(0)
  })
})

describe('cab rotation', () => {
  it('cabFit fails outside mode when a tight cab is rotated', () => {
    const d = base()
    d.dims.mode = 'outside'
    // inner 800 x 1180 x 400 (outer minus 72) is exactly the cab plus 20 mm clearance
    d.dims.outer = { x: 872, y: 1252, z: 472 }
    expect(cabFit(d)[0].fits).toBe(true)
    d.cabYaw = 20
    const [f] = cabFit(d)
    expect(f.fits).toBe(false)
    expect(f.shortBy.z).toBeGreaterThan(0)
  })
  it('cabPose puts the centre mid-width, on the floor, behind the rotated depth', () => {
    const d = base()
    d.cabYaw = 90
    const { centre, yaw } = cabPose(d, d.cabs[0])
    const { inner } = resolveDims(d)
    expect(yaw).toBe(90)
    expect(centre.x).toBeCloseTo(inner.x / 2, 6)
    expect(centre.y).toBeCloseTo(d.cabs[0].h / 2, 6)
    expect(centre.z).toBeCloseTo(d.dims.clearance + 760 / 2, 6)
  })
  it('cabBox is the bounding box of the rotated cab', () => {
    const d = base()
    d.cabYaw = 90
    const b = cabBox(d, d.cabs[0])
    expect(b.max.x - b.min.x).toBeCloseTo(360, 6)
    expect(b.max.z - b.min.z).toBeCloseTo(760, 6)
    expect(b.min.z).toBeCloseTo(d.dims.clearance, 6)
  })
  it('isAir tests the oriented box: a bounding-box corner is air at 45 degrees', () => {
    const d = base()
    d.cabYaw = 45
    const b = cabBox(d, d.cabs[0])
    const corner = { x: b.min.x + 1, y: b.min.y + 100, z: b.min.z + 1 }
    expect(isAir(d, corner)).toBe(true)
    const c = cabPose(d, d.cabs[0]).centre
    expect(isAir(d, c)).toBe(false)
    d.cabYaw = 0
    expect(isAir(d, { x: 700, y: 100, z: 200 })).toBe(false)
  })
  it('speakerPositions: facing is (sin yaw, 0, cos yaw) and sits on the front baffle', () => {
    const d = base()
    const cab = d.cabs[0]
    cab.speakers = [{ x: cab.w / 2, y: 300 }, { x: 100, y: 200 }]
    const c0 = cabPose(d, cab).centre
    const s0 = speakerPositions(d, cab)
    expect(s0[0].facing).toEqual({ x: 0, y: 0, z: 1 })
    expect(s0[0].p.x).toBeCloseTo(c0.x, 6)
    expect(s0[0].p.z).toBeCloseTo(c0.z + cab.d / 2, 6)
    expect(s0[0].p.y).toBeCloseTo(cabBox(d, cab).min.y + 300, 6)
    // yaw 0 matches the old axis-aligned placement
    expect(s0[1].p.x).toBeCloseTo(cabBox(d, cab).min.x + 100, 6)
    d.cabYaw = 90
    const c = cabPose(d, cab).centre
    const s = speakerPositions(d, cab)
    expect(s[0].facing.x).toBeCloseTo(1, 9)
    expect(s[0].facing.z).toBeCloseTo(0, 9)
    expect(s[0].p.x).toBeCloseTo(c.x + cab.d / 2, 6)
    expect(s[0].p.z).toBeCloseTo(c.z, 6)
    // viewed from the front (at +x looking -x) the left edge of the cab is toward +z
    expect(s[1].p.z).toBeGreaterThan(c.z)
    for (const sp of s) expect(Math.hypot(sp.facing.x, sp.facing.z)).toBeCloseTo(1, 9)
  })
})
