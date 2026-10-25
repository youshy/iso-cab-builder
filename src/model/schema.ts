import { z } from 'zod'

export const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() })
export type Vec3 = z.infer<typeof Vec3Schema>

export const AxisSchema = z.enum(['x', 'y', 'z'])
export type Axis = z.infer<typeof AxisSchema>

export const WallIdSchema = z.enum(['left', 'right', 'top', 'bottom', 'back', 'front'])
export type WallId = z.infer<typeof WallIdSchema>

export const DoorSideSchema = z.enum(['front', 'left', 'right'])
export type DoorSide = z.infer<typeof DoorSideSchema>

const Abs = z.number().min(0).max(1)

export const MaterialSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['sheet', 'roll', 'fill']),
  density: z.number().positive(), // kg/m3
  thicknesses: z.array(z.number().positive()).min(1),
  youngsModulus: z.number().positive(), // Pa
  lossFactor: z.number().min(0),
  absorption: z.tuple([Abs, Abs, Abs, Abs, Abs, Abs]), // 125..4k, each in [0,1]
})
export type Material = z.infer<typeof MaterialSchema>

export const LayerSchema = z.object({
  kind: z.literal('layer'),
  materialId: z.string(),
  thickness: z.number().positive(),
})
export type Layer = z.infer<typeof LayerSchema>

export const GapSchema = z.object({
  kind: z.literal('gap'),
  width: z.number().positive(),
  decoupling: z.enum(['strips', 'clips']),
  fill: z.enum(['empty', 'insulation']),
  fillMaterialId: z.string(),
})
export type Gap = z.infer<typeof GapSchema>

export const StackItemSchema = z.discriminatedUnion('kind', [LayerSchema, GapSchema])
export type StackItem = z.infer<typeof StackItemSchema>

/** Outside-in stack, at most one gap. */
export const StackSchema = z
  .array(StackItemSchema)
  .refine((s) => s.filter((i) => i.kind === 'gap').length <= 1, { message: 'at most one gap per stack' })

export const CabSchema = z.object({
  id: z.string(),
  name: z.string(),
  w: z.number().positive(),
  h: z.number().positive(),
  d: z.number().positive(),
  speakers: z.array(z.object({ x: z.number(), y: z.number() })), // centres on baffle, mm from cab bottom-left
  back: z.enum(['closed', 'open']),
})
export type Cab = z.infer<typeof CabSchema>

export const FacetSchema = z.object({
  width: z.number().positive(),
  tilt: z.number().min(0).max(20),
  hinge: z.enum(['min', 'max']), // hinge edge at lower/higher coord of split axis
})
export type Facet = z.infer<typeof FacetSchema>

export const WallInteriorSchema = z.object({
  splitAxis: AxisSchema,
  facets: z.array(FacetSchema).min(1).max(8),
  panelMaterialId: z.string(),
  panelThickness: z.number().positive(),
  closure: z.enum(['fillers', 'sealant']),
  behind: z.enum(['insulation', 'empty']),
})
export type WallInterior = z.infer<typeof WallInteriorSchema>

export const InnerPanelSchema = z.object({
  id: z.string(),
  normal: AxisSchema,
  position: z.number(),
  u0: z.number(),
  u1: z.number(),
  v0: z.number(),
  v1: z.number(),
  layers: z.array(LayerSchema),
  insulation: z.object({ materialId: z.string(), thickness: z.number().positive() }).nullable(),
})
export type InnerPanel = z.infer<typeof InnerPanelSchema>

export const SurfaceRefSchema = z.union([
  z.object({ wall: WallIdSchema }),
  z.object({ panelId: z.string(), side: z.enum(['neg', 'pos']) }),
])
export type SurfaceRef = z.infer<typeof SurfaceRefSchema>

export const TreatmentSchema = z.object({
  id: z.string(),
  surface: SurfaceRefSchema,
  materialId: z.string(),
  thickness: z.number().positive(),
})
export type Treatment = z.infer<typeof TreatmentSchema>

export const JointTypeSchema = z.enum(['sides-past', 'tops-past', 'rebate', 'mitre'])
export type JointType = z.infer<typeof JointTypeSchema>

export const DoorLeafSchema = z.object({
  opening: z.enum(['in', 'out', 'split']),
  framed: z.boolean(),
  frameWidth: z.number().min(0),
  hingeEdge: z.enum(['left', 'right', 'top', 'bottom']),
  hingeTypeId: z.string(),
  sealTypeId: z.string(),
  latchTypeId: z.string(),
  latchCount: z.number().int().min(0),
  stack: z.array(LayerSchema).nullable(), // null = match wall
})
export type DoorLeaf = z.infer<typeof DoorLeafSchema>

export const DoorSchema = z.object({
  side: z.union([DoorSideSchema, z.literal('auto')]),
  opening: z.object({ w: z.number().positive(), h: z.number().positive() }).nullable(), // null = auto
  margin: z.number().min(0),
  overlap: z.number().min(0),
  outer: DoorLeafSchema,
  inner: DoorLeafSchema,
  between: z.enum(['air', 'insulation']),
})
export type Door = z.infer<typeof DoorSchema>

const PositiveVec3Schema = z.object({ x: z.number().positive(), y: z.number().positive(), z: z.number().positive() })

export const DimensionsSchema = z.object({
  mode: z.enum(['inside', 'outside']),
  innerSource: z.enum(['manual', 'cab']),
  inner: PositiveVec3Schema,
  outer: PositiveVec3Schema,
  clearance: z.number().min(0),
  sizingCabId: z.string(),
})
export type Dimensions = z.infer<typeof DimensionsSchema>

export const EscapeSchema = z.object({
  insideLevel: z.array(z.number()).length(6),
  outsideTarget: z.number(),
  distance: z.number().positive(), // m
})
export type Escape = z.infer<typeof EscapeSchema>

export const SimSettingsSchema = z.object({
  fMax: z.number().min(250).max(2000),
  cabId: z.string(), // '' = no cab in simulation
  probes: z.array(Vec3Schema),
})
export type SimSettings = z.infer<typeof SimSettingsSchema>

export const DesignSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  cabs: z.array(CabSchema).min(1),
  dims: DimensionsSchema,
  wallDefault: StackSchema,
  wallOverrides: z.record(WallIdSchema, StackSchema),
  joint: JointTypeSchema,
  interior: z.record(WallIdSchema, WallInteriorSchema),
  panels: z.array(InnerPanelSchema),
  treatments: z.array(TreatmentSchema),
  door: DoorSchema,
  escape: EscapeSchema,
  sim: SimSettingsSchema,
})
export type Design = z.infer<typeof DesignSchema>

export const HingeTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['butt', 'piano', 'lift-off']),
  leafWidth: z.number().min(0),
  edgeInset: z.number().min(0),
})
export type HingeType = z.infer<typeof HingeTypeSchema>

export const SealTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  thickness: z.number().positive(),
  width: z.number().positive(),
  rebated: z.boolean(),
})
export type SealType = z.infer<typeof SealTypeSchema>

export const LatchTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['toggle', 'compression']),
  edgeInset: z.number().min(0),
})
export type LatchType = z.infer<typeof LatchTypeSchema>

export const LibrarySchema = z.object({
  materials: z.array(MaterialSchema),
  hinges: z.array(HingeTypeSchema),
  seals: z.array(SealTypeSchema),
  latches: z.array(LatchTypeSchema),
})
export type Library = z.infer<typeof LibrarySchema>

export const SheetStockSchema = z.object({
  materialId: z.string(),
  thickness: z.number().positive(),
  length: z.number().min(0), // roll: 0
  width: z.number().positive(), // roll: roll width
})
export type SheetStock = z.infer<typeof SheetStockSchema>

export const ShopSchema = z.object({
  sheets: z.array(SheetStockSchema),
  kerf: z.number().min(0),
  maxBevel: z.number().min(0),
  minPart: z.number().min(0),
  rollOverlap: z.number().min(0),
})
export type Shop = z.infer<typeof ShopSchema>

export const VersionSchema = z.object({
  version: z.number().int(),
  savedAt: z.string(),
  design: DesignSchema,
})
export type Version = z.infer<typeof VersionSchema>

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  versions: z.array(VersionSchema),
  /** Autosaved working copy. Saved versions are never changed by editing. */
  working: DesignSchema.optional(),
})
export type Project = z.infer<typeof ProjectSchema>

export const ExportFileSchema = z.object({
  format: z.literal('isocab'),
  schemaVersion: z.literal(1),
  project: ProjectSchema,
  materials: z.array(MaterialSchema),
})
export type ExportFile = z.infer<typeof ExportFileSchema>
