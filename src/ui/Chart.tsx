import { useRef, useState } from 'preact/hooks'
import { OCTAVES } from '../acoustics/tl'
import { freqLabel, linPos, linTicks, logPos, logValue, nearestIndex } from './chartScale'

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
          .map((m, k) => {
            const right = tx(m.x) > W * 0.7
            return (
              <g key={`${k}-${m.label}`}>
                <line x1={tx(m.x)} x2={tx(m.x)} y1={M.t} y2={H - M.b} class="c-marker" />
                {/* stagger labels so neighbouring markers stay readable */}
                <text x={tx(m.x) + (right ? -4 : 4)} y={M.t + 10 + (k % 3) * 12} text-anchor={right ? 'end' : 'start'} class="c-mlabel">
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

export interface OverlaySeries {
  label: string
  color: string
  y: number[]
  dashed?: boolean
  /** Draw a dot per sample. */
  points?: boolean
  /** Vertical markers drawn in the series colour. */
  vlines?: { x: number; label: string }[]
}

export interface OverlayChartProps {
  title: string
  x: number[]
  /** Visible x range, Hz. */
  domain: [number, number]
  ticks: number[]
  series: OverlaySeries[]
  yLabel: string
  yStep: number
  /** Always inside the y range. */
  yInclude?: number[]
  band?: { from: number; to: number; label: string }
  hline?: { y: number; label: string }
  /** x ranges shaded as a warning. */
  over?: { from: number; to: number }[]
  /** Decimals in the hover readout. */
  digits?: number
}

const OW = 800
const OH = 360
const OM = { l: 52, r: 16, t: 14, b: 40 }

/** Log-frequency line chart with overlaid series, a hover readout and optional band, target line and warning columns. */
export function OverlayChart(p: OverlayChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const ref = useRef<SVGSVGElement>(null)
  const [d0, d1] = p.domain
  const vals = [...p.series.flatMap((s) => s.y), ...(p.yInclude ?? []), ...(p.hline ? [p.hline.y] : [])].filter(Number.isFinite)
  const yt = linTicks(Math.min(...vals), Math.max(...vals), p.yStep)
  const lo = yt[0]
  const hi = yt[yt.length - 1]
  const tx = (v: number) => OM.l + logPos(Math.min(Math.max(v, d0), d1), d0, d1) * (OW - OM.l - OM.r)
  const ty = (v: number) => OH - OM.b - linPos(v, lo, hi) * (OH - OM.t - OM.b)
  const path = (ys: number[]) => ys.map((v, i) => `${i ? 'L' : 'M'}${tx(p.x[i]).toFixed(1)} ${ty(v).toFixed(1)}`).join('')
  const digits = p.digits ?? 1

  const onMove = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const vx = ((e.clientX - r.left) / r.width) * OW
    const t = (vx - OM.l) / (OW - OM.l - OM.r)
    setHover(t < 0 || t > 1 ? null : nearestIndex(p.x, logValue(t, d0, d1), true))
  }
  const hx = hover === null ? 0 : tx(p.x[hover])
  const flip = hx > OW * 0.55

  return (
    <div class="chart ochart">
      <svg ref={ref} viewBox={`0 0 ${OW} ${OH}`} role="img" aria-label={p.title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {p.over?.map((o, k) => (
          <rect key={k} x={tx(o.from)} width={tx(o.to) - tx(o.from)} y={OM.t} height={OH - OM.t - OM.b} class="c-over" />
        ))}
        {p.band && (
          <g>
            <rect x={tx(p.band.from)} width={tx(p.band.to) - tx(p.band.from)} y={OM.t} height={OH - OM.t - OM.b} class="c-band" />
            <text x={tx(p.band.from) + 8} y={OH - OM.b - 8} text-anchor="start" class="c-blabel">{p.band.label}</text>
          </g>
        )}
        {yt.map((v) => (
          <g key={v}>
            <line x1={OM.l} x2={OW - OM.r} y1={ty(v)} y2={ty(v)} class="c-grid" />
            <text x={OM.l - 8} y={ty(v) + 4} text-anchor="end" class="c-tick num">{v}</text>
          </g>
        ))}
        {p.ticks.map((v) => (
          <g key={v}>
            <line x1={tx(v)} x2={tx(v)} y1={OH - OM.b} y2={OH - OM.b + 5} class="c-axis" />
            <text x={tx(v)} y={OH - OM.b + 19} text-anchor="middle" class="c-tick num">{freqLabel(v)}</text>
          </g>
        ))}
        <line x1={OM.l} x2={OW - OM.r} y1={OH - OM.b} y2={OH - OM.b} class="c-axis" />
        <line x1={OM.l} x2={OM.l} y1={OM.t} y2={OH - OM.b} class="c-axis" />
        <text x={(OM.l + OW - OM.r) / 2} y={OH - 6} text-anchor="middle" class="c-axlabel">Frequency (Hz)</text>
        <text x={14} y={(OM.t + OH - OM.b) / 2} transform={`rotate(-90 14 ${(OM.t + OH - OM.b) / 2})`} text-anchor="middle" class="c-axlabel">{p.yLabel}</text>
        {p.hline && (
          <g>
            <line x1={OM.l} x2={OW - OM.r} y1={ty(p.hline.y)} y2={ty(p.hline.y)} class="c-target" />
            <text x={OW - OM.r - 4} y={ty(p.hline.y) - 5} text-anchor="end" class="c-blabel">{p.hline.label}</text>
          </g>
        )}
        {p.series.flatMap((s) =>
          (s.vlines ?? [])
            .filter((m) => m.x >= d0 && m.x <= d1)
            .map((m, k) => (
              <g key={`${s.label}-${k}`}>
                <line x1={tx(m.x)} x2={tx(m.x)} y1={OM.t} y2={OH - OM.b} class="c-marker" style={{ stroke: s.color }} />
                <text transform={`rotate(-90 ${tx(m.x) - 4} ${OM.t + 4})`} x={tx(m.x) - 4} y={OM.t + 4} text-anchor="end" class="c-mlabel">{m.label}</text>
              </g>
            )),
        )}
        {p.series.map((s) => (
          <path key={s.label} d={path(s.y)} class={s.dashed ? 'c-line c-dashed' : 'c-line'} style={{ stroke: s.color }} />
        ))}
        {p.series.map((s) =>
          s.points ? s.y.map((v, i) => <circle key={`${s.label}-${i}`} cx={tx(p.x[i])} cy={ty(v)} r={4} class="c-dot" style={{ fill: s.color }} />) : null,
        )}
        {hover !== null && (
          <g>
            <line x1={hx} x2={hx} y1={OM.t} y2={OH - OM.b} class="c-cross" />
            {p.series.map((s) => (
              <circle key={s.label} cx={hx} cy={ty(s.y[hover])} r={4.5} class="c-dot" style={{ fill: s.color }} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div class="c-tip num" style={{ left: `${(hx / OW) * 100}%`, transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
          <b>{freqLabel(p.x[hover])} Hz</b>
          {p.series.map((s) => (
            <div key={s.label}>
              <i class="sw" style={{ background: s.color }} />
              <span class="tl">{s.label}</span>
              <span>{s.y[hover].toFixed(digits)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Legend row: a swatch per series, dashed for compare series. */
export function OverlayLegend({ series }: { series: OverlaySeries[] }) {
  return (
    <div class="chart-legend">
      {series.map((s) => (
        <span key={s.label}>
          <i class={s.dashed ? 'sw dashed' : 'sw'} style={{ borderTopColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}
