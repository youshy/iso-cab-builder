import { useState } from 'preact/hooks';
import { STEPS, StepTabs, type StepId } from './StepTabs';
import { TopBar } from './TopBar';
import { CabStep } from './steps/CabStep';
import { WallsStep } from './steps/WallsStep';
import { InteriorStep } from './steps/InteriorStep';
import { DoorsStep } from './steps/DoorsStep';
import { MaterialLibrary, libraryOpen } from './library/MaterialLibrary';
import { editError } from '../model/store';
import { ModeStrip } from './ModeStrip';
import { AcousticsStep } from './steps/AcousticsStep';
import { CutListStep } from './steps/CutListStep';
import { ShopSettings, shopOpen } from './library/ShopSettings';
import { PrintRoot } from './cutlist/PrintRoot';

export function App() {
  const [step, setStep] = useState<StepId>('cab');
  const label = STEPS.find((s) => s.id === step)?.label ?? '';
  return (
    <>
      <div>
        <TopBar />
        {editError.value && <div class="editerr" role="alert">{editError.value}</div>}
      </div>
      <StepTabs current={step} onSelect={setStep} />
      <div class={`main ${libraryOpen.value ? 'lib-open' : shopOpen.value ? 'lib-open shop-open' : ''}`}>
        {libraryOpen.value ? <MaterialLibrary /> : shopOpen.value && <ShopSettings />}
        {step === 'cab' ? (
          <CabStep />
        ) : step === 'walls' ? (
          <WallsStep />
        ) : step === 'interior' ? (
          <InteriorStep />
        ) : step === 'doors' ? (
          <DoorsStep />
        ) : step === 'acoustics' ? (
          <AcousticsStep />
        ) : step === 'cutlist' ? (
          <CutListStep />
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
      <ModeStrip onOpenAcoustics={() => setStep('acoustics')} />
      <PrintRoot />
    </>
  );
}
