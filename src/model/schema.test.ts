import { describe, it, expect } from 'vitest'
import { DesignSchema, MaterialSchema } from './schema'
import { defaultDesign, defaultLibrary } from './defaults'

const layer = { kind: 'layer' as const, materialId: 'plywood', thickness: 18 }
const gap = {
  kind: 'gap' as const,
  width: 20,
  decoupling: 'strips' as const,
  fill: 'empty' as const,
  fillMaterialId: 'rockwool',
}
const facet = { width: 100, tilt: 10, hinge: 'min' as const }
const interior = (facets: unknown[]) => ({
  splitAxis: 'x',
  facets,
  panelMaterialId: 'plywood',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})

describe('DesignSchema', () => {
  it('parses the default design', () => {
    expect(() => DesignSchema.parse(defaultDesign())).not.toThrow()
  })

  it('rejects a stack with two adjacent gaps', () => {
    const d = { ...defaultDesign(), wallDefault: [layer, gap, gap, layer] }
    expect(DesignSchema.safeParse(d).success).toBe(false)
  })

  it('rejects a gap at either face', () => {
    expect(DesignSchema.safeParse({ ...defaultDesign(), wallDefault: [gap, layer] }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...defaultDesign(), wallDefault: [layer, gap] }).success).toBe(false)
  })

  it('accepts a stack with two separated gaps', () => {
    const d = { ...defaultDesign(), wallDefault: [layer, gap, layer, gap, layer] }
    expect(DesignSchema.safeParse(d).success).toBe(true)
  })

  it('accepts a stack with one gap', () => {
    const d = { ...defaultDesign(), wallDefault: [layer, gap, layer] }
    expect(DesignSchema.safeParse(d).success).toBe(true)
  })

  it('rejects a design with no cabs', () => {
    const d = { ...defaultDesign(), cabs: [] }
    expect(DesignSchema.safeParse(d).success).toBe(false)
  })

  it('rejects facet tilt of 20.5', () => {
    const d = { ...defaultDesign(), interior: { left: interior([{ ...facet, tilt: 20.5 }]) } }
    expect(DesignSchema.safeParse(d).success).toBe(false)
  })

  it('accepts 8 facets and rejects 9', () => {
    const mk = (n: number) => ({
      ...defaultDesign(),
      interior: { left: interior(Array.from({ length: n }, () => facet)) },
    })
    expect(DesignSchema.safeParse(mk(8)).success).toBe(true)
    expect(DesignSchema.safeParse(mk(9)).success).toBe(false)
  })

  it('references only materials that exist in the default library', () => {
    const d = defaultDesign()
    const ids = new Set(defaultLibrary().materials.map((m) => m.id))
    const refs: string[] = []
    const stacks = [d.wallDefault, ...Object.values(d.wallOverrides)]
    for (const s of stacks) for (const i of s ?? []) refs.push(i.kind === 'layer' ? i.materialId : i.fillMaterialId)
    for (const w of Object.values(d.interior)) if (w) refs.push(w.panelMaterialId)
    for (const p of d.panels) {
      refs.push(...p.layers.map((l) => l.materialId))
      if (p.insulation) refs.push(p.insulation.materialId)
    }
    for (const t of d.treatments) refs.push(t.materialId)
    for (const l of [d.door.outer, d.door.inner]) refs.push(...(l.stack ?? []).map((x) => x.materialId))
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) expect(ids.has(r), r).toBe(true)
  })

  it('references only hardware that exists in the default library', () => {
    const d = defaultDesign()
    const lib = defaultLibrary()
    for (const l of [d.door.outer, d.door.inner]) {
      expect(lib.hinges.some((h) => h.id === l.hingeTypeId)).toBe(true)
      expect(lib.seals.some((h) => h.id === l.sealTypeId)).toBe(true)
      expect(lib.latches.some((h) => h.id === l.latchTypeId)).toBe(true)
    }
    expect(d.cabs.some((c) => c.id === d.sim.cabId)).toBe(true)
    expect(d.cabs.some((c) => c.id === d.dims.sizingCabId)).toBe(true)
  })
})

describe('import-boundary ranges', () => {
  it('rejects out-of-range values', () => {
    const lib = defaultLibrary()
    const m = lib.materials[0]
    expect(MaterialSchema.safeParse({ ...m, absorption: [1.5, 0, 0, 0, 0, 0] }).success).toBe(false)
    expect(MaterialSchema.safeParse({ ...m, absorption: [-0.1, 0, 0, 0, 0, 0] }).success).toBe(false)
    expect(MaterialSchema.safeParse({ ...m, thicknesses: [] }).success).toBe(false)
    expect(MaterialSchema.safeParse({ ...m, thicknesses: [0] }).success).toBe(false)
    expect(MaterialSchema.safeParse({ ...m, lossFactor: -1 }).success).toBe(false)
    const d = defaultDesign()
    expect(DesignSchema.safeParse({ ...d, sim: { ...d.sim, fMax: 100 } }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...d, sim: { ...d.sim, fMax: 3000 } }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...d, escape: { ...d.escape, insideLevel: [1, 2] } }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...d, dims: { ...d.dims, inner: { x: 0, y: 1, z: 1 } } }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...d, dims: { ...d.dims, outer: { x: 1, y: -1, z: 1 } } }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...d, dims: { ...d.dims, clearance: -1 } }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...d, wallDefault: [{ ...gap, width: 0 }] }).success).toBe(false)
  })
})

describe('cabYaw', () => {
  it('defaults to 0 for older designs and is limited to 0..360', () => {
    const { cabYaw: _omit, ...old } = defaultDesign()
    const parsed = DesignSchema.parse(old)
    expect(parsed.cabYaw).toBe(0)
    expect(DesignSchema.safeParse({ ...old, cabYaw: 30.5 }).success).toBe(true)
    expect(DesignSchema.safeParse({ ...old, cabYaw: -1 }).success).toBe(false)
    expect(DesignSchema.safeParse({ ...old, cabYaw: 361 }).success).toBe(false)
  })
})
