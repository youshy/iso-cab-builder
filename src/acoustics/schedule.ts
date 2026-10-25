import { computed, effect } from '@preact/signals'
import { compareDesign, design, library, simCompare, simCurrent, sliceRequest } from '../model/store'
import { compareSimInput } from './compare'
import { createSimClient } from './client'

const spawn = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

/** Two clients so the compare run never cancels the current one. */
export const currentClient = createSimClient(spawn)
export const compareClient = createSimClient(spawn)

const ignoreSuperseded = (e: unknown) => {
  if (!(e instanceof Error) || e.message !== 'superseded') console.error(e)
}

const simSettings = computed(() => JSON.stringify(design.value.sim))

/** Re-run the simulation whenever something it reads changes. Returns a function that stops it. */
export function startSimScheduling(): () => void {
  const stopCurrent = effect(() => {
    const d = design.value
    const lib = library.value
    const slice = sliceRequest.value
    currentClient
      .request(d, lib, { fMax: d.sim.fMax, slices: slice ? [slice] : undefined })
      .then((r) => { simCurrent.value = r })
      .catch(ignoreSuperseded)
  })
  const stopCompare = effect(() => {
    const cmp = compareDesign.value
    simSettings.value // only the sim settings of the current design matter here
    const lib = library.value
    if (!cmp) {
      simCompare.value = null
      return
    }
    const { d, opts } = compareSimInput(design.peek(), cmp)
    compareClient.request(d, lib, opts).then((r) => { simCompare.value = r }).catch(ignoreSuperseded)
  })
  return () => { stopCurrent(); stopCompare() }
}
