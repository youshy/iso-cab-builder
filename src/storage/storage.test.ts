import { describe, it, expect } from 'vitest'
import { createStore } from './local'
import { exportFileName, exportProject, importProject } from './io'
import { defaultDesign, defaultLibrary, defaultShop, newId } from '../model/defaults'
import type { Project } from '../model/schema'

function memoryBackend() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

function project(): Project {
  return { id: newId(), name: 'Test', versions: [{ version: 1, savedAt: new Date().toISOString(), design: defaultDesign() }] }
}

describe('export/import', () => {
  it('round trips with a new project id', () => {
    const p = project()
    const r = importProject(exportProject(p, defaultLibrary()), defaultLibrary())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.id).not.toBe(p.id)
    expect(r.project.name).toBe(p.name)
    expect(r.project.versions.map((v) => v.design)).toEqual(p.versions.map((v) => v.design))
  })

  it('exports only referenced materials', () => {
    const file = JSON.parse(exportProject(project(), defaultLibrary()))
    expect(file.materials.map((m: { id: string }) => m.id).sort()).toEqual(['mdf', 'plywood'])
  })

  it('rejects non-JSON', () => {
    const r = importProject('not json', defaultLibrary())
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toContain('not a valid JSON file')
  })

  it('rejects newer schema version', () => {
    const r = importProject(JSON.stringify({ format: 'isocab', schemaVersion: 2 }), defaultLibrary())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('newer version')
  })

  it('names the path of a missing field', () => {
    const r = importProject(JSON.stringify({ format: 'isocab', schemaVersion: 1, materials: [] }), defaultLibrary())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^project: /)
  })

  it('names a material that is in neither library nor file', () => {
    const p = project()
    p.versions[0].design.wallDefault = [{ kind: 'layer', materialId: 'unobtainium', thickness: 18 }]
    const lib = defaultLibrary()
    const text = JSON.stringify({ format: 'isocab', schemaVersion: 1, project: p, materials: [] })
    const r = importProject(text, lib)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('unobtainium')
  })

  it('checks references in overrides, gaps, interior, panels, treatments and door leaves', () => {
    const cases: Array<(p: Project) => void> = [
      (p) => (p.versions[0].design.wallOverrides = { left: [{ kind: 'layer', materialId: 'ghost', thickness: 5 }] }),
      (p) =>
        (p.versions[0].design.wallDefault = [
          { kind: 'layer', materialId: 'plywood', thickness: 18 },
          { kind: 'gap', width: 10, decoupling: 'strips', fill: 'insulation', fillMaterialId: 'ghost' },
          { kind: 'layer', materialId: 'mdf', thickness: 18 },
        ]),
      (p) =>
        (p.versions[0].design.interior = {
          left: {
            splitAxis: 'y',
            facets: [{ width: 100, tilt: 5, hinge: 'min' }],
            panelMaterialId: 'ghost',
            panelThickness: 12,
            closure: 'fillers',
            behind: 'insulation',
          },
        }),
      (p) =>
        (p.versions[0].design.panels = [
          { id: 'a', normal: 'x', position: 1, u0: 0, u1: 1, v0: 0, v1: 1, layers: [], insulation: { materialId: 'ghost', thickness: 5 } },
        ]),
      (p) =>
        (p.versions[0].design.panels = [
          { id: 'a', normal: 'x', position: 1, u0: 0, u1: 1, v0: 0, v1: 1, layers: [{ kind: 'layer', materialId: 'ghost', thickness: 5 }], insulation: null },
        ]),
      (p) => (p.versions[0].design.treatments = [{ id: 't', surface: { wall: 'left' }, materialId: 'ghost', thickness: 5 }]),
      (p) => (p.versions[0].design.door.inner.stack = [{ kind: 'layer', materialId: 'ghost', thickness: 5 }]),
    ]
    for (const mutate of cases) {
      const p = project()
      mutate(p)
      const r = importProject(JSON.stringify({ format: 'isocab', schemaVersion: 1, project: p, materials: [] }), defaultLibrary())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('ghost')
    }
  })

  it('merges embedded materials, keeping existing ids', () => {
    const p = project()
    p.versions[0].design.wallDefault = [{ kind: 'layer', materialId: 'birch', thickness: 18 }]
    const birch = { ...defaultLibrary().materials[0], id: 'birch', name: 'Birch' }
    const plyClash = { ...defaultLibrary().materials[0], name: 'Changed' }
    const text = JSON.stringify({ format: 'isocab', schemaVersion: 1, project: p, materials: [birch, plyClash] })
    const lib = defaultLibrary()
    const r = importProject(text, lib)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.library.materials.find((m) => m.id === 'birch')?.name).toBe('Birch')
    expect(r.library.materials.find((m) => m.id === 'plywood')?.name).toBe('Plywood')
    expect(r.library.materials.length).toBe(lib.materials.length + 1)
  })
})

describe('export/import references', () => {
  const emptyGap = (fillMaterialId: string): Project['versions'][number]['design']['wallDefault'] => [
    { kind: 'layer', materialId: 'plywood', thickness: 18 },
    { kind: 'gap', width: 20, decoupling: 'clips', fill: 'empty', fillMaterialId },
    { kind: 'layer', materialId: 'mdf', thickness: 18 },
  ]

  it('an unknown material only in an empty-fill cavity is not an error, and is not exported', () => {
    const p = project()
    p.versions[0].design.wallDefault = emptyGap('deleted-fill')
    const text = exportProject(p, defaultLibrary())
    expect(JSON.parse(text).materials.map((m: { id: string }) => m.id).sort()).toEqual(['mdf', 'plywood'])
    expect(importProject(text, defaultLibrary()).ok).toBe(true)
  })

  it('a clashing material is imported under a new id and the imported design is remapped to it', () => {
    const p = project()
    const file = JSON.parse(exportProject(p, defaultLibrary()))
    file.materials = file.materials.map((m: { id: string; density: number }) => (m.id === 'plywood' ? { ...m, density: 999 } : m))
    const r = importProject(JSON.stringify(file), defaultLibrary())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mine = r.library.materials.find((m) => m.id === 'plywood')!
    const theirs = r.library.materials.find((m) => m.id === 'plywood-imported')!
    expect([mine.density, theirs.density]).toEqual([600, 999])
    expect(r.project.versions[0].design.wallDefault[0]).toMatchObject({ materialId: 'plywood-imported' })
    expect(r.notes.join(' ')).toMatch(/plywood-imported/)
  })

  it('identical materials are not duplicated', () => {
    const r = importProject(exportProject(project(), defaultLibrary()), defaultLibrary())
    expect(r.ok && r.library.materials.length).toBe(defaultLibrary().materials.length)
    expect(r.ok && r.notes).toEqual([])
  })

  it('exports the hinges, seals and latches the design uses and merges them on import', () => {
    const lib = defaultLibrary()
    lib.hinges.push({ id: 'heavy', name: 'Heavy hinge', kind: 'lift-off', leafWidth: 60, edgeInset: 120, weightKg: 0.8 })
    const p = project()
    p.versions[0].design.door.outer.hingeTypeId = 'heavy'
    const file = JSON.parse(exportProject(p, lib))
    expect(file.hinges.map((h: { id: string }) => h.id).sort()).toEqual(['butt-75', 'heavy'])
    expect(file.seals.map((h: { id: string }) => h.id)).toEqual(['tape-12x6'])
    expect(file.latches.map((h: { id: string }) => h.id)).toEqual(['compression'])
    // Into a library without the heavy hinge, and with a different butt hinge.
    const other = defaultLibrary()
    other.hinges[0].edgeInset = 99
    const r = importProject(JSON.stringify(file), other)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.library.hinges.find((h) => h.id === 'heavy')?.name).toBe('Heavy hinge')
    expect(r.library.hinges.find((h) => h.id === 'butt-75')?.edgeInset).toBe(99)
    expect(r.library.hinges.find((h) => h.id === 'butt-75-imported')?.edgeInset).toBe(150)
    expect(r.project.versions[0].design.door.inner.hingeTypeId).toBe('butt-75-imported')
  })

  it('files without hardware lists still import', () => {
    const file = JSON.parse(exportProject(project(), defaultLibrary()))
    delete file.hinges
    delete file.seals
    delete file.latches
    expect(importProject(JSON.stringify(file), defaultLibrary()).ok).toBe(true)
  })

  it('export file names are the sanitised design name', () => {
    expect(exportFileName('My iso cab')).toBe('My iso cab.isocab.json')
    expect(exportFileName('a/b:c*?"<>|')).toBe('a-b-c.isocab.json')
    expect(exportFileName('   ')).toBe('design.isocab.json')
  })
})

describe('createStore', () => {
  it('saves and loads projects, library, shop', () => {
    const s = createStore(memoryBackend())
    const p = project()
    expect(s.saveProject(p)).toBe(true)
    expect(s.loadProjects()).toEqual([p])
    s.deleteProject(p.id)
    expect(s.loadProjects()).toEqual([])
    expect(s.loadLibrary()).toBeNull()
    expect(s.saveLibrary(defaultLibrary())).toBe(true)
    expect(s.loadLibrary()).toEqual(defaultLibrary())
    expect(s.saveShop(defaultShop())).toBe(true)
    expect(s.loadShop()).toEqual(defaultShop())
    expect(s.ok).toBe(true)
  })

  it('does not duplicate ids when saving twice', () => {
    const b = memoryBackend()
    const s = createStore(b)
    const p = project()
    s.saveProject(p)
    s.saveProject(p)
    expect(JSON.parse(b.getItem('isocab:projects')!)).toEqual([p.id])
  })

  it('survives a throwing setItem', () => {
    const b = { ...memoryBackend(), setItem: () => { throw new Error('quota') } }
    const s = createStore(b)
    expect(s.saveProject(project())).toBe(false)
    expect(s.ok).toBe(false)
  })

  it('works in memory with a null backend', () => {
    const s = createStore(null)
    const p = project()
    expect(s.saveProject(p)).toBe(true)
    expect(s.loadProjects()).toEqual([p])
  })

  it('skips corrupt entries', () => {
    const b = memoryBackend()
    const s = createStore(b)
    const p = project()
    s.saveProject(p)
    b.setItem('isocab:project:bad', '{nope')
    b.setItem('isocab:projects', JSON.stringify([p.id, 'bad', 'missing']))
    expect(s.loadProjects()).toEqual([p])
    b.setItem('isocab:library', '{nope')
    expect(s.loadLibrary()).toBeNull()
  })
})
