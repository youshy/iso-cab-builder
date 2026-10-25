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
    expect(cab.speakers[2].x).toBe(750)
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
  it('spreads centres evenly and detects custom', () => {
    const cab = { w: 600, h: 600, speakers: [] as { x: number; y: number }[] }
    const p = SPEAKER_PRESETS.find((x) => x.id === '2x12')!
    expect(presetSpeakers(p, cab)).toEqual([{ x: 150, y: 300 }, { x: 450, y: 300 }])
    cab.speakers = [{ x: 10, y: 10 }]
    expect(matchPreset(cab)).toBeNull()
  })
})
