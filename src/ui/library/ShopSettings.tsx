import { effect, signal } from '@preact/signals'
import { DEFAULT_NEW_STOCK } from '../../model/defaults'
import { library, shop, updateShop } from '../../model/store'
import { NumberField } from '../NumberField'
import { libraryOpen } from './MaterialLibrary'

/** Whether the shop settings panel replaces the step controls. */
export const shopOpen = signal(false)

/** Open the shop settings; closes the material library so only one panel shows. */
export function openShop(): void {
  libraryOpen.value = false
  shopOpen.value = true
}

// Only one side panel at a time, whichever opened last.
effect(() => {
  if (libraryOpen.value) shopOpen.value = false
})

export function ShopSettings() {
  const s = shop.value
  const mats = library.value.materials.filter((m) => m.kind !== 'fill')
  const matName = (id: string) => library.value.materials.find((m) => m.id === id)?.name ?? id
  return (
    <aside class="libpanel" aria-label="Shop settings">
      <div class="libhead">
        <h3>Shop settings</h3>
        <button
          type="button"
          class="btn"
          onClick={() =>
            updateShop((x) => void x.sheets.push({ materialId: mats[0]?.id ?? '', ...DEFAULT_NEW_STOCK }))
          }
        >
          + Add stock
        </button>
        <button type="button" class="btn primary" onClick={() => (shopOpen.value = false)}>Done</button>
      </div>
      <p class="hint">Used for the cut list and nesting. Edits are saved in this browser.</p>
      <div class="card">
        <div class="grid">
          <NumberField label="Saw kerf" value={s.kerf} allowZero width={56} onCommit={(v) => updateShop((x) => void (x.kerf = v))} />
          <NumberField label="Max bevel" kind="plain" suffix="deg" min={0} max={89} width={52} value={s.maxBevel} onCommit={(v) => updateShop((x) => void (x.maxBevel = v))} />
          <NumberField label="Min part" value={s.minPart} allowZero width={56} onCommit={(v) => updateShop((x) => void (x.minPart = v))} />
          <NumberField label="Roll overlap" value={s.rollOverlap} allowZero width={56} onCommit={(v) => updateShop((x) => void (x.rollOverlap = v))} />
        </div>
      </div>
      <h3>Stock sheets and rolls</h3>
      <p class="hint">Length 0 means a roll of that width.</p>
      <table class="shoptable">
        <thead>
          <tr><th>Material</th><th>Thickness</th><th>Length</th><th>Width</th><th /></tr>
        </thead>
        <tbody>
          {s.sheets.map((st, i) => (
            <tr key={i}>
              <td>
                <select
                  aria-label={`Stock ${i + 1} material`}
                  value={st.materialId}
                  onChange={(e) => updateShop((x) => void (x.sheets[i].materialId = (e.target as HTMLSelectElement).value))}
                >
                  {!mats.some((m) => m.id === st.materialId) && <option value={st.materialId}>{matName(st.materialId)}</option>}
                  {mats.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </td>
              <td><NumberField ariaLabel={`Stock ${i + 1} thickness`} value={st.thickness} width={56} onCommit={(v) => updateShop((x) => void (x.sheets[i].thickness = v))} /></td>
              <td><NumberField ariaLabel={`Stock ${i + 1} length`} value={st.length} allowZero width={64} onCommit={(v) => updateShop((x) => void (x.sheets[i].length = v))} /></td>
              <td><NumberField ariaLabel={`Stock ${i + 1} width`} value={st.width} width={64} onCommit={(v) => updateShop((x) => void (x.sheets[i].width = v))} /></td>
              <td><button type="button" class="btn small" aria-label={`Remove stock ${i + 1}`} onClick={() => updateShop((x) => void x.sheets.splice(i, 1))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
}
