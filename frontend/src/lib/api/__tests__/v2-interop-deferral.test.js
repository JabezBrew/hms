import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { interopApi } from '../interop';

describe('Rust V2 interop deferral', () => {
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

  it('does not create interop exports through legacy endpoints in Rust V2 mode', async () => {
    await expect(interopApi.createExport({ patient_id: 'patient-1' })).rejects.toThrow(
      'Interop/FHIR export is intentionally deferred in Rust V2',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not retrieve interop exports through legacy endpoints in Rust V2 mode', async () => {
    await expect(
      interopApi.retrieveExport({
        exportId: 'export-1',
        consentToken: 'consent-token',
        sourceFacilityCode: 'HMS',
      }),
    ).rejects.toThrow('Interop/FHIR export is intentionally deferred in Rust V2');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
