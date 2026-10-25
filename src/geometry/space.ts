import { doorWall } from '../doors/side'
import type { Axis, Cab, Design, Vec3, WallId } from '../model/schema'
import { resolveDims } from './dimensions'
import { panelExtent, surfaceOffsetAt, wallIntrusion } from './treatments'
import { activeInterior, oppositeWall, WALLS } from './walls'

export type Box = { min: Vec3; max: Vec3 }

export function cabBox(d: Design, cab: Cab): Box {
  const { inner } = resolveDims(d)
  const lo = wallIntrusion(d, 'left')
  const hi = inner.x - wallIntrusion(d, 'right')
  const x0 = (lo + hi) / 2 - cab.w / 2
  const y0 = wallIntrusion(d, 'bottom')
  const z0 = wallIntrusion(d, 'back') + d.dims.clearance
  return {
    min: { x: x0, y: y0, z: z0 },
    max: { x: x0 + cab.w, y: y0 + cab.h, z: z0 + cab.d },
  }
}

export function cabFit(d: Design): { cabId: string; fits: boolean; shortBy: Vec3 }[] {
  const { free } = resolveDims(d)
  const c2 = 2 * d.dims.clearance
  return d.cabs.map((cab) => {
    const short = (need: number, have: number) => Math.max(0, need - Math.max(0, have))
    const shortBy = {
      x: short(cab.w + c2, free.x),
      y: short(cab.h + c2, free.y),
      z: short(cab.d + c2, free.z),
    }
    return { cabId: cab.id, fits: shortBy.x === 0 && shortBy.y === 0 && shortBy.z === 0, shortBy }
  })
}

const inside = (b: Box, p: Vec3) =>
  p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z

/** Distance from point to the wall's inner face. */
function wallDistance(w: WallId, p: Vec3, inner: Vec3): number {
  switch (w) {
    case 'left': return p.x
    case 'right': return inner.x - p.x
    case 'bottom': return p.y
    case 'top': return inner.y - p.y
    case 'back': return p.z
    case 'front': return inner.z - p.z
  }
}

const otherAxes = (n: Axis): [Axis, Axis] => (n === 'x' ? ['y', 'z'] : n === 'y' ? ['x', 'z'] : ['x', 'y'])

export function isAir(d: Design, p: Vec3): boolean {
  const { inner } = resolveDims(d)
  if (p.x < 0 || p.y < 0 || p.z < 0 || p.x > inner.x || p.y > inner.y || p.z > inner.z) return false

  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    if (wallDistance(w, p, inner) < surfaceOffsetAt(d, w, wi ? p[wi.splitAxis] : 0)) return false
  }

  if (d.sim.cabId !== '') {
    const cab = d.cabs.find((c) => c.id === d.sim.cabId)
    if (cab && inside(cabBox(d, cab), p)) return false
  }

  for (const panel of d.panels) {
    const { lo, hi } = panelExtent(d, panel)
    const [u, v] = otherAxes(panel.normal)
    if (
      p[panel.normal] >= lo &&
      p[panel.normal] <= hi &&
      p[u] >= panel.u0 && p[u] <= panel.u1 &&
      p[v] >= panel.v0 && p[v] <= panel.v1
    ) return false
  }
  return true
}

export function cornerFlags(d: Design): { walls: [WallId, WallId] }[] {
  const tilted = (w: WallId) => activeInterior(d, w)?.facets.some((f) => f.tilt > 0) ?? false
  const out: { walls: [WallId, WallId] }[] = []
  for (let i = 0; i < WALLS.length; i++) {
    for (let j = i + 1; j < WALLS.length; j++) {
      const a = WALLS[i], b = WALLS[j]
      if (oppositeWall(a) !== b && tilted(a) && tilted(b)) out.push({ walls: [a, b] })
    }
  }
  return out
}

export function inactiveFacetWarnings(d: Design): string[] {
  const w = doorWall(d)
  return d.interior[w] ? [`Facets on the ${w} wall are ignored because the door is on that wall.`] : []
}
