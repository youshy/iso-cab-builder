import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../model/defaults'
import type { Design, InnerPanel } from '../model/schema'
import { resolveDims } from './dimensions'
import { clampTo, panelWarnings } from './panels'

const panel = (over: Partial<InnerPanel> = {}): InnerPanel => ({
  id: 'p', normal: 'x', position: 100, u0: 0, u1: 200, v0: 0, v1: 200,
  layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }], insulation: null, ...over,
})
const withPanel = (p: InnerPanel): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  d.panels.push(p)
  return d
}

describe('panelWarnings', () => {
  it('is silent for a panel inside the cavity', () => {
    expect(panelWarnings(withPanel(panel()))).toEqual([])
  })

  it('reports how far a panel sticks out of the box', () => {
    const d = withPanel(panel())
    const { inner } = resolveDims(d)
    d.panels[0].u1 = inner.y + 40
    expect(panelWarnings(d)).toEqual(['Panel 1 sticks out of the box by 40 mm.'])
  })

  it('counts the slab and its treatments along the normal', () => {
    const d = withPanel(panel({ position: 0 }))
    d.treatments.push({ id: 't', surface: { panelId: 'p', side: 'neg' }, materialId: 'rockwool', thickness: 30 })
    expect(panelWarnings(d)).toContain('Panel 1 sticks out of the box by 30 mm.')
  })

  it('reports a panel that cuts into wall facets', () => {
    const d = withPanel(panel({ position: 2, u0: 0, u1: 100, v0: 0, v1: 100 }))
    d.interior.left = {
      splitAxis: 'z', facets: [{ width: 400, tilt: 20, hinge: 'min' }], panelMaterialId: 'plywood',
      panelThickness: 12, closure: 'fillers', behind: 'insulation',
    }
    expect(panelWarnings(d)).toContain('Panel 1 cuts into the left wall facets.')
  })
})

describe('clampTo', () => {
  it('keeps values inside [0, max]', () => {
    expect([clampTo(-5, 100), clampTo(50, 100), clampTo(500, 100)]).toEqual([0, 50, 100])
  })
})
