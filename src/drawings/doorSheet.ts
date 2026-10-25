import { doorLeafLayers, type DoorLayout, type LeafLayout, type WallDoorLayout } from '../doors/doors'
import { ASTRAGAL_WIDTH, SPLIT_GAP } from '../model/defaults'
import { resolveDims } from '../geometry/dimensions'
import type { Design, Library } from '../model/schema'
import { fmt, Pen, type BlockFn, type Tag } from './svg'
import { PartTags } from './tags'

type Edge = 'left' | 'right' | 'top' | 'bottom'
const OPPOSITE: Record<Edge, Edge> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
/** A rectangle in model mm, y up. */
type Box = { x0: number; y0: number; x1: number; y1: number }

/** Door sheet drawings: each leaf in dual mode, the swinging wall in wall mode. */
export function doorBlocks(d: Design, lib: Library, door: DoorLayout, tags: PartTags): BlockFn[] {
  if (door.kind === 'wall' && door.wall) return [wallDoorBlock(d, lib, door.wall, tags)]
  const out: BlockFn[] = []
  for (const which of ['outer', 'inner'] as const) {
    const leaf = door[which]
    if (leaf) out.push(leafBlock(d, lib, leaf, tags))
  }
  return out
}

/**
 * Hinge or latch marks along one edge of a box, each with its centre measured from the low end of the edge
 * (bottom for vertical edges, left for horizontal ones). Labels go outward, or inward when `inward`; the sheet
 * states the reference edge in its notes.
 */
function edgeMarks(
  pen: Pen, X: (x: number) => number, Y: (y: number) => number,
  b: Box, edge: Edge, positions: number[], kind: 'hinge' | 'latch',
  { inward = false, labels = true }: { inward?: boolean; labels?: boolean } = {},
) {
  const vertical = edge === 'left' || edge === 'right'
  const out = (edge === 'left' || edge === 'bottom' ? -1 : 1) * (inward ? -1 : 1)
  for (const p of positions) {
    if (vertical) {
      const x = X(edge === 'left' ? b.x0 : b.x1), y = Y(b.y0 + p)
      if (kind === 'hinge') pen.rect(x - 0.8, y - 2, 1.6, 4, 'mk')
      else pen.circle(x, y, 1.1, 'mk')
      if (!labels) continue
      pen.line(x, y, x + out * 4, y, 't')
      pen.text(x + out * 4.5, y + 0.8, fmt(p), { size: 2.2, anchor: out > 0 ? 'start' : 'end' })
    } else {
      const x = X(b.x0 + p), y = Y(edge === 'bottom' ? b.y0 : b.y1)
      if (kind === 'hinge') pen.rect(x - 2, y - 0.8, 4, 1.6, 'mk')
      else pen.circle(x, y, 1.1, 'mk')
      if (!labels) continue
      const dy = edge === 'bottom' ? 1 : -1
      const o = dy * (inward ? -1 : 1)
      pen.line(x, y, x, y + o * 4, 't')
      pen.text(x, y + o * 4 + (o > 0 ? 2.4 : -0.8), fmt(p), { size: 2.2, anchor: 'middle' })
    }
  }
}

function leafBlock(d: Design, lib: Library, leaf: LeafLayout, tags: PartTags): BlockFn {
  const which = leaf.which
  const cfg = d.door[which]
  const label = which === 'outer' ? 'Outer' : 'Inner'
  const split = leaf.leaves.length === 2
  const TW = leaf.leaves.reduce((a, l) => a + l.w, 0) + (split ? SPLIT_GAP : 0)
  const TH = leaf.leaves[0].h
  const leaves: Box[] = split
    ? [{ x0: 0, y0: 0, x1: leaf.leaves[0].w, y1: TH }, { x0: leaf.leaves[0].w + SPLIT_GAP, y0: 0, x1: TW, y1: TH }]
    : [{ x0: 0, y0: 0, x1: TW, y1: TH }]
  const centred = (w: number, h: number): Box => ({ x0: (TW - w) / 2, y0: (TH - h) / 2, x1: (TW + w) / 2, y1: (TH + h) / 2 })
  const open = centred(leaf.opening.w, leaf.opening.h)
  const cut = centred(leaf.cutout.w, leaf.cutout.h)
  const ov = open.x0
  const seal = lib.seals.find((x) => x.id === cfg.sealTypeId)
  const hinge = lib.hinges.find((x) => x.id === cfg.hingeTypeId)

  const matName = (id: string) => lib.materials.find((m) => m.id === id)?.name ?? id
  const half = split ? ' half' : ''
  const layerTags: Tag[] = doorLeafLayers(d)[which]
    .map((l, k) => tags.tag(tags.named('doors', `${label} door leaf${half}, layer ${k + 1} (${matName(l.materialId)})`)))
    .filter((t): t is Tag => t !== null)
  const astragal = split ? tags.tag(tags.named('doors', `${label} door astragal`)) : null
  const frameSide = leaf.frame ? tags.tag(tags.named('doors', `${label} door frame side`)) : null
  const frameHead = leaf.frame ? tags.tag(tags.named('doors', `${label} door frame head`)) : null

  const edges = (e: Edge, kind: 'hinge' | 'latch') => `${kind} centres from the ${e === 'left' || e === 'right' ? 'bottom' : 'left'} edge`
  const hingeEdges = [...new Set(leaf.hinges.map((h) => h.edge))].join(' and ')
  const notes = [
    `${leaf.direction === 'in' ? 'Opens inwards' : 'Opens outwards'}${split ? ', split leaf' : ''}, mounted on the ${leaf.mount}. ${hinge?.name ?? cfg.hingeTypeId} on the ${hingeEdges} edge.`,
    `Positions: ${edges(cfg.hingeEdge, 'hinge')}; ${edges(cfg.hingeEdge, 'latch')}, ${split ? 'on the meeting edges' : 'on the opposite edge'}.`,
    leaf.pocket
      ? `Thin line: clear opening ${fmt(leaf.opening.w)} × ${fmt(leaf.opening.h)}. Dash-dot: cutout ${fmt(leaf.cutout.w)} × ${fmt(leaf.cutout.h)} in the wall layers the leaf sits in.`
      : `Thin line: clear opening ${fmt(leaf.opening.w)} × ${fmt(leaf.opening.h)}. Dash-dot: wall cutout ${fmt(leaf.cutout.w)} × ${fmt(leaf.cutout.h)}.`,
    `Dashed: seal line ${fmt(ov / 2)} in from the leaf edge, ${seal?.name ?? cfg.sealTypeId}.`,
    ...(leaf.rebate && leaf.pocket
      ? [`Sits in a rebate in the wall ${fmt(leaf.rebate.depth)} deep from the inner face (leaf plus seal), pocket ${fmt(leaf.pocket.w)} × ${fmt(leaf.pocket.h)}.`]
      : []),
    ...(leaf.frame ? [`Frame strips ${fmt(leaf.frame.width)} wide, ${fmt(leaf.frame.depth)} deep round the ${leaf.pocket ? 'pocket' : 'opening'}.`] : []),
  ]

  return (s) => {
    const pen = new Pen()
    const X = (x: number) => x * s
    const Y = (y: number) => (TH - y) * s
    const minX = Math.min(0, cut.x0), maxY = Math.max(TH, cut.y1), minY = Math.min(0, cut.y0)
    const head = Y(maxY) - 5 - 3.2 * notes.length
    pen.text(X(minX), head - 4.5, `${label} door, seen from outside`, { size: 3.2, cls: 'hd' })
    notes.forEach((n, i) => pen.text(X(minX), head + 3.2 * i, n, { size: 2.2 }))

    const rect = (b: Box, cls: string) => pen.rect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s, cls)
    rect(cut, 'c')
    rect(open, 't')
    for (const l of leaves) rect(l, 'o')
    rect({ x0: ov / 2, y0: ov / 2, x1: TW - ov / 2, y1: TH - ov / 2 }, 'h')
    pen.text(X(TW / 2), Y(TH / 2), 'clear opening', { size: 2.2, anchor: 'middle' })
    if (leaf.frame) {
      pen.balloon(frameSide, X((cut.x0 + open.x0) / 2), Y(TH * 0.3), X(open.x0) + 6, Y(TH * 0.3))
      pen.balloon(frameHead, X(TW * 0.7), Y((cut.y1 + open.y1) / 2), X(TW * 0.7), Y(open.y1) + 6)
    }
    const by = Y(open.y0 + (open.y1 - open.y0) * 0.75)
    layerTags.forEach((t, k) => pen.balloon(t, X(leaves[0].x0 + ov) + 6 + 11 * k, by, X(leaves[0].x0 + ov) + 6 + 11 * k, by))
    if (split) {
      const a = { x0: TW / 2 - ASTRAGAL_WIDTH / 2, y0: 0, x1: TW / 2 + ASTRAGAL_WIDTH / 2, y1: TH }
      rect(a, 'h')
      pen.balloon(astragal, X(TW / 2), Y(TH * 0.85), X(TW / 2) + 8, Y(TH * 0.85))
    }

    leaves.forEach((l, i) => {
      const h = leaf.hinges[i]
      if (!h) return
      const e = h.edge as Edge
      edgeMarks(pen, X, Y, l, e, h.positions, 'hinge')
      // Split leaves latch on their meeting edges: label once, inward, so the two sides do not collide.
      edgeMarks(pen, X, Y, l, OPPOSITE[e], leaf.latches, 'latch', { inward: split, labels: i === 0 })
    })

    const bottom = Y(minY) + 10
    if (split) pen.chainH([0, leaves[0].x1, leaves[1].x0, TW].map(X), [fmt(leaves[0].x1), '', fmt(TW - leaves[1].x0)], Y(0), bottom)
    pen.dimH(X(0), X(TW), Y(0), bottom + (split ? 5 : 0), fmt(TW))
    const left = X(minX) - 16
    pen.dimV(Y(0), Y(TH), X(0), left, fmt(TH))
    return pen.block()
  }
}

function wallDoorBlock(d: Design, lib: Library, w: WallDoorLayout, tags: PartTags): BlockFn {
  const { inner } = resolveDims(d)
  const innerW = w.side === 'front' ? inner.x : inner.z
  const P: Box = { x0: 0, y0: 0, x1: w.panel.w, y1: w.panel.h }
  const io: Box = { x0: (w.panel.w - innerW) / 2, y0: (w.panel.h - inner.y) / 2, x1: (w.panel.w + innerW) / 2, y1: (w.panel.h + inner.y) / 2 }
  const cfg = d.door.outer
  const seal = lib.seals.find((x) => x.id === cfg.sealTypeId)
  const sw = seal?.width ?? 0
  const shellSeal = w.seals.find((x) => x.line === 'shell')
  const innerSeals = w.seals.filter((x) => x.line !== 'shell')
  const refs = tags.parts.filter((p) => p.notes.includes('hinged wall: see doors step')).map((p) => p.id)

  const from = w.hingeEdge === 'left' || w.hingeEdge === 'right' ? 'bottom' : 'left'
  const notes = [
    `Outer face ${fmt(w.panel.w)} × ${fmt(w.panel.h)}, ${fmt(w.panel.t)} thick, about ${fmt(w.massKg)} kg. Swing ${fmt(w.swingRadius)}.`,
    `Positions: hinge centres (${w.hingeEdge} edge) and latch centres (${OPPOSITE[w.hingeEdge]} edge) from the ${from} edge.`,
    `Dashed: shell seal line ${fmt(sw / 2)} in from the edge, ${fmt(shellSeal?.perimeterMm ?? 0)} long.`,
    ...(innerSeals.length > 0
      ? [`Dash-dot: ${innerSeals.map((x) => x.line).join(', ')} seal line round the inner opening ${fmt(innerW)} × ${fmt(inner.y)}, ${fmt(innerSeals[0].perimeterMm)} long each.`]
      : []),
    `Seal: ${seal?.name ?? cfg.sealTypeId}. Door wall layers ${refs.join(', ')} are cut on the box sheets.`,
  ]

  return (s) => {
    const pen = new Pen()
    const X = (x: number) => x * s
    const Y = (y: number) => (w.panel.h - y) * s
    const head = -5 - 3.2 * notes.length
    pen.text(0, head - 4.5, `${w.side.charAt(0).toUpperCase() + w.side.slice(1)} wall door, seen from outside`, { size: 3.2, cls: 'hd' })
    notes.forEach((n, i) => pen.text(0, head + 3.2 * i, n, { size: 2.2 }))
    const rect = (b: Box, cls: string) => pen.rect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s, cls)
    rect(P, 'o')
    rect({ x0: sw / 2, y0: sw / 2, x1: w.panel.w - sw / 2, y1: w.panel.h - sw / 2 }, 'h')
    if (innerSeals.length > 0) rect(io, 'c')

    const e = w.hingeEdge as Edge
    edgeMarks(pen, X, Y, P, e, w.hinges, 'hinge')
    edgeMarks(pen, X, Y, P, OPPOSITE[e], w.latches, 'latch')
    pen.dimH(0, X(w.panel.w), Y(0), Y(0) + 12, fmt(w.panel.w))
    pen.dimV(Y(0), Y(w.panel.h), 0, -16, fmt(w.panel.h))
    return pen.block()
  }
}
