import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import type { Design, Facet, WallInterior } from '../model/schema'
import { resolveDims } from '../geometry/dimensions'
import { buildParts, type Part } from './parts'

const lib = defaultLibrary()
const shop = defaultShop()
const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.dims.innerSource = 'manual'
  d.dims.inner = { x: 1400, y: 1000, z: 450 }
  d.door.side = 'front'
  return d
}
const f = (width: number, tilt: number, hinge: 'min' | 'max' = 'min'): Facet => ({ width, tilt, hinge })
const interior = (facets: Facet[], closure: 'fillers' | 'sealant' = 'fillers', behind: 'insulation' | 'empty' = 'insulation'): WallInterior => ({
  splitAxis: 'z', facets, panelMaterialId: 'plywood', panelThickness: 12, closure, behind,
})
const parts = (d: Design, s = shop) => buildParts(d, lib, s)
const named = (ps: Part[], re: RegExp) => ps.filter((p) => re.test(p.name))
const dims = (p: Part) => [p.length, p.width]
const qty = (ps: Part[]) => ps.reduce((a, p) => a + p.qty, 0)

describe('buildParts joints', () => {
  it('sides-past', () => {
    const d = base()
    const { parts: ps } = parts(d)
    const sides = named(ps, /^Left\/Right shell/)
    expect(sides).toHaveLength(2) // one per layer
    for (const p of sides) {
      expect(p.qty).toBe(2)
      expect(dims(p)).toEqual([1072, 522])
      expect(p.step).toBe('shell')
    }
    expect(sides.map((p) => p.thickness).sort()).toEqual([18, 18])
    const tb = named(ps, /^Top\/Bottom shell/)
    expect(tb.every((p) => p.qty === 2 && dims(p)[0] === 1400 && dims(p)[1] === 522)).toBe(true)
    const back = named(ps, /^Back shell/)
    expect(dims(back[0])).toEqual([1400, 1000])
    const t = sides.reduce((a, p) => a + p.thickness, 0)
    expect(t + tb[0].length + t).toBe(resolveDims(d).outer.x)
  })

  it('tops-past', () => {
    const d = base()
    d.joint = 'tops-past'
    const { parts: ps } = parts(d)
    expect(dims(named(ps, /^Top\/Bottom shell/)[0])).toEqual([1472, 522])
    expect(dims(named(ps, /^Left\/Right shell/)[0])).toEqual([1000, 522])
    expect(dims(named(ps, /^Back shell/)[0])).toEqual([1400, 1000])
  })

  it('mitre: each layer cut to its own long point, bevel from the wall thicknesses', () => {
    const d = base()
    d.joint = 'mitre'
    const ps = parts(d).parts
    const [ply, mdf] = named(ps, /^Left\/Right shell/)
    expect(dims(ply)).toEqual([1072, 522])
    expect(dims(mdf)).toEqual([1036, 486])
    expect(dims(named(ps, /^Top\/Bottom shell, layer 2/)[0])).toEqual([1436, 486])
    expect(dims(named(ps, /^Back shell, layer 2/)[0])).toEqual([1436, 1036])
    expect(ply.bevels).toHaveLength(4)
    expect(ply.bevels.every((b) => b.angle === 45)).toBe(true)
    // Left wall 54 mm against 36 mm neighbours: its mitres are flatter, the neighbours' steeper.
    d.wallOverrides.left = [...d.wallDefault, { kind: 'layer', materialId: 'mdf', thickness: 18 }]
    const ps2 = parts(d).parts
    const left = named(ps2, /^Left shell, layer 1/)[0]
    expect(left.bevels.map((b) => b.angle)).toEqual([33.7, 33.7, 33.7, 33.7])
    expect(dims(named(ps2, /^Left shell, layer 3/)[0])).toEqual([1072 - 2 * 24, 522 - 2 * 24])
    const top = named(ps2, /^Top\/Bottom shell, layer 1/)[0]
    expect(top.bevels.map((b) => b.angle).sort()).toEqual([45, 45, 45, 56.3])
  })

  it('rebate: separately cut layers in a staggered lap, no machining', () => {
    const d = base()
    d.joint = 'rebate'
    const ps = parts(d).parts
    expect(dims(named(ps, /^Left\/Right shell, layer 1/)[0])).toEqual([1072, 522])
    expect(dims(named(ps, /^Left\/Right shell, layer 2/)[0])).toEqual([1000, 486])
    expect(dims(named(ps, /^Top\/Bottom shell, layer 1/)[0])).toEqual([1436, 522])
    expect(dims(named(ps, /^Top\/Bottom shell, layer 2/)[0])).toEqual([1436, 486])
    expect(dims(named(ps, /^Back shell, layer 1/)[0])).toEqual([1436, 1036])
    expect(dims(named(ps, /^Back shell, layer 2/)[0])).toEqual([1400, 1000])
    expect(ps.some((p) => p.notes.join(' ').includes('rebate'))).toBe(false)
  })

  it('rebate with a single layer: plain sides-past, no rebate note', () => {
    const d = base()
    d.joint = 'rebate'
    d.wallDefault = [{ kind: 'layer', materialId: 'plywood', thickness: 18 }]
    const ps = parts(d).parts
    const side = named(ps, /^Left\/Right shell/)[0]
    expect(dims(side)).toEqual([1036, 486])
    expect(side.notes).toEqual([])
    expect(dims(named(ps, /^Top\/Bottom shell/)[0])).toEqual([1400, 486])
    expect(named(ps, /^Top\/Bottom shell/)[0].notes).toEqual([])
  })

  it('air gap with clips: liner box from inner + 2 x liner', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 25, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const { parts: ps, hardware } = parts(d)
    const ls = named(ps, /^Left\/Right liner/)
    expect(ls).toHaveLength(1)
    expect(ls[0].step).toBe('liner')
    expect(ls[0].materialId).toBe('mdf')
    expect(dims(ls[0])).toEqual([1036, 486])
    expect(dims(named(ps, /^Top\/Bottom liner/)[0])).toEqual([1400, 486])
    expect(dims(named(ps, /^Back liner/)[0])).toEqual([1400, 1000])
    const ss = named(ps, /^Left\/Right shell/)[0]
    expect(ss.materialId).toBe('plywood')
    expect(dims(ss)).toEqual([1122, 572])
    const clips = hardware.find((h) => h.name === 'Isolation clip')!
    expect(clips.unit).toBe('pcs')
    expect(clips.qty).toBe(52) // grid points per liner wall: 2x6 sides, 2x8 top/bottom, 2x12 back/front
    expect(ps.some((p) => p.kind === 'strip')).toBe(false)
  })

  it('air gap with strips gives 50 mm rubber strips', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 25, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const { parts: ps, hardware } = parts(d)
    const strips = ps.filter((p) => p.kind === 'strip')
    expect(strips.length).toBeGreaterThan(0)
    expect(strips.every((p) => p.width === 50 && p.materialId === 'rubber' && p.thickness === 25)).toBe(true)
    expect(hardware.find((h) => h.name === 'Isolation clip')).toBeUndefined()
  })
})

describe('buildParts middle boxes', () => {
  it('two cavities: a middle box with its own step, strips once per wall', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 20, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'osb', thickness: 12 },
      { kind: 'layer', materialId: 'mlv', thickness: 5 },
      { kind: 'gap', width: 30, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const ps = parts(d).parts
    const mid = named(ps, /^Left\/Right middle box 1, layer 1/)
    expect(mid).toHaveLength(1)
    expect(mid[0].step).toBe('middle')
    const strips = ps.filter((p) => p.kind === 'strip' && p.step === 'middle')
    // a long and a short pair per wall, not per layer
    expect(qty(strips)).toBe(6 * 4)
    expect(strips[0].notes).toEqual(['around the middle box 1 panel perimeter'])
  })
})

describe('buildParts door wall', () => {
  it('dual doors: opening note on the door wall panels', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 25, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const { parts: ps } = parts(d)
    expect(named(ps, /^Front shell/)[0].notes.join(' ')).toMatch(/cut opening \d+(\.\d)?×\d+(\.\d)? centred/)
    expect(named(ps, /^Front liner/)[0].notes.join(' ')).toMatch(/cut opening/)
    expect(named(ps, /^Back shell/)[0].notes.join(' ')).not.toMatch(/cut opening/)
  })

  it('wall door: points to the doors step', () => {
    const d = base()
    d.door.kind = 'wall'
    const front = named(parts(d).parts, /^Front shell/)[0]
    expect(front.notes).toContain('hinged wall: see doors step')
    expect(front.notes.join(' ')).not.toMatch(/cut opening/)
  })
})

describe('buildParts facets', () => {
  const withFacets = (facets: Facet[], closure: 'fillers' | 'sealant' = 'fillers', behind: 'insulation' | 'empty' = 'insulation') => {
    const d = base()
    d.interior.left = interior(facets, closure, behind)
    return d
  }

  it('default left wall: two facets, packers, one filler strip', () => {
    const { parts: ps } = parts(withFacets([f(180, 4, 'min'), f(180, 7, 'max')]))
    const facets = named(ps, /^Left facet/).sort((a, b) => a.name.localeCompare(b.name))
    expect(facets).toHaveLength(2)
    expect(facets.every((p) => p.step === 'facets' && p.thickness === 12)).toBe(true)
    expect(facets[0].width).toBeCloseTo(180.44, 0)
    expect(facets[1].width).toBeCloseTo(181.35, 0)
    expect(facets[0].length).toBe(1000)
    expect(facets[0].bevels).toEqual([{ edge: 'L1', angle: 4 }, { edge: 'L2', angle: 4 }])
    const packers = named(ps, /^Left packer/).sort((a, b) => a.name.localeCompare(b.name))
    expect(packers.map((p) => p.kind)).toEqual(['packer', 'packer'])
    expect(packers[0].thickness).toBeCloseTo(12.59, 2)
    expect(packers[1].thickness).toBeCloseTo(22.1, 2)
    const fillers = ps.filter((p) => p.kind === 'filler' && /strip/i.test(p.name))
    expect(fillers).toHaveLength(1)
    expect(fillers[0].width).toBe(9.5)
    expect(fillers[0].length).toBe(1000)
    expect(ps.filter((p) => p.kind === 'wedge').reduce((a, p) => a + p.qty, 0)).toBe(4)
    expect(named(ps, /bay fill/i)).toHaveLength(2)
  })

  it('sealant closure: no filler or wedge, sealant bead in metres', () => {
    const { parts: ps, hardware } = parts(withFacets([f(180, 4, 'min'), f(180, 7, 'max')], 'sealant'))
    expect(ps.some((p) => p.kind === 'wedge' || (p.kind === 'filler' && /strip/i.test(p.name)))).toBe(false)
    const bead = hardware.find((h) => h.name === 'Sealant bead')!
    expect(bead.unit).toBe('m')
    expect(bead.qty).toBeGreaterThan(1)
  })

  it('empty behind: no bay fill', () => {
    const { parts: ps } = parts(withFacets([f(180, 4)], 'fillers', 'empty'))
    expect(named(ps, /bay fill/i)).toHaveLength(0)
  })

  it('unequal widths give 120/cos and 240/cos', () => {
    const { parts: ps } = parts(withFacets([f(120, 5), f(240, 5)]))
    const fs = named(ps, /^Left facet/).sort((a, b) => a.width - b.width)
    expect(fs[0].width).toBeCloseTo(120 / Math.cos((5 * Math.PI) / 180), 0)
    expect(fs[1].width).toBeCloseTo(240 / Math.cos((5 * Math.PI) / 180), 0)
  })

  it('bevel above the saw limit warns', () => {
    const d = withFacets([f(180, 4), f(180, 7)])
    const { parts: ps } = parts(d, { ...shop, maxBevel: 5 })
    const big = named(ps, /^Left facet/).filter((p) => p.warnings.length > 0)
    expect(big).toHaveLength(1)
    expect(big[0].warnings[0]).toBe("Bevel 7° exceeds your saw's 5°: cut the complement 83° or use a packer strip")
    expect(named(ps, /^Left facet/).filter((p) => p.warnings.length === 0)).toHaveLength(1)
  })

  it('facets on the door wall produce no parts', () => {
    const d = base()
    d.interior.front = interior([f(180, 7)])
    const { parts: ps } = parts(d)
    expect(ps.filter((p) => p.step === 'facets')).toHaveLength(0)
  })

  it('later walls are shortened by earlier walls intrusions', () => {
    const d = base()
    d.interior.left = interior([f(180, 4)])
    d.interior.top = { ...interior([f(180, 4)]), splitAxis: 'z' }
    const top = named(parts(d).parts, /^Top facet/)[0]
    // top spans x; left/right are earlier: 1400 minus left intrusion (12 + 180 tan 4) minus right (0 facets, 0)
    const left = 12 + 180 * Math.tan((4 * Math.PI) / 180)
    expect(top.length).toBeCloseTo(1400 - left, 0)
  })
})

describe('buildParts review fixes', () => {
  it('tilt 0 facet: no packer, bay fill, wedges or bevels', () => {
    const d = base()
    d.interior.left = interior([f(180, 0), f(180, 0)])
    const ps = parts(d).parts.filter((p) => p.step === 'facets')
    expect(ps.every((p) => p.thickness > 0)).toBe(true)
    expect(ps.some((p) => p.kind === 'packer' || p.kind === 'wedge' || /bay fill/.test(p.name))).toBe(false)
    expect(ps.every((p) => p.bevels.length === 0)).toBe(true)
  })

  it('bevels sit on the edges running along the span', () => {
    const d = base()
    d.interior.left = { ...interior([f(500, 5)]), splitAxis: 'y' }
    const facet = named(parts(d).parts, /^Left facet/)[0]
    expect(facet.length).toBeGreaterThan(450)
    expect(facet.width).toBe(450)
    expect(facet.bevels.map((b) => b.edge)).toEqual(['W1', 'W2'])
  })

  it('names list walls and material; overrides stay distinct', () => {
    const d = base()
    d.wallOverrides.top = [{ kind: 'layer', materialId: 'osb', thickness: 18 }]
    const ps = parts(d).parts
    expect(ps.some((p) => p.name === 'Left/Right shell, layer 1 (Plywood)')).toBe(true)
    expect(ps.some((p) => p.name === 'Top shell, layer 1 (OSB)')).toBe(true)
    expect(ps.some((p) => p.name === 'Bottom shell, layer 1 (Plywood)')).toBe(true)
  })

  it('strip material falls back to the first roll material', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 25, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const l2 = { ...lib, materials: lib.materials.filter((m) => m.id !== 'rubber') }
    const strip = buildParts(d, l2, shop).parts.find((p) => p.kind === 'strip')!
    expect(strip.materialId).toBe('mlv')
  })
})

describe('buildParts minimum size', () => {
  it('warns below minPart', () => {
    const d = base()
    d.interior.left = interior([f(20, 5)])
    const { parts: ps } = parts(d)
    expect(named(ps, /^Left facet/)[0].warnings).toContain('Below minimum part size')
  })
})

describe('buildParts inner panels and treatments', () => {
  it('panel: one part per layer plus insulation', () => {
    const d = base()
    d.panels = [{
      id: 'p1', normal: 'x', position: 500, u0: 0, u1: 1000, v0: 0, v1: 450,
      layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }, { kind: 'layer', materialId: 'mdf', thickness: 12 }],
      insulation: { materialId: 'rockwool', thickness: 50 },
    }]
    const ps = parts(d).parts.filter((p) => p.step === 'panels')
    expect(ps).toHaveLength(3)
    expect(ps.every((p) => dims(p)[0] === 1000 && dims(p)[1] === 450)).toBe(true)
    expect(ps.find((p) => p.materialId === 'rockwool')!.thickness).toBe(50)
  })

  it('flat wall treatment reduced by earlier walls', () => {
    const d = base()
    d.treatments = [{ id: 't1', surface: { wall: 'top' }, materialId: 'rockwool', thickness: 50 }]
    d.interior.left = interior([f(180, 4)])
    const t = parts(d).parts.filter((p) => p.step === 'treatment')
    expect(t).toHaveLength(1)
    const left = 12 + 180 * Math.tan((4 * Math.PI) / 180)
    expect(t[0].thickness).toBe(50)
    expect(t[0].width).toBeCloseTo(450, 0) // z axis: back/front have no intrusion
    expect(t[0].length).toBeCloseTo(1400 - left, 0)
  })

  it('treatment on a faceted wall: one part per facet', () => {
    const d = base()
    d.interior.left = interior([f(180, 4), f(180, 7, 'max')])
    d.treatments = [{ id: 't1', surface: { wall: 'left' }, materialId: 'carpet', thickness: 8 }]
    const t = parts(d).parts.filter((p) => p.step === 'treatment')
    expect(t).toHaveLength(2)
    expect(t.every((p) => p.kind === 'roll' && p.thickness === 8)).toBe(true)
    expect(t.map((p) => p.width).sort((a, b) => a - b)[0]).toBeCloseTo(180.44, 0)
  })

  it('roll goods carry a roll note', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'layer', materialId: 'mlv', thickness: 5 },
    ]
    const mlv = named(parts(d).parts, /^Back shell/).find((p) => p.materialId === 'mlv')!
    expect(mlv.kind).toBe('roll')
    expect(mlv.notes.join(' ')).toMatch(/roll width 1220, 1 strip, overlap 50/)
  })
})

describe('buildParts ids', () => {
  it('ids follow step order then name', () => {
    const d = base()
    d.interior.left = interior([f(180, 4)])
    const { parts: ps } = parts(d)
    expect(ps.map((p) => p.id)).toEqual(ps.map((_, i) => `P${i + 1}`))
    const order = ['shell', 'liner', 'facets', 'panels', 'treatment', 'doors']
    const idx = ps.map((p) => order.indexOf(p.step))
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
})
