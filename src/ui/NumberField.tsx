import { useRef, useState } from 'preact/hooks'
import { fmtNum, parseLen, units } from '../model/store'

type Props = {
  /** Value in mm (kind "length") or the plain number (kind "plain"). */
  value: number
  onCommit: (v: number) => void
  label?: string
  /** Accessible name when there is no visible label. */
  ariaLabel?: string
  kind?: 'length' | 'plain'
  /** Suffix for plain numbers, e.g. a degree sign. Length fields show the current unit. */
  suffix?: string
  /** Smallest accepted value (inclusive). */
  min?: number
  /** Length fields must be above 0 unless this is set. */
  allowZero?: boolean
  max?: number
  width?: number
}

/** Numeric input that commits on blur or Enter and restores the old value on bad input. */
export function NumberField({ value, onCommit, label, ariaLabel, kind = 'length', suffix, min, allowZero, max, width = 70 }: Props) {
  const [text, setText] = useState<string | null>(null)
  const cancelled = useRef(false)
  const shown = kind === 'length' ? fmtNum(value) : String(Math.round(value * 100) / 100)
  const unit = kind === 'length' ? units.value : (suffix ?? '')

  function commit() {
    const t = text
    setText(null)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (t === null || t === shown) return
    const v = kind === 'length' ? parseLen(t) : Number(t.trim().replace(',', '.'))
    if (v === null || !Number.isFinite(v) || t.trim() === '') return
    if ((min !== undefined && v < min) || (kind === 'length' && !allowZero && v <= 0) || (max !== undefined && v > max)) return
    onCommit(v)
  }

  const input = (
    <>
      <input
        type="text"
        inputMode="decimal"
        class="numfield num"
        style={{ width: `${width}px` }}
        aria-label={label ?? ariaLabel}
        value={text ?? shown}
        onFocus={(e) => {
          setText(shown)
          ;(e.target as HTMLInputElement).select()
        }}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          else if (e.key === 'Escape') {
            cancelled.current = true
            setText(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {unit && <span class="unit"> {unit}</span>}
    </>
  )
  return label ? (
    <label class="field">
      <span class="fl">{label}</span>
      {input}
    </label>
  ) : (
    input
  )
}
