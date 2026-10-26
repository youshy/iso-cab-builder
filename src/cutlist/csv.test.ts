import { describe, expect, it } from 'vitest'
import { partsCsv } from './csv'
import type { Part } from './parts'

const part = (o: Partial<Part> = {}): Part => ({
  id: 'A1', name: 'Left wall', materialId: 'ply', thickness: 18, length: 600.5, width: 400, bevels: [], qty: 2,
  step: 'shell', kind: 'panel', notes: [], warnings: [], ...o,
})
const matName = (id: string) => (id === 'ply' ? 'Birch ply' : id)

describe('partsCsv', () => {
  it('writes the header and quotes every field', () => {
    const lines = partsCsv([part()], matName).split('\r\n')
    expect(lines[0]).toBe('"id","name","material","thickness","length","width","qty","bevels","notes","warnings","step"')
    expect(lines[1]).toBe('"A1","Left wall","Birch ply","18","600.5","400","2","","","","shell"')
  })
  it('escapes quotes, joins notes, warnings and bevels', () => {
    const p = part({ name: 'Panel 6" wide', notes: ['a, b', 'c'], warnings: ['too "small"'], bevels: [{ edge: 'L1', angle: 22.5 }, { edge: 'W2', angle: 10 }] })
    const row = partsCsv([p], matName).split('\r\n')[1]
    expect(row).toContain('"Panel 6"" wide"')
    expect(row).toContain('"L1 22.5; W2 10"')
    expect(row).toContain('"a, b; c"')
    expect(row).toContain('"too ""small"""')
  })
  it('keeps embedded newlines inside the quoted field', () => {
    expect(partsCsv([part({ notes: ['x\ny'] })], matName)).toContain('"x\ny"')
  })
  it('neutralises spreadsheet formulas in text cells but not numbers', () => {
    const lib: Record<string, string> = { a: '=HYPERLINK("x")', b: '+1', c: '-2', d: '@SUM(A1)' }
    const rows = ['a', 'b', 'c', 'd'].map((id) => partsCsv([part({ materialId: id, thickness: -5 })], (m) => lib[m]).split('\r\n')[1])
    expect(rows[0]).toContain('"\'=HYPERLINK(""x"")"')
    expect(rows[1]).toContain('"\'+1"')
    expect(rows[2]).toContain('"\'-2"')
    expect(rows[3]).toContain('"\'@SUM(A1)"')
    expect(rows[0]).toContain('"-5"')
    expect(partsCsv([part({ name: '\tx' })], matName)).toContain('"\'\tx"')
  })
  it('keeps non-ASCII text intact', () => {
    expect(partsCsv([part({ name: 'Panel 22.5° 600×400' })], matName)).toContain('"Panel 22.5° 600×400"')
  })
})
