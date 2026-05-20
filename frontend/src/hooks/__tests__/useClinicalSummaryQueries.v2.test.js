import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchActiveMedications,
  fetchClinicalSummary,
  fetchRecentVitals,
} from '../useClinicalSummaryQueries';
import { fetchChronicleContext } from '../useChronicleContext';
import { apiClient } from '@/lib/api-client';

vi.mock('../useChronicleContext', () => ({
  fetchChronicleContext: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('Rust V2 clinical summary bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    apiClient.get.mockRejectedValue(new Error('legacy clinical summary endpoint should not be called'));
    fetchChronicleContext.mockResolvedValue({
      active_medications: [
        {
          id: 'rx-1',
          medication_name: 'Amlodipine',
          dose: '5 mg',
          frequency: 'daily',
          status: 'active',
          prescribed_at: '2026-05-12T08:30:00Z',
        },
      ],
      latest_vitals: {
        id: 'vitals-1',
        recorded_at: '2026-05-12T08:40:00Z',
        temperature: '37.2',
        heart_rate: '88',
      },
      active_problems: [
        {
          id: 'problem-1',
          label: 'Hypertension',
          status: 'active',
          created_at: '2026-05-12T08:10:00Z',
        },
      ],
    });
  });

  it('builds combined summary data from the Rust Chronicle context bridge', async () => {
    const signal = new AbortController().signal;

    const response = await fetchClinicalSummary('patient-1', 7, { signal });

    expect(fetchChronicleContext).toHaveBeenCalledWith('patient-1', { signal });
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(response).toEqual({
      medications: [
        expect.objectContaining({
          id: 'rx-1',
          medication_name: 'Amlodipine',
          dosage: '5 mg',
        }),
      ],
      vitals: [
        expect.objectContaining({
          id: 'vitals-1',
          temperature: '37.2',
          heart_rate: '88',
        }),
      ],
      problems: [
        expect.objectContaining({
          id: 'problem-1',
          name: 'Hypertension',
        }),
      ],
    });
  });

  it('loads active medications and recent vitals without legacy clinical endpoints', async () => {
    await expect(fetchActiveMedications('patient-1')).resolves.toEqual([
      expect.objectContaining({ id: 'rx-1', medication_name: 'Amlodipine' }),
    ]);
    await expect(fetchRecentVitals('patient-1')).resolves.toEqual([
      expect.objectContaining({ id: 'vitals-1', heart_rate: '88' }),
    ]);
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
