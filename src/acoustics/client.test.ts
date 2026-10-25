import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, defaultLibrary } from '../model/defaults'
import type { Design } from '../model/schema'
import { createSimClient, simKey } from './client'
import type { SimResult } from './fdtd'

const lib = defaultLibrary()
const opts = { fMax: 1000 }

const base = defaultDesign()
function faceted(tilt: number): Design {
  const d = structuredClone(base)
  d.door.side = 'front'
  d.interior.left = {
    splitAxis: 'y',
    facets: [{ width: 300, tilt, hinge: 'min' }, { width: 300, tilt: 4, hinge: 'max' }],
    panelMaterialId: 'plywood',
    panelThickness: 12,
    closure: 'fillers',
    behind: 'insulation',
  }
  return d
}

const fakeResult = (tag: number) => ({ model: 'FDTD estimate', modes: [], tag }) as unknown as SimResult

class FakeWorker {
  static all: FakeWorker[] = []
  posted: { id: number }[] = []
  terminated = false
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor() { FakeWorker.all.push(this) }
  postMessage(m: { id: number }) { this.posted.push(m) }
  terminate() { this.terminated = true }
  reply(data: unknown) { this.onmessage?.({ data }) }
}
const spawn = () => new FakeWorker() as unknown as Worker

describe('simKey', () => {
  it('ignores latches and escape', () => {
    const a = defaultDesign()
    const b = structuredClone(a)
    b.door.outer.latchCount += 2
    b.escape.outsideTarget += 5
    expect(simKey(b, lib, opts)).toBe(simKey(a, lib, opts))
  })

  it('changes with a facet tilt', () => {
    expect(simKey(faceted(10), lib, opts)).not.toBe(simKey(faceted(11), lib, opts))
  })

  it('changes with fMax, a treatment, and a referenced absorption', () => {
    const d = defaultDesign()
    const base = simKey(d, lib, opts)
    expect(simKey(d, lib, { fMax: 800 })).not.toBe(base)
    const t = structuredClone(d)
    t.treatments.push({ id: 't1', surface: { wall: 'back' }, materialId: 'rockwool', thickness: 50 })
    expect(simKey(t, lib, opts)).not.toBe(base)
    const lib2 = structuredClone(lib)
    const innermost = d.wallDefault.filter((i) => i.kind === 'layer').at(-1)!
    if (innermost.kind !== 'layer') throw new Error('layer expected')
    const m = lib2.materials.find((x) => x.id === innermost.materialId)!
    m.absorption = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    expect(simKey(d, lib2, opts)).not.toBe(base)
  })

  it('ignores the absorption of a material the simulation never reads', () => {
    const d = defaultDesign()
    const lib2 = structuredClone(lib)
    const read = new Set(d.wallDefault.flatMap((i) => (i.kind === 'layer' ? [i.materialId] : [])))
    const other = lib2.materials.find((m) => !read.has(m.id) && m.id !== 'plywood' && m.kind === 'roll')!
    other.absorption = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]
    expect(simKey(d, lib2, opts)).toBe(simKey(d, lib, opts))
  })
})

describe('createSimClient', () => {
  beforeEach(() => { FakeWorker.all = []; vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('debounces, runs in a worker, and reports status and progress', async () => {
    const c = createSimClient(spawn)
    const d = defaultDesign()
    const p = c.request(d, lib, opts)
    expect(c.status.value).toBe('stale')
    expect(FakeWorker.all).toHaveLength(0)
    vi.advanceTimersByTime(400)
    expect(c.status.value).toBe('running')
    const w = FakeWorker.all[0]
    w.reply({ id: w.posted[0].id, type: 'progress', p: 0.42 })
    expect(c.progress.value).toBeCloseTo(0.42)
    w.reply({ id: w.posted[0].id, type: 'done', result: fakeResult(1) })
    await expect(p).resolves.toMatchObject({ tag: 1 })
    expect(c.status.value).toBe('up to date')
  })

  it('serves the same object from cache without spawning a worker', async () => {
    const c = createSimClient(spawn)
    const d = defaultDesign()
    const p = c.request(d, lib, opts)
    vi.advanceTimersByTime(400)
    const w = FakeWorker.all[0]
    w.reply({ id: w.posted[0].id, type: 'done', result: fakeResult(1) })
    const first = await p
    const again = await c.request(structuredClone(d), lib, opts)
    expect(again).toBe(first)
    expect(FakeWorker.all).toHaveLength(1)
    expect(c.status.value).toBe('up to date')
  })

  it('terminates a superseded run and respawns', async () => {
    const c = createSimClient(spawn)
    const first = c.request(faceted(5), lib, opts)
    first.catch(() => {})
    vi.advanceTimersByTime(400)
    const second = c.request(faceted(6), lib, opts)
    vi.advanceTimersByTime(400)
    expect(FakeWorker.all[0].terminated).toBe(true)
    expect(FakeWorker.all).toHaveLength(2)
    await expect(first).rejects.toThrow('superseded')
    const w = FakeWorker.all[1]
    w.reply({ id: w.posted[0].id, type: 'done', result: fakeResult(2) })
    await expect(second).resolves.toMatchObject({ tag: 2 })
  })

  it('rejects and goes stale when the worker reports an error', async () => {
    const c = createSimClient(spawn)
    const p = c.request(defaultDesign(), lib, opts)
    p.catch(() => {})
    vi.advanceTimersByTime(400)
    const w = FakeWorker.all[0]
    w.reply({ id: w.posted[0].id, type: 'error', message: 'No air' })
    await expect(p).rejects.toThrow('No air')
    expect(c.status.value).toBe('stale')
  })

  it('evicts the least recently used result after 8 entries', async () => {
    const c = createSimClient(spawn)
    const run = async (n: number) => {
      const p = c.request(faceted(n), lib, opts)
      vi.advanceTimersByTime(400)
      const w = FakeWorker.all[FakeWorker.all.length - 1]
      w.reply({ id: w.posted[0].id, type: 'done', result: fakeResult(n) })
      return p
    }
    for (let n = 1; n <= 9; n++) await run(n)
    const before = FakeWorker.all.length
    await c.request(faceted(9), lib, opts)
    expect(FakeWorker.all).toHaveLength(before)
    void c.request(faceted(1), lib, opts).catch(() => {})
    vi.advanceTimersByTime(400)
    expect(FakeWorker.all).toHaveLength(before + 1)
  })
})
