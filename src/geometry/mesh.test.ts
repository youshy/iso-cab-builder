import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design, WallInterior } from '../model/schema'
import { resolveDims } from './dimensions'
import { buildScene as scene } from './mesh'
import { stackThickness, wallStack } from './walls'

const lib = defaultLibrary()
const buildScene = (d: Design) => scene(d, lib)
const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  return d
}
const twoFacets = (): WallInterior => ({
  splitAxis: 'z',
  facets: [
    { width: 180, tilt: 7, hinge: 'min' },
    { width: 180, tilt: 12, hinge: 'max' },
  ],
  panelMaterialId: 'plywood',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})

const bounds = (d: Design) => {
  const { inner } = resolveDims(d)
  const t = stackThickness(wallStack(d, 'left'))
  return { lo: -t, hi: { x: inner.x + t, y: inner.y + t, z: inner.z + t } }
}

describe('buildScene', () => {
  it('default design: shells for every wall and one cab', () => {
    const s = buildScene(base())
    expect(s.solids.filter((x) => x.kind === 'shell').length).toBeGreaterThanOrEqual(5)
    expect(s.solids.filter((x) => x.kind === 'cab')).toHaveLength(1)
    expect(s.solids.every((x) => x.indices.length === 36 && x.vertices.length === 24)).toBe(true)
  })

  it('skips the cab when the simulation has none', () => {
    const d = base()
    d.sim.cabId = ''
    expect(buildScene(d).solids.some((x) => x.kind === 'cab')).toBe(false)
  })

  it('left wall with 2 facets gives 2 facet solids tagged left', () => {
    const d = base()
    d.interior.left = twoFacets()
    const f = buildScene(d).solids.filter((x) => x.kind === 'facet')
    expect(f).toHaveLength(2)
    expect(f.every((x) => x.wall === 'left')).toBe(true)
  })

  it('facet hinge is flush on the wall and free edge sits at packing depth', () => {
    const d = base()
    d.interior.left = twoFacets()
    const [first] = buildScene(d).solids.filter((x) => x.kind === 'facet')
    const xs = first.vertices.filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(180 * Math.tan((7 * Math.PI) / 180) + 12, 6)
  })

  it('facets on the door wall are ignored', () => {
    const d = base()
    d.interior.front = { ...twoFacets(), splitAxis: 'x' }
    expect(buildScene(d).solids.some((x) => x.kind === 'facet')).toBe(false)
  })

  it('air gap splits a wall into shell and liner solids with the gap empty', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 30, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const left = buildScene(d).solids.filter((x) => x.wall === 'left')
    const shell = left.find((x) => x.kind === 'shell')!
    const liner = left.find((x) => x.kind === 'liner')!
    const xr = (v: number[]) => [Math.min(...v.filter((_, i) => i % 3 === 0)), Math.max(...v.filter((_, i) => i % 3 === 0))]
    expect(xr(shell.vertices)).toEqual([-66, -48])
    expect(xr(liner.vertices)).toEqual([-18, 0])
  })

  it('inner panels become panel slabs of total layer plus insulation thickness', () => {
    const d = base()
    d.panels.push({
      id: 'p', normal: 'x', position: 100, u0: 0, u1: 200, v0: 10, v1: 300,
      layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }],
      insulation: { materialId: 'rockwool', thickness: 50 },
    })
    const p = buildScene(d).solids.find((x) => x.kind === 'panel')!
    const xs = p.vertices.filter((_, i) => i % 3 === 0)
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 168])
  })

  it('all vertices lie inside the outer box', () => {
    const d = base()
    d.interior.left = twoFacets()
    d.interior.bottom = { ...twoFacets(), splitAxis: 'x' }
    const { lo, hi } = bounds(d)
    for (const s of buildScene(d).solids.filter((x) => x.kind !== 'door')) {
      for (let i = 0; i < s.vertices.length; i += 3) {
        expect(s.vertices[i]).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(s.vertices[i]).toBeLessThanOrEqual(hi.x + 1e-6)
        expect(s.vertices[i + 1]).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(s.vertices[i + 1]).toBeLessThanOrEqual(hi.y + 1e-6)
        expect(s.vertices[i + 2]).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(s.vertices[i + 2]).toBeLessThanOrEqual(hi.z + 1e-6)
      }
    }
  })

  describe('doors', () => {
    const range = (s: { vertices: number[] }, axis: 0 | 1 | 2): [number, number] => {
      const v = s.vertices.filter((_, i) => i % 3 === axis)
      return [Math.min(...v), Math.max(...v)]
    }
    const doorSolids = (d: Design) => buildScene(d).solids.filter((x) => x.kind === 'door')

    it('door wall is cut into boxes around the cutout, other walls stay whole', () => {
      const d = base()
      const solids = buildScene(d).solids
      expect(solids.filter((x) => x.wall === 'front' && x.kind === 'shell')).toHaveLength(4)
      expect(solids.filter((x) => x.wall === 'back' && x.kind === 'shell')).toHaveLength(1)
    })

    it('cutout area is empty: no wall box covers the wall centre', () => {
      const d = base()
      const { inner } = resolveDims(d)
      const cx = inner.x / 2, cy = inner.y / 2
      for (const s of buildScene(d).solids.filter((x) => x.wall === 'front' && x.kind === 'shell')) {
        const [x0, x1] = range(s, 0), [y0, y1] = range(s, 1)
        expect(x0 < cx && cx < x1 && y0 < cy && cy < y1).toBe(false)
      }
    })

    it('outer leaf sits outside the wall, inner leaf at the inner face, both leaf thickness', () => {
      const d = base() // front door, 18 mm ply outer, 18 mm MDF inner
      const { inner } = resolveDims(d)
      const t = stackThickness(wallStack(d, 'front'))
      const [outer, innerLeaf] = [
        doorSolids(d).find((x) => x.name === 'door-outer')!,
        doorSolids(d).find((x) => x.name === 'door-inner')!,
      ]
      expect(range(outer, 2)).toEqual([inner.z + t, inner.z + t + 18])
      expect(range(innerLeaf, 2)).toEqual([inner.z, inner.z + 18])
    })

    it('left wall door: leaf thickness runs along x on the low side', () => {
      const d = defaultDesign()
      d.door.side = 'left'
      const { inner } = resolveDims(d)
      const outer = doorSolids(d).find((x) => x.name === 'door-outer')!
      expect(range(outer, 0)).toEqual([-36 - 18, -36])
      expect(range(outer, 2)).toEqual([inner.z / 2 - 220, inner.z / 2 + 220])
    })

    it('split leaf gives two solids, all tagged with the door wall', () => {
      const d = base()
      d.door.outer.opening = 'split'
      const outers = doorSolids(d).filter((x) => x.name.startsWith('door-outer-') && !x.name.includes('frame'))
      expect(outers).toHaveLength(2)
      expect(doorSolids(d).every((x) => x.wall === 'front')).toBe(true)
    })

    it('framed door adds frame strips', () => {
      const d = base()
      d.door.outer.framed = true
      expect(doorSolids(d).filter((x) => x.name.startsWith('door-outer-frame'))).toHaveLength(4)
    })
  })
})
