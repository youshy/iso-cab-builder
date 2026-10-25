export type StepId = 'cab' | 'walls' | 'interior' | 'doors' | 'acoustics' | 'cutlist';

export const STEPS: { id: StepId; label: string }[] = [
  { id: 'cab', label: 'Cab' },
  { id: 'walls', label: 'Walls' },
  { id: 'interior', label: 'Interior' },
  { id: 'doors', label: 'Doors' },
  { id: 'acoustics', label: 'Acoustics' },
  { id: 'cutlist', label: 'Cut list' },
];

export function StepTabs({ current, onSelect }: { current: StepId; onSelect: (id: StepId) => void }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <nav class="steps" aria-label="Steps">
      {STEPS.map((s, i) => {
        const cls = i === currentIndex ? 'on' : i < currentIndex ? 'done' : '';
        return (
          <button
            type="button"
            key={s.id}
            class={`step ${cls}`}
            aria-current={i === currentIndex ? 'step' : undefined}
            onClick={() => onSelect(s.id)}
          >
            <span class="n">{i < currentIndex ? '✓' : i + 1}</span>
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
