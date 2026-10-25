import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design } from '../model/schema'
import { DesignSchema } from '../model/schema'
import { doorLayout, type DoorLayout, type LeafLayout } from './doors'
import { resolveDims } from '../geometry/dimensions'

const lib = defaultLibrary()
/** doorLayout for a dual-door design, with the leaves known to be present. */
const dualLayout = (d: Design, l = lib): DoorLayout & { outer: LeafLayout; inner: LeafLayout } => {
  const r = doorLayout(d, l)
  if (!r.outer || !r.inner) throw new Error('expected dual door layout')
  return { ...r, outer: r.outer, inner: r.inner }
}
const gapStack = (): Design['wallDefault'] => [
  { kind: 'layer', materialId: 'plywood', thickness: 18 },
  { kind: 'gap', width: 50, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' },
  { kind: 'layer', materialId: 'mdf', thickness: 18 },
]

describe('doorLayout', () => {
  it('default design: left side, 390x1010 opening, 440x1060 leaf, 3 hinges', () => {
    const l = dualLayout(defaultDesign(), lib)
    expect(l.side).toBe('left')
    expect(l.outer.opening).toEqual({ w: 390, h: 1010 })
    expect(l.outer.leaves).toEqual([{ w: 440, h: 1060, t: 18 }])
    expect(l.outer.hinges).toEqual([{ edge: 'left', positions: [150, 530, 910] }])
    expect(l.outer.mount).toBe('shell')
    expect(l.cabsThrough.every((c) => c.fits)).toBe(true)
  })

  it('latches sit on the opposite edge, evenly spaced from the inset', () => {
    const l = dualLayout(defaultDesign(), lib)
    expect(l.outer.latches).toEqual([100, 960])
  })

  it('framed, gap off: frame lines the reveal; cutout grows by the strips', () => {
    const d = defaultDesign()
    d.door.outer.framed = true
    d.door.inner.framed = true
    const l = dualLayout(d, lib)
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
    const l = dualLayout(d, lib)
    expect(l.outer.frame?.depth).toBe(18)
    expect(l.inner.frame?.depth).toBe(18)
  })

  it('unframed cutout equals the clear opening', () => {
    expect(dualLayout(defaultDesign(), lib).outer.cutout).toEqual({ w: 390, h: 1010 })
  })

  it('leaf shorter than 900 gets 2 hinges', () => {
    const d = defaultDesign()
    d.door.opening = { w: 390, h: 600 }
    expect(dualLayout(d, lib).outer.hinges[0].positions).toEqual([150, 650 - 150])
  })

  it('top hinge edge spaces hinges along the leaf width', () => {
    const d = defaultDesign()
    d.door.outer.hingeEdge = 'top'
    const l = dualLayout(d, lib)
    expect(l.outer.hinges).toEqual([{ edge: 'top', positions: [150, 290] }])
    expect(l.outer.swingRadius).toBe(1060)
  })

  it('outer leaf opening in with insulation between collides', () => {
    const d = defaultDesign()
    d.door.outer.opening = 'in'
    const l = dualLayout(d, lib)
    expect(l.collisions.some((c) => c.startsWith("Outer door can't swing inwards: needs 440 mm, has 12 mm"))).toBe(true)
  })

  it('gap toggle moves inner mount liner <-> rebate and recomputes betweenDepth', () => {
    const d = defaultDesign()
    const off = dualLayout(d, lib)
    expect(off.inner.mount).toBe('rebate')
    expect(off.inner.rebate).toEqual({ depth: 24, width: 25 })
    expect(off.betweenDepth).toBe(12)
    d.wallDefault = gapStack()
    const on = dualLayout(d, lib)
    expect(on.inner.mount).toBe('liner')
    expect(on.betweenDepth).toBe(86 - 24)
    expect(on.outer.leaves[0].t).toBe(18)
  })

  it('split leaves sum to leaf width minus 3 and hinge both sides', () => {
    const d = defaultDesign()
    d.door.outer.opening = 'split'
    const l = dualLayout(d, lib)
    expect(l.outer.leaves).toHaveLength(2)
    expect(l.outer.leaves[0].w + l.outer.leaves[1].w).toBe(440 - 3)
    expect(l.outer.hinges.map((h) => h.edge)).toEqual(['left', 'right'])
  })

  it('inner out is a note when outer opens out, a collision when outer opens in', () => {
    const d = defaultDesign()
    d.door.inner.opening = 'out'
    expect(dualLayout(d, lib).notes).toContain('Open the outer door first')
    d.door.outer.opening = 'in'
    expect(dualLayout(d, lib).collisions).toContain(
      "Inner door can't open outwards while the outer door opens inwards",
    )
  })

  it('inner in collides when it would hit the sim cab', () => {
    const d = defaultDesign()
    d.door.inner.opening = 'in'
    const l = dualLayout(d, lib)
    expect(l.collisions.some((c) => c.startsWith("Inner door can't swing inwards: needs 440 mm, has 20 mm"))).toBe(true)
  })

  it('not enough depth when the inner leaf and seal fill the wall', () => {
    const d = defaultDesign()
    d.door.inner.stack = [{ kind: 'layer', materialId: 'plywood', thickness: 30 }]
    const l = dualLayout(d, lib)
    expect(l.collisions).toContain('Not enough wall depth for two doors')
  })

  it('opening override too small blocks the cab', () => {
    const d = defaultDesign()
    d.door.opening = { w: 300, h: 1010 }
    expect(dualLayout(d, lib).cabsThrough[0].fits).toBe(false)
  })
})

describe('whole-wall door', () => {
  const wallDesign = (): Design => {
    const d = structuredClone(defaultDesign())
    d.door.kind = 'wall'
    d.door.side = 'left'
    return d
  }

  it('left wall: panel is outer z x y, mass from layer densities, one shell seal', () => {
    const d = wallDesign()
    const o = resolveDims(d).outer
    const l = doorLayout(d, lib)
    expect(l.kind).toBe('wall')
    expect(l.outer).toBeNull()
    expect(l.inner).toBeNull()
    const w = l.wall!
    expect(w.side).toBe('left')
    expect(w.panel).toEqual({ w: o.z, h: o.y, t: 36 })
    expect(w.massKg).toBeCloseTo((600 * 0.018 + 750 * 0.018) * ((o.z * o.y) / 1e6), 2)
    expect(w.seals).toEqual([{ line: 'shell', perimeterMm: 2 * (o.z + o.y) }])
    expect(w.swingRadius).toBe(o.z)
    expect(l.cabsThrough.every((c) => c.fits)).toBe(true)
    expect(w.notes).toContain('Seals are not included in the sound estimate')
  })

  it('front wall panel is outer x by y', () => {
    const d = wallDesign()
    d.door.side = 'front'
    const o = resolveDims(d).outer
    expect(doorLayout(d, lib).wall!.panel).toMatchObject({ w: o.x, h: o.y })
  })

  it('a gap in the stack adds a liner seal line on the inner face', () => {
    const d = wallDesign()
    d.wallDefault = gapStack()
    const i = resolveDims(d).inner
    const w = doorLayout(d, lib).wall!
    expect(w.seals.map((s) => s.line)).toEqual(['shell', 'liner'])
    expect(w.seals[1].perimeterMm).toBe(2 * (i.z + i.y))
  })

  it('collides when the room in front is smaller than the swing radius', () => {
    const d = wallDesign()
    d.door.roomClearance = 300
    const w = doorLayout(d, lib).wall!
    expect(w.swingRadius).toBeGreaterThan(300)
    expect(w.collisions.join(' ')).toContain('needs')
    expect(doorLayout(d, lib).collisions).toEqual(w.collisions)
    d.door.roomClearance = 5000
    expect(doorLayout(d, lib).wall!.collisions).toEqual([])
  })

  it('hinges: 3 for an edge under 1200, 4 from 1200', () => {
    const d = wallDesign()
    expect(doorLayout(d, lib).wall!.hinges).toHaveLength(3)
    d.dims.innerSource = 'manual'
    d.dims.inner.y = 1400
    const w = doorLayout(d, lib).wall!
    expect(w.hinges).toHaveLength(4)
    expect(w.hingeEdge).toBe('left')
    expect(w.hinges[0]).toBe(150) // butt-75 edge inset
    expect(w.latches).toHaveLength(2)
  })

  it('old JSON without kind and roomClearance parses with defaults', () => {
    const raw = JSON.parse(JSON.stringify(defaultDesign()))
    delete raw.door.kind
    delete raw.door.roomClearance
    const d = DesignSchema.parse(raw)
    expect(d.door.kind).toBe('dual')
    expect(d.door.roomClearance).toBe(600)
  })

  it('dual mode has no wall layout', () => {
    const l = doorLayout(defaultDesign(), lib)
    expect(l.kind).toBe('dual')
    expect(l.wall).toBeNull()
  })
})
