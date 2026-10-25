import { doorLayout } from '../doors/doors'
import { CLIP_WEIGHT_KG } from '../model/defaults'
import type { Design, Library, Shop } from '../model/schema'
import { buildParts, STEP_ORDER, type BuildStep, type Part } from './parts'

export type WeightReport = {
  totalKg: number
  byStep: { step: BuildStep; kg: number }[]
  byMaterial: { materialId: string; kg: number }[]
  hardwareKg: number
  heaviestPart: { partId: string; name: string; kg: number } | null
  /** What the hinges carry: wall door = whole wall plus hardware; dual = the heavier of the two leaf groups. */
  movingAssemblyKg: number
  /** Total plus the heaviest cab's own weight. */
  withHeaviestCabKg: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * Mass of one part line (all qty), kg. Panels, rolls, strips and fillers are the full block
 * length x width x thickness x density. Packers are bevelled strips, so the block is an upper bound.
 * End wedges and tapered bay fill are triangular: half the block.
 */
function partKg(p: Part, density: number): number {
  const shape = p.kind === 'wedge' || p.notes.some((n) => /wedge/.test(n)) ? 0.5 : 1
  return ((p.length * p.width * p.thickness) / 1e9) * density * p.qty * shape
}

/**
 * Estimated mass of the whole build, excluding cabs. Hinges and latches use the library weight per
 * piece, isolation clips use CLIP_WEIGHT_KG. Seal tape and sealant (sold by the metre) are ignored as negligible.
 */
export function buildWeight(d: Design, lib: Library, shop: Shop): WeightReport {
  const { parts, hardware } = buildParts(d, lib, shop)
  const density = (id: string) => lib.materials.find((m) => m.id === id)?.density ?? 0
  const hingeKg = (name: string) => lib.hinges.find((h) => h.name === name)?.weightKg
  const latchKg = (name: string) => lib.latches.find((l) => l.name === name)?.weightKg

  const step = new Map<BuildStep, number>()
  const material = new Map<string, number>()
  let heaviest: WeightReport['heaviestPart'] = null
  let partsKg = 0
  for (const p of parts) {
    const kg = partKg(p, density(p.materialId))
    partsKg += kg
    step.set(p.step, (step.get(p.step) ?? 0) + kg)
    material.set(p.materialId, (material.get(p.materialId) ?? 0) + kg)
    // Heaviest single piece, not the line total.
    const each = kg / Math.max(p.qty, 1)
    if (!heaviest || each > heaviest.kg) heaviest = { partId: p.id, name: p.name, kg: each }
  }
  let hardwareKg = 0
  for (const h of hardware) {
    if (h.unit !== 'pcs') continue
    const each = h.name === 'Isolation clip' ? CLIP_WEIGHT_KG : (hingeKg(h.name) ?? latchKg(h.name) ?? 0)
    hardwareKg += each * h.qty
    // Hinges and latches belong to the doors; clips decouple inner boxes (attributed to the middle step).
    const at: BuildStep = h.name === 'Isolation clip' ? 'middle' : 'doors'
    step.set(at, (step.get(at) ?? 0) + each * h.qty)
  }
  const total = partsKg + hardwareKg

  // Moving assembly.
  const door = doorLayout(d, lib)
  const hw = (hingeId: string, hingeCount: number, latchId: string, latchCount: number) =>
    hingeCount * (lib.hinges.find((h) => h.id === hingeId)?.weightKg ?? 0) +
    latchCount * (lib.latches.find((l) => l.id === latchId)?.weightKg ?? 0)
  let moving: number
  if (door.kind === 'wall' && door.wall) {
    const cfg = d.door.outer
    moving = door.wall.massKg + hw(cfg.hingeTypeId, door.wall.hinges.length, cfg.latchTypeId, door.wall.latches.length)
  } else {
    const group = (which: 'outer' | 'inner') => {
      const leaf = door[which]
      if (!leaf) return 0
      const label = which === 'outer' ? 'Outer door' : 'Inner door'
      const mass = parts
        .filter((p) => p.step === 'doors' && p.name.startsWith(label) && p.kind !== 'frame')
        .reduce((a, p) => a + partKg(p, density(p.materialId)), 0)
      const cfg = d.door[which]
      const hingeCount = leaf.hinges.reduce((a, e) => a + e.positions.length, 0)
      return mass + hw(cfg.hingeTypeId, hingeCount, cfg.latchTypeId, leaf.latches.length)
    }
    moving = Math.max(group('outer'), group('inner'))
  }

  const heaviestCab = d.cabs.reduce((m, c) => Math.max(m, c.weightKg), 0)
  return {
    totalKg: r1(total),
    byStep: STEP_ORDER.filter((s) => step.has(s)).map((s) => ({ step: s, kg: r1(step.get(s)!) })),
    byMaterial: [...material].map(([materialId, kg]) => ({ materialId, kg: r1(kg) })).sort((a, b) => b.kg - a.kg),
    hardwareKg: r1(hardwareKg),
    heaviestPart: heaviest && { ...(heaviest as NonNullable<typeof heaviest>), kg: r1((heaviest as NonNullable<typeof heaviest>).kg) },
    movingAssemblyKg: r1(moving),
    withHeaviestCabKg: r1(total + heaviestCab),
  }
}
