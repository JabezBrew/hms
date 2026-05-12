import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAssistantApi } from '../aiAssistant';

describe('Rust V2 AI assistant deferral', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('fails closed for every AI assistant surface instead of calling legacy endpoints', async () => {
    const deferredMessage = 'AI assistant features are intentionally deferred in Rust V2';
    const calls = [
      () => aiAssistantApi.parseOmniIntent({ text: 'find patient' }),
      () => aiAssistantApi.executeOmniPreview({ text: 'find patient', intent: { kind: 'search' } }),
      () => aiAssistantApi.interpretLabResult({ resultId: 'result-1' }),
      () => aiAssistantApi.interpretLabOrder({ orderId: 'order-1' }),
      () => aiAssistantApi.summarizeChronicle({ patientId: 'patient-1' }),
      () => aiAssistantApi.askChronicle({ patientId: 'patient-1', question: 'What changed?' }),
      () => aiAssistantApi.generateNoteDraft({
        patientId: 'patient-1',
        templateId: 'template-1',
        templateRevisionId: 'revision-1',
      }),
      () => aiAssistantApi.lintNoteDraft({
        patientId: 'patient-1',
        templateId: 'template-1',
        templateRevisionId: 'revision-1',
        noteData: { subjective: 'Improved' },
      }),
    ];

    await Promise.all(
      calls.map(async (call) => {
        await expect(call()).rejects.toThrow(deferredMessage);
      }),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
