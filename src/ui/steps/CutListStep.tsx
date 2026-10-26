import { useState } from 'preact/hooks'
import { partsCsv } from '../../cutlist/csv'
import { currentProject } from '../../model/store'
import { built, matName, nested, printOnly, sheets } from '../cutlist/data'
import { HardwareTable, PartsTable } from '../cutlist/PartsTable'
import { SheetsView } from '../cutlist/SheetsView'
import { WeightPanel } from '../cutlist/WeightPanel'
import { download } from '../download'
import { openShop } from '../library/ShopSettings'

type Tab = 'parts' | 'hardware' | 'sheets' | 'drawings' | 'weight'
const TABS: { id: Tab; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'drawings', label: 'Drawings' },
  { id: 'weight', label: 'Weight' },
]

function exportCsv() {
  download(`${currentProject.value.name}-parts.csv`, partsCsv(built.value.parts, matName), 'text/csv')
}

export function CutListStep() {
  const [tab, setTab] = useState<Tab>('parts')
  const warnings = built.value.parts.filter((p) => p.warnings.length).length
  const sheetCount = nested.value.groups.reduce((a, g) => a + g.sheets.length, 0)
  return (
    <section class="stage cutstage">
      <div class="viewbar">
        <div class="seg" role="tablist" aria-label="Cut list views">
          {TABS.map((t) => (
            <button type="button" role="tab" key={t.id} class={tab === t.id ? 'on' : ''} aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span class="unit">{sheetCount} sheets{warnings ? `, ${warnings} parts with warnings` : ''}</span>
        <div class="sp" />
        <button type="button" class="btn" onClick={openShop}>Shop settings</button>
        <button type="button" class="btn" onClick={exportCsv}>Export CSV</button>
        <button type="button" class="btn" onClick={() => printOnly('cutlist')}>Print cut list</button>
        <button type="button" class="btn primary" onClick={() => printOnly('drawings')}>Print drawings</button>
      </div>
      <div class="cutbody" role="tabpanel">
        {tab === 'parts' && <PartsTable />}
        {tab === 'hardware' && <HardwareTable />}
        {tab === 'sheets' && <SheetsView />}
        {tab === 'weight' && <WeightPanel />}
        {tab === 'drawings' && (
          <div>
            <p class="hint">Print at 100% / Actual size, A3 landscape. {sheets.value.length} sheets, one per page.</p>
            <div class="sheetprev">
              {sheets.value.map((s) => (
                <figure key={s.title}>
                  <figcaption>{s.title} <span class="unit">· scale 1:{s.scale}</span></figcaption>
                  {s.warnings.map((w) => <p class="warn" key={w}>{w}</p>)}
                  <div dangerouslySetInnerHTML={{ __html: s.svg }} />
                </figure>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
