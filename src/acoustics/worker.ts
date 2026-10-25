/// Module worker: runs one FDTD simulation per message and reports progress.
import type { Design, Library } from '../model/schema'
import { simulate, type SimOptions } from './fdtd'

export type WorkerRequest = { id: number; d: Design; lib: Library; opts: SimOptions }
export type WorkerReply =
  | { id: number; type: 'progress'; p: number }
  | { id: number; type: 'done'; result: ReturnType<typeof simulate>; ms: number }
  | { id: number; type: 'error'; message: string }

const ctx = self as unknown as { postMessage(m: WorkerReply): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null }

ctx.onmessage = (e) => {
  const { id, d, lib, opts } = e.data
  try {
    const t0 = performance.now()
    const result = simulate(d, lib, opts, (p) => ctx.postMessage({ id, type: 'progress', p }))
    ctx.postMessage({ id, type: 'done', result, ms: performance.now() - t0 })
  } catch (err) {
    ctx.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
