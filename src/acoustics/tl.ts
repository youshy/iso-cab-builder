import { doorLayout, doorLeafLayers, type LeafLayout } from '../doors/doors'
import { doorWall } from '../doors/side'
import {
  ABSORBER_TL_CAP,
  DEFAULT_FLOW_RESISTIVITY,
  DEFAULT_INSULATION,
  FLOW_RESISTIVITY,
  materialOrFirst,
  SPLIT_GAP,
} from '../model/defaults'
import { resolveDims } from '../geometry/dimensions'
import { meanPackingDepth } from '../geometry/facets'
import { panelTreatments, wallTreatments } from '../geometry/treatments'
import { WALLS, activeInterior, cavities, leafGroups, wallStack } from '../geometry/walls'
import type { Design, Gap, Layer, Library, StackItem, WallId } from '../model/schema'

export const THIRD_OCTAVES = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
]
export const OCTAVES = [125, 250, 500, 1000, 2000, 4000]

export const TL_MODEL_LABEL = {
  single: 'Mass law estimate',
  double: 'Sharp double-leaf estimate',
  multi: 'Multi-leaf estimate (Sharp generalised)',
  absorber: 'Delany-Bazley absorber',
} as const

/** A porous treatment layer on a stack's inner face. Only the TL model uses it; it is not a schema item. */
export interface Absorber {
  kind: 'absorber'
  materialId: string
  thickness: number // mm
}
export type TlItem = StackItem | Absorber

const C = 343
/** dB removed above f0 for model simplifications. */
const EMPTY_FILL_PENALTY = 5
const STRIPS_PENALTY = 3

export interface Leaf {
  m: number // kg/m2
  fc: number // Hz
  eta: number
}

/** Combined leaf properties. Poisson ratio ignored; layers act as one plate with summed stiffness. */
export function leaf(layers: Layer[], lib: Library): Leaf {
  let m = 0
  let b = 0
  let etaMass = 0
  for (const l of layers) {
    const mat = lib.materials.find((x) => x.id === l.materialId)
    if (!mat) continue
    const h = l.thickness / 1000
    const lm = (mat.density * l.thickness) / 1000
    m += lm
    b += (mat.youngsModulus * h ** 3) / 12
    etaMass += mat.lossFactor * lm
  }
  if (m === 0 || b === 0) return { m, fc: Infinity, eta: 0 }
  return { m, fc: (C * C) / (2 * Math.PI) * Math.sqrt(m / b), eta: etaMass / m }
}

const massLaw = (m: number, f: number) => 20 * Math.log10(m * f) - 47

export function tlLeaf(l: Leaf, f: number): number {
  if (l.m <= 0) return 0
  const below = massLaw(l.m, f)
  const atFc = (freq: number) => massLaw(l.m, freq) + 10 * Math.log10((2 * l.eta * freq) / (Math.PI * l.fc))
  if (f < l.fc / 2) return below
  if (f >= l.fc) return atFc(f)
  const lo = massLaw(l.m, l.fc / 2)
  const hi = atFc(l.fc)
  return lo + ((hi - lo) * (f - l.fc / 2)) / (l.fc / 2)
}

export interface TlResult {
  thirds: number[]
  /** Lowest resonance, null for a single leaf. */
  f0: number | null
  /** Every resonance up to 5 kHz, ascending. Single leaf: none; double leaf: [f0]. */
  f0s: number[]
  single: number
  model: string
  /** Lowest coincidence frequency among the leaf groups, Hz; null when no leaf has one. */
  fc: number | null
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function summarize(thirds: number[], f0s: number[], model: string): TlResult {
  const sel = thirds.filter((_, i) => THIRD_OCTAVES[i] >= 100 && THIRD_OCTAVES[i] <= 3150)
  return { thirds, f0: f0s[0] ?? null, f0s, single: mean(sel), model, fc: null }
}

/**
 * Leaves and the cavities between them, outside-in. Leaf groups with no layers are dropped and the
 * cavities either side of them merge (widths add, the first cavity's settings kept); cavities at a
 * face are dropped. Valid stacks never need this, it keeps raw input from producing nonsense.
 */
function chain(items: StackItem[], lib: Library): { leaves: Leaf[]; gaps: Gap[]; layers: Layer[][] } {
  const groups = leafGroups(items)
  const gs = cavities(items)
  const leaves: Leaf[] = []
  const layers: Layer[][] = []
  const gaps: Gap[] = []
  let pending: Gap | null = null
  groups.forEach((g, k) => {
    if (g.length > 0) {
      if (pending && leaves.length > 0) gaps.push(pending)
      leaves.push(leaf(g, lib))
      layers.push(g)
      pending = null
    }
    const next = gs[k]
    if (next) pending = pending ? { ...pending, width: pending.width + next.width } : next
  })
  return { leaves, gaps, layers }
}

/**
 * TL of a stack. Leaves and cavities set the model (mass law, Sharp, generalised Sharp); each absorber
 * then adds its own insertion term (see absorberInsertion) and the model label names it.
 */
export function tlStack(items: TlItem[], lib: Library): TlResult {
  const absorbers = items.filter((i): i is Absorber => i.kind === 'absorber')
  const structure = items.filter((i): i is StackItem => i.kind !== 'absorber')
  const fcs = chain(structure, lib).leaves.map((l) => l.fc).filter(Number.isFinite)
  const fc = fcs.length > 0 ? Math.min(...fcs) : null
  const base = { ...tlStructure(structure, lib), fc }
  if (absorbers.length === 0) return base
  const thirds = base.thirds.map((tl, i) => tl + absorbers.reduce((a, ab) => a + absorberInsertion(ab, THIRD_OCTAVES[i]), 0))
  return { ...summarize(thirds, base.f0s, `${base.model} with ${TL_MODEL_LABEL.absorber}`), fc }
}

function tlStructure(items: StackItem[], lib: Library): TlResult {
  const { leaves, gaps, layers } = chain(items, lib)
  if (gaps.length === 0) {
    const l = leaves[0] ?? { m: 0, fc: Infinity, eta: 0 }
    return summarize(THIRD_OCTAVES.map((f) => tlLeaf(l, f)), [], TL_MODEL_LABEL.single)
  }
  if (gaps.length >= 2) return multiLeaf(leaves, gaps, equivalentDouble(layers, gaps, lib))
  return sharp(leaves[0], leaves[1], gaps[0])
}

/** Mass-air-mass resonances of the stack from the transfer-matrix chain (exported to cross-check Sharp's f0). */
export function chainF0s(items: StackItem[], lib: Library): number[] {
  const { leaves, gaps } = chain(items, lib)
  return gaps.length ? chainResonances(leaves, gaps) : []
}

function sharp(l1: Leaf, l2: Leaf, gap: Gap): TlResult {
  const d = gap.width / 1000
  const f0 = 60 * Math.sqrt((l1.m + l2.m) / (l1.m * l2.m * d))
  const fl = 55 / d
  const penalty = (gap.fill === 'empty' ? EMPTY_FILL_PENALTY : 0) + (gap.decoupling === 'strips' ? STRIPS_PENALTY : 0)
  const thirds = THIRD_OCTAVES.map((f) => {
    const floor = massLaw(l1.m + l2.m, f)
    if (f < f0) return floor
    const sum = tlLeaf(l1, f) + tlLeaf(l2, f)
    const tl = f < fl ? sum + 20 * Math.log10(f * d) - 29 : sum + 6
    return Math.max(tl - penalty, floor)
  })
  return summarize(thirds, [f0], TL_MODEL_LABEL.double)
}

// ---- Multi-leaf (two or more cavities) -----------------------------------------------------------
// TL is the lower of two estimates, floored at the total-mass mass law:
//  (a) Sharp's double-leaf law generalised to N leaves: below the lowest resonance, mass law of the total
//      mass; above it, the sum of each leaf's own TL (with coincidence) plus, per cavity, 20 lg(f d) - 29 up
//      to fl = 55/d and +6 dB above it, less the per-cavity empty-fill and strips penalties of sharp().
//  (b) the equivalent double leaf (outer group | all cavities as one | all other groups combined) by
//      sharp(), plus 3 dB per extra cavity. This keeps extra leaves from gaining more than a few dB over a
//      double wall of the same mass and depth, and keeps the step from one to two cavities small.
// The transfer-matrix chain (normal incidence, limp leaves, lossless air) is used only to find the
// mass-air-mass resonances f0s.

type Cx = [number, number]
const cx = (re: number, im = 0): Cx => [re, im]
const add = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
type M2 = [Cx, Cx, Cx, Cx] // row-major
const mmul = (a: M2, b: M2): M2 => [
  add(mul(a[0], b[0]), mul(a[1], b[2])),
  add(mul(a[0], b[1]), mul(a[1], b[3])),
  add(mul(a[2], b[0]), mul(a[3], b[2])),
  add(mul(a[2], b[1]), mul(a[3], b[3])),
]

const Z0 = 1.21 * C
const RESONANCE_MAX = 5000 // Hz, highest resonance reported
const SCAN_MAX = 20000 // Hz, scan range so every mass-air-mass resonance is found before counting

/** Normal-incidence TL (dB) of the lossless chain of limp leaves and air layers. */
function tlNormal(leaves: Leaf[], gaps: Gap[], f: number): number {
  const w = 2 * Math.PI * f
  let t: M2 = [cx(1), cx(0), cx(0), cx(1)]
  leaves.forEach((l, i) => {
    t = mmul(t, [cx(1), cx(0, w * l.m), cx(0), cx(1)])
    const g = gaps[i]
    if (!g) return
    const kd = (w / C) * (g.width / 1000)
    const c = cx(Math.cos(kd))
    t = mmul(t, [c, cx(0, Z0 * Math.sin(kd)), cx(0, Math.sin(kd) / Z0), c])
  })
  const re = t[0][0] + t[3][0] + t[1][0] / Z0 + t[2][0] * Z0
  const im = t[0][1] + t[3][1] + t[1][1] / Z0 + t[2][1] * Z0
  return 20 * Math.log10(Math.hypot(re, im) / 2)
}

/**
 * Mass-air-mass resonances: the lowest dips of the chain, one per cavity, skipping cavity standing-wave
 * dips (f = n c / 2d), reported up to 5 kHz.
 */
function chainResonances(leaves: Leaf[], gaps: Gap[]): number[] {
  const N = 600
  const lo = Math.log(20)
  const step = (Math.log(SCAN_MAX) - lo) / N
  const tl = (x: number) => tlNormal(leaves, gaps, Math.exp(x))
  const ys = Array.from({ length: N + 1 }, (_, i) => tl(lo + i * step))
  const standing = (f: number) =>
    gaps.some((g) => {
      const n = Math.round(f / (C / (2 * (g.width / 1000))))
      return n >= 1 && Math.abs(f / (n * (C / (2 * (g.width / 1000)))) - 1) < 0.03
    })
  const out: number[] = []
  for (let i = 1; i < N && out.length < gaps.length; i++) {
    if (!(ys[i] < ys[i - 1] && ys[i] <= ys[i + 1])) continue
    // golden-section refine inside the bracketing grid cells
    const g = (Math.sqrt(5) - 1) / 2
    let a = lo + (i - 1) * step
    let b = lo + (i + 1) * step
    let c = b - g * (b - a)
    let d = a + g * (b - a)
    let yc = tl(c)
    let yd = tl(d)
    for (let it = 0; it < 30; it++) {
      if (yc < yd) {
        b = d
        d = c
        yd = yc
        c = b - g * (b - a)
        yc = tl(c)
      } else {
        a = c
        c = d
        yc = yd
        d = a + g * (b - a)
        yd = tl(d)
      }
    }
    const f = Math.exp((a + b) / 2)
    if (!standing(f)) out.push(f)
  }
  return out.filter((f) => f <= RESONANCE_MAX)
}

const EXTRA_CAVITY_CREDIT = 3 // dB per cavity beyond the first, over the equivalent double leaf

/**
 * Sharp double leaf standing in for a multi-cavity stack: the outer group as leaf 1, every other group
 * combined as leaf 2, the summed cavity depth, insulated if any cavity is, the outermost cavity's decoupling.
 */
function equivalentDouble(layers: Layer[][], gaps: Gap[], lib: Library): TlResult {
  const gap: Gap = {
    ...gaps[0],
    width: gaps.reduce((a, g) => a + g.width, 0),
    fill: gaps.some((g) => g.fill === 'insulation') ? 'insulation' : 'empty',
  }
  return sharp(leaf(layers[0], lib), leaf(layers.slice(1).flat(), lib), gap)
}

function multiLeaf(leaves: Leaf[], gaps: Gap[], eq: TlResult): TlResult {
  const f0s = chainResonances(leaves, gaps)
  const fLow = f0s[0] ?? 0
  const M = leaves.reduce((a, l) => a + l.m, 0)
  const credit = EXTRA_CAVITY_CREDIT * (gaps.length - 1)
  const thirds = THIRD_OCTAVES.map((f, i) => {
    const floor = massLaw(M, f)
    let tl = floor
    if (f >= fLow) {
      tl = leaves.reduce((a, l) => a + tlLeaf(l, f), 0)
      for (const g of gaps) {
        const d = g.width / 1000
        tl += f < 55 / d ? 20 * Math.log10(f * d) - 29 : 6
        tl -= (g.fill === 'empty' ? EMPTY_FILL_PENALTY : 0) + (g.decoupling === 'strips' ? STRIPS_PENALTY : 0)
      }
    }
    return Math.max(floor, Math.min(tl, eq.thirds[i] + credit))
  })
  return summarize(thirds, f0s, TL_MODEL_LABEL.multi)
}

// ---- Absorber layers -----------------------------------------------------------------------------
// A porous layer (rigid-frame equivalent fluid, Delany-Bazley 1970 characteristic impedance Zc and
// wavenumber k from the flow resistivity) lying on a heavy leaf. At normal incidence the leaf's
// transmission is divided by |cos(kt) + j (Z0/Zc) sin(kt)|, the impedance step from the leaf into the
// layer and the air beyond. Its insertion term is 20 lg of that: near 0 dB while the layer is thin
// against the wavelength (the leaf still sees the full pressure), tending to 8.686 Im(k) t once the
// layer is lossy over its depth. Floored at 0, capped at ABSORBER_TL_CAP per layer.

/** dB an absorber layer adds to the TL of the stack it lines, at frequency f. */
export function absorberInsertion(ab: Absorber, f: number): number {
  const sigma = FLOW_RESISTIVITY[ab.materialId] ?? DEFAULT_FLOW_RESISTIVITY
  const X = (1.21 * f) / sigma
  const k0 = (2 * Math.PI * f) / C
  const t = ab.thickness / 1000
  // k = k0 (1 + 0.0978 X^-0.7 - j 0.189 X^-0.595), Zc = Z0 (1 + 0.0571 X^-0.754 - j 0.087 X^-0.732)
  const x = k0 * (1 + 0.0978 * X ** -0.7) * t
  const y = -k0 * 0.189 * X ** -0.595 * t
  const zr = 1 + 0.0571 * X ** -0.754
  const zi = -0.087 * X ** -0.732
  const cos: Cx = [Math.cos(x) * Math.cosh(y), -Math.sin(x) * Math.sinh(y)]
  const sin: Cx = [Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y)]
  const den = zr * zr + zi * zi
  const q = mul([zr / den, -zi / den], sin) // (Z0/Zc) sin(kt)
  const il = 20 * Math.log10(Math.hypot(cos[0] - q[1], cos[1] + q[0]))
  return Math.min(Math.max(il, 0), ABSORBER_TL_CAP)
}

// ---- As-built stacks -----------------------------------------------------------------------------

/**
 * Wall stack as built, outside-in: the wall layers, then for active facets a cavity of their mean
 * packing depth (packers bridge it, so strips) and the facet panel, then one absorber per treatment.
 */
export function effectiveWallStack(d: Design, lib: Library, w: WallId): TlItem[] {
  const out: TlItem[] = [...wallStack(d, w)]
  const wi = activeInterior(d, w)
  if (wi) {
    out.push(
      {
        kind: 'gap',
        width: Math.max(meanPackingDepth(wi), 1),
        decoupling: 'strips',
        fill: wi.behind === 'insulation' ? 'insulation' : 'empty',
        fillMaterialId: materialOrFirst(lib, DEFAULT_INSULATION.materialId, ['fill']),
      },
      { kind: 'layer', materialId: wi.panelMaterialId, thickness: wi.panelThickness },
    )
  }
  for (const t of wallTreatments(d, w)) out.push({ kind: 'absorber', materialId: t.materialId, thickness: t.thickness })
  return out
}

/** Sound lock as one stack: outer leaf, between space, inner leaf. Null for a whole-wall door. */
export function doorStack(d: Design, lib: Library): TlItem[] | null {
  const door = doorLayout(d, lib)
  if (!door.outer) return null
  const { outer, inner } = doorLeafLayers(d)
  const gap: Gap = {
    kind: 'gap',
    width: Math.max(door.betweenDepth, 1),
    decoupling: 'clips',
    fill: d.door.between === 'air' ? 'empty' : 'insulation',
    fillMaterialId: materialOrFirst(lib, DEFAULT_INSULATION.materialId, ['fill']),
  }
  return [...outer, gap, ...inner]
}

/** Energy mean of the three thirds centred on each octave. */
export function toOctaves(thirds: number[]): number[] {
  return OCTAVES.map((fo) => {
    const i = THIRD_OCTAVES.indexOf(fo)
    const e = [i - 1, i, i + 1].map((k) => 10 ** (-thirds[k] / 10))
    return -10 * Math.log10(mean(e))
  })
}

/** Level at distance r (m) outside a box with composite loss tlc and radiating area areaM2. */
export function escapeLevel(lin: number, tlc: number, areaM2: number, r: number): number {
  return lin - tlc + 10 * Math.log10(areaM2) - 14 - 20 * Math.log10(r)
}

export interface Surface {
  area_m2: number
  tl: number[] // per octave
}

const FACE_AREA = (o: { x: number; y: number; z: number }, w: WallId): number => {
  const mm2 = w === 'left' || w === 'right' ? o.y * o.z : w === 'top' || w === 'bottom' ? o.x * o.z : o.x * o.y
  return mm2 / 1e6
}

/** Face area of a door leaf set (split halves plus the gap between them), m2. */
const leafArea = (l: LeafLayout) => ((l.leaves.reduce((a, x) => a + x.w, 0) + (l.leaves.length - 1) * SPLIT_GAP) * l.leaves[0].h) / 1e6

const octaveTl = (items: TlItem[], lib: Library) => toOctaves(tlStack(items, lib).thirds)

/** Radiating surfaces of the box, each wall as built. The door leaves replace their area of the door wall. */
function surfaces(d: Design, lib: Library): Surface[] {
  const { outer } = resolveDims(d)
  const dw = doorWall(d)
  const door = doorLayout(d, lib)
  const ds = doorStack(d, lib)
  // Whole-wall door: the wall keeps its own stack, no door surface is substituted.
  const doorArea = door.outer ? leafArea(door.outer) : 0
  const out = WALLS.map((w) => {
    const face = FACE_AREA(outer, w)
    return {
      area_m2: w === dw ? Math.max(face - doorArea, 0) : face,
      tl: octaveTl(effectiveWallStack(d, lib, w), lib),
    }
  })
  if (ds) out.push({ area_m2: doorArea, tl: octaveTl(ds, lib) })
  return out
}

/** Lowest absorption area used for the inside level, m2, so a bare hard box still gives a finite level. */
const MIN_ABSORPTION = 0.05

/**
 * Diffuse-field level inside the box (dB) from the source level at 1 m and the absorption area A (m2):
 * Lw = L1m + 11 (free-field point source), Lin = Lw + 10 lg(4 / A).
 */
export function interiorLevel(l1m: number, absorptionM2: number): number {
  return l1m + 11 + 10 * Math.log10(4 / absorptionM2)
}

const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1]

/**
 * Absorption area (m2) per octave, sum of S alpha over the surfaces exposed inside the box: each wall's
 * inner face (less the inner door leaf) by its innermost exposed material (treatment, else facet panel,
 * else innermost wall layer), the inner door leaf, both faces of every inner panel, and the five
 * exposed faces of the cab (plywood). Floored at MIN_ABSORPTION.
 */
export function interiorAbsorption(d: Design, lib: Library): number[] {
  const { inner } = resolveDims(d)
  const dw = doorWall(d)
  const door = doorLayout(d, lib)
  const innerDoorArea = door.inner ? leafArea(door.inner) : 0
  const parts: { area: number; materialId: string | undefined }[] = []
  for (const w of WALLS) {
    const wi = activeInterior(d, w)
    const layers = wallStack(d, w).filter((i): i is Layer => i.kind === 'layer')
    parts.push({
      area: Math.max(FACE_AREA(inner, w) - (w === dw ? innerDoorArea : 0), 0),
      materialId: last(wallTreatments(d, w))?.materialId ?? wi?.panelMaterialId ?? last(layers)?.materialId,
    })
  }
  if (door.inner) parts.push({ area: innerDoorArea, materialId: last(doorLeafLayers(d).inner)?.materialId })
  for (const p of d.panels) {
    const area = (Math.abs(p.u1 - p.u0) * Math.abs(p.v1 - p.v0)) / 1e6
    for (const side of ['neg', 'pos'] as const) {
      const face = side === 'neg' ? p.layers[0] : last(p.layers)
      parts.push({
        area,
        materialId: last(panelTreatments(d, p.id, side))?.materialId ?? p.insulation?.materialId ?? face?.materialId,
      })
    }
  }
  const cab = d.cabs.find((c) => c.id === d.sim.cabId) ?? d.cabs.find((c) => c.id === d.dims.sizingCabId) ?? d.cabs[0]
  if (cab) {
    parts.push({
      area: (2 * cab.w * cab.h + 2 * cab.d * cab.h + cab.w * cab.d) / 1e6,
      materialId: materialOrFirst(lib, 'plywood', ['sheet']),
    })
  }
  const alpha = (id: string | undefined, i: number) => lib.materials.find((m) => m.id === id)?.absorption[i] ?? 0
  return OCTAVES.map((_, i) => Math.max(parts.reduce((a, p) => a + p.area * alpha(p.materialId, i), 0), MIN_ABSORPTION))
}

export interface EscapeResult {
  tlBox: number[]
  /** Absorption area inside the box per octave, m2. */
  absorption: number[]
  /** Level inside the box per octave, dB. */
  lin: number[]
  lout: number[]
  margin: number[]
  worst: number
}

/** d.escape.insideLevel is the cab's level at 1 m per octave; the inside level follows from the absorption. */
export function escape(d: Design, lib: Library): EscapeResult {
  const surfs = surfaces(d, lib)
  const total = surfs.reduce((a, s) => a + s.area_m2, 0)
  const tlBox = OCTAVES.map((_, i) => -10 * Math.log10(surfs.reduce((a, s) => a + s.area_m2 * 10 ** (-s.tl[i] / 10), 0) / total))
  const absorption = interiorAbsorption(d, lib)
  const lin = absorption.map((a, i) => interiorLevel(d.escape.insideLevel[i], a))
  const lout = tlBox.map((tlc, i) => escapeLevel(lin[i], tlc, total, d.escape.distance))
  const margin = lout.map((l) => d.escape.outsideTarget - l)
  return { tlBox, absorption, lin, lout, margin, worst: Math.min(...margin) }
}
