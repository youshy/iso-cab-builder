import { resolveDims } from '../geometry/dimensions'
import { cabBox } from '../geometry/space'
import { splitStack, stackThickness, wallStack } from '../geometry/walls'
import type { Cab, Design, DoorLeaf, DoorSide, Layer, Library, WallId } from '../model/schema'
import { autoDoorSide, doorWall } from './side'

export type LeafLayout = {
  which: 'outer' | 'inner'
  mount: 'shell' | 'liner' | 'rebate'
  opening: { w: number; h: number } // clear
  cutout: { w: number; h: number } // wall cutout: clear opening plus frame strips
  leaves: { w: number; h: number; t: number }[] // 1 or 2
  frame: { width: number; depth: number } | null
  hinges: { edge: string; positions: number[] }[]
  latches: number[]
  rebate: { depth: number; width: number } | null
  swingRadius: number
  direction: 'in' | 'out'
}

/** The whole door wall as one swinging panel. */
export type WallDoorLayout = {
  side: DoorSide
  panel: { w: number; h: number; t: number } // outer face of the door wall
  massKg: number
  hingeEdge: 'left' | 'right' | 'top' | 'bottom'
  hinges: number[]
  latches: number[]
  seals: { line: 'shell' | 'liner'; perimeterMm: number }[]
  swingRadius: number
  collisions: string[]
  notes: string[]
}

export type DoorLayout = {
  kind: 'dual' | 'wall'
  side: DoorSide
  outer: LeafLayout | null // null in wall mode
  inner: LeafLayout | null // null in wall mode
  wall: WallDoorLayout | null // null in dual mode
  betweenDepth: number
  cabsThrough: { cabId: string; fits: boolean }[]
  collisions: string[]
  notes: string[]
}

/** Gap between the two halves of a split leaf, mm. */
export const SPLIT_GAP = 3
const MIN_HINGE_SPAN = 900

const mm = (n: number) => `${Math.round(n)} mm`

/** Cab face seen through a door on the given side: front w x h, left/right d x h. */
const cabFace = (c: Cab, side: DoorSide) => ({ w: side === 'front' ? c.w : c.d, h: c.h })

function largestCab(d: Design): Cab {
  return d.cabs.reduce((a, c) => (c.w * c.h * c.d > a.w * a.h * a.d ? c : a))
}

/** Layers of the two leaves when the door does not override them. */
export function doorLeafLayers(d: Design): { outer: Layer[]; inner: Layer[] } {
  const stack = wallStack(d, doorWall(d))
  const { shell, gap, liner } = splitStack(stack)
  const auto = gap
    ? { outer: shell, inner: liner }
    : { outer: shell.slice(0, Math.ceil(shell.length / 2)), inner: shell.slice(Math.ceil(shell.length / 2)) }
  return { outer: d.door.outer.stack ?? auto.outer, inner: d.door.inner.stack ?? auto.inner }
}

const sumT = (ls: Layer[]) => ls.reduce((a, l) => a + l.thickness, 0)

/** Positions along an edge of the given length, inset from both ends. */
function spread(count: number, length: number, inset: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [length / 2]
  const span = length - 2 * inset
  return Array.from({ length: count }, (_, i) => inset + (span * i) / (count - 1))
}

const OPPOSITE_EDGE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const

function hingeAndLatch(
  cfg: DoorLeaf,
  leaves: { w: number; h: number }[],
  split: boolean,
  lib: Library,
): { hinges: LeafLayout['hinges']; latches: number[]; swingRadius: number } {
  const vertical = cfg.hingeEdge === 'left' || cfg.hingeEdge === 'right'
  const edgeLen = vertical ? leaves[0].h : leaves[0].w
  const hingeType = lib.hinges.find((h) => h.id === cfg.hingeTypeId)
  const latchType = lib.latches.find((l) => l.id === cfg.latchTypeId)
  const inset = hingeType?.edgeInset ?? 0
  const count = edgeLen < MIN_HINGE_SPAN ? 2 : 3
  const positions = count === 2 ? [inset, edgeLen - inset] : [inset, edgeLen / 2, edgeLen - inset]
  const edges: string[] = split ? [cfg.hingeEdge, OPPOSITE_EDGE[cfg.hingeEdge]] : [cfg.hingeEdge]
  return {
    hinges: edges.map((edge) => ({ edge, positions })),
    latches: spread(cfg.latchCount, edgeLen, latchType?.edgeInset ?? 0),
    swingRadius: Math.max(...leaves.map((l) => (vertical ? l.w : l.h))),
  }
}

const MIN_WALL_HINGE_SPAN = 1200

function wallDoorLayout(d: Design, lib: Library, side: DoorSide): WallDoorLayout {
  const o = resolveDims(d).outer
  const stack = wallStack(d, side)
  const panelW = side === 'front' ? o.x : o.z
  const panel = { w: panelW, h: o.y, t: stackThickness(stack) }
  const areaM2 = (panel.w * panel.h) / 1e6
  const massKg = stack.reduce((sum, it) => {
    if (it.kind !== 'layer') return sum
    const density = lib.materials.find((m) => m.id === it.materialId)?.density ?? 0
    return sum + density * (it.thickness / 1000) * areaM2
  }, 0)

  const cfg = d.door.outer
  const vertical = cfg.hingeEdge === 'left' || cfg.hingeEdge === 'right'
  const edgeLen = vertical ? panel.h : panel.w
  const swingRadius = vertical ? panel.w : panel.h
  const hingeType = lib.hinges.find((h) => h.id === cfg.hingeTypeId)
  const latchType = lib.latches.find((l) => l.id === cfg.latchTypeId)
  const count = edgeLen < MIN_WALL_HINGE_SPAN ? 3 : 4

  const inner = resolveDims(d).inner
  const innerW = side === 'front' ? inner.x : inner.z
  const seals: WallDoorLayout['seals'] = [{ line: 'shell', perimeterMm: 2 * (panel.w + panel.h) }]
  if (splitStack(stack).gap) seals.push({ line: 'liner', perimeterMm: 2 * (innerW + inner.y) })

  const collisions: string[] = []
  if (swingRadius > d.door.roomClearance) {
    collisions.push(
      `Wall door needs ${mm(swingRadius)} clear in front of the box, you have ${mm(d.door.roomClearance)}`,
    )
  }
  return {
    side,
    panel,
    massKg,
    hingeEdge: cfg.hingeEdge,
    hinges: spread(count, edgeLen, hingeType?.edgeInset ?? 0),
    latches: spread(cfg.latchCount, edgeLen, latchType?.edgeInset ?? 0),
    seals,
    swingRadius,
    collisions,
    notes: ['Seals are not included in the sound estimate'],
  }
}

export function doorLayout(d: Design, lib: Library): DoorLayout {
  const w = doorWall(d)
  const side: DoorSide = w === 'left' || w === 'right' || w === 'front' ? w : autoDoorSide(d)
  if (d.door.kind === 'wall') {
    const wall = wallDoorLayout(d, lib, side)
    return {
      kind: 'wall', side, outer: null, inner: null, wall, betweenDepth: 0,
      cabsThrough: d.cabs.map((c) => ({ cabId: c.id, fits: true })),
      collisions: [...wall.collisions], notes: [...wall.notes],
    }
  }
  const wall: WallId = side
  const { margin, overlap } = d.door
  const cabs = d.cabs
  const face = cabFace(largestCab(d), side)
  const clear = d.door.opening ?? { w: face.w + 2 * margin, h: face.h + 2 * margin }

  const wallSplit = splitStack(wallStack(d, wall))
  const gapOn = wallSplit.gap !== null
  const layers = doorLeafLayers(d)
  const sealT = (leaf: DoorLeaf) => lib.seals.find((s) => s.id === leaf.sealTypeId)?.thickness ?? 0
  const stackDepth = stackThickness(wallStack(d, wall))
  const innerT = sumT(layers.inner)
  const rebateDepth = innerT + sealT(d.door.inner)
  const betweenDepth = stackDepth - rebateDepth

  const frameDepth = gapOn
    ? { outer: sumT(wallSplit.shell), inner: sumT(wallSplit.liner) }
    : { outer: betweenDepth, inner: rebateDepth }

  const build = (which: 'outer' | 'inner'): LeafLayout => {
    const cfg = d.door[which]
    const t = sumT(layers[which])
    const split = cfg.opening === 'split'
    const total = { w: clear.w + 2 * overlap, h: clear.h + 2 * overlap }
    const leaves = split
      ? [0, 1].map(() => ({ w: (total.w - SPLIT_GAP) / 2, h: total.h, t }))
      : [{ ...total, t }]
    const hw = hingeAndLatch(cfg, leaves, split, lib)
    return {
      which,
      mount: which === 'outer' ? 'shell' : gapOn ? 'liner' : 'rebate',
      opening: { ...clear },
      leaves,
      cutout: cfg.framed
        ? { w: clear.w + 2 * cfg.frameWidth, h: clear.h + 2 * cfg.frameWidth }
        : { ...clear },
      frame: cfg.framed ? { width: cfg.frameWidth, depth: frameDepth[which] } : null,
      ...hw,
      rebate: which === 'inner' ? { depth: rebateDepth, width: overlap } : null,
      direction: cfg.opening === 'in' ? 'in' : 'out',
    }
  }
  const outer = build('outer')
  const inner = build('inner')

  const cabsThrough = cabs.map((c) => {
    const f = cabFace(c, side)
    return { cabId: c.id, fits: f.w <= clear.w && f.h <= clear.h }
  })

  const collisions: string[] = []
  const notes: string[] = []
  if (betweenDepth <= 0) collisions.push('Not enough wall depth for two doors')
  if (d.door.outer.opening === 'in' && betweenDepth < outer.swingRadius) {
    collisions.push(`Outer door can't swing inwards: needs ${mm(outer.swingRadius)}, has ${mm(betweenDepth)}`)
  }
  if (d.door.inner.opening === 'out') {
    if (d.door.outer.opening === 'in') {
      collisions.push("Inner door can't open outwards while the outer door opens inwards")
    } else notes.push('Open the outer door first')
  }
  if (d.door.inner.opening === 'in') {
    const { inner: dims } = resolveDims(d)
    const simCab = cabs.find((c) => c.id === d.sim.cabId) ?? cabs.find((c) => c.id === d.dims.sizingCabId) ?? cabs[0]
    const b = cabBox(d, simCab)
    const room =
      side === 'left' ? b.min.x : side === 'right' ? dims.x - b.max.x : dims.z - b.max.z
    if (inner.swingRadius > room) {
      collisions.push(`Inner door can't swing inwards: needs ${mm(inner.swingRadius)}, has ${mm(room)}`)
    }
  }

  return { kind: 'dual', side, outer, inner, wall: null, betweenDepth, cabsThrough, collisions, notes }
}
