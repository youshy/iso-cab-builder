import { SPLIT_GAP, doorLayout, doorLeafLayers } from '../doors/doors'
import { doorWall } from '../doors/side'
import { DEFAULT_INSULATION } from '../model/defaults'
import { resolveDims } from '../geometry/dimensions'
import { WALLS, cavities, leafGroups, wallStack } from '../geometry/walls'
import type { Design, Gap, Layer, Library, StackItem, WallId } from '../model/schema'

export const THIRD_OCTAVES = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
]
export const OCTAVES = [125, 250, 500, 1000, 2000, 4000]

export const TL_MODEL_LABEL = {
  single: 'Mass law estimate',
  double: 'Sharp double-leaf estimate',
  multi: 'Multi-leaf transfer-matrix estimate',
} as const

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
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function summarize(thirds: number[], f0s: number[], model: string): TlResult {
  const sel = thirds.filter((_, i) => THIRD_OCTAVES[i] >= 100 && THIRD_OCTAVES[i] <= 3150)
  return { thirds, f0: f0s[0] ?? null, f0s, single: mean(sel), model }
}

/**
 * Leaves and the cavities between them, outside-in. Leaf groups with no layers are dropped and the
 * cavities either side of them merge (widths add, the first cavity's settings kept); cavities at a
 * face are dropped. Valid stacks never need this, it keeps raw input from producing nonsense.
 */
function chain(items: StackItem[], lib: Library): { leaves: Leaf[]; gaps: Gap[] } {
  const groups = leafGroups(items)
  const gs = cavities(items)
  const leaves: Leaf[] = []
  const gaps: Gap[] = []
  let pending: Gap | null = null
  groups.forEach((g, k) => {
    if (g.length > 0) {
      if (pending && leaves.length > 0) gaps.push(pending)
      leaves.push(leaf(g, lib))
      pending = null
    }
    const next = gs[k]
    if (next) pending = pending ? { ...pending, width: pending.width + next.width } : next
  })
  return { leaves, gaps }
}

export function tlStack(items: StackItem[], lib: Library): TlResult {
  const { leaves, gaps } = chain(items, lib)
  if (gaps.length === 0) {
    const l = leaves[0] ?? { m: 0, fc: Infinity, eta: 0 }
    return summarize(THIRD_OCTAVES.map((f) => tlLeaf(l, f)), [], TL_MODEL_LABEL.single)
  }
  if (gaps.length >= 2) return multiLeaf(leaves, gaps)
  return sharp(leaves[0], leaves[1], gaps[0])
}

/** Transfer-matrix estimate for any stack with at least one cavity (exported for cross-checks). */
export function tlChain(items: StackItem[], lib: Library): TlResult {
  const { leaves, gaps } = chain(items, lib)
  return gaps.length ? multiLeaf(leaves, gaps) : tlStack(items, lib)
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

// ---- Multi-leaf transfer matrix --------------------------------------------------------------
// Pressure/velocity transfer matrices at normal incidence (e^{jwt}). Each leaf group is a limp mass
// [[1, jwm], [0, 1]]; each cavity an air layer [[cos kd, jZc sin kd], [j sin kd / Zc, cos kd]].
// Insulation fill uses Delany-Bazley with flow resistivity 10 000 Pa s/m2 for every fill material;
// an empty cavity is lossless air. Normal-incidence TL gets a -5 dB field-incidence correction, each
// leaf's coincidence dip (tlLeaf below the mass law) is added, rigid strips take 3 dB per cavity above
// the lowest resonance, and the result never drops below the mass law of the total mass.

type Cx = [number, number]
const cx = (re: number, im = 0): Cx => [re, im]
const add = (a: Cx, b: Cx): Cx => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const div = (a: Cx, b: Cx): Cx => {
  const q = b[0] * b[0] + b[1] * b[1]
  return [(a[0] * b[0] + a[1] * b[1]) / q, (a[1] * b[0] - a[0] * b[1]) / q]
}
const ccos = ([a, b]: Cx): Cx => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)]
const csin = ([a, b]: Cx): Cx => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)]
type M2 = [Cx, Cx, Cx, Cx] // row-major
const mmul = (a: M2, b: M2): M2 => [
  add(mul(a[0], b[0]), mul(a[1], b[2])),
  add(mul(a[0], b[1]), mul(a[1], b[3])),
  add(mul(a[2], b[0]), mul(a[3], b[2])),
  add(mul(a[2], b[1]), mul(a[3], b[3])),
]

const RHO = 1.21
const Z0 = RHO * C
const FLOW_RESISTIVITY = 10_000 // Pa s/m2
const FIELD_INCIDENCE = 5 // dB
const RESONANCE_MAX = 5000 // Hz

/** Characteristic impedance and wavenumber of a cavity at f. */
function airLayer(f: number, filled: boolean): { zc: Cx; k: Cx } {
  const w = 2 * Math.PI * f
  if (!filled) return { zc: cx(Z0), k: cx(w / C) }
  const X = (RHO * f) / FLOW_RESISTIVITY
  return {
    zc: [Z0 * (1 + 0.0571 * X ** -0.754), -Z0 * 0.087 * X ** -0.732],
    k: [(w / C) * (1 + 0.0978 * X ** -0.7), -(w / C) * 0.189 * X ** -0.595],
  }
}

/** Normal-incidence TL (dB) of the chain; `lossless` ignores fill damping (used to locate resonances). */
function tlNormal(leaves: Leaf[], gaps: Gap[], f: number, lossless = false): number {
  const w = 2 * Math.PI * f
  let t: M2 = [cx(1), cx(0), cx(0), cx(1)]
  leaves.forEach((l, i) => {
    t = mmul(t, [cx(1), cx(0, w * l.m), cx(0), cx(1)])
    const g = gaps[i]
    if (!g) return
    const { zc, k } = airLayer(f, !lossless && g.fill === 'insulation')
    const kd = mul(k, cx(g.width / 1000))
    const c = ccos(kd)
    const sn = csin(kd)
    t = mmul(t, [c, mul(cx(0, 1), mul(zc, sn)), div(mul(cx(0, 1), sn), zc), c])
  })
  const sum = add(add(t[0], t[3]), add(div(t[1], cx(Z0)), mul(t[2], cx(Z0))))
  return 20 * Math.log10(Math.hypot(sum[0], sum[1]) / 2)
}

/** Dips of the lossless chain from 20 Hz to 5 kHz: mass-air-mass and cavity standing-wave resonances. */
function chainResonances(leaves: Leaf[], gaps: Gap[]): number[] {
  const N = 400
  const lo = Math.log(20)
  const step = (Math.log(RESONANCE_MAX) - lo) / N
  const tl = (x: number) => tlNormal(leaves, gaps, Math.exp(x), true)
  const ys = Array.from({ length: N + 1 }, (_, i) => tl(lo + i * step))
  const out: number[] = []
  for (let i = 1; i < N; i++) {
    if (!(ys[i] < ys[i - 1] && ys[i] <= ys[i + 1])) continue
    // golden-section refine inside the bracketing grid cells
    let a = lo + (i - 1) * step
    let b = lo + (i + 1) * step
    const g = (Math.sqrt(5) - 1) / 2
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
    out.push(Math.exp((a + b) / 2))
  }
  return out
}

function multiLeaf(leaves: Leaf[], gaps: Gap[]): TlResult {
  const f0s = chainResonances(leaves, gaps)
  const fLow = f0s[0] ?? 0
  const mTotal = leaves.reduce((a, l) => a + l.m, 0)
  const strips = gaps.filter((g) => g.decoupling === 'strips').length * STRIPS_PENALTY
  const thirds = THIRD_OCTAVES.map((f) => {
    const coincidence = leaves.reduce((a, l) => a + Math.min(0, tlLeaf(l, f) - massLaw(l.m, f)), 0)
    const tl = tlNormal(leaves, gaps, f) - FIELD_INCIDENCE + coincidence - (f > fLow ? strips : 0)
    return Math.max(tl, massLaw(mTotal, f))
  })
  return summarize(thirds, f0s, TL_MODEL_LABEL.multi)
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

/** Double-leaf stack of the sound lock: outer leaf, between space, inner leaf. */
function doorStack(d: Design, betweenDepth: number): StackItem[] {
  const { outer, inner } = doorLeafLayers(d)
  const gap: Gap = {
    kind: 'gap',
    width: Math.max(betweenDepth, 1),
    decoupling: 'clips',
    fill: d.door.between === 'air' ? 'empty' : 'insulation',
    fillMaterialId: DEFAULT_INSULATION.materialId,
  }
  return [...outer, gap, ...inner]
}

/** Radiating surfaces of the box. The door leaves replace their area of the door wall. */
function surfaces(d: Design, lib: Library): Surface[] {
  const { outer } = resolveDims(d)
  const dw = doorWall(d)
  const door = doorLayout(d, lib)
  // Whole-wall door: the wall keeps its own stack, no door surface is substituted.
  if (!door.outer) {
    return WALLS.map((w) => ({ area_m2: FACE_AREA(outer, w), tl: toOctaves(tlStack(wallStack(d, w), lib).thirds) }))
  }
  const leaves = door.outer.leaves
  const doorArea =
    (leaves.reduce((a, l) => a + l.w, 0) + (leaves.length - 1) * SPLIT_GAP) * leaves[0].h / 1e6
  const out = WALLS.map((w) => {
    const face = FACE_AREA(outer, w)
    return {
      area_m2: w === dw ? Math.max(face - doorArea, 0) : face,
      tl: toOctaves(tlStack(wallStack(d, w), lib).thirds),
    }
  })
  out.push({ area_m2: doorArea, tl: toOctaves(tlStack(doorStack(d, door.betweenDepth), lib).thirds) })
  return out
}

export function escape(
  d: Design,
  lib: Library,
): { tlBox: number[]; lout: number[]; margin: number[]; worst: number } {
  const surfs = surfaces(d, lib)
  const total = surfs.reduce((a, s) => a + s.area_m2, 0)
  const tlBox = OCTAVES.map((_, i) => -10 * Math.log10(surfs.reduce((a, s) => a + s.area_m2 * 10 ** (-s.tl[i] / 10), 0) / total))
  const lout = tlBox.map((tlc, i) => escapeLevel(d.escape.insideLevel[i], tlc, total, d.escape.distance))
  const margin = lout.map((l) => d.escape.outsideTarget - l)
  return { tlBox, lout, margin, worst: Math.min(...margin) }
}
