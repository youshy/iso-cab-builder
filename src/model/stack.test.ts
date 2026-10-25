import { describe, expect, it } from 'vitest'
import { defaultDesign, defaultLibrary } from './defaults'
import { addLayer, canInsertGapAt, DEFAULT_GAP, insertGap, materialUsage, moveLayer, removeLayer, setLayerMaterial } from './stack'
import type { StackItem } from './schema'

const L = (materialId: string, thickness: number): StackItem => ({ kind: 'layer', materialId, thickness })

describe('stack helpers', () => {
  it('inserts a gap at the first free boundary; none free is a no-op', () => {
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
  describe('variable layer count', () => {
    const lib = defaultLibrary()
    const kinds = (s: StackItem[]) => s.map((i) => i.kind)
    it('addLayer appends a copy of the innermost layer', () => {
      const s = addLayer([L('plywood', 18), L('mdf', 18)], lib)
      expect(s).toHaveLength(3)
      expect(s[2]).toEqual(L('mdf', 18))
    })
    it('addLayer at index 0 inserts a copy of the innermost layer first', () => {
      const s = addLayer([L('plywood', 18), L('mdf', 12)], lib, 0)
      expect(s.map((i) => (i as any).materialId)).toEqual(['mdf', 'plywood', 'mdf'])
      expect(s[0]).toEqual(L('mdf', 12))
    })
    it('addLayer copies the innermost layer even when a gap sits between', () => {
      const s = addLayer([L('plywood', 18), { ...DEFAULT_GAP }, L('mdf', 12)], lib, 1)
      expect(kinds(s)).toEqual(['layer', 'layer', 'gap', 'layer'])
      expect(s[1]).toEqual(L('mdf', 12))
    })
    it('addLayer on an empty stack uses the first sheet material', () => {
      const s = addLayer([], lib)
      const m = lib.materials.find((x) => x.kind === 'sheet')!
      expect(s).toEqual([L(m.id, m.thicknesses[0])])
    })
    it('addLayer does not mutate and returns independent objects', () => {
      const a = [L('plywood', 18)]
      const b = addLayer(a, lib)
      expect(a).toHaveLength(1)
      expect(b[1]).not.toBe(a[0])
    })
    it('moveLayer refuses to make the gap first or last', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2)]
      expect(moveLayer(s, 1, -1)).toBe(s)
      expect(moveLayer(s, 1, 1)).toBe(s)
      expect(moveLayer(s, 0, 1)).toBe(s)
      expect(moveLayer(s, 2, -1)).toBe(s)
    })
    it('moveLayer still swaps layers around a gap', () => {
      const s = [L('a', 1), L('b', 2), { ...DEFAULT_GAP }, L('c', 3)]
      expect(moveLayer(s, 0, 1).map((i) => (i as any).materialId)).toEqual(['b', 'a', undefined, 'c'])
    })
    it('removeLayer refuses to leave the gap outermost or innermost', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2)]
      expect(removeLayer(s, 0)).toBe(s)
      expect(removeLayer(s, 2)).toBe(s)
    })
    it('removeLayer allows down to one layer, never zero', () => {
      const s = [L('a', 1), L('b', 2), L('c', 3)]
      const two = removeLayer(s, 1)
      expect(two).toHaveLength(2)
      const one = removeLayer(two, 0)
      expect(one).toHaveLength(1)
      expect(removeLayer(one, 0)).toBe(one)
      const g = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2), L('c', 3)]
      expect(removeLayer(g, 3)).toHaveLength(3)
    })
    it('insertGap at boundary 3 adds a second cavity', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2), L('c', 3)]
      const out = insertGap(s, lib, 3)
      expect(kinds(out)).toEqual(['layer', 'gap', 'layer', 'gap', 'layer'])
      expect((out[3] as any).fillMaterialId).toBe('rockwool')
      expect(out[3]).not.toBe(out[1])
    })
    it('insertGap refuses boundaries next to a gap or at a face', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2), L('c', 3)]
      for (const i of [0, 1, 2, 4]) {
        expect(canInsertGapAt(s, i)).toBe(false)
        expect(insertGap(s, lib, i)).toBe(s)
      }
      expect(canInsertGapAt(s, 3)).toBe(true)
    })
    it('insertGap without a boundary uses the first free one', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2), L('c', 3)]
      expect(kinds(insertGap(s))).toEqual(['layer', 'gap', 'layer', 'gap', 'layer'])
    })
    it('insertGap falls back to the first fill material when rockwool is missing', () => {
      const lib2 = { ...lib, materials: lib.materials.filter((m) => m.id !== 'rockwool') }
      const fill = lib2.materials.find((m) => m.kind === 'fill')!
      const out = insertGap([L('a', 1), L('b', 2)], lib2, 1)
      expect((out[1] as any).fillMaterialId).toBe(fill.id)
    })
    it('moveLayer and removeLayer never make two gaps adjacent', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2), { ...DEFAULT_GAP }, L('c', 3)]
      expect(removeLayer(s, 2)).toBe(s)
      expect(moveLayer(s, 1, 1)).toBe(s)
      expect(moveLayer(s, 3, -1)).toBe(s)
      expect(kinds(removeLayer(s, 3))).toEqual(['layer', 'gap', 'layer', 'layer'])
    })
    it('removeLayer can remove the gap itself', () => {
      const s = [L('a', 1), { ...DEFAULT_GAP }, L('b', 2)]
      expect(kinds(removeLayer(s, 1))).toEqual(['layer', 'layer'])
    })
  })
})
