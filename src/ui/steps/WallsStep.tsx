import { signal } from '@preact/signals'
import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { doorStack, effectiveWallStack, escape, OCTAVES, THIRD_OCTAVES, tlStack, type TlItem, type TlResult } from '../../acoustics/tl'
import { hasSingleLayerBox } from '../../geometry/boxes'
import { stackThickness, WALLS } from '../../geometry/walls'
import type { Gap, JointType, Layer, Library, StackItem, WallId } from '../../model/schema'
import { addLayer, canInsertGapAt, firstFreeBoundary, insertGap, moveLayer, removeLayer, setLayerMaterial } from '../../model/stack'
import { compareDesign, compareVersion, design, fmtLen, library, update } from '../../model/store'
import { OverlayChart, OverlayLegend, type OverlaySeries } from '../Chart'
import { groupStacks, type StackGroup } from '../chartScale'
import { libraryOpen } from '../library/MaterialLibrary'
import { NumberField } from '../NumberField'
import { useRowIds } from '../useRowIds'
import { View3DPanel } from '../views/View3D'

type Target = 'default' | WallId

/** The override wall being edited; outlined in the 3D view. Null while the default stack is the focus. */
const editing = signal<WallId | null>(null)

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const targetTitle = (t: Target) => (t === 'default' ? 'Default wall' : `${cap(t)} wall`)

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
      <div class="hint cellhint">Insulation goes in a cavity, see Add cavity</div>
    </div>
  )
}

function GapCells({ item, i, target }: { item: Gap; i: number; target: Target }) {
  const fills = library.value.materials.filter((m) => m.kind === 'fill')
  const fill = fills.find((m) => m.id === item.fillMaterialId)
  const insulated = item.fill === 'insulation'
  const listed = !!fill?.thicknesses.includes(item.width)
  const [custom, setCustom] = useState(false)
  const showCustom = !insulated || custom || !listed
  const setFill = (next: Gap['fill']) => {
    const first = fill?.thicknesses[0]
    setCustom(false)
    patchItem(target, i, next === 'insulation' && first !== undefined ? { fill: next, width: first } : { fill: next })
  }
  return (
    <div class="main-cell">
      <b>{insulated ? `Cavity: ${fill?.name ?? 'Missing material'} ${fmtLen(item.width)}` : `Cavity: air ${fmtLen(item.width)}`}</b>
      <select aria-label="Gap fill" value={item.fill} onChange={(e) => setFill((e.target as HTMLSelectElement).value as Gap['fill'])}>
        <option value="insulation">Insulation</option>
        <option value="empty">Empty</option>
      </select>
      {insulated && (
        <select aria-label="Gap insulation" value={item.fillMaterialId} onChange={(e) => patchItem(target, i, { fillMaterialId: (e.target as HTMLSelectElement).value })}>
          {fills.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
          {!fill && <option value={item.fillMaterialId}>Missing material</option>}
        </select>
      )}
      {insulated && fill && (
        <select
          class="num"
          aria-label="Gap width"
          value={showCustom ? 'custom' : String(item.width)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            if (v === 'custom') setCustom(true)
            else {
              setCustom(false)
              patchItem(target, i, { width: Number(v) })
            }
          }}
        >
          {fill.thicknesses.map((t) => (
            <option key={t} value={String(t)}>{fmtLen(t)}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
      )}
      {showCustom && <NumberField ariaLabel={insulated ? 'Gap custom width' : 'Gap width'} value={item.width} onCommit={(v) => patchItem(target, i, { width: v })} />}
      <select aria-label="Decoupling" value={item.decoupling} onChange={(e) => patchItem(target, i, { decoupling: (e.target as HTMLSelectElement).value as Gap['decoupling'] })}>
        <option value="clips">Resilient clips</option>
        <option value="strips">Rigid strips</option>
      </select>
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
          Add cavity
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

/** Series colours in fixed order (dataviz categorical slots, orange left to the selection accent). */
const SERIES_COLORS = ['#2a78d6', '#1baf7a', '#6250d6', '#e87ba4', '#008300', '#e34948', '#eda100']

interface GroupRow {
  group: StackGroup<TlItem>
  color: string
  tl: TlResult
  compare: TlResult | null
  thickness: number
  mass: number
  delta: number | null
}

const layersOf = (stack: TlItem[]) => stack.filter((i): i is Layer => i.kind === 'layer')
const massOf = (stack: TlItem[], lib: Library) =>
  layersOf(stack).reduce((a, l) => a + ((lib.materials.find((m) => m.id === l.materialId)?.density ?? 0) * l.thickness) / 1000, 0)

/** As-built stacks of every wall and the door, grouped by identical stack. Compare stacks follow the group's first member. */
function buildRows(): GroupRow[] {
  const d = design.value
  const cmp = compareDesign.value
  const lib = library.value
  const entries = (x: typeof d) => [
    ...WALLS.map((w) => ({ name: cap(w), stack: effectiveWallStack(x, lib, w), tag: d.wallOverrides[w] ? 'override' : 'default' })),
    ...(doorStack(x, lib) ? [{ name: 'Door', stack: doorStack(x, lib)! }] : []),
  ]
  const groups = groupStacks(entries(d), WALLS.length)
  const cmpByName = cmp ? new Map(entries(cmp).map((e) => [e.name, e.stack])) : null
  const base = groups.reduce((best, g, k) => (g.tags.filter((t) => t === 'default').length > groups[best].tags.filter((t) => t === 'default').length ? k : best), 0)
  const rows = groups.map((group, k) => {
    const tl = tlStack(group.stack, lib)
    const cs = cmpByName?.get(group.names[0])
    return {
      group,
      color: SERIES_COLORS[k % SERIES_COLORS.length],
      tl,
      compare: cs ? tlStack(cs, lib) : null,
      thickness: stackThickness(group.stack.filter((i): i is StackItem => i.kind !== 'absorber')),
      mass: massOf(group.stack, lib),
      delta: null as number | null,
    }
  })
  rows.forEach((r, k) => (r.delta = k === base ? null : r.tl.single - rows[base].tl.single))
  return rows
}

const hz = (f: number | null) => (f === null ? 'n/a' : `${Math.round(f)}`)

function WallTlChart({ rows }: { rows: GroupRow[] }) {
  const v = compareVersion.value
  const series: OverlaySeries[] = rows.flatMap((r) => {
    const vlines = [
      ...r.tl.f0s.map((f) => ({ x: f, label: `${r.tl.f0s.length > 1 ? 'cavity' : 'air-gap'} dip ${hz(f)} Hz` })),
      ...(r.tl.fc !== null ? [{ x: r.tl.fc, label: `coincidence dip ${hz(r.tl.fc)} Hz` }] : []),
    ]
    const cur: OverlaySeries = { label: r.group.label, color: r.color, y: r.tl.thirds, vlines }
    return r.compare ? [cur, { label: `${r.group.label}, v${v}`, color: r.color, y: r.compare.thirds, dashed: true }] : [cur]
  })
  const models = [...new Set(rows.map((r) => r.tl.model))]
  return (
    <div class="card">
      <b>Sound blocked by each wall (estimate)</b>
      <div class="hint">Higher is quieter outside. 10 dB ≈ half as loud. {models.join(' / ')}.</div>
      <OverlayLegend series={series} />
      <OverlayChart
        title="Transmission loss per wall stack"
        x={THIRD_OCTAVES}
        domain={[50, 5000]}
        ticks={[63, 125, 250, 500, 1000, 2000, 4000]}
        series={series}
        yLabel="Transmission loss (dB)"
        yStep={10}
        yInclude={[0]}
        band={{ from: 80, to: 1200, label: 'Guitar fundamentals' }}
        digits={0}
      />
      <div class="hint">Thin dashed vertical lines mark each curve's dips: air-gap (cavity) resonance and coincidence.</div>
    </div>
  )
}

function SummaryTable({ rows }: { rows: GroupRow[] }) {
  return (
    <table class="etable stacktable">
      <thead>
        <tr>
          <th>Stack</th>
          <th>Thickness (mm)</th>
          <th>Mass (kg/m²)</th>
          <th>Air-gap dip (Hz)</th>
          <th>Coincidence dip (Hz)</th>
          <th>Average TL (dB)</th>
          <th>vs default (dB)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.group.label}>
            <td>
              <i class="sw" style={{ background: r.color }} />
              {r.group.label}
            </td>
            <td class="num">{Math.round(r.thickness)}</td>
            <td class="num">{r.mass.toFixed(1)}</td>
            <td class="num">{r.tl.f0s.length > 0 ? r.tl.f0s.map((f) => hz(f)).join(', ') : 'n/a'}</td>
            <td class="num">{hz(r.tl.fc)}</td>
            <td class="num">{r.tl.single.toFixed(1)}</td>
            <td class={`num ${r.delta !== null && r.delta < 0 ? 'neg' : ''}`}>{r.delta === null ? 'n/a' : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(1)}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EscapeSection({ rows }: { rows: GroupRow[] }) {
  const d = design.value
  const lib = library.value
  const cmp = compareDesign.value
  const e = escape(d, lib)
  const target = d.escape.outsideTarget
  const worstAt = OCTAVES[e.margin.indexOf(e.worst)]
  const cols = OCTAVES.map((f, i) => ({ f, i, lo: f / Math.SQRT2, hi: f * Math.SQRT2 }))
  const series: OverlaySeries[] = [{ label: 'Outside level', color: SERIES_COLORS[0], y: e.lout, points: true }]
  if (cmp) series.push({ label: `Outside level, v${compareVersion.value}`, color: SERIES_COLORS[0], y: escape(cmp, lib).lout, dashed: true, points: true })
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
      <div class="card">
        <b>Sound outside the box vs your target (estimate)</b>
        <div class="hint">Shaded octaves are louder than the target. {[...new Set(rows.map((r) => r.tl.model))].join(' / ')}.</div>
        <OverlayLegend series={series} />
        <OverlayChart
          title="Outside level per octave against the target"
          x={OCTAVES}
          domain={[OCTAVES[0] / Math.SQRT2, OCTAVES[OCTAVES.length - 1] * Math.SQRT2]}
          ticks={OCTAVES}
          series={series}
          yLabel={`dB SPL at ${d.escape.distance} m`}
          yStep={10}
          hline={{ y: target, label: `Target ${target} dB` }}
          over={cols.filter((c) => e.lout[c.i] > target).map((c) => ({ from: c.lo, to: c.hi }))}
        />
      </div>
      <h3>Escape inputs</h3>
      <div class="row">
        <NumberField label="Target outside" kind="plain" suffix="dB" value={target} onCommit={(v) => update((x) => void (x.escape.outsideTarget = v))} />
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

function WallAcoustics() {
  const rows = buildRows()
  return (
    <>
      <WallTlChart rows={rows} />
      <SummaryTable rows={rows} />
      <EscapeSection rows={rows} />
    </>
  )
}

export function WallsStep() {
  const d = design.value
  const overrides = WALLS.filter((w) => d.wallOverrides[w])
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
        <WallAcoustics />
      </section>
    </>
  )
}
