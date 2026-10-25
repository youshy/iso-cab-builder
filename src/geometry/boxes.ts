import { doorLayout } from '../doors/doors'
import { doorWidthAxis } from '../doors/side'
import type { Axis, Design, Gap, Layer, Library, Vec3, WallId } from '../model/schema'
import { resolveDims } from './dimensions'
import { wallIntrusion } from './treatments'
import { activeInterior, cavities, leafGroups, wallNormal, wallPlaneAxes, wallStack, WALLS } from './walls'

/**
 * The single geometry model of the walls: one closed box per leaf group, nested inside each other with the
 * cavities between them. The cut list, the 3D view and the sections all read their wall layers from here.
 */

export type Range = [number, number]
/** A rectangle in a plane: [range along the first axis, range along the second]. */
export type Rect = [Range, Range]
/** L edges run along the length (at the low and high end of the width axis), W edges along the width. */
export type PanelEdge = 'L1' | 'L2' | 'W1' | 'W2'
export type JointKind = 'butt' | 'mitre'

export type BoxPanel = {
  wall: WallId
  /** 0 = outermost box. */
  boxIndex: number
  /** Within its leaf group, outside-in. */
  layerIndex: number
  materialId: string
  thickness: number
  /** Positioned slab in the domain frame (mm): the layer's bounds, i.e. its cut size. Mitred: its outer (long-point) face. */
  min: Vec3
  max: Vec3
  /** In-plane axes; length >= width. */
  lengthAxis: Axis
  widthAxis: Axis
  /** Edges that meet another panel of the same box, in L1, L2, W1, W2 order. */
  joinedEdges: { edge: PanelEdge; kind: JointKind }[]
  /** How far each edge is set in at the layer's outer and inner face (from min/max): non-zero on mitred edges only. */
  taper: Record<PanelEdge, Range>
  /** Door opening in domain coordinates: u along lengthAxis, v along widthAxis. */
  cutout: Cutout | null
  /**
   * The inner leaf's rebate where it only partly enters this layer: routed `depth` mm into the inner face,
   * `width` mm beyond the cutout edge, out to `cutout` (the leaf pocket).
   */
  rebate: { depth: number; width: number; cutout: Cutout } | null
  /** The panel is part of a whole-wall door. */
  door: boolean
}

export type Cutout = { u0: number; u1: number; v0: number; v1: number }

export type BoxBounds = { cavity: Record<Axis, Range>; outer: Record<Axis, Range> }

const AXES: Axis[] = ['x', 'y', 'z']
export const AXIS_WALLS: Record<Axis, [WallId, WallId]> = { x: ['left', 'right'], y: ['bottom', 'top'], z: ['back', 'front'] }
const HIGH = new Set<WallId>(['right', 'top', 'front'])
/** Walls abutting earlier in this order run through; later ones are cut short. The front wall comes last. */
const PRIORITY: WallId[] = ['back', 'left', 'right', 'top', 'bottom', 'front']
const NO_TAPER = (): Record<PanelEdge, Range> => ({ L1: [0, 0], L2: [0, 0], W1: [0, 0], W2: [0, 0] })

const sum = (ls: { thickness: number }[]) => ls.reduce((a, l) => a + l.thickness, 0)

/**
 * One wall's share of a box: its layers, their total thickness, the distance from the inner cavity face to
 * their inner face, and the cavity just outside them.
 */
type Share = { layers: Layer[]; t: number; inset: number; outside: Gap | null }

/** Number of boxes: the most leaf groups on any wall. */
const boxCount = (d: Design) => Math.max(...WALLS.map((w) => leafGroups(wallStack(d, w)).length))

/**
 * Each wall's share of every box. Leaf group g goes to box g, except that a wall's innermost group (when it
 * has a cavity) always goes to the innermost box. A wall with no group for a box contributes nothing, sitting
 * at the outer face of its next group inward.
 */
function shares(d: Design, n: number): Record<WallId, Share[]> {
  const out = {} as Record<WallId, Share[]>
  for (const w of WALLS) {
    const items = wallStack(d, w)
    const groups = leafGroups(items)
    const gaps = cavities(items)
    const t = groups.map(sum)
    const insetOf = (g: number) => t.slice(g + 1).reduce((a, x) => a + x, 0) + gaps.slice(g).reduce((a, c) => a + c.width, 0)
    const s: (Share | undefined)[] = Array.from({ length: n }, () => undefined)
    groups.forEach((layers, g) => {
      const k = groups.length > 1 && g === groups.length - 1 ? n - 1 : g
      s[k] = { layers, t: t[g], inset: insetOf(g), outside: g > 0 ? gaps[g - 1] : null }
    })
    for (let k = n - 1; k >= 0; k--) {
      if (s[k]) continue
      const next = s[k + 1]
      s[k] = { layers: [], t: 0, inset: next ? next.inset + next.t : 0, outside: null }
    }
    out[w] = s as Share[]
  }
  return out
}

function bounds(inner: Vec3, sh: Record<WallId, Share[]>, k: number): BoxBounds {
  const cavity = {} as Record<Axis, Range>
  const outer = {} as Record<Axis, Range>
  for (const a of AXES) {
    const [lo, hi] = AXIS_WALLS[a]
    cavity[a] = [0 - sh[lo][k].inset, inner[a] + sh[hi][k].inset]
    outer[a] = [cavity[a][0] - sh[lo][k].t, cavity[a][1] + sh[hi][k].t]
  }
  return { cavity, outer }
}

/** Cavity and outer faces of every box, outermost first. Box 0's outer is the outer box; the last box's cavity is the inner cavity. */
export function boxBounds(d: Design): BoxBounds[] {
  const { inner } = resolveDims(d)
  const n = boxCount(d)
  const sh = shares(d, n)
  return Array.from({ length: n }, (_, k) => bounds(inner, sh, k))
}

/** The cavity just outside wall `w`'s layers in box `boxIndex`: what decouples them from the box outside. */
export function cavityOutside(d: Design, w: WallId, boxIndex: number): Gap | null {
  return shares(d, boxCount(d))[w][boxIndex]?.outside ?? null
}

/**
 * Butt-joint rule for one wall along in-plane axis `a`: does the panel run to the outer face of the ring it
 * belongs to, or stop at its cavity face? Sides-past runs the sides through; tops-past the top and bottom.
 * Back and front sit inside the ring in both.
 */
function reach(w: WallId, a: Axis, rule: 'sides-past' | 'tops-past'): 'outer' | 'cavity' {
  const n = wallNormal(w)
  if (n === 'x') return rule === 'tops-past' && a === 'y' ? 'cavity' : 'outer'
  if (n === 'y') return a === 'z' || rule === 'tops-past' ? 'outer' : 'cavity'
  return 'cavity'
}

/**
 * Every wall layer of every box as a positioned slab, with its joints and door cutout.
 *
 * Joints, per box:
 * - sides-past / tops-past: each wall's laminate is one panel shape, butted by the rule.
 * - rebate: a staggered lap of separately cut layers (no machining). Layer ring j is the j-th layer of every
 *   wall; even rings follow sides-past, odd rings tops-past, each against the same ring of its neighbours.
 *   A wall with a single layer has only ring 0, so it is plain sides-past (`hasSingleLayerBox` drives a UI hint).
 * - mitre: every layer runs to the box's outer face, with its mitred ends tapering inward (45 degrees for
 *   equal thicknesses). min/max are the layer's own outer face; `taper` sets the inner face in.
 */
export function wallBoxes(d: Design, lib: Library): BoxPanel[] {
  const { inner } = resolveDims(d)
  const n = boxCount(d)
  const sh = shares(d, n)
  const door = doorLayout(d, lib)
  const side = door.side
  const panels: BoxPanel[] = []

  // The box holding the door wall's innermost leaf group holds the inner leaf.
  const leafBox = sh[side].reduce((at, s, k) => (s.layers.length > 0 ? k : at), 0)
  type Size = { w: number; h: number }
  /**
   * Cutout sizes for layer j of the door wall in box k. In the leaf's box, depth is measured from the inner
   * face: a layer wholly within the rebate is cut to the pocket (plus frame strips); a layer the rebate only
   * partly enters keeps the cutout it would have had and is routed out to the pocket.
   */
  const cutSizes = (k: number, share: Share, j: number): { size: Size; rebate: { depth: number; size: Size } | null } | null => {
    if (!door.outer || !door.inner || !door.inner.rebate || !door.inner.pocket) return null
    const base = k === 0 ? door.outer.cutout : door.inner.opening
    if (k !== leafBox) return { size: base, rebate: null }
    const [s0, s1] = depthOf(share, j)
    const [a, b] = [share.t - s1, share.t - s0]
    const R = door.inner.rebate.depth
    if (b <= R + 1e-6) return { size: door.inner.cutout, rebate: null }
    const pocket = door.inner.pocket
    if (a < R - 1e-6 && pocket.w > base.w + 1e-6) return { size: base, rebate: { depth: R - a, size: pocket } }
    return { size: base, rebate: null }
  }
  /** Depth of layer j of a wall's share, from the box's outer face; a wall without that layer is passed entirely. */
  const depthOf = (share: Share, j: number): Range => {
    let at = 0
    for (let i = 0; i < share.layers.length; i++) {
      const t = share.layers[i].thickness
      if (i === j) return [at, at + t]
      at += t
    }
    return [share.t, share.t]
  }

  for (let k = 0; k < n; k++) {
    const b = bounds(inner, sh, k)
    for (const w of WALLS) {
      const share = sh[w][k]
      if (share.layers.length === 0 || share.t <= 0) continue
      const nAxis = wallNormal(w)
      const plane = wallPlaneAxes(w)
      const high = HIGH.has(w)
      share.layers.forEach((l, j) => {
        const [s0, s1] = depthOf(share, j)
        if (l.thickness <= 0) return
        const ext = {} as Record<Axis, Range>
        const rate: Partial<Record<Axis, [number, number]>> = {}
        for (const a of plane) {
          const [lo, hi] = AXIS_WALLS[a]
          const [tLo, tHi] = [sh[lo][k].t, sh[hi][k].t]
          if (d.joint === 'mitre') {
            // A mitre meets the neighbour's inner face at this wall's inner face.
            const r: [number, number] = [tLo / share.t, tHi / share.t]
            rate[a] = r
            ext[a] = [b.outer[a][0] + s0 * r[0], b.outer[a][1] - s0 * r[1]]
          } else if (d.joint === 'rebate') {
            const idx = reach(w, a, j % 2 === 0 ? 'sides-past' : 'tops-past') === 'outer' ? 0 : 1
            ext[a] = [b.outer[a][0] + depthOf(sh[lo][k], j)[idx], b.outer[a][1] - depthOf(sh[hi][k], j)[idx]]
          } else {
            const f = reach(w, a, d.joint) === 'outer' ? 1 : 0
            ext[a] = [b.cavity[a][0] - f * tLo, b.cavity[a][1] + f * tHi]
          }
        }
        const len = (a: Axis) => ext[a][1] - ext[a][0]
        const [L, W] = len(plane[1]) > len(plane[0]) ? [plane[1], plane[0]] : [plane[0], plane[1]]

        const joinedEdges: BoxPanel['joinedEdges'] = []
        const taper = NO_TAPER()
        const edges: [PanelEdge, Axis, 0 | 1][] = [['L1', W, 0], ['L2', W, 1], ['W1', L, 0], ['W2', L, 1]]
        for (const [edge, a, end] of edges) {
          const nb = AXIS_WALLS[a][end]
          if (sh[nb][k].t <= 0) continue
          const kind: JointKind = d.joint === 'mitre' ? 'mitre' : 'butt'
          joinedEdges.push({ edge, kind })
          if (kind === 'mitre') taper[edge] = [0, l.thickness * rate[a]![end]]
        }

        const sizes = w === side ? cutSizes(k, share, j) : null
        const place = (size: Size): Cutout => {
          const wAxis = doorWidthAxis(side)
          const rw: Range = [inner[wAxis] / 2 - size.w / 2, inner[wAxis] / 2 + size.w / 2]
          const rh: Range = [inner.y / 2 - size.h / 2, inner.y / 2 + size.h / 2]
          const [ru, rv] = L === wAxis ? [rw, rh] : [rh, rw]
          return { u0: ru[0], u1: ru[1], v0: rv[0], v1: rv[1] }
        }
        const cutout = sizes ? place(sizes.size) : null
        const rebate = sizes?.rebate
          ? { depth: sizes.rebate.depth, width: (sizes.rebate.size.w - sizes.size.w) / 2, cutout: place(sizes.rebate.size) }
          : null

        const nr: Range = high ? [b.outer[nAxis][1] - s1, b.outer[nAxis][1] - s0] : [b.outer[nAxis][0] + s0, b.outer[nAxis][0] + s1]
        const r: Record<Axis, Range> = { ...ext, [nAxis]: nr }
        panels.push({
          wall: w, boxIndex: k, layerIndex: j, materialId: l.materialId, thickness: l.thickness,
          min: { x: r.x[0], y: r.y[0], z: r.z[0] }, max: { x: r.x[1], y: r.y[1], z: r.z[1] },
          lengthAxis: L, widthAxis: W, joinedEdges, taper, cutout, rebate,
          door: w === side && door.kind === 'wall',
        })
      })
    }
  }
  return panels
}

/** Saw blade tilt for a mitred edge, degrees from the face normal: 45 when the two walls are equally thick. */
export const mitreAngle = (p: BoxPanel, e: PanelEdge): number => (Math.atan(p.taper[e][1] / p.thickness) * 180) / Math.PI

/** Whether any wall's share of any box is a single layer: a rebate (staggered lap) needs two to interlock. */
export function hasSingleLayerBox(d: Design): boolean {
  return WALLS.some((w) => leafGroups(wallStack(d, w)).some((g) => g.filter((l) => l.thickness > 0).length === 1))
}

/** Box label of a panel: the outermost box is the shell, the innermost (when there are several) the liner. */
export function boxPart(boxIndex: number, boxes: number): 'shell' | 'liner' | 'middle' {
  if (boxIndex === 0) return 'shell'
  return boxIndex === boxes - 1 ? 'liner' : 'middle'
}

/** The pieces of `outer` left after cutting `hole` out of it: up to four rectangles. */
export function around(outer: Rect, hole: Rect): Rect[] {
  const [[w0, w1], [h0, h1]] = outer
  const cl = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  const [a0, a1] = [cl(hole[0][0], w0, w1), cl(hole[0][1], w0, w1)]
  const [b0, b1] = [cl(hole[1][0], h0, h1), cl(hole[1][1], h0, h1)]
  const pieces: Rect[] = [
    [[w0, a0], [h0, h1]], [[a1, w1], [h0, h1]], [[a0, a1], [h0, b0]], [[a0, a1], [b1, h1]],
  ]
  return pieces.filter(([w, h]) => w[1] - w[0] > 1e-6 && h[1] - h[0] > 1e-6)
}

export type PanelPiece = { min: Vec3; max: Vec3; taper: Record<PanelEdge, Range> }

/** The pieces of one slab of a panel around one hole; cut edges carry no taper. */
function piecesAround(p: BoxPanel, min: Vec3, max: Vec3, taper: Record<PanelEdge, Range>, hole: Cutout | null): PanelPiece[] {
  if (!hole) return [{ min, max, taper }]
  const L = p.lengthAxis, W = p.widthAxis
  const whole: Rect = [[min[L], max[L]], [min[W], max[W]]]
  return around(whole, [[hole.u0, hole.u1], [hole.v0, hole.v1]]).map(([rl, rw]) => {
    const keep = (e: PanelEdge, on: boolean): Range => (on ? taper[e] : [0, 0])
    return {
      min: { ...min, [L]: rl[0], [W]: rw[0] },
      max: { ...max, [L]: rl[1], [W]: rw[1] },
      taper: {
        L1: keep('L1', rw[0] === whole[1][0]), L2: keep('L2', rw[1] === whole[1][1]),
        W1: keep('W1', rl[0] === whole[0][0]), W2: keep('W2', rl[1] === whole[0][1]),
      },
    }
  })
}

/**
 * The slab as built: the whole panel, or the pieces left around its door cutout. A routed rebate splits the
 * slab through its thickness: the inner `depth` mm around the pocket, the rest around the cutout.
 */
export function panelPieces(p: BoxPanel): PanelPiece[] {
  if (!p.rebate) return piecesAround(p, p.min, p.max, p.taper, p.cutout)
  const n = wallNormal(p.wall)
  const t = p.thickness
  const split = HIGH.has(p.wall) ? p.min[n] + p.rebate.depth : p.max[n] - p.rebate.depth
  // Taper between the outer face (depth 0) and the inner face (depth t), sliced to depths [f0, f1].
  const slice = (f0: number, f1: number): Record<PanelEdge, Range> => {
    const at = (r: Range, f: number) => r[0] + ((r[1] - r[0]) * f) / t
    const out = NO_TAPER()
    for (const e of Object.keys(out) as PanelEdge[]) out[e] = [at(p.taper[e], f0), at(p.taper[e], f1)]
    return out
  }
  const D = t - p.rebate.depth
  const [outerMin, outerMax, innerMin, innerMax] = HIGH.has(p.wall)
    ? [{ ...p.min, [n]: split }, p.max, p.min, { ...p.max, [n]: split }]
    : [p.min, { ...p.max, [n]: split }, { ...p.min, [n]: split }, p.max]
  return [
    ...piecesAround(p, outerMin, outerMax, slice(0, D), p.cutout),
    ...piecesAround(p, innerMin, innerMax, slice(D, t), p.rebate.cutout),
  ]
}

/** A wall's usable span along in-plane axis `a`: earlier walls in PRIORITY reach in at either end by their intrusion. */
export function wallSpan(d: Design, w: WallId, a: Axis): Range {
  const { inner } = resolveDims(d)
  const [lo, hi] = AXIS_WALLS[a]
  const before = (e: WallId) => PRIORITY.indexOf(e) < PRIORITY.indexOf(w)
  const o0 = before(lo) ? wallIntrusion(d, lo) : 0
  const o1 = inner[a] - (before(hi) ? wallIntrusion(d, hi) : 0)
  return [o0, Math.max(o0, o1)]
}

/** Span of a wall's facets along the in-plane axis across the split axis (the facets' long direction). */
export function facetSpan(d: Design, w: WallId): { o0: number; o1: number } {
  const wi = activeInterior(d, w)
  const [u, v] = wallPlaneAxes(w)
  const o = wi ? (u === wi.splitAxis ? v : u) : v
  const [o0, o1] = wallSpan(d, w, o)
  return { o0, o1 }
}
