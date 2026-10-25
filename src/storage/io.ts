import { ExportFileSchema } from '../model/schema'
import type { Design, ExportFile, Library, Material, Project, StackItem } from '../model/schema'
import { newId } from '../model/defaults'

function stackIds(stack: StackItem[] | null, out: Set<string>) {
  for (const i of stack ?? []) out.add(i.kind === 'layer' ? i.materialId : i.fillMaterialId)
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

function projectMaterialIds(p: Project): Set<string> {
  const ids = new Set<string>()
  for (const v of p.versions) designMaterialIds(v.design, ids)
  if (p.working) designMaterialIds(p.working, ids)
  return ids
}

export function exportProject(p: Project, lib: Library): string {
  const used = projectMaterialIds(p)
  const file: ExportFile = {
    format: 'isocab',
    schemaVersion: 1,
    project: p,
    materials: lib.materials.filter((m) => used.has(m.id)),
  }
  return JSON.stringify(file, null, 2)
}

export type ImportResult = { ok: true; project: Project; library: Library } | { ok: false; error: string }

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

  const known = new Set<string>([...lib.materials.map((m) => m.id), ...file.materials.map((m) => m.id)])
  for (const id of projectMaterialIds(file.project)) {
    if (!known.has(id)) return { ok: false, error: `Unknown material: ${id}` }
  }

  const have = new Set(lib.materials.map((m) => m.id))
  const added: Material[] = []
  for (const m of file.materials) {
    if (!have.has(m.id)) {
      have.add(m.id)
      added.push(m)
    }
  }
  return {
    ok: true,
    project: { ...file.project, id: newId() },
    library: { ...lib, materials: [...lib.materials, ...added] },
  }
}
