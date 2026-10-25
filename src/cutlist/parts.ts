import { doorLayout } from '../doors/doors'
import { doorParts } from './doorParts'
import { doorWall } from '../doors/side'
import { boxBounds, boxPart, cavityOutside, facetSpan, mitreAngle, wallBoxes, wallSpan, type BoxPanel } from '../geometry/boxes'
import { resolveDims } from '../geometry/dimensions'
import { packingDepth, panelLength, steps } from '../geometry/facets'
import { clampTo, panelPlane } from '../geometry/panels'
import { panelTreatments, wallTreatments } from '../geometry/treatments'
import { activeInterior, wallPlaneAxes, WALLS } from '../geometry/walls'
import { CLIP_GRID, DECOUPLING_STRIP_MATERIAL, materialOrFirst, PACKER_WIDTH } from '../model/defaults'
import type { Design, Library, Shop, WallId } from '../model/schema'

export type BuildStep = 'shell' | 'middle' | 'liner' | 'facets' | 'panels' | 'treatment' | 'doors'
export type Bevel = { edge: 'L1' | 'L2' | 'W1' | 'W2'; angle: number }
export type PartKind = 'panel' | 'roll' | 'strip' | 'packer' | 'filler' | 'wedge' | 'frame' | 'leaf'
export type Part = {
  id: string
  name: string
  materialId: string
  thickness: number
  length: number
  width: number
  bevels: Bevel[]
  qty: number
  step: BuildStep
  kind: PartKind
  notes: string[]
  warnings: string[]
}
/** `type`: the library hinge or latch the line counts, for its weight. */
export type HardwareItem = {
  name: string
  qty: number
  unit: 'pcs' | 'm'
  step?: BuildStep
  type?: { kind: 'hinge' | 'latch'; id: string }
}

export const STEP_ORDER: BuildStep[] = ['shell', 'middle', 'liner', 'facets', 'panels', 'treatment', 'doors']

const STRIP_WIDTH = 50

const r05 = (n: number) => Math.round(n * 2) / 2
const r01 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (n: number) => String(r01(n))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Draft = Omit<Part, 'id' | 'warnings' | 'qty' | 'bevels' | 'notes' | 'kind' | 'length' | 'width'> & {
  a: number
  b: number
  kind?: PartKind
  qty?: number
  bevels?: Bevel[]
  /** Bevel on edges running along side `a` or `b` of the draft; mapped to L/W edges once the sides are ordered. */
  tilt?: { angle: number; along: 'a' | 'b'; both: boolean }
  /** Wall layer parts: merged across walls, the name lists the walls. */
  wall?: WallId
  rest?: string
  notes?: string[]
}

export function buildParts(d: Design, lib: Library, shop: Shop): { parts: Part[]; hardware: HardwareItem[] } {
  const drafts: Draft[] = []
  const hw = new Map<string, HardwareItem>()
  const addHw = (name: string, qty: number, unit: 'pcs' | 'm', step?: BuildStep, type?: HardwareItem['type']) => {
    const key = `${name}|${step ?? ''}|${type ? `${type.kind}:${type.id}` : ''}`
    const cur = hw.get(key)
    if (cur) cur.qty += qty
    else hw.set(key, { name, qty, unit, ...(step ? { step } : {}), ...(type ? { type } : {}) })
  }
  const { inner } = resolveDims(d)
  const door = doorLayout(d, lib)
  const dw = doorWall(d)
  const matName = (id: string) => lib.materials.find((m) => m.id === id)?.name ?? id
  const matKind = (id: string) => lib.materials.find((m) => m.id === id)?.kind

  const rollNote = (materialId: string, thickness: number, width: number): string | null => {
    const stock = shop.sheets.filter((s) => s.materialId === materialId && s.length === 0)
    const s = stock.find((x) => x.thickness === thickness) ?? stock[0]
    if (!s) return null
    const step = s.width - shop.rollOverlap
    const n = width <= s.width || step <= 0 ? 1 : 1 + Math.ceil((width - s.width) / step)
    return `roll width ${num(s.width)}, ${n} ${n === 1 ? 'strip' : 'strips'}, overlap ${num(shop.rollOverlap)}`
  }

  const push = (dr: Draft) => drafts.push(dr)

  const spanOf = ([o0, o1]: [number, number]) => Math.max(0, o1 - o0)

  // ---- wall boxes: one per leaf group, outermost first (shell, middle boxes, liner) ----
  const boxes = boxBounds(d).length
  const panels = wallBoxes(d, lib)
  const extentOf = (p: BoxPanel) => ({
    a: p.max[p.lengthAxis] - p.min[p.lengthAxis],
    b: p.max[p.widthAxis] - p.min[p.widthAxis],
  })
  const doorNote = (p: BoxPanel): string[] => {
    if (p.wall !== dw) return []
    if (door.kind === 'wall') return ['hinged wall: see doors step']
    if (!p.cutout) return []
    const [u, v] = [p.cutout.u1 - p.cutout.u0, p.cutout.v1 - p.cutout.v0]
    const [w, h] = p.lengthAxis === 'y' ? [v, u] : [u, v]
    const notes = [`cut opening ${num(w)}×${num(h)} centred`]
    if (p.rebate) notes.push(`rout rebate ${num(p.rebate.depth)} mm deep × ${num(p.rebate.width)} mm wide around the opening on the inner face`)
    return notes
  }

  const stripMaterial = materialOrFirst(lib, DECOUPLING_STRIP_MATERIAL, ['roll'])
  const decoupled = new Set<string>()
  for (const p of panels) {
    const part = boxPart(p.boxIndex, boxes)
    const label = part === 'middle' ? `middle box ${p.boxIndex}` : part
    const { a, b } = extentOf(p)
    const rest = `${label}, layer ${p.layerIndex + 1} (${matName(p.materialId)})`
    push({
      name: `${cap(p.wall)} ${rest}`, wall: p.wall, rest,
      materialId: p.materialId, thickness: p.thickness, a, b, step: part,
      bevels: p.joinedEdges.filter((e) => e.kind === 'mitre').map((e) => ({ edge: e.edge, angle: mitreAngle(p, e.edge) })),
      notes: doorNote(p),
    })
    // Decoupling of an inner box from the box outside it, once per wall and box.
    const key = `${p.wall} ${p.boxIndex}`
    const gap = decoupled.has(key) ? null : cavityOutside(d, p.wall, p.boxIndex)
    decoupled.add(key)
    if (!gap) continue
    const [L, W] = [Math.max(a, b), Math.min(a, b)]
    if (gap.decoupling === 'strips') {
      push({
        name: 'Decoupling strip', materialId: stripMaterial, thickness: gap.width, a: L, b: STRIP_WIDTH,
        qty: 2, step: part, kind: 'strip', notes: [`around the ${label} panel perimeter`],
      })
      push({
        name: 'Decoupling strip', materialId: stripMaterial, thickness: gap.width,
        a: Math.max(W - 2 * STRIP_WIDTH, 0), b: STRIP_WIDTH, qty: 2, step: part, kind: 'strip',
        notes: [`around the ${label} panel perimeter`],
      })
    } else {
      addHw('Isolation clip', Math.max(4, (Math.floor(L / CLIP_GRID) + 1) * (Math.floor(W / CLIP_GRID) + 1)), 'pcs', part)
    }
  }

  // ---- facets ----
  let sealant = 0
  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    if (!wi) continue
    const { o0, o1 } = facetSpan(d, w)
    const sp = spanOf([o0, o1])
    const label = cap(w)
    wi.facets.forEach((f, i) => {
      const pd = packingDepth(f)
      const tilt = r01(f.tilt)
      push({
        name: `${label} facet ${i + 1}`, materialId: wi.panelMaterialId, thickness: wi.panelThickness,
        a: panelLength(f), b: sp, step: 'facets', tilt: { angle: tilt, along: 'b', both: true },
      })
      const flat = r2(pd) <= 0
      if (!flat) {
        push({
          name: `${label} packer ${i + 1}`, materialId: wi.panelMaterialId, thickness: r2(pd), a: sp, b: PACKER_WIDTH,
          step: 'facets', kind: 'packer', tilt: { angle: tilt, along: 'a', both: false }, notes: ['at the free edge'],
        })
      }
      if (wi.behind === 'insulation' && !flat) {
        push({
          name: `${label} bay fill ${i + 1}`, materialId: materialOrFirst(lib, 'rockwool', ['fill']), thickness: r2(pd),
          a: f.width, b: sp, step: 'facets', kind: 'filler', notes: ['cut to a wedge, tapering to the hinge edge'],
        })
      }
      if (wi.closure === 'fillers' && !flat) {
        push({
          name: `${label} end wedge ${i + 1}`, materialId: wi.panelMaterialId, thickness: wi.panelThickness,
          a: f.width, b: pd, qty: 2, step: 'facets', kind: 'wedge', notes: ['triangle: legs width and packing depth'],
        })
      }
      if (wi.closure === 'sealant') sealant += 2 * (f.width + pd + panelLength(f))
    })
    if (wi.closure === 'fillers') {
      steps(wi).forEach(({ delta }, i) => {
        if (r05(Math.abs(delta)) <= 0) return
        push({
          name: `${label} filler strip ${i + 1}`, materialId: wi.panelMaterialId, thickness: wi.panelThickness,
          a: sp, b: Math.abs(delta), step: 'facets', kind: 'filler',
        })
      })
    } else {
      sealant += steps(wi).length * sp
    }
  }
  if (sealant > 0) addHw('Sealant bead', r2(sealant / 1000), 'm')

  // ---- inner panels ----
  const faceOf = (p: Design['panels'][number]) => {
    const [u, v] = panelPlane(p.normal)
    const a = clampTo(Math.max(p.u0, p.u1), inner[u]) - clampTo(Math.min(p.u0, p.u1), inner[u])
    const b = clampTo(Math.max(p.v0, p.v1), inner[v]) - clampTo(Math.min(p.v0, p.v1), inner[v])
    return { a, b }
  }
  d.panels.forEach((p, i) => {
    const { a, b } = faceOf(p)
    p.layers.forEach((l, k) => {
      push({ name: `Panel ${i + 1} layer ${k + 1}`, materialId: l.materialId, thickness: l.thickness, a, b, step: 'panels' })
    })
    if (p.insulation) {
      push({
        name: `Panel ${i + 1} insulation`, materialId: p.insulation.materialId, thickness: p.insulation.thickness,
        a, b, step: 'panels', kind: 'filler',
      })
    }
  })

  // ---- treatments ----
  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    wallTreatments(d, w).forEach((t, k) => {
      const name = `${cap(w)} treatment ${k + 1}`
      if (wi) {
        const { o0, o1 } = facetSpan(d, w)
        const sp = spanOf([o0, o1])
        wi.facets.forEach((f, i) => {
          push({
            name: `${name} facet ${i + 1}`, materialId: t.materialId, thickness: t.thickness, a: panelLength(f), b: sp,
            step: 'treatment', tilt: { angle: r01(f.tilt), along: 'b', both: true },
          })
        })
      } else {
        const [u, v] = wallPlaneAxes(w)
        push({ name, materialId: t.materialId, thickness: t.thickness, a: spanOf(wallSpan(d, w, u)), b: spanOf(wallSpan(d, w, v)), step: 'treatment' })
      }
    })
  }
  d.panels.forEach((p, i) => {
    const { a, b } = faceOf(p)
    for (const side of ['neg', 'pos'] as const) {
      panelTreatments(d, p.id, side).forEach((t, k) => {
        push({
          name: `Panel ${i + 1} treatment ${side === 'neg' ? 'low' : 'high'} side ${k + 1}`,
          materialId: t.materialId, thickness: t.thickness, a, b, step: 'treatment',
        })
      })
    }
  })

  // ---- doors ----
  const dp = doorParts(d, lib)
  for (const p of dp.parts) {
    push({
      name: p.name, materialId: p.materialId, thickness: p.thickness, a: p.length, b: p.width, step: 'doors',
      kind: p.kind, qty: p.qty, notes: p.notes,
    })
  }
  for (const h of dp.hardware) addHw(h.name, h.qty, h.unit, undefined, h.type)

  // ---- finish: kinds, rounding, warnings, merge, ids ----
  const finished: Part[] = drafts.map((dr) => {
    const length = r05(Math.max(dr.a, dr.b))
    const width = r05(Math.min(dr.a, dr.b))
    const notes = [...(dr.notes ?? [])]
    let kind: PartKind = dr.kind ?? 'panel'
    if (kind === 'panel' && matKind(dr.materialId) === 'roll') {
      kind = 'roll'
      const n = rollNote(dr.materialId, dr.thickness, width)
      if (n) notes.unshift(n)
    }
    const bevels = (dr.bevels ?? []).map((b) => ({ ...b, angle: r01(b.angle) }))
    if (dr.tilt && r01(dr.tilt.angle) > 0) {
      // Edges running along the side that ended up as the length are L edges, otherwise W edges.
      const lengthIsA = dr.a >= dr.b
      const isLong = (dr.tilt.along === 'a') === lengthIsA
      const edges: Bevel['edge'][] = isLong ? ['L1', 'L2'] : ['W1', 'W2']
      for (const edge of dr.tilt.both ? edges : edges.slice(0, 1)) bevels.push({ edge, angle: r01(dr.tilt.angle) })
    }
    const warnings: string[] = []
    for (const angle of new Set(bevels.map((b) => b.angle))) {
      if (angle > shop.maxBevel) {
        warnings.push(`Bevel ${angle}° exceeds your saw's ${num(shop.maxBevel)}°: cut the complement ${r01(90 - angle)}° or use a packer strip`)
      }
    }
    if (length < shop.minPart || width < shop.minPart) warnings.push('Below minimum part size')
    return {
      id: '', name: dr.name, materialId: dr.materialId, thickness: dr.thickness, length, width, bevels,
      qty: dr.qty ?? 1, step: dr.step, kind, notes, warnings,
    }
  })

  const merged = new Map<string, { part: Part; walls: WallId[]; rest?: string }>()
  finished.forEach((p, i) => {
    const { wall, rest } = drafts[i]
    const key = JSON.stringify({ ...p, name: rest ?? p.name, qty: 0 })
    const cur = merged.get(key)
    if (cur) {
      cur.part.qty += p.qty
      if (wall) cur.walls.push(wall)
    } else {
      merged.set(key, { part: { ...p }, walls: wall ? [wall] : [], rest })
    }
  })
  for (const { part, walls, rest } of merged.values()) {
    if (rest === undefined) continue
    const ws = [...new Set(walls)].sort((x, y) => WALLS.indexOf(x) - WALLS.indexOf(y))
    part.name = `${ws.map(cap).join('/')} ${rest}`
  }
  const parts = [...merged.values()].map((m) => m.part).sort(
    (x, y) =>
      STEP_ORDER.indexOf(x.step) - STEP_ORDER.indexOf(y.step) ||
      x.name.localeCompare(y.name, undefined, { numeric: true }) ||
      x.thickness - y.thickness,
  )
  parts.forEach((p, i) => { p.id = `P${i + 1}` })
  return { parts, hardware: [...hw.values()] }
}
