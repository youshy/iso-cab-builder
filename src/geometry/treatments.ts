import { doorWall } from '../doors/side'
import type { Design, InnerPanel, Treatment, WallId } from '../model/schema'
import { facetOffsetAt, maxIntrusion } from './facets'
import { activeInterior } from './walls'

/** Treatments on a wall, in list order (inner face outwards). The door wall carries none in v1. */
export function wallTreatments(d: Design, w: WallId): Treatment[] {
  if (w === doorWall(d)) return []
  return d.treatments.filter((t) => 'wall' in t.surface && t.surface.wall === w)
}

export function wallTreatmentThickness(d: Design, w: WallId): number {
  return wallTreatments(d, w).reduce((a, t) => a + t.thickness, 0)
}

/** Treatments on one side of an inner panel, in list order (panel face outwards). */
export function panelTreatments(d: Design, panelId: string, side: 'neg' | 'pos'): Treatment[] {
  return d.treatments.filter((t) => 'panelId' in t.surface && t.surface.panelId === panelId && t.surface.side === side)
}

export function panelTreatmentThickness(d: Design, panelId: string, side: 'neg' | 'pos'): number {
  return panelTreatments(d, panelId, side).reduce((a, t) => a + t.thickness, 0)
}

/** How far a wall's solid reaches into the cavity at its deepest point: facets plus treatment. */
export const wallIntrusion = (d: Design, w: WallId): number =>
  maxIntrusion(activeInterior(d, w)) + wallTreatmentThickness(d, w)

/** Solid boundary of wall `w` at position `s` along its split axis: facet face offset plus treatment. */
export function surfaceOffsetAt(d: Design, w: WallId, s: number): number {
  const wi = activeInterior(d, w)
  return (wi ? facetOffsetAt(wi, s) : 0) + wallTreatmentThickness(d, w)
}

/** Panel slab along its normal, extended by the treatments on both sides. */
export function panelExtent(d: Design, p: InnerPanel): { lo: number; hi: number; slabLo: number; slabHi: number } {
  const t = p.layers.reduce((a, l) => a + l.thickness, 0) + (p.insulation?.thickness ?? 0)
  return {
    slabLo: p.position,
    slabHi: p.position + t,
    lo: p.position - panelTreatmentThickness(d, p.id, 'neg'),
    hi: p.position + t + panelTreatmentThickness(d, p.id, 'pos'),
  }
}

export function inactiveTreatmentWarnings(d: Design): string[] {
  const w = doorWall(d)
  return d.treatments.some((t) => 'wall' in t.surface && t.surface.wall === w)
    ? [`Treatments on the ${w} wall are ignored because the door is on that wall.`]
    : []
}
