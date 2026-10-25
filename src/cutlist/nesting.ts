import type { SheetStock, Shop } from '../model/schema'
import type { Part } from './parts'

export type Placement = { partId: string; instance: number; x: number; y: number; w: number; h: number; rotated: boolean }
export type NestSheet = { placements: Placement[] }
export type NestGroup = { materialId: string; thickness: number; stock: SheetStock | null; sheets: NestSheet[]; wastePct: number }
export type NestResult = { groups: NestGroup[]; unplaced: { partId: string; reason: string }[] }

type Rect = { x: number; y: number; w: number; h: number }
type Item = { partId: string; instance: number; length: number; width: number }

const THICKNESS_TOL = 0.01

/** Guillotine split of free rect `f` after placing w x h in its corner; keeps the larger leftover whole. */
function split(f: Rect, w: number, h: number, kerf: number): Rect[] {
  const rw = f.w - w - kerf
  const bh = f.h - h - kerf
  // A: right strip full height, bottom strip under the part only. B: right strip beside the part only, bottom strip full width.
  const a: Rect[] = [
    { x: f.x + w + kerf, y: f.y, w: rw, h: f.h },
    { x: f.x, y: f.y + h + kerf, w, h: bh },
  ]
  const b: Rect[] = [
    { x: f.x + w + kerf, y: f.y, w: rw, h },
    { x: f.x, y: f.y + h + kerf, w: f.w, h: bh },
  ]
  const biggest = (rs: Rect[]) => Math.max(...rs.map((r) => (r.w > 0 && r.h > 0 ? r.w * r.h : 0)))
  return (biggest(a) >= biggest(b) ? a : b).filter((r) => r.w > 0 && r.h > 0)
}

type SheetState = { placements: Placement[]; free: Rect[] }

function tryPlace(sheets: SheetState[], it: Item, kerf: number): boolean {
  let best: { s: SheetState; fi: number; rotated: boolean; area: number } | null = null
  for (const s of sheets) {
    s.free.forEach((f, fi) => {
      for (const rotated of [false, true]) {
        const w = rotated ? it.width : it.length
        const h = rotated ? it.length : it.width
        if (w <= f.w + 1e-9 && h <= f.h + 1e-9) {
          const area = f.w * f.h
          if (!best || area < best.area) best = { s, fi, rotated, area }
        }
      }
    })
  }
  if (!best) return false
  const { s, fi, rotated } = best as { s: SheetState; fi: number; rotated: boolean }
  const f = s.free[fi]
  const w = rotated ? it.width : it.length
  const h = rotated ? it.length : it.width
  s.placements.push({ partId: it.partId, instance: it.instance, x: f.x, y: f.y, w, h, rotated })
  s.free.splice(fi, 1, ...split(f, w, h, kerf))
  return true
}

const fits = (it: Item, st: SheetStock) =>
  (it.length <= st.length && it.width <= st.width) || (it.width <= st.length && it.length <= st.width)

export function nest(parts: Part[], shop: Shop): NestResult {
  const unplaced: NestResult['unplaced'] = []
  const byGroup = new Map<string, { materialId: string; thickness: number; items: Item[] }>()
  for (const p of parts) {
    if (p.kind === 'roll') continue
    if (p.kind === 'wedge') {
      unplaced.push({ partId: p.id, reason: 'cut from offcuts' })
      continue
    }
    const key = `${p.materialId}|${Math.round(p.thickness / THICKNESS_TOL)}`
    let g = byGroup.get(key)
    if (!g) byGroup.set(key, (g = { materialId: p.materialId, thickness: p.thickness, items: [] }))
    for (let i = 0; i < p.qty; i++) g.items.push({ partId: p.id, instance: i, length: p.length, width: p.width })
  }

  const groups: NestGroup[] = []
  for (const g of byGroup.values()) {
    const stocks = shop.sheets.filter(
      (s) => s.materialId === g.materialId && Math.abs(s.thickness - g.thickness) <= THICKNESS_TOL && s.length > 0 && s.width > 0,
    )
    if (!stocks.length) {
      for (const it of g.items) unplaced.push({ partId: it.partId, reason: 'no stock for material/thickness' })
      continue
    }
    const stock = stocks.reduce((a, b) => (b.length * b.width > a.length * a.width ? b : a))
    const sheets: SheetState[] = []
    const items = g.items.slice().sort((a, b) => b.length * b.width - a.length * a.width)
    let used = 0
    for (const it of items) {
      if (!fits(it, stock)) {
        unplaced.push({ partId: it.partId, reason: 'larger than any sheet' })
        continue
      }
      if (!tryPlace(sheets, it, shop.kerf)) {
        sheets.push({ placements: [], free: [{ x: 0, y: 0, w: stock.length, h: stock.width }] })
        tryPlace(sheets, it, shop.kerf)
      }
      used += it.length * it.width
    }
    if (!sheets.length) continue
    const total = sheets.length * stock.length * stock.width
    groups.push({
      materialId: g.materialId,
      thickness: g.thickness,
      stock,
      sheets: sheets.map((s) => ({ placements: s.placements })),
      wastePct: Math.round((1 - used / total) * 1000) / 10,
    })
  }
  return { groups, unplaced }
}
