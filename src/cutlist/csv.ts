import type { Part } from './parts'

const HEADER = ['id', 'name', 'material', 'thickness', 'length', 'width', 'qty', 'bevels', 'notes', 'warnings', 'step']
/** Quote a cell. Text starting with = + - @ tab or CR gets a leading ' so spreadsheets do not run it as a formula. */
const q = (v: string | number) => {
  const text = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v)
  return `"${text.replace(/"/g, '""')}"`
}

/** Parts as CSV: every field quoted, quotes doubled, CRLF rows. Dimensions are mm. */
export function partsCsv(parts: Part[], matName: (id: string) => string): string {
  const rows = parts.map((p) =>
    [
      p.id, p.name, matName(p.materialId), p.thickness, p.length, p.width, p.qty,
      p.bevels.map((b) => `${b.edge} ${b.angle}`).join('; '),
      p.notes.join('; '), p.warnings.join('; '), p.step,
    ].map(q).join(','),
  )
  return [HEADER.map(q).join(','), ...rows].join('\r\n')
}
