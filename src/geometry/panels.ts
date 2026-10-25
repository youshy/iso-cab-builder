import type { Axis, Design, InnerPanel, Vec3, WallId } from '../model/schema'
import { resolveDims } from './dimensions'
import { wallDistance } from './space'
import { panelExtent, surfaceOffsetAt, wallIntrusion } from './treatments'
import { activeInterior, WALLS } from './walls'

const AXES: Axis[] = ['x', 'y', 'z']
const SAMPLES = 9

/** The two axes of a panel's plane, in x, y, z order. */
export const panelPlane = (normal: Axis): [Axis, Axis] => AXES.filter((a) => a !== normal) as [Axis, Axis]

/** Keep a value inside [0, max]. */
export const clampTo = (v: number, max: number): number => Math.min(Math.max(v, 0), Math.max(max, 0))

/** How far the panel box (slab, its treatments and its in-plane extent) reaches past the inner cavity, in mm. */
export function panelOvershoot(d: Design, p: InnerPanel): number {
  const { inner } = resolveDims(d)
  const e = panelExtent(d, p)
  const [u, v] = panelPlane(p.normal)
  return Math.max(
    0,
    -e.lo, e.hi - inner[p.normal],
    -Math.min(p.u0, p.u1), Math.max(p.u0, p.u1) - inner[u],
    -Math.min(p.v0, p.v1), Math.max(p.v0, p.v1) - inner[v],
  )
}

/** Walls whose facets or treatments the in-cavity part of the panel box overlaps. */
function wallsCutInto(d: Design, p: InnerPanel): WallId[] {
  const { inner } = resolveDims(d)
  const e = panelExtent(d, p)
  const [u, v] = panelPlane(p.normal)
  const range = (a: number, b: number, max: number): [number, number] => [clampTo(Math.min(a, b), max), clampTo(Math.max(a, b), max)]
  const along: Record<Axis, [number, number]> = { x: [0, 0], y: [0, 0], z: [0, 0] }
  along[p.normal] = range(e.lo, e.hi, inner[p.normal])
  along[u] = range(p.u0, p.u1, inner[u])
  along[v] = range(p.v0, p.v1, inner[v])
  const at = (a: Axis, k: number) => along[a][0] + ((along[a][1] - along[a][0]) * k) / (SAMPLES - 1)
  const hit = new Set<WallId>()
  const pt: Vec3 = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) for (let k = 0; k < 3; k++) {
    pt[u] = at(u, i); pt[v] = at(v, j); pt[p.normal] = k === 0 ? along[p.normal][0] : k === 1 ? at(p.normal, SAMPLES >> 1) : along[p.normal][1]
    for (const w of WALLS) {
      const wi = activeInterior(d, w)
      // Strict, so a panel resting exactly on a flat face is not a collision.
      if (wallDistance(w, pt, inner) < surfaceOffsetAt(d, w, wi ? pt[wi.splitAxis] : 0) - 1e-6) hit.add(w)
    }
  }
  return WALLS.filter((w) => hit.has(w))
}

const fmt = (mm: number) => `${Math.round(mm)} mm`

/** One message per inner panel that leaves the cavity or cuts into a wall's facets or treatments. */
export function panelWarnings(d: Design): string[] {
  const out: string[] = []
  d.panels.forEach((p, i) => {
    const over = panelOvershoot(d, p)
    if (over > 1e-6) out.push(`Panel ${i + 1} sticks out of the box by ${fmt(over)}.`)
    for (const w of wallsCutInto(d, p)) {
      out.push(`Panel ${i + 1} cuts into the ${w} wall ${activeInterior(d, w) ? 'facets' : 'treatment'}.`)
    }
  })
  return out
}

/** The span along an axis that no wall's facets or treatments reach into. */
export function freeSpan(d: Design, a: Axis): [number, number] {
  const { inner } = resolveDims(d)
  const [lo, hi]: [WallId, WallId] = a === 'x' ? ['left', 'right'] : a === 'y' ? ['bottom', 'top'] : ['back', 'front']
  const from = wallIntrusion(d, lo)
  return [from, Math.max(from, inner[a] - wallIntrusion(d, hi))]
}
