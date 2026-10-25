import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import type { Shop } from '../model/schema'
import { buildParts, type Part } from './parts'
import { nest, type NestResult } from './nesting'

const EPS = 1e-6

/** Reusable validator: every placement inside its sheet, no two placements closer than kerf. Returns violations. */
export function nestingViolations(res: NestResult, kerf: number): string[] {
  const out: string[] = []
  for (const g of res.groups) {
    if (!g.stock) {
      if (g.sheets.length) out.push('sheets without stock')
      continue
    }
    g.sheets.forEach((s, si) => {
      const p = s.placements
      p.forEach((a, i) => {
        if (a.x < -EPS || a.y < -EPS || a.x + a.w > g.stock!.length + EPS || a.y + a.h > g.stock!.width + EPS)
          out.push(`${a.partId}#${a.instance} outside sheet ${si}`)
        for (let j = i + 1; j < p.length; j++) {
          const b = p[j]
          const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
          const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
          if (Math.max(gapX, gapY) < kerf - EPS) out.push(`${a.partId}#${a.instance} / ${b.partId}#${b.instance} overlap on sheet ${si}`)
        }
      })
    })
  }
  return out
}

const shop = (): Shop => ({
  ...defaultShop(),
  kerf: 3,
  sheets: [{ materialId: 'ply', thickness: 18, length: 2440, width: 1220 }],
})
const part = (o: Partial<Part> = {}): Part => ({
  id: 'p', name: 'p', materialId: 'ply', thickness: 18, length: 1200, width: 600, bevels: [], qty: 1,
  step: 'shell', kind: 'panel', notes: [], warnings: [], ...o,
})

describe('nest', () => {
  it('4x 1200x600 fit on one 2440x1220 sheet with kerf 3', () => {
    const r = nest([part({ qty: 4 })], shop())
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].sheets).toHaveLength(1)
    expect(r.groups[0].sheets[0].placements).toHaveLength(4)
    expect(r.unplaced).toEqual([])
    expect(nestingViolations(r, 3)).toEqual([])
  })
  it('5x needs 2 sheets and carries instance indices', () => {
    const r = nest([part({ qty: 5 })], shop())
    expect(r.groups[0].sheets).toHaveLength(2)
    const inst = r.groups[0].sheets.flatMap((s) => s.placements.map((p) => p.instance)).sort()
    expect(inst).toEqual([0, 1, 2, 3, 4])
    expect(nestingViolations(r, 3)).toEqual([])
  })
  it('part larger than any sheet is unplaced', () => {
    const r = nest([part({ id: 'big', length: 2500, width: 100 })], shop())
    expect(r.unplaced).toEqual([{ partId: 'big', reason: 'larger than any sheet' }])
  })
  it('no stock for material/thickness is unplaced', () => {
    const r = nest([part({ id: 'x', thickness: 12 })], shop())
    expect(r.unplaced[0].partId).toBe('x')
    expect(r.unplaced[0].reason).toMatch(/no stock/)
  })
  it('roll and wedge are not nested', () => {
    const r = nest([part({ id: 'r', kind: 'roll' }), part({ id: 'w', kind: 'wedge' })], shop())
    expect(r.groups).toEqual([])
    expect(r.unplaced).toEqual([{ partId: 'w', reason: 'cut from offcuts' }])
  })
  it('rotates a part when only the rotated orientation fits', () => {
    const r = nest([part({ length: 1500, width: 1200 })], { ...shop(), sheets: [{ materialId: 'ply', thickness: 18, length: 1300, width: 1600 }] })
    const pl = r.groups[0].sheets[0].placements[0]
    expect(pl.rotated).toBe(true)
    expect(nestingViolations(r, 3)).toEqual([])
  })
  it('wastePct = 100*(1 - parts/sheets), 0.1 rounded', () => {
    const r = nest([part({ qty: 4 })], shop())
    expect(r.groups[0].wastePct).toBe(Math.round((100 - (100 * 4 * 1200 * 600) / (2440 * 1220)) * 10) / 10)
  })
  it('with several stock sizes, uses the smallest that holds the parts', () => {
    const sh = shop()
    sh.sheets.push({ materialId: 'ply', thickness: 18, length: 1220, width: 610 }, { materialId: 'ply', thickness: 18, length: 3050, width: 1525 })
    const small = nest([part({ length: 1200, width: 600 })], sh)
    expect(small.groups[0].stock).toMatchObject({ length: 1220, width: 610 })
    // Too big for the half sheet: the full sheet, not the jumbo one.
    const mid = nest([part({ length: 2000, width: 1000 })], sh)
    expect(mid.groups[0].stock).toMatchObject({ length: 2440, width: 1220 })
    expect(mid.unplaced).toEqual([])
    // Only the jumbo sheet takes this one.
    expect(nest([part({ length: 3000, width: 1500 })], sh).groups[0].stock).toMatchObject({ length: 3050 })
  })

  it('default design nests without overlap', () => {
    const s = defaultShop()
    const r = nest(buildParts(defaultDesign(), defaultLibrary(), s).parts, s)
    expect(nestingViolations(r, s.kerf)).toEqual([])
  })
  it('the validator catches an overlap', () => {
    const bad: NestResult = {
      groups: [{ materialId: 'ply', thickness: 18, stock: { materialId: 'ply', thickness: 18, length: 1000, width: 1000 }, wastePct: 0,
        sheets: [{ placements: [
          { partId: 'a', instance: 0, x: 0, y: 0, w: 500, h: 500, rotated: false },
          { partId: 'b', instance: 0, x: 501, y: 0, w: 500, h: 500, rotated: false }] }] }],
      unplaced: [],
    }
    expect(nestingViolations(bad, 3).length).toBeGreaterThan(0)
  })
})
