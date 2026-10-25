import { signal, type Signal } from '@preact/signals'
import { doorWall } from '../doors/side'
import { resolveDims } from '../geometry/dimensions'
import { activeInterior, wallStack, WALLS } from '../geometry/walls'
import type { Design, Layer, Library } from '../model/schema'
import type { SimOptions, SimResult } from './fdtd'
import type { WorkerReply, WorkerRequest } from './worker'

export type SimStatus = 'up to date' | 'running' | 'stale'

/**
 * Stable JSON of everything the simulation reads and nothing else: inner size, each wall's innermost
 * material, active facets, panels, treatments, the sim cab, the door wall, the absorption of every
 * referenced material and the sim options. Latches, hinges, seals, escape and shop data are left out.
 */
export function simKey(d: Design, lib: Library, opts: SimOptions): string {
  const { inner } = resolveDims(d)
  const door = doorWall(d)
  const used = new Set<string>()
  const use = (id: string | undefined) => { if (id !== undefined) used.add(id) }

  const walls = WALLS.map((w) => {
    const layers = wallStack(d, w).filter((i): i is Layer => i.kind === 'layer')
    const innermost = layers[layers.length - 1]?.materialId
    const interior = activeInterior(d, w)
    use(innermost)
    use(interior?.panelMaterialId)
    return { w, innermost, interior }
  })
  const treatments = d.treatments.filter((t) => !('wall' in t.surface && t.surface.wall === door))
  treatments.forEach((t) => use(t.materialId))
  d.panels.forEach((p) => {
    p.layers.forEach((l) => use(l.materialId))
    use(p.insulation?.materialId)
  })
  const cab = d.sim.cabId === '' ? undefined : d.cabs.find((c) => c.id === d.sim.cabId)
  if (cab) {
    use('plywood') // the simulation's stand-in for the cab shell
    use(lib.materials.find((m) => m.kind === 'sheet')?.id)
  }
  const absorption = [...used].sort().map((id) => [id, lib.materials.find((m) => m.id === id)?.absorption ?? null])

  return JSON.stringify({
    inner,
    clearance: d.dims.clearance,
    walls,
    panels: d.panels,
    treatments,
    cab: cab && { id: cab.id, w: cab.w, h: cab.h, d: cab.d, back: cab.back, cabYaw: (cab as { cabYaw?: number }).cabYaw },
    door: { kind: d.door.kind, wall: door },
    absorption,
    probes: d.sim.probes,
    opts,
  })
}

export const DEBOUNCE_MS = 400
const CACHE_SIZE = 8

type Active = { key: string; promise: Promise<SimResult>; reject: (e: Error) => void; worker: Worker }

export function createSimClient(spawn: () => Worker, debounceMs = DEBOUNCE_MS) {
  const status = signal<SimStatus>('stale')
  const progress = signal(0)
  const runtimeMs = signal<number | null>(null)
  const error = signal<string | null>(null)
  const cache = new Map<string, SimResult>() // insertion order = least recently used first
  let nextId = 1
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { key: string; reject: (e: Error) => void } | undefined
  let active: Active | undefined

  const superseded = () => new Error('superseded')

  function cancelAll(): void {
    clearTimeout(timer)
    pending?.reject(superseded())
    pending = undefined
    if (active) {
      active.worker.terminate()
      active.reject(superseded())
      active = undefined
    }
  }

  function remember(key: string, r: SimResult): void {
    cache.delete(key)
    cache.set(key, r)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  }

  function run(key: string, d: Design, lib: Library, opts: SimOptions): Promise<SimResult> {
    const id = nextId++
    const worker = spawn()
    const started = performance.now()
    status.value = 'running'
    progress.value = 0
    error.value = null
    const promise = new Promise<SimResult>((resolve, reject) => {
      const finish = () => { worker.terminate(); if (active?.worker === worker) active = undefined }
      active = { key, promise: undefined as never, reject, worker }
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data
        if (m.id !== id) return
        if (m.type === 'progress') progress.value = m.p
        else if (m.type === 'done') {
          finish()
          remember(key, m.result)
          runtimeMs.value = performance.now() - started
          status.value = 'up to date'
          resolve(m.result)
        } else {
          finish()
          error.value = m.message
          status.value = 'stale'
          reject(new Error(m.message))
        }
      }
      worker.onerror = (e: ErrorEvent) => {
        finish()
        error.value = e.message || 'Simulation worker failed'
        status.value = 'stale'
        reject(new Error(error.value))
      }
      const msg: WorkerRequest = { id, d, lib, opts }
      worker.postMessage(msg)
    })
    if (active?.worker === worker) active.promise = promise
    return promise
  }

  /**
   * Ask for a result. Status goes `stale` at once, the run starts after the debounce, and any earlier
   * pending or running request is cancelled (its promise rejects with "superseded").
   */
  function request(d: Design, lib: Library, opts: SimOptions): Promise<SimResult> {
    const key = simKey(d, lib, opts)
    if (active?.key === key) return active.promise
    cancelAll()
    const hit = cache.get(key)
    if (hit) {
      remember(key, hit)
      status.value = 'up to date'
      return Promise.resolve(hit)
    }
    status.value = 'stale'
    return new Promise<SimResult>((resolve, reject) => {
      pending = { key, reject }
      timer = setTimeout(() => {
        pending = undefined
        run(key, structuredClone(d), structuredClone(lib), opts).then(resolve, reject)
      }, debounceMs)
    })
  }

  return { status, progress, runtimeMs, error, request } satisfies {
    status: Signal<SimStatus>; progress: Signal<number>; runtimeMs: Signal<number | null>; error: Signal<string | null>
    request: typeof request
  }
}
