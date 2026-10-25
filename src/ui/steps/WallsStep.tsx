import { signal } from '@preact/signals'
import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { doorStack, effectiveWallStack, escape, OCTAVES, THIRD_OCTAVES, tlStack, type TlItem } from '../../acoustics/tl'
import { hasSingleLayerBox } from '../../geometry/boxes'
import { wallTreatments } from '../../geometry/treatments'
import { activeInterior, stackThickness, WALLS, wallStack } from '../../geometry/walls'
import type { Design, Gap, JointType, Layer, StackItem, WallId } from '../../model/schema'
import { addLayer, canInsertGapAt, firstFreeBoundary, insertGap, moveLayer, removeLayer, setLayerMaterial } from '../../model/stack'
import { compareDesign, compareVersion, design, fmtLen, library, update } from '../../model/store'
import { Chart, type ChartSeries } from '../Chart'
import { libraryOpen } from '../library/MaterialLibrary'
import { NumberField } from '../NumberField'
import { useRowIds } from '../useRowIds'
import { View3DPanel } from '../views/View3D'

type Target = 'default' | WallId

/** The override wall being edited; outlined in the 3D view. Null while the default stack is the focus. */
const editing = signal<WallId | null>(null)

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const targetTitle = (t: Target) => (t === 'default' ? 'Default wall' : `${cap(t)} wall`)

/** Walls whose facets or treatments change their stack as built. */
const builtWalls = (d: Design) => WALLS.filter((w) => activeInterior(d, w) || wallTreatments(d, w).length > 0)

/** Apply a pure stack edit to the default stack or a wall override. */
function editStack(target: Target, fn: (s: StackItem[]) => StackItem[]) {
  update((d) => {
    if (target === 'default') d.wallDefault = fn(d.wallDefault)
    else if (d.wallOverrides[target]) d.wallOverrides[target] = fn(d.wallOverrides[target])
  })
}

function patchItem(target: Target, i: number, patch: Partial<Layer> | Partial<Gap>) {
  editStack(target, (s) => s.map((it, k) => (k === i ? ({ ...it, ...patch } as StackItem) : it)))
}

function toggleOverride(w: WallId, on: boolean) {
  update((d) => {
    if (on) d.wallOverrides[w] = structuredClone(d.wallDefault)
    else delete d.wallOverrides[w]
  })
  if (on) editing.value = w
  else if (editing.value === w) editing.value = null
}

function LayerCells({ item, i, target }: { item: Layer; i: number; target: Target }) {
  const lib = library.value
  const mat = lib.materials.find((m) => m.id === item.materialId)
  const listed = !!mat?.thicknesses.includes(item.thickness)
  const [custom, setCustom] = useState(false)
  const showCustom = custom || !listed
  return (
    <div class="main-cell">
      <select
        aria-label={`Layer ${i + 1} material`}
        value={item.materialId}
        onChange={(e) => {
          setCustom(false)
          editStack(target, (s) => setLayerMaterial(s, i, (e.target as HTMLSelectElement).value, lib))
        }}
      >
        {lib.materials
          .filter((m) => m.kind !== 'fill' || m.id === item.materialId)
          .map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        {!mat && <option value={item.materialId}>Missing material</option>}
      </select>
      <select
        class="num"
        aria-label={`Layer ${i + 1} thickness`}
        value={showCustom ? 'custom' : String(item.thickness)}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value
          if (v === 'custom') setCustom(true)
          else {
            setCustom(false)
            patchItem(target, i, { thickness: Number(v) })
          }
        }}
      >
        {mat?.thicknesses.map((t) => (
          <option key={t} value={String(t)}>{fmtLen(t)}</option>
        ))}
        <option value="custom">Custom</option>
      </select>
      {showCustom && (
        <NumberField ariaLabel={`Layer ${i + 1} custom thickness`} value={item.thickness} onCommit={(v) => patchItem(target, i, { thickness: v })} />
      )}
    </div>
  )
}

function GapCells({ item, i, target }: { item: Gap; i: number; target: Target }) {
  const fills = library.value.materials.filter((m) => m.kind === 'fill')
  return (
    <div class="main-cell">
      <b>Air gap</b>
      <NumberField ariaLabel="Gap width" value={item.width} onCommit={(v) => patchItem(target, i, { width: v })} />
      <select aria-label="Decoupling" value={item.decoupling} onChange={(e) => patchItem(target, i, { decoupling: (e.target as HTMLSelectElement).value as Gap['decoupling'] })}>
        <option value="clips">Resilient clips</option>
        <option value="strips">Rigid strips</option>
      </select>
      <select aria-label="Gap fill" value={item.fill} onChange={(e) => patchItem(target, i, { fill: (e.target as HTMLSelectElement).value as Gap['fill'] })}>
        <option value="insulation">Insulation</option>
        <option value="empty">Empty</option>
      </select>
      {item.fill === 'insulation' && (
        <select aria-label="Gap insulation" value={item.fillMaterialId} onChange={(e) => patchItem(target, i, { fillMaterialId: (e.target as HTMLSelectElement).value })}>
          {fills.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
          {!fills.some((m) => m.id === item.fillMaterialId) && <option value={item.fillMaterialId}>Missing material</option>}
        </select>
      )}
    </div>
  )
}

function StackEditor({ target, stack }: { target: Target; stack: StackItem[] }) {
  const rows = useRowIds(stack.length)
  const lib = library.value
  const free = firstFreeBoundary(stack)
  /** Apply a guarded stack edit; row ids follow only when the edit was accepted. */
  const run = (next: StackItem[], track: () => void) => {
    if (next === stack) return
    track()
    editStack(target, () => next)
  }
  return (
    <div>
      {stack.map((item, i) => (
        <Fragment key={rows.ids[i]}>
          {canInsertGapAt(stack, i) && (
            <div class="boundary">
              <button type="button" class="btn small" aria-label={`Add cavity between items ${i} and ${i + 1}`} onClick={() => run(insertGap(stack, lib, i), () => rows.inserted(i))}>
                Add cavity here
              </button>
            </div>
          )}
          <div class={`srow ${item.kind === 'gap' ? 'gap' : ''}`}>
            {item.kind === 'layer' ? <LayerCells item={item} i={i} target={target} /> : <GapCells item={item} i={i} target={target} />}
            <button type="button" class="btn iconbtn" aria-label={`Move item ${i + 1} outward`} disabled={moveLayer(stack, i, -1) === stack} onClick={() => run(moveLayer(stack, i, -1), () => rows.swapped(i, i - 1))}>
              Up
            </button>
            <button type="button" class="btn iconbtn" aria-label={`Move item ${i + 1} inward`} disabled={moveLayer(stack, i, 1) === stack} onClick={() => run(moveLayer(stack, i, 1), () => rows.swapped(i, i + 1))}>
              Down
            </button>
            <button type="button" class="btn iconbtn" aria-label={`Remove item ${i + 1}`} disabled={removeLayer(stack, i) === stack} onClick={() => run(removeLayer(stack, i), () => rows.removed(i))}>
              Remove
            </button>
          </div>
        </Fragment>
      ))}
      <div class="row">
        <button type="button" class="btn" onClick={() => run(addLayer(stack, lib), () => rows.inserted(stack.length))}>
          Add layer
        </button>
        <button type="button" class="btn" disabled={free < 0} onClick={() => run(insertGap(stack, lib, free), () => rows.inserted(free))}>
          Add air gap
        </button>
        <span class="hint num">Total {fmtLen(stackThickness(stack))}, outside first</span>
      </div>
    </div>
  )
}

const JOINTS: { id: JointType; label: string; shapes: string[] }[] = [
  { id: 'sides-past', label: 'Sides past', shapes: ['4,4 16,4 16,42 4,42', '16,4 52,4 52,16 16,16'] },
  { id: 'tops-past', label: 'Tops past', shapes: ['4,4 52,4 52,16 4,16', '4,16 16,16 16,42 4,42'] },
  { id: 'rebate', label: 'Rebate', shapes: ['4,4 10,4 10,10 16,10 16,42 4,42', '10,4 52,4 52,16 16,16 16,10 10,10'] },
  { id: 'mitre', label: 'Mitre', shapes: ['4,4 16,16 16,42 4,42', '4,4 52,4 52,16 16,16'] },
]

function JointPicker() {
  const joint = design.value.joint
  return (
    <>
      <div class="joints" role="radiogroup" aria-label="Joint type">
        {JOINTS.map((j) => (
          <button
            type="button"
            role="radio"
            aria-checked={j.id === joint}
            key={j.id}
            class={`joint ${j.id === joint ? 'sel' : ''}`}
            onClick={() => update((d) => void (d.joint = j.id))}
          >
            <svg viewBox="0 0 56 46" aria-hidden="true">
              {j.shapes.map((p, k) => (
                <polygon key={k} points={p} class="p" />
              ))}
            </svg>
            {j.label}
          </button>
        ))}
      </div>
      {joint === 'rebate' && hasSingleLayerBox(design.value) && (
        <p class="hint">Rebate needs at least two layers; single-layer walls are built sides past</p>
      )}
    </>
  )
}

function StackChart({ title, stack, compareStack }: { title: string; stack: TlItem[]; compareStack: TlItem[] | null }) {
  const lib = library.value
  const cur = tlStack(stack, lib)
  const series: ChartSeries[] = [{ label: 'Current', y: cur.thirds }]
  if (compareStack) series.push({ label: `Compare v${compareVersion.value}`, y: tlStack(compareStack, lib).thirds, dashed: true })
  return (
    <div class="card">
      <b>{title}</b>
      <div class="hint">
        {cur.model}. Average TL about {cur.single.toFixed(0)} dB, 100 Hz to 3.15 kHz.
        {cur.f0s.length > 0 && ` Dips at ${cur.f0s.map((f) => `${Math.round(f)} Hz`).join(', ')}.`}
      </div>
      <Chart
        x={THIRD_OCTAVES}
        series={series}
        xLog
        yLabel="TL (dB)"
        markers={cur.f0s.map((f, k) => ({ x: f, label: cur.f0s.length > 1 ? `resonance ${k + 1}` : 'air-gap resonance' }))}
      />
    </div>
  )
}

function EscapeTable() {
  const d = design.value
  const lib = library.value
  const e = escape(d, lib)
  const door = doorStack(d, lib)
  const stacks: TlItem[][] = [...WALLS.map((w) => effectiveWallStack(d, lib, w)), ...(door ? [door] : [])]
  const models = [...new Set(stacks.map((s) => tlStack(s, lib).model))]
  const worstAt = OCTAVES[e.margin.indexOf(e.worst)]
  const row = (label: string, cells: (i: number) => preact.ComponentChild) => (
    <tr>
      <td>{label}</td>
      {OCTAVES.map((f, i) => (
        <td key={f} class="num">{cells(i)}</td>
      ))}
    </tr>
  )
  return (
    <>
      <h3>Sound escape estimate ({models.join(' / ')})</h3>
      <div class="row">
        <NumberField label="Target outside" kind="plain" suffix="dB" value={d.escape.outsideTarget} onCommit={(v) => update((x) => void (x.escape.outsideTarget = v))} />
        <NumberField label="Distance" kind="plain" suffix="m" min={0.01} value={d.escape.distance} onCommit={(v) => update((x) => void (x.escape.distance = v))} />
      </div>
      <table class="etable">
        <thead>
          <tr>
            <th>Octave (Hz)</th>
            {OCTAVES.map((f) => (
              <th key={f}>{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Cab level at 1 m (dB)', (i) => (
            <NumberField ariaLabel={`Cab level at 1 m ${OCTAVES[i]} Hz`} kind="plain" width={52} value={d.escape.insideLevel[i]} onCommit={(v) => update((x) => void (x.escape.insideLevel[i] = v))} />
          ))}
          {row('Absorption in box (m²)', (i) => e.absorption[i].toFixed(2))}
          {row('Level inside box (dB)', (i) => e.lin[i].toFixed(1))}
          {row('Box TL (dB)', (i) => e.tlBox[i].toFixed(1))}
          {row('Outside level (dB)', (i) => e.lout[i].toFixed(1))}
          <tr>
            <td>Margin (dB)</td>
            {OCTAVES.map((f, i) => (
              <td key={f} class={`num ${e.margin[i] < 0 ? 'neg' : ''}`}>{e.margin[i].toFixed(1)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p class={`summary num ${e.worst < 0 ? 'neg' : ''}`}>
        Worst margin: <b>{e.worst.toFixed(1)} dB</b> at {worstAt} Hz. Level inside box is a diffuse-field estimate from the absorption.
      </p>
    </>
  )
}

export function WallsStep() {
  const d = design.value
  const cmp = compareDesign.value
  const overrides = WALLS.filter((w) => d.wallOverrides[w])
  const door = doorStack(d, library.value)
  return (
    <>
      <aside>
        <div class="libhead">
          <h3>Wall layers</h3>
          <button type="button" class="btn" onClick={() => (libraryOpen.value = true)}>Materials</button>
        </div>
        <StackEditor key="default" target="default" stack={d.wallDefault} />

        <h3>Per-wall override</h3>
        <div class="row">
          {WALLS.map((w) => (
            <label class="field" key={w}>
              <input type="checkbox" checked={!!d.wallOverrides[w]} onChange={(e) => toggleOverride(w, (e.target as HTMLInputElement).checked)} />
              {cap(w)}
            </label>
          ))}
        </div>
        {overrides.map((w) => (
          <div class={`card ${editing.value === w ? 'editing' : ''}`} key={w} onFocusIn={() => (editing.value = w)} onPointerEnter={() => (editing.value = w)}>
            <b>{targetTitle(w)}</b>
            <StackEditor key={w} target={w} stack={d.wallOverrides[w]!} />
          </div>
        ))}

        <h3>Joint</h3>
        <JointPicker />
      </aside>
      <section class="stage wallsstage">
        <div class="wallview">
          <View3DPanel design={d} highlight={editing.value && d.wallOverrides[editing.value] ? editing.value : undefined} initial="section" />
        </div>
        <h3>Transmission loss per stack</h3>
        <StackChart title="Default wall" stack={d.wallDefault} compareStack={cmp ? cmp.wallDefault : null} />
        {overrides.map((w) => (
          <StackChart key={w} title={targetTitle(w)} stack={d.wallOverrides[w]!} compareStack={cmp ? wallStack(cmp, w) : null} />
        ))}
        {builtWalls(d).map((w) => (
          <StackChart key={`built-${w}`} title={`${cap(w)} (as built)`} stack={effectiveWallStack(d, library.value, w)} compareStack={cmp ? effectiveWallStack(cmp, library.value, w) : null} />
        ))}
        {door && <StackChart key="door" title="Door" stack={door} compareStack={cmp ? doorStack(cmp, library.value) : null} />}
        <EscapeTable />
      </section>
    </>
  )
}
