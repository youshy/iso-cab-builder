import { design, currentProject } from '../../model/store'
import { PartsTable, HardwareTable } from './PartsTable'
import { WeightPanel } from './WeightPanel'
import { printOutput, sheets } from './data'

/** Only rendered while printing. The print stylesheet hides everything else. */
export function PrintRoot() {
  const what = printOutput.value
  if (!what) return null
  if (what === 'drawings') {
    return (
      <div class="printroot print-drawings">
        {sheets.value.map((s) => (
          <div class="printsheet" key={s.title} dangerouslySetInnerHTML={{ __html: s.svg }} />
        ))}
      </div>
    )
  }
  return (
    <div class="printroot print-cutlist">
      <h1>{currentProject.value.name}: cut list</h1>
      <p class="hint">{design.value.cabs.map((c) => c.name).join(', ')}</p>
      <PartsTable />
      <h3>Hardware</h3>
      <HardwareTable />
      <h3>Weight (estimate)</h3>
      <WeightPanel />
    </div>
  )
}
