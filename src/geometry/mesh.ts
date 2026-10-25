import { doorLayout, SPLIT_GAP, type LeafLayout } from '../doors/doors'
import type { Axis, Design, Library, WallId } from '../model/schema'
import { resolveDims } from './dimensions'
import { packingDepth } from './facets'
import { cabBox } from './space'
import { activeInterior, splitStack, stackThickness, wallNormal, wallPlaneAxes, wallStack, WALLS } from './walls'

export type SolidKind = 'shell' | 'liner' | 'facet' | 'panel' | 'cab' | 'door'
export type Solid = { name: string; kind: SolidKind; wall?: WallId; vertices: number[]; indices: number[] }

const AXES: Axis[] = ['x', 'y', 'z']
const HIGH: WallId[] = ['right', 'top', 'front']

// Two triangles per face of the 8-vertex box: bottom ring 0..3, top ring 4..7.
const BOX_INDICES = [
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
  1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
]

/** Prism: a quad in the (a, b) plane extruded along c from c0 to c1. Quad corners are in order. */
function prism(
  name: string, kind: SolidKind, wall: WallId | undefined,
  [a, b, c]: [Axis, Axis, Axis], quad: [number, number][], c0: number, c1: number,
): Solid {
  const vertices: number[] = []
  for (const cv of [c0, c1]) {
    for (const [av, bv] of quad) {
      const p: Record<Axis, number> = { x: 0, y: 0, z: 0 }
      p[a] = av; p[b] = bv; p[c] = cv
      vertices.push(p.x, p.y, p.z)
    }
  }
  return { name, kind, wall, vertices, indices: [...BOX_INDICES] }
}

/** Axis-aligned box from per-axis ranges. */
function box(name: string, kind: SolidKind, wall: WallId | undefined, r: Record<Axis, [number, number]>): Solid {
  return prism(name, kind, wall, ['x', 'y', 'z'], [
    [r.x[0], r.y[0]], [r.x[1], r.y[0]], [r.x[1], r.y[1]], [r.x[0], r.y[1]],
  ], r.z[0], r.z[1])
}

type Range = [number, number]
/** A rectangle in the door wall plane: [range along the door's width axis, range along height (y)]. */
type Rect = [Range, Range]

/** The pieces of `outer` left after cutting `hole` out of it: up to four rectangles. */
function around(outer: Rect, hole: Rect): Rect[] {
  const [[w0, w1], [h0, h1]] = outer
  const cl = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  const [a0, a1] = [cl(hole[0][0], w0, w1), cl(hole[0][1], w0, w1)]
  const [b0, b1] = [cl(hole[1][0], h0, h1), cl(hole[1][1], h0, h1)]
  const pieces: Rect[] = [
    [[w0, a0], [h0, h1]], [[a1, w1], [h0, h1]], [[a0, a1], [h0, b0]], [[a0, a1], [b1, h1]],
  ]
  return pieces.filter(([w, h]) => w[1] - w[0] > 1e-6 && h[1] - h[0] > 1e-6)
}

const otherAxes = (n: Axis): [Axis, Axis] => AXES.filter((a) => a !== n) as [Axis, Axis]

/**
 * Pure mesh description of the design in domain coordinates (mm, origin at the inner
 * back-bottom-left corner, front = +z). Left/right walls span the full outer y and z,
 * top/bottom the inner x and full outer z, back/front the inner x and y, so shells never overlap.
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
  const hole = centred({
    w: Math.max(door.outer.cutout.w, door.inner.cutout.w),
    h: Math.max(door.outer.cutout.h, door.inner.cutout.h),
  })
  const solids: Solid[] = []
  const thick = (w: WallId) => stackThickness(wallStack(d, w))
  const lowT = (a: Axis) => thick(a === 'x' ? 'left' : a === 'y' ? 'bottom' : 'back')
  const highT = (a: Axis) => thick(a === 'x' ? 'right' : a === 'y' ? 'top' : 'front')

  /** In-plane extents of a wall's shell and liner solids. */
  const extent = (w: WallId, a: Axis): [number, number] => {
    const full = w === 'left' || w === 'right' || (a === 'z' && (w === 'top' || w === 'bottom'))
    return full ? [-lowT(a), inner[a] + highT(a)] : [0, inner[a]]
  }

  for (const w of WALLS) {
    const n = wallNormal(w)
    const high = HIGH.includes(w)
    const { shell, gap, liner } = splitStack(wallStack(d, w))
    const sum = (ls: { thickness: number }[]) => ls.reduce((s, l) => s + l.thickness, 0)
    const total = thick(w)
    const tShell = sum(shell)
    const tLiner = sum(liner)
    const [u, v] = wallPlaneAxes(w)
    // Distance outward from the inner face, then converted to a coordinate along the normal.
    const range = (from: number, to: number): [number, number] =>
      high ? [inner[n] + from, inner[n] + to] : [0 - to, 0 - from]
    const make = (kind: 'shell' | 'liner', from: number, to: number) => {
      if (to - from <= 0) return
      if (w !== side) {
        solids.push(box(`${w}-${kind}`, kind, w, {
          [n]: range(from, to), [u]: extent(w, u), [v]: extent(w, v),
        } as Record<Axis, [number, number]>))
        return
      }
      // Door wall: boxes around the cutout.
      around([extent(w, wAxis), extent(w, hAxis)], hole).forEach(([rw, rh], i, all) => {
        solids.push(box(all.length > 1 ? `${w}-${kind}-${i + 1}` : `${w}-${kind}`, kind, w, {
          [n]: range(from, to), [wAxis]: rw, [hAxis]: rh,
        } as Record<Axis, [number, number]>))
      })
    }
    make('shell', total - tShell, total)
    if (gap) make('liner', 0, tLiner)
  }

  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    if (!wi) continue
    const n = wallNormal(w)
    const high = HIGH.includes(w)
    const o = wallPlaneAxes(w).find((a) => a !== wi.splitAxis)!
    let start = 0
    wi.facets.forEach((f, i) => {
      const end = Math.min(start + f.width, inner[wi.splitAxis])
      const [hinge, free] = f.hinge === 'min' ? [start, end] : [end, start]
      const pd = packingDepth(f)
      const at = (off: number) => (high ? inner[n] - off : off)
      solids.push(prism(`${w}-facet-${i + 1}`, 'facet', w, [wi.splitAxis, n, o], [
        [hinge, at(0)], [free, at(pd)], [free, at(pd + wi.panelThickness)], [hinge, at(wi.panelThickness)],
      ], 0, inner[o]))
      start = end
    })
  }

  d.panels.forEach((p, i) => {
    const t = p.layers.reduce((s, l) => s + l.thickness, 0) + (p.insulation?.thickness ?? 0)
    const [u, v] = otherAxes(p.normal)
    solids.push(box(`panel-${i + 1}`, 'panel', undefined, {
      [p.normal]: [p.position, p.position + t], [u]: [p.u0, p.u1], [v]: [p.v0, p.v1],
    } as Record<Axis, [number, number]>))
  })

  addDoors(solids, d, door, { wAxis, hAxis, centred, inner })

  const cab = d.sim.cabId === '' ? undefined : d.cabs.find((c) => c.id === d.sim.cabId)
  if (cab) {
    const b = cabBox(d, cab)
    solids.push(box('cab', 'cab', undefined, {
      x: [b.min.x, b.max.x], y: [b.min.y, b.max.y], z: [b.min.z, b.max.z],
    }))
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
  place(door.outer)
  place(door.inner)
}
