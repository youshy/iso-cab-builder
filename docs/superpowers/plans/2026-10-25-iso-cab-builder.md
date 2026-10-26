# ISO Cab Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static browser tool (GitHub Pages) to design a dual-door isolation box for guitar cabs up to 6x12, compare acoustic versions, and output a cut list plus printable drawings.

**Architecture:** Pure TypeScript domain modules (geometry, doors, acoustics, cut list, drawings) with no DOM dependencies, each unit-tested with Vitest. A Preact UI with signals renders six build-order step tabs over a single `Design` object. The FDTD simulation runs in a Web Worker; everything persists to localStorage with JSON export/import validated by zod.

**Tech Stack:** Vite 5, TypeScript 5 (strict), Preact 10 + @preact/signals, three.js, zod 3, Vitest 2. GitHub Actions → GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-25-iso-cab-builder-design.md`. Visual reference: `docs/superpowers/specs/assets/interior-step-mockup.html` (open in a browser; colour tokens, layout and the facet table are copied from it).

## Global Constraints

- Static site only; no server. Vite `base: './'` so it works under `https://<user>.github.io/<repo>/`.
- All lengths stored in **mm**; angles in **degrees**; display may convert to inches (1 in = 25.4 mm, show 1 decimal in, 0 decimals mm).
- Coordinate system: inner cavity origin at inner back-bottom-left corner. `x` = width (left→right), `y` = height (bottom→top), `z` = depth (back→front). Speakers always face `+z` (front).
- Wall in-plane axes: left/right: `y`,`z`; top/bottom: `x`,`z`; back/front: `x`,`y`.
- Facets: 0–20° tilt, slider step 0.5°, numeric input accepts 0.1°; max 8 facets per wall; widths independent (need not be equal); door wall cannot have facets.
- Defaults: wall stack 18 mm plywood + 18 mm MDF; facet panel 12 mm plywood; space behind facets = insulation; escape inside level 115 dB SPL flat per octave, outside target 60 dB SPL, reference distance 1 m; sim fMax 1000 Hz (user range 250–2000 Hz).
- Every acoustic/TL number on screen is labelled as an estimate and names its model ("FDTD estimate", "Sharp double-leaf estimate").
- Geometry updates synchronously on input. Simulation status always visible: `up to date` / `running` / `stale`.
- UI copy: no em dashes; plain, short labels. Light theme only, tokens from the mockup `:root` block; one accent (orange) for selection/current state only.
- Desktop first; layout must not break at 1024 px wide; no phone layout.
- Material, sheet, hardware data are user-editable; never hardcode shop values outside `defaults.ts`.

## Review Focus

1. **Inner box resized after walls are split** → facets rescale proportionally so widths still sum to the new wall length (test in Task 4).
2. **Tilts large enough to eat the cab clearance or meet the opposite wall** → fit check reports which cab no longer fits and by how much; free space never goes negative silently; inside-out mode grows the box (tests in Tasks 3 and 5).
3. **Importing a malformed, older-schema, or foreign JSON file** (unknown material ids, missing fields, wrong `schemaVersion`) → readable error, nothing overwritten; materials embedded in the file are merged into the library (test in Task 6).
4. **localStorage unavailable or full** (private window, quota) → app still runs in memory and shows a "not saved" warning (test in Task 6).
5. **Door moved to a wall that already has facets**, or air gap toggled after doors were configured → facets on the door wall are kept but marked inactive with a warning and excluded from geometry/sim/cut list; door inner-leaf mounting switches between liner and rebate frame (tests in Tasks 5 and 12).

---

## File Structure

```
index.html                      app entry
vite.config.ts                  base './', preact preset, vitest config
package.json, tsconfig.json
.github/workflows/deploy.yml    build + deploy to Pages
src/main.tsx                    mount App
src/styles.css                  tokens + layout (from mockup)
src/model/schema.ts             zod schemas; ALL domain types inferred from here
src/model/defaults.ts           seed library, default shop, default design
src/model/store.ts              signals: library, shop, project, current/compare version; actions
src/storage/local.ts            localStorage persistence
src/storage/io.ts               JSON export/import
src/geometry/walls.ts           wall/axis mapping, stack helpers
src/geometry/dimensions.ts      inner/outer/free resolution
src/geometry/facets.ts          facet offsets, rebalance, rescale, steps
src/geometry/space.ts           cab placement, fit, isAir, corner flags, door-wall facet deactivation
src/doors/doors.ts              door side, opening, leaves, hinges, latches, collisions
src/acoustics/analytic.ts       rectangular room modes
src/acoustics/spectrum.ts       FFT + peak picking
src/acoustics/fdtd.ts           voxelise + cut-cell FDTD
src/acoustics/tl.ts             transmission loss + escape margin
src/acoustics/worker.ts         worker entry
src/acoustics/client.ts         worker client, debounce, cache
src/cutlist/parts.ts            parts + hardware from design
src/cutlist/doorParts.ts        door parts
src/cutlist/nesting.ts          guillotine nesting
src/drawings/sheets.ts          SVG drawing sheets
src/ui/App.tsx, TopBar.tsx, StepTabs.tsx, ModeStrip.tsx, NumberField.tsx, Chart.tsx
src/ui/steps/CabStep.tsx, WallsStep.tsx, InteriorStep.tsx, DoorsStep.tsx, AcousticsStep.tsx, CutListStep.tsx
src/ui/views/SectionView.tsx    plan/front/side SVG (shared by steps 1–4)
src/ui/views/View3D.tsx         three.js view
src/ui/library/MaterialLibrary.tsx, ShopSettings.tsx
tests: colocated `*.test.ts`
```

---

### Task 1: Scaffold, app shell, deploy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/styles.css`, `src/ui/App.tsx`, `src/ui/StepTabs.tsx`, `.github/workflows/deploy.yml`, `src/smoke.test.ts`

**Interfaces:**
- Produces: `type StepId = 'cab'|'walls'|'interior'|'doors'|'acoustics'|'cutlist'` and `STEPS: {id: StepId; label: string}[]` exported from `src/ui/StepTabs.tsx` (labels: Cab, Walls, Interior, Doors, Acoustics, Cut list). Layout grid classes in `styles.css`: `.top`, `.steps`, `.main` (380 px aside + stage), `.modes` footer.

- [ ] **Step 1:** `npm create vite@5` equivalent by hand: deps `preact@10.24.3 @preact/signals@1.3.0 three@0.169.0 zod@3.23.8`; devDeps `vite@5.4.10 @preact/preset-vite@2.9.1 typescript@5.6.3 vitest@2.1.4 @types/three@0.169.0`. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`). tsconfig `strict: true`, `jsx: react-jsx`, `jsxImportSource: preact`.
- [ ] **Step 2: Write smoke test** `src/smoke.test.ts`: `expect(STEPS.map(s => s.id)).toEqual(['cab','walls','interior','doors','acoustics','cutlist'])`.
- [ ] **Step 3:** Run `npm test`; expected FAIL (module missing).
- [ ] **Step 4:** Implement shell: top bar placeholder, step tabs (numbered circles, `.on` with accent underline, `.done` grey check), empty aside/stage, footer strip. Copy `:root` tokens and component CSS from the mockup.
- [ ] **Step 5:** `npm test` PASS; `npm run build` succeeds; `npm run dev` shows tabs that switch the active step.
- [ ] **Step 6:** Deploy workflow: on push to `main`, `actions/checkout@v4`, `actions/setup-node@v4` (node 20), `npm ci`, `npm test`, `npm run build`, `actions/upload-pages-artifact@v3` (path `dist`), `actions/deploy-pages@v4`. Permissions `pages: write, id-token: write`.
- [ ] **Step 7: Commit** `feat: scaffold app shell and pages deploy`.

---

### Task 2: Schema, types, defaults

**Files:**
- Create: `src/model/schema.ts`, `src/model/defaults.ts`, `src/model/schema.test.ts`

**Interfaces:**
- Produces (all types are `z.infer` of same-named `…Schema`):
  ```ts
  type Vec3 = { x: number; y: number; z: number }
  type Axis = 'x'|'y'|'z'
  type WallId = 'left'|'right'|'top'|'bottom'|'back'|'front'
  type DoorSide = 'front'|'left'|'right'
  type Material = { id: string; name: string; kind: 'sheet'|'roll'|'fill'; density: number /*kg/m3*/;
    thicknesses: number[]; youngsModulus: number /*Pa*/; lossFactor: number;
    absorption: [number,number,number,number,number,number] /*125,250,500,1k,2k,4k*/ }
  type Layer = { kind: 'layer'; materialId: string; thickness: number }
  type Gap = { kind: 'gap'; width: number; decoupling: 'strips'|'clips'; fill: 'empty'|'insulation'; fillMaterialId: string }
  type StackItem = Layer | Gap            // outside-in; at most one Gap (refine)
  type Cab = { id: string; name: string; w: number; h: number; d: number;
    speakers: { x: number; y: number }[] /* centres on baffle, mm from cab bottom-left */; back: 'closed'|'open' }
  type Facet = { width: number; tilt: number; hinge: 'min'|'max' }  // hinge edge at lower/higher coord of split axis
  type WallInterior = { splitAxis: Axis; facets: Facet[] /*1..8*/; panelMaterialId: string; panelThickness: number;
    closure: 'fillers'|'sealant'; behind: 'insulation'|'empty' }
  type InnerPanel = { id: string; normal: Axis; position: number; u0: number; u1: number; v0: number; v1: number;
    layers: Layer[]; insulation: { materialId: string; thickness: number } | null }
  type SurfaceRef = { wall: WallId } | { panelId: string; side: 'neg'|'pos' }
  type Treatment = { id: string; surface: SurfaceRef; materialId: string; thickness: number }
  type JointType = 'sides-past'|'tops-past'|'rebate'|'mitre'
  type DoorLeaf = { opening: 'in'|'out'|'split'; framed: boolean; frameWidth: number; hingeEdge: 'left'|'right'|'top'|'bottom';
    hingeTypeId: string; sealTypeId: string; latchTypeId: string; latchCount: number; stack: Layer[] | null /*null = match wall*/ }
  type Door = { side: DoorSide | 'auto'; opening: { w: number; h: number } | null /*null = auto*/; margin: number;
    overlap: number; outer: DoorLeaf; inner: DoorLeaf; between: 'air'|'insulation' }
  type Dimensions = { mode: 'inside'|'outside'; innerSource: 'manual'|'cab'; inner: Vec3; outer: Vec3; clearance: number; sizingCabId: string }
  type Escape = { insideLevel: number[] /*6 octaves*/; outsideTarget: number; distance: number /*m*/ }
  type SimSettings = { fMax: number; cabId: string /* '' = no cab in sim */; probes: Vec3[] }
  type Design = { schemaVersion: 1; id: string; name: string; cabs: Cab[] /*min 1*/; dims: Dimensions;
    wallDefault: StackItem[]; wallOverrides: Partial<Record<WallId, StackItem[]>>; joint: JointType;
    interior: Partial<Record<WallId, WallInterior>>; panels: InnerPanel[];
    treatments: Treatment[]; door: Door; escape: Escape; sim: SimSettings }
  type HingeType = { id: string; name: string; kind: 'butt'|'piano'|'lift-off'; leafWidth: number; edgeInset: number }
  type SealType  = { id: string; name: string; thickness: number; width: number; rebated: boolean }
  type LatchType = { id: string; name: string; kind: 'toggle'|'compression'; edgeInset: number }
  type Library = { materials: Material[]; hinges: HingeType[]; seals: SealType[]; latches: LatchType[] }
  type SheetStock = { materialId: string; thickness: number; length: number; width: number /*roll: width = roll width, length = 0*/ }
  type Shop = { sheets: SheetStock[]; kerf: number; maxBevel: number; minPart: number; rollOverlap: number }
  type Version = { version: number; savedAt: string; design: Design }
  type Project = { id: string; name: string; versions: Version[] }
  type ExportFile = { format: 'isocab'; schemaVersion: 1; project: Project; materials: Material[] }
  ```
- Produces from `defaults.ts`: `defaultLibrary(): Library`, `defaultShop(): Shop`, `defaultDesign(): Design`, `newCab(p?: Partial<Cab>): Cab`, `newId(): string` (`crypto.randomUUID()`).

Seed values (label in UI "typical figures, edit to match your product"):

| id | kind | density | thicknesses | E (Pa) | η | absorption 125…4k |
|---|---|---|---|---|---|---|
| plywood | sheet | 600 | 9,12,15,18,24 | 8e9 | 0.02 | .28 .22 .17 .09 .10 .11 |
| mdf | sheet | 750 | 12,18,25 | 3.5e9 | 0.03 | .10 .10 .10 .08 .08 .08 |
| osb | sheet | 620 | 12,18 | 5e9 | 0.03 | .15 .13 .10 .09 .09 .09 |
| mlv | roll | 2000 | 2.5,5 | 1e7 | 0.3 | .05 .05 .05 .05 .05 .05 |
| rockwool | fill | 45 | 25,50,100 | 1e5 | 0.1 | .20 .60 .95 1.0 1.0 1.0 |
| foam | fill | 30 | 30,50 | 1e5 | 0.1 | .10 .25 .55 .80 .90 .90 |
| carpet | roll | 300 | 8 | 1e6 | 0.2 | .05 .10 .20 .35 .50 .60 |
| rubber | roll | 1200 | 3,6 | 2e6 | 0.2 | .04 .04 .04 .04 .04 .04 |

Default shop: kerf 3, maxBevel 45, minPart 30, rollOverlap 50; sheets 2440×1220 for plywood/mdf/osb in each listed thickness; mlv/carpet/rubber rolls 1220 wide. Library hinges: butt 75 mm (inset 150), piano (inset 0), lift-off (inset 150). Seals: 12×6 compression tape rebated, 20×10 non-rebated. Latches: toggle clamp (inset 100), compression latch (inset 100).

Default design: one cab "6x12" 1350×980×360, six speakers on a 3×2 grid (x at 225, 675, 1125; y at 245, 735), closed back; dims `inside`/`cab`, clearance 20; joint `sides-past`; door `auto`, margin 15, overlap 25, both leaves `out` (inner leaf `in`), frameless, butt hinges, compression latches ×2; `between: 'insulation'`; sim fMax 1000.

- [ ] **Step 1: Write tests** `schema.test.ts`:
  - `DesignSchema.parse(defaultDesign())` does not throw.
  - stack with two `gap` items fails parse.
  - design with `cabs: []` fails parse.
  - facet tilt 20.5 fails; 8 facets pass, 9 fail.
  - every `materialId` referenced by `defaultDesign()` exists in `defaultLibrary().materials`.
- [ ] **Step 2:** Run `npx vitest run src/model` → FAIL.
- [ ] **Step 3:** Implement schemas with zod refinements (one gap max; facets 1..8; tilt 0..20; cabs min 1) and defaults.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: domain schema and defaults`.

---

### Task 3: Facet geometry

**Files:**
- Create: `src/geometry/facets.ts`, `src/geometry/facets.test.ts`

**Interfaces:**
- Produces:
  - `packingDepth(f: Facet): number` = width·tan(tilt)
  - `panelLength(f: Facet): number` = width / cos(tilt)
  - `facetOffsetAt(wi: WallInterior, s: number): number`: distance of the facet face from the wall face at position `s` (mm along split axis from wall's min edge) = panelThickness + tan(tilt)·(distance from that facet's hinge edge). Boundaries belong to the later facet.
  - `maxIntrusion(wi: WallInterior | null): number` (0 for null)
  - `splitEvenly(length: number, n: number): number[]` integer widths, last takes remainder
  - `rebalance(facets: Facet[], index: number, width: number, length: number, minWidth = 10): Facet[] | null`: sets `facets[index].width`, adjusts next facet (previous if last) to keep the sum; null if neighbour would drop below `minWidth`
  - `rescale(facets: Facet[], newLength: number): Facet[]` proportional, 0.1 mm rounding, remainder on last
  - `widthError(facets: Facet[], length: number): number` (sum − length)
  - `steps(wi: WallInterior): { s: number; delta: number }[]` boundaries where |offset jump| > 0.5 mm

- [ ] **Step 1: Write tests:**
  - `packingDepth({width:180,tilt:4})` ≈ 12.59 (±0.01); `panelLength` ≈ 180.44.
  - wall `[{180,4,'min'},{180,7,'max'}]` panel 12: offset at s=0 → 12; s=179.9 → ≈24.58; s=180 → ≈34.10; s=360 → 12; `maxIntrusion` ≈ 34.10; `steps` = one step at 180 with delta ≈ 9.5.
  - unequal widths allowed: `[{120,5,'min'},{240,3,'min'}]` has widthError 0 for length 360.
  - `splitEvenly(360,7)` sums to 360, all ≥ 51.
  - `rebalance` setting facet 0 to 120 in `[180,180]` → `[120,240]`; setting to 355 → null.
  - **Review Focus 1:** `rescale([120,240], 300)` → `[100,200]`; `rescale([100,100,100], 200)` sums exactly 200.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: facet geometry`.

---

### Task 4: Walls, door side and dimension resolution

**Files:**
- Create: `src/geometry/walls.ts`, `src/geometry/dimensions.ts`, `src/geometry/dimensions.test.ts`

**Interfaces:**
- Consumes: types from Task 2; `maxIntrusion` from Task 3.
- Create also: `src/doors/side.ts` with `autoDoorSide(d: Design): DoorSide`: among front/left/right pick the side whose required opening area is smallest for the largest cab (front needs cab w×h, left/right need d×h); ties prefer `left`, then `right`, then `front`. And `doorWall(d: Design): WallId` (= `d.door.side` unless `'auto'`).
- Produces:
  - `WALLS: WallId[]`, `wallNormal(w: WallId): Axis`, `wallPlaneAxes(w: WallId): [Axis, Axis]`, `oppositeWall(w): WallId`
  - `wallStack(d: Design, w: WallId): StackItem[]` (override or default)
  - `stackThickness(items: StackItem[]): number`
  - `splitStack(items): { shell: Layer[]; gap: Gap | null; liner: Layer[] }`
  - `activeInterior(d: Design, w: WallId): WallInterior | null` (null for `doorWall(d)`: facets on the door wall are kept in data but inactive)
  - `resolveDims(d: Design): { inner: Vec3; outer: Vec3; free: Vec3; grownBy: Vec3 }` where `free` = inner minus facet intrusions of both walls per axis; `grownBy` is non-zero only in inside/cab mode.

Rules: outer = inner + per-axis sum of the two walls' stack thickness (`x`: left+right, `y`: bottom+top, `z`: back+front). Inside/manual: inner as entered. Inside/cab: inner = sizing cab + 2·clearance + intrusions on both walls of the axis (that addition is `grownBy`). Outside: inner = outer − stacks. Round results to 0.1 mm.

- [ ] **Step 1: Write tests** (default stack 36 mm everywhere; tests set `door.side = 'front'` unless stated):
  - `autoDoorSide` for the default 1350×980×360 cab → `left`.
  - inside/manual inner 1400×1000×450 → outer 1472×1072×522.
  - outside outer 1500×1100×500 → inner 1428×1028×428, free equal to inner when no facets.
  - inside/cab cab 1350×980×360, clearance 20, no facets → inner 1390×1020×400, grownBy 0.
  - same with left wall facets `[{180,4,'min'},{180,7,'max'}]`, panel 12 → inner.x 1424.1, grownBy.x 34.1.
  - outside with the same facets → inner.x 1428, free.x 1393.9.
  - left override 60 mm stack → outer.x = inner.x + 96.
  - air gap stack `[ply18, gap25, mdf18]` thickness 61.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: dimension resolution inside-out and outside-in`.

---

### Task 5: Space: cab placement, fit, air volume, corner flags

**Files:**
- Create: `src/geometry/space.ts`, `src/geometry/space.test.ts`

**Interfaces:**
- Consumes: `resolveDims`, `activeInterior`, `doorWall` (Task 4), `facetOffsetAt`, `maxIntrusion` (Task 3).
- Produces:
  - `type Box = { min: Vec3; max: Vec3 }`
  - `cabBox(d: Design, cab: Cab): Box`: centred in x on the free span; on the floor (y = bottom intrusion); back face at back intrusion + clearance.
  - `cabFit(d: Design): { cabId: string; fits: boolean; shortBy: Vec3 }[]` (shortBy ≥ 0 per axis, 0 when it fits)
  - `isAir(d: Design, p: Vec3): boolean`: inside inner cavity, beyond every active wall's facet face, outside the sim cab's box (`d.sim.cabId`), outside every inner panel's slab
  - `cornerFlags(d: Design): { walls: [WallId, WallId] }[]`: adjacent walls both having a facet with tilt > 0 (the drawing shows the compound cut there)
  - `inactiveFacetWarnings(d: Design): string[]`: non-empty when the door wall has an interior entry

- [ ] **Step 1: Write tests** (`door.side = 'front'` unless stated):
  - default design: every cab fits; `cabBox` min.y = 0, centred x.
  - **Review Focus 2:** outside mode outer 1450×1100×500 with 6x12 cab → fit false, `shortBy.x` > 0; no negative `free`.
  - `isAir`: point at cavity centre → true; point 5 mm from left wall where facet offset is 12 → false; point inside cab box → false.
  - **Review Focus 5:** set `door.side='left'` with left facets → `activeInterior(d,'left')` null, `inactiveFacetWarnings` length 1, `resolveDims` ignores those facets.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: cab fit, air volume, door-wall facet handling`.

---

### Task 6: Persistence and JSON import/export

**Files:**
- Create: `src/storage/local.ts`, `src/storage/io.ts`, `src/storage/storage.test.ts`

**Interfaces:**
- Produces:
  - `createStore(backend: Pick<Storage,'getItem'|'setItem'|'removeItem'> | null)` returning `{ ok: boolean; loadProjects(): Project[]; saveProject(p: Project): boolean; deleteProject(id: string): void; loadLibrary(): Library | null; saveLibrary(l: Library): boolean; loadShop(): Shop | null; saveShop(s: Shop): boolean }`. Keys: `isocab:projects` (id list), `isocab:project:<id>`, `isocab:library`, `isocab:shop`. Every access in try/catch; `ok=false` after any failure.
  - `exportProject(p: Project, lib: Library): string` (pretty JSON `ExportFile`, includes only referenced materials)
  - `importProject(text: string, lib: Library): { ok: true; project: Project; library: Library } | { ok: false; error: string }`: new project id on import; embedded materials merged (existing ids kept, new ids added).

- [ ] **Step 1: Write tests:**
  - round trip: export default project, import → designs deep-equal except project id.
  - **Review Focus 3:** `importProject('not json')` → error contains "not a valid JSON file"; `{format:'isocab',schemaVersion:2}` → error contains "newer version"; missing `project` → error names the field path; file referencing material absent from both library and file → error names the material id.
  - embedded material added to returned library.
  - **Review Focus 4:** backend whose `setItem` throws → `saveProject` returns false, `ok` false, no throw; `createStore(null)` works in memory.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: local persistence and json import/export`.

---

### Task 7: Store, top bar, versions, Cab step

**Files:**
- Create: `src/model/store.ts`, `src/ui/TopBar.tsx`, `src/ui/NumberField.tsx`, `src/ui/steps/CabStep.tsx`, `src/ui/views/SectionView.tsx`, `src/model/store.test.ts`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: Tasks 2–6 (`resolveDims`, `cabFit`, `createStore`).
- Produces (`store.ts`):
  - signals `library`, `shop`, `projects`, `projectId`, `design` (working copy), `compareVersion: number | null`, `units: 'mm'|'in'`, `saveWarning: string | null`
  - `update(fn: (d: Design) => void): void` (immer-style: structuredClone, mutate, validate with `DesignSchema.safeParse`; reject invalid with console warning; autosave working copy to the project)
  - `saveVersion(): number` (appends `Version`, returns its number), `loadVersion(n)`, `compareDesign: computed<Design|null>`
  - `fmtLen(mm: number): string`, `parseLen(text: string): number | null` honouring `units`
- `SectionView` props: `{ design: Design; view: 'plan'|'front'|'side'; highlight?: WallId; compare?: Design | null; exaggerate?: boolean }` renders SVG: outer shell, layers, inner cavity, facet faces (accent fill for highlighted wall), inner panels, cab dashed, door position; `compare` outline dashed grey.

- [ ] **Step 1: Write tests** `store.test.ts`: `update` that produces an invalid design leaves `design` unchanged; `saveVersion` twice → versions 1,2; `parseLen('10')` with units `in` → 254; `fmtLen(254)` with `in` → `"10.0 in"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement store, then TopBar (design select, version select, "Save as vN", compare select, units) and CabStep: cab list (add/remove/edit name, W/H/D, speaker layout preset 1x12…6x12 + custom, back), per-cab fit badge from `cabFit`, sizing cab select, driving side segmented control (Inside out / Outside in), manual vs from-cab, numeric fields for the driving box, read-only computed box, red warning text when a cab doesn't fit. Switching mode copies current resolved values into the newly driving field (no jump). Stage shows SectionView plan + front.
- [ ] **Step 4:** Tests PASS; `npm run dev`: change outer box in outside mode until 6x12 no longer fits → warning names the cab and shortfall; toggle mode → numbers unchanged.
- [ ] **Step 5: Commit** `feat: store, versions, cab step`.

---

### Task 8: Transmission loss and escape margin

**Files:**
- Create: `src/acoustics/tl.ts`, `src/acoustics/tl.test.ts`

**Interfaces:**
- Produces:
  - `THIRD_OCTAVES = [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000]`, `OCTAVES = [125,250,500,1000,2000,4000]`
  - `leaf(layers: Layer[], lib: Library): { m: number; fc: number; eta: number }`: m = Σ density·thickness/1000 (kg/m²); bending stiffness B = Σ Eᵢ·hᵢ³/12 (ν ignored, my call); fc = (c²/2π)·√(m/B), c = 343; eta = mass-weighted mean
  - `tlLeaf(l, f): number`: f < fc/2: `20·log10(m·f) − 47`; f ≥ fc: `20·log10(m·f) + 10·log10(2·eta·f/(π·fc)) − 47`; linear interpolation in dB between fc/2 and fc
  - `tlStack(items: StackItem[], lib): { thirds: number[]; f0: number | null; single: number }`: no gap → `tlLeaf`. With gap (Sharp): f0 = 60·√((m1+m2)/(m1·m2·d)), fl = 55/d (d in m); f < f0: `20·log10((m1+m2)·f) − 47`; f0 ≤ f < fl: `TL1 + TL2 + 20·log10(f·d) − 29`; f ≥ fl: `TL1 + TL2 + 6`. `fill: 'empty'` subtracts 5 dB above f0; `decoupling: 'strips'` subtracts 3 dB above f0 (model simplifications, label them). Result never below the f < f0 mass-law line. `single` = arithmetic mean of thirds 100–3150 Hz.
  - `toOctaves(thirds: number[]): number[]` energy mean of the 3 thirds centred on each octave
  - `escape(d: Design, lib): { tlBox: number[]; lout: number[]; margin: number[]; worst: number }` per octave: surfaces = 6 outer faces (m²), door area uses door leaves as a double leaf (outer leaf mass, inner leaf mass, d = between depth, fill from `door.between`); `TLc = −10·log10(Σ Sᵢ·10^(−TLᵢ/10) / ΣSᵢ)`; `Lout = Lin − TLc + 10·log10(ΣS) − 14 − 20·log10(r)`; `margin = target − Lout`.

- [ ] **Step 1: Write tests:**
  - 18 mm MDF: m = 13.5; `tlLeaf` at 500 Hz ≈ 29.6 (±0.5) (below fc).
  - MDF 18 + gap 25 (insulation, clips) + MDF 18: f0 ≈ 146 Hz (±2); TL at 100 Hz equals mass law of 27 kg/m² ±0.5; TL at 1000 Hz > single-leaf 36 mm MDF TL at 1000 Hz.
  - empty fill gives lower TL than insulation at 500 Hz, equal below f0.
  - escape formula: Lin 115, TLc 40, S 4 m², r 1 → Lout 67.0, margin −7.0 (test the pure helper `escapeLevel(lin, tlc, area, r)`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: transmission loss and escape margin estimates`.

---

### Task 9: Walls step UI and material library

**Files:**
- Create: `src/ui/steps/WallsStep.tsx`, `src/ui/library/MaterialLibrary.tsx`, `src/ui/Chart.tsx`

**Interfaces:**
- Consumes: store, `tlStack`, `escape`, `stackThickness`.
- `Chart` props: `{ x: number[]; series: { label: string; y: number[]; dashed?: boolean }[]; xLog?: boolean; yLabel: string; markers?: { x: number; label: string }[]; zeroLine?: boolean }` (plain SVG; current version solid ink, compare dashed grey).

- [ ] **Step 1:** WallsStep: default stack editor (rows outside-in: material select, thickness select from material's thicknesses or custom, move up/down, remove; "Add air gap" inserts a gap row with width, decoupling, fill); per-wall override toggles (left/right/top/bottom/back/front); joint type select with a small diagram per option; TL chart per stack (thirds, compare version dashed, f0 marker "air-gap resonance"); escape table per octave (Lin editable, Lout, margin; negative margins in warn colour) with target and distance inputs; label "Estimate: mass law / Sharp double-leaf".
- [ ] **Step 2:** MaterialLibrary: table editing all `Material` fields, add/duplicate/delete (delete blocked with message if referenced by current design).
- [ ] **Step 3:** `npm run dev`: add a 25 mm gap → f0 marker appears near the computed value; narrow gap to 10 mm → marker moves up; enabling compare shows dashed previous curve. `npm run build` passes.
- [ ] **Step 4: Commit** `feat: walls step with TL and escape margin`.

---

### Task 10: Interior step UI and section views

**Files:**
- Create: `src/ui/steps/InteriorStep.tsx`
- Modify: `src/ui/views/SectionView.tsx`

- [ ] **Step 1:** Build to the mockup: unfolded wall net (door wall dashed and disabled with tooltip "This is the door side; set it in step 4"; facet count badges), split axis segmented control (labels in plain words: for left/right "Depth"/"Height"; top/bottom "Width"/"Depth"; back "Width"/"Height"), facet stepper 1–8, "Split evenly", facet table (width numeric, tilt slider 0–20 step 0.5 + numeric 0.1, hinge select labelled by wall edges e.g. "front/back"), width-sum warning, panel material/thickness, closure (Filler strips / Sealant), behind (Insulation / Empty). Editing a width calls `rebalance`; if it returns null show inline "Neighbour would be under 10 mm". Extra panels list (add/edit position, extent, layers, insulation). Treatments list (surface select incl. panel sides, material, thickness). Readout of narrowest free space and fit badges; corner flag notes; inactive facet warning.
- [ ] **Step 2:** SectionView: draw facet faces from `facetOffsetAt` at true scale; `exaggerate` toggle in view bar ("Exaggerate depth ×2.4"); clicking a wall in the view selects it.
- [ ] **Step 3:** `npm run dev`: reproduce mockup behaviours: 2 facets at 120/240 mm, tilts 4°/7° → plan redraws instantly, width sum OK, free space decreases. Resize inner box in step 1 → facet widths rescale (Review Focus 1). `npm run build` passes.
- [ ] **Step 4: Commit** `feat: interior step with segmented wall tilts`.

---

### Task 11: 3D view

**Files:**
- Create: `src/ui/views/View3D.tsx`, `src/geometry/mesh.ts`, `src/geometry/mesh.test.ts`

**Interfaces:**
- Produces: `buildScene(d: Design): { solids: { name: string; kind: 'shell'|'liner'|'facet'|'panel'|'cab'|'door'; wall?: WallId; vertices: number[]; indices: number[] }[] }` (pure, mm units; facets as tilted boxes of panelThickness).
- View3D props `{ design: Design; highlight?: WallId; mode: 'solid'|'cutaway'|'exploded' }`; three.js with OrbitControls (`three/examples/jsm/controls/OrbitControls.js`), dispose on unmount, re-build meshes on design change (debounce 50 ms).

- [ ] **Step 1: Test:** `buildScene(defaultDesign())` contains 6 shell solids (or fewer when door wall replaced by door frame; assert ≥5) and one cab; left wall with 2 facets → 2 `facet` solids with `wall:'left'`; all vertex coordinates within the outer box.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `buildScene` and View3D (cut-away hides the top and door-side shell; exploded offsets each wall 80 mm outward along its normal; highlighted wall's facets accent colour).
- [ ] **Step 4:** Test PASS; `npm run dev`: orbit works, facets match plan view.
- [ ] **Step 5: Commit** `feat: 3d view`.

---

### Task 12: Door geometry

**Files:**
- Create: `src/doors/doors.ts`, `src/doors/doors.test.ts`
- Modify: `src/doors/side.ts` (from Task 4) only if needed

**Interfaces:**
- Produces:
  - `doorLayout(d: Design, lib: Library): DoorLayout` with
    ```ts
    type LeafLayout = { which: 'outer'|'inner'; mount: 'shell'|'liner'|'rebate'; opening: { w: number; h: number } /*clear*/;
      leaves: { w: number; h: number; t: number }[] /*1 or 2*/; frame: { width: number; depth: number } | null;
      hinges: { edge: string; positions: number[] }[]; latches: number[]; rebate: { depth: number; width: number } | null;
      swingRadius: number; direction: 'in'|'out' }
    type DoorLayout = { side: DoorSide; outer: LeafLayout; inner: LeafLayout; betweenDepth: number; cabsThrough: { cabId: string; fits: boolean }[]; collisions: string[] }
    ```
  Rules (my calls; keep them in one place):
  - Clear opening default = largest cab's face for that side (front: w×h, left/right: d×h) + 2·margin; `door.opening` overrides.
  - Frameless leaf = opening + 2·overlap; framed: frame lines the reveal (4 strips, width `frameWidth`, depth = mount layer thickness) and clear opening shrinks by 2·frameWidth, so the frame is sized from opening + 2·frameWidth; leaf overlaps frame by `overlap`.
  - Split: two leaves of (leafWidth − 3)/2 with a 3 mm meeting gap.
  - Mount: air gap on → outer in shell, inner in liner; off → outer in the outer part of the stack, inner in a rebate frame at the inner face, rebate depth = thickness of the inner leaf + seal thickness.
  - betweenDepth: gap on = gap width + shell/liner thickness not occupied by leaves; gap off = stack thickness − both leaf thicknesses − seal thicknesses. ≤ 0 → collision "Not enough wall depth for two doors".
  - Hinges: count 2 if leaf height < 900 else 3; positions `edgeInset` from each end, third centred. Latches: `latchCount` evenly spaced on the edge opposite the hinge, `edgeInset` from ends.
  - Collisions: outer leaf `in` requires betweenDepth ≥ leaf width (else "Outer door can't swing inwards: needs X mm, has Y mm"); inner leaf `out` likewise; inner leaf `in` requires its leaf width ≤ distance to cab front/side (cab box from `cabBox`).
  - `cabsThrough`: each cab's relevant face ≤ final clear opening.

- [ ] **Step 1: Write tests:**
  - default design → side `left`; outer clear opening (360+30)×(980+30) = 390×1010; frameless outer leaf 440×1060; 3 hinges on 1060 leaf at 150, 530, 910.
  - framed with frameWidth 45 → cab still passes (opening grown), frame strips depth = shell thickness.
  - outer leaf `in` with insulation between → collision message present.
  - **Review Focus 5:** toggling the gap off changes inner `mount` from `liner` to `rebate`, betweenDepth recomputed, no throw.
  - split leaves widths sum to leaf width − 3.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: dual door geometry`.

---

### Task 13: Doors step UI

**Files:**
- Create: `src/ui/steps/DoorsStep.tsx`
- Modify: `src/ui/views/SectionView.tsx` (swing arcs, door leaves)

- [ ] **Step 1:** Side control (Auto (shows chosen side) / Front / Left / Right), opening override, margin, overlap; two panels "Outer door" / "Inner door", each: opening direction (In / Out / Split), Framed / Frameless (+ frame width), hinge edge, hinge type, seal type, latch type + count, stack (match wall / custom layers); between-doors fill (Air / Insulation); results list: leaf sizes, clear opening, hinge and latch positions, rebate, between depth, cabs through. Collisions shown inline in warn colour above the results.
- [ ] **Step 2:** SectionView plan: leaves drawn, quarter-circle swing arcs (dashed) per leaf.
- [ ] **Step 3:** `npm run dev`: set outer door to In → collision message and overlapping arc; switch side to Left while the left wall has facets → inactive warning visible in Interior step. Build passes.
- [ ] **Step 4: Commit** `feat: doors step`.

---

### Task 14: Analytic modes and spectrum analysis

**Files:**
- Create: `src/acoustics/analytic.ts`, `src/acoustics/spectrum.ts`, `src/acoustics/spectrum.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = { f: number; n: [number, number, number]; kind: 'axial'|'tangential'|'oblique' }`
  - `rectModes(inner: Vec3 /*mm*/, fMax: number, c = 343): Mode[]` sorted by f, excludes (0,0,0)
  - `spectrum(signal: Float32Array, fs: number): { freqs: Float32Array; db: Float32Array }` (Hann window, zero-pad to power of 2, radix-2 FFT)
  - `type Peak = { f: number; level: number; q: number }`
  - `findPeaks(freqs, db, opts?: { minProminence?: number /*dB, default 6*/; fMin?: number; fMax?: number }): Peak[]` with parabolic interpolation on the peak bin; q = f / (−3 dB bandwidth)

- [ ] **Step 1: Write tests:**
  - `rectModes({x:1000,y:600,z:400}, 450)` first four f: 171.5, 285.8, 333.4, 343.0 (±0.2) with n `[1,0,0]`,`[0,1,0]`,`[1,1,0]`,`[2,0,0]`; kinds axial, axial, tangential, axial.
  - spectrum of a 1 s sum of sines 100 Hz and 237 Hz at fs 8000 → `findPeaks` returns both within ±0.5 Hz.
  - decaying sine 200 Hz with known decay τ → q within 20% of π·f·τ.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: analytic modes and spectrum analysis`.

---

### Task 15: FDTD simulation core

**Files:**
- Create: `src/acoustics/fdtd.ts`, `src/acoustics/fdtd.test.ts`

**Interfaces:**
- Consumes: `isAir`, `resolveDims`, `cabBox`, `activeInterior`, library absorption, `spectrum`, `findPeaks`, `rectModes`.
- Produces:
  ```ts
  type SimOptions = { fMax: number; duration?: number /*s, default 0.25*/; slices?: { axis: Axis; at: number; f: number }[] }
  type SimMode = { f: number; level: number; q: number; axis: Axis | null }
  type SimResult = { freqs: Float32Array; avgDb: Float32Array; probesDb: Float32Array[]; modes: SimMode[];
    dx: number; resolutionMm: number; slices: { axis: Axis; at: number; f: number; w: number; h: number; values: Float32Array }[] }
  function simulate(d: Design, lib: Library, opts: SimOptions, onProgress?: (p: number) => void): SimResult
  ```
- Method (builder chooses details within these bounds): staggered pressure/velocity FDTD, dx = c/(10·fMax), dt at 0.9× the 3D CFL limit. **Cut-cell**: each cell gets an air volume fraction and each velocity face an open-area fraction, computed by sub-sampling `isAir` on a 4×4×4 lattice per cell; these scale the updates so sub-cell wall movements change the result continuously. Boundaries are locally reacting with real admittance from absorption α (β = (1−√(1−α))/(1+√(1−α))); frequency dependence: one run per octave band from 125 Hz up to fMax (α below 125 uses the 125 value), each run band-pass filtered and summed. Surface α comes from: treatment on that surface, else facet panel material if the wall has active facets, else innermost layer of the wall stack; cab surfaces use plywood; open-back cab = cab box is air behind the baffle plane. Source: Gaussian-pulse soft sources at the sim cab's speaker centres on its baffle; average response = mean squared pressure over a fixed set of 64 random air points (seeded). `resolutionMm` = dx/4 (sub-sample spacing), shown in UI as the smallest resolvable change. `axis` set when a mode is within 3% of an axial `rectModes` entry of the inner cavity.

- [ ] **Step 1: Write tests** (rigid = custom material with all α = 0; design with no facets, cab removed by setting `sim.cabId` to `''` meaning "no cab", no panels):
  - **Validation:** cavity 1000×600×400, fMax 1000, duration 1 s, source near a corner: every one of the first 20 distinct `rectModes` (neighbours ≥3% apart) has a sim peak within 2%.
  - **Sub-cell sensitivity:** shrinking x by dx/4 raises the lowest mode by 1.49 Hz expected; sim shift is > 0 and within ±40% of expected.
  - **Absorption:** rockwool treatment on back wall lowers mean level of the 5 strongest peaks by ≥3 dB and lowers their mean q vs rigid.
  - **Facet effect:** adding the default 2-facet left wall changes the `modes` list (at least one peak moves ≥1%).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS (allow a 60 s test timeout for this file).
- [ ] **Step 5:** Log default-design runtime in node at fMax 1000 (`console.time`); target under 3 s. If slower, optimise (typed arrays, flat indexing) before committing.
- [ ] **Step 6: Commit** `feat: cut-cell fdtd simulation`.

---

### Task 16: Worker, scheduling, mode strip, Acoustics step

**Files:**
- Create: `src/acoustics/worker.ts`, `src/acoustics/client.ts`, `src/acoustics/client.test.ts`, `src/ui/ModeStrip.tsx`, `src/ui/steps/AcousticsStep.tsx`

**Interfaces:**
- Produces:
  - `simKey(d: Design, lib: Library, opts: SimOptions): string`: stable JSON of only sim-relevant fields (dims, wall stacks' innermost materials, interior, panels, treatments, sim cab, sim settings, referenced absorptions)
  - `createSimClient(spawn: () => Worker)`: `{ status: Signal<'up to date'|'running'|'stale'>; request(d, lib, opts): Promise<SimResult> }`, debounce 400 ms, cancels superseded runs (terminate + respawn), LRU cache of 8 results by key.
  - signals in store: `simCurrent`, `simCompare`.

- [ ] **Step 1: Test** `client.test.ts`: `simKey` unchanged when only `door.latchCount` or `escape` changes; changes when a facet tilt changes; cache returns the same object for the same key without spawning (fake worker).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement worker (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`) and client.
- [ ] **Step 4:** ModeStrip (from the mockup): status dot + text + runtime, strongest 5 modes of current with level delta vs compare (▼ green-ish ok colour / ▲ warn), "Open Acoustics" button. AcousticsStep: response chart current vs compare (avg and selected probe), mode table (f, level, q, axis, delta vs compare, analytic reference column for the untilted cavity), pressure slice heatmap at a chosen frequency and plane (greyscale, accent for max), fMax slider 250–2000, resolution note "Smallest change this grid resolves: X mm", estimate label.
- [ ] **Step 5:** Test PASS; `npm run dev`: change a tilt → status `stale`→`running`→`up to date` within a few seconds; mode strip shows deltas vs compare.
- [ ] **Step 6: Commit** `feat: simulation worker, mode strip, acoustics step`.

---

### Task 17: Cut list parts (shell, liner, facets, panels, treatment)

**Files:**
- Create: `src/cutlist/parts.ts`, `src/cutlist/parts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type BuildStep = 'shell'|'liner'|'facets'|'panels'|'treatment'|'doors'
  type Bevel = { edge: 'L1'|'L2'|'W1'|'W2'; angle: number }
  type Part = { id: string /*P1..*/; name: string; materialId: string; thickness: number; length: number; width: number;
    bevels: Bevel[]; qty: number; step: BuildStep; kind: 'panel'|'roll'|'strip'|'packer'|'filler'|'wedge'|'frame'|'leaf';
    notes: string[]; warnings: string[] }
  type HardwareItem = { name: string; qty: number; unit: 'pcs'|'m' }
  function buildParts(d: Design, lib: Library, shop: Shop): { parts: Part[]; hardware: HardwareItem[] }
  ```
  `length` ≥ `width` always. Identical parts merged with qty. Ids assigned after sorting by step order then name.
- Rules:
  - Each layer is its own part with the laminated panel's dimensions (laminated after cutting). Roll goods: `kind:'roll'`, face dims, note "roll width W, N strips, overlap O".
  - Joints (t = laminated panel thickness of that box): `sides-past`: left/right H×D, top/bottom (W−2t)×D, back and front inset (W−2t)×(H−2t). `tops-past`: top/bottom W×D, left/right (H−2t)×D, back/front inset (W−2t)×(H−2t). `rebate`: as sides-past but top/bottom/back/front are +t/2 per rebated edge, note "rebate t/2 × t on …". `mitre`: every panel full outer face size, 45° bevel on every joined edge.
  - Air gap: shell box uses shell layers at outer dims; liner box uses liner layers at liner outer dims = inner + 2·liner thickness; decoupling strips (rubber, 50 mm wide strips around each liner panel perimeter, `kind:'strip'`) or clips (hardware, one per 400×400 mm grid point, min 4 per panel).
  - Door wall panel gets note "cut opening W×H at X,Y" (from `doorLayout`).
  - Facets: per facet `panelLength` × other-axis span, bevel = tilt on both long edges; other-axis span shortened at each end by the abutting wall's `maxIntrusion` when that wall comes earlier in priority `back, left, right, top, bottom`. Packer per facet at free edge: thickness = packingDepth, bevel = tilt, `kind:'packer'`. Closure `fillers`: filler strip per `steps()` entry (delta × span) and two wedge end pieces per tilted facet (legs width and packingDepth, `kind:'wedge'`); `sealant`: none, hardware "Sealant bead" in m (sum of step lengths + facet end perimeters). Behind `insulation`: fill part per facet bay.
  - Inner panels: one part per layer + insulation part. Treatments: one part per treated surface at surface face dims.
  - Warnings: bevel > `shop.maxBevel` → "Bevel X° exceeds your saw's Y°: cut the complement (90 − X)° or use a packer strip"; dimension < `minPart` → "Below minimum part size".

- [ ] **Step 1: Write tests** (inside/manual inner 1400×1000×450, stack ply18+mdf18, `door.side = 'front'`):
  - `sides-past`: two left/right parts per layer at 1072×522; top/bottom 1400×522; back 1400×1000. Sum check: left t + top length + right t = outer W (1472).
  - `tops-past`: top/bottom 1472×522; left/right 1000×522.
  - `mitre`: left 1072×522 with four 45° bevels.
  - air gap `[ply18, gap25 clips, mdf18]`: liner parts sized from inner + 2·18; clips in hardware.
  - facets default left wall: 2 facet parts, lengths ≈180.44 and ≈181.35, packers ≈12.59 and ≈22.10, one filler strip ≈9.5 wide; with `sealant` no filler/wedge parts and hardware contains "Sealant bead".
  - unequal widths 120/240 produce facet panels 120/cos and 240/cos.
  - shop maxBevel 5 with a 7° facet → warning on that part.
  - **Review Focus 5:** facets on the door wall produce no parts.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: cut list parts`.

---

### Task 18: Door parts and hardware

**Files:**
- Create: `src/cutlist/doorParts.ts`, `src/cutlist/doorParts.test.ts`
- Modify: `src/cutlist/parts.ts` (append door parts/hardware, step `doors`)

**Interfaces:**
- Consumes: `doorLayout`.
- Produces: `doorParts(d: Design, lib: Library): { parts: Omit<Part,'id'>[]; hardware: HardwareItem[] }`: leaf parts per layer of each leaf stack, frame strips (2 × height, 2 × width) when framed, rebate note on leaves when seal `rebated`, astragal strip for split leaves, door-gap gasket strip (air gap mode, perimeter of opening between shell and liner), hardware: hinges (count), latches, seal tape (m, opening perimeter per leaf).

- [ ] **Step 1: Tests:** default design: outer leaf parts 1060×440 per layer, 3 hinges + 2 latches per leaf in hardware, seal tape ≈ 2·(440+1060)/1000 m per leaf; framed adds 4 frame strips; split adds an astragal.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: door parts and hardware`.

---

### Task 19: Sheet nesting

**Files:**
- Create: `src/cutlist/nesting.ts`, `src/cutlist/nesting.test.ts`

**Interfaces:**
- Produces: `nest(parts: Part[], shop: Shop): { groups: { materialId: string; thickness: number; stock: SheetStock | null; sheets: { placements: { partId: string; x: number; y: number; w: number; h: number; rotated: boolean }[] }[]; wastePct: number }[]; unplaced: { partId: string; reason: string }[] }`. Sheet parts only (`kind` not `roll`); guillotine, first-fit decreasing by area, rotation allowed (no grain direction, my call), kerf between parts. No stock for a material/thickness or part larger than stock → `unplaced` with reason.

- [ ] **Step 1: Tests:** 4× 1200×600 on 2440×1220 kerf 3 → 1 sheet; 5× → 2 sheets; part 2500×100 → unplaced "larger than any sheet"; placements never overlap (including kerf) and stay inside the sheet.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: guillotine sheet nesting`.

---

### Task 20: Drawings

**Files:**
- Create: `src/drawings/sheets.ts`, `src/drawings/sheets.test.ts`

**Interfaces:**
- Produces: `buildSheets(d: Design, lib: Library, parts: Part[]): { step: BuildStep | 'overview'; title: string; scale: number; svg: string }[]`: A3 landscape (`width="420mm" height="297mm"`, viewBox in drawing mm), scale picked from [1/5, 1/10, 1/20] as the largest that fits, printed "Scale 1:N" in the title block. Sheets in order: overview (front, side, plan with overall dims), shell, liner (air gap only), facets (each wall elevation with facet widths, tilts, hinge edge, packing depths), panels, treatment, doors (each leaf with hinge/latch positions, rebate, seal line, opening and frame). Each part shown carries a balloon with its part id. Never exaggerated.

- [ ] **Step 1: Tests:** every part id in `buildParts(defaultDesign()).parts` appears in at least one sheet's svg; liner sheet present only with a gap; overview contains the outer W, H, D values as text; svg width attribute is `420mm`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: printable drawing sheets`.

---

### Task 21: Cut list step, shop settings, print

**Files:**
- Create: `src/ui/steps/CutListStep.tsx`, `src/ui/library/ShopSettings.tsx`
- Modify: `src/styles.css` (print rules)

- [ ] **Step 1:** CutListStep: tabs within the step: Parts (table grouped by build step: id, name, material, thickness, L × W, bevels, qty, notes, warnings in warn colour; totals), Hardware, Sheets (nesting diagrams per sheet, sheet counts, waste %, unplaced list), Drawings (sheet previews). Buttons: "Print drawings" (`window.print()` with only drawing sheets visible, one per page, `@page { size: A3 landscape; margin: 0 }`), "Print cut list", "Export CSV" (parts). ShopSettings panel (opened from the step and the top bar): sheets table, kerf, max bevel, min part, roll overlap; persisted via store.
- [ ] **Step 2:** `npm run dev`: change kerf → sheet count updates; print preview shows A3 sheets at the stated scale with part balloons matching the parts table. `npm run build` passes, `npm test` all green.
- [ ] **Step 3: Commit** `feat: cut list step, shop settings, printing`.

---

### Task 22: Release check

- [ ] **Step 1:** `npm test` all PASS; `npm run build` clean; `npx vite preview` and walk all six steps with the default design; export JSON, clear localStorage, import → identical.
- [ ] **Step 2:** Push branch, open PR to `main`; after merge confirm the Pages workflow deploys and the site loads from the repo subpath (assets resolve with `base: './'`, worker loads).
- [ ] **Step 3: Commit** any fixes as `fix: …`.
