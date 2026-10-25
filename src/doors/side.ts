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
