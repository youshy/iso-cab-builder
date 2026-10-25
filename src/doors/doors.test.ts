import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design } from '../model/schema'
import { doorLayout } from './doors'

const lib = defaultLibrary()
const gapStack = (): Design['wallDefault'] => [
  { kind: 'layer', materialId: 'plywood', thickness: 18 },
  { kind: 'gap', width: 50, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' },
  { kind: 'layer', materialId: 'mdf', thickness: 18 },
]

describe('doorLayout', () => {
  it('default design: left side, 390x1010 opening, 440x1060 leaf, 3 hinges', () => {
    const l = doorLayout(defaultDesign(), lib)
    expect(l.side).toBe('left')
    expect(l.outer.opening).toEqual({ w: 390, h: 1010 })
    expect(l.outer.leaves).toEqual([{ w: 440, h: 1060, t: 18 }])
    expect(l.outer.hinges).toEqual([{ edge: 'left', positions: [150, 530, 910] }])
    expect(l.outer.mount).toBe('shell')
    expect(l.cabsThrough.every((c) => c.fits)).toBe(true)
  })

  it('latches sit on the opposite edge, evenly spaced from the inset', () => {
    const l = doorLayout(defaultDesign(), lib)
    expect(l.outer.latches).toEqual([100, 960])
  })

  it('framed, gap off: frame lines the reveal; cutout grows by the strips', () => {
    const d = defaultDesign()
    d.door.outer.framed = true
    d.door.inner.framed = true
    const l = doorLayout(d, lib)
    expect(l.outer.frame).toEqual({ width: 45, depth: 12 }) // betweenDepth = 36 - (18 + 6)
    expect(l.inner.frame).toEqual({ width: 45, depth: 24 }) // rebate depth
    expect(l.outer.cutout).toEqual({ w: 480, h: 1100 })
    expect(l.outer.opening).toEqual({ w: 390, h: 1010 })
    expect(l.cabsThrough.every((c) => c.fits)).toBe(true)
  })

  it('framed, gap on: frame depth is the shell or liner thickness', () => {
    const d = defaultDesign()
    d.wallDefault = gapStack()
    d.door.outer.framed = true
    d.door.inner.framed = true
    const l = doorLayout(d, lib)
    expect(l.outer.frame?.depth).toBe(18)
    expect(l.inner.frame?.depth).toBe(18)
  })

  it('unframed cutout equals the clear opening', () => {
    expect(doorLayout(defaultDesign(), lib).outer.cutout).toEqual({ w: 390, h: 1010 })
  })

  it('leaf shorter than 900 gets 2 hinges', () => {
    const d = defaultDesign()
    d.door.opening = { w: 390, h: 600 }
    expect(doorLayout(d, lib).outer.hinges[0].positions).toEqual([150, 650 - 150])
  })

  it('top hinge edge spaces hinges along the leaf width', () => {
    const d = defaultDesign()
    d.door.outer.hingeEdge = 'top'
    const l = doorLayout(d, lib)
    expect(l.outer.hinges).toEqual([{ edge: 'top', positions: [150, 290] }])
    expect(l.outer.swingRadius).toBe(1060)
  })

  it('outer leaf opening in with insulation between collides', () => {
    const d = defaultDesign()
    d.door.outer.opening = 'in'
    const l = doorLayout(d, lib)
    expect(l.collisions.some((c) => c.startsWith("Outer door can't swing inwards: needs 440 mm, has 12 mm"))).toBe(true)
  })

  it('gap toggle moves inner mount liner <-> rebate and recomputes betweenDepth', () => {
    const d = defaultDesign()
    const off = doorLayout(d, lib)
    expect(off.inner.mount).toBe('rebate')
    expect(off.inner.rebate).toEqual({ depth: 24, width: 25 })
    expect(off.betweenDepth).toBe(12)
    d.wallDefault = gapStack()
    const on = doorLayout(d, lib)
    expect(on.inner.mount).toBe('liner')
    expect(on.betweenDepth).toBe(86 - 24)
    expect(on.outer.leaves[0].t).toBe(18)
  })

  it('split leaves sum to leaf width minus 3 and hinge both sides', () => {
    const d = defaultDesign()
    d.door.outer.opening = 'split'
    const l = doorLayout(d, lib)
    expect(l.outer.leaves).toHaveLength(2)
    expect(l.outer.leaves[0].w + l.outer.leaves[1].w).toBe(440 - 3)
    expect(l.outer.hinges.map((h) => h.edge)).toEqual(['left', 'right'])
  })

  it('inner out is a note when outer opens out, a collision when outer opens in', () => {
    const d = defaultDesign()
    d.door.inner.opening = 'out'
    expect(doorLayout(d, lib).notes).toContain('Open the outer door first')
    d.door.outer.opening = 'in'
    expect(doorLayout(d, lib).collisions).toContain(
      "Inner door can't open outwards while the outer door opens inwards",
    )
  })

  it('inner in collides when it would hit the sim cab', () => {
    const d = defaultDesign()
    d.door.inner.opening = 'in'
    const l = doorLayout(d, lib)
    expect(l.collisions.some((c) => c.startsWith("Inner door can't swing inwards: needs 440 mm, has 20 mm"))).toBe(true)
  })

  it('not enough depth when the inner leaf and seal fill the wall', () => {
    const d = defaultDesign()
    d.door.inner.stack = [{ kind: 'layer', materialId: 'plywood', thickness: 30 }]
    const l = doorLayout(d, lib)
    expect(l.collisions).toContain('Not enough wall depth for two doors')
  })

  it('opening override too small blocks the cab', () => {
    const d = defaultDesign()
    d.door.opening = { w: 300, h: 1010 }
    expect(doorLayout(d, lib).cabsThrough[0].fits).toBe(false)
  })
})
