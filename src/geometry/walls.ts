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

/** Outside-in stack split around its (single) gap. No gap: everything is shell. */
export function splitStack(items: StackItem[]): { shell: Layer[]; gap: Gap | null; liner: Layer[] } {
  const gi = items.findIndex((i) => i.kind === 'gap')
  const layers = (xs: StackItem[]) => xs.filter((i): i is Layer => i.kind === 'layer')
  if (gi < 0) return { shell: layers(items), gap: null, liner: [] }
  return { shell: layers(items.slice(0, gi)), gap: items[gi] as Gap, liner: layers(items.slice(gi + 1)) }
}

/** Facets on the door wall stay in the data but are inactive. */
export function activeInterior(d: Design, w: WallId): WallInterior | null {
  if (w === doorWall(d)) return null
  return d.interior[w] ?? null
}
