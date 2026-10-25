import { describe, expect, it } from 'vitest'
import { doorLayout } from '../doors/doors'
import { CLIP_WEIGHT_KG, defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import { DesignSchema, LibrarySchema, type Design } from '../model/schema'
import { buildParts } from './parts'
import { buildWeight } from './weight'

const lib = defaultLibrary()
const shop = defaultShop()
const dens = (id: string) => lib.materials.find((m) => m.id === id)!.density

/** Independent hand sum: full-block volume, halved for triangular wedges. */
function handSum(d: Design) {
  const { parts, hardware } = buildParts(d, lib, shop)
  let kg = 0
  for (const p of parts) {
    const shape = p.kind === 'wedge' || /wedge/.test(p.notes.join(' ')) ? 0.5 : 1
    kg += ((p.length * p.width * p.thickness) / 1e9) * dens(p.materialId) * p.qty * shape
  }
  for (const h of hardware) {
    if (h.unit !== 'pcs') continue
    if (h.name === 'Isolation clip') kg += h.qty * CLIP_WEIGHT_KG
    const hinge = lib.hinges.find((x) => x.name === h.name)
    const latch = lib.latches.find((x) => x.name === h.name)
    kg += h.qty * (hinge?.weightKg ?? latch?.weightKg ?? 0)
  }
  return kg
}

describe('buildWeight', () => {
  it('matches a hand sum and splits consistently', () => {
    const d = defaultDesign()
    const w = buildWeight(d, lib, shop)
    expect(w.totalKg).toBeGreaterThan(10)
    expect(Math.abs(w.totalKg - handSum(d))).toBeLessThan(0.1)
    expect(Math.abs(w.byStep.reduce((a, s) => a + s.kg, 0) - w.totalKg)).toBeLessThan(0.1 * w.byStep.length)
    expect(Math.abs(w.byMaterial.reduce((a, s) => a + s.kg, 0) + w.hardwareKg - w.totalKg)).toBeLessThan(0.1 * (w.byMaterial.length + 2))
    expect(w.heaviestPart!.kg).toBeGreaterThan(0)
  })

  it('an MLV layer adds its mass', () => {
    const d = defaultDesign()
    const before = buildWeight(d, lib, shop).totalKg
    const area = (dd: Design) =>
      buildParts(dd, lib, shop).parts.filter((p) => p.materialId === 'mlv').reduce((a, p) => a + (p.length * p.width * p.qty) / 1e6, 0)
    expect(area(d)).toBe(0)
    d.wallDefault = [...d.wallDefault, { kind: 'layer', materialId: 'mlv', thickness: 5 }]
    const a = area(d)
    expect(a).toBeGreaterThan(0)
    // Other layers grow with the new outer size, so compare the MLV line itself.
    const after = buildWeight(d, lib, shop)
    const mlv = after.byMaterial.find((m) => m.materialId === 'mlv')!.kg
    const expected = dens('mlv') * 0.005 * a
    expect(Math.abs(mlv - expected)).toBeLessThan(0.02 * expected)
    // The total rose by the MLV line plus the small growth of the other layers.
    const rose = after.totalKg - before
    expect(rose).toBeGreaterThanOrEqual(mlv - 0.1)
    expect(rose - mlv).toBeLessThan(0.05 * mlv) // outer layers get bigger boxes (about 3% here)
  })

  it('wall door: moving assembly is at least the wall mass', () => {
    const d = defaultDesign()
    d.door.kind = 'wall'
    const l = doorLayout(d, lib)
    const w = buildWeight(d, lib, shop)
    expect(w.movingAssemblyKg).toBeGreaterThanOrEqual(l.wall!.massKg - 0.1)
  })

  it('dual doors: moving assembly is the heavier leaf group, hinges and latches included', () => {
    const d = defaultDesign()
    const w = buildWeight(d, lib, shop)
    const door = doorLayout(d, lib)
    const group = (which: 'outer' | 'inner') => {
      const leaf = door[which]!
      const cfg = d.door[which]
      const mass = buildParts(d, lib, shop).parts
        .filter((p) => p.step === 'doors' && p.name.startsWith(which === 'outer' ? 'Outer door' : 'Inner door') && p.kind !== 'frame')
        .reduce((a, p) => a + ((p.length * p.width * p.thickness) / 1e9) * dens(p.materialId) * p.qty, 0)
      const hinges = leaf.hinges.reduce((a, e) => a + e.positions.length, 0) * lib.hinges.find((h) => h.id === cfg.hingeTypeId)!.weightKg
      const latches = leaf.latches.length * lib.latches.find((l) => l.id === cfg.latchTypeId)!.weightKg
      return mass + hinges + latches
    }
    expect(Math.abs(w.movingAssemblyKg - Math.max(group('outer'), group('inner')))).toBeLessThan(0.06)
    expect(w.movingAssemblyKg).toBeGreaterThan(0)
    expect(w.movingAssemblyKg).toBeLessThan(w.totalKg)
  })

  it('isolation clips are counted under the box they belong to', () => {
    const d = defaultDesign()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 25, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const { parts, hardware } = buildParts(d, lib, shop)
    const clips = hardware.filter((h) => h.name === 'Isolation clip')
    expect(clips.map((c) => c.step)).toEqual(['liner'])
    const kg = clips[0].qty * CLIP_WEIGHT_KG
    const w = buildWeight(d, lib, shop)
    const partsOf = (s: string) => parts.filter((p) => p.step === s).reduce((a, p) => a + ((p.length * p.width * p.thickness) / 1e9) * dens(p.materialId) * p.qty, 0)
    expect(w.byStep.find((s) => s.step === 'liner')!.kg).toBeCloseTo(partsOf('liner') + kg, 1)
    expect(w.byStep.find((s) => s.step === 'middle')).toBeUndefined()
  })

  it('adds the heaviest cab', () => {
    const d = defaultDesign()
    const t = buildWeight(d, lib, shop)
    d.cabs[0].weightKg = 40
    const w = buildWeight(d, lib, shop)
    expect(w.withHeaviestCabKg).toBeCloseTo(w.totalKg + 40, 5)
    expect(w.totalKg).toBe(t.totalKg)
  })

  it('old JSON without weight fields still parses', () => {
    const d = JSON.parse(JSON.stringify(defaultDesign()))
    for (const c of d.cabs) delete c.weightKg
    expect(DesignSchema.parse(d).cabs[0].weightKg).toBe(0)
    const l = JSON.parse(JSON.stringify(defaultLibrary()))
    for (const h of l.hinges) delete h.weightKg
    for (const x of l.latches) delete x.weightKg
    const p = LibrarySchema.parse(l)
    expect(p.hinges[0].weightKg).toBeGreaterThan(0)
    expect(p.latches.every((x) => x.weightKg > 0)).toBe(true)
  })
})
