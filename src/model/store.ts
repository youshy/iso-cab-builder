import { computed, signal } from '@preact/signals'
import { DesignSchema, LibrarySchema } from './schema'
import type { ZodError } from 'zod'
import type { Design, Library, Project, Shop } from './schema'
import { defaultDesign, defaultLibrary, defaultShop, newId } from './defaults'
import { createStore } from '../storage/local'
import { resolveDims } from '../geometry/dimensions'
import { rescaleInteriors } from './interiorEdit'
import type { SimResult } from '../acoustics/fdtd'
import type { Axis } from './schema'

export type Units = 'mm' | 'in'
type Backend = Parameters<typeof createStore>[0]

const MM_PER_IN = 25.4

/** Number text without a unit suffix: whole mm or 1-decimal inches. */
export function formatNumber(mm: number, units: Units): string {
  return units === 'in' ? (mm / MM_PER_IN).toFixed(1) : String(Math.round(mm))
}

export function formatLength(mm: number, units: Units): string {
  return `${formatNumber(mm, units)} ${units}`
}

/** Parse user text in the given units to mm. Returns null when it is not a finite number. */
export function parseLength(text: string, units: Units): number | null {
  const t = text.trim().replace(',', '.').replace(/\s*(mm|in|")$/i, '')
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  const v = Number(t)
  if (!Number.isFinite(v)) return null
  return Math.round((units === 'in' ? v * MM_PER_IN : v) * 100) / 100
}

/** Switch the driving side without changing any resolved number. */
export function setDimMode(d: Design, mode: Design['dims']['mode']): void {
  if (d.dims.mode === mode) return
  const r = resolveDims(d)
  if (mode === 'outside') {
    d.dims.outer = { ...r.outer }
  } else {
    d.dims.inner = { ...r.inner }
    d.dims.innerSource = 'manual'
  }
  d.dims.mode = mode
}

/** Switch between sizing the inside from a cab and typing it, keeping the current inner box. */
export function setInnerSource(d: Design, source: Design['dims']['innerSource']): void {
  if (d.dims.innerSource === source) return
  if (source === 'manual' && d.dims.mode === 'inside') d.dims.inner = { ...resolveDims(d).inner }
  d.dims.innerSource = source
}

function bootBackend(): Backend {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createAppStore(backend: Backend) {
  const storage = createStore(backend)

  let loaded = storage.loadProjects()
  if (loaded.length === 0) {
    loaded = [
      {
        id: newId(),
        name: 'My iso cab',
        versions: [{ version: 1, savedAt: new Date().toISOString(), design: defaultDesign() }],
      },
    ]
    storage.saveProject(loaded[0])
  }

  const library = signal<Library>(storage.loadLibrary() ?? defaultLibrary())
  const shop = signal<Shop>(storage.loadShop() ?? defaultShop())
  const projects = signal<Project[]>(loaded)
  const projectId = signal<string>(loaded[0].id)
  const units = signal<Units>('mm')
  const compareVersion = signal<number | null>(null)
  /** Latest simulation results; the scheduler fills them. Kept while a newer run is pending. */
  const simCurrent = signal<SimResult | null>(null)
  const simCompare = signal<SimResult | null>(null)
  /** Pressure slice the Acoustics step wants computed with the run; null until it is opened. */
  const sliceRequest = signal<{ axis: Axis; at: number; f: number } | null>(null)
  const saveWarning = signal<string | null>(null)
  /** Short message for the last rejected edit; clears itself after 4 s or on the next good edit. */
  const editError = signal<string | null>(null)
  let errorTimer: ReturnType<typeof setTimeout> | undefined

  function rejectEdit(error: ZodError): void {
    const i = error.issues[0]
    editError.value = `Change not applied: ${i.path.length ? `${i.path.join('.')} ` : ''}${i.message}`
    clearTimeout(errorTimer)
    errorTimer = setTimeout(() => (editError.value = null), 4000)
  }
  function clearEditError(): void {
    clearTimeout(errorTimer)
    editError.value = null
  }

  const latest = (p: Project) => p.versions[p.versions.length - 1]
  const currentProject = computed(() => projects.value.find((p) => p.id === projectId.value) ?? projects.value[0])
  const design = signal<Design>(structuredClone(loaded[0].working ?? latest(loaded[0]).design))
  /** Saved version the working copy was started from, or null when unknown. */
  const basedOn = signal<number | null>(loaded[0].working ? null : latest(loaded[0]).version)

  const compareDesign = computed<Design | null>(() => {
    const n = compareVersion.value
    if (n === null) return null
    return currentProject.value.versions.find((v) => v.version === n)?.design ?? null
  })

  function persist(p: Project) {
    projects.value = projects.value.map((x) => (x.id === p.id ? p : x))
    const ok = storage.saveProject(p)
    saveWarning.value = ok && storage.ok ? null : 'Not saved: browser storage unavailable'
  }

  function update(fn: (d: Design) => void): void {
    const next = structuredClone(design.value)
    fn(next)
    rescaleInteriors(design.value, next)
    const parsed = DesignSchema.safeParse(next)
    if (!parsed.success) {
      rejectEdit(parsed.error)
      return
    }
    clearEditError()
    design.value = next
    const p = currentProject.value
    persist({ ...p, working: structuredClone(next) })
  }

  function saveVersion(): number {
    const p = currentProject.value
    const n = Math.max(0, ...p.versions.map((v) => v.version)) + 1
    persist({
      ...p,
      versions: [...p.versions, { version: n, savedAt: new Date().toISOString(), design: structuredClone(design.value) }],
      working: structuredClone(design.value),
    })
    basedOn.value = n
    return n
  }

  function loadVersion(n: number): void {
    const v = currentProject.value.versions.find((x) => x.version === n)
    if (!v) return
    design.value = structuredClone(v.design)
    basedOn.value = n
    persist({ ...currentProject.value, working: structuredClone(v.design) })
  }

  function selectProject(id: string): void {
    const p = projects.value.find((x) => x.id === id)
    if (!p) return
    projectId.value = id
    compareVersion.value = null
    design.value = structuredClone(p.working ?? latest(p).design)
    basedOn.value = p.working ? null : latest(p).version
  }

  function addProject(p: Project): void {
    projects.value = [...projects.value, p]
    persist(p)
    selectProject(p.id)
  }

  function newProject(): void {
    const n = projects.value.length + 1
    addProject({
      id: newId(),
      name: `Design ${n}`,
      versions: [{ version: 1, savedAt: new Date().toISOString(), design: defaultDesign() }],
    })
  }

  function setLibrary(l: Library): void {
    library.value = l
    if (!storage.saveLibrary(l)) saveWarning.value = 'Not saved: browser storage unavailable'
  }

  /** Edit the library; invalid results are rejected with an edit error. Returns whether it applied. */
  function updateLibrary(fn: (l: Library) => void): boolean {
    const next = structuredClone(library.value)
    fn(next)
    const parsed = LibrarySchema.safeParse(next)
    if (!parsed.success) {
      rejectEdit(parsed.error)
      return false
    }
    clearEditError()
    setLibrary(next)
    return true
  }

  return {
    library, shop, projects, projectId, design, compareVersion, units, saveWarning, editError,
    simCurrent, simCompare, sliceRequest, basedOn, currentProject, compareDesign,
    update, saveVersion, loadVersion, selectProject, addProject, newProject, setLibrary, updateLibrary,
    fmtLen: (mm: number) => formatLength(mm, units.value),
    fmtNum: (mm: number) => formatNumber(mm, units.value),
    parseLen: (text: string) => parseLength(text, units.value),
  }
}

export const app = createAppStore(bootBackend())
export const {
  library, shop, projects, projectId, design, compareVersion, units, saveWarning, editError,
  simCurrent, simCompare, sliceRequest, basedOn, currentProject, compareDesign,
  update, saveVersion, loadVersion, selectProject, addProject, newProject, setLibrary, updateLibrary,
  fmtLen, fmtNum, parseLen,
} = app
