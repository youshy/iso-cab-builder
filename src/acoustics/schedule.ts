import { computed, effect, signal } from '@preact/signals'
import { compareDesign, design, library, simCompare, simCurrent, sliceRequest } from '../model/store'
import { compareSimInput, defaultSlices, isDefaultSlice } from './compare'
import { createSimClient, simKey } from './client'
import type { SimSlice } from './fdtd'

const spawn = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

/** Two clients so the compare run never cancels the current one. */
export const currentClient = createSimClient(spawn)
export const compareClient = createSimClient(spawn)
/** Runs for a user-chosen slice that the default set does not hold; never marks the main result stale. */
export const sliceClient = createSimClient(spawn, {
  cacheSize: 4,
  keyOf: (d, lib, opts) => simKey(d, lib, opts) + JSON.stringify(opts.slices),
})
export const customSlice = signal<SimSlice | null>(null)

const ignoreSuperseded = (e: unknown) => {
  if (!(e instanceof Error) || e.message !== 'superseded') console.error(e)
}

const simSettings = computed(() => JSON.stringify(design.value.sim))

/** Re-run the simulation whenever something it reads changes. Returns a function that stops it. */
export function startSimScheduling(): () => void {
  const stopCurrent = effect(() => {
    const d = design.value
    const lib = library.value
    currentClient
      .request(d, lib, { fMax: d.sim.fMax, slices: defaultSlices(d, d.sim.fMax) })
      .then((r) => { simCurrent.value = r })
      .catch(ignoreSuperseded)
  })
  const stopSlice = effect(() => {
    const d = design.value
    const lib = library.value
    const req = sliceRequest.value
    customSlice.value = null
    if (!req || isDefaultSlice(d, req, d.sim.fMax)) return
    sliceClient
      .request(d, lib, { fMax: d.sim.fMax, slices: [req] })
      .then((r) => { customSlice.value = r.slices[0] ?? null })
      .catch(ignoreSuperseded)
  })
  const stopCompare = effect(() => {
    const cmp = compareDesign.value
    simSettings.value // only the sim settings of the current design matter here
    const lib = library.value
    simCompare.value = null // never show deltas against an older compare run
    if (!cmp) return
    const { d, opts } = compareSimInput(design.peek(), cmp)
    compareClient.request(d, lib, opts).then((r) => { simCompare.value = r }).catch(ignoreSuperseded)
  })
  return () => { stopCurrent(); stopSlice(); stopCompare() }
}
