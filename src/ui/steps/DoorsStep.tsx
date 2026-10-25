import { signal } from '@preact/signals'
import { doorLayout, doorLeafLayers, type DoorLayout, type LeafLayout, type WallDoorLayout } from '../../doors/doors'
import { inactiveFacetWarnings } from '../../geometry/space'
import type { Design, DoorLeaf, DoorSide, Layer, StackItem } from '../../model/schema'
import { addLayer, moveLayer, removeLayer, setLayerMaterial } from '../../model/stack'
import { HEAVY_WALL_KG } from '../../model/defaults'
import { design, fmtLen, library, update } from '../../model/store'
import { NumberField } from '../NumberField'
import { useRowIds } from '../useRowIds'
import { Seg } from '../Seg'
import { SectionView } from '../views/SectionView'
import { View3DPanel } from '../views/View3D'

type Which = 'outer' | 'inner'

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const TITLE: Record<Which, string> = { outer: 'Outer door', inner: 'Inner door' }
const showViews = signal<'both' | 'plan' | 'front' | 'side' | '3d'>('both')
const exaggerate = signal(false)

const asLayers = (s: StackItem[]): Layer[] => s.filter((i): i is Layer => i.kind === 'layer')
const sizeText = (w: number, h: number) => `${fmtLen(w)} × ${fmtLen(h)}`

function LeafStack({ which, leaf }: { which: Which; leaf: DoorLeaf }) {
  const lib = library.value
  const layers = leaf.stack
  const edit = (fn: (s: Layer[]) => Layer[]) =>
    update((d) => void (d.door[which].stack = fn(d.door[which].stack ?? [])))
  const name = TITLE[which].toLowerCase()
  const rows = useRowIds(layers?.length ?? 0)
  /** Apply a guarded edit; row ids follow only when the edit was accepted. */
  const run = (next: StackItem[], track: () => void) => {
    if (!layers || next === layers) return
    track()
    edit(() => asLayers(next))
  }
  const mats = lib.materials.filter((m) => m.kind !== 'fill')
  return (
    <>
      <div class="row">
        <span class="rl">Layers</span>
        <Seg
          label={`${TITLE[which]} layers`}
          value={layers ? 'custom' : 'wall'}
          options={[['wall', 'Match wall'], ['custom', 'Custom']]}
          onPick={(v) =>
            update((d) => void (d.door[which].stack = v === 'wall' ? null : structuredClone(doorLeafLayers(d)[which])))}
        />
      </div>
      {layers && (
        <div>
          {layers.map((l, i) => (
            <div class="srow" key={rows.ids[i]}>
              <div class="main-cell">
                <select
                  aria-label={`${TITLE[which]} layer ${i + 1} material`}
                  value={l.materialId}
                  onChange={(e) => edit((s) => asLayers(setLayerMaterial(s, i, (e.target as HTMLSelectElement).value, lib)))}
                >
                  {mats.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  {!mats.some((m) => m.id === l.materialId) && <option value={l.materialId}>Missing material</option>}
                </select>
                <NumberField ariaLabel={`${TITLE[which]} layer ${i + 1} thickness`} value={l.thickness} onCommit={(v) => edit((s) => s.map((x, k) => (k === i ? { ...x, thickness: v } : x)))} />
              </div>
              <button type="button" class="btn iconbtn" aria-label={`Move ${name} layer ${i + 1} outward`} disabled={moveLayer(layers, i, -1) === layers} onClick={() => run(moveLayer(layers, i, -1), () => rows.swapped(i, i - 1))}>Up</button>
              <button type="button" class="btn iconbtn" aria-label={`Move ${name} layer ${i + 1} inward`} disabled={moveLayer(layers, i, 1) === layers} onClick={() => run(moveLayer(layers, i, 1), () => rows.swapped(i, i + 1))}>Down</button>
              <button type="button" class="btn iconbtn" aria-label={`Remove ${name} layer ${i + 1}`} disabled={removeLayer(layers, i) === layers} onClick={() => run(removeLayer(layers, i), () => rows.removed(i))}>Remove</button>
            </div>
          ))}
          <div class="row">
            <button type="button" class="btn small" onClick={() => run(addLayer(layers, lib), () => rows.inserted(layers.length))}>Add layer</button>
            <span class="hint num">Total {fmtLen(layers.reduce((a, l) => a + l.thickness, 0))}, outside first</span>
          </div>
        </div>
      )}
    </>
  )
}

function LeafPanel({ which, leaf }: { which: Which; leaf: DoorLeaf }) {
  const lib = library.value
  const set = (fn: (l: DoorLeaf) => void) => update((d) => void fn(d.door[which]))
  const title = TITLE[which]
  const opt = <T extends { id: string; name: string }>(items: T[], id: string) => (
    <>
      {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      {!items.some((x) => x.id === id) && <option value={id}>Missing item</option>}
    </>
  )
  return (
    <div class="card">
      <h4>{title}</h4>
      <div class="row">
        <span class="rl">Opens</span>
        <Seg label={`${title} opening`} value={leaf.opening} options={[['in', 'In'], ['out', 'Out'], ['split', 'Split']]} onPick={(v) => set((l) => (l.opening = v))} />
      </div>
      <div class="row">
        <span class="rl">Frame</span>
        <Seg label={`${title} frame`} value={leaf.framed ? 'framed' : 'frameless'} options={[['frameless', 'Frameless'], ['framed', 'Framed']]} onPick={(v) => set((l) => (l.framed = v === 'framed'))} />
        {leaf.framed && <NumberField ariaLabel={`${title} frame width`} value={leaf.frameWidth} onCommit={(v) => set((l) => (l.frameWidth = v))} />}
      </div>
      <div class="row">
        <span class="rl">Hinge edge</span>
        <select aria-label={`${title} hinge edge`} value={leaf.hingeEdge} onChange={(e) => set((l) => (l.hingeEdge = (e.target as HTMLSelectElement).value as DoorLeaf['hingeEdge']))}>
          {(['left', 'right', 'top', 'bottom'] as const).map((x) => <option key={x} value={x}>{cap(x)}</option>)}
        </select>
      </div>
      <div class="row">
        <span class="rl">Hinge</span>
        <select aria-label={`${title} hinge type`} value={leaf.hingeTypeId} onChange={(e) => set((l) => (l.hingeTypeId = (e.target as HTMLSelectElement).value))}>{opt(lib.hinges, leaf.hingeTypeId)}</select>
      </div>
      <div class="row">
        <span class="rl">Seal</span>
        <select aria-label={`${title} seal type`} value={leaf.sealTypeId} onChange={(e) => set((l) => (l.sealTypeId = (e.target as HTMLSelectElement).value))}>{opt(lib.seals, leaf.sealTypeId)}</select>
      </div>
      <div class="row">
        <span class="rl">Latch</span>
        <select aria-label={`${title} latch type`} value={leaf.latchTypeId} onChange={(e) => set((l) => (l.latchTypeId = (e.target as HTMLSelectElement).value))}>{opt(lib.latches, leaf.latchTypeId)}</select>
        <div class="stepper">
          <button type="button" aria-label={`Fewer ${title.toLowerCase()} latches`} disabled={leaf.latchCount <= 0} onClick={() => set((l) => (l.latchCount -= 1))}>−</button>
          <span class="num" aria-live="polite">{leaf.latchCount}</span>
          <button type="button" aria-label={`More ${title.toLowerCase()} latches`} onClick={() => set((l) => (l.latchCount += 1))}>+</button>
        </div>
      </div>
      <LeafStack key={which} which={which} leaf={leaf} />
    </div>
  )
}

/** Wall door settings reuse the outer leaf's hinge and latch config. */
function WallPanel({ leaf, mass }: { leaf: DoorLeaf; mass: number }) {
  const lib = library.value
  const set = (fn: (l: DoorLeaf) => void) => update((d) => void fn(d.door.outer))
  const hingeKind = lib.hinges.find((h) => h.id === leaf.hingeTypeId)?.kind
  const opt = <T extends { id: string; name: string }>(items: T[], id: string) => (
    <>
      {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      {!items.some((x) => x.id === id) && <option value={id}>Missing item</option>}
    </>
  )
  return (
    <div class="card">
      <h4>Wall door</h4>
      <div class="row">
        <span class="rl">Hinge edge</span>
        <select aria-label="Wall door hinge edge" value={leaf.hingeEdge} onChange={(e) => set((l) => (l.hingeEdge = (e.target as HTMLSelectElement).value as DoorLeaf['hingeEdge']))}>
          {(['left', 'right', 'top', 'bottom'] as const).map((x) => <option key={x} value={x}>{cap(x)}</option>)}
        </select>
      </div>
      <div class="row">
        <span class="rl">Hinge</span>
        <select aria-label="Wall door hinge type" value={leaf.hingeTypeId} onChange={(e) => set((l) => (l.hingeTypeId = (e.target as HTMLSelectElement).value))}>{opt(lib.hinges, leaf.hingeTypeId)}</select>
      </div>
      {mass > HEAVY_WALL_KG && hingeKind === 'butt' && (
        <p class="hint">Suggested for a heavy wall: lift-off hinges</p>
      )}
      <div class="row">
        <span class="rl">Latch</span>
        <select aria-label="Wall door latch type" value={leaf.latchTypeId} onChange={(e) => set((l) => (l.latchTypeId = (e.target as HTMLSelectElement).value))}>{opt(lib.latches, leaf.latchTypeId)}</select>
        <div class="stepper">
          <button type="button" aria-label="Fewer wall door latches" disabled={leaf.latchCount <= 0} onClick={() => set((l) => (l.latchCount -= 1))}>−</button>
          <span class="num" aria-live="polite">{leaf.latchCount}</span>
          <button type="button" aria-label="More wall door latches" onClick={() => set((l) => (l.latchCount += 1))}>+</button>
        </div>
      </div>
    </div>
  )
}

function WallResults({ w }: { w: WallDoorLayout }) {
  return (
    <>
      <h4>Wall door</h4>
      <ul class="results num">
        <li><span class="k">Panel</span>{sizeText(w.panel.w, w.panel.h)}, {fmtLen(w.panel.t)} thick</li>
        <li><span class="k">Weight</span>{w.massKg.toFixed(1)} kg</li>
        <li><span class="k">Hinges, {w.hingeEdge}</span>{w.hinges.map(fmtLen).join(', ')}</li>
        <li><span class="k">Latches</span>{w.latches.length ? w.latches.map(fmtLen).join(', ') : 'none'}</li>
        {w.seals.map((s) => (
          <li key={s.line}><span class="k">Seal line, {s.line}</span>{fmtLen(s.perimeterMm)}</li>
        ))}
        <li><span class="k">Swing radius</span>{fmtLen(w.swingRadius)}</li>
      </ul>
    </>
  )
}

function Results({ d, l }: { d: Design; l: DoorLayout }) {
  if (l.wall) return <WallResults w={l.wall} />
  const leafRows = (x: LeafLayout) => {
    const [first] = x.leaves
    return (
      <>
        <h4>{TITLE[x.which]}</h4>
        <ul class="results num">
          <li><span class="k">Leaf</span>{x.leaves.length === 2 ? '2 × ' : ''}{sizeText(first.w, first.h)}, {fmtLen(first.t)} thick</li>
          {x.pocket && <li><span class="k">Pocket</span>{sizeText(x.pocket.w, x.pocket.h)}</li>}
          <li><span class="k">{x.pocket ? 'Cutout, pocket layers' : 'Cutout'}</span>{sizeText(x.cutout.w, x.cutout.h)}</li>
          <li><span class="k">Clear opening</span>{sizeText(x.opening.w, x.opening.h)}</li>
          {x.frame && <li><span class="k">Frame</span>{fmtLen(x.frame.width)} × {fmtLen(x.frame.depth)} deep</li>}
          {x.rebate && <li><span class="k">Rebate in wall</span>{fmtLen(x.rebate.depth)} deep, {fmtLen(x.rebate.width)} past the opening</li>}
          {x.hinges.map((h) => (
            <li key={h.edge}><span class="k">Hinges, {h.edge}</span>{h.positions.map(fmtLen).join(', ')}</li>
          ))}
          <li><span class="k">Latches</span>{x.latches.length ? x.latches.map(fmtLen).join(', ') : 'none'}</li>
        </ul>
      </>
    )
  }
  return (
    <>
      {l.outer && leafRows(l.outer)}
      {l.inner && leafRows(l.inner)}
      <h4>Between the doors</h4>
      <ul class="results num">
        <li><span class="k">Depth</span>{fmtLen(l.betweenDepth)}</li>
        <li>
          <span class="k">Cabs through</span>
          {l.cabsThrough.map((c) => (
            <span key={c.cabId} class={`badge-fit ${c.fits ? 'ok' : 'no'}`} style={{ marginRight: '6px' }}>
              {d.cabs.find((x) => x.id === c.cabId)?.name}: {c.fits ? 'fits' : 'does not fit'}
            </span>
          ))}
        </li>
      </ul>
    </>
  )
}

export function DoorsStep() {
  const d = design.value
  const l = doorLayout(d, library.value)
  const warnings = inactiveFacetWarnings(d)
  const mode = showViews.value
  const single = mode !== 'both'
  const viewOf = (v: 'plan' | 'front' | 'side', label: string) => (
    <div class="view" key={v}>
      <span class="lbl">{label}</span>
      <SectionView design={d} lib={library.value} view={v} exaggerate={exaggerate.value} doors={l} />
    </div>
  )
  const sideOptions: [Design['door']['side'], string][] = [
    ['auto', `Auto (${l.side})`], ['front', 'Front'], ['left', 'Left'], ['right', 'Right'],
  ]
  return (
    <>
      <aside class="doorside">
        <h3>Door position</h3>
        <div class="row">
          <span class="rl">Door type</span>
          <Seg
            label="Door type"
            value={d.door.kind}
            options={[['dual', 'Dual doors'], ['wall', 'Whole wall']]}
            onPick={(v) => update((x) => void (x.door.kind = v))}
          />
        </div>
        <div class="row">
          <span class="rl">Side</span>
          <Seg label="Door side" value={d.door.side} options={sideOptions} onPick={(v: DoorSide | 'auto') => update((x) => void (x.door.side = v))} />
        </div>
        {d.door.kind === 'wall' ? (
          <div class="row">
            <NumberField label="Room in front" allowZero value={d.door.roomClearance} min={0} onCommit={(v) => update((x) => void (x.door.roomClearance = v))} />
          </div>
        ) : (
          <>
        <div class="row">
          <span class="rl">Opening</span>
          <Seg
            label="Opening size"
            value={d.door.opening ? 'custom' : 'auto'}
            options={[['auto', 'Auto from cab'], ['custom', 'Custom']]}
            onPick={(v) => update((x) => void (x.door.opening = v === 'auto' ? null : { ...(l.outer?.opening ?? { w: 0, h: 0 }) }))}
          />
        </div>
        {d.door.opening && (
          <div class="row">
            <NumberField label="Width" value={d.door.opening.w} onCommit={(v) => update((x) => void (x.door.opening = { ...x.door.opening!, w: v }))} />
            <NumberField label="Height" value={d.door.opening.h} onCommit={(v) => update((x) => void (x.door.opening = { ...x.door.opening!, h: v }))} />
          </div>
        )}
        <div class="row">
          <NumberField label="Margin" allowZero value={d.door.margin} min={0} onCommit={(v) => update((x) => void (x.door.margin = v))} />
          <NumberField label="Overlap" allowZero value={d.door.overlap} min={0} onCommit={(v) => update((x) => void (x.door.overlap = v))} />
        </div>
        <p class="hint">Margin is clearance around the cab. Overlap is how far each leaf extends past the opening.</p>
        <div class="row">
          <span class="rl">Between</span>
          <Seg label="Between the doors" value={d.door.between} options={[['air', 'Air'], ['insulation', 'Insulation']]} onPick={(v) => update((x) => void (x.door.between = v))} />
        </div>
          </>
        )}
        {warnings.map((m) => <p class="warn" role="alert" key={m}>{m}</p>)}

        <div class="panels">
          {l.wall ? (
            <WallPanel leaf={d.door.outer} mass={l.wall.massKg} />
          ) : (
            <>
              <LeafPanel which="outer" leaf={d.door.outer} />
              <LeafPanel which="inner" leaf={d.door.inner} />
            </>
          )}
        </div>

        <h3>Results</h3>
        <div class="collisions">
          {l.collisions.map((m) => <p class="warn" role="alert" key={m}>{m}</p>)}
          {l.notes.map((m) => <p class="hint" key={m}>{m}</p>)}
        </div>
        <Results d={d} l={l} />
      </aside>
      <section class="stage doorstage">
        <div class="viewbar">
          <Seg
            label="Views"
            value={mode}
            options={[['both', 'Plan + 3D'], ['plan', 'Plan'], ['front', 'Front'], ['side', 'Side'], ['3d', '3D']]}
            onPick={(v) => (showViews.value = v)}
          />
          <label class="ctl">
            <input type="checkbox" checked={exaggerate.value} onChange={(e) => (exaggerate.value = (e.target as HTMLInputElement).checked)} />
            Exaggerate depth ×2.4
          </label>
          <div class="sp" />
          {!l.wall && <span class="ctl num">Between the doors: <b>{fmtLen(l.betweenDepth)}</b></span>}
        </div>
        <div class="views" style={single ? { gridTemplateColumns: '1fr' } : undefined}>
          {mode === 'both' && (
            <>
              {viewOf('plan', 'Plan section, cut at mid-height')}
              <View3DPanel design={d} />
            </>
          )}
          {mode === '3d' && <View3DPanel design={d} />}
          {mode === 'plan' && viewOf('plan', 'Plan section, cut at mid-height')}
          {mode === 'front' && viewOf('front', 'Front section')}
          {mode === 'side' && viewOf('side', 'Side section')}
        </div>
      </section>
    </>
  )
}
