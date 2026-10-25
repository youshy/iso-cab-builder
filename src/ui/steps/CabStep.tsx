import { resolveDims } from '../../geometry/dimensions'
import { cabFit } from '../../geometry/space'
import { newCab } from '../../model/defaults'
import { applyCabEdit, matchPreset, presetSpeakers, SPEAKER_PRESETS } from '../../model/presets'
import type { Cab, Design, Vec3 } from '../../model/schema'
import { compareDesign, design, fmtLen, setDimMode, setInnerSource, update } from '../../model/store'
import { NumberField } from '../NumberField'
import { Seg } from '../Seg'
import { SectionView } from '../views/SectionView'

const AXES: { key: keyof Vec3; label: string }[] = [
  { key: 'x', label: 'Width' },
  { key: 'y', label: 'Height' },
  { key: 'z', label: 'Depth' },
]

/** Change a cab; a preset speaker layout follows the cab's new size. */
function editCab(id: string, fn: (c: Cab) => void) {
  update((d) => {
    const c = d.cabs.find((x) => x.id === id)
    if (!c) return
    applyCabEdit(c, fn)
  })
}

function removeCab(id: string) {
  update((d) => {
    if (d.cabs.length < 2) return
    d.cabs = d.cabs.filter((c) => c.id !== id)
    if (d.dims.sizingCabId === id) d.dims.sizingCabId = d.cabs[0].id
    if (d.sim.cabId === id) d.sim.cabId = d.cabs[0].id
  })
}

function shortText(shortBy: Vec3): string {
  const parts = AXES.filter((a) => shortBy[a.key] > 0).map((a) => `${fmtLen(shortBy[a.key])} ${a.label.toLowerCase()}`)
  return parts.join(', ')
}

function CabCard({ cab, fits, many }: { cab: Cab; fits: boolean; many: boolean }) {
  const preset = matchPreset(cab)
  return (
    <div class="card">
      <div class="cardhead">
        <input
          class="name"
          aria-label="Cab name"
          value={cab.name}
          onChange={(e) => editCab(cab.id, (c) => (c.name = (e.target as HTMLInputElement).value))}
        />
        <span class={`badge-fit ${fits ? 'ok' : 'no'}`}>{fits ? 'Fits' : 'Does not fit'}</span>
        <button type="button" class="btn" disabled={!many} onClick={() => removeCab(cab.id)} aria-label={`Remove ${cab.name}`}>
          Remove
        </button>
      </div>
      <div class="row">
        <NumberField label="W" value={cab.w} onCommit={(v) => editCab(cab.id, (c) => (c.w = v))} />
        <NumberField label="H" value={cab.h} onCommit={(v) => editCab(cab.id, (c) => (c.h = v))} />
        <NumberField label="D" value={cab.d} onCommit={(v) => editCab(cab.id, (c) => (c.d = v))} />
      </div>
      <div class="row">
        <label class="rl" for={`layout-${cab.id}`}>Speakers</label>
        <select
          id={`layout-${cab.id}`}
          value={preset?.id ?? 'custom'}
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value
            const p = SPEAKER_PRESETS.find((x) => x.id === id)
            if (p) editCab(cab.id, (c) => (c.speakers = presetSpeakers(p, c)))
          }}
        >
          {SPEAKER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          {!preset && <option value="custom">Custom</option>}
        </select>
      </div>
      <details>
        <summary>Speaker positions</summary>
        <table>
          <thead>
            <tr><th>#</th><th>X from left</th><th>Y from bottom</th><th /></tr>
          </thead>
          <tbody>
            {cab.speakers.map((s, i) => (
              <tr key={i}>
                <td class="num">{i + 1}</td>
                <td>
                  <NumberField value={s.x} min={-1e9} allowZero onCommit={(v) => update((d) => void (d.cabs.find((c) => c.id === cab.id)!.speakers[i].x = v))} />
                </td>
                <td>
                  <NumberField value={s.y} min={-1e9} allowZero onCommit={(v) => update((d) => void (d.cabs.find((c) => c.id === cab.id)!.speakers[i].y = v))} />
                </td>
                <td>
                  <button type="button" class="btn" aria-label={`Remove speaker ${i + 1}`} onClick={() => update((d) => void d.cabs.find((c) => c.id === cab.id)!.speakers.splice(i, 1))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          class="btn"
          style="margin-top:6px"
          onClick={() => update((d) => void d.cabs.find((c) => c.id === cab.id)!.speakers.push({ x: cab.w / 2, y: cab.h / 2 }))}
        >
          + Add speaker
        </button>
      </details>
      <div class="row">
        <label class="rl" for={`back-${cab.id}`}>Back</label>
        <select
          id={`back-${cab.id}`}
          value={cab.back}
          onChange={(e) => editCab(cab.id, (c) => (c.back = (e.target as HTMLSelectElement).value as Cab['back']))}
        >
          <option value="closed">Closed</option>
          <option value="open">Open</option>
        </select>
      </div>
    </div>
  )
}

function SizeTable({ d }: { d: Design }) {
  const r = resolveDims(d)
  const innerEditable = d.dims.mode === 'inside' && d.dims.innerSource === 'manual'
  const outerEditable = d.dims.mode === 'outside'
  const cell = (v: number, editable: boolean, onCommit: (n: number) => void, label: string) =>
    editable ? <NumberField ariaLabel={label} value={v} onCommit={onCommit} /> : <span class="num">{fmtLen(v)}</span>
  return (
    <table>
      <thead>
        <tr><th /><th>Width</th><th>Height</th><th>Depth</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Inner</td>
          {AXES.map((a) => (
            <td key={a.key}>{cell(r.inner[a.key], innerEditable, (v) => update((x) => void (x.dims.inner[a.key] = v)), `Inner ${a.label.toLowerCase()}`)}</td>
          ))}
        </tr>
        <tr>
          <td>Outer</td>
          {AXES.map((a) => (
            <td key={a.key}>{cell(r.outer[a.key], outerEditable, (v) => update((x) => void (x.dims.outer[a.key] = v)), `Outer ${a.label.toLowerCase()}`)}</td>
          ))}
        </tr>
        <tr>
          <td>Free</td>
          {AXES.map((a) => (
            <td key={a.key} class="num">{fmtLen(r.free[a.key])}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

export function CabStep() {
  const d = design.value
  const fits = cabFit(d)
  const misfits = fits.filter((f) => !f.fits)
  const { dims } = d
  return (
    <>
      <aside>
        <h3>Cabs</h3>
        {d.cabs.map((cab) => (
          <CabCard key={cab.id} cab={cab} fits={fits.find((f) => f.cabId === cab.id)?.fits ?? true} many={d.cabs.length > 1} />
        ))}
        <button
          type="button"
          class="btn"
          onClick={() => update((x) => void x.cabs.push(newCab({ name: `Cab ${x.cabs.length + 1}` })))}
        >
          + Add cab
        </button>

        <h3>Box size</h3>
        <div class="row">
          <span class="rl">Driven by</span>
          <Seg
            label="Driving side"
            value={dims.mode}
            options={[['inside', 'Inside out'], ['outside', 'Outside in']]}
            onPick={(m) => update((x) => setDimMode(x, m))}
          />
        </div>
        {dims.mode === 'inside' && (
          <>
            <div class="row">
              <span class="rl">Inner size</span>
              <Seg
                label="Inner size source"
                value={dims.innerSource}
                options={[['cab', 'From cab'], ['manual', 'Manual']]}
                onPick={(s) => update((x) => setInnerSource(x, s))}
              />
            </div>
            {dims.innerSource === 'cab' && (
              <div class="row">
                <label class="rl" for="sizing-cab">Sizing cab</label>
                <select
                  id="sizing-cab"
                  value={dims.sizingCabId}
                  onChange={(e) => update((x) => void (x.dims.sizingCabId = (e.target as HTMLSelectElement).value))}
                >
                  {d.cabs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
        <div class="row">
          <span class="rl">Clearance</span>
          <NumberField ariaLabel="Clearance" value={dims.clearance} min={0} allowZero onCommit={(v) => update((x) => void (x.dims.clearance = v))} />
        </div>
        <SizeTable d={d} />
        <p class="hint">
          {dims.mode === 'outside'
            ? 'Outer box is typed; inner and free space follow.'
            : dims.innerSource === 'cab'
              ? 'Inner box is the sizing cab plus clearance.'
              : 'Inner box is typed; outer follows the wall stacks.'}{' '}
          Free space is the inner box minus facets.
        </p>
        {misfits.map((f) => {
          const cab = d.cabs.find((c) => c.id === f.cabId)!
          return (
            <p class="warn" role="alert" key={f.cabId}>
              {cab.name} does not fit: short by {shortText(f.shortBy)}.
            </p>
          )
        })}
      </aside>
      <section class="stage">
        <div class="views">
          <div class="view">
            <span class="lbl">Plan section, cut at mid-height</span>
            <SectionView design={d} view="plan" compare={compareDesign.value} />
          </div>
          <div class="view">
            <span class="lbl">Front section</span>
            <SectionView design={d} view="front" compare={compareDesign.value} />
          </div>
        </div>
      </section>
    </>
  )
}
