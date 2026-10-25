/**
 * Cut-cell FDTD estimate of the sound field in the box's inner air volume.
 *
 * Scheme: staggered pressure / velocity (finite volume) on a uniform grid, dx = c / (10 fMax),
 * dt at 0.9x the 3D CFL limit. Each cell carries an air volume fraction and each velocity face an
 * open-area fraction, both from a 4x4x4 sub-sample lattice of the air test, so sub-cell geometry
 * changes move the result continuously. Boundaries are locally reacting with a real admittance from
 * the surface material's octave-band absorption. One run per octave band (125 Hz up to fMax); the
 * runs' power spectra are crossfaded between band centres (a complementary band split) and summed.
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

const AXES: Axis[] = ['x', 'y', 'z']
const planeAxes = (n: Axis): [Axis, Axis] => (n === 'x' ? ['y', 'z'] : n === 'y' ? ['x', 'z'] : ['x', 'y'])

/** Normalised real admittance of a locally reacting surface with absorption alpha (normal incidence). */
const admittance = (alpha: number) => {
  const r = Math.sqrt(Math.max(0, 1 - alpha))
  return (1 - r) / (1 + r)
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

export function simulate(d: Design, lib: Library, opts: SimOptions, onProgress?: (p: number) => void): SimResult {
  const fMax = opts.fMax
  const duration = opts.duration ?? 0.25
  const bands = BANDS.filter((b) => b / Math.SQRT2 < fMax)
  const g = buildGrid(d, lib, fMax, bands)
  const { nx, ny, nz, NX, NY, N, dx, vol, open } = g
  const sy = NX, sz = NX * NY
  const cell = (i: number, j: number, k: number) => i + 1 + NX * (j + 1 + NY * (k + 1))
  const dt = (COURANT * dx) / 1000 / C
  const fs = 1 / dt
  const steps = Math.max(16, Math.round(duration / dt))

  const cellList: number[] = []
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (vol[cell(i, j, k)] > 0) cellList.push(cell(i, j, k))
  if (cellList.length === 0) throw new Error('No air in the simulation volume.')
  const cells = Int32Array.from(cellList)

  // Pad small cut cells until the scheme is stable; kappa = 6 is stable by the row-sum bound.
  let veff = effectiveVolume(g, 8)
  for (let kappa = 8; kappa > 6; kappa--) {
    if (COURANT ** 2 * spectralRadius(g, veff, cells) <= STABLE) break
    veff = effectiveVolume(g, kappa - 1)
  }

  // Receivers and sources, snapped to the nearest air cell.
  const coords = (c: number): [number, number, number] => {
    const i = (c % NX) - 1, j = (Math.floor(c / NX) % NY) - 1, k = Math.floor(c / sz) - 1
    return [i, j, k]
  }
  const nearestAir = (p: Vec3): number => {
    const ci = Math.min(nx - 1, Math.max(0, Math.floor(p.x / dx)))
    const cj = Math.min(ny - 1, Math.max(0, Math.floor(p.y / dx)))
    const ck = Math.min(nz - 1, Math.max(0, Math.floor(p.z / dx)))
    if (vol[cell(ci, cj, ck)] > 0) return cell(ci, cj, ck)
    let best = cells[0], bestD = Infinity
    for (const c of cells) {
      const [i, j, k] = coords(c)
      const dd = (i - ci) ** 2 + (j - cj) ** 2 + (k - ck) ** 2
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
    const ci = cell(Math.min(nx - 1, Math.floor(p.x / dx)), Math.min(ny - 1, Math.floor(p.y / dx)), Math.min(nz - 1, Math.floor(p.z / dx)))
    if (isAir(p) && vol[ci] > 0) avgCells.push(ci)
  }
  if (avgCells.length === 0) avgCells.push(cells[0])
  const probeCells = d.sim.probes.map(nearestAir)
  const recCells = Int32Array.from([...avgCells, ...probeCells])

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
  const src = new Float32Array(Math.min(steps, Math.ceil((2 * t0) / dt) + 1))
  for (let n = 0; n < src.length; n++) {
    const u = (n * dt - t0) / sigma
    src[n] = -u * Math.exp(-0.5 * u * u)
  }

  // Slices: plane cells and per-run running DFT at the slice frequency.
  const sliceDefs = (opts.slices ?? []).map((s) => {
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

  // Group bands with identical admittances into one run.
  const runOf: number[] = []
  const runBands: number[] = []
  const sameArea = (a: Float32Array, b: Float32Array) => { for (let c = 0; c < N; c++) if (a[c] !== b[c]) return false; return true }
  bands.forEach((_, b) => {
    const r = runBands.findIndex((rb) => sameArea(g.wallArea[rb], g.wallArea[b]))
    if (r >= 0) runOf.push(r)
    else { runOf.push(runBands.length); runBands.push(b) }
  })

  // Contiguous runs of air cells along x: the update loops walk these with direct indexing.
  // Closed faces inside a run have a zero coefficient, so they never carry flux.
  const spanList: number[] = []
  for (let i = 0; i < cells.length; i++) {
    if (i === 0 || cells[i] !== cells[i - 1] + 1) spanList.push(cells[i], cells[i] + 1)
    else spanList[spanList.length - 1] = cells[i] + 1
  }
  const spans = Int32Array.from(spanList)
  const lambda = COURANT
  const [kx, ky, kz] = open.map((o) => o.map((v) => lambda * v))

  const p = new Float32Array(N)
  const qx = new Float32Array(N), qy = new Float32Array(N), qz = new Float32Array(N)
  const pa = new Float32Array(N), pb = new Float32Array(N)
  const R = recCells.length
  const runSpectra: { avg: Float64Array; probes: Float64Array[] }[] = []
  const runSlices: { re: Float64Array; im: Float64Array }[][] = []
  let freqs: Float32Array | null = null
  let bins = 0
  const recordings = Array.from({ length: R }, () => new Float32Array(steps))
  const srcScale = srcCells.map((c) => 1 / veff[c])
  // Exponential window on the responses: kills truncation sidelobes (which would show as fake modes
  // when walls are nearly rigid) at the cost of a known extra bandwidth, removed again from q below.
  const tau = (steps * dt) / 4
  const decay = new Float32Array(steps)
  for (let n = 0; n < steps; n++) decay[n] = Math.exp(-(n * dt) / tau)
  const totalSteps = steps * runBands.length
  let lastReport = -1

  runBands.forEach((band, run) => {
    const area = g.wallArea[band]
    for (const c of cells) {
      const gl = (lambda * area[c]) / (2 * veff[c])
      pa[c] = (1 - gl) / (1 + gl)
      pb[c] = lambda / (veff[c] * (1 + gl))
    }
    p.fill(0); qx.fill(0); qy.fill(0); qz.fill(0)
    const acc = sliceDefs.map((s) => ({ re: new Float64Array(s.idx.length), im: new Float64Array(s.idx.length) }))

    for (let n = 0; n < steps; n++) {
      leapfrog(spans, p, qx, qy, qz, kx, ky, kz, pa, pb, sy, sz)
      if (n < src.length) for (let s = 0; s < srcCells.length; s++) p[srcCells[s]] += src[n] * srcScale[s]
      for (let r = 0; r < R; r++) recordings[r][n] = p[recCells[r]]
      for (let s = 0; s < sliceDefs.length; s++) {
        const def = sliceDefs[s], a = acc[s]
        const cr = Math.cos(def.omega * n), ci = -Math.sin(def.omega * n)
        for (let i = 0; i < def.idx.length; i++) { const v = p[def.idx[i]]; a.re[i] += v * cr; a.im[i] += v * ci }
      }
      if (onProgress) {
        const pct = Math.floor((100 * (run * steps + n + 1)) / totalSteps)
        if (pct > lastReport && pct < 100) { lastReport = pct; onProgress(pct / 100) }
      }
    }

    // Power spectra of this run: mean over the averaging points, and per probe.
    let avg: Float64Array | null = null
    const probes: Float64Array[] = []
    for (let r = 0; r < R; r++) {
      const sig = recordings[r]
      for (let n = 0; n < steps; n++) sig[n] *= decay[n]
      const sp = spectrum(sig, fs, { window: 'tail' })
      if (!freqs) {
        bins = sp.freqs.findIndex((f) => f > fMax)
        if (bins < 0) bins = sp.freqs.length
        freqs = sp.freqs.slice(0, bins)
      }
      const pow = new Float64Array(bins)
      for (let k = 0; k < bins; k++) pow[k] = 10 ** (sp.db[k] / 10)
      if (r < avgCells.length) {
        avg ??= new Float64Array(bins)
        for (let k = 0; k < bins; k++) avg[k] += pow[k] / avgCells.length
      } else probes.push(pow)
    }
    runSpectra.push({ avg: avg!, probes })
    runSlices.push(acc)
  })
  onProgress?.(1)

  // Combine runs with the band crossfade.
  const f = freqs!
  const combine = (pick: (run: number) => Float64Array) => {
    const out = new Float32Array(bins)
    for (let k = 0; k < bins; k++) {
      let s = 0
      for (let b = 0; b < bands.length; b++) {
        const w = bandWeight(bands, b, f[k])
        if (w) s += w * pick(runOf[b])[k]
      }
      out[k] = 10 * Math.log10(s + 1e-30)
    }
    return out
  }
  const avgDb = combine((r) => runSpectra[r].avg)
  const probesDb = probeCells.map((_, i) => combine((r) => runSpectra[r].probes[i]))

  const slices: SimSlice[] = sliceDefs.map((def, s) => {
    const values = new Float32Array(def.idx.length)
    let max = -Infinity
    for (let i = 0; i < def.idx.length; i++) {
      let pw = 0
      for (let b = 0; b < bands.length; b++) {
        const w = bandWeight(bands, b, def.f)
        if (w) { const a = runSlices[runOf[b]][s]; pw += w * (a.re[i] ** 2 + a.im[i] ** 2) }
      }
      values[i] = 10 * Math.log10(pw + 1e-30)
      if (vol[def.idx[i]] > 0 && values[i] > max) max = values[i]
    }
    for (let i = 0; i < values.length; i++) values[i] = vol[def.idx[i]] > 0 ? values[i] - max : NaN
    return { axis: def.axis, at: def.at, f: def.f, w: def.w, h: def.h, values }
  })

  // Modes from the averaged response; axis when within 3% of an axial mode of the inner cavity.
  const lowest = C / 2 / (Math.max(inner.x, inner.y, inner.z) / 1000)
  const axial = rectModes(inner, fMax * 1.03, C).filter((m) => m.kind === 'axial')
  const windowBw = 1 / (Math.PI * tau) // Hz added to every -3 dB bandwidth by the exponential window
  const minBw = 1 / (steps * dt) // record length limits what a bandwidth can resolve
  const modes: SimMode[] = findPeaks(f, avgDb, { minProminence: 3, fMin: lowest / 4, fMax }).map((pk) => {
    let axis: Axis | null = null
    let best = 0.03
    for (const m of axial) {
      const rel = Math.abs(m.f - pk.f) / m.f
      if (rel <= best) { best = rel; axis = AXES[m.n.findIndex((v) => v > 0)] }
    }
    const q = Number.isFinite(pk.q) ? pk.f / Math.max(pk.f / pk.q - windowBw, minBw) : NaN
    return { f: pk.f, level: pk.level, q, axis }
  })

  return { model: 'FDTD estimate', freqs: f, avgDb, probesDb, modes, dx, resolutionMm: dx / SUB, slices }
}
