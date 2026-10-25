import { computed, signal } from '@preact/signals'
import { DesignSchema } from './schema'
import type { Design, Library, Project, Shop } from './schema'
import { defaultDesign, defaultLibrary, defaultShop, newId } from './defaults'
import { createStore } from '../storage/local'
import { resolveDims } from '../geometry/dimensions'

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
  const saveWarning = signal<string | null>(null)

  const latest = (p: Project) => p.versions[p.versions.length - 1]
  const currentProject = computed(() => projects.value.find((p) => p.id === projectId.value) ?? projects.value[0])
  const design = signal<Design>(structuredClone(latest(loaded[0]).design))
  /** Version number the working copy autosaves into. */
  const editingVersion = signal<number>(latest(loaded[0]).version)

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
    const parsed = DesignSchema.safeParse(next)
    if (!parsed.success) {
      console.warn('Rejected invalid design change:', parsed.error.issues[0])
      return
    }
    design.value = next
    const p = currentProject.value
    persist({
      ...p,
      versions: p.versions.map((v) => (v.version === editingVersion.value ? { ...v, design: structuredClone(next) } : v)),
    })
  }

  function saveVersion(): number {
    const p = currentProject.value
    const n = Math.max(0, ...p.versions.map((v) => v.version)) + 1
    persist({ ...p, versions: [...p.versions, { version: n, savedAt: new Date().toISOString(), design: structuredClone(design.value) }] })
    editingVersion.value = n
    return n
  }

  function loadVersion(n: number): void {
    const v = currentProject.value.versions.find((x) => x.version === n)
    if (!v) return
    design.value = structuredClone(v.design)
    editingVersion.value = n
  }

  function selectProject(id: string): void {
    const p = projects.value.find((x) => x.id === id)
    if (!p) return
    projectId.value = id
    compareVersion.value = null
    design.value = structuredClone(latest(p).design)
    editingVersion.value = latest(p).version
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

  return {
    library, shop, projects, projectId, design, compareVersion, units, saveWarning,
    editingVersion, currentProject, compareDesign,
    update, saveVersion, loadVersion, selectProject, addProject, newProject, setLibrary,
    fmtLen: (mm: number) => formatLength(mm, units.value),
    fmtNum: (mm: number) => formatNumber(mm, units.value),
    parseLen: (text: string) => parseLength(text, units.value),
  }
}

export const app = createAppStore(bootBackend())
export const {
  library, shop, projects, projectId, design, compareVersion, units, saveWarning,
  editingVersion, currentProject, compareDesign,
  update, saveVersion, loadVersion, selectProject, addProject, newProject, setLibrary,
  fmtLen, fmtNum, parseLen,
} = app
