import type { Design, DoorSide, WallId } from '../model/schema'

/** Door side with the smallest opening area for the largest cab. Ties: left, right, front. */
export function autoDoorSide(d: Design): DoorSide {
  const cab = d.cabs.reduce((a, c) => (c.w * c.h * c.d > a.w * a.h * a.d ? c : a))
  const candidates: [DoorSide, number][] = [
    ['left', cab.d * cab.h],
    ['right', cab.d * cab.h],
    ['front', cab.w * cab.h],
  ]
  return candidates.reduce((best, c) => (c[1] < best[1] ? c : best))[0]
}

export function doorWall(d: Design): WallId {
  return d.door.side === 'auto' ? autoDoorSide(d) : d.door.side
}

/** Axis a door's width runs along: x on the front wall, z on the left and right walls. Height is always y. */
export const doorWidthAxis = (side: DoorSide): 'x' | 'z' => (side === 'front' ? 'x' : 'z')

/**
 * Which end of the width axis a leaf edge named "left" or "right" lies on, seen from outside the box
 * looking at the door. Left wall: left is toward the back. Right wall: left is toward the front.
 */
export function widthEdgeEnd(side: DoorSide, edge: 'left' | 'right'): 'min' | 'max' {
  const leftIsMin = side !== 'right'
  return (edge === 'left') === leftIsMin ? 'min' : 'max'
}
