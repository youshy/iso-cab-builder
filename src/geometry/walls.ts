import { doorWall } from '../doors/side'
import type { Axis, Design, Gap, Layer, StackItem, WallId, WallInterior } from '../model/schema'

export const WALLS: WallId[] = ['left', 'right', 'top', 'bottom', 'back', 'front']

const NORMAL: Record<WallId, Axis> = { left: 'x', right: 'x', bottom: 'y', top: 'y', back: 'z', front: 'z' }
const PLANE: Record<WallId, [Axis, Axis]> = {
  left: ['y', 'z'],
  right: ['y', 'z'],
  top: ['x', 'z'],
  bottom: ['x', 'z'],
  back: ['x', 'y'],
  front: ['x', 'y'],
}
const OPPOSITE: Record<WallId, WallId> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
  back: 'front',
  front: 'back',
}

export const wallNormal = (w: WallId): Axis => NORMAL[w]
export const wallPlaneAxes = (w: WallId): [Axis, Axis] => PLANE[w]
export const oppositeWall = (w: WallId): WallId => OPPOSITE[w]

export const wallStack = (d: Design, w: WallId): StackItem[] => d.wallOverrides[w] ?? d.wallDefault

export const stackThickness = (items: StackItem[]): number =>
  items.reduce((a, i) => a + (i.kind === 'layer' ? i.thickness : i.width), 0)

/** Layers between cavities, outside-in. Always one more group than cavities; no cavity: one group. */
export function leafGroups(items: StackItem[]): Layer[][] {
  const groups: Layer[][] = [[]]
  for (const it of items) {
    if (it.kind === 'gap') groups.push([])
    else groups[groups.length - 1].push(it)
  }
  return groups
}

/** Cavities (gaps) of the stack, outside-in. */
export const cavities = (items: StackItem[]): Gap[] => items.filter((i): i is Gap => i.kind === 'gap')

/**
 * Outside-in stack split into shell (outermost group), the first gap, liner (innermost group, empty when
 * there is no gap) and the groups in between. No gap: everything is shell.
 */
export function splitStack(items: StackItem[]): { shell: Layer[]; gap: Gap | null; liner: Layer[]; middle: Layer[][] } {
  const groups = leafGroups(items)
  const gap = cavities(items)[0] ?? null
  if (!gap) return { shell: groups[0], gap: null, liner: [], middle: [] }
  return { shell: groups[0], gap, liner: groups[groups.length - 1], middle: groups.slice(1, -1) }
}

/** Facets on the door wall stay in the data but are inactive. */
export function activeInterior(d: Design, w: WallId): WallInterior | null {
  if (w === doorWall(d)) return null
  return d.interior[w] ?? null
}
