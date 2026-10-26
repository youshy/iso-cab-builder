import { describe, expect, it } from 'vitest'
import { needsRefit } from './View3D'

describe('needsRefit', () => {
  it('refits only when the box diagonal changed by more than 10 percent', () => {
    expect(needsRefit(1000, 1000)).toBe(false)
    expect(needsRefit(1000, 1099)).toBe(false)
    expect(needsRefit(1000, 901)).toBe(false)
    expect(needsRefit(1000, 1101)).toBe(true)
    expect(needsRefit(1000, 899)).toBe(true)
    expect(needsRefit(0, 500)).toBe(true)
  })
})
