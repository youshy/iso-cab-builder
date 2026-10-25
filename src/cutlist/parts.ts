import { doorLayout } from '../doors/doors'
import { doorWall } from '../doors/side'
import { resolveDims } from '../geometry/dimensions'
import { packingDepth, panelLength, steps } from '../geometry/facets'
import { clampTo, panelPlane } from '../geometry/panels'
import { panelTreatments, wallIntrusion, wallTreatments } from '../geometry/treatments'
import { activeInterior, splitStack, stackThickness, wallPlaneAxes, wallStack, WALLS } from '../geometry/walls'
import { materialOrFirst } from '../model/defaults'
import type { Axis, Design, Layer, Library, Shop, Vec3, WallId } from '../model/schema'

export type BuildStep = 'shell' | 'liner' | 'facets' | 'panels' | 'treatment' | 'doors'
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
export type HardwareItem = { name: string; qty: number; unit: 'pcs' | 'm' }

export const STEP_ORDER: BuildStep[] = ['shell', 'liner', 'facets', 'panels', 'treatment', 'doors']

const STRIP_WIDTH = 50
const CLIP_GRID = 400
const PACKER_WIDTH = 40
const DECOUPLING_STRIP_MATERIAL = 'rubber'
/** Walls abutting earlier in this order run through; later ones are cut short. The front wall comes last. */
const PRIORITY: WallId[] = ['back', 'left', 'right', 'top', 'bottom', 'front']
const AXIS_WALLS: Record<Axis, [WallId, WallId]> = { x: ['left', 'right'], y: ['bottom', 'top'], z: ['back', 'front'] }
const NAME: Record<WallId, string> = { left: 'side', right: 'side', top: 'top/bottom', bottom: 'top/bottom', back: 'back', front: 'front' }

const r05 = (n: number) => Math.round(n * 2) / 2
const r01 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (n: number) => String(r01(n))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const rad = (deg: number) => (deg * Math.PI) / 180
const sum = (ls: { thickness: number }[]) => ls.reduce((a, l) => a + l.thickness, 0)

type Draft = Omit<Part, 'id' | 'warnings' | 'qty' | 'bevels' | 'notes' | 'kind' | 'length' | 'width'> & {
  a: number
  b: number
  kind?: PartKind
  qty?: number
  bevels?: Bevel[]
  notes?: string[]
}

/** Dimensions and notes of one wall's panel in a box of cavity `c` and per-wall thickness `t`. */
function boxPanel(w: WallId, c: Vec3, t: Record<WallId, number>, joint: Design['joint']): { a: number; b: number; notes: string[]; mitre: boolean } {
  const o: Vec3 = { x: c.x + t.left + t.right, y: c.y + t.bottom + t.top, z: c.z + t.back + t.front }
  const half = (...ws: WallId[]) => ws.reduce((a, k) => a + t[k] / 2, 0)
  const rebate = (wall: WallId, edges: string) => {
    const tt = t[wall]
    return [`rebate ${num(tt / 2)} × ${num(tt)} on ${edges}`]
  }
  const m = joint === 'mitre'
  switch (w) {
    case 'left': case 'right':
      if (joint === 'tops-past') return { a: c.y, b: o.z, notes: [], mitre: false }
      return { a: o.y, b: o.z, notes: [], mitre: m }
    case 'top': case 'bottom':
      if (m) return { a: o.x, b: o.z, notes: [], mitre: true }
      if (joint === 'sides-past') return { a: c.x, b: o.z, notes: [], mitre: false }
      if (joint === 'rebate') return { a: c.x + half('left', 'right'), b: o.z, notes: rebate(w, 'left and right edges'), mitre: false }
      return { a: o.x, b: o.z, notes: [], mitre: false }
    default: // back, front
      if (m) return { a: o.x, b: o.y, notes: [], mitre: true }
      if (joint === 'rebate') {
        return { a: c.x + half('left', 'right'), b: c.y + half('bottom', 'top'), notes: rebate(w, 'all four edges'), mitre: false }
      }
      return { a: c.x, b: c.y, notes: [], mitre: false }
  }
}

export function buildParts(d: Design, lib: Library, shop: Shop): { parts: Part[]; hardware: HardwareItem[] } {
  const drafts: Draft[] = []
  const hw = new Map<string, HardwareItem>()
  const addHw = (name: string, qty: number, unit: 'pcs' | 'm') => {
    const cur = hw.get(name)
    if (cur) cur.qty += qty
    else hw.set(name, { name, qty, unit })
  }
  const { inner } = resolveDims(d)
  const door = doorLayout(d, lib)
  const dw = doorWall(d)
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

  /** Reduction of a wall's span along `axis`: earlier walls at both ends reach in by their intrusion. */
  const shorten = (w: WallId, axis: Axis) =>
    AXIS_WALLS[axis].reduce((a, e) => (PRIORITY.indexOf(e) < PRIORITY.indexOf(w) ? a + wallIntrusion(d, e) : a), 0)
  const span = (w: WallId, axis: Axis) => Math.max(0, inner[axis] - shorten(w, axis))

  // ---- shell and liner boxes ----
  const T = (pick: (w: WallId) => number) => Object.fromEntries(WALLS.map((w) => [w, pick(w)])) as Record<WallId, number>
  const split = Object.fromEntries(WALLS.map((w) => [w, splitStack(wallStack(d, w))])) as Record<WallId, ReturnType<typeof splitStack>>
  const tShell = T((w) => sum(split[w].shell))
  const tLiner = T((w) => sum(split[w].liner))
  const tGap = T((w) => split[w].gap?.width ?? 0)
  const lowHigh = (a: Axis) => AXIS_WALLS[a]
  const shellCavity = Object.fromEntries(
    (['x', 'y', 'z'] as Axis[]).map((a) => [a, inner[a] + lowHigh(a).reduce((s, w) => s + tGap[w] + tLiner[w], 0)]),
  ) as unknown as Vec3

  const doorNote = (w: WallId, part: 'shell' | 'liner'): string[] => {
    if (w !== dw) return []
    if (door.kind === 'wall') return ['hinged wall: see doors step']
    const leaf = part === 'liner' ? door.inner : door.outer
    if (!leaf) return []
    return [`cut opening ${num(leaf.cutout.w)}×${num(leaf.cutout.h)} centred`]
  }

  const addBox = (part: 'shell' | 'liner', cavity: Vec3, t: Record<WallId, number>) => {
    for (const w of WALLS) {
      const layers: Layer[] = split[w][part]
      if (layers.length === 0 || t[w] <= 0) continue
      const bp = boxPanel(w, cavity, t, d.joint)
      const bevels: Bevel[] = bp.mitre
        ? [{ edge: 'L1', angle: 45 }, { edge: 'L2', angle: 45 }, { edge: 'W1', angle: 45 }, { edge: 'W2', angle: 45 }]
        : []
      layers.forEach((l, k) => {
        push({
          name: `${cap(part)} ${NAME[w]}${layers.length > 1 || split[w].gap ? `, layer ${k + 1}` : ''}`,
          materialId: l.materialId, thickness: l.thickness, a: bp.a, b: bp.b, step: part, bevels,
          notes: [...bp.notes, ...doorNote(w, part)],
        })
      })
      const gap = split[w].gap
      if (part === 'liner' && gap) {
        const [L, W] = [Math.max(bp.a, bp.b), Math.min(bp.a, bp.b)]
        if (gap.decoupling === 'strips') {
          push({
            name: 'Decoupling strip', materialId: DECOUPLING_STRIP_MATERIAL, thickness: gap.width, a: L, b: STRIP_WIDTH,
            qty: 2, step: 'liner', kind: 'strip', notes: ['around the liner panel perimeter'],
          })
          push({
            name: 'Decoupling strip', materialId: DECOUPLING_STRIP_MATERIAL, thickness: gap.width,
            a: Math.max(W - 2 * STRIP_WIDTH, 0), b: STRIP_WIDTH, qty: 2, step: 'liner', kind: 'strip',
            notes: ['around the liner panel perimeter'],
          })
        } else {
          addHw('Isolation clip', Math.max(4, Math.ceil(L / CLIP_GRID) * Math.ceil(W / CLIP_GRID)), 'pcs')
        }
      }
    }
  }
  addBox('shell', shellCavity, tShell)
  addBox('liner', inner, tLiner)

  // ---- facets ----
  let sealant = 0
  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    if (!wi) continue
    const o = wallPlaneAxes(w).find((a) => a !== wi.splitAxis)!
    const sp = span(w, o)
    const label = cap(w)
    wi.facets.forEach((f, i) => {
      const pd = packingDepth(f)
      const tilt = r01(f.tilt)
      push({
        name: `${label} facet ${i + 1}`, materialId: wi.panelMaterialId, thickness: wi.panelThickness,
        a: panelLength(f), b: sp, step: 'facets',
        bevels: [{ edge: 'L1', angle: tilt }, { edge: 'L2', angle: tilt }],
      })
      push({
        name: `${label} packer ${i + 1}`, materialId: wi.panelMaterialId, thickness: r2(pd), a: sp, b: PACKER_WIDTH,
        step: 'facets', kind: 'packer', bevels: [{ edge: 'L1', angle: tilt }], notes: ['at the free edge'],
      })
      if (wi.behind === 'insulation') {
        push({
          name: `${label} bay fill ${i + 1}`, materialId: materialOrFirst(lib, 'rockwool', ['fill']), thickness: r2(pd),
          a: f.width, b: sp, step: 'facets', kind: 'filler', notes: ['cut to a wedge, tapering to the hinge edge'],
        })
      }
      if (wi.closure === 'fillers' && pd > 0) {
        push({
          name: `${label} end wedge ${i + 1}`, materialId: wi.panelMaterialId, thickness: wi.panelThickness,
          a: f.width, b: pd, qty: 2, step: 'facets', kind: 'wedge', notes: ['triangle: legs width and packing depth'],
        })
      }
      if (wi.closure === 'sealant') sealant += 2 * (f.width + pd + panelLength(f))
    })
    if (wi.closure === 'fillers') {
      steps(wi).forEach(({ delta }, i) => {
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
        const o = wallPlaneAxes(w).find((a) => a !== wi.splitAxis)!
        const sp = span(w, o)
        wi.facets.forEach((f, i) => {
          push({
            name: `${name} facet ${i + 1}`, materialId: t.materialId, thickness: t.thickness, a: panelLength(f), b: sp,
            step: 'treatment',
            bevels: f.tilt > 0 ? [{ edge: 'L1', angle: r01(f.tilt) }, { edge: 'L2', angle: r01(f.tilt) }] : [],
          })
        })
      } else {
        const [u, v] = wallPlaneAxes(w)
        push({ name, materialId: t.materialId, thickness: t.thickness, a: span(w, u), b: span(w, v), step: 'treatment' })
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

  const merged = new Map<string, Part>()
  for (const p of finished) {
    const key = JSON.stringify({ ...p, qty: 0 })
    const cur = merged.get(key)
    if (cur) cur.qty += p.qty
    else merged.set(key, { ...p })
  }
  const parts = [...merged.values()].sort(
    (x, y) =>
      STEP_ORDER.indexOf(x.step) - STEP_ORDER.indexOf(y.step) ||
      x.name.localeCompare(y.name, undefined, { numeric: true }) ||
      x.thickness - y.thickness,
  )
  parts.forEach((p, i) => { p.id = `P${i + 1}` })
  return { parts, hardware: [...hw.values()] }
}
