import { compareClient, currentClient } from '../acoustics/schedule'
import { medianDb, modeDelta, strongestModes } from '../acoustics/compare'
import { basedOn, compareVersion, design, simCompare, simCurrent } from '../model/store'

export const NO_MODES = 'No distinct resonances (smooth response)'

/** Signed whole-dB text with a real minus sign. */
export function fmtDb(v: number): string {
  const r = Math.round(v)
  return r === 0 ? '0 dB' : `${r > 0 ? '+' : '−'}${Math.abs(r)} dB`
}

export function statusText(status: string, progress: number, runtimeMs: number | null): string {
  if (status === 'running') return `running · ${Math.round(progress * 100)}%`
  if (status === 'up to date') return `up to date${runtimeMs === null ? '' : ` · ${(runtimeMs / 1000).toFixed(1)} s`}`
  return 'stale'
}

export function ModeStrip({ onOpenAcoustics }: { onOpenAcoustics: () => void }) {
  const c = currentClient
  const status = c.status.value
  const cur = simCurrent.value
  const cmp = compareVersion.value === null ? null : simCompare.value
  const fMax = design.value.sim.fMax
  const top = cur ? strongestModes(cur, 5).sort((a, b) => a.f - b.f) : []
  const ref = cur ? medianDb(cur, fMax) : 0
  const label = basedOn.value === null ? 'working copy' : `working copy (from v${basedOn.value})`
  const comparing = compareVersion.value !== null && (compareClient.status.value !== 'up to date' || !simCompare.value)
  const dot = status === 'up to date' ? 'ok' : status === 'running' ? 'run' : 'stale'

  return (
    <footer class="modes">
      <div class="status" role="status">
        <span class={`dot ${dot}`} />
        Simulation {statusText(status, c.progress.value, c.runtimeMs.value)}
        {comparing && <span> · comparing…</span>}
        {c.error.value && <span class="u"> · failed: {c.error.value}</span>}
      </div>
      <div class="mlist num">
        {!cur ? (
          <span class="m hint">Waiting for the first result</span>
        ) : top.length === 0 ? (
          <span class="m">{NO_MODES}</span>
        ) : (
          top.map((m) => {
            const delta = modeDelta(m, cmp)
            return (
              <span class="m" key={m.f}>
                <b>{Math.round(m.f)} Hz</b>{' '}
                {cmp ? (delta === null ? 'new' : <>{fmtDb(delta)} <span class={delta > 0 ? 'u' : 'd'}>{delta > 0 ? '▲' : '▼'}{m === top[0] ? ` vs v${compareVersion.value}` : ''}</span></>) : fmtDb(m.level - ref)}
              </span>
            )
          })
        )}
        <span class="m hint">FDTD estimate, level relative</span>
      </div>
      <div class="legend">
        {design.value.treatments.length > 0 && <span><i class="sw-treat" />Acoustic treatment</span>}
        <span><span class="sw" />{label}</span>
        {cmp && <span><span class="sw cmp" />v{compareVersion.value}</span>}
        <button type="button" class="btn" onClick={onOpenAcoustics}>Open Acoustics</button>
      </div>
    </footer>
  )
}
