import { useEffect, useRef, useState } from 'preact/hooks'
import { curveFrom, defaultSlices, findSlice, medianDb, modeDelta, nearestAnalytic, strongestModes } from '../../acoustics/compare'
import type { SimResult, SimSlice } from '../../acoustics/fdtd'
import { firstModes } from '../../acoustics/analytic'
import { runSecondsEstimate } from '../../acoustics/client'
import { compareClient, currentClient, customSlice, sliceClient } from '../../acoustics/schedule'
import { resolveDims } from '../../geometry/dimensions'
import type { Axis } from '../../model/schema'
import { basedOn, compareVersion, design, simCompare, simCurrent, sliceRequest, units, update } from '../../model/store'
import { Chart } from '../Chart'
import { NO_MODES, fmtDb } from '../ModeStrip'
import { Seg } from '../Seg'

const PLANES: [Axis, string][] = [['y', 'Plan'], ['z', 'Front'], ['x', 'Side']]
const PLANE_NOTE: Record<Axis, string> = {
  y: 'Horizontal: width, vertical: depth (back at the bottom)',
  z: 'Horizontal: width, vertical: height',
  x: 'Horizontal: height, vertical: depth',
}
const AXIS_WORD: Record<Axis, string> = { x: 'width', y: 'height', z: 'depth' }
const DEFAULT_F = 125
const FLOOR_DB = 24 // the map shows this many dB below its maximum

const resolutionText = (mm: number) => (units.value === 'in' ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`)

/** Greyscale pressure map: darker is louder, the maximum is accent, solid cells stay transparent. */
function Heatmap({ slice }: { slice: SimSlice }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    const { w, h, values } = slice
    cv.width = w
    cv.height = h
    const img = ctx.createImageData(w, h)
    // Accent colour via a 1x1 canvas so any CSS colour syntax works.
    const probe = document.createElement('canvas').getContext('2d')
    probe!.canvas.width = probe!.canvas.height = 1
    probe!.fillStyle = '#c05a1f'
    if (accent) probe!.fillStyle = accent
    probe!.fillRect(0, 0, 1, 1)
    const [ar, ag, ab] = probe!.getImageData(0, 0, 1, 1).data
    for (let v = 0; v < h; v++)
      for (let u = 0; u < w; u++) {
        const val = values[v * w + u]
        const o = ((h - 1 - v) * w + u) * 4 // v grows upward
        if (Number.isNaN(val)) continue
        if (val >= -0.5) { img.data.set([ar, ag, ab, 255], o); continue }
        const g = Math.round(238 - 218 * Math.min(1, Math.max(0, 1 + val / FLOOR_DB)))
        img.data.set([g, g, g, 255], o)
      }
    ctx.putImageData(img, 0, 0)
  }, [slice])
  return <canvas ref={ref} class="slicemap" style={{ aspectRatio: `${slice.w} / ${slice.h}` }} role="img" aria-label="Pressure level map" />
}

function SliceControls({ cur }: { cur: SimResult | null }) {
  const d = design.value
  const inner = resolveDims(d).inner
  const req = sliceRequest.value
  const [draft, setDraft] = useState<number | null>(null)

  // Once a result exists: a plan slice through the middle at the strongest mode (125 Hz when there are none).
  useEffect(() => {
    if (sliceRequest.peek() || !cur) return
    const top = strongestModes(cur, 1)[0]
    sliceRequest.value = { axis: 'y', at: inner.y / 2, f: top ? Math.round(top.f * 10) / 10 : DEFAULT_F }
  }, [cur])
  if (!req) return null

  const at = Math.min(inner[req.axis], Math.max(0, req.at))
  const freqs = [...new Set([req.f, ...defaultSlices(d, d.sim.fMax).map((x) => x.f), ...(cur ? strongestModes(cur, 8).map((m) => Math.round(m.f * 10) / 10) : [])])].sort((a, b) => a - b)
  const set = (patch: Partial<typeof req>) => (sliceRequest.value = { ...req, ...patch })
  return (
    <>
      <div class="row">
        <span class="rl">Plane</span>
        <Seg label="Slice plane" value={req.axis} options={PLANES} onPick={(axis) => set({ axis, at: inner[axis] / 2 })} />
      </div>
      <div class="row">
        <label class="rl" for="slice-at">Position</label>
        <span class="num">{Math.round(draft ?? at)} mm along {AXIS_WORD[req.axis]}</span>
      </div>
      <input
        id="slice-at" type="range" min={0} max={Math.round(inner[req.axis])} step={5} value={draft ?? at}
        onInput={(e) => setDraft(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => { set({ at: Number((e.target as HTMLInputElement).value) }); setDraft(null) }}
      />
      <div class="row">
        <label class="rl" for="slice-f">Frequency</label>
        <select id="slice-f" value={req.f} onChange={(e) => set({ f: Number((e.target as HTMLSelectElement).value) })}>
          {freqs.map((f) => <option key={f} value={f}>{f} Hz</option>)}
        </select>
      </div>
    </>
  )
}

export function AcousticsStep() {
  const d = design.value
  const cur = simCurrent.value
  const cmp = compareVersion.value === null ? null : simCompare.value
  const status = currentClient.status.value
  const fMax = d.sim.fMax
  const [probe, setProbe] = useState(-1) // -1 = average of the cavity
  const probeIndex = probe < d.sim.probes.length ? probe : -1
  const req = sliceRequest.value
  const custom = customSlice.value && req && findSlice([customSlice.value], req) ? customSlice.value : undefined
  const slice = req ? (findSlice(cur?.slices, req) ?? custom) : undefined

  const refDb = cur ? medianDb(cur, fMax) : 0
  const pick = (r: SimResult) => (probeIndex < 0 ? r.avgDb : (r.probesDb[probeIndex] ?? r.avgDb))
  const curCurve = cur ? curveFrom(cur.freqs, pick(cur), refDb, fMax) : null
  const cmpCurve = cur && cmp ? curveFrom(cmp.freqs, pick(cmp), refDb, fMax) : null
  const nameCur = basedOn.value === null ? 'Working copy' : `Working copy (from v${basedOn.value})`
  const modes = cur ? [...strongestModes(cur, 12)].sort((a, b) => a.f - b.f) : []

  return (
    <>
      <aside class="acside">
        <h3>Simulation</h3>
        <div class="row">
          <label class="rl" for="fmax">Top frequency</label>
          <span class="num">{fMax} Hz</span>
        </div>
        <input
          id="fmax" type="range" min={250} max={2000} step={50} value={fMax}
          onChange={(e) => {
            const v = Number((e.target as HTMLInputElement).value)
            if (Number.isFinite(v)) update((x) => void (x.sim.fMax = Math.min(2000, Math.max(250, Math.round(v)))))
          }}
        />
        {fMax >= 1500
          ? <p class="hint">Higher limit: runs take longer (about {runSecondsEstimate(fMax)} s).</p>
          : <p class="hint">Higher is slower: 2000 Hz takes much longer than 1000 Hz.</p>}
        {currentClient.error.value && <p class="warn">Simulation failed: {currentClient.error.value}</p>}
        {cur && <p class="hint num">Smallest change this grid resolves: {resolutionText(cur.resolutionMm)} (grid {resolutionText(cur.dx)})</p>}
        {d.sim.probes.length > 0 && (
          <div class="row">
            <label class="rl" for="probe">Curve</label>
            <select id="probe" value={probeIndex} onChange={(e) => setProbe(Number((e.target as HTMLSelectElement).value))}>
              <option value={-1}>Average of the cavity</option>
              {d.sim.probes.map((_, i) => <option key={i} value={i}>Probe {i + 1}</option>)}
            </select>
          </div>
        )}
        <h3>Pressure map</h3>
        <SliceControls cur={cur} />
        <p class="hint">Levels are an FDTD estimate. The cab is treated as a closed box unless it has an open back.</p>
      </aside>
      <section class="stage acstage">
        <p class="estimate">FDTD estimate, status {status}. Levels are relative: dB re the median of the current run between 100 Hz and {fMax} Hz.</p>
        <h3>Response</h3>
        {curCurve ? (
          <Chart
            x={curCurve.x}
            xLog
            zeroLine
            yLabel="Relative level (dB)"
            series={[
              { label: nameCur, y: curCurve.y },
              ...(cmpCurve ? [{ label: `v${compareVersion.value}`, y: cmpCurve.y, dashed: true }] : []),
            ]}
            markers={modes.slice(0, 5).map((m) => ({ x: m.f, label: 'Mode' }))}
          />
        ) : (
          <p class="hint">Waiting for the first result.</p>
        )}
        {compareVersion.value !== null && !cmp && (
          compareClient.error.value
            ? <p class="warn">Compare failed: {compareClient.error.value}</p>
            : <p class="hint">Simulating v{compareVersion.value} with the same settings.</p>
        )}
        <h3>Modes</h3>
        {!cur ? null : modes.length === 0 ? (
          <p class="hint">{NO_MODES}</p>
        ) : (
          <table class="modetable num">
            <thead>
              <tr>
                <th>Frequency</th><th>Level</th><th>Q</th><th>Axis</th>
                {compareVersion.value !== null && <th>vs v{compareVersion.value}</th>}
                <th>Untilted box</th>
              </tr>
            </thead>
            <tbody>
              {modes.map((m) => {
                const delta = modeDelta(m, cmp)
                const ref = nearestAnalytic(d, m.f, fMax)
                return (
                  <tr key={m.f}>
                    <td>{m.f.toFixed(1)} Hz</td>
                    <td>{fmtDb(m.level - refDb)}</td>
                    <td>{Number.isFinite(m.q) ? m.q.toFixed(1) : 'n/a'}</td>
                    <td>{m.axis ?? 'mixed'}</td>
                    {compareVersion.value !== null && (
                      <td>{!cmp ? '' : delta === null ? 'new' : <span class={delta > 0 ? 'u' : 'd'}>{fmtDb(delta)}</span>}</td>
                    )}
                    <td>{ref ? `${ref.f.toFixed(1)} Hz (${ref.n.join(',')})` : 'none near'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <h4>Reference: rectangular room modes of the empty inner box</h4>
        <table class="modetable num">
          <thead>
            <tr><th>Frequency</th><th>Mode (x,y,z)</th><th>Kind</th></tr>
          </thead>
          <tbody>
            {firstModes(resolveDims(d).inner).map((m) => (
              <tr key={m.n.join(',')}>
                <td>{m.f.toFixed(1)} Hz</td>
                <td>{m.n.join(',')}</td>
                <td>{m.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Pressure at {req ? `${req.f} Hz` : '...'}</h3>
        {slice ? (
          <div class="slicebox">
            <div>
              <Heatmap slice={slice} />
              <p class="hint">{req && PLANE_NOTE[req.axis]}</p>
            </div>
            <div class="slicekey">
              <div><i style={{ background: 'var(--accent)' }} />Maximum</div>
              <div><i style={{ background: 'oklch(0.2 0 0)' }} />Louder</div>
              <div><i style={{ background: 'oklch(0.93 0 0)' }} />Quieter (down to {FLOOR_DB} dB below the maximum)</div>
              <div><i />Hatched: solid</div>
            </div>
          </div>
        ) : (
          req && !findSlice(cur?.slices, req) && sliceClient.error.value
            ? <p class="warn">Map failed: {sliceClient.error.value}</p>
            : <p class="hint">{req ? 'Map updating. A new plane, position or frequency takes one extra run, in the background.' : 'Waiting for the first result.'}</p>
        )}
      </section>
    </>
  )
}
