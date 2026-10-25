import { OCTAVES } from '../acoustics/tl'

export interface ChartSeries {
  label: string
  y: number[]
  dashed?: boolean
}

export interface ChartProps {
  x: number[]
  series: ChartSeries[]
  xLog?: boolean
  yLabel: string
  markers?: { x: number; label: string }[]
  zeroLine?: boolean
}

const W = 560
const H = 230
const M = { l: 44, r: 12, t: 12, b: 28 }

const tickLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f))

/** Plain SVG line chart. Current series is ink, dashed series are grey. */
export function Chart({ x, series, xLog, yLabel, markers = [], zeroLine }: ChartProps) {
  const all = series.flatMap((s) => s.y).filter(Number.isFinite)
  let lo = Math.min(...all, zeroLine ? 0 : Infinity)
  let hi = Math.max(...all, zeroLine ? 0 : -Infinity)
  if (!Number.isFinite(lo)) [lo, hi] = [0, 10]
  lo = Math.floor(lo / 10) * 10
  hi = Math.max(Math.ceil(hi / 10) * 10, lo + 10)
  const x0 = Math.min(...x)
  const x1 = Math.max(...x)
  const tx = (v: number) => {
    const t = xLog ? Math.log(v / x0) / Math.log(x1 / x0) : (v - x0) / (x1 - x0)
    return M.l + t * (W - M.l - M.r)
  }
  const ty = (v: number) => H - M.b - ((v - lo) / (hi - lo)) * (H - M.t - M.b)
  const xTicks = xLog ? OCTAVES.filter((f) => f >= x0 && f <= x1) : x
  const yTicks: number[] = []
  for (let v = lo; v <= hi; v += 10) yTicks.push(v)
  const path = (ys: number[]) => ys.map((v, i) => `${i ? 'L' : 'M'}${tx(x[i]).toFixed(1)} ${ty(v).toFixed(1)}`).join('')

  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={yLabel}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={ty(v)} y2={ty(v)} class="c-grid" />
            <text x={M.l - 6} y={ty(v) + 4} text-anchor="end" class="c-tick num">{v}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={v}>
            <line x1={tx(v)} x2={tx(v)} y1={H - M.b} y2={H - M.b + 4} class="c-axis" />
            <text x={tx(v)} y={H - M.b + 16} text-anchor="middle" class="c-tick num">{tickLabel(v)}</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} class="c-axis" />
        <line x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} class="c-axis" />
        {zeroLine && <line x1={M.l} x2={W - M.r} y1={ty(0)} y2={ty(0)} class="c-zero" />}
        <text x={12} y={(M.t + H - M.b) / 2} transform={`rotate(-90 12 ${(M.t + H - M.b) / 2})`} text-anchor="middle" class="c-tick">{yLabel}</text>
        <text x={W - M.r} y={H - 2} text-anchor="end" class="c-tick">Hz</text>
        {series.map((s) => (
          <path key={s.label} d={path(s.y)} class={s.dashed ? 'c-line c-dashed' : 'c-line'} />
        ))}
        {markers
          .filter((m) => m.x >= x0 && m.x <= x1)
          .map((m) => {
            const right = tx(m.x) > W * 0.7
            return (
              <g key={m.label}>
                <line x1={tx(m.x)} x2={tx(m.x)} y1={M.t} y2={H - M.b} class="c-marker" />
                <text x={tx(m.x) + (right ? -4 : 4)} y={M.t + 10} text-anchor={right ? 'end' : 'start'} class="c-mlabel">
                  {m.label} {Math.round(m.x)} Hz
                </text>
              </g>
            )
          })}
      </svg>
      <div class="chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i class={s.dashed ? 'sw dashed' : 'sw'} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
