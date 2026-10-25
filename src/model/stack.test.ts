import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from './defaults'
import { insertGap, materialUsage, moveLayer, removeLayer, setLayerMaterial } from './stack'
import type { StackItem } from './schema'

const L = (materialId: string, thickness: number): StackItem => ({ kind: 'layer', materialId, thickness })

describe('stack helpers', () => {
  it('inserts a gap after the first layer, once', () => {
    const s = insertGap([L('plywood', 18), L('mdf', 18)])
    expect(s.map((i) => i.kind)).toEqual(['layer', 'gap', 'layer'])
    expect(s[1]).toMatchObject({ width: 25, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' })
    expect(insertGap(s)).toBe(s)
  })
  it('moves items and ignores out of range', () => {
    const s = [L('a', 1), L('b', 2), L('c', 3)]
    expect(moveLayer(s, 0, 1).map((i) => (i as any).materialId)).toEqual(['b', 'a', 'c'])
    expect(moveLayer(s, 0, -1)).toBe(s)
    expect(moveLayer(s, 2, 1)).toBe(s)
  })
  it('removes items but never the last', () => {
    expect(removeLayer([L('a', 1), L('b', 2)], 0)).toHaveLength(1)
    const one = [L('a', 1)]
    expect(removeLayer(one, 0)).toBe(one)
  })
  it('keeps thickness when offered, else uses first', () => {
    const lib = defaultLibrary()
    expect(setLayerMaterial([L('plywood', 18)], 0, 'mdf', lib)[0]).toMatchObject({ materialId: 'mdf', thickness: 18 })
    expect(setLayerMaterial([L('plywood', 9)], 0, 'mdf', lib)[0]).toMatchObject({ materialId: 'mdf', thickness: 12 })
  })
  it('reports where a material is used', () => {
    const d = defaultDesign()
    expect(materialUsage(d, 'plywood')).toContain('default wall')
    d.wallOverrides.left = [L('osb', 12)]
    expect(materialUsage(d, 'osb')).toEqual(['left wall override'])
    expect(materialUsage(d, 'carpet')).toEqual([])
  })
})
