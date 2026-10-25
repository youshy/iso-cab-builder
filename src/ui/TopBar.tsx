import { useState } from 'preact/hooks'
import {
  addProject, compareVersion, currentProject, editingVersion, library, loadVersion, newProject, projectId,
  projects, saveVersion, saveWarning, selectProject, setLibrary, units,
} from '../model/store'
import { exportProject, importProject } from '../storage/io'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function TopBar() {
  const [importError, setImportError] = useState<string | null>(null)
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
      <button type="button" class="btn" onClick={newProject}>New design</button>
      <div class="ctl">
        Version
        <select
          class="num"
          aria-label="Version"
          value={String(editingVersion.value)}
          onChange={(e) => loadVersion(Number((e.target as HTMLSelectElement).value))}
        >
          {versions.map((v) => (
            <option key={v.version} value={String(v.version)}>
              v{v.version}{v.version === editingVersion.value ? ' (editing)' : ''}
            </option>
          ))}
        </select>
      </div>
      <button type="button" class="btn" onClick={() => saveVersion()}>Save as v{nextVersion}</button>
      {saveWarning.value && <span class="err">{saveWarning.value}</span>}
      {importError && <span class="err" role="alert">{importError}</span>}
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
      <button type="button" class="btn" onClick={() => download(`${project.name}.isocab.json`, exportProject(project, library.value))}>
        Export
      </button>
      <label class="btn">
        Import
        <input type="file" accept=".json,application/json" hidden onChange={onImport} />
      </label>
    </header>
  )
}
