import type { BuildStep, Part } from '../cutlist/parts'
import { doorLayout, type DoorLayout } from '../doors/doors'
import { boxBounds, boxPart, mitreAngle, wallBoxes, type BoxPanel, type BoxBounds } from '../geometry/boxes'
import { resolveDims } from '../geometry/dimensions'
import { wallStack, WALLS } from '../geometry/walls'
import type { Axis, Design, Library, StackItem, WallId } from '../model/schema'
import { cellsBlock, type Cell } from './cells'
import { doorBlocks } from './doorSheet'
import { facetBlocks } from './facetSheet'
import { partsTable } from './partsTable'
import { AREA, fitsOne, fmt, pack, Pen, sheetSvg, type Block, type BlockFn } from './svg'
import { cap, PartTags, r05 } from './tags'

/** `warnings`: drawings on the sheet that had to be shrunk below the sheet scale to fit (marked NOT TO SCALE). */
export type Sheet = { step: BuildStep | 'overview'; title: string; scale: number; svg: string; warnings: string[] }
export type SheetOptions = { version?: number | string; date?: string }

/** Printed scales, largest first: a sheet uses the largest one its drawings fit at. */
const SCALES = [5, 10, 20]
const AXIS_NAME: Record<Axis, string> = { x: 'width', y: 'height', z: 'depth' }

type Spec = { step: Sheet['step']; title: string; blocks: BlockFn[]; notes: string[] }

/**
 * Printable A3 sheets for the workshop, in build order: overview, shell, middle boxes, liner, facets, panels,
 * treatment, doors. Every part of `parts` gets an id balloon on a sheet of its own build step. Drawings are
 * true scale; dimensions are always mm.
 */
export function buildSheets(d: Design, lib: Library, parts: Part[], opts: SheetOptions = {}): Sheet[] {
  const tags = new PartTags(parts)
  const matName = (id: string) => lib.materials.find((m) => m.id === id)?.name ?? id
  const bounds = boxBounds(d)
  const boxes = bounds.length
  const panels = wallBoxes(d, lib)
  const door = doorLayout(d, lib)
  const specs: Spec[] = [overview(d, bounds, door, matName)]

  /** Loose parts of a step not drawn in place: each as its own dimensioned face. */
  const loose = (ps: Part[]): BlockFn[] =>
    ps.filter((p) => !tags.drawn(p.id)).map((p) => cellsBlock(p.name, [looseCell(p, tags, matName)]))
  const middleBox = (p: Part) => Number(/middle box (\d+)\b/.exec(`${p.name} ${p.notes.join(' ')}`)?.[1] ?? 1)

  for (let k = 0; k < boxes; k++) {
    const step = boxPart(k, boxes)
    const title = step === 'middle' ? `Middle box ${k}` : step === 'shell' ? 'Shell' : 'Liner'
    const blocks = WALLS.flatMap((w) => {
      const ps = panels.filter((p) => p.boxIndex === k && p.wall === w).sort((a, b) => a.layerIndex - b.layerIndex)
      if (ps.length === 0) return []
      const doorNote = door.kind === 'wall' && ps[0].door ? ' (hinged door wall)' : ''
      return [cellsBlock(`${cap(w)} wall${doorNote}`, ps.map((p) => wallCell(p, boxes, tags, matName)))]
    })
    const own = parts.filter((p) => p.step === step && (step !== 'middle' || middleBox(p) === k))
    blocks.push(...loose(own))
    if (own.length === 0) continue
    specs.push({
      step, title, blocks,
      notes: [
        `${title} box, joint ${d.joint}. Each wall seen from outside, layers outside-in from left to right.`,
        ...(d.joint === 'mitre' ? ['Mitred panels: solid outline is the outer face (long point), dashed the inner face.'] : []),
      ],
    })
  }

  const facetParts = parts.filter((p) => p.step === 'facets')
  const facets = facetBlocks(d, tags)
  facets.push(...loose(facetParts), ...partsTable(facetParts, matName))
  specs.push({ step: 'facets', title: 'Facets', blocks: facets, notes: [
    'Sections across each faceted wall, true scale. Hinge edge sits on the wall face;',
    'the free edge stands off by the packing depth. Facets run the stated length along the wall.',
  ] })

  specs.push({ step: 'panels', title: 'Inner panels', blocks: loose(parts.filter((p) => p.step === 'panels')), notes: [
    'Inner panels, layer by layer. Positions are set in the Interior step.',
  ] })
  specs.push({ step: 'treatment', title: 'Treatment', blocks: loose(parts.filter((p) => p.step === 'treatment')), notes: [
    'Treatment pieces, inner face outwards in list order.',
  ] })

  const doorSpec: Spec = { step: 'doors', title: 'Doors', blocks: doorBlocks(d, lib, door, tags), notes: [] }
  const doorParts = parts.filter((p) => p.step === 'doors')
  doorSpec.blocks.push(...loose(doorParts), ...partsTable(doorParts, matName))
  doorSpec.notes = door.kind === 'wall'
    ? ['The whole door wall swings. Its layers are cut on the box sheets.', 'Hinge and latch centres measured from the stated edge.']
    : ['Leaves seen from outside. Hinge and latch centres measured from the stated edge.', 'Seal line runs round the overlap; the inner leaf sits in its rebate.']
  specs.push(doorSpec)

  const stepHasParts = (s: Spec) => s.step === 'overview' || parts.some((p) => p.step === s.step) || (s.step === 'doors' && door.kind === 'wall')
  return render(specs.filter((s) => stepHasParts(s) && s.blocks.length > 0), d, opts)
}

const NTS_LABEL = 5

/**
 * A block too big for the sheet even at the smallest scale, redrawn smaller until it fits, under a
 * NOT TO SCALE label. Annotations keep their paper size, so the shrink is found by a few passes.
 */
function shrinkToFit(fn: BlockFn, s: number): { block: Block; n: number } {
  let b = fn(s)
  for (let i = 0; i < 8; i++) {
    const k = Math.min(AREA.w / b.w, (AREA.h - NTS_LABEL) / b.h)
    if (k >= 1) break
    s *= k * 0.97
    b = fn(s)
  }
  const n = Math.round(1 / s)
  const label = `<text class="hd" x="0" y="3.6" font-size="3.2">NOT TO SCALE (about 1:${n})</text>`
  return { block: { w: b.w, h: b.h + NTS_LABEL, svg: `${label}<g transform="translate(0 ${NTS_LABEL})">${b.svg}</g>` }, n }
}

function render(specs: Spec[], d: Design, opts: SheetOptions): Sheet[] {
  const pages: { spec: Spec; title: string; scaleN: number; placed: ReturnType<typeof pack>[number]; warnings: string[] }[] = []
  for (const spec of specs) {
    const scaleN = SCALES.find((n) => fitsOne(spec.blocks.map((b) => b(1 / n)))) ?? SCALES[SCALES.length - 1]
    const warnings: string[] = []
    const blocks = spec.blocks.map((fn) => {
      const b = fn(1 / scaleN)
      if (b.w <= AREA.w && b.h <= AREA.h) return b
      const { block, n } = shrinkToFit(fn, 1 / scaleN)
      warnings.push(`${spec.title}: a drawing is too big for A3 at 1:${scaleN}, shown not to scale (about 1:${n}).`)
      return block
    })
    const laid = pack(blocks)
    laid.forEach((placed, i) => {
      const title = laid.length > 1 ? `${spec.title} (${i + 1}/${laid.length})` : spec.title
      pages.push({ spec, title, scaleN, placed, warnings: i === 0 ? warnings : [] })
    })
  }
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  return pages.map((p, i) => ({
    step: p.spec.step,
    title: p.title,
    scale: 1 / p.scaleN,
    warnings: p.warnings,
    svg: sheetSvg({
      title: p.title, name: d.name, version: opts.version, sheet: i + 1, sheets: pages.length,
      scaleN: p.scaleN, date, notes: p.spec.notes,
    }, p.placed),
  }))
}

// ---- wall layers ----

/** The cut-list part a wall slab belongs to: same box step, layer, walls, thickness and rounded size. */
function panelPart(tags: PartTags, p: BoxPanel, boxes: number, matName: (id: string) => string): Part | undefined {
  const step = boxPart(p.boxIndex, boxes)
  const label = step === 'middle' ? `middle box ${p.boxIndex}` : step
  const rest = `${label}, layer ${p.layerIndex + 1} (${matName(p.materialId)})`
  const a = p.max[p.lengthAxis] - p.min[p.lengthAxis], b = p.max[p.widthAxis] - p.min[p.widthAxis]
  const [len, wid] = [r05(Math.max(a, b)), r05(Math.min(a, b))]
  return tags.parts.find((q) =>
    q.step === step && q.name.endsWith(` ${rest}`) &&
    q.name.slice(0, q.name.length - rest.length - 1).split('/').includes(cap(p.wall)) &&
    q.thickness === p.thickness && q.length === len && q.width === wid)
}

function wallCell(p: BoxPanel, boxes: number, tags: PartTags, matName: (id: string) => string): Cell {
  const L = p.lengthAxis, W = p.widthAxis
  const len = p.max[L] - p.min[L], wid = p.max[W] - p.min[W]
  const t = p.taper
  const mitred = p.joinedEdges.filter((e) => e.kind === 'mitre')
  return {
    len, wid,
    tag: tags.tag(panelPart(tags, p, boxes, matName)),
    caption: [
      `Layer ${p.layerIndex + 1}: ${fmt(p.thickness)} ${matName(p.materialId)}, ${AXIS_NAME[L]} × ${AXIS_NAME[W]}`,
      ...(p.rebate ? [`rout rebate ${fmt(p.rebate.depth)} deep × ${fmt(p.rebate.width)} wide round the opening, inner face`] : []),
    ],
    inner: mitred.length > 0 ? { u0: t.W1[1], u1: len - t.W2[1], v0: t.L1[1], v1: wid - t.L2[1] } : undefined,
    bevels: mitred.map((e) => ({ edge: e.edge, text: `${fmt(mitreAngle(p, e.edge))}° bevel` })),
    cutout: p.cutout
      ? { u0: p.cutout.u0 - p.min[L], u1: p.cutout.u1 - p.min[L], v0: p.cutout.v0 - p.min[W], v1: p.cutout.v1 - p.min[W] }
      : undefined,
  }
}

function looseCell(p: Part, tags: PartTags, matName: (id: string) => string): Cell {
  const bevels = p.bevels.length > 0
    ? [`bevel ${p.bevels.map((b) => `${b.edge} ${fmt(b.angle)}°`).join(', ')}`]
    : []
  return {
    len: p.length, wid: p.width,
    tag: tags.tag(p),
    caption: [`${fmt(p.thickness)} ${matName(p.materialId)}`, ...bevels, ...p.notes],
  }
}

// ---- overview ----

const stackText = (items: StackItem[], matName: (id: string) => string) =>
  items.map((i) => (i.kind === 'layer' ? `${fmt(i.thickness)} ${matName(i.materialId)}` : `${fmt(i.width)} gap`)).join(' + ')

function overview(d: Design, bounds: BoxBounds[], door: DoorLayout, matName: (id: string) => string): Spec {
  const { outer, inner } = resolveDims(d)
  const o = bounds[0].outer, c = bounds[bounds.length - 1].cavity
  // The door opening as seen on the view of its wall: the outer cutout (dual) or the whole wall (wall door).
  const opening = door.outer ? door.outer.cutout : null
  const view = (title: string, h: Axis, v: Axis, flipV: boolean, labels: [string, string], wall?: WallId, flipH = false): BlockFn => (s) => {
    const pen = new Pen()
    pen.text(0, -4, title, { size: 3.2, cls: 'hd' })
    const H = (outer[v]) * s
    // flipH: seen from the high end of the axis normal to the view, so `h` runs right to left.
    const X = (m: number) => (flipH ? o[h][1] - m : m - o[h][0]) * s
    const Y = (m: number) => (flipV ? (m - o[v][0]) * s : H - (m - o[v][0]) * s)
    const hs = flipH ? -1 : 1
    pen.rect(X(o[h][0]), Y(o[v][0]), hs * outer[h] * s, (flipV ? 1 : -1) * outer[v] * s, 'o')
    pen.rect(X(c[h][0]), Y(c[v][0]), hs * inner[h] * s, (flipV ? 1 : -1) * inner[v] * s, 'h')
    const W = outer[h] * s
    if (wall && wall === door.side && opening) {
      const [ch, cv] = [inner[h] / 2, inner.y / 2]
      pen.rect(X(ch - opening.w / 2), Y(cv + opening.h / 2), hs * opening.w * s, opening.h * s, 'c')
      pen.text(X(ch), Y(cv), 'door', { size: 2.2, anchor: 'middle' })
    } else if (wall && wall === door.side) {
      pen.text(W / 2, H / 2, 'door wall', { size: 2.2, anchor: 'middle' })
    }
    pen.dimH(0, W, H, H + 10, fmt(outer[h]))
    pen.dimH(X(c[h][0]), X(c[h][1]), H, H + 5, fmt(inner[h]))
    pen.dimV(H, 0, 0, -10, fmt(outer[v]))
    const [cy0, cy1] = [Y(c[v][0]), Y(c[v][1])]
    pen.dimV(Math.max(cy0, cy1), Math.min(cy0, cy1), 0, -5, fmt(inner[v]))
    pen.text(W / 2, H + 15, `outer ${AXIS_NAME[h]} ${fmt(outer[h])}, inside ${fmt(inner[h])}`, { size: 2.2, anchor: 'middle' })
    pen.text(2, 3, labels[0], { size: 2 })
    pen.text(W - 2, 3, labels[1], { size: 2, anchor: 'end' })
    return pen.block()
  }
  const wallLines = [`Walls: ${stackText(d.wallDefault, matName)}`]
  for (const w of WALLS) {
    const ov = d.wallOverrides[w as WallId]
    if (ov) wallLines.push(`${cap(w)} wall: ${stackText(wallStack(d, w), matName)}`)
  }
  return {
    step: 'overview', title: 'Overview',
    blocks: [
      view('Front', 'x', 'y', false, ['left', 'right'], 'front'),
      view('Left side', 'z', 'y', false, ['back', 'front'], 'left'),
      ...(door.side === 'right' ? [view('Right side', 'z', 'y', false, ['front', 'back'], 'right', true)] : []),
      view('Plan from above', 'x', 'z', true, ['back left', 'back right']),
    ],
    notes: [
      `Outer ${fmt(outer.x)} W × ${fmt(outer.y)} H × ${fmt(outer.z)} D, inside ${fmt(inner.x)} × ${fmt(inner.y)} × ${fmt(inner.z)}.`,
      ...wallLines.slice(0, 4),
      `Joint ${d.joint}. Dashed: inner cavity. Door: ${door.kind === 'wall' ? 'the whole' : 'dual leaves in the'} ${door.side} wall${opening ? ` (dash-dot: cutout ${fmt(opening.w)} × ${fmt(opening.h)})` : ''}.`,
    ],
  }
}
