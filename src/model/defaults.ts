import type { Cab, Design, DoorLeaf, Library, Material, Shop, SheetStock } from './schema'

export function newId(): string {
  return crypto.randomUUID()
}

export function newCab(p: Partial<Cab> = {}): Cab {
  return {
    id: newId(),
    name: '6x12',
    w: 1350,
    h: 980,
    d: 360,
    speakers: [
      { x: 225, y: 245 },
      { x: 675, y: 245 },
      { x: 1125, y: 245 },
      { x: 225, y: 735 },
      { x: 675, y: 735 },
      { x: 1125, y: 735 },
    ],
    back: 'closed',
    ...p,
  }
}

function mat(
  id: string,
  name: string,
  kind: Material['kind'],
  density: number,
  thicknesses: number[],
  youngsModulus: number,
  lossFactor: number,
  absorption: Material['absorption'],
): Material {
  return { id, name, kind, density, thicknesses, youngsModulus, lossFactor, absorption }
}

export function defaultLibrary(): Library {
  return {
    materials: [
      mat('plywood', 'Plywood', 'sheet', 600, [9, 12, 15, 18, 24], 8e9, 0.02, [0.28, 0.22, 0.17, 0.09, 0.1, 0.11]),
      mat('mdf', 'MDF', 'sheet', 750, [12, 18, 25], 3.5e9, 0.03, [0.1, 0.1, 0.1, 0.08, 0.08, 0.08]),
      mat('osb', 'OSB', 'sheet', 620, [12, 18], 5e9, 0.03, [0.15, 0.13, 0.1, 0.09, 0.09, 0.09]),
      mat('mlv', 'Mass loaded vinyl', 'roll', 2000, [2.5, 5], 1e7, 0.3, [0.05, 0.05, 0.05, 0.05, 0.05, 0.05]),
      mat('rockwool', 'Rockwool', 'fill', 45, [25, 50, 100], 1e5, 0.1, [0.2, 0.6, 0.95, 1.0, 1.0, 1.0]),
      mat('foam', 'Acoustic foam', 'fill', 30, [30, 50], 1e5, 0.1, [0.1, 0.25, 0.55, 0.8, 0.9, 0.9]),
      mat('carpet', 'Carpet', 'roll', 300, [8], 1e6, 0.2, [0.05, 0.1, 0.2, 0.35, 0.5, 0.6]),
      mat('rubber', 'Rubber', 'roll', 1200, [3, 6], 2e6, 0.2, [0.04, 0.04, 0.04, 0.04, 0.04, 0.04]),
    ],
    hinges: [
      { id: 'butt-75', name: 'Butt hinge 75 mm', kind: 'butt', leafWidth: 75, edgeInset: 150 },
      { id: 'piano', name: 'Piano hinge', kind: 'piano', leafWidth: 30, edgeInset: 0 },
      { id: 'lift-off', name: 'Lift-off hinge', kind: 'lift-off', leafWidth: 50, edgeInset: 150 },
    ],
    seals: [
      { id: 'tape-12x6', name: 'Compression tape 12x6', thickness: 6, width: 12, rebated: true },
      { id: 'tape-20x10', name: 'Compression tape 20x10', thickness: 10, width: 20, rebated: false },
    ],
    latches: [
      { id: 'toggle', name: 'Toggle clamp', kind: 'toggle', edgeInset: 100 },
      { id: 'compression', name: 'Compression latch', kind: 'compression', edgeInset: 100 },
    ],
  }
}

export function defaultShop(): Shop {
  const sheets: SheetStock[] = []
  for (const m of defaultLibrary().materials) {
    if (m.kind === 'sheet') {
      for (const t of m.thicknesses) sheets.push({ materialId: m.id, thickness: t, length: 2440, width: 1220 })
    } else if (m.id === 'mlv' || m.id === 'carpet' || m.id === 'rubber') {
      for (const t of m.thicknesses) sheets.push({ materialId: m.id, thickness: t, length: 0, width: 1220 })
    }
  }
  return { sheets, kerf: 3, maxBevel: 45, minPart: 30, rollOverlap: 50 }
}

function leaf(): DoorLeaf {
  return {
    opening: 'out',
    framed: false,
    frameWidth: 45,
    hingeEdge: 'left',
    hingeTypeId: 'butt-75',
    sealTypeId: 'tape-12x6',
    latchTypeId: 'compression',
    latchCount: 2,
    stack: null,
  }
}

export function defaultDesign(): Design {
  const cab = newCab()
  const clearance = 20
  const inner = { x: cab.w + 2 * clearance, y: cab.h + 2 * clearance, z: cab.d + 2 * clearance }
  const wall = 36 // 18 plywood + 18 MDF; recomputed later
  return {
    schemaVersion: 1,
    id: newId(),
    name: 'New design',
    cabs: [cab],
    cabYaw: 0,
    dims: {
      mode: 'inside',
      innerSource: 'cab',
      inner,
      outer: { x: inner.x + 2 * wall, y: inner.y + 2 * wall, z: inner.z + 2 * wall },
      clearance,
      sizingCabId: cab.id,
    },
    wallDefault: [
      { kind: 'layer', materialId: 'plywood', thickness: 18 },
      { kind: 'layer', materialId: 'mdf', thickness: 18 },
    ],
    wallOverrides: {},
    joint: 'sides-past',
    interior: {},
    panels: [],
    treatments: [],
    door: {
      kind: 'dual',
      roomClearance: 600,
      side: 'auto',
      opening: null,
      margin: 15,
      overlap: 25,
      outer: leaf(),
      inner: leaf(),
      between: 'insulation',
    },
    escape: { insideLevel: [115, 115, 115, 115, 115, 115], outsideTarget: 60, distance: 1 },
    sim: { fMax: 1000, cabId: cab.id, probes: [] },
  }
}

/** Starting choices for new interior parts; the material falls back to the library when missing. */
export const DEFAULT_FACET_PANEL = { materialId: 'plywood', thickness: 12 }
export const DEFAULT_PANEL_LAYER = { materialId: 'plywood', thickness: 18 }
export const DEFAULT_INSULATION = { materialId: 'rockwool', thickness: 50 }

/** The preferred material id when the library has it, else the first library material of a fitting kind. */
export function materialOrFirst(lib: Library, preferredId: string, kinds: Material['kind'][]): string {
  if (lib.materials.some((m) => m.id === preferredId)) return preferredId
  return lib.materials.find((m) => kinds.includes(m.kind))?.id ?? preferredId
}

/** Cut list choices: decoupling strip material, packer strip width, clip grid pitch (all mm). */
export const DECOUPLING_STRIP_MATERIAL = 'rubber'
export const PACKER_WIDTH = 40
export const CLIP_GRID = 400

/** Flow resistivity (Pa s/m2) of porous treatments for the Delany-Bazley absorber term; others use the default. */
export const FLOW_RESISTIVITY: Record<string, number> = { rockwool: 20000, foam: 10000 }
export const DEFAULT_FLOW_RESISTIVITY = 15000
/** Most a single absorber layer may add to a stack's TL, dB. */
export const ABSORBER_TL_CAP = 15
