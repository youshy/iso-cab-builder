import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Axis, Design, StackItem } from '../model/schema'
import { boxBounds, hasSingleLayerBox, wallBoxes, type BoxPanel } from './boxes'

const lib = defaultLibrary()
const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.dims.innerSource = 'manual'
  d.dims.inner = { x: 1400, y: 1000, z: 450 }
  d.door.side = 'front'
  return d
}
const gapStack = (width = 25): StackItem[] => [
  { kind: 'layer', materialId: 'plywood', thickness: 18 },
  { kind: 'gap', width, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
  { kind: 'layer', materialId: 'mdf', thickness: 18 },
]
const range = (p: BoxPanel, a: Axis) => [p.min[a], p.max[a]]
const size = (p: BoxPanel) => [p.max[p.lengthAxis] - p.min[p.lengthAxis], p.max[p.widthAxis] - p.min[p.widthAxis]]
const of = (ps: BoxPanel[], wall: string, box = 0) => ps.filter((p) => p.wall === wall && p.boxIndex === box)

describe('wallBoxes', () => {
  it('no gap, sides-past: one box of two layers per wall, same dims as the cut list', () => {
    const ps = wallBoxes(base(), lib)
    expect(new Set(ps.map((p) => p.boxIndex))).toEqual(new Set([0]))
    const [ply, mdf] = of(ps, 'left')
    expect([ply.materialId, ply.layerIndex, mdf.materialId, mdf.layerIndex]).toEqual(['plywood', 0, 'mdf', 1])
    expect(range(ply, 'x')).toEqual([-36, -18])
    expect(range(mdf, 'x')).toEqual([-18, 0])
    for (const p of [ply, mdf]) {
      expect(size(p)).toEqual([1072, 522])
      expect(range(p, 'y')).toEqual([-36, 1036])
      expect(p.lengthAxis).toBe('y')
    }
    expect(size(of(ps, 'top')[0])).toEqual([1400, 522])
    expect(range(of(ps, 'top')[0], 'x')).toEqual([0, 1400])
    expect(size(of(ps, 'back')[0])).toEqual([1400, 1000])
    expect(of(ps, 'back').every((p) => p.cutout === null && !p.door)).toBe(true)
  })

  it('one gap: two separate nested boxes, nothing of the liner box in the gap', () => {
    const d = base()
    d.wallDefault = gapStack(25)
    const ps = wallBoxes(d, lib)
    const [b0, b1] = boxBounds(d)
    expect(b0.outer.x).toEqual([-61, 1461])
    expect(b0.outer.y[1] - b0.outer.y[0]).toBe(1000 + 2 * 61)
    expect(b1.outer.x).toEqual([-18, 1418])
    expect(b1.outer.z[1] - b1.outer.z[0]).toBe(450 + 36)
    expect(b1.cavity.x).toEqual([0, 1400])
    const [liner] = of(ps, 'left', 1)
    expect(liner.materialId).toBe('mdf')
    expect(range(liner, 'x')).toEqual([-18, 0])
    expect(range(liner, 'y')).toEqual([-18, 1018])
    const [shell] = of(ps, 'left', 0)
    expect(shell.materialId).toBe('plywood')
    expect(range(shell, 'x')).toEqual([-61, -43])
    expect(range(shell, 'y')).toEqual([-61, 1061])
    // sides-past inside each box: the top runs between that box's sides
    expect(range(of(ps, 'top', 1)[0], 'x')).toEqual([0, 1400])
    expect(range(of(ps, 'top', 0)[0], 'x')).toEqual([-43, 1443])
    for (const p of ps.filter((q) => q.boxIndex === 1)) {
      expect(p.min.x).toBeGreaterThanOrEqual(-18)
      expect(p.max.x).toBeLessThanOrEqual(1418)
      expect(p.min.y).toBeGreaterThanOrEqual(-18)
      expect(p.min.z).toBeGreaterThanOrEqual(-18)
    }
  })

  it('two gaps give three boxes, the middle one cut with the middle cutout', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 20, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'osb', thickness: 12 },
      { kind: 'gap', width: 30, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const ps = wallBoxes(d, lib)
    const bs = boxBounds(d)
    expect(bs).toHaveLength(3)
    expect(bs.map((b) => b.outer.x[0])).toEqual([-98, -60, -18])
    expect(range(of(ps, 'left', 1)[0], 'x')).toEqual([-60, -48])
    expect(of(ps, 'front', 1).every((p) => p.cutout !== null)).toBe(true)
  })

  it('tops-past and mitre match the joint rules', () => {
    const d = base()
    d.joint = 'tops-past'
    let ps = wallBoxes(d, lib)
    expect(size(of(ps, 'top')[0])).toEqual([1472, 522])
    expect(size(of(ps, 'left')[0])).toEqual([1000, 522])
    expect(range(of(ps, 'left')[0], 'y')).toEqual([0, 1000])
    expect(size(of(ps, 'back')[0])).toEqual([1400, 1000])
    d.joint = 'mitre'
    ps = wallBoxes(d, lib)
    const left = of(ps, 'left')[0]
    expect(size(left)).toEqual([1072, 522])
    expect(left.joinedEdges.map((e) => e.kind)).toEqual(['mitre', 'mitre', 'mitre', 'mitre'])
    // the MDF layer starts 18 mm in, so its outer face is 18 mm shorter at each mitred end
    const mdf = of(ps, 'left')[1]
    expect(range(mdf, 'y')).toEqual([-18, 1018])
    expect(range(mdf, 'z')).toEqual([-18, 468])
    expect(mdf.taper.W1).toEqual([0, 18])
  })

  it('rebate is a staggered lap: ring 1 sides-past, ring 2 tops-past, each against its own ring', () => {
    const d = base()
    d.joint = 'rebate'
    const ps = wallBoxes(d, lib)
    const [lPly, lMdf] = of(ps, 'left'), [tPly, tMdf] = of(ps, 'top'), [bPly, bMdf] = of(ps, 'back')
    expect([range(lPly, 'y'), range(lPly, 'z')]).toEqual([[-36, 1036], [-36, 486]])
    expect([range(tPly, 'x'), range(tPly, 'z')]).toEqual([[-18, 1418], [-36, 486]])
    expect([range(bPly, 'x'), range(bPly, 'y')]).toEqual([[-18, 1418], [-18, 1018]])
    expect([range(lMdf, 'y'), range(lMdf, 'z')]).toEqual([[0, 1000], [-18, 468]])
    expect([range(tMdf, 'x'), range(tMdf, 'z')]).toEqual([[-18, 1418], [-18, 468]])
    expect([range(bMdf, 'x'), range(bMdf, 'y')]).toEqual([[0, 1400], [0, 1000]])
    expect(ps.every((p) => p.joinedEdges.every((e) => e.kind === 'butt'))).toBe(true)
  })

  it('single layer rebate: plain sides-past butts, flagged for the joint hint', () => {
    const d = base()
    d.joint = 'rebate'
    expect(hasSingleLayerBox(d)).toBe(false)
    d.wallOverrides.top = [{ kind: 'layer', materialId: 'plywood', thickness: 18 }]
    expect(hasSingleLayerBox(d)).toBe(true)
    delete d.wallOverrides.top
    d.wallDefault = gapStack()
    expect(hasSingleLayerBox(d)).toBe(true)
    const ps = wallBoxes(d, lib)
    expect(ps.every((p) => p.joinedEdges.every((e) => e.kind === 'butt'))).toBe(true)
    expect(range(of(ps, 'top', 1)[0], 'x')).toEqual([0, 1400])
  })

  it('door wall: outer cutout on the outer box, inner cutout on the liner box; wall door has none', () => {
    const d = base()
    d.wallDefault = gapStack()
    d.door.outer.framed = true
    d.door.outer.frameWidth = 40
    const ps = wallBoxes(d, lib)
    const c = (p: BoxPanel) => p.cutout!
    const shell = of(ps, 'front', 0)[0], liner = of(ps, 'front', 1)[0]
    expect(c(shell).u1 - c(shell).u0).toBeGreaterThan(c(liner).u1 - c(liner).u0)
    expect((c(shell).u0 + c(shell).u1) / 2).toBeCloseTo(700, 6)
    expect((c(shell).v0 + c(shell).v1) / 2).toBeCloseTo(500, 6)
    d.door.kind = 'wall'
    const wp = wallBoxes(d, lib).filter((p) => p.wall === 'front')
    expect(wp.every((p) => p.door && p.cutout === null)).toBe(true)
  })

  describe('door cutouts follow the inner leaf', () => {
    // 390 x 800 clear opening, 25 overlap: inner leaf 440 x 850 x 18, seal 6, so the rebate is 24 deep.
    const doorDesign = () => {
      const d = base()
      d.door.opening = { w: 390, h: 800 }
      return d
    }
    const wh = (c: { u0: number; u1: number; v0: number; v1: number }) => [c.u1 - c.u0, c.v1 - c.v0]

    it('gap off: a layer inside the rebate is cut to the leaf plus 2 mm each side; the layer it enters keeps the clear cutout and is routed', () => {
      const [ply, mdf] = of(wallBoxes(doorDesign(), lib), 'front')
      expect(wh(mdf.cutout!)).toEqual([444, 854])
      expect(mdf.rebate).toBeNull()
      expect(wh(ply.cutout!)).toEqual([390, 800])
      expect(ply.rebate).toMatchObject({ depth: 6, width: 27 })
      expect(wh(ply.rebate!.cutout)).toEqual([444, 854])
    })

    it('gap on: the liner is cut to the leaf plus clearance, the shell to the clear opening', () => {
      const d = doorDesign()
      d.wallDefault = gapStack()
      const ps = wallBoxes(d, lib)
      const [shell] = of(ps, 'front', 0), [liner] = of(ps, 'front', 1)
      expect(wh(liner.cutout!)).toEqual([444, 854])
      expect(wh(shell.cutout!)).toEqual([390, 800])
      expect([shell.rebate, liner.rebate]).toEqual([null, null])
    })

    it('framed inner leaf: the pocket layers grow by the frame strips; the routed layer is unchanged', () => {
      const d = doorDesign()
      d.door.inner.framed = true
      d.door.inner.frameWidth = 30
      const [ply, mdf] = of(wallBoxes(d, lib), 'front')
      expect(wh(mdf.cutout!)).toEqual([504, 914])
      expect(wh(ply.cutout!)).toEqual([390, 800])
      expect(ply.rebate).toMatchObject({ depth: 6, width: 27 })
    })

    it('framed outer leaf wider than the pocket margin: no rout needed', () => {
      const d = doorDesign()
      d.door.outer.framed = true
      d.door.outer.frameWidth = 40
      const [ply] = of(wallBoxes(d, lib), 'front')
      expect(wh(ply.cutout!)).toEqual([470, 880])
      expect(ply.rebate).toBeNull()
    })
  })
})
