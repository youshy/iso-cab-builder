import { describe, expect, it } from 'vitest'
import { buildParts } from '../cutlist/parts'
import { defaultDesign, defaultLibrary, defaultShop } from '../model/defaults'
import type { Design, StackItem, WallInterior } from '../model/schema'
import { resolveDims } from './dimensions'
import { buildScene as scene } from './mesh'
import { boxBounds } from './boxes'
import { stackThickness, wallStack } from './walls'

const lib = defaultLibrary()
const buildScene = (d: Design) => scene(d, lib)
const base = (): Design => {
  const d = structuredClone(defaultDesign())
  d.door.side = 'front'
  return d
}
const twoFacets = (): WallInterior => ({
  splitAxis: 'z',
  facets: [
    { width: 180, tilt: 7, hinge: 'min' },
    { width: 180, tilt: 12, hinge: 'max' },
  ],
  panelMaterialId: 'plywood',
  panelThickness: 12,
  closure: 'fillers',
  behind: 'insulation',
})

const bounds = (d: Design) => {
  const { inner } = resolveDims(d)
  const t = stackThickness(wallStack(d, 'left'))
  return { lo: -t, hi: { x: inner.x + t, y: inner.y + t, z: inner.z + t } }
}

describe('buildScene', () => {
  it('default design: layers for every wall and one cab', () => {
    const s = buildScene(base())
    expect(s.solids.filter((x) => x.kind === 'layer').length).toBeGreaterThanOrEqual(10)
    expect(s.solids.filter((x) => x.kind === 'cab')).toHaveLength(1)
    expect(s.solids.every((x) => x.indices.length === 36 && x.vertices.length === 24)).toBe(true)
  })

  it('skips the cab when the simulation has none', () => {
    const d = base()
    d.sim.cabId = ''
    expect(buildScene(d).solids.some((x) => x.kind === 'cab')).toBe(false)
  })

  it('left wall with 2 facets gives 2 facet solids tagged left', () => {
    const d = base()
    d.interior.left = twoFacets()
    const f = buildScene(d).solids.filter((x) => x.kind === 'facet')
    expect(f).toHaveLength(2)
    expect(f.every((x) => x.wall === 'left')).toBe(true)
  })

  it('facet hinge is flush on the wall and free edge sits at packing depth', () => {
    const d = base()
    d.interior.left = twoFacets()
    const [first] = buildScene(d).solids.filter((x) => x.kind === 'facet')
    const xs = first.vertices.filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(180 * Math.tan((7 * Math.PI) / 180) + 12, 6)
  })

  it('facets on the door wall are ignored', () => {
    const d = base()
    d.interior.front = { ...twoFacets(), splitAxis: 'x' }
    expect(buildScene(d).solids.some((x) => x.kind === 'facet')).toBe(false)
  })

  it('each non-door wall gets one solid per layer, nested outward from the inner face', () => {
    const d = base()
    const layers = (w: string) => buildScene(d).solids.filter((x) => x.kind === 'layer' && x.wall === w)
    const xr = (v: number[]) => [Math.min(...v.filter((_, i) => i % 3 === 0)), Math.max(...v.filter((_, i) => i % 3 === 0))]
    for (const w of ['left', 'right', 'top', 'bottom', 'back']) expect(layers(w)).toHaveLength(2)
    const [ply, mdf] = layers('left')
    expect([ply.materialId, ply.part, mdf.materialId, mdf.part]).toEqual(['plywood', 'shell', 'mdf', 'shell'])
    expect(xr(ply.vertices)).toEqual([-36, -18])
    expect(xr(mdf.vertices)).toEqual([-18, 0])
    const { inner } = resolveDims(d)
    const [rPly] = layers('right')
    expect(xr(rPly.vertices)).toEqual([inner.x + 18, inner.x + 36])
  })

  it('air gap splits a wall into shell and liner layers with the gap empty', () => {
    const d = base()
    d.wallDefault = [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width: 30, decoupling: 'strips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const left = buildScene(d).solids.filter((x) => x.wall === 'left')
    const shell = left.find((x) => x.part === 'shell')!
    const liner = left.find((x) => x.part === 'liner')!
    const xr = (v: number[]) => [Math.min(...v.filter((_, i) => i % 3 === 0)), Math.max(...v.filter((_, i) => i % 3 === 0))]
    expect([shell.kind, shell.materialId, liner.kind, liner.materialId]).toEqual(['layer', 'plywood', 'layer', 'mdf'])
    expect(xr(shell.vertices)).toEqual([-66, -48])
    expect(xr(liner.vertices)).toEqual([-18, 0])
  })

  it('a panel that runs past the cavity is clipped, and an inside panel is left alone', () => {
    const d = base()
    const { inner } = resolveDims(d)
    d.panels.push({
      id: 'p', normal: 'x', position: 100, u0: 0, u1: inner.y + 500, v0: -40, v1: inner.z,
      layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }], insulation: null,
    })
    const p = buildScene(d).solids.find((x) => x.kind === 'panel')!
    const col = (i: number) => p.vertices.filter((_, k) => k % 3 === i)
    expect([Math.min(...col(1)), Math.max(...col(1))]).toEqual([0, inner.y])
    expect([Math.min(...col(2)), Math.max(...col(2))]).toEqual([0, inner.z])
  })

  it('inner panels become panel slabs of total layer plus insulation thickness', () => {
    const d = base()
    d.panels.push({
      id: 'p', normal: 'x', position: 100, u0: 0, u1: 200, v0: 10, v1: 300,
      layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }],
      insulation: { materialId: 'rockwool', thickness: 50 },
    })
    const p = buildScene(d).solids.find((x) => x.kind === 'panel')!
    const xs = p.vertices.filter((_, i) => i % 3 === 0)
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 168])
  })

  it('all vertices lie inside the outer box', () => {
    const d = base()
    d.interior.left = twoFacets()
    d.interior.bottom = { ...twoFacets(), splitAxis: 'x' }
    d.panels.push({
      id: 'p', normal: 'z', position: 400, u0: -50, u1: 1e5, v0: 0, v1: 1e5,
      layers: [{ kind: 'layer', materialId: 'plywood', thickness: 18 }], insulation: { materialId: 'rockwool', thickness: 1e5 },
    })
    d.treatments.push({ id: 't', surface: { panelId: 'p', side: 'pos' }, materialId: 'rockwool', thickness: 1e5 })
    const { lo, hi } = bounds(d)
    for (const s of buildScene(d).solids.filter((x) => x.kind !== 'door')) {
      for (let i = 0; i < s.vertices.length; i += 3) {
        expect(s.vertices[i]).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(s.vertices[i]).toBeLessThanOrEqual(hi.x + 1e-6)
        expect(s.vertices[i + 1]).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(s.vertices[i + 1]).toBeLessThanOrEqual(hi.y + 1e-6)
        expect(s.vertices[i + 2]).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(s.vertices[i + 2]).toBeLessThanOrEqual(hi.z + 1e-6)
      }
    }
  })

  describe('nested boxes', () => {
    const gap = (width: number): StackItem[] => [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'gap', width, decoupling: 'clips', fill: 'empty', fillMaterialId: 'rockwool' },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ]
    const r = (s: { vertices: number[] }, axis: 0 | 1 | 2): [number, number] => {
      const v = s.vertices.filter((_, i) => i % 3 === axis)
      return [Math.min(...v), Math.max(...v)]
    }
    const one = (d: Design, name: string) => buildScene(d).solids.find((x) => x.name === name)!

    it('with a gap the liner is its own box inside the shell box', () => {
      const d = base()
      d.wallDefault = gap(100)
      const { inner } = resolveDims(d)
      expect(r(one(d, 'left-liner-1'), 1)).toEqual([-18, inner.y + 18])
      expect(r(one(d, 'left-shell-1'), 1)).toEqual([-136, inner.y + 136])
      expect(r(one(d, 'top-liner-1'), 0)).toEqual([0, inner.x])
      expect(r(one(d, 'top-shell-1'), 0)).toEqual([-118, inner.x + 118])
    })

    it('the joint changes the corners: tops-past runs the top over the sides', () => {
      const d = base()
      d.joint = 'tops-past'
      const { inner } = resolveDims(d)
      expect(r(one(d, 'left-shell-1'), 1)).toEqual([0, inner.y])
      expect(r(one(d, 'top-shell-1'), 0)).toEqual([-36, inner.x + 36])
    })

    it('mitre: layers taper to 45 degrees on joined edges', () => {
      const d = base()
      d.joint = 'mitre'
      const { inner } = resolveDims(d)
      const ply = one(d, 'left-shell-1')
      const ys = (x: number) => ply.vertices.filter((_, i) => i % 3 === 1 && Math.abs(ply.vertices[i - 1] - x) < 1e-6)
      expect([Math.min(...ys(-36)), Math.max(...ys(-36))]).toEqual([-36, inner.y + 36])
      expect([Math.min(...ys(-18)), Math.max(...ys(-18))]).toEqual([-18, inner.y + 18])
    })

    // The anti-goal: the cut list must match what is drawn.
    it('every wall layer solid off the door wall is a cut list part, with matching counts', () => {
      const r05 = (n: number) => Math.round(n * 2) / 2
      const designs: Design[] = []
      for (const joint of ['sides-past', 'tops-past', 'rebate', 'mitre'] as const) {
        for (const variant of ['plain', 'gap', 'override'] as const) {
          const d = base()
          d.joint = joint
          if (variant === 'gap') d.wallDefault = gap(25)
          // A thicker left wall: unequal mitres and laps against thinner neighbours.
          if (variant === 'override') d.wallOverrides.left = [...d.wallDefault, { kind: 'layer', materialId: 'osb', thickness: 12 }]
          designs.push(d)
        }
      }
      for (const d of designs) {
        const drawn = new Map<string, number>()
        for (const s of buildScene(d).solids.filter((x) => x.kind === 'layer' && x.wall !== 'front')) {
          const [l, w, t] = [r(s, 0), r(s, 1), r(s, 2)].map(([a, b]) => r05(b - a)).sort((a, b) => b - a)
          const k = `${s.materialId} ${t} ${l} ${w}`
          drawn.set(k, (drawn.get(k) ?? 0) + 1)
        }
        const listed = new Map<string, number>()
        for (const p of buildParts(d, lib, defaultShop()).parts) {
          if (!['shell', 'middle', 'liner'].includes(p.step) || p.kind === 'strip' || /^Front /.test(p.name)) continue
          const k = `${p.materialId} ${p.thickness} ${p.length} ${p.width}`
          listed.set(k, (listed.get(k) ?? 0) + p.qty)
        }
        expect(drawn).toEqual(listed)
      }
    })

    describe('boxes are closed and no two wall layers overlap', () => {
      type P3 = [number, number, number]
      const pts = (s: { vertices: number[] }): P3[] =>
        Array.from({ length: s.vertices.length / 3 }, (_, i) => [s.vertices[3 * i], s.vertices[3 * i + 1], s.vertices[3 * i + 2]] as P3)
      const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      /** Volume of a closed solid: sum of signed tetrahedra against the origin. */
      const volume = (s: { vertices: number[]; indices: number[] }) => {
        const v = pts(s)
        let sum = 0
        for (let i = 0; i < s.indices.length; i += 3) {
          const [a, b, c] = [v[s.indices[i]], v[s.indices[i + 1]], v[s.indices[i + 2]]]
          sum += dot(a, cross(b, c)) / 6
        }
        return Math.abs(sum)
      }
      /** Strict inside test for a convex solid: on the inner side of every face triangle. */
      const inside = (s: { vertices: number[]; indices: number[] }) => {
        const v = pts(s)
        const c = v.reduce((a, p) => [a[0] + p[0] / v.length, a[1] + p[1] / v.length, a[2] + p[2] / v.length] as P3, [0, 0, 0] as P3)
        const planes: [P3, P3][] = []
        for (let i = 0; i < s.indices.length; i += 3) {
          const [a, b, cc] = [v[s.indices[i]], v[s.indices[i + 1]], v[s.indices[i + 2]]]
          let n = cross(sub(b, a), sub(cc, a))
          if (Math.hypot(...n) < 1e-9) continue
          if (dot(n, sub(c, a)) > 0) n = [-n[0], -n[1], -n[2]]
          planes.push([n, a])
        }
        return (p: P3) => planes.every(([n, a]) => dot(n, sub(p, a)) < -1e-6 * Math.hypot(...n))
      }
      const aabb = (s: { vertices: number[] }) => [0, 1, 2].map((i) => r(s, i as 0 | 1 | 2))
      const isBox = (s: { vertices: number[] }) => [0, 1, 2].every((i) => new Set(s.vertices.filter((_, k) => k % 3 === i)).size <= 2)
      /** Intersection volume: exact for two axis-aligned boxes, sampled on a 1.5 mm grid otherwise. */
      const overlap = (s: Solid, t: Solid) => {
        const [A, B] = [aabb(s), aabb(t)]
        const I = A.map(([a0, a1], i) => [Math.max(a0, B[i][0]), Math.min(a1, B[i][1])])
        if (I.some(([a, b]) => b - a <= 1e-6)) return 0
        if (isBox(s) && isBox(t)) return I.reduce((v, [a, b]) => v * (b - a), 1)
        const [inS, inT] = [inside(s), inside(t)]
        const h = 1.5
        let n = 0
        for (let x = I[0][0] + 0.3137; x < I[0][1]; x += h)
          for (let y = I[1][0] + 0.2719; y < I[1][1]; y += h)
            for (let z = I[2][0] + 0.4441; z < I[2][1]; z += h) if (inS([x, y, z]) && inT([x, y, z])) n++
        return n * h ** 3
      }
      type Solid = ReturnType<typeof buildScene>['solids'][number]
      const stacks: [string, StackItem[]][] = [
        ['two layers', defaultDesign().wallDefault],
        ['gap', gap(25)],
        ['three layers', [
          { kind: 'layer', materialId: 'plywood', thickness: 18 },
          { kind: 'layer', materialId: 'mdf', thickness: 18 },
          { kind: 'layer', materialId: 'osb', thickness: 12 },
        ]],
      ]
      for (const joint of ['sides-past', 'tops-past', 'rebate', 'mitre'] as const) {
        for (const [label, stack] of stacks) {
          it(`${joint}, ${label}`, () => {
            const d = base()
            d.joint = joint
            d.wallDefault = stack
            d.door.kind = 'wall' // no cutouts, so every box should be a closed shell
            const layers = buildScene(d).solids.filter((x) => x.kind === 'layer')
            for (let i = 0; i < layers.length; i++) {
              for (let j = i + 1; j < layers.length; j++) {
                expect(overlap(layers[i], layers[j]), `${layers[i].name} x ${layers[j].name}`).toBeLessThan(1)
              }
            }
            const bs = boxBounds(d)
            bs.forEach((b, k) => {
              const part = k === 0 ? 'shell' : k === bs.length - 1 ? 'liner' : 'middle'
              const vol = (r3: Record<'x' | 'y' | 'z', [number, number]>) => (['x', 'y', 'z'] as const).reduce((v, a) => v * (r3[a][1] - r3[a][0]), 1)
              const drawn = layers.filter((x) => x.part === part).reduce((v, x) => v + volume(x), 0)
              expect(drawn).toBeCloseTo(vol(b.outer) - vol(b.cavity), 0)
            })
          })
        }
      }
    })

    it('a facet is as long as its cut list part: shortened by earlier walls', () => {
      const d = base()
      d.interior.left = twoFacets()
      d.interior.top = { ...twoFacets(), splitAxis: 'z' }
      const facet = buildScene(d).solids.find((x) => x.kind === 'facet' && x.wall === 'top')!
      const [x0, x1] = r(facet, 0)
      const part = buildParts(d, lib, defaultShop()).parts.find((p) => p.name === 'Top facet 1')!
      expect(Math.round((x1 - x0) * 2) / 2).toBe(part.length)
      expect(x1 - x0).toBeLessThan(resolveDims(d).inner.x - 1)
    })
  })

  describe('doors', () => {
    const range = (s: { vertices: number[] }, axis: 0 | 1 | 2): [number, number] => {
      const v = s.vertices.filter((_, i) => i % 3 === axis)
      return [Math.min(...v), Math.max(...v)]
    }
    const doorSolids = (d: Design) => buildScene(d).solids.filter((x) => x.kind === 'door')

    it('whole-wall mode: door wall layers are uncut, flagged door, and no leaf solids', () => {
      const d = base()
      d.door.kind = 'wall'
      const solids = buildScene(d).solids.filter((x) => x.wall === 'front' && x.kind !== 'treatment')
      expect(solids.map((x) => x.name)).toEqual(['front-shell-1', 'front-shell-2'])
      expect(solids.every((x) => x.kind === 'layer' && x.door === true)).toBe(true)
      expect(buildScene(d).solids.filter((x) => x.name.startsWith('door-'))).toHaveLength(0)
      d.wallDefault = [
        { kind: 'layer', materialId: 'plywood', thickness: 18 },
        { kind: 'gap', width: 50, decoupling: 'clips', fill: 'insulation', fillMaterialId: 'rockwool' },
        { kind: 'layer', materialId: 'mdf', thickness: 18 },
      ]
      const g = buildScene(d).solids.filter((x) => x.wall === 'front')
      expect(g.map((x) => x.name).sort()).toEqual(['front-liner-1', 'front-shell-1'])
      expect(g.every((x) => x.kind === 'layer' && x.door === true)).toBe(true)
    })

    it('door wall is cut into boxes around the cutout, other walls stay whole', () => {
      const d = base()
      const solids = buildScene(d).solids
      expect(solids.filter((x) => x.wall === 'front' && x.kind === 'layer')).toHaveLength(8)
      expect(solids.filter((x) => x.wall === 'front' && x.kind === 'layer' && x.materialId === 'plywood')).toHaveLength(4)
      expect(solids.filter((x) => x.wall === 'back' && x.kind === 'layer')).toHaveLength(2)
      expect(solids.some((x) => x.wall === 'front' && x.door)).toBe(false)
    })

    it('cutout area is empty: no wall box covers the wall centre', () => {
      const d = base()
      const { inner } = resolveDims(d)
      const cx = inner.x / 2, cy = inner.y / 2
      for (const s of buildScene(d).solids.filter((x) => x.wall === 'front' && x.kind === 'layer')) {
        const [x0, x1] = range(s, 0), [y0, y1] = range(s, 1)
        expect(x0 < cx && cx < x1 && y0 < cy && cy < y1).toBe(false)
      }
    })

    it('outer leaf sits outside the wall, inner leaf at the inner face, both leaf thickness', () => {
      const d = base() // front door, 18 mm ply outer, 18 mm MDF inner
      const { inner } = resolveDims(d)
      const t = stackThickness(wallStack(d, 'front'))
      const [outer, innerLeaf] = [
        doorSolids(d).find((x) => x.name === 'door-outer')!,
        doorSolids(d).find((x) => x.name === 'door-inner')!,
      ]
      expect(range(outer, 2)).toEqual([inner.z + t, inner.z + t + 18])
      expect(range(innerLeaf, 2)).toEqual([inner.z, inner.z + 18])
    })

    it('left wall door: leaf thickness runs along x on the low side', () => {
      const d = defaultDesign()
      d.door.side = 'left'
      const { inner } = resolveDims(d)
      const outer = doorSolids(d).find((x) => x.name === 'door-outer')!
      expect(range(outer, 0)).toEqual([-36 - 18, -36])
      expect(range(outer, 2)).toEqual([inner.z / 2 - 220, inner.z / 2 + 220])
    })

    it('split leaf gives two solids, all tagged with the door wall', () => {
      const d = base()
      d.door.outer.opening = 'split'
      const outers = doorSolids(d).filter((x) => x.name.startsWith('door-outer-') && !x.name.includes('frame'))
      expect(outers).toHaveLength(2)
      expect(doorSolids(d).every((x) => x.wall === 'front')).toBe(true)
    })

    it('framed door adds frame strips', () => {
      const d = base()
      d.door.outer.framed = true
      expect(doorSolids(d).filter((x) => x.name.startsWith('door-outer-frame'))).toHaveLength(4)
    })
  })
})
