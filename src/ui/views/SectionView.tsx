import { resolveDims } from '../../geometry/dimensions'
import { facetOffsetAt } from '../../geometry/facets'
import { cabBox } from '../../geometry/space'
import { panelExtent, panelTreatments, wallTreatments } from '../../geometry/treatments'
import { activeInterior, stackThickness, wallNormal, wallStack, WALLS } from '../../geometry/walls'
import { SPLIT_GAP, type DoorLayout, type LeafLayout } from '../../doors/doors'
import { doorWall, doorWidthAxis, widthEdgeEnd } from '../../doors/side'
import type { Axis, Design, Vec3, WallId } from '../../model/schema'

type View = 'plan' | 'front' | 'side'
type Props = {
  design: Design
  view: View
  highlight?: WallId
  compare?: Design | null
  /** Stretch depth by 2.4 in the plan view so shallow facets are visible. */
  exaggerate?: boolean
  /** Called with the wall under a click; walls then show a pointer cursor. */
  onSelectWall?: (w: WallId) => void
  /** Draws the door leaves and their swing arcs. */
  doors?: DoorLayout | null
}

/** Horizontal and vertical world axes shown by each view; the third axis is cut at its middle. */
const AXES: Record<View, [Axis, Axis]> = { plan: ['x', 'z'], front: ['x', 'y'], side: ['z', 'y'] }
const MIN_WALLS: WallId[] = ['left', 'bottom', 'back']
export const DEPTH_EXAGGERATION = 2.4

type R = { x: number; y: number; width: number; height: number }

export function SectionView({ design: d, view, highlight, compare, exaggerate, onSelectWall, doors }: Props) {
  const [ha, va] = AXES[view]
  const cut = (['x', 'y', 'z'] as Axis[]).find((a) => a !== ha && a !== va)!
  const k = (a: Axis) => (exaggerate && view === 'plan' && a === 'z' ? DEPTH_EXAGGERATION : 1)
  const upIsNegative = view !== 'plan' // plan: depth grows downwards, back at the top

  /** World ranges on the view axes to a screen rect. */
  const rect = (h0: number, h1: number, v0: number, v1: number): R => {
    const x0 = h0 * k(ha), x1 = h1 * k(ha)
    const y0 = (upIsNegative ? -v1 : v0) * k(va), y1 = (upIsNegative ? -v0 : v1) * k(va)
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
  }
  const pt = (h: number, v: number): [number, number] => [h * k(ha), (upIsNegative ? -v : v) * k(va)]

  const { inner } = resolveDims(d)
  const thick = (dd: Design, w: WallId) => stackThickness(wallStack(dd, w))
  const lo = (dd: Design, a: Axis) => thick(dd, a === 'x' ? 'left' : a === 'y' ? 'bottom' : 'back')
  const hi = (dd: Design, a: Axis) => thick(dd, a === 'x' ? 'right' : a === 'y' ? 'top' : 'front')
  const outerRect = (dd: Design, innerSize: Vec3) =>
    rect(-lo(dd, ha), innerSize[ha] + hi(dd, ha), -lo(dd, va), innerSize[va] + hi(dd, va))

  /** Extents of a leaf along a world axis: halves for a split leaf's width, one range otherwise, null off the door plane. */
  function leafSegs(l: LeafLayout, axis: Axis, side: DoorLayout['side']): [number, number][] | null {
    const c = inner[axis] / 2
    if (axis === 'y') return [[c - l.leaves[0].h / 2, c + l.leaves[0].h / 2]]
    if (axis !== doorWidthAxis(side)) return null
    if (l.leaves.length === 1) return [[c - l.leaves[0].w / 2, c + l.leaves[0].w / 2]]
    const half = l.leaves[0].w
    return [[c - half - SPLIT_GAP / 2, c - SPLIT_GAP / 2], [c + SPLIT_GAP / 2, c + half + SPLIT_GAP / 2]]
  }

  /** Leaves as slabs (door wall edge-on) or face-on rectangles, with dashed quarter-circle swing arcs. */
  function doorLeafEls(dl: DoorLayout, reach: R[]): preact.JSX.Element[] {
    const dw = dl.side
    const dn = wallNormal(dw)
    const els: preact.JSX.Element[] = []
    if (dn !== ha && dn !== va) {
      for (const l of [dl.inner, dl.outer]) {
        const hs = leafSegs(l, ha, dw), vs = leafSegs(l, va, dw)
        if (!hs || !vs) continue
        for (const [h0, h1] of hs) for (const [v0, v1] of vs) {
          els.push(<rect key={`${l.which}${h0}`} {...rect(h0, h1, v0, v1)} class={`sv-leaf ${l.which}`}><title>{`${l.which} door leaf`}</title></rect>)
        }
      }
      return els
    }
    const isMin = MIN_WALLS.includes(dw)
    const out = isMin ? -1 : 1
    const al = dn === ha ? va : ha
    const t = thick(d, dw)
    const faces = { outer: isMin ? -t : inner[dn] + t, inner: isMin ? 0 : inner[dn] }
    const at = (nPos: number, alPos: number): [number, number] => (dn === ha ? pt(nPos, alPos) : pt(alPos, nPos))
    for (const l of [dl.inner, dl.outer]) {
      const segs = leafSegs(l, al, dw)
      if (!segs) continue
      const n0 = faces[l.which], n1 = n0 + out * l.leaves[0].t
      segs.forEach(([a0, a1], i) => {
        const r = dn === ha ? rect(Math.min(n0, n1), Math.max(n0, n1), a0, a1) : rect(a0, a1, Math.min(n0, n1), Math.max(n0, n1))
        els.push(<rect key={`${l.which}${i}`} {...r} class={`sv-leaf ${l.which}`}><title>{`${l.which} door leaf`}</title></rect>)
        // Hinge end along the view's door-plane axis; arcs only show when the hinge axis lies in this view.
        const edge = l.leaves.length === 2 && al === doorWidthAxis(dw) ? (i === 0 ? 'min' : 'max') : hingeEnd(dw, l, al)
        if (!edge) return
        const hingeAt = edge === 'min' ? a0 : a1
        const dir = edge === 'min' ? 1 : -1
        const mid = (n0 + n1) / 2
        const swing = l.direction === 'out' ? out : -out
        const pts = Array.from({ length: 10 }, (_, k) => {
          const th = (k / 9) * (Math.PI / 2)
          return at(mid + swing * l.swingRadius * Math.sin(th), hingeAt + dir * l.swingRadius * Math.cos(th))
        })
        for (const [x, y] of pts) reach.push({ x, y, width: 0, height: 0 })
        els.push(<polyline key={`arc${l.which}${i}`} points={pts.map((q) => q.join(',')).join(' ')} class={`sv-swing ${l.which}`} fill="none"><title>{`${l.which} door swing`}</title></polyline>)
      })
    }
    return els
  }

  const arcReach: R[] = []
  const leafEls = doors ? doorLeafEls(doors, arcReach) : []
  const outer = outerRect(d, inner)
  const cmp = compare ? outerRect(compare, resolveDims(compare).inner) : null
  const bounds = [outer, ...(cmp ? [cmp] : []), ...arcReach]
  const minX = Math.min(...bounds.map((b) => b.x)), minY = Math.min(...bounds.map((b) => b.y))
  const maxX = Math.max(...bounds.map((b) => b.x + b.width)), maxY = Math.max(...bounds.map((b) => b.y + b.height))
  const pad = Math.max(maxX - minX, maxY - minY) * 0.06
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`

  const pick = (w: WallId) =>
    onSelectWall ? { onClick: () => onSelectWall(w), style: { cursor: 'pointer' } } : {}
  const hatchId = `hatch-${view}`
  const shellEls: preact.JSX.Element[] = []
  const facetEls: preact.JSX.Element[] = []
  const treatEls: preact.JSX.Element[] = []
  const treatId = `treat-${view}`

  // Shell: every wall whose normal is on a view axis, drawn as bands outside-in.
  for (const w of WALLS) {
    const n = wallNormal(w)
    if (n !== ha && n !== va) continue
    const isMin = MIN_WALLS.includes(w)
    const t = thick(d, w)
    const along = n === ha ? va : ha // the other view axis
    // Walls normal to the horizontal axis run the full outer height; the others span the inner width.
    const a0 = n === ha ? -lo(d, along) : 0
    const a1 = n === ha ? inner[along] + hi(d, along) : inner[along]
    let cum = 0
    const stack = wallStack(d, w)
    stack.forEach((item, i) => {
      const th = item.kind === 'layer' ? item.thickness : item.width
      const n0 = isMin ? -t + cum : inner[n] + t - cum - th
      cum += th
      const r = n === ha ? rect(n0, n0 + th, a0, a1) : rect(a0, a1, n0, n0 + th)
      const isGap = item.kind === 'gap'
      shellEls.push(
        <rect key={`${w}${i}`} {...r} {...pick(w)} class={`${isGap ? 'sv-gap' : 'sv-layer'}${highlight === w ? ' sel' : ''}`} fill={isGap ? `url(#${hatchId})` : undefined}>
          <title>{isGap ? `${w} wall air gap` : `${w} wall layer`}</title>
        </rect>,
      )
    })

    // Facets and treatments for this wall.
    const wi = activeInterior(d, w)
    const offsetAt = (alongPos: number) =>
      wi ? facetOffsetAt(wi, wi.splitAxis === along ? alongPos : inner[wi.splitAxis] / 2) : 0
    const samples: number[] = [0]
    if (wi && wi.splitAxis === along) {
      let c = 0
      for (const f of wi.facets.slice(0, -1)) {
        c += f.width
        samples.push(c - 1e-6, c + 1e-6)
      }
    }
    samples.push(inner[along])
    // Treatment bands follow the facet face, stacked outwards from it.
    let below = 0
    wallTreatments(d, w).forEach((t, i) => {
      const edge = (s: number, extra: number): [number, number] => {
        const o = offsetAt(s) + extra
        const nPos = isMin ? o : inner[n] - o
        return n === ha ? pt(nPos, s) : pt(s, nPos)
      }
      const top = below + t.thickness
      const band = [...samples.map((s) => edge(s, below)), ...[...samples].reverse().map((s) => edge(s, top))]
      treatEls.push(
        <polygon key={`tr${w}${i}`} points={band.map((q) => q.join(',')).join(' ')} class="sv-treat" fill={`url(#${treatId})`}>
          <title>{`Acoustic treatment, ${w} wall, ${t.thickness} mm`}</title>
        </polygon>,
      )
      below = top
    })
    if (!wi) continue
    const face = samples.map((s) => {
      const o = offsetAt(s)
      const nPos = isMin ? o : inner[n] - o
      return n === ha ? pt(nPos, s) : pt(s, nPos)
    })
    const base = [samples[samples.length - 1], samples[0]].map((s) => (n === ha ? pt(isMin ? 0 : inner[n], s) : pt(s, isMin ? 0 : inner[n])))
    const pts = [...face, ...base].map((p) => p.join(',')).join(' ')
    if (highlight === w && wi.splitAxis === along) {
      let c = 0
      wi.facets.forEach((f, i) => {
        const mid = c + f.width / 2
        c += f.width
        const o = offsetAt(mid)
        const [px, py] = n === ha ? pt(isMin ? o : inner[n] - o, mid) : pt(mid, isMin ? o : inner[n] - o)
        const dir = isMin ? 1 : -1
        facetEls.push(
          <text key={`t${w}${i}`} class="sv-flabel" font-size={pad * 0.6}
            x={n === ha ? px + dir * pad * 0.3 : px} y={n === ha ? py + pad * 0.2 : py + dir * (upIsNegative ? -1 : 1) * pad * 0.8}
            text-anchor={n === ha ? (isMin ? 'start' : 'end') : 'middle'}>
            {`${i + 1}: ${f.tilt}°`}
          </text>,
        )
      })
    }
    facetEls.unshift(
      <polygon key={`f${w}`} points={pts} {...pick(w)} class={highlight === w ? 'sv-facet hi' : 'sv-facet'}>
        <title>{`${w} wall interior`}</title>
      </polygon>,
    )
  }

  // Inner panels: box on world axes, shown when the cut passes through it.
  const panelEls: preact.JSX.Element[] = []
  for (const p of d.panels) {
    const e = panelExtent(d, p)
    const [u, v] = (['x', 'y', 'z'] as Axis[]).filter((a) => a !== p.normal)
    const range: Record<Axis, [number, number]> = { x: [0, 0], y: [0, 0], z: [0, 0] }
    range[u] = [p.u0, p.u1]
    range[v] = [p.v0, p.v1]
    const mid = inner[cut] / 2
    const slab = { ...range, [p.normal]: [e.slabLo, e.slabHi] } as Record<Axis, [number, number]>
    if (mid < slab[cut][0] || mid > slab[cut][1]) continue
    panelEls.push(<rect key={p.id} {...rect(...slab[ha], ...slab[va])} class="sv-panel"><title>Inner panel</title></rect>)
    for (const side of ['neg', 'pos'] as const) {
      let from = side === 'neg' ? e.slabLo : e.slabHi
      panelTreatments(d, p.id, side).forEach((t, i) => {
        const to = side === 'neg' ? from - t.thickness : from + t.thickness
        const r = { ...range, [p.normal]: [Math.min(from, to), Math.max(from, to)] } as Record<Axis, [number, number]>
        treatEls.push(
          <rect key={`pt${p.id}${side}${i}`} {...rect(...r[ha], ...r[va])} class="sv-treat" fill={`url(#${treatId})`}>
            <title>{`Acoustic treatment, ${t.thickness} mm`}</title>
          </rect>,
        )
        from = to
      })
    }
  }

  // Cab (sizing cab), dashed.
  const sizing = d.cabs.find((c) => c.id === d.dims.sizingCabId) ?? d.cabs[0]
  const cb = cabBox(d, sizing)
  const cabRect = rect(cb.min[ha], cb.max[ha], cb.min[va], cb.max[va])

  // Door marker.
  const dw = doorWall(d)
  const dn = wallNormal(dw)
  let door: preact.JSX.Element
  if (dn === ha || dn === va) {
    const isMin = MIN_WALLS.includes(dw)
    const along = dn === ha ? va : ha
    const t = thick(d, dw)
    const edge = isMin ? -t : inner[dn] + t
    const a1 = inner[along]
    const [x1, y1] = dn === ha ? pt(edge, 0) : pt(0, edge)
    const [x2, y2] = dn === ha ? pt(edge, a1) : pt(a1, edge)
    door = (
      <g class="sv-door">
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <text font-size={pad * 0.7} x={(x1 + x2) / 2 + (dn === ha ? (isMin ? -pad * 0.4 : pad * 0.4) : 0)} y={(y1 + y2) / 2 + (dn === ha ? 0 : -pad * 0.3)} text-anchor={dn === ha ? (isMin ? 'end' : 'start') : 'middle'}>Door</text>
      </g>
    )
  } else {
    const m = d.door.margin
    const r = rect(m, inner[ha] - m, m, inner[va] - m)
    door = (
      <g class="sv-door">
        <rect {...r} fill="none" />
        <text font-size={pad * 0.7} x={r.x + r.width / 2} y={r.y + r.height / 2} text-anchor="middle">Door ({dw} wall)</text>
      </g>
    )
  }

  return (
    <svg viewBox={viewBox} class="section" role="img" aria-label={`${view} section`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id={hatchId} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" class="sv-gap-bg" />
          <line x1="0" y1="0" x2="0" y2="12" class="sv-hatch" />
        </pattern>
        <pattern id={treatId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width="8" height="8" class="sv-treat-bg" />
          <line x1="0" y1="0" x2="0" y2="8" class="sv-treat-hatch" />
        </pattern>
      </defs>
      <rect {...outer} class="sv-outer" />
      <rect {...rect(0, inner[ha], 0, inner[va])} class="sv-inner" />
      {shellEls}
      {facetEls}
      {panelEls}
      {treatEls}
      <rect {...cabRect} class="sv-cab" />
      {cmp && <rect {...cmp} class="sv-compare" />}
      {door}
      {leafEls}
    </svg>
  )
}

/** End of the leaf's hinge edge along `axis` (world), or null when the hinge runs across that axis. */
function hingeEnd(side: DoorLayout['side'], l: LeafLayout, axis: Axis): 'min' | 'max' | null {
  const edge = l.hinges[0].edge
  if (edge === 'top') return axis === 'y' ? 'max' : null
  if (edge === 'bottom') return axis === 'y' ? 'min' : null
  return axis === doorWidthAxis(side) ? widthEdgeEnd(side, edge as 'left' | 'right') : null
}
