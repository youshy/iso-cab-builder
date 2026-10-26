# ISO Cab Builder: Design

Date: 2026-10-25
Status: approved 2026-10-25

## Intent

A browser tool for designing and building an isolation box ("iso cab") around a guitar speaker cabinet of up to 6x12. The owner wants to remove guesswork from the build: design the box with sliders, see how each change affects the acoustics inside the box and the sound escaping it, then walk into the workshop with a cut list (panel sizes and bevel angles) and drawings they can follow step by step.

It is a **compare-and-tweak tool**. The owner saves design versions, changes something, and sees whether it got better or worse. Absolute acoustic accuracy is not promised; the numbers must be good enough that "B is better than A" is trustworthy, and material data is entered by the user so results track the real materials they buy.

Hosted as a static site on GitHub Pages.

## Goals

1. Define the box from either the inner or the outer dimensions and calculate the other way.
2. Define wall construction as layered stacks (damping layers), with an optional decoupled air gap.
3. Estimate transmission loss per wall stack and compare it against a target for how much sound may escape.
4. Tilt the inner faces of the walls, with any wall split into independently tilted facets.
5. Add extra inner panels (with or without insulation) and acoustic treatment on any surface.
6. Simulate the sound field inside the actual (non-rectangular) inner volume and show modes / standing waves, compared between versions.
7. Design the dual (sound-lock) door: outer door in the shell, inner door in the liner, with hinges, seals, latches, opening direction and how it connects to the box.
8. Produce a cut list and true-scale printable drawings that follow build order.
9. Save designs locally; export and import designs as JSON.

## Non-goals (v1)

- Accounts, cloud sync, sharing links. Local storage plus JSON files only.
- Facets split both ways on one wall (a grid of tiles). One split axis per wall in v1.
- Structural engineering (load, racking strength).
- Mobile phone layouts. Desktop first; must remain usable on a tablet-width screen but not optimised for phones.
- Modelling of the cab's own internal acoustics or the speaker's electrical behaviour.

## Anti-goals (would make it a failure even if it technically works)

- **A cut list that doesn't build.** If parts don't close up geometrically (a facet that's 2 mm short, a door frame that doesn't fit the opening), the tool has failed. Every dimension in the cut list must be derived from the same geometry model the views show.
- **Estimates presented as facts.** Acoustic and transmission-loss numbers are estimates and must be labelled as such. The tool must say what model produced them.
- **Slow tweaking.** If changing a slider means waiting a long time to see the effect, the compare loop dies. Geometry updates must be instant; acoustic results should refresh within a few seconds with a visible "up to date / running / stale" status.
- **Decorative UI.** It doesn't need to be beautiful or colourful; it needs to be usable.

## Constraints

- Static site, GitHub Pages. No server. All computation in the browser.
- Cab sits loose in the box and must be removable and interchangeable with other cabs. Inner space and door opening must accommodate the cab plus clearance.
- Sheet sizes, thicknesses, saw kerf, max bevel angle and hardware are shop-dependent: all user-defined in **Shop settings**, never hardcoded.

## Decided by the owner

### Layout
Step tabs following build order (mockup: `assets/interior-step-mockup.html`, open in a browser; it is interactive):

1. **Cab**: cab size and box dimensions
2. **Walls**: layer stacks, air gap, transmission loss
3. **Interior**: facet tilts, extra panels, acoustic treatment
4. **Doors**: dual door design
5. **Acoustics**: full simulation results and comparison
6. **Cut list**: cut list, sheet layout, drawings

Persistent elements: top bar (design, version, "save as new version", compare-with version, units mm/in), the step tabs, a main view area (plan/front/side section views plus 3D), and a bottom **mode strip** visible on every step that summarises the strongest modes of the current version vs the compare version and simulation status.

Visual direction approved as shown in the mockup: light theme, warm-tinted neutrals, one muted accent (orange) used only for selection/current state, tabular numerals, system font. Plain and dense, not colourful.

### Step 1: Cab and box dimensions
- A design holds a **list of cabs** (name, W × H × D, speaker count and layout, closed/open back). The tool shows for each cab whether it fits the inner space and passes through the door opening. One cab is chosen as the one the simulation uses.
- The user chooses the driving side: **inside-out** (enter inner box, or cab size + clearance; outer is computed) or **outside-in** (enter outer box; inner is computed). The non-driving side is read-only.
- Switching mode keeps current numbers (no jump).
- "Cab + clearance" in inside-out mode uses the cab the user picks as the sizing cab (default: the largest). Outside-in shows per cab whether it still fits.
- Facet tilts (step 3) consume inner space; inside-out grows the outer box if needed to keep the cab clearance, outside-in shows reduced free space instead.

### Step 2: Walls
- Each wall is a stack of layers listed outside-in (e.g. 18 mm ply, 6 mm MLV, 18 mm MDF). Layer = material + thickness.
- **Air gap** is an optional layer with a width and a decoupling method (e.g. rubber isolation strips, resilient clips). When on, the build becomes shell + gap + inner liner; the liner is a separate box standing off the shell. This affects geometry, the cut list and transmission loss.
- **Transmission loss estimate per wall stack**, shown per frequency, including the mass-air-mass resonance dip when an air gap is used.
- **Allowed escape:** the user sets how much sound may escape and the tool shows the margin per frequency band (see calls below for the input form).
- **Corner joints are a user choice** (e.g. butt joint with sides running past top/bottom, butt with top/bottom running past, rebate, mitre). The choice drives every part dimension in the cut list.

### Step 3: Interior
- Pick a wall from an unfolded box net (front/door side excluded; handled in step 4). Each wall shows its facet count.
- Split the selected wall's inner face into N facets along **depth or height** (one axis per wall). Each facet has its own **width, tilt angle and hinge edge**. Widths are **independent and need not be equal** (e.g. 2 facets at 120 + 240 mm); "Split evenly" is only a helper. Editing one width offers to rebalance its neighbour so the total stays correct. Widths must sum to the wall length (warn if not).
- Tilts change **inner faces only**; the outer shell stays square.
- Gaps a tilted facet leaves (the step where it meets a neighbouring facet, wedges at its ends) are closed either with **filler strips** (generated as cut-list parts) or with **sealant** (no parts; drawing note plus a sealant bead length). User chooses.
- Extra inner panels, each with or without insulation, positioned in the box.
- Acoustic treatment on any surface, from a user-editable material library.
- Readout of narrowest free space vs cab.

### Step 4: Doors
- Door goes on front, left or right side.
- Always **dual door, sound-lock style**: outer door and inner door, each sealing independently.
  - With the air gap on: outer door in the shell, inner door in the liner.
  - With the air gap off: the inner door closes into a frame set in a deep rebate in the same wall.
  - The space between the two doors is either an air gap or filled with insulation (user choice, either wall mode).
- Per door: **opening direction** (inwards, outwards, split into two leaves), **framed or frameless**, hinge side and hinge type, seal, latches.
- Tool checks swing collisions (e.g. inner door opening outwards vs outer door's hinges and the gap), shows swing arcs on the plan view, and checks the cab fits through the finished opening.
- Each door panel is its own layer stack (defaults to matching its wall).
- Output: door panel sizes, rebate depths, frame pieces, hinge positions from edges, latch positions.

### Step 5: Acoustics
- Simulate the sound field inside the real inner volume: angled facets, extra panels, treatment, and the cab itself as an obstacle.
- Absorption for any material is user-input so it reflects real materials.
- Purpose is comparison: overlay current vs compare version.

### Step 6: Cut list and drawings
- Shop settings: available sheet sizes/thicknesses per material, kerf, max bevel angle, min part size, hardware list. Set once, reused across designs.
- Cut list: every part numbered and named (shell, liner, facets, packers, battens, inner panels, door panels, frames), with material, thickness, L × W, edge bevels, quantity, build step.
- Drawings that can be followed, part numbers matching the cut list.

### Persistence
- Saved locally in the browser, with named versions per design.
- Export / import a design as a JSON file.

## Calls made by Claude (owner to check)

- **Tech stack:** TypeScript + Vite, static build deployed to GitHub Pages via GitHub Actions. Three.js for the 3D view. 2D section views and drawings as SVG. Acoustic simulation in a Web Worker. No UI framework mandated; builder may pick a light one if it earns its place.
- **Door side suggestion:** the tool suggests the side giving the smallest opening the cab can still be removed through; the user can override.
- **Allowed escape input:** user enters the sound level inside the box (default a flat 115 dB SPL, editable per octave band) and a target outside level (default 60 dB SPL). Margin per band = inside level − TL − target. Positive = OK, negative = flagged.
- **Material library:** user-editable, seeded with common materials (plywood, MDF, OSB, MLV, rockwool, acoustic foam, carpet, rubber). Each material has density, available thicknesses, stiffness (Young's modulus, for TL coincidence), and absorption coefficients per octave band (125, 250, 500, 1k, 2k, 4k Hz). Seed values are typical published figures and labelled "edit to match your product".
- **Default stack:** all walls share one stack; individual walls may override (e.g. heavier back, thinner top).
- **Facet tilt range:** 0 to 20° per facet, 0.5° steps, numeric entry allowed for finer values. Max facets per wall: 8.
- **Facet construction:** a facet is a panel hinged against the wall at its hinge edge and packed out at the free edge; packing depth = width × tan(tilt). Packers/battens appear in the cut list.
- **Hinge, seal and latch catalogue:** a short editable list (butt, piano, lift-off hinges; compression seal tape on rebated edges; toggle clamps / compression latches), each with the offsets and cutouts the geometry needs.
- **Drawings:** true scale, generated as SVG, printed to PDF through the browser's print dialog using print CSS, one sheet per build step in assembly order: shell, air gap + liner, facets, inner panels, treatment, frames + doors. Section views on screen may exaggerate depth for visibility; printed drawings never do.
- **Sheet layout:** cut list includes a nesting of parts onto shop sheet sizes (guillotine cuts, kerf-aware) with sheet count and waste %.
- **Bevel limits:** if a required bevel exceeds the shop's max bevel, the part is flagged with an alternative (cut the complement, or build up with a packer strip).
- **Simulation approach (outline, details to builder):** time-domain finite-difference simulation on a voxel grid of the inner air volume. Grid spacing chosen from an upper frequency limit (default 1 kHz, user adjustable up to ~2 kHz) at ≥10 cells per wavelength. A cab-sized box at 1 kHz is on the order of tens of thousands of cells, which is feasible in a worker within seconds.
  - Source: point sources at the selected cab's speaker positions (speaker count/layout from step 1; 1x12 up to 6x12).
  - Cab modelled as a rigid closed obstacle by default, with an "open back" option.
  - Surfaces get frequency-dependent absorption from their material's octave-band coefficients; at minimum honoured per octave band.
  - Outputs: frequency response (spatially averaged over the air volume, and at user-placeable probe points), a mode list from peak picking (frequency, level, decay/Q, dominant axis where identifiable), and pressure-map slices at a chosen frequency.
  - Extra inner panels are thin rigid obstacles; insulation on/in a panel is treated as absorptive surface on its faces.
- **Validation:** for a plain rectangular box with rigid walls, simulated mode frequencies must match the analytic room-mode formula f = (c/2)·√((nx/Lx)² + (ny/Ly)² + (nz/Lz)²) within ~2% for the first 20 modes. The analytic list is also shown in step 5 as a reference for the untilted box.
- **Transmission loss model (outline):** per 1/3-octave band, 50 Hz to 5 kHz. Bonded layers combine as one leaf (summed surface mass, with coincidence from the stiffest layer). Air gap gives a double-leaf model (e.g. Sharp's method) with mass-air-mass resonance f₀ ≈ 60·√((m₁+m₂)/(m₁·m₂·d)) (m in kg/m², d in m), with cavity insulation and decoupling method affecting the result. Also show a single-number summary. Door leakage through seals is **not** modelled in v1; a note says doors and seals are usually the weak link.
- **Storage:** IndexedDB (or localStorage if small enough) for designs, versions, material library, shop settings. JSON export includes a schema version for future migrations. Import validates and rejects bad files with a readable error.
- **Units:** mm internally; inches as a display option.
- **Layer construction:** layers of a stack are laminated into one panel before assembly, so the corner joint applies to the laminated panel. MLV and other roll goods are listed as cut parts with a configurable overlap allowance. (Air-gap mode: shell and liner are separate laminated boxes, each with its own joints.)
- **Facet details:** facet width is measured along the wall. Facet panel material/thickness is chosen per wall (default 12 mm ply) and mounts on the innermost face (liner when air gap is on). The space behind a facet is filled with insulation by default, switchable to empty; the simulation treats the facet as the boundary either way.
- **Sound-escape margin:** computed for the whole box: area-weighted combined TL of all walls and doors, outside level at a user-set reference distance (default 1 m).
- **Simulation resolution:** a 1° tilt change on a 150 mm+ facet must change the result reliably (sub-cell boundary handling or locally refined grid; builder's choice). The UI states the smallest geometry change the current grid can resolve.
- **Air gap at the door opening:** closed with a soft decoupled gasket/surround between shell and liner; no rigid frame bridges the two.
- **Corner clashes:** where facets on adjacent walls meet at a corner and would intersect, the tool detects and flags the clash in the views. It does not auto-resolve.

## Left to the builder

- Exact FDTD scheme, boundary formulation for frequency-dependent absorption, grid sizing details and performance tuning, within the outline and validation target above.
- Exact TL formulas and band handling within the outline above.
- Data model and state management.
- 3D view interaction details (orbit, cut-away, exploded), as long as the selected wall and facets are highlighted and match the 2D views.
- Sheet nesting algorithm.
- Testing approach, with geometry, cut list closure, the analytic-mode validation, and TL against textbook examples as the critical checks.
- Component details for the steps not mocked up (Cab, Walls, Doors, Acoustics, Cut list), following the Interior mockup's visual language.
