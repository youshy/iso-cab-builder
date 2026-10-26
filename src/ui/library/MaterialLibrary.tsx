import { signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import { newId } from '../../model/defaults'
import type { Material } from '../../model/schema'
import { library, removeMaterial, updateLibrary } from '../../model/store'
import { NumberField } from '../NumberField'

/** Whether the library panel replaces the step controls. */
export const libraryOpen = signal(false)

const BANDS = ['125', '250', '500', '1k', '2k', '4k']

function edit(id: string, fn: (m: Material) => void): boolean {
  return updateLibrary((l) => {
    const m = l.materials.find((x) => x.id === id)
    if (m) fn(m)
  })
}

function MaterialCard({ m, onBlocked }: { m: Material; onBlocked: (msg: string | null) => void }) {
  function remove() {
    onBlocked(removeMaterial(m.id))
  }
  function duplicate() {
    onBlocked(null)
    updateLibrary((l) => {
      const i = l.materials.findIndex((x) => x.id === m.id)
      l.materials.splice(i + 1, 0, { ...structuredClone(m), id: newId(), name: `${m.name} copy` })
    })
  }
  return (
    <div class="card">
      <div class="cardhead">
        <input class="name" aria-label="Material name" value={m.name} onChange={(e) => edit(m.id, (x) => (x.name = (e.target as HTMLInputElement).value))} />
        <select aria-label={`${m.name} kind`} value={m.kind} onChange={(e) => edit(m.id, (x) => (x.kind = (e.target as HTMLSelectElement).value as Material['kind']))}>
          <option value="sheet">Sheet</option>
          <option value="roll">Roll</option>
          <option value="fill">Fill</option>
        </select>
        <button type="button" class="btn" onClick={duplicate}>Duplicate</button>
        <button type="button" class="btn" onClick={remove}>Delete</button>
      </div>
      <div class="grid">
        <NumberField label="Density" kind="plain" suffix="kg/m3" min={1} width={64} value={m.density} onCommit={(v) => edit(m.id, (x) => (x.density = v))} />
        <NumberField label="Young's modulus" kind="plain" suffix="GPa" min={0.0001} width={64} value={m.youngsModulus / 1e9} onCommit={(v) => edit(m.id, (x) => (x.youngsModulus = v * 1e9))} />
        <NumberField label="Loss factor" kind="plain" min={0} width={52} value={m.lossFactor} onCommit={(v) => edit(m.id, (x) => (x.lossFactor = v))} />
        <label class="field">
          <span class="fl">Thicknesses (mm)</span>
          <input
            class="text num"
            style="width:150px"
            defaultValue={m.thicknesses.join(', ')}
            key={m.thicknesses.join(',')}
            onChange={(e) => {
              const input = e.target as HTMLInputElement
              const ok = edit(m.id, (x) => (x.thicknesses = input.value.split(/[\s,;]+/).filter(Boolean).map(Number)))
              if (!ok) input.value = m.thicknesses.join(', ')
            }}
          />
        </label>
      </div>
      <div class="grid">
        <span class="fl">Absorption by band (Hz)</span>
        {m.absorption.map((a, i) => (
          <NumberField
            key={i}
            label={BANDS[i]}
            kind="plain"
            min={0}
            max={1}
            width={44}
            value={a}
            onCommit={(v) => edit(m.id, (x) => (x.absorption[i] = v))}
          />
        ))}
      </div>
    </div>
  )
}

export function MaterialLibrary() {
  const [blocked, setBlocked] = useState<string | null>(null)
  return (
    <aside class="libpanel" aria-label="Material library">
      <div class="libhead">
        <h3>Materials</h3>
        <button
          type="button"
          class="btn"
          onClick={() => {
            setBlocked(null)
            updateLibrary((l) =>
              void l.materials.push({
                id: newId(), name: 'New material', kind: 'sheet', density: 600, thicknesses: [18],
                youngsModulus: 5e9, lossFactor: 0.02, absorption: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
              }),
            )
          }}
        >
          + Add material
        </button>
        <button type="button" class="btn primary" onClick={() => (libraryOpen.value = false)}>Done</button>
      </div>
      {blocked && <p class="warn" role="alert">{blocked}</p>}
      <p class="hint">Values feed the TL and absorption estimates. Edits are saved in this browser.</p>
      {library.value.materials.map((m) => (
        <MaterialCard key={m.id} m={m} onBlocked={setBlocked} />
      ))}
    </aside>
  )
}
