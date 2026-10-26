export function Seg<T extends string>({ value, options, onPick, label }: { value: T; options: [T, string][]; onPick: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button type="button" key={v} class={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}
