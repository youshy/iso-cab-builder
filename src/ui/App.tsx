import { useState } from 'preact/hooks';
import { STEPS, StepTabs, type StepId } from './StepTabs';

export function App() {
  const [step, setStep] = useState<StepId>('cab');
  const label = STEPS.find((s) => s.id === step)?.label ?? '';
  return (
    <>
      <header class="top">
        <b>ISO Cab Builder</b>
        <div class="sp" />
      </header>
      <StepTabs current={step} onSelect={setStep} />
      <div class="main">
        <aside>
          <h3>{label}</h3>
          <p class="hint">Controls for this step will appear here.</p>
        </aside>
        <section class="stage">
          <div class="placeholder3d">Views will appear here.</div>
        </section>
      </div>
      <footer class="modes">
        <div class="status">
          <span class="dot" />
          Simulation up to date
        </div>
        <div class="mlist num" />
        <div class="legend" />
      </footer>
    </>
  );
}
