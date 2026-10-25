import { facetSpan } from '../geometry/boxes'
import { packingDepth, steps } from '../geometry/facets'
import { activeInterior, wallPlaneAxes, WALLS } from '../geometry/walls'
import { PACKER_WIDTH } from '../model/defaults'
import type { Axis, Design, WallId } from '../model/schema'
import { fmt, Pen, type BlockFn, type Tag } from './svg'
import { cap, PartTags, r05 } from './tags'

const AXIS_NAME: Record<Axis, string> = { x: 'width', y: 'height', z: 'depth' }
const rad = (deg: number) => (deg * Math.PI) / 180
const r2 = (n: number) => Math.round(n * 100) / 100

/** One section per faceted wall, across its split axis: facet widths, tilts, hinge edges and packing depths. */
export function facetBlocks(d: Design, tags: PartTags): BlockFn[] {
  return WALLS.flatMap((w) => {
    const b = facetBlock(d, w, tags)
    return b ? [b] : []
  })
}

function facetBlock(d: Design, w: WallId, tags: PartTags): BlockFn | null {
  const wi = activeInterior(d, w)
  if (!wi) return null
  const Label = cap(w)
  const pt = wi.panelThickness
  const { o0, o1 } = facetSpan(d, w)
  const [u, v] = wallPlaneAxes(w)
  const along = u === wi.splitAxis ? v : u
  const named = (name: string): Tag | null => tags.tag(tags.named('facets', name))

  let at = 0
  const items = wi.facets.map((f, i) => {
    const x0 = at
    at += f.width
    const x1 = at
    const pd = packingDepth(f)
    const tan = Math.tan(rad(f.tilt))
    const hingeAt = f.hinge === 'min' ? x0 : x1
    const freeAt = f.hinge === 'min' ? x1 : x0
    const back = (x: number) => tan * Math.abs(x - hingeAt)
    return {
      f, i, x0, x1, pd, back, hingeAt, freeAt,
      facet: named(`${Label} facet ${i + 1}`),
      packer: named(`${Label} packer ${i + 1}`),
      fill: named(`${Label} bay fill ${i + 1}`),
      wedge: named(`${Label} end wedge ${i + 1}`),
    }
  })
  const total = at
  const fillers = steps(wi).map((st, i) => ({ ...st, tag: r05(Math.abs(st.delta)) > 0 ? named(`${Label} filler strip ${i + 1}`) : null }))

  return (s) => {
    const pen = new Pen()
    const X = (x: number) => x * s
    const Y = (off: number) => -off * s
    const maxFace = Math.max(...items.map((it) => it.pd)) + pt
    const head = Y(maxFace) - 14
    pen.text(0, head, `${Label} wall facets: section across ${AXIS_NAME[wi.splitAxis]}`, { size: 3.2, cls: 'hd' })
    pen.text(0, head + 4, `Facets run ${fmt(o1 - o0)} along the ${AXIS_NAME[along]} (${fmt(o0)} to ${fmt(o1)}). Closure: ${wi.closure}, behind: ${wi.behind}.`, { size: 2.2 })

    pen.line(0, 0, X(total), 0, 'o')
    for (let x = 0; x <= X(total) - 1.5; x += 3) pen.line(x + 1.5, 0, x, 1.5, 't')
    pen.text(X(total) + 2, 1, 'wall face', { size: 2 })

    for (const it of items) {
      const { x0, x1, back, pd, hingeAt, freeAt } = it
      pen.poly([[X(x0), Y(back(x0))], [X(x1), Y(back(x1))], [X(x1), Y(back(x1) + pt)], [X(x0), Y(back(x0) + pt)]], 'sec')
      const mid = (x0 + x1) / 2
      pen.text(X(mid), Y(back(mid) + pt) - 1.5, `${fmt(it.f.tilt)}°`, { size: 2.2, anchor: 'middle' })
      pen.poly([[X(hingeAt), 0], [X(hingeAt) - 1, 1.6], [X(hingeAt) + 1, 1.6]], 'mk')
      pen.text(X(hingeAt), 4.2, 'hinge', { size: 1.8, anchor: it.hingeAt === x0 ? 'start' : 'end' })
      pen.balloon(it.facet, X(mid), Y(back(mid) + pt / 2), X(mid), Y(maxFace) - 6)

      if (r2(pd) > 0) {
        const dir = freeAt > hingeAt ? -1 : 1
        const inner = freeAt + dir * Math.min(PACKER_WIDTH, it.f.width)
        pen.poly([[X(freeAt), 0], [X(inner), 0], [X(inner), Y(back(inner))], [X(freeAt), Y(pd)]], 'sec')
        pen.poly([[X(hingeAt), 0], [X(inner), 0], [X(inner), Y(back(inner))]], 'h')
        // Packing depth under the packer balloon, rounded as the packer's thickness in the cut list.
        pen.text(X(freeAt) + dir * 4, 21, `packing ${fmt(r2(pd))}`, { size: 2, anchor: dir < 0 ? 'end' : 'start' })
        const cx = (2 * hingeAt + inner) / 3
        pen.balloon(it.packer, X((freeAt + inner) / 2), Y(pd / 3), X(freeAt) + dir * 4, 15)
        pen.balloon(it.fill, X(cx), Y(back(cx) / 3), X(cx) - 4, 15)
        pen.balloon(it.wedge, X(cx) + 1, Y(back(cx) / 2), X(cx) + 4, 22)
      }
    }
    for (const fl of fillers) {
      const a = items.find((it) => Math.abs(it.x1 - fl.s) < 1e-6)
      const b = items.find((it) => Math.abs(it.x0 - fl.s) < 1e-6)
      if (!a || !b) continue
      const lo = Math.min(a.back(a.x1), b.back(b.x0)) + pt, hi = Math.max(a.back(a.x1), b.back(b.x0)) + pt
      const x = fl.delta > 0 ? fl.s - pt : fl.s
      pen.rect(X(x), Y(hi), pt * s, (hi - lo) * s, 'sec')
      pen.balloon(fl.tag, X(x + pt / 2), Y(hi), X(fl.s), Y(maxFace) - 6)
    }
    const xs = [0, ...items.map((it) => it.x1)]
    pen.chainH(xs.map(X), items.map((it) => fmt(it.f.width)), 0, 8)
    return pen.block()
  }
}
