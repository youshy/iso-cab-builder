import { computed, signal } from '@preact/signals'
import { buildParts, type BuildStep } from '../../cutlist/parts'
import { nest } from '../../cutlist/nesting'
import { buildWeight } from '../../cutlist/weight'
import { buildSheets } from '../../drawings/sheets'
import { basedOn, compareDesign, design, library, shop } from '../../model/store'

export const STEP_LABEL: Record<BuildStep, string> = {
  shell: 'Shell',
  middle: 'Middle boxes',
  liner: 'Liner',
  facets: 'Facets',
  panels: 'Panels',
  treatment: 'Treatment',
  doors: 'Doors',
}

export const built = computed(() => buildParts(design.value, library.value, shop.value))
export const nested = computed(() => nest(built.value.parts, shop.value))
export const weight = computed(() => buildWeight(design.value, library.value, shop.value))
export const weightCompare = computed(() => {
  const c = compareDesign.value
  return c ? buildWeight(c, library.value, shop.value) : null
})
export const sheets = computed(() =>
  buildSheets(design.value, library.value, built.value.parts, {
    version: basedOn.value === null ? undefined : `working copy (from v${basedOn.value})`,
  }),
)

export const matName = (id: string) => library.value.materials.find((m) => m.id === id)?.name ?? id

/** Which output the print stylesheet should show; null when not printing. */
export type PrintOutput = 'drawings' | 'cutlist'
export const printOutput = signal<PrintOutput | null>(null)

/** Show only `what` on paper, open the print dialog, then restore the screen. */
export function printOnly(what: PrintOutput): void {
  printOutput.value = what
  document.body.dataset.print = what
  const done = () => {
    printOutput.value = null
    delete document.body.dataset.print
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  // Let the print tree render before the dialog snapshots the page.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
}
