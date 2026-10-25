import { signal } from '@preact/signals'
import { doorWall } from '../../doors/side'
import { resolveDims } from '../../geometry/dimensions'
import { widthError } from '../../geometry/facets'
import { cabFit, cornerFlags, inactiveFacetWarnings } from '../../geometry/space'
import { inactiveTreatmentWarnings } from '../../geometry/treatments'
import { wallPlaneAxes, WALLS } from '../../geometry/walls'
import { DEFAULT_INSULATION, DEFAULT_PANEL_LAYER, materialOrFirst, newId } from '../../model/defaults'
import {
  editFacetWidth, ensureInterior, MAX_FACETS, setFacetCount, setSplitAxis, splitWallEvenly, wallLength,
} from '../../model/interiorEdit'
import type { Axis, Design, Facet, InnerPanel, Layer, SurfaceRef, Treatment, WallId } from '../../model/schema'
import { addLayer, removeLayer } from '../../model/stack'
import { compareDesign, design, fmtLen, library, update } from '../../model/store'
import { NumberField } from '../NumberField'
import { useRowIds } from '../useRowIds'
import { SectionView } from '../views/SectionView'
import { View3DPanel } from '../views/View3D'
import { Seg } from '../Seg'

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const AXIS_NAME: Record<Axis, string> = { x: 'Width', y: 'Height', z: 'Depth' }
const AXES: Axis[] = ['x', 'y', 'z']
const round1 = (n: number) => Math.round(n * 10) / 10

/** Edge names along an axis, low end first. */
const EDGES: Record<Axis, [string, string]> = { x: ['left', 'right'], y: ['bottom', 'top'], z: ['back', 'front'] }

/** Unfolded box layout: [wall, column, row] on a 4 by 3 grid. */
const NET: [WallId, number, number][] = [
  ['top', 2, 1], ['left', 1, 2], ['front', 2, 2], ['right', 3, 2], ['back', 4, 2], ['bottom', 2, 3],
]

const picked = signal<WallId | null>(null)
const widthErr = signal<{ wall: WallId; index: number } | null>(null)
const showFront = signal<'both' | 'planfront' | 'plan' | 'front' | 'side' | '3d'>('both')
const exaggerate = signal(true)

/** A wall edit; clears the stale width error. */
const editWall = (fn: (d: Design) => void) => {
  widthErr.value = null
  update(fn)
}

function currentWall(d: Design): WallId {
  const door = doorWall(d)
  const p = picked.value
  return p && p !== door ? p : WALLS.find((w) => w !== door)!
}

function WallNet({ d, sel, onPick }: { d: Design; sel: WallId; onPick: (w: WallId) => void }) {
  const door = doorWall(d)
  return (
    <div class="net" role="group" aria-label="Pick a wall">
      {NET.map(([w, col, row]) => {
        const count = d.interior[w]?.facets.length
        const isDoor = w === door
        return (
          <button
            type="button"
            key={w}
            class={`face ${w === sel ? 'sel' : ''} ${isDoor ? 'door' : ''}`}
            style={{ gridColumn: col, gridRow: row }}
            aria-pressed={w === sel}
            aria-disabled={isDoor}
            title={isDoor ? 'This is the door side; set it in step 4' : undefined}
            onClick={() => !isDoor && onPick(w)}
          >
            {cap(w)}
            {count !== undefined && <span class="badge">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

function FacetTable({ d, w }: { d: Design; w: WallId }) {
  const wi = d.interior[w]!
  const len = wallLength(d, wi.splitAxis)
  const [lo, hi] = EDGES[wi.splitAxis]
  const setFacet = (i: number, patch: Partial<Facet>) =>
    editWall((x) => void Object.assign(x.interior[w]!.facets[i], patch))
  const setWidth = (i: number, v: number) => {
    const next = editFacetWidth(wi.facets, i, v, len)
    if (!next) {
      widthErr.value = { wall: w, index: i }
      return
    }
    widthErr.value = null
    editWall((x) => void (x.interior[w]!.facets = next))
  }
  const off = widthError(wi.facets, len)
  const err = widthErr.value
  return (
    <>
      <table>
        <thead>
          <tr><th>#</th><th>Width</th><th style="width:40%">Tilt</th><th>Hinge</th></tr>
        </thead>
        <tbody>
          {wi.facets.map((f, i) => (
            <tr class="facet" key={i}>
              <td>{i + 1}</td>
              <td>
                {wi.facets.length === 1 ? (
                  <span class="num">{fmtLen(f.width)}</span>
                ) : (
                  <NumberField ariaLabel={`Facet ${i + 1} width`} value={f.width} width={58} onCommit={(v) => setWidth(i, v)} />
                )}
              </td>
              <td>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={0.5}
                  value={f.tilt}
                  aria-label={`Facet ${i + 1} tilt`}
                  onInput={(e) => setFacet(i, { tilt: Number((e.target as HTMLInputElement).value) })}
                />
                <NumberField
                  ariaLabel={`Facet ${i + 1} tilt degrees`}
                  kind="plain"
                  suffix="°"
                  min={0}
                  max={20}
                  width={46}
                  value={f.tilt}
                  onCommit={(v) => setFacet(i, { tilt: Math.round(v * 10) / 10 })}
                />
              </td>
              <td>
                <select aria-label={`Facet ${i + 1} hinge`} value={f.hinge} onChange={(e) => setFacet(i, { hinge: (e.target as HTMLSelectElement).value as Facet['hinge'] })}>
                  <option value="min">{lo}</option>
                  <option value="max">{hi}</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && err.wall === w && <p class="err" role="alert">Neighbour would be under 10 mm.</p>}
      <p class={`hint num ${Math.abs(off) > 0.05 ? 'warn' : ''}`}>
        {Math.abs(off) > 0.05
          ? `Widths add up to ${fmtLen(len + off)}, wall is ${fmtLen(len)}.`
          : `Widths add up to ${fmtLen(len)} inner ${AXIS_NAME[wi.splitAxis].toLowerCase()}.`}
      </p>
    </>
  )
}

function WallEditor({ d, w }: { d: Design; w: WallId }) {
  const wi = d.interior[w]
  const planeAxes = wallPlaneAxes(w)
  const sheets = library.value.materials.filter((m) => m.kind === 'sheet')
  const set = (fn: (x: NonNullable<Design['interior'][WallId]>) => void) => editWall((x) => void fn(ensureInterior(x, w, library.value)))
  return (
    <>
      <h3>{cap(w)} wall, inner face</h3>
      <div class="row">
        <span class="rl">Split along</span>
        <Seg
          label="Split along"
          value={wi?.splitAxis ?? ('' as Axis)}
          options={planeAxes.map((a) => [a, AXIS_NAME[a]] as [Axis, string])}
          onPick={(a) => {
            widthErr.value = null
            editWall((x) => setSplitAxis(x, w, a, library.value))
          }}
        />
      </div>
      <div class="row">
        <span class="rl">Facets</span>
        <div class="stepper">
          <button type="button" aria-label="Fewer facets" disabled={!wi || wi.facets.length <= 1} onClick={() => editWall((x) => setFacetCount(x, w, wi!.facets.length - 1, library.value))}>−</button>
          <span class="num" aria-live="polite">{wi?.facets.length ?? 0}</span>
          <button type="button" aria-label="More facets" disabled={!!wi && wi.facets.length >= MAX_FACETS} onClick={() => editWall((x) => setFacetCount(x, w, (wi?.facets.length ?? 0) + 1, library.value))}>+</button>
        </div>
        <button type="button" class="btn small" disabled={!wi || wi.facets.length < 2} onClick={() => editWall((x) => splitWallEvenly(x, w))}>Split evenly</button>
        <button type="button" class="btn small" disabled={!wi} onClick={() => editWall((x) => void delete x.interior[w])}>Remove facets</button>
      </div>
      {!wi && <p class="hint">This wall is flat. Add a facet to tilt part of it inward.</p>}
      {wi && (
        <>
          <FacetTable d={d} w={w} />
          <p class="hint">Tilt turns the facet inward about its hinge edge. Outer shell stays square.</p>
          <div class="row">
            <span class="rl">Panel</span>
            <select aria-label="Facet panel material" value={wi.panelMaterialId} onChange={(e) => set((x) => (x.panelMaterialId = (e.target as HTMLSelectElement).value))}>
              {sheets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              {!sheets.some((m) => m.id === wi.panelMaterialId) && <option value={wi.panelMaterialId}>Missing material</option>}
            </select>
            <NumberField ariaLabel="Facet panel thickness" value={wi.panelThickness} onCommit={(v) => set((x) => (x.panelThickness = v))} />
          </div>
          <div class="row">
            <span class="rl">Closure</span>
            <Seg label="Closure" value={wi.closure} options={[['fillers', 'Filler strips'], ['sealant', 'Sealant']]} onPick={(v) => set((x) => (x.closure = v))} />
          </div>
          <div class="row">
            <span class="rl">Behind</span>
            <Seg label="Behind facets" value={wi.behind} options={[['insulation', 'Insulation'], ['empty', 'Empty']]} onPick={(v) => set((x) => (x.behind = v))} />
          </div>
        </>
      )}
    </>
  )
}

/** Name of the two axes of a panel's plane, in x,y,z order. */
const planeOf = (normal: Axis): [Axis, Axis] => AXES.filter((a) => a !== normal) as [Axis, Axis]

const newLayer = () => ({
  kind: 'layer' as const,
  materialId: materialOrFirst(library.value, DEFAULT_PANEL_LAYER.materialId, ['sheet']),
  thickness: DEFAULT_PANEL_LAYER.thickness,
})
const newInsulation = () => ({
  materialId: materialOrFirst(library.value, DEFAULT_INSULATION.materialId, ['fill']),
  thickness: DEFAULT_INSULATION.thickness,
})

function newPanel(d: Design): InnerPanel {
  const inner = resolveDims(d).inner
  return {
    id: newId(), normal: 'x', position: round1(inner.x / 2), u0: 0, u1: inner.y, v0: 0, v1: inner.z,
    layers: [newLayer()], insulation: null,
  }
}

function PanelCard({ p, n }: { p: InnerPanel; n: number }) {
  const lib = library.value
  const edit = (fn: (x: InnerPanel) => void) => update((d) => void fn(d.panels.find((q) => q.id === p.id)!))
  const [u, v] = planeOf(p.normal)
  const fills = lib.materials.filter((m) => m.kind === 'fill')
  const layerMats = lib.materials.filter((m) => m.kind !== 'fill')
  const rows = useRowIds(p.layers.length)
  return (
    <div class="card">
      <div class="cardhead">
        <b class="grow">Panel {n}</b>
        <button type="button" class="btn small" aria-label={`Remove panel ${n}`} onClick={() => update((d) => {
          d.panels = d.panels.filter((q) => q.id !== p.id)
          d.treatments = d.treatments.filter((t) => !('panelId' in t.surface) || t.surface.panelId !== p.id)
        })}>Remove</button>
      </div>
      <div class="row">
        <span class="rl">Across</span>
        <select aria-label={`Panel ${n} direction`} value={p.normal} onChange={(e) => update((d) => {
          const q = d.panels.find((z) => z.id === p.id)!
          const inner = resolveDims(d).inner
          q.normal = (e.target as HTMLSelectElement).value as Axis
          const [a, b] = planeOf(q.normal)
          q.u0 = 0; q.u1 = inner[a]; q.v0 = 0; q.v1 = inner[b]
          q.position = round1(inner[q.normal] / 2)
        })}>
          {AXES.map((a) => <option key={a} value={a}>{AXIS_NAME[a]}</option>)}
        </select>
        <NumberField label="At" ariaLabel={`Panel ${n} position`} value={p.position} min={-1e9} allowZero onCommit={(val) => edit((q) => (q.position = val))} />
      </div>
      <div class="row">
        <NumberField label={`${AXIS_NAME[u]} from`} value={p.u0} min={-1e9} allowZero onCommit={(val) => edit((q) => (q.u0 = val))} />
        <NumberField label="to" value={p.u1} min={-1e9} allowZero onCommit={(val) => edit((q) => (q.u1 = val))} />
      </div>
      <div class="row">
        <NumberField label={`${AXIS_NAME[v]} from`} value={p.v0} min={-1e9} allowZero onCommit={(val) => edit((q) => (q.v0 = val))} />
        <NumberField label="to" value={p.v1} min={-1e9} allowZero onCommit={(val) => edit((q) => (q.v1 = val))} />
      </div>
      {p.layers.map((l, i) => (
        <div class="row" key={rows.ids[i]}>
          <select aria-label={`Panel ${n} layer ${i + 1} material`} value={l.materialId} onChange={(e) => edit((q) => (q.layers[i].materialId = (e.target as HTMLSelectElement).value))}>
            {layerMats.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            {!layerMats.some((m) => m.id === l.materialId) && <option value={l.materialId}>Missing material</option>}
          </select>
          <NumberField ariaLabel={`Panel ${n} layer ${i + 1} thickness`} value={l.thickness} onCommit={(val) => edit((q) => (q.layers[i].thickness = val))} />
          <button type="button" class="btn small" aria-label={`Remove panel ${n} layer ${i + 1}`} disabled={removeLayer(p.layers, i) === p.layers} onClick={() => { rows.removed(i); edit((q) => void q.layers.splice(i, 1)) }}>Remove</button>
        </div>
      ))}
      <div class="row">
        <button type="button" class="btn small" onClick={() => { rows.inserted(p.layers.length); edit((q) => void (q.layers = addLayer(q.layers, lib).filter((x): x is Layer => x.kind === 'layer'))) }}>Add layer</button>
        <label class="field">
          <input type="checkbox" checked={!!p.insulation} onChange={(e) => edit((q) => (q.insulation = (e.target as HTMLInputElement).checked ? newInsulation() : null))} />
          Insulation
        </label>
      </div>
      {p.insulation && (
        <div class="row">
          <select aria-label={`Panel ${n} insulation material`} value={p.insulation.materialId} onChange={(e) => edit((q) => (q.insulation!.materialId = (e.target as HTMLSelectElement).value))}>
            {fills.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            {!fills.some((m) => m.id === p.insulation!.materialId) && <option value={p.insulation.materialId}>Missing material</option>}
          </select>
          <NumberField ariaLabel={`Panel ${n} insulation thickness`} value={p.insulation.thickness} onCommit={(val) => edit((q) => (q.insulation!.thickness = val))} />
        </div>
      )}
    </div>
  )
}

const surfaceKey = (s: SurfaceRef): string => ('wall' in s ? `wall:${s.wall}` : `panel:${s.panelId}:${s.side}`)
function parseSurface(key: string): SurfaceRef {
  const [kind, a, b] = key.split(':')
  return kind === 'wall' ? { wall: a as WallId } : { panelId: a, side: b as 'neg' | 'pos' }
}

function TreatmentRow({ t, d }: { t: Treatment; d: Design }) {
  const mats = library.value.materials
  const edit = (fn: (x: Treatment) => void) => update((x) => void fn(x.treatments.find((q) => q.id === t.id)!))
  return (
    <div class="row">
      <select aria-label="Treated surface" value={surfaceKey(t.surface)} onChange={(e) => edit((x) => (x.surface = parseSurface((e.target as HTMLSelectElement).value)))}>
        {WALLS.map((w) => <option key={w} value={`wall:${w}`}>{cap(w)} wall</option>)}
        {d.panels.flatMap((p, i) => (['neg', 'pos'] as const).map((side) => (
          <option key={`${p.id}${side}`} value={`panel:${p.id}:${side}`}>Panel {i + 1}, {side === 'neg' ? 'low' : 'high'} side</option>
        )))}
      </select>
      <select aria-label="Treatment material" value={t.materialId} onChange={(e) => edit((x) => (x.materialId = (e.target as HTMLSelectElement).value))}>
        {mats.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        {!mats.some((m) => m.id === t.materialId) && <option value={t.materialId}>Missing material</option>}
      </select>
      <NumberField ariaLabel="Treatment thickness" value={t.thickness} onCommit={(v) => edit((x) => (x.thickness = v))} />
      <button type="button" class="btn small" aria-label="Remove treatment" onClick={() => update((x) => void (x.treatments = x.treatments.filter((q) => q.id !== t.id)))}>Remove</button>
    </div>
  )
}

function Readout({ d }: { d: Design }) {
  const free = resolveDims(d).free
  const fits = cabFit(d)
  const corners = cornerFlags(d)
  const warnings = [...inactiveFacetWarnings(d), ...inactiveTreatmentWarnings(d)]
  return (
    <div class="readout">
      <div class="row">
        {fits.map((f) => (
          <span key={f.cabId} class={`badge-fit ${f.fits ? 'ok' : 'no'}`}>
            {d.cabs.find((c) => c.id === f.cabId)?.name}: {f.fits ? 'fits' : 'does not fit'}
          </span>
        ))}
      </div>
      <p class="hint num">Free space {fmtLen(free.x)} wide, {fmtLen(free.y)} high, {fmtLen(free.z)} deep.</p>
      {corners.map((c) => (
        <p class="hint" key={c.walls.join()}>
          The {c.walls[0]} and {c.walls[1]} walls both tilt, so their shared corner needs a mitred or filled seam.
        </p>
      ))}
      {warnings.map((m) => <p class="warn" role="alert" key={m}>{m}</p>)}
    </div>
  )
}

export function InteriorStep() {
  const d = design.value
  const w = currentWall(d)
  const door = doorWall(d)
  const pick = (x: WallId) => {
    if (x !== door) {
      picked.value = x
      widthErr.value = null
    }
  }
  const free = resolveDims(d).free
  const cmp = compareDesign.value
  const mode = showFront.value
  const single = mode !== 'both' && mode !== 'planfront'
  const viewOf = (v: 'plan' | 'front' | 'side', label: string) => (
    <div class="view" key={v}>
      <span class="lbl">{label}</span>
      <SectionView design={d} view={v} highlight={w} compare={cmp} exaggerate={exaggerate.value} onSelectWall={pick} />
    </div>
  )
  return (
    <>
      <aside class="interiorside">
        <h3>Pick a wall</h3>
        <WallNet d={d} sel={w} onPick={pick} />
        <p class="hint">Numbers show facets per wall. Click a wall here or in the views.</p>
        <WallEditor d={d} w={w} />
        <Readout d={d} />

        <details>
          <summary>Extra inner panels <span class="unit">{d.panels.length} added</span></summary>
          {d.panels.map((p, i) => <PanelCard key={p.id} p={p} n={i + 1} />)}
          <button type="button" class="btn small" onClick={() => update((x) => void x.panels.push(newPanel(x)))}>+ Add panel</button>
        </details>
        <details>
          <summary>Acoustic materials <span class="unit">{d.treatments.length} surfaces treated</span></summary>
          {d.treatments.map((t) => <TreatmentRow key={t.id} t={t} d={d} />)}
          <button type="button" class="btn small" onClick={() => update((x) => void x.treatments.push({ id: newId(), surface: { wall: 'back' }, materialId: materialOrFirst(library.value, DEFAULT_INSULATION.materialId, ['fill']), thickness: DEFAULT_INSULATION.thickness }))}>+ Treat a surface</button>
        </details>
      </aside>
      <section class="stage interiorstage">
        <div class="viewbar">
          <Seg
            label="Views"
            value={mode}
            options={[['both', 'Plan + 3D'], ['planfront', 'Plan + front'], ['plan', 'Plan'], ['front', 'Front'], ['side', 'Side'], ['3d', '3D']]}
            onPick={(v) => (showFront.value = v)}
          />
          <label class="ctl">
            <input type="checkbox" checked={exaggerate.value} onChange={(e) => (exaggerate.value = (e.target as HTMLInputElement).checked)} />
            Exaggerate depth ×2.4
          </label>
          <div class="sp" />
          <span class="ctl num">Inner free space at narrowest: <b>{fmtLen(Math.min(free.x, free.y, free.z))}</b></span>
        </div>
        <div class="views" style={single ? { gridTemplateColumns: '1fr' } : undefined}>
          {mode === 'both' && (
            <>
              {viewOf('plan', 'Plan section, cut at mid-height')}
              <View3DPanel design={d} highlight={w} />
            </>
          )}
          {mode === 'planfront' && (
            <>
              {viewOf('plan', 'Plan section, cut at mid-height')}
              {viewOf('front', 'Front section')}
            </>
          )}
          {mode === '3d' && <View3DPanel design={d} highlight={w} />}
          {mode === 'plan' && viewOf('plan', 'Plan section, cut at mid-height')}
          {mode === 'front' && viewOf('front', 'Front section')}
          {mode === 'side' && viewOf('side', 'Side section')}
        </div>
      </section>
    </>
  )
}
