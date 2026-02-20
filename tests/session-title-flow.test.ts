import { describe, it, expect } from 'vitest';
import { createTitleFlowHarness } from './support/session-title-harness';

describe('session title flow', () => {
  it('updates title after first user message when generator succeeds', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: '' });
    await harness.runFirstMessage('PPT');
    expect(harness.updatedTitle).toBe('');
  });

  it('does not update when generator fails', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: null });
    await harness.runFirstMessage('PPT');
    expect(harness.updatedTitle).toBe(null);
  });

  it('does not override manual title changes', async () => {
    const harness = createTitleFlowHarness({
      generatedTitle: '',
      latestTitle: '',
    });
    await harness.runFirstMessage('PPT');
    expect(harness.updatedTitle).toBe(null);
  });
});
