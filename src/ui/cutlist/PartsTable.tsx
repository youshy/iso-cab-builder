import { STEP_ORDER, type HardwareItem, type Part } from '../../cutlist/parts'
import { fmtNum, units } from '../../model/store'
import { STEP_LABEL, built, matName } from './data'

const bevelText = (p: Part) => p.bevels.map((b) => `${b.edge} ${b.angle}°`).join(', ')

export function PartsTable() {
  const { parts } = built.value
  const u = units.value
  const pieces = parts.reduce((a, p) => a + p.qty, 0)
  return (
    <table class="parts">
      <thead>
        <tr>
          <th>Id</th><th>Name</th><th>Material</th><th class="r">Thick ({u})</th><th class="r">L × W ({u})</th>
          <th>Bevels</th><th class="r">Qty</th><th>Notes</th><th>Warnings</th>
        </tr>
      </thead>
      {STEP_ORDER.map((step) => {
        const rows = parts.filter((p) => p.step === step)
        if (!rows.length) return null
        return (
          <tbody key={step}>
            <tr class="grp"><th colSpan={9}>{STEP_LABEL[step]}</th></tr>
            {rows.map((p) => (
              <tr key={p.id}>
                <td class="num">{p.id}</td>
                <td>{p.name}</td>
                <td>{matName(p.materialId)}</td>
                <td class="num r">{fmtNum(p.thickness)}</td>
                <td class="num r">{fmtNum(p.length)} × {fmtNum(p.width)}</td>
                <td class="num">{bevelText(p)}</td>
                <td class="num r">{p.qty}</td>
                <td class="notes">{p.notes.join('; ')}</td>
                <td class="warn">{p.warnings.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        )
      })}
      <tfoot>
        <tr><td colSpan={9}>{parts.length} part lines, {pieces} pieces</td></tr>
      </tfoot>
    </table>
  )
}

export function HardwareTable() {
  const { hardware } = built.value
  const rows = [...hardware].sort((a, b) => STEP_ORDER.indexOf(a.step ?? 'doors') - STEP_ORDER.indexOf(b.step ?? 'doors'))
  const qty = (h: HardwareItem) => (h.unit === 'm' ? `${Math.round(h.qty * 10) / 10} m` : `${h.qty}`)
  return (
    <table class="parts">
      <thead>
        <tr><th>Item</th><th class="r">Qty</th><th>Build step</th></tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={`${h.name}|${h.step ?? ''}`}>
            <td>{h.name}</td>
            <td class="num r">{qty(h)}</td>
            <td>{h.step ? STEP_LABEL[h.step] : 'General'}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={3} class="hint">No hardware.</td></tr>}
      </tbody>
    </table>
  )
}
