import type { Part } from '../cutlist/parts'
import { fmt, Pen, textWidth, type BlockFn } from './svg'

const ROW = 4
const SIZE = 2.2
/** Rows per table block, so one block always fits on a sheet. */
export const TABLE_ROWS = 40

type Col = { head: string; w: number; anchor: 'start' | 'end'; get: (p: Part) => string }

/**
 * Cut sizes of the parts on a sheet, exactly as the cut list gives them (length and width to 0.5 mm, bevels to
 * 0.1 degree), split into blocks of at most TABLE_ROWS rows. The drawings show where the parts go; this is what
 * gets cut.
 */
export function partsTable(parts: Part[], matName: (id: string) => string): BlockFn[] {
  const cols: Col[] = [
    { head: 'Part', w: 10, anchor: 'start', get: (p) => p.id },
    { head: 'Name', w: 0, anchor: 'start', get: (p) => p.name },
    { head: 'L', w: 13, anchor: 'end', get: (p) => fmt(p.length) },
    { head: 'W', w: 13, anchor: 'end', get: (p) => fmt(p.width) },
    { head: 't', w: 10, anchor: 'end', get: (p) => fmt(p.thickness) },
    { head: 'Qty', w: 9, anchor: 'end', get: (p) => String(p.qty) },
    { head: 'Material', w: 0, anchor: 'start', get: (p) => matName(p.materialId) },
    { head: 'Bevels', w: 0, anchor: 'start', get: (p) => p.bevels.map((b) => `${b.edge} ${fmt(b.angle)}°`).join(', ') || '-' },
  ]
  // Text columns are as wide as their longest entry.
  for (const c of cols) {
    if (c.w === 0) c.w = Math.max(textWidth(c.head, SIZE), ...parts.map((p) => textWidth(c.get(p), SIZE))) + 3
  }
  const chunks: Part[][] = []
  for (let i = 0; i < parts.length; i += TABLE_ROWS) chunks.push(parts.slice(i, i + TABLE_ROWS))
  return chunks.map((rows, k) => () => {
    const pen = new Pen()
    const title = chunks.length > 1 ? `Cut sizes (${k + 1}/${chunks.length})` : 'Cut sizes'
    pen.text(0, -2, `${title}: L × W × t in mm, as in the cut list`, { size: 3.2, cls: 'hd' })
    const total = cols.reduce((a, c) => a + c.w, 0)
    const line = (y: number, cls: string) => pen.line(0, y, total, y, cls)
    line(0, 'o')
    const row = (y: number, cells: string[], cls?: string) => {
      let x = 0
      cols.forEach((c, i) => {
        const tx = c.anchor === 'end' ? x + c.w - 1.5 : x + 1
        pen.text(tx, y, cells[i], { size: SIZE, anchor: c.anchor, cls })
        x += c.w
      })
    }
    row(ROW - 1, cols.map((c) => c.head), 'hd')
    line(ROW, 'o')
    rows.forEach((p, i) => {
      row(ROW * (i + 2) - 1, cols.map((c) => c.get(p)))
      line(ROW * (i + 2), 't')
    })
    return pen.block()
  })
}
