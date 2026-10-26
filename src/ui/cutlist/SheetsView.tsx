import { fmtNum, units } from '../../model/store'
import type { NestGroup, Placement } from '../../cutlist/nesting'
import { built, matName, nested } from './data'

/** One nested sheet: parts as labelled rectangles on the stock outline; the kerf shows as the gap between them. */
function SheetSvg({ group, placements, qtyOf, nameOf }: { group: NestGroup; placements: Placement[]; qtyOf: (id: string) => number; nameOf: (id: string) => string }) {
  const { length: L, width: W } = group.stock!
  return (
    <svg class="nestsvg" viewBox={`0 0 ${L} ${W}`} role="img" aria-label="Nested sheet">
      <rect x="0" y="0" width={L} height={W} class="ns-stock" />
      {placements.map((p) => {
        const label = qtyOf(p.partId) > 1 ? `${p.partId}.${p.instance + 1}` : p.partId
        const size = Math.min(p.h * 0.45, (p.w / label.length) * 0.75, 90)
        return (
          <g key={`${p.partId}:${p.instance}`}>
            <title>{`${label} ${nameOf(p.partId)}, ${Math.round(p.w)} × ${Math.round(p.h)} mm${p.rotated ? ' (rotated)' : ''}`}</title>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} class="ns-part" />
            {size >= 14 && (
              <text x={p.x + p.w / 2} y={p.y + p.h / 2} font-size={size} text-anchor="middle" dominant-baseline="central" class="ns-label">{label}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function SheetsView() {
  const { groups, unplaced } = nested.value
  const { parts } = built.value
  const total = groups.reduce((a, g) => a + g.sheets.length, 0)
  const byId = new Map(parts.map((p) => [p.id, p]))
  const qtyOf = (id: string) => byId.get(id)?.qty ?? 1
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  return (
    <div class="sheetsview">
      <div class="wtotal"><b class="num">{total}</b> sheets in total</div>
      {groups.map((g) => (
        <section class="nestgroup" key={`${g.materialId}|${g.thickness}`}>
          <h3>
            {matName(g.materialId)} {fmtNum(g.thickness)} {units.value}: {g.sheets.length} × {fmtNum(g.stock!.length)} × {fmtNum(g.stock!.width)}
            <span class="unit"> · waste {g.wastePct}%</span>
          </h3>
          <div class="nestgrid">
            {g.sheets.map((s, i) => (
              <figure key={i}>
                <figcaption class="hint">Sheet {i + 1} of {g.sheets.length}</figcaption>
                <SheetSvg group={g} placements={s.placements} qtyOf={qtyOf} nameOf={nameOf} />
              </figure>
            ))}
          </div>
        </section>
      ))}
      {!groups.length && <p class="hint">Nothing to nest.</p>}
      <h3>Not on a sheet</h3>
      {unplaced.length ? (
        <table class="parts">
          <thead><tr><th>Id</th><th>Name</th><th>Reason</th></tr></thead>
          <tbody>
            {unplaced.map((u, i) => (
              <tr key={i}>
                <td class="num">{u.partId}</td>
                <td>{nameOf(u.partId)}</td>
                <td class="warn">{u.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="hint">Every sheet part is placed.</p>
      )}
      <p class="hint">Rolls are cut to length and are not nested.</p>
    </div>
  )
}
