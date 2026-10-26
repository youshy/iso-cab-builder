import { signal } from '@preact/signals'
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
    cab: cab && { id: cab.id, w: cab.w, h: cab.h, d: cab.d, back: cab.back, cabYaw: d.cabYaw },
    door: { kind: d.door.kind, wall: door },
    absorption,
    probes: d.sim.probes,
    opts: { fMax: opts.fMax, duration: opts.duration }, // slices are outputs, not inputs
  })
}

export const DEBOUNCE_MS = 400
/** Rough run time on a laptop, seconds: about 2 s at 1000 Hz, growing a little faster than fMax cubed. */
export const runSecondsEstimate = (fMax: number): number => Math.round(2.5 * (fMax / 1000) ** 3.4)
const CACHE_SIZE = 8
/** A run that takes longer than this is assumed stuck: 30 s at 1000 Hz, growing with fMax cubed. */
export const watchdogMs = (opts: SimOptions): number => 30_000 * (opts.fMax / 1000) ** 3

export type ClientOptions = {
  debounceMs?: number
  cacheSize?: number
  /** What makes two requests the same result; defaults to simKey. */
  keyOf?: (d: Design, lib: Library, opts: SimOptions) => string
}

type Job = {
  key: string
  promise: Promise<SimResult>
  resolve: (r: SimResult) => void
  reject: (e: Error) => void
}

export function createSimClient(spawn: () => Worker, options: ClientOptions = {}) {
  const { debounceMs = DEBOUNCE_MS, cacheSize = CACHE_SIZE, keyOf = simKey } = options
  const status = signal<SimStatus>('stale')
  const progress = signal(0)
  /** Compute time of the last finished run, measured inside the worker (no start-up). */
  const runtimeMs = signal<number | null>(null)
  const error = signal<string | null>(null)
  const cache = new Map<string, SimResult>() // insertion order = least recently used first
  let nextId = 1
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Job | undefined
  let active: (Job & { worker: Worker | null; watchdog?: ReturnType<typeof setTimeout> }) | undefined

  const superseded = () => new Error('superseded')

  function stopActive(): void {
    if (!active) return
    clearTimeout(active.watchdog)
    active.worker?.terminate()
    active = undefined
  }

  function cancelAll(): void {
    clearTimeout(timer)
    pending?.reject(superseded())
    pending = undefined
    if (active) {
      const job = active
      stopActive()
      job.reject(superseded())
    }
  }

  function remember(key: string, r: SimResult): void {
    cache.delete(key)
    cache.set(key, r)
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string)
  }

  function fail(job: Job, message: string): void {
    stopActive()
    error.value = message
    status.value = 'stale'
    job.reject(new Error(message))
  }

  function run(job: Job, d: Design, lib: Library, opts: SimOptions): void {
    const id = nextId++
    status.value = 'running'
    progress.value = 0
    error.value = null
    let worker: Worker
    try {
      worker = spawn()
    } catch (e) {
      active = { ...job, worker: null }
      fail(job, e instanceof Error ? e.message : String(e))
      return
    }
    active = { ...job, worker, watchdog: setTimeout(() => fail(job, 'Simulation timed out'), watchdogMs(opts)) }
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data
      // An error from outside the handler carries id -1: it still belongs to this worker's only run.
      if (m.id !== id && !(m.type === 'error' && m.id === -1)) return
      if (m.type === 'progress') progress.value = m.p
      else if (m.type === 'done') {
        stopActive()
        remember(job.key, m.result)
        runtimeMs.value = m.ms
        status.value = 'up to date'
        job.resolve(m.result)
      } else fail(job, m.message)
    }
    // A bare error event (no message) means the worker script itself could not be loaded or run.
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault?.()
      fail(job, e.message || 'Simulation worker could not start: reload the page')
    }
    worker.onmessageerror = () => fail(job, 'Simulation result could not be read')
    const msg: WorkerRequest = { id, d, lib, opts }
    worker.postMessage(msg)
  }

  /**
   * Ask for a result. Status goes `stale` at once and the run starts after the debounce; an earlier
   * pending or running request with a different key is cancelled (its promise rejects with
   * "superseded"). Asking again for the key already pending or running changes nothing.
   */
  function request(d: Design, lib: Library, opts: SimOptions): Promise<SimResult> {
    const key = keyOf(d, lib, opts)
    if (active?.key === key) return active.promise
    if (pending?.key === key) return pending.promise
    cancelAll()
    const hit = cache.get(key)
    if (hit) {
      remember(key, hit)
      error.value = null
      status.value = 'up to date'
      return Promise.resolve(hit)
    }
    status.value = 'stale'
    let resolve!: Job['resolve'], reject!: Job['reject']
    const promise = new Promise<SimResult>((res, rej) => { resolve = res; reject = rej })
    const job: Job = { key, promise, resolve, reject }
    pending = job
    const dc = structuredClone(d), lc = structuredClone(lib)
    timer = setTimeout(() => {
      pending = undefined
      run(job, dc, lc, opts)
    }, debounceMs)
    return promise
  }

  return { status, progress, runtimeMs, error, request }
}
