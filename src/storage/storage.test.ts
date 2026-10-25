import { describe, it, expect } from 'vitest'
import { createStore } from './local'
import { exportProject, importProject } from './io'
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
          { kind: 'gap', width: 10, decoupling: 'strips', fill: 'insulation', fillMaterialId: 'ghost' },
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
