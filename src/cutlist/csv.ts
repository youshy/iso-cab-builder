import type { Part } from './parts'

const HEADER = ['id', 'name', 'material', 'thickness', 'length', 'width', 'qty', 'bevels', 'notes', 'warnings', 'step']
const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`

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
