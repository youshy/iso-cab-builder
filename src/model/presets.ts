import type { Cab } from './schema'

export type SpeakerPreset = { id: string; label: string; cols: number; rows: number }

export const SPEAKER_PRESETS: SpeakerPreset[] = [
  { id: '1x12', label: '1x12', cols: 1, rows: 1 },
  { id: '2x12', label: '2x12 side by side', cols: 2, rows: 1 },
  { id: '2x12v', label: '2x12 vertical', cols: 1, rows: 2 },
  { id: '4x12', label: '4x12 (2 by 2)', cols: 2, rows: 2 },
  { id: '6x12', label: '6x12 (2 across, 3 high)', cols: 2, rows: 3 },
  { id: '6x12w', label: '6x12 wide (3 by 2)', cols: 3, rows: 2 },
]

const round1 = (n: number) => Math.round(n * 10) / 10

/** Speaker centres spread evenly over the cab's front face, row by row from the bottom. */
export function presetSpeakers(p: SpeakerPreset, cab: Pick<Cab, 'w' | 'h'>): Cab['speakers'] {
  const out: Cab['speakers'] = []
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.cols; c++) {
      out.push({ x: round1((cab.w * (c + 0.5)) / p.cols), y: round1((cab.h * (r + 0.5)) / p.rows) })
    }
  }
  return out
}

/** Preset whose layout equals the cab's current speakers, or null for a custom layout. */
export function matchPreset(cab: Pick<Cab, 'w' | 'h' | 'speakers'>): SpeakerPreset | null {
  for (const p of SPEAKER_PRESETS) {
    const s = presetSpeakers(p, cab)
    if (s.length === cab.speakers.length && s.every((q, i) => Math.abs(q.x - cab.speakers[i].x) < 0.6 && Math.abs(q.y - cab.speakers[i].y) < 0.6)) return p
  }
  return null
}

/**
 * Edit a cab. A speaker layout that matched a preset is re-fitted to the new size,
 * unless the edit set the speakers itself.
 */
export function applyCabEdit(cab: Cab, fn: (c: Cab) => void): void {
  const preset = matchPreset(cab)
  const before = cab.speakers
  fn(cab)
  if (preset && cab.speakers === before) cab.speakers = presetSpeakers(preset, cab)
}
