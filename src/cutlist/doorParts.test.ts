import { describe, expect, it } from 'vitest'
import { doorLayout } from '../doors/doors'
import { defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import type { Design } from '../model/schema'
import { doorParts } from './doorParts'
import { buildParts } from './parts'

const lib = defaultLibrary()
const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  return d
}
const hw = (d: Design, re: RegExp) => doorParts(d, lib).hardware.filter((h) => re.test(h.name))
const sum = (xs: { qty: number }[]) => xs.reduce((a, x) => a + x.qty, 0)

describe('doorParts dual', () => {
  it('leaf parts per layer at the leaf size, all in the doors step', () => {
    const d = base()
    const l = doorLayout(d, lib)
    const { parts } = doorParts(d, lib)
    const outer = parts.filter((p) => /^Outer door leaf/.test(p.name))
    expect(outer).toHaveLength(1)
    expect(outer[0]).toMatchObject({ step: 'doors', kind: 'leaf', qty: 1, thickness: 18 })
    expect([outer[0].length, outer[0].width]).toEqual(
      [Math.max(l.outer!.leaves[0].w, l.outer!.leaves[0].h), Math.min(l.outer!.leaves[0].w, l.outer!.leaves[0].h)].map((n) => Math.round(n * 2) / 2),
    )
    expect(parts.every((p) => p.step === 'doors')).toBe(true)
    expect(parts.filter((p) => /^Inner door leaf/.test(p.name))).toHaveLength(1)
  })

  it('hardware: hinges, latches and seal tape per leaf', () => {
    const d = base()
    const l = doorLayout(d, lib)
    expect(sum(hw(d, /hinge/i))).toBe(2 * l.outer!.hinges[0].positions.length)
    expect(hw(d, /hinge/i)[0].name).toBe('Butt hinge 75 mm')
    expect(sum(hw(d, /latch/i))).toBe(4)
    const tape = hw(d, /tape/i)
    expect(tape).toHaveLength(1)
    const { w, h } = l.outer!.leaves[0]
    expect(tape[0].unit).toBe('m')
    expect(tape[0].qty).toBeCloseTo((2 * (2 * (w + h))) / 1000, 2)
  })

  it('framed adds four frame strips per leaf', () => {
    const d = base()
    d.door.outer.framed = true
    const l = doorLayout(d, lib)
    const frame = doorParts(d, lib).parts.filter((p) => p.kind === 'frame')
    expect(frame.reduce((a, p) => a + p.qty, 0)).toBe(4)
    const tall = frame.find((p) => p.length === Math.round(l.outer!.cutout.h * 2) / 2)!
    expect(tall.qty).toBe(2)
    expect(tall.width).toBe(d.door.outer.frameWidth)
    expect(tall.thickness).toBe(l.outer!.frame!.depth)
  })

  it('split adds an astragal and two half leaves', () => {
    const d = base()
    d.door.outer.opening = 'split'
    const { parts } = doorParts(d, lib)
    const leaf = parts.find((p) => /^Outer door leaf/.test(p.name))!
    expect(leaf.qty).toBe(2)
    const a = parts.filter((p) => /astragal/i.test(p.name))
    expect(a).toHaveLength(1)
    expect(a[0].width).toBe(30)
    expect(a[0].thickness).toBe(18)
    expect(a[0].materialId).toBe('plywood')
    expect(parts.filter((p) => /astragal/i.test(p.name) && /Inner/.test(p.name))).toHaveLength(0)
  })

  it('rebated seal puts a rebate note on the inner leaf only', () => {
    const d = base()
    const { parts } = doorParts(d, lib)
    expect(parts.find((p) => /^Inner door leaf/.test(p.name))!.notes.join()).toMatch(/rebate/i)
    expect(parts.find((p) => /^Outer door leaf/.test(p.name))!.notes.join()).not.toMatch(/rebate/i)
    d.door.inner.sealTypeId = 'tape-20x10'
    expect(doorParts(d, lib).parts.find((p) => /^Inner door leaf/.test(p.name))!.notes.join()).not.toMatch(/rebate/i)
  })

  it('door-gap gasket only when the door wall has a cavity', () => {
    const d = base()
    expect(doorParts(d, lib).parts.filter((p) => /gasket/i.test(p.name))).toHaveLength(0)
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 40, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const l = doorLayout(d, lib)
    const g = doorParts(d, lib).parts.filter((p) => /gasket/i.test(p.name))
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ materialId: 'rubber', kind: 'strip' })
    expect(g[0].length).toBeCloseTo(2 * (l.inner!.cutout.w + l.inner!.cutout.h), 0)
    expect(g[0].notes.join()).toMatch(/soft gasket/)
  })
})

describe('doorParts wall mode', () => {
  it('no leaf or frame parts; hinges, latches, seals per line', () => {
    const d = base()
    d.door.kind = 'wall'
    const l = doorLayout(d, lib).wall!
    const { parts, hardware } = doorParts(d, lib)
    expect(parts).toHaveLength(0)
    expect(sum(hardware.filter((h) => /hinge/i.test(h.name)))).toBe(l.hinges.length)
    expect(sum(hardware.filter((h) => /latch/i.test(h.name)))).toBe(l.latches.length)
    const seals = hardware.filter((h) => /\(shell\)/.test(h.name))
    expect(seals[0].name).toBe('Compression tape 12x6 (shell)')
    expect(seals[0].qty).toBeCloseTo(l.seals[0].perimeterMm / 1000, 2)
    expect(seals[0].unit).toBe('m')
  })
})

describe('buildParts door hook', () => {
  it('lists door parts and hardware', () => {
    const d = base()
    const r = buildParts(d, lib, defaultShop())
    expect(r.parts.some((p) => p.step === 'doors' && /door leaf/.test(p.name))).toBe(true)
    expect(r.hardware.some((h) => /hinge/i.test(h.name))).toBe(true)
  })
})
