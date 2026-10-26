import { useRef } from 'preact/hooks'

let counter = 0

export type RowIds = {
  /** One stable id per row, same order as the rows. */
  ids: number[]
  /** Call after a row was inserted at `i`. */
  inserted: (i: number) => void
  /** Call after row `i` was removed. */
  removed: (i: number) => void
  /** Call after rows `i` and `j` swapped places. */
  swapped: (i: number, j: number) => void
}

/** Stable keys for an editable list, so per-row state stays with its row across add, remove and move. */
export function useRowIds(n: number): RowIds {
  const ref = useRef<number[]>([])
  const ids = ref.current
  while (ids.length < n) ids.push(counter++)
  ids.length = n
  return {
    ids,
    inserted: (i) => void ids.splice(i, 0, counter++),
    removed: (i) => void ids.splice(i, 1),
    swapped: (i, j) => void ([ids[i], ids[j]] = [ids[j], ids[i]]),
  }
}
