import { ExportFileSchema } from '../model/schema'
import type { Design, ExportFile, Library, Project, StackItem } from '../model/schema'
import { newId } from '../model/defaults'
import { deepEqual } from '../model/equal'

/** Ids a stack references. An empty cavity's fill material is ignored: nothing is built from it. */
function stackIds(stack: StackItem[] | null, out: Set<string>) {
  for (const i of stack ?? []) {
    if (i.kind === 'layer') out.add(i.materialId)
    else if (i.fill === 'insulation') out.add(i.fillMaterialId)
  }
}

/** Every material id referenced anywhere in a design. */
function designMaterialIds(d: Design, out: Set<string>) {
  stackIds(d.wallDefault, out)
  for (const s of Object.values(d.wallOverrides)) stackIds(s, out)
  for (const w of Object.values(d.interior)) out.add(w.panelMaterialId)
  for (const p of d.panels) {
    stackIds(p.layers, out)
    if (p.insulation) out.add(p.insulation.materialId)
  }
  for (const t of d.treatments) out.add(t.materialId)
  stackIds(d.door.outer.stack, out)
  stackIds(d.door.inner.stack, out)
}

type Hardware = 'hinges' | 'seals' | 'latches'
const HARDWARE: Hardware[] = ['hinges', 'seals', 'latches']
const LEAF_KEY = { hinges: 'hingeTypeId', seals: 'sealTypeId', latches: 'latchTypeId' } as const

const designs = (p: Project): Design[] => [...p.versions.map((v) => v.design), ...(p.working ? [p.working] : [])]

function projectMaterialIds(p: Project): Set<string> {
  const ids = new Set<string>()
  for (const d of designs(p)) designMaterialIds(d, ids)
  return ids
}

function projectHardwareIds(p: Project, kind: Hardware): Set<string> {
  const ids = new Set<string>()
  for (const d of designs(p)) for (const leaf of [d.door.outer, d.door.inner]) ids.add(leaf[LEAF_KEY[kind]])
  return ids
}

/** File name for an exported design: its name without characters file systems reject. */
export function exportFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/-+$/g, '').trim()
  return `${clean || 'design'}.isocab.json`
}

export function exportProject(p: Project, lib: Library): string {
  const used = projectMaterialIds(p)
  const file: ExportFile = {
    format: 'isocab',
    schemaVersion: 1,
    project: p,
    materials: lib.materials.filter((m) => used.has(m.id)),
    hinges: lib.hinges.filter((h) => projectHardwareIds(p, 'hinges').has(h.id)),
    seals: lib.seals.filter((h) => projectHardwareIds(p, 'seals').has(h.id)),
    latches: lib.latches.filter((h) => projectHardwareIds(p, 'latches').has(h.id)),
  }
  return JSON.stringify(file, null, 2)
}

export type ImportResult =
  | { ok: true; project: Project; library: Library; notes: string[] }
  | { ok: false; error: string }

/**
 * Merge the file's items into the library's. A new id is added; an identical one is skipped; one that
 * differs from the local item and is used by the design is added as `<id>-imported` and the returned
 * map sends its references there.
 */
function mergeItems<T extends { id: string }>(local: T[], incoming: T[], used: Set<string>): { items: T[]; renamed: Map<string, string> } {
  const items = [...local]
  const renamed = new Map<string, string>()
  for (const m of incoming) {
    const cur = items.find((x) => x.id === m.id)
    if (!cur) {
      items.push(m)
      continue
    }
    if (deepEqual(cur, m) || !used.has(m.id)) continue
    let id = `${m.id}-imported`
    for (let k = 2; items.some((x) => x.id === id && !deepEqual({ ...x, id: m.id }, m)); k++) id = `${m.id}-imported-${k}`
    if (!items.some((x) => x.id === id)) items.push({ ...m, id })
    renamed.set(m.id, id)
  }
  return { items, renamed }
}

function remapDesign(d: Design, mat: Map<string, string>, hw: Record<Hardware, Map<string, string>>) {
  const m = (id: string) => mat.get(id) ?? id
  const stack = (s: StackItem[] | null) => {
    for (const i of s ?? []) {
      if (i.kind === 'layer') i.materialId = m(i.materialId)
      else i.fillMaterialId = m(i.fillMaterialId)
    }
  }
  stack(d.wallDefault)
  for (const s of Object.values(d.wallOverrides)) stack(s)
  for (const w of Object.values(d.interior)) w.panelMaterialId = m(w.panelMaterialId)
  for (const p of d.panels) {
    stack(p.layers)
    if (p.insulation) p.insulation.materialId = m(p.insulation.materialId)
  }
  for (const t of d.treatments) t.materialId = m(t.materialId)
  for (const leaf of [d.door.outer, d.door.inner]) {
    stack(leaf.stack)
    for (const kind of HARDWARE) leaf[LEAF_KEY[kind]] = hw[kind].get(leaf[LEAF_KEY[kind]]) ?? leaf[LEAF_KEY[kind]]
  }
}

export function importProject(text: string, lib: Library): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This is not a valid JSON file.' }
  }
  if (raw && typeof raw === 'object' && typeof (raw as { schemaVersion?: unknown }).schemaVersion === 'number') {
    if ((raw as { schemaVersion: number }).schemaVersion > 1) {
      return { ok: false, error: 'This file was saved by a newer version of the app.' }
    }
  }
  const parsed = ExportFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `${issue.path.join('.')}: ${issue.message}` }
  }
  const file = parsed.data
  const project = structuredClone(file.project)

  const usedMaterials = projectMaterialIds(project)
  const known = new Set<string>([...lib.materials.map((m) => m.id), ...file.materials.map((m) => m.id)])
  for (const id of usedMaterials) {
    if (!known.has(id)) return { ok: false, error: `Unknown material: ${id}` }
  }

  const materials = mergeItems(lib.materials, file.materials, usedMaterials)
  const hw = {} as Record<Hardware, ReturnType<typeof mergeItems>>
  for (const kind of HARDWARE) hw[kind] = mergeItems<{ id: string }>(lib[kind], file[kind], projectHardwareIds(project, kind))
  const renames = [materials.renamed, ...HARDWARE.map((k) => hw[k].renamed)]
  if (renames.some((r) => r.size > 0)) {
    const maps = { hinges: hw.hinges.renamed, seals: hw.seals.renamed, latches: hw.latches.renamed }
    for (const d of designs(project)) remapDesign(d, materials.renamed, maps)
  }
  const notes = renames.flatMap((r) => [...r].map(([from, to]) => `${from} differs from yours, so it was imported as ${to}`))
  return {
    ok: true,
    project: { ...project, id: newId() },
    library: {
      ...lib,
      materials: materials.items,
      hinges: hw.hinges.items as Library['hinges'],
      seals: hw.seals.items as Library['seals'],
      latches: hw.latches.items as Library['latches'],
    },
    notes,
  }
}
