import type { Material } from '../../model/schema'

export type Swatch = { color: string; opacity: number }

/** Stable 0..1 value from a string (FNV-1a, then a golden-ratio spread so near ids differ). */
function unit(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return ((h >>> 0) * 0.6180339887) % 1
}

const hex = (l: number, warm: number): string => {
  // Warm grey: red a touch above green above blue.
  const c = (k: number) => Math.round(Math.min(255, Math.max(0, l * 255 + k * warm)))
  return `#${[c(6), c(0), c(-8)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Neutral colour for a wall material. Sheets sit mid to light, fills are lighter and see-through,
 * rolls (mass loaded vinyl and the like) are the darkest.
 */
export function materialSwatch(id: string, kind: Material['kind'] | undefined): Swatch {
  const u = unit(id)
  if (kind === 'fill') return { color: hex(0.86 + 0.08 * u, 1.2), opacity: 0.45 }
  if (kind === 'roll') return { color: hex(0.26 + 0.06 * u, 0.8), opacity: 1 }
  return { color: hex(0.5 + 0.38 * u, 1), opacity: 1 }
}
