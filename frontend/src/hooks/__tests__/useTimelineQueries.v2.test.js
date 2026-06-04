import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchTimelinePage, fetchTimelineStats } from '../useTimelineQueries';
import { fetchChronicleContext } from '../useChronicleContext';
import { apiClient } from '@/lib/api-client';

vi.mock('../useChronicleContext', () => ({
  fetchChronicleContext: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    getWithPagination: vi.fn(),
  },
}));

describe('Rust V2 timeline bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    apiClient.get.mockRejectedValue(new Error('legacy timeline stats endpoint should not be called'));
    apiClient.getWithPagination.mockRejectedValue(new Error('legacy timeline endpoint should not be called'));
    fetchChronicleContext.mockResolvedValue({
      notes: [
        {
          id: 'note-1',
          note_type: 'doctor_note',
          title: 'Progress review',
          status: 'signed',
          updated_at: '2026-05-12T09:00:00Z',
        },
      ],
      prescriptions: [
        {
          id: 'rx-1',
          medication_name: 'Amlodipine',
          dose: '5 mg',
          frequency: 'daily',
          status: 'active',
          prescribed_at: '2026-05-12T08:30:00Z',
        },
      ],
      chart_entries: [
        {
          id: 'chart-1',
          entry_type: 'temperature',
          measured_at: '2026-05-12T08:00:00Z',
          value: '37.2',
          unit: 'C',
        },
      ],
      problems: [
        {
          id: 'problem-1',
          label: 'Hypertension',
          status: 'active',
          created_at: '2026-05-12T07:00:00Z',
        },
      ],
      allergies: [
        {
          id: 'allergy-1',
          substance: 'Penicillin',
          reaction: 'Rash',
          status: 'active',
          created_at: '2026-05-12T06:00:00Z',
        },
      ],
    });
  });

  it('builds a paginated timeline from Rust Chronicle context without legacy endpoints', async () => {
    const signal = new AbortController().signal;

    const response = await fetchTimelinePage('patient-1', { page: 1, page_size: 2 }, { signal });

    expect(fetchChronicleContext).toHaveBeenCalledWith('patient-1', { signal });
    expect(apiClient.getWithPagination).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        page: 1,
        page_size: 2,
        count: 5,
        has_next: true,
        results: [
          expect.objectContaining({ id: 'note-1', entry_type: 'note', type: 'doctor_note' }),
          expect.objectContaining({ id: 'rx-1', entry_type: 'prescription', type: 'prescription' }),
        ],
      }),
    );
  });

  it('filters Rust timeline entries locally while preserving bounded pagination', async () => {
    const response = await fetchTimelinePage('patient-1', {
      type: 'vitals',
      search: '37.2',
      page: 1,
      page_size: 20,
    });

    expect(response.results).toEqual([
      expect.objectContaining({
        id: 'chart-1',
        entry_type: 'vitals',
        data: expect.objectContaining({ temperature: '37.2' }),
      }),
    ]);
  });

  it('builds timeline stats from Rust Chronicle context without legacy stats endpoint', async () => {
    const response = await fetchTimelineStats('patient-1');

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        total: 5,
        notes: 1,
        prescriptions: 1,
        vitals: 1,
        problems: 1,
        allergies: 1,
      }),
    );
  });
});
