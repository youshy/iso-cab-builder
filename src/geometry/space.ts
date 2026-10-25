import { doorWall } from '../doors/side'
import type { Axis, Cab, Design, Layer, Library, Material, Vec3, WallId } from '../model/schema'
import { cabFootprint, resolveDims } from './dimensions'
import { facetOffsetAt } from './facets'
import { panelExtent, panelTreatments, wallIntrusion, wallTreatments, wallTreatmentThickness } from './treatments'
import { activeInterior, oppositeWall, wallStack, WALLS } from './walls'

export type Box = { min: Vec3; max: Vec3 }

/** Where a cab stands: centre of its footprint (middle of the free x span, on the floor, behind the rotated depth) and its turn. */
export function cabPose(d: Design, cab: Cab): { centre: Vec3; yaw: number } {
  const { inner } = resolveDims(d)
  const fp = cabFootprint(cab, d.cabYaw)
  const lo = wallIntrusion(d, 'left')
  const hi = inner.x - wallIntrusion(d, 'right')
  return {
    centre: {
      x: (lo + hi) / 2,
      y: wallIntrusion(d, 'bottom') + cab.h / 2,
      z: wallIntrusion(d, 'back') + d.dims.clearance + fp.d / 2,
    },
    yaw: d.cabYaw,
  }
}

/** Axis-aligned bounding box of the (possibly rotated) cab. */
export function cabBox(d: Design, cab: Cab): Box {
  const { centre } = cabPose(d, cab)
  const fp = cabFootprint(cab, d.cabYaw)
  return {
    min: { x: centre.x - fp.w / 2, y: centre.y - cab.h / 2, z: centre.z - fp.d / 2 },
    max: { x: centre.x + fp.w / 2, y: centre.y + cab.h / 2, z: centre.z + fp.d / 2 },
  }
}

/** Unit vectors of a cab turned by yaw: facing (out of the front baffle) and right (seen from the front). */
export function cabAxes(yaw: number): { facing: Vec3; right: Vec3 } {
  const r = (yaw * Math.PI) / 180
  const [s, c] = [Math.sin(r), Math.cos(r)]
  return { facing: { x: s, y: 0, z: c }, right: { x: c, y: 0, z: -s } }
}

/** Speaker centres on the front baffle in domain coordinates, with the unit vector each one faces. */
export function speakerPositions(d: Design, cab: Cab): { p: Vec3; facing: Vec3 }[] {
  const { centre, yaw } = cabPose(d, cab)
  const { facing, right } = cabAxes(yaw)
  return cab.speakers.map((s) => {
    const u = s.x - cab.w / 2
    return {
      p: {
        x: centre.x + u * right.x + (cab.d / 2) * facing.x,
        y: centre.y - cab.h / 2 + s.y,
        z: centre.z + u * right.z + (cab.d / 2) * facing.z,
      },
      facing,
    }
  })
}

export function cabFit(d: Design): { cabId: string; fits: boolean; shortBy: Vec3 }[] {
  const { free } = resolveDims(d)
  const c2 = 2 * d.dims.clearance
  return d.cabs.map((cab) => {
    const short = (need: number, have: number) => Math.max(0, need - Math.max(0, have))
    const fp = cabFootprint(cab, d.cabYaw)
    const shortBy = {
      x: short(fp.w + c2, free.x),
      y: short(cab.h + c2, free.y),
      z: short(fp.d + c2, free.z),
    }
    return { cabId: cab.id, fits: shortBy.x === 0 && shortBy.y === 0 && shortBy.z === 0, shortBy }
  })
}

/** Point test for the cab as an oriented box: bounding box first, then the turned footprint. Centre and trig are resolved once. */
function orientedTest(d: Design, cab: Cab): (p: Vec3) => boolean {
  const b = cabBox(d, cab)
  const { centre, yaw } = cabPose(d, cab)
  if (yaw % 180 === 0) return (p) => inside(b, p)
  const { facing, right } = cabAxes(yaw)
  const [hw, hd] = [cab.w / 2, cab.d / 2]
  return (p) => {
    if (!inside(b, p)) return false
    const dx = p.x - centre.x, dz = p.z - centre.z
    return Math.abs(dx * right.x + dz * right.z) <= hw && Math.abs(dx * facing.x + dz * facing.z) <= hd
  }
}

const inside = (b: Box, p: Vec3) =>
  p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z

/** Distance from point to the wall's inner face. */
export function wallDistance(w: WallId, p: Vec3, inner: Vec3): number {
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

/** Everything isAir and materialAt need, resolved once per design so repeated point tests stay cheap. */
function spaceLayout(d: Design) {
  const { inner } = resolveDims(d)
  const walls = WALLS.map((w) => {
    const wi = activeInterior(d, w)
    return { w, wi, treatments: wallTreatments(d, w), treatment: wallTreatmentThickness(d, w) }
  })
  const cab = d.sim.cabId === '' ? undefined : d.cabs.find((c) => c.id === d.sim.cabId)
  const cabIn = cab ? orientedTest(d, cab) : null
  const panels = d.panels.map((panel) => {
    const [u, v] = otherAxes(panel.normal)
    return { panel, u, v, ...panelExtent(d, panel) }
  })
  const facetOffset = (wl: (typeof walls)[number], p: Vec3) => (wl.wi ? facetOffsetAt(wl.wi, p[wl.wi.splitAxis]) : 0)
  const inPlane = (pl: (typeof panels)[number], p: Vec3) =>
    p[pl.u] >= pl.panel.u0 && p[pl.u] <= pl.panel.u1 && p[pl.v] >= pl.panel.v0 && p[pl.v] <= pl.panel.v1
  const outside = (p: Vec3) => p.x < 0 || p.y < 0 || p.z < 0 || p.x > inner.x || p.y > inner.y || p.z > inner.z
  return { inner, walls, cabIn, panels, facetOffset, inPlane, outside }
}

/** A point test equivalent to isAir(d, p), with the design resolved once up front. */
export function airTest(d: Design): (p: Vec3) => boolean {
  const { inner, walls, cabIn, panels, facetOffset, inPlane, outside } = spaceLayout(d)
  return (p) => {
    if (outside(p)) return false
    for (const wl of walls) {
      if (wallDistance(wl.w, p, inner) < facetOffset(wl, p) + wl.treatment) return false
    }
    if (cabIn && cabIn(p)) return false
    for (const pl of panels) {
      if (p[pl.panel.normal] >= pl.lo && p[pl.panel.normal] <= pl.hi && inPlane(pl, p)) return false
    }
    return true
  }
}

export function isAir(d: Design, p: Vec3): boolean {
  return airTest(d)(p)
}

/**
 * A point test equivalent to materialAt(d, lib, p), with the design resolved once up front.
 * Precedence: treatment, inner panel, facet, cab, wall layer. Outside the cavity the material is the
 * innermost layer of the wall the point lies beyond (the liner side when the wall has a gap).
 */
export function materialTest(d: Design, lib: Library): (p: Vec3) => Material | null {
  const L = spaceLayout(d)
  const byId = (id: string | undefined) => (id === undefined ? null : (lib.materials.find((m) => m.id === id) ?? null))
  const innermost = (w: WallId) => {
    const layers = wallStack(d, w).filter((i): i is Layer => i.kind === 'layer')
    return byId(layers[layers.length - 1]?.materialId)
  }
  const cabMaterial = byId('plywood') ?? lib.materials.find((m) => m.kind === 'sheet') ?? null
  const air = airTest(d)
  const BEYOND: [Axis, WallId, WallId][] = [['x', 'left', 'right'], ['y', 'bottom', 'top'], ['z', 'back', 'front']]

  return (p) => {
    if (L.outside(p)) {
      let wall: WallId = 'left'
      let worst = -Infinity
      for (const [a, lo, hi] of BEYOND) {
        if (-p[a] > worst) { worst = -p[a]; wall = lo }
        if (p[a] - L.inner[a] > worst) { worst = p[a] - L.inner[a]; wall = hi }
      }
      return innermost(wall)
    }
    if (air(p)) return null

    for (const wl of L.walls) {
      if (wl.treatment === 0) continue
      const dist = wallDistance(wl.w, p, L.inner)
      let at = L.facetOffset(wl, p)
      if (dist < at || dist >= at + wl.treatment) continue
      for (const t of wl.treatments) {
        at += t.thickness
        if (dist < at) return byId(t.materialId)
      }
    }
    for (const pl of L.panels) {
      const n = p[pl.panel.normal]
      if (!L.inPlane(pl, p)) continue
      if (n >= pl.lo && n < pl.slabLo) {
        let at = pl.slabLo
        for (const t of panelTreatments(d, pl.panel.id, 'neg')) {
          at -= t.thickness
          if (n >= at) return byId(t.materialId)
        }
      }
      if (n > pl.slabHi && n <= pl.hi) {
        let at = pl.slabHi
        for (const t of panelTreatments(d, pl.panel.id, 'pos')) {
          at += t.thickness
          if (n <= at) return byId(t.materialId)
        }
      }
    }
    for (const pl of L.panels) {
      const n = p[pl.panel.normal]
      if (n < pl.slabLo || n > pl.slabHi || !L.inPlane(pl, p)) continue
      // Insulation on a panel is treated as the absorbing surface on both faces.
      if (pl.panel.insulation) return byId(pl.panel.insulation.materialId)
      const layers = pl.panel.layers
      return byId((n - pl.slabLo < pl.slabHi - n ? layers[0] : layers[layers.length - 1])?.materialId)
    }
    for (const wl of L.walls) {
      if (wl.wi && wallDistance(wl.w, p, L.inner) < L.facetOffset(wl, p)) return byId(wl.wi.panelMaterialId)
    }
    if (L.cabIn && L.cabIn(p)) return cabMaterial
    return null
  }
}

/** The material of the solid occupying point p; null when p is air or the material is not in the library. */
export function materialAt(d: Design, lib: Library, p: Vec3): Material | null {
  return materialTest(d, lib)(p)
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
