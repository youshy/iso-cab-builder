import { describe, expect, it } from 'vitest'
import { buildParts } from '../cutlist/parts'
import { defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import type { Axis, Design, StackItem } from '../model/schema'
import { boxBounds, wallBoxes, type BoxPanel } from './boxes'

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
    d.joint = 'rebate'
    ps = wallBoxes(d, lib)
    const top = of(ps, 'top')[0]
    expect(size(top)).toEqual([1436, 522])
    expect(top.joinedEdges.filter((e) => e.kind === 'rebate').map((e) => e.edge)).toEqual(['W1', 'W2'])
  })

  it('every wall layer has the cut list dims, for every joint and with a gap', () => {
    for (const joint of ['sides-past', 'tops-past', 'rebate', 'mitre'] as const) {
      for (const stack of [null, gapStack(40)]) {
        const d = base()
        d.joint = joint
        if (stack) d.wallDefault = stack
        const parts = buildParts(d, lib, defaultShop()).parts.filter((p) => p.step === 'shell' || p.step === 'liner')
        const r05 = (n: number) => Math.round(n * 2) / 2
        for (const p of wallBoxes(d, lib)) {
          const [l, w] = size(p).map(r05)
          expect(parts.some((q) => q.materialId === p.materialId && q.thickness === p.thickness && q.length === l && q.width === w)).toBe(true)
        }
      }
    }
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
})
