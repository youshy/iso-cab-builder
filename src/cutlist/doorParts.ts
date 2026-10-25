import { doorLayout, doorLeafLayers, type LeafLayout } from '../doors/doors'
import { doorWall } from '../doors/side'
import { cavities, wallStack } from '../geometry/walls'
import { ASTRAGAL_WIDTH, DECOUPLING_STRIP_MATERIAL, materialOrFirst } from '../model/defaults'
import type { Design, Layer, Library } from '../model/schema'
import type { HardwareItem, Part } from './parts'

const GASKET_WIDTH = 50

const r05 = (n: number) => Math.round(n * 2) / 2
const r2 = (n: number) => Math.round(n * 100) / 100

type DoorPart = Omit<Part, 'id'>

/** Door leaf, frame and gasket parts plus hinges, latches and seal tape (all in the doors step). */
export function doorParts(d: Design, lib: Library): { parts: DoorPart[]; hardware: HardwareItem[] } {
  const parts: DoorPart[] = []
  const hw = new Map<string, HardwareItem>()
  const addHw = (name: string, qty: number, unit: 'pcs' | 'm', type?: HardwareItem['type']) => {
    if (qty <= 0) return
    const key = `${name}|${type ? `${type.kind}:${type.id}` : ''}`
    const cur = hw.get(key)
    if (cur) cur.qty = r2(cur.qty + qty)
    else hw.set(key, { name, qty: r2(qty), unit, ...(type ? { type } : {}) })
  }
  const hinge = (id: string): HardwareItem['type'] => ({ kind: 'hinge', id })
  const latch = (id: string): HardwareItem['type'] => ({ kind: 'latch', id })
  const matName = (id: string) => lib.materials.find((m) => m.id === id)?.name ?? id
  /** Adds a part; one with no length, width or thickness (a frame head of a too-narrow opening) is left out. */
  const add = (p: Omit<DoorPart, 'step' | 'warnings' | 'bevels' | 'qty' | 'notes'> & { qty?: number; notes?: string[] }) => {
    if (r05(Math.min(p.length, p.width)) <= 0 || p.thickness <= 0) return
    parts.push({
      ...p, length: r05(Math.max(p.length, p.width)), width: r05(Math.min(p.length, p.width)),
      bevels: [], qty: p.qty ?? 1, step: 'doors', notes: p.notes ?? [], warnings: [],
    })
  }

  const door = doorLayout(d, lib)
  const hingeName = (id: string) => lib.hinges.find((h) => h.id === id)?.name ?? id
  const latchName = (id: string) => lib.latches.find((l) => l.id === id)?.name ?? id
  const sealType = (id: string) => lib.seals.find((s) => s.id === id)

  if (door.kind === 'wall') {
    const w = door.wall!
    const cfg = d.door.outer
    addHw(hingeName(cfg.hingeTypeId), w.hinges.length, 'pcs', hinge(cfg.hingeTypeId))
    addHw(latchName(cfg.latchTypeId), w.latches.length, 'pcs', latch(cfg.latchTypeId))
    const seal = sealType(cfg.sealTypeId)?.name ?? cfg.sealTypeId
    for (const s of w.seals) addHw(`${seal} (${s.line})`, s.perimeterMm / 1000, 'm')
    return { parts, hardware: [...hw.values()] }
  }

  const layers = doorLeafLayers(d)
  const outermost: Layer | undefined = layers.outer[0] ?? layers.inner[0]
  for (const which of ['outer', 'inner'] as const) {
    const leaf: LeafLayout = door[which]!
    const cfg = d.door[which]
    const label = which === 'outer' ? 'Outer' : 'Inner'
    const split = leaf.leaves.length === 2
    const seal = sealType(cfg.sealTypeId)
    const t = leaf.leaves[0].t
    const { w, h } = leaf.leaves[0]

    layers[which].forEach((l, k) => {
      const notes: string[] = []
      if (split) notes.push('half of a split leaf')
      add({
        name: `${label} door leaf${split ? ' half' : ''}, layer ${k + 1} (${matName(l.materialId)})`,
        materialId: l.materialId, thickness: l.thickness, length: w, width: h, kind: 'leaf',
        qty: leaf.leaves.length, notes,
      })
    })
    if (split && outermost) {
      add({
        name: `${label} door astragal`, materialId: outermost.materialId, thickness: t, length: h,
        width: ASTRAGAL_WIDTH, kind: 'strip', notes: ['covers the gap between the split leaves'],
      })
    }
    if (leaf.frame && leaf.frame.depth > 0) {
      const fw = leaf.frame.width
      const frameMat = layers[which][0]?.materialId ?? outermost?.materialId
      if (frameMat) {
        const note = [`frame round the ${which} opening`]
        add({ name: `${label} door frame side`, materialId: frameMat, thickness: leaf.frame.depth, length: leaf.cutout.h, width: fw, qty: 2, kind: 'frame', notes: note })
        add({
          name: `${label} door frame head`, materialId: frameMat, thickness: leaf.frame.depth,
          length: leaf.cutout.w - 2 * fw, width: fw, qty: 2, kind: 'frame', notes: note,
        })
      }
    }

    const hingeCount = leaf.hinges.reduce((a, e) => a + e.positions.length, 0)
    addHw(hingeName(cfg.hingeTypeId), hingeCount, 'pcs', hinge(cfg.hingeTypeId))
    addHw(latchName(cfg.latchTypeId), leaf.latches.length, 'pcs', latch(cfg.latchTypeId))
    const perimeter = leaf.leaves.reduce((a, l) => a + 2 * (l.w + l.h), 0)
    addHw(seal?.name ?? cfg.sealTypeId, perimeter / 1000, 'm')
  }

  const gap = cavities(wallStack(d, doorWall(d)))[0]
  if (gap) {
    // The gasket rings the larger of the shell and liner holes.
    const w = Math.max(door.outer!.cutout.w, door.inner!.cutout.w)
    const h = Math.max(door.outer!.cutout.h, door.inner!.cutout.h)
    add({
      name: 'Door gap gasket', materialId: materialOrFirst(lib, DECOUPLING_STRIP_MATERIAL, ['roll']),
      thickness: gap.width, length: 2 * (w + h), width: GASKET_WIDTH, kind: 'strip',
      notes: ['soft gasket closing the cavity at the opening'],
    })
  }
  return { parts, hardware: [...hw.values()] }
}
