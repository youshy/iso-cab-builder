import type { Design, Gap, Library, StackItem, WallId } from './schema'

export const DEFAULT_GAP: Gap = { kind: 'gap', width: 25, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' }

export const hasGap = (s: StackItem[]): boolean => s.some((i) => i.kind === 'gap')

/** Insert a gap after the first layer. A stack holds at most one gap, so a second insert is a no-op. */
export function insertGap(s: StackItem[], gap: Gap = DEFAULT_GAP): StackItem[] {
  if (hasGap(s)) return s
  const at = Math.min(1, s.length)
  return [...s.slice(0, at), { ...gap }, ...s.slice(at)]
}

/** Move item `i` by `dir` (-1 up, +1 down). Out of range returns the stack unchanged. */
export function moveLayer(s: StackItem[], i: number, dir: -1 | 1): StackItem[] {
  const j = i + dir
  if (i < 0 || i >= s.length || j < 0 || j >= s.length) return s
  const out = [...s]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Remove item `i`. The last remaining item cannot be removed. */
export function removeLayer(s: StackItem[], i: number): StackItem[] {
  if (s.length <= 1 || i < 0 || i >= s.length) return s
  return s.filter((_, k) => k !== i)
}

/** Replace the material of a layer, keeping its thickness when the new material offers it. */
export function setLayerMaterial(s: StackItem[], i: number, materialId: string, lib: Library): StackItem[] {
  const m = lib.materials.find((x) => x.id === materialId)
  return s.map((it, k) => {
    if (k !== i || it.kind !== 'layer' || !m) return it
    return { ...it, materialId, thickness: m.thicknesses.includes(it.thickness) ? it.thickness : m.thicknesses[0] }
  })
}

const stackUses = (s: StackItem[] | null, id: string) =>
  !!s && s.some((i) => (i.kind === 'layer' ? i.materialId === id : i.fillMaterialId === id && i.fill === 'insulation'))

/** Human-readable places in the design that reference a material. */
export function materialUsage(d: Design, id: string): string[] {
  const out: string[] = []
  if (stackUses(d.wallDefault, id)) out.push('default wall')
  for (const [w, s] of Object.entries(d.wallOverrides) as [WallId, StackItem[]][]) {
    if (stackUses(s, id)) out.push(`${w} wall override`)
  }
  for (const [w, i] of Object.entries(d.interior) as [WallId, NonNullable<Design['interior'][WallId]>][]) {
    if (i.panelMaterialId === id) out.push(`${w} facet panels`)
  }
  for (const p of d.panels) {
    if (p.layers.some((l) => l.materialId === id) || p.insulation?.materialId === id) out.push('inner panel')
  }
  if (d.treatments.some((t) => t.materialId === id)) out.push('surface treatment')
  if (stackUses(d.door.outer.stack, id)) out.push('outer door leaf')
  if (stackUses(d.door.inner.stack, id)) out.push('inner door leaf')
  return [...new Set(out)]
}
