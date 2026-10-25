import { describe, expect, it } from 'vitest'
import type { StackItem } from '../model/schema'
import { FREQ_TICKS, groupStacks, linTicks, logPos, nearestIndex } from './chartScale'

const layer = (t: number): StackItem => ({ kind: 'layer', materialId: 'mdf', thickness: t })

describe('logPos', () => {
  it('maps the domain ends to 0 and 1 and the geometric mean to 0.5', () => {
    expect(logPos(50, 50, 5000)).toBeCloseTo(0, 9)
    expect(logPos(5000, 50, 5000)).toBeCloseTo(1, 9)
    expect(logPos(500, 50, 5000)).toBeCloseTo(0.5, 9)
  })
})

describe('ticks', () => {
  it('frequency ticks for 50 to 5000 include 63 to 4k', () => {
    const t = FREQ_TICKS.filter((v) => v >= 50 && v <= 5000)
    for (const f of [63, 125, 250, 500, 1000, 2000, 4000]) expect(t).toContain(f)
  })
  it('linear ticks step by 10 and cover the data', () => {
    expect(linTicks(23, 57, 10)).toEqual([20, 30, 40, 50, 60])
    expect(linTicks(30, 30, 10)).toEqual([30, 40])
  })
})

describe('nearestIndex', () => {
  it('picks the closest value on a log axis', () => {
    expect(nearestIndex([100, 200, 400], 270, true)).toBe(1)
    expect(nearestIndex([100, 200, 400], 290, true)).toBe(2)
    expect(nearestIndex([100, 200, 400], 1, true)).toBe(0)
  })
})

describe('groupStacks', () => {
  it('merges identical stacks, keeps wall order and labels the group', () => {
    const a = [layer(18)]
    const b = [layer(18), layer(12)]
    const g = groupStacks([
      { name: 'Left', stack: a, tag: 'default' },
      { name: 'Back', stack: b, tag: 'override' },
      { name: 'Top', stack: structuredClone(a), tag: 'default' },
    ])
    expect(g).toHaveLength(2)
    expect(g[0].names).toEqual(['Left', 'Top'])
    expect(g[0].label).toBe('Left, Top (default)')
    expect(g[1].label).toBe('Back (override)')
  })
  it('says All walls when every entry matches and drops a mixed tag', () => {
    const a = [layer(18)]
    const all = groupStacks([{ name: 'Left', stack: a }, { name: 'Right', stack: a }], 2)
    expect(all[0].label).toBe('All walls')
    const mixed = groupStacks([{ name: 'Left', stack: a, tag: 'default' }, { name: 'Right', stack: a, tag: 'override' }])
    expect(mixed[0].label).toBe('Left, Right')
  })
})
