import type { Design, Gap, Layer, Library, StackItem, WallId } from './schema'

export const DEFAULT_GAP: Gap = { kind: 'gap', width: 25, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' }

export const hasGap = (s: StackItem[]): boolean => s.some((i) => i.kind === 'gap')

/** Insert a gap after the first layer. A stack holds at most one gap, so a second insert is a no-op. */
export function insertGap(s: StackItem[], gap: Gap = DEFAULT_GAP): StackItem[] {
  if (hasGap(s)) return s
  const at = Math.min(1, s.length)
  return [...s.slice(0, at), { ...gap }, ...s.slice(at)]
}

/** A stack is valid when it has a layer and the gap, if any, is not the outermost or innermost item. */
const isValid = (s: StackItem[]): boolean =>
  s.some((i) => i.kind === 'layer') && s[0].kind !== 'gap' && s[s.length - 1].kind !== 'gap'

/** Move item `i` by `dir` (-1 up, +1 down). Out of range, or leaving the gap at a face, returns the stack unchanged. */
export function moveLayer(s: StackItem[], i: number, dir: -1 | 1): StackItem[] {
  const j = i + dir
  if (i < 0 || i >= s.length || j < 0 || j >= s.length) return s
  const out = [...s]
  ;[out[i], out[j]] = [out[j], out[i]]
  return isValid(out) ? out : s
}

/** Remove item `i`. Refused when no Layer would remain or the gap would end up at a face. */
export function removeLayer(s: StackItem[], i: number): StackItem[] {
  if (i < 0 || i >= s.length) return s
  const out = s.filter((_, k) => k !== i)
  return out.length > 0 && isValid(out) ? out : s
}

/**
 * Insert a Layer at `index` (default: end, the inner face). It copies the innermost existing Layer;
 * with no Layer present it takes the first sheet material and its first thickness.
 */
export function addLayer(s: StackItem[], lib: Library, index: number = s.length): StackItem[] {
  const at = Math.max(0, Math.min(index, s.length))
  const layers = s.filter((i): i is Layer => i.kind === 'layer')
  const src = layers[layers.length - 1]
  let layer: Layer
  if (src) layer = { kind: 'layer', materialId: src.materialId, thickness: src.thickness }
  else {
    const m = lib.materials.find((x) => x.kind === 'sheet')
    if (!m) return s
    layer = { kind: 'layer', materialId: m.id, thickness: m.thicknesses[0] }
  }
  return [...s.slice(0, at), layer, ...s.slice(at)]
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
