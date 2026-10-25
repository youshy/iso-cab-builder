import { rebalance, rescale, splitEvenly } from '../geometry/facets'
import { resolveDims } from '../geometry/dimensions'
import { wallPlaneAxes } from '../geometry/walls'
import type { Axis, Design, Facet, WallId, WallInterior } from './schema'

export const MIN_FACET = 10
export const MAX_FACETS = 8

/** Length of the wall along an axis: the resolved inner cavity. */
export const wallLength = (d: Design, axis: Axis): number => resolveDims(d).inner[axis]

/** A flat interior for an untouched wall, split along its first plane axis unless told otherwise. */
export function newInterior(d: Design, w: WallId, axis: Axis = wallPlaneAxes(w)[0]): WallInterior {
  return {
    splitAxis: axis,
    facets: [{ width: wallLength(d, axis), tilt: 0, hinge: 'min' }],
    panelMaterialId: 'plywood',
    panelThickness: 12,
    closure: 'fillers',
    behind: 'insulation',
  }
}

/** Draft edit: the wall's interior, created when missing. */
export function ensureInterior(d: Design, w: WallId, axis?: Axis): WallInterior {
  return (d.interior[w] ??= newInterior(d, w, axis))
}

/** Draft edit: change the split axis, keeping the facet count and re-splitting evenly. */
export function setSplitAxis(d: Design, w: WallId, axis: Axis): void {
  const wi = d.interior[w]
  if (!wi) {
    ensureInterior(d, w, axis)
    return
  }
  if (wi.splitAxis === axis) return
  wi.splitAxis = axis
  splitWallEvenly(d, w)
}

/** Draft edit: equal widths over the current wall length. */
export function splitWallEvenly(d: Design, w: WallId): void {
  const wi = d.interior[w]
  if (!wi) return
  const widths = splitEvenly(wallLength(d, wi.splitAxis), wi.facets.length)
  wi.facets.forEach((f, i) => (f.width = widths[i]))
}

/** Draft edit: set the facet count (1 to 8). Adding keeps existing tilts; the last facet is dropped when removing. */
export function setFacetCount(d: Design, w: WallId, n: number): void {
  const count = Math.min(MAX_FACETS, Math.max(1, Math.round(n)))
  const wi = ensureInterior(d, w)
  while (wi.facets.length < count) wi.facets.push({ width: MIN_FACET, tilt: 0, hinge: 'min' })
  wi.facets.length = count
  splitWallEvenly(d, w)
}

/**
 * New facet list after typing a width for one facet, or null when the neighbour would be
 * under the minimum. The typed width is first clamped so the others can still fit.
 */
export function editFacetWidth(facets: Facet[], index: number, width: number, length: number): Facet[] | null {
  const hi = length - MIN_FACET * (facets.length - 1)
  const w = Math.min(Math.max(width, MIN_FACET), Math.max(hi, MIN_FACET))
  return rebalance(facets, index, Math.round(w * 10) / 10, length, MIN_FACET)
}

/**
 * After an edit, interiors whose wall length changed (e.g. the inner box was resized)
 * get their facets scaled to the new length. Runs until stable because facets also
 * change the inner size in cab-driven mode. Mutates and returns `next`.
 */
export function rescaleInteriors(prev: Design, next: Design): Design {
  let before = resolveDims(prev).inner
  const beforeAxis = (w: WallId) => prev.interior[w]?.splitAxis
  const prevAxes = new Map<WallId, Axis | undefined>(
    (Object.keys(next.interior) as WallId[]).map((w) => [w, beforeAxis(w)]),
  )
  for (let pass = 0; pass < 4; pass++) {
    const after = resolveDims(next).inner
    let changed = false
    for (const w of Object.keys(next.interior) as WallId[]) {
      const wi = next.interior[w]!
      if (prevAxes.get(w) !== wi.splitAxis) continue
      const ax = wi.splitAxis
      if (Math.abs(after[ax] - before[ax]) > 0.05) {
        wi.facets = rescale(wi.facets, after[ax])
        changed = true
      }
    }
    if (!changed) break
    before = after
  }
  return next
}
