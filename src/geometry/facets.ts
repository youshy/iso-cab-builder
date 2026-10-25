import type { Facet, WallInterior } from '../model/schema'

const rad = (deg: number) => (deg * Math.PI) / 180
const round1 = (n: number) => Math.round(n * 10) / 10

export const packingDepth = (f: Facet): number => f.width * Math.tan(rad(f.tilt))
export const panelLength = (f: Facet): number => f.width / Math.cos(rad(f.tilt))

/** Offset of facet `f` face from the wall face at distance `d` from its hinge edge. */
const offsetFrom = (wi: WallInterior, f: Facet, d: number) => wi.panelThickness + Math.tan(rad(f.tilt)) * d

/** Offset at facet start/end edge (in split-axis coordinates). */
const edgeOffset = (wi: WallInterior, f: Facet, edge: 'start' | 'end') =>
  offsetFrom(wi, f, (edge === 'start') === (f.hinge === 'min') ? 0 : f.width)

export function facetOffsetAt(wi: WallInterior, s: number): number {
  const total = wi.facets.reduce((a, f) => a + f.width, 0)
  const x = Math.min(Math.max(s, 0), total)
  let start = 0
  for (let i = 0; i < wi.facets.length; i++) {
    const f = wi.facets[i]
    const end = start + f.width
    if (x < end || i === wi.facets.length - 1) {
      return offsetFrom(wi, f, f.hinge === 'min' ? x - start : end - x)
    }
    start = end
  }
  return wi.panelThickness
}

export function maxIntrusion(wi: WallInterior | null): number {
  if (!wi) return 0
  return Math.max(...wi.facets.map((f) => offsetFrom(wi, f, f.width)), wi.panelThickness)
}

export function splitEvenly(length: number, n: number): number[] {
  const w = Math.floor(length / n)
  const out = Array<number>(n).fill(w)
  out[n - 1] = length - w * (n - 1)
  return out
}

export function rebalance(
  facets: Facet[],
  index: number,
  width: number,
  length: number,
  minWidth = 10,
): Facet[] | null {
  const nb = index === facets.length - 1 ? index - 1 : index + 1
  if (nb < 0) return null
  const others = facets.reduce((a, f, i) => (i === index || i === nb ? a : a + f.width), 0)
  const nbWidth = length - others - width
  if (nbWidth < minWidth) return null
  return facets.map((f, i) => (i === index ? { ...f, width } : i === nb ? { ...f, width: nbWidth } : f))
}

export function rescale(facets: Facet[], newLength: number): Facet[] {
  const old = facets.reduce((a, f) => a + f.width, 0)
  let used = 0
  return facets.map((f, i) => {
    if (i === facets.length - 1) return { ...f, width: round1(newLength - used) }
    const w = round1((f.width * newLength) / old)
    used += w
    return { ...f, width: w }
  })
}

export const widthError = (facets: Facet[], length: number): number =>
  facets.reduce((a, f) => a + f.width, 0) - length

export function steps(wi: WallInterior): { s: number; delta: number }[] {
  const out: { s: number; delta: number }[] = []
  let s = 0
  for (let i = 0; i < wi.facets.length - 1; i++) {
    s += wi.facets[i].width
    const delta = edgeOffset(wi, wi.facets[i + 1], 'start') - edgeOffset(wi, wi.facets[i], 'end')
    if (Math.abs(delta) > 0.5) out.push({ s, delta })
  }
  return out
}
