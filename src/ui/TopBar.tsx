import { computed } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  addProject, compareDesign, compareVersion, currentProject, basedOn, design, library, loadVersion, newProject, projectId,
  projects, saveVersion, saveWarning, selectProject, setLibrary, shop, units,
} from '../model/store'
import { buildWeight } from '../cutlist/weight'
import { libraryOpen } from './library/MaterialLibrary'
import { openShop, shopOpen } from './library/ShopSettings'
import { download } from './download'
import { exportProject, importProject } from '../storage/io'

const weightKg = computed(() => buildWeight(design.value, library.value, shop.value).totalKg)
/** Weight change against the compared version, or null with no comparison. */
const weightDelta = computed(() => {
  const cmp = compareDesign.value
  if (!cmp) return null
  return Math.round((weightKg.value - buildWeight(cmp, library.value, shop.value).totalKg) * 10) / 10
})

export function TopBar() {
  const [importError, setImportError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const away = (e: Event) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [moreOpen])
  const project = currentProject.value
  const versions = [...project.versions].sort((a, b) => b.version - a.version)
  const nextVersion = Math.max(...project.versions.map((v) => v.version)) + 1

  async function onImport(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const res = importProject(await file.text(), library.value)
    if (!res.ok) {
      setImportError(`Import failed: ${res.error}`)
      return
    }
    setImportError(null)
    setLibrary(res.library)
    addProject(res.project)
  }

  function toggleShop() {
    if (shopOpen.value) shopOpen.value = false
    else openShop()
    setMoreOpen(false)
  }
  const kg = weightKg.value
  const delta = weightDelta.value

  return (
    <header class="top">
      <b>ISO Cab Builder</b>
      <div class="ctl">
        Design
        <select aria-label="Design" value={projectId.value} onChange={(e) => selectProject((e.target as HTMLSelectElement).value)}>
          {projects.value.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div class="ctl">
        Version
        <select
          class="num"
          aria-label="Version"
          value="working"
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            if (v !== 'working') loadVersion(Number(v))
          }}
        >
          <option value="working">{basedOn.value === null ? 'Editing' : `Editing (from v${basedOn.value})`}</option>
          {versions.map((v) => (
            <option key={v.version} value={String(v.version)}>Load v{v.version}</option>
          ))}
        </select>
      </div>
      <button type="button" class="btn" onClick={() => saveVersion()}>Save as v{nextVersion}</button>
      {saveWarning.value && <span class="err">{saveWarning.value}</span>}
      {importError && <span class="err" role="alert">{importError}</span>}
      <span class="num" title="Estimated build weight (excluding cab)">
        ≈ {kg} kg
        {delta !== null && ` (Δ ${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} kg vs v${compareVersion.value})`}
      </span>
      <div class="sp" />
      <div class="ctl">
        Compare with
        <select
          aria-label="Compare with"
          value={compareVersion.value === null ? '' : String(compareVersion.value)}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            compareVersion.value = v === '' ? null : Number(v)
          }}
        >
          <option value="">none</option>
          {versions.map((v) => (
            <option key={v.version} value={String(v.version)}>v{v.version}</option>
          ))}
        </select>
      </div>
      <div class="ctl">
        Units
        <select aria-label="Units" value={units.value} onChange={(e) => (units.value = (e.target as HTMLSelectElement).value as 'mm' | 'in')}>
          <option value="mm">mm</option>
          <option value="in">in</option>
        </select>
      </div>
      <div class="more" ref={moreRef}>
        <button type="button" class="btn" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          More ▾
        </button>
        <div class={`menu ${moreOpen ? 'open' : ''}`} role="menu">
          <button type="button" role="menuitem" onClick={() => { newProject(); setMoreOpen(false) }}>New design</button>
          <button type="button" role="menuitem" aria-pressed={libraryOpen.value} onClick={() => { libraryOpen.value = !libraryOpen.value; setMoreOpen(false) }}>
            Materials
          </button>
          <button type="button" role="menuitem" aria-pressed={shopOpen.value} onClick={toggleShop}>
            Shop settings
          </button>
          <button type="button" role="menuitem" onClick={() => { download(`${project.name}.isocab.json`, exportProject(project, library.value)); setMoreOpen(false) }}>
            Export design
          </button>
          <button type="button" role="menuitem" onClick={() => importRef.current?.click()}>Import design</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => { setMoreOpen(false); onImport(e) }} />
        </div>
      </div>
    </header>
  )
}
