/// Worker: runs one FDTD simulation per message and reports progress. Every failure is posted back as an
/// error reply with its message and stack, so the page never sees a bare, messageless error event.
import type { Design, Library } from '../model/schema'
import { simulate, type SimOptions } from './fdtd'

export type WorkerRequest = { id: number; d: Design; lib: Library; opts: SimOptions }
export type WorkerReply =
  | { id: number; type: 'progress'; p: number }
  | { id: number; type: 'done'; result: ReturnType<typeof simulate>; ms: number }
  | { id: number; type: 'error'; message: string; stack?: string }

type Ctx = {
  postMessage(m: WorkerReply): void
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  addEventListener(type: 'error', fn: (e: ErrorEvent) => void): void
  addEventListener(type: 'unhandledrejection', fn: (e: PromiseRejectionEvent) => void): void
}
const ctx = self as unknown as Ctx

/** Id of the request being run, for errors raised outside the handler. */
let current = -1

const reply = (id: number, err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  ctx.postMessage({ id, type: 'error', message: message || 'unknown error', stack: err instanceof Error ? err.stack : undefined })
}

ctx.addEventListener('error', (e) => {
  e.preventDefault()
  reply(current, e.error ?? e.message)
})
ctx.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  reply(current, e.reason)
})

ctx.onmessage = (e) => {
  try {
    const { id, d, lib, opts } = e.data
    current = id
    const t0 = performance.now()
    const result = simulate(d, lib, opts, (p) => ctx.postMessage({ id, type: 'progress', p }))
    ctx.postMessage({ id, type: 'done', result, ms: performance.now() - t0 })
  } catch (err) {
    reply(e.data?.id ?? current, err)
  }
}
