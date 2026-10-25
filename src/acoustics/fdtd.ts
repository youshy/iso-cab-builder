/**
 * Cut-cell FDTD estimate of the sound field in the box's inner air volume.
 *
 * Scheme: staggered pressure / velocity (finite volume) on a uniform grid, dx = c / (10 fMax),
 * dt at 0.9x the 3D CFL limit. Each cell carries an air volume fraction and each velocity face an
 * open-area fraction, both from a 4x4x4 sub-sample lattice of the air test, so sub-cell geometry
 * changes move the result continuously. Boundaries are locally reacting with a real admittance from
 * the surface material's octave-band (random-incidence) absorption via the Paris statistical formula.
 * One run per octave band (125 Hz up to fMax); each run's power spectra are divided by the excitation
 * spectrum |j omega S(f)|^2, then crossfaded between band centres (a complementary band split) and summed.
 * Pure TS, no DOM: runs in a worker.
 */
import { resolveDims } from '../geometry/dimensions'
import { airTest, cabBox, materialTest } from '../geometry/space'
import type { Axis, Design, Library, Material, Vec3 } from '../model/schema'
import { rectModes } from './analytic'
import { findPeaks, spectrum } from './spectrum'

export type SimOptions = { fMax: number; duration?: number /* s, default 0.25 */; slices?: { axis: Axis; at: number; f: number }[] }
export type SimMode = { f: number; level: number; q: number; axis: Axis | null }
/** Pressure-level map on a grid plane: values[v * w + u] in dB relative to the slice maximum, NaN in solid cells. */
export type SimSlice = { axis: Axis; at: number; f: number; w: number; h: number; values: Float32Array }
export type SimResult = {
  model: 'FDTD estimate'
  freqs: Float32Array
  avgDb: Float32Array
  probesDb: Float32Array[]
  modes: SimMode[]
  dx: number // mm
  resolutionMm: number // dx / 4: the sub-sample spacing, the smallest geometry change the grid resolves
  slices: SimSlice[]
}

const C = 343 // m/s
const SUB = 4 // sub-samples per cell edge
const BANDS = [125, 250, 500, 1000, 2000, 4000] // octave centres matching Material.absorption
const AVG_POINTS = 64
const SEED = 0x1c0ffee
const BAFFLE = 18 // mm, open-back cab: the only solid part of the cab
const COURANT = 0.9 / Math.sqrt(3)
const STABLE = 3.8 // keep (c dt / dx)^2 * spectral radius under this (4 is the leapfrog limit)
const SAFE_KAPPA = 6 // cut-cell padding that is stable by the row-sum bound

const AXES: Axis[] = ['x', 'y', 'z']
const planeAxes = (n: Axis): [Axis, Axis] => (n === 'x' ? ['y', 'z'] : n === 'y' ? ['x', 'z'] : ['x', 'y'])

/** Paris statistical (random-incidence) absorption of a locally reacting surface with real normalised impedance zeta. */
const statisticalAlpha = (zeta: number) =>
  (8 / zeta) * (1 + 1 / (1 + zeta) - (2 / zeta) * Math.log(1 + zeta))
const ZETA_PEAK = 1.5671 // statisticalAlpha peaks here at about 0.951

/**
 * Normalised real admittance whose statistical absorption is alpha (library values are random
 * incidence). Small alpha gives beta of about alpha / 8; alpha above the 0.951 ceiling maps to the peak.
 */
export function admittance(alpha: number): number {
  if (alpha <= 0) return 0
  if (alpha >= statisticalAlpha(ZETA_PEAK)) return 1 / ZETA_PEAK
  let lo = Math.log(ZETA_PEAK), hi = Math.log(1e9) // statisticalAlpha falls as zeta grows past the peak
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (statisticalAlpha(Math.exp(mid)) > alpha) lo = mid
    else hi = mid
  }
  return 1 / Math.exp((lo + hi) / 2)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weight of band b at frequency f: cos^2 / sin^2 crossfade in log frequency between centres; sums to 1. */
function bandWeight(bands: number[], b: number, f: number): number {
  const lo = bands[0], hi = bands[bands.length - 1]
  if (f <= lo) return b === 0 ? 1 : 0
  if (f >= hi) return b === bands.length - 1 ? 1 : 0
  for (let k = 0; k < bands.length - 1; k++) {
    if (f < bands[k + 1]) {
      const t = Math.log2(f / bands[k]) / Math.log2(bands[k + 1] / bands[k])
      if (b === k) return Math.cos((Math.PI / 2) * t) ** 2
      if (b === k + 1) return Math.sin((Math.PI / 2) * t) ** 2
      return 0
    }
  }
  return 0
}

type Grid = {
  nx: number; ny: number; nz: number
  NX: number; NY: number; N: number // padded by one ghost cell on each side
  dx: number // mm
  vol: Float32Array // air volume fraction per padded cell
  open: [Float32Array, Float32Array, Float32Array] // open-area fraction of the +x/+y/+z face of each cell
  wallArea: Float32Array[] // per band: sum of boundary area (cell-face units) x admittance, per cell
}

/** Air test for the simulation: the open-back cab keeps only its baffle as a solid. */
function simAir(d: Design): (p: Vec3) => boolean {
  const cab = d.sim.cabId === '' ? undefined : d.cabs.find((c) => c.id === d.sim.cabId)
  if (!cab || cab.back === 'closed') return airTest(d)
  const b = cabBox(d, cab)
  const noCab = airTest({ ...d, sim: { ...d.sim, cabId: '' } })
  return (p) =>
    noCab(p) &&
    !(p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z <= b.max.z && p.z >= b.max.z - BAFFLE)
}

function buildGrid(d: Design, lib: Library, fMax: number, bands: number[]): Grid {
  const { inner } = resolveDims(d)
  const dx = (C / (10 * fMax)) * 1000
  const nx = Math.max(1, Math.ceil(inner.x / dx - 1e-9))
  const ny = Math.max(1, Math.ceil(inner.y / dx - 1e-9))
  const nz = Math.max(1, Math.ceil(inner.z / dx - 1e-9))
  const NX = nx + 2, NY = ny + 2, N = NX * NY * (nz + 2)
  const LX = nx * SUB, LY = ny * SUB, LZ = nz * SUB
  const h = dx / SUB
  const pt = (a: number, b: number, c: number): Vec3 => ({ x: (a + 0.5) * h, y: (b + 0.5) * h, z: (c + 0.5) * h })

  const isAir = simAir(d)
  const air = new Uint8Array(LX * LY * LZ)
  for (let c = 0; c < LZ; c++)
    for (let b = 0; b < LY; b++)
      for (let a = 0; a < LX; a++) air[a + LX * (b + LY * c)] = isAir(pt(a, b, c)) ? 1 : 0
  const at = (a: number, b: number, c: number) =>
    a < 0 || b < 0 || c < 0 || a >= LX || b >= LY || c >= LZ ? 0 : air[a + LX * (b + LY * c)]
  const cell = (i: number, j: number, k: number) => i + 1 + NX * (j + 1 + NY * (k + 1))

  const vol = new Float32Array(N)
  for (let c = 0; c < LZ; c++)
    for (let b = 0; b < LY; b++)
      for (let a = 0; a < LX; a++)
        if (air[a + LX * (b + LY * c)]) vol[cell((a / SUB) | 0, (b / SUB) | 0, (c / SUB) | 0)] += 1 / SUB ** 3

  // Face open fraction: a sub-sample line crossing the face is open when the samples on both sides
  // of the face are air and, inside each cell, no solid sits between the face and further air
  // (so an obstacle thinner than a cell still blocks, while a wall tail inside a cell does not).
  const open: [Float32Array, Float32Array, Float32Array] = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]
  const n = [nx, ny, nz]
  for (let ax = 0; ax < 3; ax++) {
    const s = (q: number, u: number, v: number) => (ax === 0 ? at(q, u, v) : ax === 1 ? at(u, q, v) : at(u, v, q))
    const [U, V] = ax === 0 ? [LY, LZ] : ax === 1 ? [LX, LZ] : [LX, LY]
    for (let i = 0; i < n[ax] - 1; i++) {
      const q0 = (i + 1) * SUB // first sample of the upper cell
      for (let v = 0; v < V; v++)
        for (let u = 0; u < U; u++) {
          if (!s(q0 - 1, u, v) || !s(q0, u, v)) continue
          let ok = true
          let solid = false
          for (let q = q0; q < q0 + SUB && ok; q++) if (!s(q, u, v)) solid = true; else if (solid) ok = false
          solid = false
          for (let q = q0 - 1; q >= q0 - SUB && ok; q--) if (!s(q, u, v)) solid = true; else if (solid) ok = false
          if (!ok) continue
          const ci = ax === 0 ? cell(i, (u / SUB) | 0, (v / SUB) | 0) : ax === 1 ? cell((u / SUB) | 0, i, (v / SUB) | 0) : cell((u / SUB) | 0, (v / SUB) | 0, i)
          open[ax][ci] += 1 / SUB ** 2
        }
    }
  }

  // Boundary area: every air/solid pair of neighbouring sub-samples is (dx/4)^2 of projected surface,
  // owned by the air sample's cell, with the admittance of the material at the solid sample.
  const material = materialTest(d, lib)
  const mats = new Map<Material | null, number[]>()
  const betas = (m: Material | null) => {
    let b = mats.get(m)
    if (!b) {
      b = bands.map((f) => admittance(m ? m.absorption[BANDS.indexOf(f)] : 0))
      mats.set(m, b)
    }
    return b
  }
  const wallArea = bands.map(() => new Float32Array(N))
  const dA = 1 / SUB ** 2
  const step = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let c = 0; c < LZ; c++)
    for (let b = 0; b < LY; b++)
      for (let a = 0; a < LX; a++) {
        if (!air[a + LX * (b + LY * c)]) continue
        const ci = cell((a / SUB) | 0, (b / SUB) | 0, (c / SUB) | 0)
        for (const [ox, oy, oz] of step)
          for (const sgn of [-1, 1]) {
            const a2 = a + sgn * ox, b2 = b + sgn * oy, c2 = c + sgn * oz
            if (at(a2, b2, c2)) continue
            const beta = betas(material(pt(a2, b2, c2)))
            for (let k = 0; k < bands.length; k++) wallArea[k][ci] += dA * beta[k]
          }
      }

  return { nx, ny, nz, NX, NY, N, dx, vol, open, wallArea }
}

/** Effective volume per cell: small cut cells are padded so that sum(open) / volume <= kappa. */
function effectiveVolume(g: Grid, kappa: number): Float32Array {
  const { N, NX, NY, vol, open } = g
  const sy = NX, sz = NX * NY
  const out = new Float32Array(N)
  for (let c = 0; c < N; c++) {
    if (vol[c] === 0) continue
    const sum = open[0][c] + open[0][c - 1] + open[1][c] + open[1][c - sy] + open[2][c] + open[2][c - sz]
    out[c] = Math.max(vol[c], sum / kappa)
  }
  return out
}

/** Power-iteration estimate of the largest eigenvalue of the lossless update operator V^-1 D^T A D. */
function spectralRadius(g: Grid, veff: Float32Array, cells: Int32Array): number {
  const { N, NX, NY, open } = g
  const st = [1, NX, NX * NY]
  const rnd = mulberry32(SEED + 1)
  let x = new Float64Array(N)
  let y = new Float64Array(N)
  for (const c of cells) x[c] = rnd() - 0.5
  let mu = 0
  for (let it = 0; it < 60; it++) {
    // y = V^-1/2 L V^-1/2 x (symmetric form)
    y.fill(0)
    for (const c of cells) {
      const xc = x[c] / Math.sqrt(veff[c])
      let acc = 0
      for (let ax = 0; ax < 3; ax++) {
        const up = c + st[ax], dn = c - st[ax]
        const au = open[ax][c], ad = open[ax][dn]
        if (au) acc += au * (xc - x[up] / Math.sqrt(veff[up]))
        if (ad) acc += ad * (xc - x[dn] / Math.sqrt(veff[dn]))
      }
      y[c] = acc / Math.sqrt(veff[c])
    }
    let num = 0, den = 0
    for (const c of cells) { num += x[c] * y[c]; den += y[c] * y[c] }
    mu = Math.max(mu, den / Math.max(num, 1e-30))
    const norm = Math.sqrt(den) || 1
    for (const c of cells) y[c] /= norm
    const t = x; x = y; y = t
  }
  return mu
}

/** One time step: velocities (as open-area-weighted fluxes) from the pressure gradient, then pressure. */
function leapfrog(
  spans: Int32Array, p: Float32Array, qx: Float32Array, qy: Float32Array, qz: Float32Array,
  kx: Float32Array, ky: Float32Array, kz: Float32Array, pa: Float32Array, pb: Float32Array, sy: number, sz: number,
): void {
  for (let s = 0; s < spans.length; s += 2) {
    for (let c = spans[s], e = spans[s + 1]; c < e; c++) {
      const pc = p[c]
      qx[c] -= kx[c] * (p[c + 1] - pc)
      qy[c] -= ky[c] * (p[c + sy] - pc)
      qz[c] -= kz[c] * (p[c + sz] - pc)
    }
  }
  for (let s = 0; s < spans.length; s += 2) {
    for (let c = spans[s], e = spans[s + 1]; c < e; c++) {
      p[c] = pa[c] * p[c] - pb[c] * (qx[c] - qx[c - 1] + qy[c] - qy[c - sy] + qz[c] - qz[c - sz])
    }
  }
}

type SliceDef = { axis: Axis; at: number; f: number; w: number; h: number; idx: Int32Array; omega: number }
type SliceAcc = { re: Float64Array; im: Float64Array }

/** Everything a band run needs, built once per simulation. */
type Setup = {
  g: Grid
  cells: Int32Array // air cells, ascending
  spans: Int32Array // [start, end) pairs of contiguous air cells
  k: [Float32Array, Float32Array, Float32Array] // lambda * open fraction per face
  dt: number
  steps: number
  bands: number[]
  runOf: number[] // band index -> run index
  runBands: number[] // run index -> representative band index
  recCells: Int32Array // averaging points first, then probes
  avgCount: number
  srcCells: number[]
  src: Float32Array // source signal per step (zero after its end)
  slices: SliceDef[]
  inner: Vec3
}

function setup(d: Design, lib: Library, opts: SimOptions): Setup {
  const fMax = opts.fMax
  const bands = BANDS.filter((b) => b / Math.SQRT2 < fMax)
  const g = buildGrid(d, lib, fMax, bands)
  const { nx, ny, nz, NX, NY, N, dx, vol, open } = g
  const cell = (i: number, j: number, k: number) => i + 1 + NX * (j + 1 + NY * (k + 1))
  const dt = (COURANT * dx) / 1000 / C
  const steps = Math.max(16, Math.round((opts.duration ?? 0.25) / dt))

  const cellList: number[] = []
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (vol[cell(i, j, k)] > 0) cellList.push(cell(i, j, k))
  if (cellList.length === 0) throw new Error('No air in the simulation volume.')
  const cells = Int32Array.from(cellList)

  // Contiguous runs of air cells along x: the update loops walk these with direct indexing.
  // Closed faces inside a run have a zero coefficient, so they never carry flux.
  const spanList: number[] = []
  for (let i = 0; i < cells.length; i++) {
    if (i === 0 || cells[i] !== cells[i - 1] + 1) spanList.push(cells[i], cells[i] + 1)
    else spanList[spanList.length - 1] = cells[i] + 1
  }
  const k = open.map((o) => o.map((v) => COURANT * v)) as Setup['k']

  // Receivers and sources, snapped to the nearest air cell.
  const cellOf = (p: Vec3): [number, number, number] => [
    Math.min(nx - 1, Math.max(0, Math.floor(p.x / dx))),
    Math.min(ny - 1, Math.max(0, Math.floor(p.y / dx))),
    Math.min(nz - 1, Math.max(0, Math.floor(p.z / dx))),
  ]
  const nearestAir = (p: Vec3): number => {
    const [ci, cj, ck] = cellOf(p)
    if (vol[cell(ci, cj, ck)] > 0) return cell(ci, cj, ck)
    let best = cells[0], bestD = Infinity
    for (const c of cells) {
      const i = (c % NX) - 1, j = (Math.floor(c / NX) % NY) - 1, kk = Math.floor(c / (NX * NY)) - 1
      const dd = (i - ci) ** 2 + (j - cj) ** 2 + (kk - ck) ** 2
      if (dd < bestD) { bestD = dd; best = c }
    }
    return best
  }
  const { inner } = resolveDims(d)
  const isAir = simAir(d)
  const rnd = mulberry32(SEED)
  const avgCells: number[] = []
  for (let tries = 0; avgCells.length < AVG_POINTS && tries < AVG_POINTS * 500; tries++) {
    const p = { x: rnd() * inner.x, y: rnd() * inner.y, z: rnd() * inner.z }
    const c = cell(...cellOf(p))
    if (isAir(p) && vol[c] > 0) avgCells.push(c)
  }
  if (avgCells.length === 0) avgCells.push(cells[0])
  const recCells = Int32Array.from([...avgCells, ...d.sim.probes.map(nearestAir)])

  const cab = d.sim.cabId === '' ? undefined : d.cabs.find((c) => c.id === d.sim.cabId)
  let srcCells: number[]
  if (cab && cab.speakers.length > 0) {
    const b = cabBox(d, cab)
    srcCells = cab.speakers.map((s) => nearestAir({ x: b.min.x + s.x, y: b.min.y + s.y, z: Math.min(inner.z, b.max.z + dx / 2) }))
  } else {
    srcCells = [nearestAir({ x: 0, y: 0, z: 0 })] // no cab: one source near the back-bottom-left corner
  }
  // Differentiated Gaussian (no net volume injected), spectrum peaking at fMax / 2.
  const sigma = 1 / (Math.PI * fMax)
  const t0 = 5 * sigma
  const src = new Float32Array(steps)
  for (let n = 0; n < Math.min(steps, Math.ceil((2 * t0) / dt) + 1); n++) {
    const u = (n * dt - t0) / sigma
    src[n] = -u * Math.exp(-0.5 * u * u)
  }

  const slices = (opts.slices ?? []).map((s): SliceDef => {
    const [ua, va] = planeAxes(s.axis)
    const dims = { x: nx, y: ny, z: nz }
    const w = dims[ua], h = dims[va]
    const at = Math.min(dims[s.axis] - 1, Math.max(0, Math.floor(s.at / dx)))
    const idx = new Int32Array(w * h)
    for (let v = 0; v < h; v++)
      for (let u = 0; u < w; u++) {
        const ijk = { x: 0, y: 0, z: 0 }
        ijk[s.axis] = at; ijk[ua] = u; ijk[va] = v
        idx[v * w + u] = cell(ijk.x, ijk.y, ijk.z)
      }
    return { ...s, w, h, idx, omega: 2 * Math.PI * s.f * dt }
  })

  // Bands whose admittances match everywhere share one run.
  const runOf: number[] = []
  const runBands: number[] = []
  const sameArea = (a: Float32Array, b: Float32Array) => { for (let c = 0; c < N; c++) if (a[c] !== b[c]) return false; return true }
  bands.forEach((_, b) => {
    const r = runBands.findIndex((rb) => sameArea(g.wallArea[rb], g.wallArea[b]))
    if (r >= 0) runOf.push(r)
    else { runOf.push(runBands.length); runBands.push(b) }
  })

  return {
    g, cells, spans: Int32Array.from(spanList), k, dt, steps, bands, runOf, runBands,
    recCells, avgCount: avgCells.length, srcCells, src, slices, inner,
  }
}

/** Cut-cell volumes for the update: kappa from the caller, else the largest stable one tried (8, 7, 6). */
function chooseVolumes(s: Setup, kappa?: number): Float32Array {
  if (kappa !== undefined) return effectiveVolume(s.g, kappa)
  let veff = effectiveVolume(s.g, 8)
  for (let kp = 8; kp > SAFE_KAPPA; kp--) {
    if (COURANT ** 2 * spectralRadius(s.g, veff, s.cells) <= STABLE) break
    veff = effectiveVolume(s.g, kp - 1)
  }
  return veff
}

/** Time-steps one band; returns the receiver recordings and the slice DFT sums. */
function runBand(
  s: Setup, veff: Float32Array, run: number, tick: (stepsDone: number) => void,
): { recordings: Float32Array[]; slices: SliceAcc[] } {
  const { g, cells, spans, k: [kx, ky, kz], steps, recCells, srcCells, src } = s
  const { N, NX, NY } = g
  const sy = NX, sz = NX * NY
  const area = g.wallArea[s.runBands[run]]
  const pa = new Float32Array(N), pb = new Float32Array(N)
  for (const c of cells) {
    const gl = (COURANT * area[c]) / (2 * veff[c])
    pa[c] = (1 - gl) / (1 + gl)
    pb[c] = COURANT / (veff[c] * (1 + gl))
  }
  const p = new Float32Array(N), qx = new Float32Array(N), qy = new Float32Array(N), qz = new Float32Array(N)
  const recordings = Array.from(recCells, () => new Float32Array(steps))
  const slices = s.slices.map((d) => ({ re: new Float64Array(d.idx.length), im: new Float64Array(d.idx.length) }))
  const srcScale = srcCells.map((c) => 1 / veff[c])
  let srcEnd = steps
  while (srcEnd > 0 && src[srcEnd - 1] === 0) srcEnd--

  for (let n = 0; n < steps; n++) {
    leapfrog(spans, p, qx, qy, qz, kx, ky, kz, pa, pb, sy, sz)
    if (n < srcEnd) for (let i = 0; i < srcCells.length; i++) p[srcCells[i]] += src[n] * srcScale[i]
    for (let r = 0; r < recCells.length; r++) recordings[r][n] = p[recCells[r]]
    for (let i = 0; i < s.slices.length; i++) {
      const def = s.slices[i], a = slices[i]
      const cr = Math.cos(def.omega * n), ci = -Math.sin(def.omega * n)
      for (let j = 0; j < def.idx.length; j++) { const v = p[def.idx[j]]; a.re[j] += v * cr; a.im[j] += v * ci }
    }
    tick(n + 1)
  }
  return { recordings, slices }
}

/**
 * Divergence guard: a passive system never gains energy once the source has stopped, so non-finite
 * samples or a final tenth far louder than the second tenth mean the run went unstable.
 */
export function diverged(recordings: Float32Array[]): boolean {
  const steps = recordings[0]?.length ?? 0
  const tenth = Math.max(1, Math.floor(steps / 10))
  let early = 0, late = 0, all = 0
  for (const r of recordings) {
    for (let n = 0; n < steps; n++) all += r[n] * r[n]
    for (let n = tenth; n < 2 * tenth; n++) early += r[n] * r[n]
    for (let n = steps - tenth; n < steps; n++) late += r[n] * r[n]
  }
  return !Number.isFinite(all) || late > 100 * early
}

/** Power spectrum of the source as the field sees it, |j omega S(f)|^2, with the receivers' windows. */
function excitation(s: Setup, decay: Float32Array, fs: number, bins: number, fFloor: number): Float64Array {
  const sig = new Float32Array(s.steps)
  for (let n = 0; n < s.steps; n++) sig[n] = s.src[n] * decay[n]
  const sp = spectrum(sig, fs, { window: 'tail' })
  const out = new Float64Array(bins)
  for (let i = 0; i < bins; i++) {
    const f = Math.max(sp.freqs[i], fFloor) // below the lowest mode of interest, hold the floor value
    const j = Math.min(bins - 1, Math.round((f * (2 * (sp.freqs.length - 1))) / fs))
    const w = (2 * Math.PI * f) / (2 * Math.PI * 1000)
    out[i] = w * w * 10 ** (sp.db[j] / 10)
  }
  return out
}

/** Windowed power spectra of one run, divided by the excitation: mean over averaging points, and per probe. */
function runSpectra(
  s: Setup, recordings: Float32Array[], decay: Float32Array, fs: number, bins: number, exc: Float64Array,
): { avg: Float64Array; probes: Float64Array[] } {
  const avg = new Float64Array(bins)
  const probes: Float64Array[] = []
  recordings.forEach((sig, r) => {
    for (let n = 0; n < sig.length; n++) sig[n] *= decay[n]
    const sp = spectrum(sig, fs, { window: 'tail' })
    const pow = new Float64Array(bins)
    for (let i = 0; i < bins; i++) pow[i] = 10 ** (sp.db[i] / 10) / exc[i]
    if (r < s.avgCount) for (let i = 0; i < bins; i++) avg[i] += pow[i] / s.avgCount
    else probes.push(pow)
  })
  return { avg, probes }
}

/** Crossfade the runs' power spectra between band centres and convert to dB. */
function combineBands(s: Setup, freqs: Float32Array, pick: (run: number) => Float64Array): Float32Array {
  const out = new Float32Array(freqs.length)
  for (let i = 0; i < freqs.length; i++) {
    let sum = 0
    for (let b = 0; b < s.bands.length; b++) {
      const w = bandWeight(s.bands, b, freqs[i])
      if (w) sum += w * pick(s.runOf[b])[i]
    }
    out[i] = 10 * Math.log10(sum + 1e-30)
  }
  return out
}

function sliceMaps(s: Setup, runSlices: SliceAcc[][]): SimSlice[] {
  const { vol } = s.g
  return s.slices.map((def, si) => {
    const values = new Float32Array(def.idx.length)
    let max = -Infinity
    for (let i = 0; i < def.idx.length; i++) {
      let pw = 0
      for (let b = 0; b < s.bands.length; b++) {
        const w = bandWeight(s.bands, b, def.f)
        if (w) { const a = runSlices[s.runOf[b]][si]; pw += w * (a.re[i] ** 2 + a.im[i] ** 2) }
      }
      values[i] = 10 * Math.log10(pw + 1e-30)
      if (vol[def.idx[i]] > 0 && values[i] > max) max = values[i]
    }
    for (let i = 0; i < values.length; i++) values[i] = vol[def.idx[i]] > 0 ? values[i] - max : NaN
    return { axis: def.axis, at: def.at, f: def.f, w: def.w, h: def.h, values }
  })
}

/**
 * Peaks of the averaged response; q has the exponential window's extra bandwidth removed (floored at the
 * record's resolution). axis is set when the peak is within 3% of an axial mode of the inner cavity.
 */
function labelModes(s: Setup, freqs: Float32Array, avgDb: Float32Array, fMin: number, fMax: number, tau: number): SimMode[] {
  const axial = rectModes(s.inner, fMax * 1.03, C).filter((m) => m.kind === 'axial')
  const windowBw = 1 / (Math.PI * tau)
  const minBw = 1 / (s.steps * s.dt)
  return findPeaks(freqs, avgDb, { minProminence: 3, fMin, fMax }).map((pk) => {
    let axis: Axis | null = null
    let best = 0.03
    for (const m of axial) {
      const rel = Math.abs(m.f - pk.f) / m.f
      if (rel <= best) { best = rel; axis = AXES[m.n.findIndex((v) => v > 0)] }
    }
    const q = Number.isFinite(pk.q) ? pk.f / Math.max(pk.f / pk.q - windowBw, minBw) : NaN
    return { f: pk.f, level: pk.level, q, axis }
  })
}

/** Test hook: `kappa` fixes the cut-cell padding instead of choosing a stable one. */
export type SimTuning = { kappa?: number }

export function simulateTuned(
  d: Design, lib: Library, opts: SimOptions, onProgress: ((p: number) => void) | undefined, tuning: SimTuning,
): SimResult {
  const fMax = opts.fMax
  const s = setup(d, lib, opts)
  const fs = 1 / s.dt
  const runs = s.runBands.length
  let lastReport = -1
  const report = (run: number, done: number) => {
    const pct = Math.floor((100 * (run * s.steps + done)) / (runs * s.steps))
    if (onProgress && pct > lastReport && pct < 100) { lastReport = pct; onProgress(pct / 100) }
  }

  let veff = chooseVolumes(s, tuning.kappa)
  let out = s.runBands.map((_, run) => runBand(s, veff, run, (n) => report(run, n)))
  if (out.some((o) => diverged(o.recordings))) {
    veff = chooseVolumes(s, SAFE_KAPPA) // provably stable; progress holds until it catches up
    out = s.runBands.map((_, run) => runBand(s, veff, run, (n) => report(run, n)))
  }
  onProgress?.(1)

  // Exponential window on the responses: kills truncation sidelobes (which would show as fake modes
  // when walls are nearly rigid) at the cost of a known extra bandwidth, removed again from q.
  const tau = (s.steps * s.dt) / 4
  const decay = new Float32Array(s.steps)
  for (let n = 0; n < s.steps; n++) decay[n] = Math.exp(-(n * s.dt) / tau)
  const n2 = 1 << Math.ceil(Math.log2(s.steps))
  const bins = Math.min(n2 / 2 + 1, Math.floor((fMax * n2) / fs) + 1)
  const freqs = new Float32Array(bins).map((_, i) => (i * fs) / n2)
  const lowest = C / 2 / (Math.max(s.inner.x, s.inner.y, s.inner.z) / 1000)
  const fMin = lowest / 4
  const exc = excitation(s, decay, fs, bins, fMin / 2) // held below fMin / 2 so no fake peak forms at fMin
  const spectra = out.map((o) => runSpectra(s, o.recordings, decay, fs, bins, exc))

  const avgDb = combineBands(s, freqs, (r) => spectra[r].avg)
  const probesDb = d.sim.probes.map((_, i) => combineBands(s, freqs, (r) => spectra[r].probes[i]))
  return {
    model: 'FDTD estimate',
    freqs,
    avgDb,
    probesDb,
    modes: labelModes(s, freqs, avgDb, fMin, fMax, tau),
    dx: s.g.dx,
    resolutionMm: s.g.dx / SUB,
    slices: sliceMaps(s, out.map((o) => o.slices)),
  }
}

export function simulate(d: Design, lib: Library, opts: SimOptions, onProgress?: (p: number) => void): SimResult {
  return simulateTuned(d, lib, opts, onProgress, {})
}
