import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../model/defaults'
import type { Design, WallInterior } from '../model/schema'
import { resolveDims } from './dimensions'
import { buildScene } from './mesh'
import { stackThickness, wallStack } from './walls'

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
    for (const s of buildScene(d).solids) {
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
})
