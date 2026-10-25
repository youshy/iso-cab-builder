import { maxIntrusion } from './facets'
import { activeInterior, stackThickness, wallStack } from './walls'
import type { Design, Vec3, WallId } from '../model/schema'

const round1 = (n: number) => Math.round(n * 10) / 10
const PAIRS: [keyof Vec3, WallId, WallId][] = [
  ['x', 'left', 'right'],
  ['y', 'bottom', 'top'],
  ['z', 'back', 'front'],
]

export function resolveDims(d: Design): { inner: Vec3; outer: Vec3; free: Vec3; grownBy: Vec3 } {
  const inner: Vec3 = { x: 0, y: 0, z: 0 }
  const outer: Vec3 = { x: 0, y: 0, z: 0 }
  const free: Vec3 = { x: 0, y: 0, z: 0 }
  const grownBy: Vec3 = { x: 0, y: 0, z: 0 }
  const cab =
    d.dims.mode === 'inside' && d.dims.innerSource === 'cab'
      ? (d.cabs.find((c) => c.id === d.dims.sizingCabId) ?? d.cabs[0])
      : null
  const cabSize: Vec3 | null = cab ? { x: cab.w, y: cab.h, z: cab.d } : null

  for (const [axis, a, b] of PAIRS) {
    const stacks = stackThickness(wallStack(d, a)) + stackThickness(wallStack(d, b))
    const intrusions = maxIntrusion(activeInterior(d, a)) + maxIntrusion(activeInterior(d, b))
    let i: number
    if (d.dims.mode === 'outside') {
      i = d.dims.outer[axis] - stacks
    } else if (cabSize) {
      grownBy[axis] = intrusions
      i = cabSize[axis] + 2 * d.dims.clearance + intrusions
    } else {
      i = d.dims.inner[axis]
    }
    inner[axis] = round1(i)
    outer[axis] = round1(i + stacks)
    free[axis] = round1(i - intrusions)
    grownBy[axis] = round1(grownBy[axis])
  }
  return { inner, outer, free, grownBy }
}
