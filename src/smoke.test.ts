import { expect, test } from 'vitest';
import { STEPS } from './ui/StepTabs';

test('steps are in the expected order', () => {
  expect(STEPS.map((s) => s.id)).toEqual(['cab', 'walls', 'interior', 'doors', 'acoustics', 'cutlist']);
});
