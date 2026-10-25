import { doorLayout, SPLIT_GAP, type LeafLayout } from '../doors/doors'
import type { Axis, Design, Library, WallId } from '../model/schema'
import { around, boxBounds, boxPart, facetSpan, panelPieces, wallBoxes, wallSpan, type Range, type Rect } from './boxes'
import { resolveDims } from './dimensions'
import { packingDepth } from './facets'
import { clampTo, panelPlane } from './panels'
import { cabBox } from './space'
import { panelExtent, panelTreatments, wallTreatments } from './treatments'
import { activeInterior, stackThickness, wallNormal, wallPlaneAxes, wallStack, WALLS } from './walls'

export type SolidKind = 'layer' | 'facet' | 'panel' | 'cab' | 'door' | 'treatment'
export type Solid = {
  name: string
  kind: SolidKind
  wall?: WallId
  /** Wall layers: the material, which box it belongs to (outermost shell, innermost liner) and whether it belongs to a whole-wall door. */
  materialId?: string
  part?: 'shell' | 'liner' | 'middle'
  door?: boolean
  vertices: number[]
  indices: number[]
}

const AXES: Axis[] = ['x', 'y', 'z']
const HIGH: WallId[] = ['right', 'top', 'front']

// Two triangles per face of the 8-vertex box: bottom ring 0..3, top ring 4..7.
const BOX_INDICES = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
]

/** Hexahedron between quad0 at c = c0 and quad1 at c = c1, both in the (a, b) plane with corners in the same order. */
function hexa(
  name: string, kind: SolidKind, wall: WallId | undefined,
  [a, b, c]: [Axis, Axis, Axis], quad0: [number, number][], quad1: [number, number][], c0: number, c1: number,
): Solid {
  const vertices: number[] = []
  for (const [cv, quad] of [[c0, quad0], [c1, quad1]] as const) {
    for (const [av, bv] of quad) {
      const p: Record<Axis, number> = { x: 0, y: 0, z: 0 }
      p[a] = av; p[b] = bv; p[c] = cv
      vertices.push(p.x, p.y, p.z)
    }
  }
  return { name, kind, wall, vertices, indices: [...BOX_INDICES] }
}

/** Prism: a quad in the (a, b) plane extruded along c from c0 to c1. Quad corners are in order. */
const prism = (
  name: string, kind: SolidKind, wall: WallId | undefined,
  axes: [Axis, Axis, Axis], quad: [number, number][], c0: number, c1: number,
): Solid => hexa(name, kind, wall, axes, quad, quad, c0, c1)

/** Axis-aligned box from per-axis ranges. */
function box(name: string, kind: SolidKind, wall: WallId | undefined, r: Record<Axis, [number, number]>): Solid {
  return prism(name, kind, wall, ['x', 'y', 'z'], [
    [r.x[0], r.y[0]], [r.x[1], r.y[0]], [r.x[1], r.y[1]], [r.x[0], r.y[1]],
  ], r.z[0], r.z[1])
}

const otherAxes = (n: Axis): [Axis, Axis] => AXES.filter((a) => a !== n) as [Axis, Axis]

/**
 * Pure mesh description of the design in domain coordinates (mm, origin at the inner
 * back-bottom-left corner, front = +z). Wall layers come from the nested boxes of `wallBoxes`,
 * the same model the cut list uses: one solid per layer (or per piece around a door cutout).
 */
export function buildScene(d: Design, lib: Library): { solids: Solid[] } {
  const { inner } = resolveDims(d)
  const door = doorLayout(d, lib)
  const side = door.side
  // The door sits centred in its wall: width along x (front) or z (left/right), height along y.
  const wAxis: Axis = side === 'front' ? 'x' : 'z'
  const hAxis: Axis = 'y'
  const centre = { w: inner[wAxis] / 2, h: inner[hAxis] / 2 }
  const centred = (size: { w: number; h: number }): Rect => [
    [centre.w - size.w / 2, centre.w + size.w / 2], [centre.h - size.h / 2, centre.h + size.h / 2],
  ]
  const solids: Solid[] = []

  const boxes = boxBounds(d).length
  for (const p of wallBoxes(d, lib)) {
    const part = boxPart(p.boxIndex, boxes)
    const name = `${p.wall}-${part === 'middle' ? `middle-${p.boxIndex}` : part}-${p.layerIndex + 1}`
    const n = wallNormal(p.wall)
    const [L, W] = [p.lengthAxis, p.widthAxis]
    const tag = { materialId: p.materialId, part, ...(p.door ? { door: true } : {}) }
    const pieces = panelPieces(p)
    pieces.forEach((q, i) => {
      // Ring 0 is the layer's outer face, ring 1 its inner face; mitred edges are set in by the taper.
      const ring = (f: 0 | 1): [number, number][] => {
        const l0 = q.min[L] + q.taper.W1[f], l1 = q.max[L] - q.taper.W2[f]
        const w0 = q.min[W] + q.taper.L1[f], w1 = q.max[W] - q.taper.L2[f]
        return [[l0, w0], [l1, w0], [l1, w1], [l0, w1]]
      }
      const [cOut, cIn] = HIGH.includes(p.wall) ? [q.max[n], q.min[n]] : [q.min[n], q.max[n]]
      solids.push({
        ...hexa(pieces.length > 1 ? `${name}-${i + 1}` : name, 'layer', p.wall, [L, W, n], ring(0), ring(1), cOut, cIn),
        ...tag,
      })
    })
  }

  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    if (!wi) continue
    const n = wallNormal(w)
    const high = HIGH.includes(w)
    const o = wallPlaneAxes(w).find((a) => a !== wi.splitAxis)!
    const { o0, o1 } = facetSpan(d, w)
    let start = 0
    wi.facets.forEach((f, i) => {
      const end = Math.min(start + f.width, inner[wi.splitAxis])
      const [hinge, free] = f.hinge === 'min' ? [start, end] : [end, start]
      const pd = packingDepth(f)
      const at = (off: number) => (high ? inner[n] - off : off)
      solids.push(prism(`${w}-facet-${i + 1}`, 'facet', w, [wi.splitAxis, n, o], [
        [hinge, at(0)], [free, at(pd)], [free, at(pd + wi.panelThickness)], [hinge, at(wi.panelThickness)],
      ], o0, o1))
      start = end
    })
  }

  // Wall treatments lie on the innermost face (the facet face where the wall has facets), stacked in list order.
  for (const w of WALLS) {
    const layers = wallTreatments(d, w)
    if (layers.length === 0) continue
    const wi = activeInterior(d, w)
    const n = wallNormal(w)
    const high = HIGH.includes(w)
    const at = (off: number) => (high ? inner[n] - off : off)
    const [u, v] = wallPlaneAxes(w)
    let below = 0
    layers.forEach((t, k) => {
      const name = `${w}-treatment-${k + 1}`
      const top = below + t.thickness
      if (!wi) {
        solids.push(box(name, 'treatment', w, {
          [n]: [Math.min(at(below), at(top)), Math.max(at(below), at(top))], [u]: wallSpan(d, w, u), [v]: wallSpan(d, w, v),
        } as Record<Axis, [number, number]>))
      } else {
        const o = [u, v].find((a) => a !== wi.splitAxis)!
        const { o0, o1 } = facetSpan(d, w)
        let start = 0
        wi.facets.forEach((f, i) => {
          const end = Math.min(start + f.width, inner[wi.splitAxis])
          const [hinge, free] = f.hinge === 'min' ? [start, end] : [end, start]
          const pd = packingDepth(f) + wi.panelThickness
          solids.push(prism(`${name}-facet-${i + 1}`, 'treatment', w, [wi.splitAxis, n, o], [
            [hinge, at(wi.panelThickness + below)], [free, at(pd + below)],
            [free, at(pd + top)], [hinge, at(wi.panelThickness + top)],
          ], o0, o1))
          start = end
        })
      }
      below = top
    })
  }

  // Panels and their treatments are clipped to the inner cavity so nothing pokes through the walls.
  const clip = (r: Record<Axis, Range>): Record<Axis, Range> | null => {
    const out = { ...r }
    for (const a of AXES) {
      out[a] = [clampTo(Math.min(...r[a]), inner[a]), clampTo(Math.max(...r[a]), inner[a])]
      if (out[a][1] - out[a][0] <= 1e-6) return null
    }
    return out
  }
  const putClipped = (name: string, kind: SolidKind, r: Record<Axis, Range>) => {
    const c = clip(r)
    if (c) solids.push(box(name, kind, undefined, c))
  }
  d.panels.forEach((p, i) => {
    const e = panelExtent(d, p)
    const [u, v] = panelPlane(p.normal)
    const ranges = { [u]: [p.u0, p.u1], [v]: [p.v0, p.v1] }
    putClipped(`panel-${i + 1}`, 'panel', { ...ranges, [p.normal]: [e.slabLo, e.slabHi] } as Record<Axis, Range>)
    for (const side of ['neg', 'pos'] as const) {
      let from = side === 'neg' ? e.slabLo : e.slabHi
      panelTreatments(d, p.id, side).forEach((t, k) => {
        const to = side === 'neg' ? from - t.thickness : from + t.thickness
        putClipped(`panel-${i + 1}-treatment-${side}-${k + 1}`, 'treatment', {
          ...ranges, [p.normal]: [Math.min(from, to), Math.max(from, to)],
        } as Record<Axis, Range>)
        from = to
      })
    }
  })

  addDoors(solids, d, door, { wAxis, hAxis, centred, inner })

  const cab = d.sim.cabId === '' ? undefined : d.cabs.find((c) => c.id === d.sim.cabId)
  if (cab) {
    const b = cabBox(d, cab)
    // A cab that does not fit is shown cut off at the cavity rather than through the walls.
    putClipped('cab', 'cab', { x: [b.min.x, b.max.x], y: [b.min.y, b.max.y], z: [b.min.z, b.max.z] })
  }
  return { solids }
}

type DoorFrame = {
  wAxis: Axis
  hAxis: Axis
  centred: (size: { w: number; h: number }) => Rect
  inner: Record<Axis, number>
}

/** Leaf slabs (outer face-mounted outside the wall, inner inset at the inner face) and frame strips. */
function addDoors(solids: Solid[], d: Design, door: ReturnType<typeof doorLayout>, f: DoorFrame) {
  const side = door.side
  const n = wallNormal(side)
  const high = HIGH.includes(side)
  const total = stackThickness(wallStack(d, side))
  // Distance outward from the inner face, as a coordinate along the wall normal.
  const range = (from: number, to: number): Range =>
    high ? [f.inner[n] + from, f.inner[n] + to] : [0 - to, 0 - from]
  const put = (name: string, r: Rect, from: number, to: number) =>
    solids.push(box(name, 'door', side, { [n]: range(from, to), [f.wAxis]: r[0], [f.hAxis]: r[1] } as Record<Axis, Range>))

  const place = (leaf: LeafLayout) => {
    const t = leaf.leaves[0].t
    const [from, to] = leaf.which === 'outer' ? [total, total + t] : [0, t]
    const isSplit = leaf.leaves.length === 2
    const w = leaf.leaves.reduce((s, l) => s + l.w, 0) + (isSplit ? SPLIT_GAP : 0)
    const [wr, hr] = f.centred({ w, h: leaf.leaves[0].h })
    if (!isSplit) put(`door-${leaf.which}`, [wr, hr], from, to)
    else {
      const half = leaf.leaves[0].w
      put(`door-${leaf.which}-1`, [[wr[0], wr[0] + half], hr], from, to)
      put(`door-${leaf.which}-2`, [[wr[1] - half, wr[1]], hr], from, to)
    }
    if (leaf.frame) {
      const [fFrom, fTo] = leaf.which === 'outer' ? [total - leaf.frame.depth, total] : [0, leaf.frame.depth]
      around(f.centred(leaf.cutout), f.centred(leaf.opening)).forEach((r, i) =>
        put(`door-${leaf.which}-frame-${i + 1}`, r, fFrom, fTo))
    }
  }
  if (door.outer) place(door.outer)
  if (door.inner) place(door.inner)
}
