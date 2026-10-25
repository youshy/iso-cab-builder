import { describe, it, expect, vi } from 'vitest'
import { createAppStore, formatLength, parseLength, setDimMode, setInnerSource } from './store'
import { defaultDesign } from './defaults'
import { resolveDims } from '../geometry/dimensions'
import { SPEAKER_PRESETS, applyCabEdit, matchPreset, presetSpeakers } from './presets'

function memoryBackend() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('store', () => {
  it('boots with one project and version 1', () => {
    const s = createAppStore(memoryBackend())
    expect(s.projects.value).toHaveLength(1)
    expect(s.projects.value[0].name).toBe('My iso cab')
    expect(s.currentProject.value.versions.map((v) => v.version)).toEqual([1])
  })

  it('rejects an invalid update, sets editError, and clears it on the next good edit', () => {
    const s = createAppStore(memoryBackend())
    const before = s.design.value
    s.update((d) => {
      d.cabs[0].w = -5
    })
    expect(s.design.value).toBe(before)
    expect(s.editError.value).toMatch(/cabs\.0\.w/)
    s.update((d) => {
      d.cabs[0].name = 'ok'
    })
    expect(s.editError.value).toBeNull()
  })

  it('clears editError after 4 s', () => {
    vi.useFakeTimers()
    const s = createAppStore(memoryBackend())
    s.update((d) => {
      d.cabs[0].w = -5
    })
    expect(s.editError.value).not.toBeNull()
    vi.advanceTimersByTime(4001)
    expect(s.editError.value).toBeNull()
    vi.useRealTimers()
  })

  it('updateLibrary validates and persists', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    expect(s.updateLibrary((l) => void (l.materials[0].density = 700))).toBe(true)
    expect(s.library.value.materials[0].density).toBe(700)
    expect(createAppStore(backend).library.value.materials[0].density).toBe(700)
    expect(s.updateLibrary((l) => void (l.materials[0].density = -1))).toBe(false)
    expect(s.library.value.materials[0].density).toBe(700)
    expect(s.editError.value).toMatch(/materials\.0\.density/)
  })

  it('updateShop validates and persists', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    expect(s.updateShop((x) => void (x.kerf = 5))).toBe(true)
    expect(createAppStore(backend).shop.value.kerf).toBe(5)
    expect(s.updateShop((x) => void (x.kerf = -1))).toBe(false)
    expect(s.shop.value.kerf).toBe(5)
    expect(s.editError.value).toMatch(/kerf/)
  })

  it('applies a valid update and autosaves it to storage', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    s.update((d) => {
      d.cabs[0].name = 'Renamed'
    })
    expect(s.design.value.cabs[0].name).toBe('Renamed')
    const again = createAppStore(backend)
    expect(again.design.value.cabs[0].name).toBe('Renamed')
  })

  it('saveVersion appends consecutive versions', () => {
    const s = createAppStore(memoryBackend())
    const a = s.saveVersion()
    const b = s.saveVersion()
    expect([a, b]).toEqual([2, 3])
    expect(s.currentProject.value.versions.map((v) => v.version)).toEqual([1, 2, 3])
  })

  it('loadVersion restores a saved design and compareDesign follows compareVersion', () => {
    const s = createAppStore(memoryBackend())
    const orig = s.design.value.cabs[0].name
    s.saveVersion()
    s.update((d) => {
      d.cabs[0].name = 'Changed'
    })
    s.compareVersion.value = 1
    expect(s.compareDesign.value?.cabs[0].name).toBe(orig)
    s.loadVersion(1)
    expect(s.design.value.cabs[0].name).toBe(orig)
  })

  it('flags unavailable storage', () => {
    const bad = {
      getItem: () => null,
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {},
    }
    const s = createAppStore(bad)
    s.update((d) => {
      d.cabs[0].name = 'x'
    })
    expect(s.saveWarning.value).toBe('Not saved: browser storage unavailable')
  })

  it('parses and formats lengths in both units', () => {
    const s = createAppStore(memoryBackend())
    expect(s.parseLen('10')).toBe(10)
    expect(s.fmtLen(254)).toBe('254 mm')
    s.units.value = 'in'
    expect(s.parseLen('10')).toBe(254)
    expect(s.fmtLen(254)).toBe('10.0 in')
    expect(parseLength('abc', 'mm')).toBeNull()
    expect(parseLength('1,5 in', 'mm')).toBe(1.5)
    expect(formatLength(1350.4, 'mm')).toBe('1350 mm')
  })
})

describe('saved versions are immutable', () => {
  it('editing after loading v1 leaves v1 unchanged and Compare lists saved versions', () => {
    const s = createAppStore(memoryBackend())
    const original = structuredClone(s.design.value)
    s.saveVersion()
    s.loadVersion(1)
    expect(s.basedOn.value).toBe(1)
    s.update((d) => {
      d.cabs[0].name = 'Edited'
    })
    s.compareVersion.value = 1
    expect(s.compareDesign.value).toEqual(original)
    expect(s.currentProject.value.versions.map((v) => v.version)).toEqual([1, 2])
    expect(s.design.value.cabs[0].name).toBe('Edited')
  })

  it('saveVersion snapshots the working design and survives reload', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    s.update((d) => {
      d.cabs[0].name = 'Snap'
    })
    const n = s.saveVersion()
    s.update((d) => {
      d.cabs[0].name = 'After'
    })
    expect(s.currentProject.value.versions.find((v) => v.version === n)?.design.cabs[0].name).toBe('Snap')
    expect(createAppStore(backend).design.value.cabs[0].name).toBe('After')
  })
})

describe('applyCabEdit', () => {
  it('selecting a new preset on a preset cab applies it', () => {
    const cab = defaultDesign().cabs[0]
    const p = SPEAKER_PRESETS.find((x) => x.id === '2x12')!
    applyCabEdit(cab, (c) => (c.speakers = presetSpeakers(p, c)))
    expect(cab.speakers).toHaveLength(2)
    expect(matchPreset(cab)?.id).toBe('2x12')
  })
  it('resizing a preset cab refits the layout', () => {
    const cab = defaultDesign().cabs[0]
    applyCabEdit(cab, (c) => (c.w = 900))
    expect(matchPreset(cab)?.id).toBe('6x12')
    // 2 columns on w=900: x = 900 * (c + 0.5) / 2 -> 225, 675
    expect(cab.speakers[1].x).toBe(675)
  })
})

describe('dimension mode switching', () => {
  it('keeps resolved numbers when switching inside <-> outside', () => {
    const d = defaultDesign()
    const before = resolveDims(d)
    setDimMode(d, 'outside')
    expect(resolveDims(d)).toEqual(before)
    setDimMode(d, 'inside')
    expect(resolveDims(d)).toEqual(before)
  })

  it('keeps inner box when switching from cab to manual', () => {
    const d = defaultDesign()
    const before = resolveDims(d)
    setInnerSource(d, 'manual')
    expect(resolveDims(d).inner).toEqual(before.inner)
  })
})

describe('speaker presets', () => {
  it('6x12 matches the default cab layout', () => {
    const cab = defaultDesign().cabs[0]
    expect(matchPreset(cab)?.id).toBe('6x12')
  })
  it('default cab is 760 x 1140 x 360 with speakers 2 across, 3 high', () => {
    const cab = defaultDesign().cabs[0]
    expect([cab.w, cab.h, cab.d]).toEqual([760, 1140, 360])
    expect(cab.speakers).toEqual([
      { x: 190, y: 190 }, { x: 570, y: 190 },
      { x: 190, y: 570 }, { x: 570, y: 570 },
      { x: 190, y: 950 }, { x: 570, y: 950 },
    ])
  })
  it('6x12 has 2 distinct x and 3 distinct y; 6x12 wide is the 3 by 2 layout', () => {
    const cab = { w: 760, h: 1140 }
    const s = presetSpeakers(SPEAKER_PRESETS.find((x) => x.id === '6x12')!, cab)
    expect(new Set(s.map((q) => q.x)).size).toBe(2)
    expect(new Set(s.map((q) => q.y)).size).toBe(3)
    const wide = presetSpeakers(SPEAKER_PRESETS.find((x) => x.id === '6x12w')!, { w: 1350, h: 980 })
    expect(new Set(wide.map((q) => q.x)).size).toBe(3)
    expect(new Set(wide.map((q) => q.y)).size).toBe(2)
  })
  it('spreads centres evenly and detects custom', () => {
    const cab = { w: 600, h: 600, speakers: [] as { x: number; y: number }[] }
    const p = SPEAKER_PRESETS.find((x) => x.id === '2x12')!
    expect(presetSpeakers(p, cab)).toEqual([{ x: 150, y: 300 }, { x: 450, y: 300 }])
    cab.speakers = [{ x: 10, y: 10 }]
    expect(matchPreset(cab)).toBeNull()
  })
})

describe('store interior rescale', () => {
  it('rescales facets when the inner box is resized through update', () => {
    const s = createAppStore(memoryBackend())
    s.update((d) => {
      d.dims.innerSource = 'manual'
      d.dims.inner = { x: 1000, y: 800, z: 360 }
      d.interior.left = {
        splitAxis: 'z', panelMaterialId: 'plywood', panelThickness: 12, closure: 'fillers', behind: 'insulation',
        facets: [{ width: 120, tilt: 4, hinge: 'min' }, { width: 240, tilt: 7, hinge: 'max' }],
      }
    })
    s.update((d) => void (d.dims.inner.z = 240))
    expect(s.design.value.interior.left!.facets.map((f) => f.width)).toEqual([80, 160])
  })
})

describe('deleting a material', () => {
  it('is blocked while any project, saved version or working copy uses it, naming where', () => {
    const s = createAppStore(memoryBackend())
    s.update((d) => void (d.wallDefault = [{ kind: 'layer', materialId: 'osb', thickness: 12 }]))
    s.saveVersion() // v2 uses osb
    s.update((d) => void (d.wallDefault = [{ kind: 'layer', materialId: 'plywood', thickness: 18 }]))
    s.saveVersion() // v3 and the working copy no longer do
    expect(s.removeMaterial('osb')).toMatch(/^Cannot delete OSB: used in My iso cab v2 \(default wall\)/)
    expect(s.library.value.materials.some((m) => m.id === 'osb')).toBe(true)
  })

  it('checks other projects too', () => {
    const s = createAppStore(memoryBackend())
    s.newProject()
    s.update((d) => void (d.treatments = [{ id: 't', surface: { wall: 'left' }, materialId: 'foam', thickness: 50 }]))
    s.selectProject(s.projects.value[0].id)
    expect(s.removeMaterial('foam')).toMatch(/Design 2 working copy \(surface treatment\)/)
  })

  it('an unused material is removed; an empty cavity fill does not count as use', () => {
    const s = createAppStore(memoryBackend())
    s.update((d) => void (d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 20, decoupling: 'clips', fill: 'empty', fillMaterialId: 'foam' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]))
    expect(s.removeMaterial('foam')).toBeNull()
    expect(s.library.value.materials.some((m) => m.id === 'foam')).toBe(false)
  })
})

describe('unsaved changes and loading a version', () => {
  it('knows when the working copy differs from the version it came from', () => {
    const s = createAppStore(memoryBackend())
    expect(s.hasUnsavedChanges.value).toBe(false)
    s.update((d) => void (d.cabs[0].name = 'edited'))
    expect(s.hasUnsavedChanges.value).toBe(true)
    s.saveVersion()
    expect(s.hasUnsavedChanges.value).toBe(false)
    s.update((d) => void (d.cabs[0].name = 'again'))
    s.loadVersion(1, 'discard')
    expect(s.hasUnsavedChanges.value).toBe(false)
  })

  it("'save' keeps the edits as a new version before loading", () => {
    const s = createAppStore(memoryBackend())
    s.update((d) => void (d.cabs[0].name = 'keep me'))
    s.loadVersion(1, 'save')
    expect(s.currentProject.value.versions.map((v) => v.version)).toEqual([1, 2])
    expect(s.currentProject.value.versions[1].design.cabs[0].name).toBe('keep me')
    expect(s.design.value.cabs[0].name).not.toBe('keep me')
    expect(s.basedOn.value).toBe(1)
  })

  it('a reloaded working copy that matches no version counts as unsaved', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    s.update((d) => void (d.cabs[0].name = 'edited'))
    expect(createAppStore(backend).hasUnsavedChanges.value).toBe(true)
    s.saveVersion()
    expect(createAppStore(backend).hasUnsavedChanges.value).toBe(false)
  })
})

describe('renaming and deleting designs', () => {
  it('renames and persists', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    s.renameProject(s.projectId.value, '  Big box  ')
    expect(s.currentProject.value.name).toBe('Big box')
    expect(createAppStore(backend).projects.value[0].name).toBe('Big box')
    s.renameProject(s.projectId.value, '   ')
    expect(s.currentProject.value.name).toBe('Big box')
  })

  it('deletes from storage and selects another design; the last one is replaced by a fresh design', () => {
    const backend = memoryBackend()
    const s = createAppStore(backend)
    const first = s.projectId.value
    s.newProject()
    const second = s.projectId.value
    s.deleteProject(second)
    expect(s.projects.value.map((p) => p.id)).toEqual([first])
    expect(s.projectId.value).toBe(first)
    expect(createAppStore(backend).projects.value.map((p) => p.id)).toEqual([first])
    s.deleteProject(first)
    expect(s.projects.value).toHaveLength(1)
    expect(s.projectId.value).not.toBe(first)
    expect(s.currentProject.value.versions).toHaveLength(1)
  })
})
