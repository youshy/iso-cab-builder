import { describe, it, expect, vi } from 'vitest'
import { createAppStore, formatLength, parseLength, setDimMode, setInnerSource } from './store'
import { defaultDesign } from './defaults'
import { resolveDims } from '../geometry/dimensions'
import { SPEAKER_PRESETS, matchPreset, presetSpeakers } from './presets'

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

  it('rejects an invalid update and leaves design unchanged', () => {
    const s = createAppStore(memoryBackend())
    const before = s.design.value
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    s.update((d) => {
      d.cabs[0].w = -5
    })
    expect(s.design.value).toBe(before)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
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
