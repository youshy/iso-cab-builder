import type { BuildStep, Part } from '../cutlist/parts'
import type { Tag } from './svg'

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
export const r05 = (n: number): number => Math.round(n * 2) / 2

/**
 * Hands out part balloons in drawing order: the first drawing of a part gets the balloon (with its quantity),
 * every later drawing of the same part a plain reference. Also remembers which parts are drawn at all.
 */
export class PartTags {
  private seen = new Set<string>()
  constructor(readonly parts: Part[]) {}

  named(step: BuildStep, name: string): Part | undefined {
    return this.parts.find((p) => p.step === step && p.name === name)
  }

  tag(p: Part | undefined): Tag | null {
    if (!p) return null
    const first = !this.seen.has(p.id)
    this.seen.add(p.id)
    return { id: p.id, qty: p.qty, first }
  }

  drawn(id: string): boolean {
    return this.seen.has(id)
  }
}
