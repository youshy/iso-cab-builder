import { useState } from 'preact/hooks';
import { STEPS, StepTabs, type StepId } from './StepTabs';
import { TopBar } from './TopBar';
import { CabStep } from './steps/CabStep';

export function App() {
  const [step, setStep] = useState<StepId>('cab');
  const label = STEPS.find((s) => s.id === step)?.label ?? '';
  return (
    <>
      <TopBar />
      <StepTabs current={step} onSelect={setStep} />
      <div class="main">
        {step === 'cab' ? (
          <CabStep />
        ) : (
          <>
            <aside>
              <h3>{label}</h3>
              <p class="hint">Controls for this step will appear here.</p>
            </aside>
            <section class="stage">
              <div class="placeholder3d">Views will appear here.</div>
            </section>
          </>
        )}
      </div>
      <footer class="modes">
        <div class="status">Simulation not run yet</div>
        <div class="mlist num" />
        <div class="legend" />
      </footer>
    </>
  );
}
