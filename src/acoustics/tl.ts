import { SPLIT_GAP, doorLayout, doorLeafLayers } from '../doors/doors'
import { doorWall } from '../doors/side'
import { resolveDims } from '../geometry/dimensions'
import { WALLS, splitStack, wallStack } from '../geometry/walls'
import type { Design, Gap, Layer, Library, StackItem, WallId } from '../model/schema'

export const THIRD_OCTAVES = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
]
export const OCTAVES = [125, 250, 500, 1000, 2000, 4000]

export const TL_MODEL_LABEL = {
  single: 'Mass law estimate',
  double: 'Sharp double-leaf estimate',
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
  f0: number | null
  single: number
  model: string
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function summarize(thirds: number[], f0: number | null, model: string): TlResult {
  const sel = thirds.filter((_, i) => THIRD_OCTAVES[i] >= 100 && THIRD_OCTAVES[i] <= 3150)
  return { thirds, f0, single: mean(sel), model }
}

export function tlStack(items: StackItem[], lib: Library): TlResult {
  const { shell, gap, liner } = splitStack(items)
  const l1 = leaf(shell, lib)
  const l2 = leaf(liner, lib)
  const singleLayers = !gap ? shell : shell.length ? (liner.length ? null : shell) : liner
  if (!gap || singleLayers) {
    const l = leaf(singleLayers ?? shell, lib)
    return summarize(THIRD_OCTAVES.map((f) => tlLeaf(l, f)), null, TL_MODEL_LABEL.single)
  }

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
  return summarize(thirds, f0, TL_MODEL_LABEL.double)
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
    fillMaterialId: 'rockwool',
  }
  return [...outer, gap, ...inner]
}

/** Radiating surfaces of the box. The door leaves replace their area of the door wall. */
function surfaces(d: Design, lib: Library): Surface[] {
  const { outer } = resolveDims(d)
  const dw = doorWall(d)
  const door = doorLayout(d, lib)
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
