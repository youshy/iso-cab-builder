import type { PanelEdge } from '../geometry/boxes'
import { fmt, Pen, textWidth, type BlockFn, type Tag } from './svg'
import { r05 } from './tags'

type Span = { u0: number; u1: number; v0: number; v1: number }

/**
 * One flat part drawn as its face: length horizontal, width vertical, model mm measured from its bottom-left
 * corner.
 */
export type Cell = {
  len: number
  wid: number
  tag: Tag | null
  caption: string[]
  /** Mitred panels: the inner face, set in from the outer face (dashed). */
  inner?: Span
  bevels?: { edge: PanelEdge; text: string }[]
  /** Door opening through the panel, with its position dimensioned from the edges. */
  cutout?: Span
}

const dim = (n: number) => fmt(r05(n))
const CAP = 2.4
const BALLOON_INSIDE = 14

/** A titled row of flat parts side by side, each with its length and width dimensioned. */
export function cellsBlock(title: string, cells: Cell[]): BlockFn {
  return (s) => {
    const pen = new Pen()
    pen.text(0, -2, title, { size: 3.2, cls: 'hd' })
    const inside = (c: Cell) => c.len * s >= BALLOON_INSIDE && c.wid * s >= BALLOON_INSIDE
    // Room above the faces only for balloons that do not fit inside their part.
    const top = cells.every(inside) ? 2.5 : 8
    let cx = 0
    for (const c of cells) {
      const W = c.len * s, H = c.wid * s
      const chained = c.cutout !== undefined
      const left = cx + (chained ? 11 : 7)
      const X = (u: number) => left + u * s
      const Y = (v: number) => top + H - v * s
      pen.rect(left, top, W, H, 'o')

      if (c.inner) pen.rect(X(c.inner.u0), Y(c.inner.v1), (c.inner.u1 - c.inner.u0) * s, (c.inner.v1 - c.inner.v0) * s, 'h')
      for (const b of c.bevels ?? []) {
        if (b.edge === 'L1') pen.text(left + W / 2, top + H - 1.2, b.text, { size: 2, anchor: 'middle' })
        else if (b.edge === 'L2') pen.text(left + W / 2, top + 2.8, b.text, { size: 2, anchor: 'middle' })
        else if (b.edge === 'W1') pen.text(left + 2.8, top + H / 2, b.text, { size: 2, anchor: 'middle', rotate: true })
        else pen.text(left + W - 1.2, top + H / 2, b.text, { size: 2, anchor: 'middle', rotate: true })
      }

      if (c.cutout) {
        const k = c.cutout
        const [x0, x1, y0, y1] = [X(k.u0), X(k.u1), Y(k.v0), Y(k.v1)]
        pen.rect(x0, y1, x1 - x0, y0 - y1, 'o')
        pen.line(x0, y0, x1, y1, 't')
        pen.line(x0, y1, x1, y0, 't')
        pen.text((x0 + x1) / 2, (y0 + y1) / 2 - 1.5, `opening ${dim(k.u1 - k.u0)} × ${dim(k.v1 - k.v0)}`, { size: 2.2, anchor: 'middle' })
        pen.text((x0 + x1) / 2, (y0 + y1) / 2 + 2, 'cut through', { size: 2, anchor: 'middle' })
        const us = [0, k.u0, k.u1, c.len], vs = [0, k.v0, k.v1, c.wid]
        pen.chainH(us.map(X), us.slice(1).map((u, i) => dim(u - us[i])), top + H, top + H + 5)
        pen.chainV(vs.map(Y), vs.slice(1).map((v, i) => dim(v - vs[i])), left, left - 5)
      }
      const off = chained ? 10 : 5
      pen.dimH(left, left + W, top + H, top + H + off, dim(c.len))
      pen.dimV(top + H, top, left, left - off, dim(c.wid))

      if (inside(c)) pen.balloon(c.tag, left + 4.5, top + 4.5, left + 4.5, top + 4.5)
      else pen.balloon(c.tag, left + Math.min(W / 2, 3), top + Math.min(H / 2, 1), left + Math.min(W / 2, 3) + 7, top - 4)

      let ty = top + H + off + 4.5
      let capW = 0
      for (const line of c.caption) {
        pen.text(left, ty, line, { size: CAP })
        capW = Math.max(capW, textWidth(line, CAP))
        ty += CAP + 1
      }
      cx = left + Math.max(W, capW) + 8
    }
    return pen.block()
  }
}
