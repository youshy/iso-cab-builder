import { describe, expect, it } from 'vitest'
import { buildParts } from '../cutlist/parts'
import { resolveDims } from '../geometry/dimensions'
import { defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import type { Design, Facet, WallInterior } from '../model/schema'
import { buildSheets, type Sheet } from './sheets'

const lib = defaultLibrary()
const shop = defaultShop()
const f = (width: number, tilt: number, hinge: 'min' | 'max' = 'min'): Facet => ({ width, tilt, hinge })
const interior = (facets: Facet[]): WallInterior => ({
  splitAxis: 'z', facets, panelMaterialId: 'plywood', panelThickness: 12, closure: 'fillers', behind: 'insulation',
})

const sheetsOf = (d: Design) => {
  const { parts } = buildParts(d, lib, shop)
  return { parts, sheets: buildSheets(d, lib, parts, { version: 3, date: '2026-10-25' }) }
}

/** The default design (door on the left) with facets, an inner panel and treatments, so every step has parts. */
const full = (): Design => {
  const d = structuredClone(defaultDesign())
  d.interior.right = interior([f(200, 4, 'min'), f(200, 7, 'max')])
  d.panels = [{
    id: 'p1', normal: 'x', position: 600, u0: 0, u1: 1000, v0: 0, v1: 300,
    layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }], insulation: null,
  }]
  d.treatments = [
    { id: 't1', surface: { wall: 'top' }, materialId: 'foam', thickness: 30 },
    { id: 't2', surface: { wall: 'right' }, materialId: 'carpet', thickness: 8 },
  ]
  return d
}

const twoCavities = (): Design => {
  const d = full()
  d.wallDefault = [
    { kind: 'layer', materialId: 'plywood', thickness: 18 },
    { kind: 'gap', width: 20, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
    { kind: 'layer', materialId: 'osb', thickness: 12 },
    { kind: 'layer', materialId: 'mlv', thickness: 5 },
    { kind: 'gap', width: 30, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
    { kind: 'layer', materialId: 'mdf', thickness: 18 },
  ]
  return d
}

const oneCavity = (): Design => {
  const d = full()
  d.wallDefault = [
    { kind: 'layer', materialId: 'plywood', thickness: 18 },
    { kind: 'gap', width: 25, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
    { kind: 'layer', materialId: 'mdf', thickness: 18 },
  ]
  d.door.outer.opening = 'split'
  d.door.inner.framed = true
  return d
}

const wallDoor = (): Design => {
  const d = oneCavity()
  d.door.kind = 'wall'
  d.door.outer.opening = 'out'
  return d
}

const mitre = (): Design => {
  const d = full()
  d.joint = 'mitre'
  return d
}

/** The review fixture: facets, panels, treatment, one cavity, split outer door, framed inner door. */
const review = (): Design => oneCavity()

const balloon = (id: string) => new RegExp(`<text class="bid"[^>]*>${id}</text>`)

/** Minimal XML well-formedness: balanced tags, nothing left open, no bare ampersands. */
function wellFormed(svg: string): boolean {
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/, '')
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(body)) return false
  const stack: string[] = []
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (body.slice(at, m.index).includes('<')) return false // a tag the pattern could not read
    at = re.lastIndex
    const [, close, name, , self] = m
    if (self) continue
    if (close) {
      if (stack.pop() !== name) return false
    } else stack.push(name)
  }
  return stack.length === 0 && !body.slice(at).includes('<')
}

const cases: [string, () => Design][] = [
  ['default design', () => structuredClone(defaultDesign())],
  ['default with facets, panels and treatment', full],
  ['two-cavity stack', twoCavities],
  ['one cavity, split and framed doors', oneCavity],
  ['wall-door mode', wallDoor],
  ['mitre joint', mitre],
]

describe('buildSheets coverage', () => {
  it.each(cases)('%s: every part id has a balloon on the sheet of its own step', (_, make) => {
    const { parts, sheets } = sheetsOf(make())
    for (const p of parts) {
      const own = sheets.filter((s) => s.step === p.step)
      expect(own.some((s) => balloon(p.id).test(s.svg)), `${p.id} ${p.name}`).toBe(true)
    }
  })

  it.each(cases)('%s: every svg is well formed A3 landscape', (_, make) => {
    for (const s of sheetsOf(make()).sheets) {
      expect(wellFormed(s.svg), s.title).toBe(true)
      expect(s.svg).toMatch(/^<svg [^>]*width="420mm"/)
      expect(s.svg).toMatch(/height="297mm"/)
    }
  })

  it('merged parts show one balloon with the quantity', () => {
    const { parts, sheets } = sheetsOf(structuredClone(defaultDesign()))
    const merged = parts.find((p) => p.qty > 1 && p.step === 'shell')!
    const shell = sheets.find((s) => s.step === 'shell')!
    expect(shell.svg.match(new RegExp(balloon(merged.id).source, 'g'))).toHaveLength(1)
    expect(shell.svg).toContain(`×${merged.qty}`)
  })
})

const fmt = (n: number) => String(Math.round(n * 10) / 10)
const dimCases: [string, () => Design][] = [
  ['default design', () => structuredClone(defaultDesign())],
  ['two-cavity stack', twoCavities],
  ['wall-door mode', wallDoor],
  ['mitre joint', mitre],
  ['review fixture', review],
]

describe('buildSheets cut sizes', () => {
  it.each(dimCases)('%s: every ballooned part shows its cut-list length and width on its sheet', (_, make) => {
    const { parts, sheets } = sheetsOf(make())
    for (const s of sheets) {
      const ids = [...s.svg.matchAll(/<text class="bid"[^>]*>(P\d+)<\/text>/g)].map((m) => m[1])
      for (const id of ids) {
        const p = parts.find((q) => q.id === id)!
        expect(s.svg, `${s.title} ${id} ${p.name} length`).toContain(`>${fmt(p.length)}<`)
        expect(s.svg, `${s.title} ${id} ${p.name} width`).toContain(`>${fmt(p.width)}<`)
      }
    }
  })

  it('facets and doors sheets list cut size, thickness and bevels of every part', () => {
    const { parts, sheets } = sheetsOf(review())
    for (const step of ['facets', 'doors'] as const) {
      const svg = sheets.filter((s) => s.step === step).map((s) => s.svg).join('')
      expect(svg).toContain('Cut sizes')
      for (const p of parts.filter((q) => q.step === step)) {
        expect(svg).toContain(`>${fmt(p.thickness)}<`)
        for (const b of p.bevels) expect(svg).toContain(`${b.edge} ${fmt(b.angle)}°`)
      }
    }
    const facet = parts.find((p) => p.name === 'Right facet 1')!
    expect(facet.width).toBe(200.5) // 200 / cos 4°, as cut, not the 200 projected width
    expect(sheets.find((s) => s.step === 'facets')!.svg).toContain('>200.5<')
    // packing labels read the same as the packer thickness in the cut list
    for (const pk of parts.filter((p) => /packer/.test(p.name))) {
      expect(sheets.find((s) => s.step === 'facets')!.svg).toContain(`packing ${fmt(pk.thickness)}`)
    }
  })
})

describe('buildSheets order and presence', () => {
  const steps = (ss: Sheet[]) => ss.map((s) => s.step)

  it('default design: overview, shell, doors; no liner or middle without a cavity', () => {
    expect(steps(sheetsOf(structuredClone(defaultDesign())).sheets)).toEqual(['overview', 'shell', 'doors'])
  })

  it('full design keeps the build order', () => {
    expect(steps(sheetsOf(full()).sheets)).toEqual(['overview', 'shell', 'facets', 'panels', 'treatment', 'doors'])
  })

  it('liner sheet only with a cavity, middle only with two', () => {
    expect(steps(sheetsOf(oneCavity()).sheets)).toEqual(['overview', 'shell', 'liner', 'facets', 'panels', 'treatment', 'doors'])
    const two = sheetsOf(twoCavities()).sheets
    expect(steps(two)).toEqual(['overview', 'shell', 'middle', 'liner', 'facets', 'panels', 'treatment', 'doors'])
    expect(two.find((s) => s.step === 'middle')!.title).toMatch(/Middle box 1/)
  })

  it('wall-door mode still draws the door sheet with both seal lines', () => {
    const doors = sheetsOf(wallDoor()).sheets.find((s) => s.step === 'doors')!
    expect(doors.svg).toMatch(/shell seal/)
    expect(doors.svg).toMatch(/liner seal/)
    expect(doors.svg).toMatch(/hinge/i)
  })
})

describe('buildSheets content', () => {
  it('overview shows the outer W, H and D', () => {
    const d = structuredClone(defaultDesign())
    const { outer } = resolveDims(d)
    const ov = sheetsOf(d).sheets[0]
    expect(ov.step).toBe('overview')
    for (const v of [outer.x, outer.y, outer.z]) expect(ov.svg).toContain(`>${String(Math.round(v * 10) / 10)}<`)
  })

  it('overview draws a right-side view when the door is on the right wall', () => {
    const d = structuredClone(defaultDesign())
    d.door.side = 'right'
    const ov = sheetsOf(d).sheets[0]
    expect(ov.svg).toContain('Right side')
    expect(ov.svg).toContain('>door<')
    expect(sheetsOf(structuredClone(defaultDesign())).sheets[0].svg).not.toContain('Right side')
  })

  it('a drawing too big for A3 at 1:20 is shrunk, marked NOT TO SCALE and reported', () => {
    const d = structuredClone(defaultDesign())
    d.dims.mode = 'outside'
    d.dims.outer = { x: 9000, y: 2400, z: 1200 }
    const { sheets } = sheetsOf(d)
    const shell = sheets.find((s) => s.step === 'shell')!
    expect(sheets.filter((s) => s.step === 'shell').some((s) => s.svg.includes('NOT TO SCALE'))).toBe(true)
    expect(shell.warnings.join(' ')).toMatch(/not to scale/)
    expect(sheetsOf(structuredClone(defaultDesign())).sheets.every((x) => x.warnings.length === 0)).toBe(true)
  })

  it('title block: name, version, sheet n of N, scale, date, units', () => {
    const d = structuredClone(defaultDesign())
    d.name = 'Fridge & co <test>'
    const { sheets } = sheetsOf(d)
    sheets.forEach((s, i) => {
      expect(s.svg).toContain('Fridge &amp; co &lt;test&gt;')
      expect(s.svg).toContain('v3')
      expect(s.svg).toContain(`Sheet ${i + 1}/${sheets.length}`)
      expect(s.svg).toContain(`Scale 1:${Math.round(1 / s.scale)}`)
      expect(s.svg).toContain('2026-10-25')
      expect(s.svg).toContain('All dimensions mm')
    })
  })

  it('title block carries a 100 mm print scale check bar with 10 mm ticks', () => {
    for (const s of sheetsOf(twoCavities()).sheets) {
      const bar = s.svg.match(/<line class="o" data-scale-check="100" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"\/>/)
      expect(bar, s.title).not.toBeNull()
      const [x1, y1, x2, y2] = bar!.slice(1).map(Number)
      expect([x2 - x1, y2 - y1]).toEqual([100, 0])
      const ticks = [...s.svg.matchAll(/<line class="o" data-scale-tick="1" x1="([\d.]+)"/g)].map((m) => Number(m[1]) - x1)
      expect(ticks).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
      expect(s.svg).toContain('100 mm at 1:1 on paper: measure to check print scale')
      expect(s.svg).not.toContain('—')
    }
  })

  it('scale is the largest of 1:5, 1:10, 1:20 that fits', () => {
    for (const s of sheetsOf(twoCavities()).sheets) expect([1 / 5, 1 / 10, 1 / 20]).toContain(s.scale)
    // three views of the 1.4 m box fit on A3 at 1:10, not at 1:5
    expect(sheetsOf(structuredClone(defaultDesign())).sheets[0].scale).toBe(1 / 10)
  })

  it('shell sheet: panel dimensions from the cut list and the door opening', () => {
    const { parts, sheets } = sheetsOf(structuredClone(defaultDesign()))
    const shell = sheets.find((s) => s.step === 'shell')!
    for (const p of parts.filter((q) => q.step === 'shell')) {
      expect(shell.svg).toContain(`>${p.length}<`)
      expect(shell.svg).toContain(`>${p.width}<`)
    }
    expect(shell.svg).toMatch(/opening/)
  })

  it('mitre sheet labels the bevel angles', () => {
    const shell = sheetsOf(mitre()).sheets.find((s) => s.step === 'shell')!
    expect(shell.svg).toMatch(/45° bevel/)
  })

  it('facets sheet: widths, tilts, hinge edge and packing depth', () => {
    const fs = sheetsOf(full()).sheets.find((s) => s.step === 'facets')!
    expect(fs.svg).toContain('>200<')
    expect(fs.svg).toContain('4°')
    expect(fs.svg).toContain('7°')
    expect(fs.svg).toMatch(/hinge/)
    expect(fs.svg).toMatch(/packing 14/) // 200 tan 4°
  })

  it('doors sheet: hinge and latch positions, rebate, seal line, opening and frame', () => {
    const doors = sheetsOf(oneCavity()).sheets.find((s) => s.step === 'doors')!
    expect(doors.svg).toMatch(/hinge centres/)
    expect(doors.svg).toMatch(/latch centres/)
    expect(doors.svg).toMatch(/rebate in the wall \d+ deep from the inner face/)
    expect(doors.svg).toMatch(/seal line \d+(\.\d)? in from the leaf edge/)
    expect(doors.svg).toMatch(/clear opening/)
    expect(doors.svg).toMatch(/Frame strips \d+ wide/)
    expect(doors.svg).toContain('>150<') // butt hinge edge inset
  })

  it('builds all sheets for the default design in under 200 ms', () => {
    const d = structuredClone(defaultDesign())
    const { parts } = buildParts(d, lib, shop)
    const t = performance.now()
    buildSheets(d, lib, parts)
    expect(performance.now() - t).toBeLessThan(200)
  })
})
