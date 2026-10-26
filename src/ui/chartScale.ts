/** Pure helpers for the acoustics charts: scales, ticks, hover lookup and stack grouping. */

/** Position of v on a log axis from lo to hi, 0 to 1. */
export const logPos = (v: number, lo: number, hi: number): number => Math.log(v / lo) / Math.log(hi / lo)

/** Position of v on a linear axis from lo to hi, 0 to 1. */
export const linPos = (v: number, lo: number, hi: number): number => (v - lo) / (hi - lo)

/** Inverse of logPos. */
export const logValue = (t: number, lo: number, hi: number): number => lo * (hi / lo) ** t

/** Labelled frequency ticks. */
export const FREQ_TICKS = [63, 125, 250, 500, 1000, 2000, 4000]

export const freqLabel = (f: number): string => (f >= 1000 ? `${f / 1000}k` : String(f))

/** Multiples of step that cover [lo, hi], one step beyond the data when it sits on a tick. */
export function linTicks(lo: number, hi: number, step: number): number[] {
  const a = Math.floor(lo / step) * step
  let b = Math.ceil(hi / step) * step
  if (b <= a) b = a + step
  const out: number[] = []
  for (let v = a; v <= b + 1e-9; v += step) out.push(v)
  return out
}

/** Index of the entry of xs closest to v (compared in log space when log). xs must be non-empty. */
export function nearestIndex(xs: number[], v: number, log = false): number {
  const m = (n: number) => (log ? Math.log(n) : n)
  let best = 0
  for (let i = 1; i < xs.length; i++) if (Math.abs(m(xs[i]) - m(v)) < Math.abs(m(xs[best]) - m(v))) best = i
  return best
}

export interface StackEntry<S> {
  name: string
  stack: S[]
  /** 'default' or 'override'; shown in the label when the whole group agrees. */
  tag?: string
}

export interface StackGroup<S> {
  names: string[]
  stack: S[]
  tags: string[]
  label: string
}

/** Merge entries whose stacks are deep-equal, in first-seen order. allCount names the entry count that reads as "All walls". */
export function groupStacks<S>(entries: StackEntry<S>[], allCount?: number): StackGroup<S>[] {
  const groups: StackGroup<S>[] = []
  const keys: string[] = []
  for (const e of entries) {
    const key = JSON.stringify(e.stack)
    let i = keys.indexOf(key)
    if (i < 0) {
      i = keys.length
      keys.push(key)
      groups.push({ names: [], stack: e.stack, tags: [], label: '' })
    }
    groups[i].names.push(e.name)
    if (e.tag) groups[i].tags.push(e.tag)
  }
  for (const g of groups) {
    const base = allCount !== undefined && g.names.length === allCount ? 'All walls' : g.names.join(', ')
    const same = g.tags.length === g.names.length && g.tags.every((t) => t === g.tags[0])
    g.label = same ? `${base} (${g.tags[0]})` : base
  }
  return groups
}
