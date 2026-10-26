import { computed } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  addProject, compareDesign, compareVersion, currentProject, basedOn, deleteProject, design, hasUnsavedChanges, library,
  loadVersion, newProject, projectId, projects, renameProject, saveVersion, saveWarning, selectProject, setLibrary, shop, units,
} from '../model/store'
import { buildWeight } from '../cutlist/weight'
import { libraryOpen } from './library/MaterialLibrary'
import { openShop, shopOpen } from './library/ShopSettings'
import { download } from './download'
import { exportFileName, exportProject, importProject } from '../storage/io'

const weightKg = computed(() => buildWeight(design.value, library.value, shop.value).totalKg)
/** Weight change against the compared version, or null with no comparison. */
const weightDelta = computed(() => {
  const cmp = compareDesign.value
  if (!cmp) return null
  return Math.round((weightKg.value - buildWeight(cmp, library.value, shop.value).totalKg) * 10) / 10
})

export function TopBar() {
  const [importError, setImportError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  /** A version waiting to load until the user decides what happens to unsaved edits. */
  const [pendingLoad, setPendingLoad] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
    setImportNote(res.notes.length ? `Imported. ${res.notes.join('; ')}.` : null)
    setLibrary(res.library)
    addProject(res.project)
  }

  function requestLoad(n: number) {
    if (hasUnsavedChanges.value) setPendingLoad(n)
    else loadVersion(n)
  }
  function finishLoad(mode: 'save' | 'discard') {
    if (pendingLoad !== null) loadVersion(pendingLoad, mode)
    setPendingLoad(null)
  }
  function commitRename() {
    if (renaming !== null) renameProject(project.id, renaming)
    setRenaming(null)
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
        {renaming === null ? (
          <select aria-label="Design" value={projectId.value} onChange={(e) => { setPendingLoad(null); setConfirmDelete(false); selectProject((e.target as HTMLSelectElement).value) }}>
            {projects.value.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : (
          <input
            class="text"
            aria-label="Design name"
            value={renaming}
            ref={(el) => el?.focus()}
            onInput={(e) => setRenaming((e.target as HTMLInputElement).value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        )}
      </div>
      <div class="ctl">
        Version
        <select
          class="num"
          aria-label="Version"
          value="working"
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value
            if (v !== 'working') requestLoad(Number(v))
            ;(e.target as HTMLSelectElement).value = 'working'
          }}
        >
          <option value="working">{basedOn.value === null ? 'Editing' : `Editing (from v${basedOn.value})`}</option>
          {versions.map((v) => (
            <option key={v.version} value={String(v.version)}>Load v{v.version}</option>
          ))}
        </select>
      </div>
      <button type="button" class="btn" onClick={() => { setPendingLoad(null); saveVersion() }}>Save as v{nextVersion}</button>
      {pendingLoad !== null && (
        <span class="confirm" role="alertdialog" aria-label="Unsaved changes">
          You have unsaved changes. Save them as v{nextVersion} first?
          <button type="button" class="btn primary" onClick={() => finishLoad('save')}>Save and load</button>
          <button type="button" class="btn" onClick={() => finishLoad('discard')}>Discard and load</button>
          <button type="button" class="btn" onClick={() => setPendingLoad(null)}>Cancel</button>
        </span>
      )}
      {confirmDelete && (
        <span class="confirm" role="alertdialog" aria-label="Delete design">
          Delete {project.name} and all its versions?
          <button type="button" class="btn danger" onClick={() => { deleteProject(project.id); setConfirmDelete(false) }}>Delete</button>
          <button type="button" class="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </span>
      )}
      {saveWarning.value && <span class="err">{saveWarning.value}</span>}
      {importError && <span class="err" role="alert">{importError}</span>}
      {importNote && (
        <span class="note" role="status">
          {importNote} <button type="button" class="btn link" onClick={() => setImportNote(null)}>OK</button>
        </span>
      )}
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
          <button type="button" role="menuitem" onClick={() => { setRenaming(project.name); setMoreOpen(false) }}>Rename design</button>
          <button type="button" role="menuitem" onClick={() => { setConfirmDelete(true); setMoreOpen(false) }}>Delete design</button>
          <button type="button" role="menuitem" aria-pressed={libraryOpen.value} onClick={() => { libraryOpen.value = !libraryOpen.value; setMoreOpen(false) }}>
            Materials
          </button>
          <button type="button" role="menuitem" aria-pressed={shopOpen.value} onClick={toggleShop}>
            Shop settings
          </button>
          <button type="button" role="menuitem" onClick={() => { download(exportFileName(project.name), exportProject(project, library.value)); setMoreOpen(false) }}>
            Export design
          </button>
          <button type="button" role="menuitem" onClick={() => importRef.current?.click()}>Import design</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => { setMoreOpen(false); onImport(e) }} />
        </div>
      </div>
    </header>
  )
}
