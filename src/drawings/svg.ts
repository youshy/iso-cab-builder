/**
 * Paper-space drawing primitives for the printable sheets. All coordinates here are millimetres on the A3
 * sheet; the sheet builders convert model millimetres with the sheet scale before calling them.
 */

export const fmt = (n: number): string => String(Math.round(n * 10) / 10)
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v: number) => String(Math.round(v * 100) / 100)

/** A laid-out drawing in paper mm with its origin at the top-left of its bounding box. */
export type Block = { w: number; h: number; svg: string }
/** Renders a block at a scale given as paper mm per model mm. */
export type BlockFn = (s: number) => Block

/** A part balloon: the first appearance of an id gets the balloon, later ones a plain reference. */
export type Tag = { id: string; qty: number; first: boolean }

type Pt = [number, number]
type TextOpts = { size?: number; anchor?: 'start' | 'middle' | 'end'; rotate?: boolean; cls?: string }

const TICK = 1.2
const DIM_TEXT = 2.2

/** Collects SVG elements and tracks their bounding box, so a block can be packed without measuring later. */
export class Pen {
  private out: string[] = []
  private x0 = Infinity
  private y0 = Infinity
  private x1 = -Infinity
  private y1 = -Infinity

  private grow(x: number, y: number) {
    this.x0 = Math.min(this.x0, x); this.y0 = Math.min(this.y0, y)
    this.x1 = Math.max(this.x1, x); this.y1 = Math.max(this.y1, y)
  }

  line(xa: number, ya: number, xb: number, yb: number, cls = 't') {
    this.grow(xa, ya); this.grow(xb, yb)
    this.out.push(`<line class="${cls}" x1="${n2(xa)}" y1="${n2(ya)}" x2="${n2(xb)}" y2="${n2(yb)}"/>`)
  }

  rect(x: number, y: number, w: number, h: number, cls = 'o') {
    const [rx, ry] = [Math.min(x, x + w), Math.min(y, y + h)]
    const [rw, rh] = [Math.abs(w), Math.abs(h)]
    this.grow(rx, ry); this.grow(rx + rw, ry + rh)
    this.out.push(`<rect class="${cls}" x="${n2(rx)}" y="${n2(ry)}" width="${n2(rw)}" height="${n2(rh)}"/>`)
  }

  poly(pts: Pt[], cls = 'o') {
    pts.forEach(([x, y]) => this.grow(x, y))
    this.out.push(`<polygon class="${cls}" points="${pts.map(([x, y]) => `${n2(x)},${n2(y)}`).join(' ')}"/>`)
  }

  circle(cx: number, cy: number, r: number, cls = 'o') {
    this.grow(cx - r, cy - r); this.grow(cx + r, cy + r)
    this.out.push(`<circle class="${cls}" cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}"/>`)
  }

  text(x: number, y: number, s: string, o: TextOpts = {}) {
    const size = o.size ?? 2.5
    const anchor = o.anchor ?? 'start'
    const tw = textWidth(s, size)
    const a0 = anchor === 'start' ? 0 : anchor === 'middle' ? -tw / 2 : -tw
    if (o.rotate) { this.grow(x - size, y - a0 - tw); this.grow(x, y - a0) } else { this.grow(x + a0, y - size); this.grow(x + a0 + tw, y + size * 0.25) }
    const rot = o.rotate ? ` transform="rotate(-90 ${n2(x)} ${n2(y)})"` : ''
    const cls = o.cls ? ` class="${o.cls}"` : ''
    const anc = anchor === 'start' ? '' : ` text-anchor="${anchor}"`
    this.out.push(`<text${cls} x="${n2(x)}" y="${n2(y)}" font-size="${n2(size)}"${anc}${rot}>${esc(s)}</text>`)
  }

  /** Horizontal dimension between xa and xb, extension lines from yFrom down or up to the dimension line at yDim. */
  dimH(xa: number, xb: number, yFrom: number, yDim: number, label: string, side: 'before' | 'after' = 'after') {
    const dir = yDim >= yFrom ? 1 : -1
    for (const x of [xa, xb]) this.line(x, yFrom + dir * 0.8, x, yDim + dir * 1, 't')
    this.line(xa, yDim, xb, yDim, 't')
    for (const x of [xa, xb]) this.line(x - TICK / 2, yDim + TICK / 2, x + TICK / 2, yDim - TICK / 2, 'o')
    // A label wider than its span sits beside it, before or after.
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb)
    if (hi - lo >= textWidth(label, DIM_TEXT) + 1) this.text((xa + xb) / 2, yDim - 0.8, label, { size: DIM_TEXT, anchor: 'middle' })
    else if (side === 'before') this.text(lo - 1.2, yDim - 0.8, label, { size: DIM_TEXT, anchor: 'end' })
    else this.text(hi + 1.2, yDim - 0.8, label, { size: DIM_TEXT })
  }

  /** Vertical dimension between ya and yb, extension lines from xFrom to the dimension line at xDim. */
  dimV(ya: number, yb: number, xFrom: number, xDim: number, label: string, side: 'before' | 'after' = 'after') {
    const dir = xDim >= xFrom ? 1 : -1
    for (const y of [ya, yb]) this.line(xFrom + dir * 0.8, y, xDim + dir * 1, y, 't')
    this.line(xDim, ya, xDim, yb, 't')
    for (const y of [ya, yb]) this.line(xDim - TICK / 2, y + TICK / 2, xDim + TICK / 2, y - TICK / 2, 'o')
    // Rotated text reads upward: 'before' is below the span on paper, 'after' above it.
    const lo = Math.min(ya, yb), hi = Math.max(ya, yb)
    if (hi - lo >= textWidth(label, DIM_TEXT) + 1) this.text(xDim - 0.8, (ya + yb) / 2, label, { size: DIM_TEXT, anchor: 'middle', rotate: true })
    else if (side === 'before') this.text(xDim - 0.8, hi + 1.2, label, { size: DIM_TEXT, anchor: 'end', rotate: true })
    else this.text(xDim - 0.8, lo - 1.2, label, { size: DIM_TEXT, rotate: true })
  }

  /** Chain of horizontal dimensions through the given stations (paper x), labelled with model lengths. */
  chainH(xs: number[], labels: string[], yFrom: number, yDim: number) {
    for (let i = 0; i + 1 < xs.length; i++) {
      if (xs[i + 1] - xs[i] > 1e-6) this.dimH(xs[i], xs[i + 1], yFrom, yDim, labels[i], i === 0 ? 'before' : 'after')
    }
  }

  chainV(ys: number[], labels: string[], xFrom: number, xDim: number) {
    for (let i = 0; i + 1 < ys.length; i++) {
      if (Math.abs(ys[i + 1] - ys[i]) > 1e-6) this.dimV(ys[i], ys[i + 1], xFrom, xDim, labels[i], i === 0 ? 'before' : 'after')
    }
  }

  /** Part balloon at (cx, cy) with a leader to the target point (tx, ty). */
  balloon(tag: Tag | null, tx: number, ty: number, cx: number, cy: number) {
    if (!tag) return
    const r = 3.2
    const dx = tx - cx, dy = ty - cy
    const dist = Math.hypot(dx, dy)
    if (!tag.first) {
      if (dist > r) this.line(cx, cy, tx, ty, 't')
      this.text(cx, cy + 0.8, `(${tag.id})`, { size: 2, anchor: 'middle', cls: 'ref' })
      return
    }
    if (dist > r) {
      this.line(cx + (dx / dist) * r, cy + (dy / dist) * r, tx, ty, 't')
      this.circle(tx, ty, 0.4, 'dot')
    }
    this.circle(cx, cy, r, 'bal')
    this.text(cx, cy + 0.8, tag.id, { size: tag.id.length > 3 ? 1.9 : 2.3, anchor: 'middle', cls: 'bid' })
    if (tag.qty > 1) this.text(cx + r + 0.8, cy + 0.8, `×${tag.qty}`, { size: 2.3 })
  }

  block(pad = 2): Block {
    if (!Number.isFinite(this.x0)) return { w: 0, h: 0, svg: '' }
    const tx = pad - this.x0, ty = pad - this.y0
    return {
      w: this.x1 - this.x0 + 2 * pad,
      h: this.y1 - this.y0 + 2 * pad,
      svg: `<g transform="translate(${n2(tx)} ${n2(ty)})">${this.out.join('')}</g>`,
    }
  }
}

/** Rough width of system-font text in mm. */
export const textWidth = (s: string, size: number): number => s.length * size * 0.55

// ---- sheet frame ----

export const SHEET = { w: 420, h: 297 }
const BORDER = 10
const TITLE = { w: 160, h: 42 }
/** Length of the print scale check bar, mm on paper. */
const CHECK_BAR = 100
/** Area free for drawings: inside the border, above the title block row. */
export const AREA = { x: 14, y: 14, w: SHEET.w - 28, h: SHEET.h - BORDER - TITLE.h - 2 - 14 }
const GAP = 6

export type Placed = { x: number; y: number; block: Block }

type Col = { x: number; w: number; used: number }
type Row = { y: number; h: number; right: number; cols: Col[] }

/**
 * Packs blocks in order onto as many sheets as needed: rows left to right, top to bottom. A block lower than
 * a finished row may fill the space at that row's right end, or stack under a narrower-or-equal block there.
 */
export function pack(blocks: Block[]): Placed[][] {
  const pages: { rows: Row[]; placed: Placed[] }[] = [{ rows: [], placed: [] }]
  const put = (pg: (typeof pages)[number], x: number, y: number, b: Block) => pg.placed.push({ x: AREA.x + x, y: AREA.y + y, block: b })
  for (const b of blocks) {
    let pg = pages[pages.length - 1]
    let done = false
    for (let i = 0; i < pg.rows.length && !done; i++) {
      const row = pg.rows[i]
      const last = i === pg.rows.length - 1
      for (let k = 0; k < row.cols.length; k++) {
        const c = row.cols[k]
        const room = (k + 1 < row.cols.length ? row.cols[k + 1].x - GAP : AREA.w) - c.x
        if (b.w <= room && c.used + GAP + b.h <= row.h) {
          put(pg, c.x, row.y + c.used + GAP, b)
          c.used += GAP + b.h
          c.w = Math.max(c.w, b.w)
          if (k === row.cols.length - 1) row.right = Math.max(row.right, c.x + c.w + GAP)
          done = true
          break
        }
      }
      if (!done && row.right + b.w <= AREA.w && (b.h <= row.h || (last && row.y + b.h <= AREA.h))) {
        put(pg, row.right, row.y, b)
        row.cols.push({ x: row.right, w: b.w, used: b.h })
        row.right += b.w + GAP
        row.h = Math.max(row.h, b.h)
        done = true
      }
    }
    if (done) continue
    const lastRow = pg.rows[pg.rows.length - 1]
    let y = lastRow ? lastRow.y + lastRow.h + GAP : 0
    if (lastRow && y + b.h > AREA.h) {
      pg = { rows: [], placed: [] }
      pages.push(pg)
      y = 0
    }
    put(pg, 0, y, b)
    pg.rows.push({ y, h: b.h, right: b.w + GAP, cols: [{ x: 0, w: b.w, used: b.h }] })
  }
  return pages.map((p) => p.placed)
}

/** True when the blocks fit on a single sheet. */
export const fitsOne = (blocks: Block[]): boolean =>
  blocks.every((b) => b.w <= AREA.w && b.h <= AREA.h) && pack(blocks).length === 1

const STYLE = [
  'text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;fill:#222}',
  '.o{fill:none;stroke:#222;stroke-width:.35}',
  '.t{fill:none;stroke:#666;stroke-width:.18}',
  '.h{fill:none;stroke:#666;stroke-width:.25;stroke-dasharray:1.6 1}',
  '.c{fill:none;stroke:#666;stroke-width:.2;stroke-dasharray:4 1 .6 1}',
  '.sec{fill:#e4e4e4;stroke:#222;stroke-width:.3}',
  '.mk{fill:#333;stroke:none}',
  '.dot{fill:#444;stroke:none}',
  '.bal{fill:#fff;stroke:#222;stroke-width:.3}',
  '.bid{font-weight:600}',
  '.ref{fill:#555;font-style:italic}',
  '.hd{font-weight:600}',
  '.fr{fill:none;stroke:#222;stroke-width:.5}',
].join('')

export type Frame = {
  title: string
  name: string
  version?: number | string
  sheet: number
  sheets: number
  scaleN: number
  date: string
  notes: string[]
}

/** Bottom row of the title block: a bar CHECK_BAR mm long with 10 mm ticks, to measure on the print. */
function scaleCheck(tx: number, y: number, t: (x: number, y: number, s: string, size: number) => string): string {
  const x0 = tx + 3, bar = y + 3.5
  const ticks = Array.from({ length: CHECK_BAR / 10 + 1 }, (_, i) => {
    const x = x0 + i * 10
    const top = i % 5 === 0 ? bar - 2 : bar - 1.2
    return `<line class="o" data-scale-tick="1" x1="${n2(x)}" y1="${n2(top)}" x2="${n2(x)}" y2="${n2(bar)}"/>`
  })
  return [
    `<line class="o" x1="${tx}" y1="${y}" x2="${tx + TITLE.w}" y2="${y}"/>`,
    `<line class="o" data-scale-check="${CHECK_BAR}" x1="${n2(x0)}" y1="${n2(bar)}" x2="${n2(x0 + CHECK_BAR)}" y2="${n2(bar)}"/>`,
    ...ticks,
    t(x0, y + 8, `${CHECK_BAR} mm at 1:1 on paper: measure to check print scale`, 2.2),
  ].join('')
}

/** The A3 sheet: border, drawings, notes and title block. */
export function sheetSvg(f: Frame, placed: Placed[]): string {
  const body = placed.map((p) => `<g transform="translate(${n2(p.x)} ${n2(p.y)})">${p.block.svg}</g>`).join('')
  const tx = SHEET.w - BORDER - TITLE.w, ty = SHEET.h - BORDER - TITLE.h
  const version = f.version === undefined ? 'working copy' : typeof f.version === 'number' ? `v${f.version}` : f.version
  const t = (x: number, y: number, s: string, size: number, cls = '') =>
    `<text${cls ? ` class="${cls}"` : ''} x="${n2(x)}" y="${n2(y)}" font-size="${size}">${esc(s)}</text>`
  const title = [
    `<rect class="fr" x="${tx}" y="${ty}" width="${TITLE.w}" height="${TITLE.h}"/>`,
    `<line class="o" x1="${tx}" y1="${ty + 13}" x2="${tx + TITLE.w}" y2="${ty + 13}"/>`,
    `<line class="o" x1="${tx + 80}" y1="${ty + 13}" x2="${tx + 80}" y2="${ty + TITLE.h}"/>`,
    t(tx + 3, ty + 6, f.name, 3.6, 'hd'),
    t(tx + 3, ty + 11, f.title, 3),
    t(tx + 3, ty + 19, version, 2.6),
    t(tx + 3, ty + 24, f.date, 2.6),
    t(tx + 3, ty + 29, 'All dimensions mm', 2.6),
    t(tx + 83, ty + 19, `Sheet ${f.sheet}/${f.sheets}`, 2.6),
    t(tx + 83, ty + 24, `Scale 1:${f.scaleN}`, 2.6),
    t(tx + 83, ty + 29, 'Print at 100% on A3', 2.6),
    scaleCheck(tx, ty + 32, t),
  ].join('')
  const notes = f.notes.map((n, i) => t(BORDER + 4, ty + 5 + i * 4, n, 2.5)).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.w}mm" height="${SHEET.h}mm" viewBox="0 0 ${SHEET.w} ${SHEET.h}">`,
    `<style>${STYLE}</style>`,
    `<rect x="0" y="0" width="${SHEET.w}" height="${SHEET.h}" fill="#fff"/>`,
    `<rect class="fr" x="${BORDER}" y="${BORDER}" width="${SHEET.w - 2 * BORDER}" height="${SHEET.h - 2 * BORDER}"/>`,
    body, notes, title, '</svg>',
  ].join('')
}
