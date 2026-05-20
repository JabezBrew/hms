import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { problemsApi } from '../index';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 problems bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('loads patient problems through Rust /api/v2 and adapts the UI fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'problem-1',
              patient_id: 'patient-1',
              label: 'Hypertension',
              status: 'active',
              onset_date: '2026-05-01',
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 50, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await problemsApi.listForPatient('patient-1', { include_resolved: '1' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/problems?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'problem-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        label: 'Hypertension',
        clinical_status: 'active',
        status: 'active',
        priority: 'medium',
        verification_status: 'confirmed',
      }),
    ]);
  });

  it('creates free-text patient problems through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'problem-2',
            patient_id: 'patient-1',
            label: 'Asthma',
            status: 'active',
            onset_date: null,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const signal = new AbortController().signal;
    await problemsApi.create({
      patient: 'patient-1',
      free_text_label: 'Asthma',
      priority: 'high',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/problems',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          label: 'Asthma',
          onset_date: null,
        }),
        signal,
      }),
    );
  });

  it('changes patient problem status through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'problem-1',
            patient_id: 'patient-1',
            label: 'Hypertension',
            status: 'resolved',
            onset_date: '2026-05-01',
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const signal = new AbortController().signal;
    const response = await problemsApi.changeStatus('problem-1', {
      to_status: 'resolved',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/problems/problem-1/status',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          status: 'resolved',
        }),
        signal,
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        id: 'problem-1',
        patient: 'patient-1',
        clinical_status: 'resolved',
        status: 'resolved',
      }),
    );
  });

  it('loads and updates standalone problems through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'problem-1',
              patient_id: 'patient-1',
              label: 'Hypertension',
              status: 'active',
              onset_date: '2026-05-01',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'problem-1',
              patient_id: 'patient-1',
              label: 'Essential hypertension',
              status: 'resolved',
              onset_date: '2026-01-05',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const detailSignal = new AbortController().signal;
    const updateSignal = new AbortController().signal;
    const detail = await problemsApi.detail('problem-1', { signal: detailSignal });
    const updated = await problemsApi.update('problem-1', {
      label: 'Essential hypertension',
      onset_date: '2026-01-05',
      clinical_status: 'resolved',
    }, { signal: updateSignal });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/clinical/problems/problem-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: detailSignal,
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/clinical/problems/problem-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          label: 'Essential hypertension',
          onset_date: '2026-01-05',
          status: 'resolved',
        }),
        signal: updateSignal,
      }),
    );
    expect(detail).toEqual(expect.objectContaining({ id: 'problem-1', status: 'active' }));
    expect(updated).toEqual(
      expect.objectContaining({
        id: 'problem-1',
        label: 'Essential hypertension',
        clinical_status: 'resolved',
      }),
    );
  });

  it('does not call the legacy problem catalog in Rust mode', async () => {
    await expect(problemsApi.searchCodes('hyp')).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('lists, creates, and deletes same-patient problem links through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'link-1',
                patient_id: 'patient-1',
                problem_id: 'problem-1',
                artifact_kind: 'clinical_note',
                artifact_id: 'note-1',
                created_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 100, has_next: false, next_cursor: null },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'link-1',
              patient_id: 'patient-1',
              problem_id: 'problem-1',
              artifact_kind: 'clinical_note',
              artifact_id: 'note-1',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'link-1',
              patient_id: 'patient-1',
              problem_id: 'problem-1',
              artifact_kind: 'clinical_note',
              artifact_id: 'note-1',
              created_at: '2026-05-12T08:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const links = await problemsApi.listLinks({ note_entry: 'note-1' });
    const created = await problemsApi.createLink({
      problem: 'problem-1',
      note_entry: 'note-1',
    });
    const deleted = await problemsApi.deleteLink('link-1');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/clinical/problem-links?clinical_note_id=note-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/clinical/problem-links',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          problem_id: 'problem-1',
          clinical_note_id: 'note-1',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/clinical/problem-links/link-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(links[0]).toEqual(expect.objectContaining({
      id: 'link-1',
      problem: 'problem-1',
      note_entry: 'note-1',
    }));
    expect(created).toEqual(expect.objectContaining({ problem: 'problem-1' }));
    expect(deleted).toEqual(expect.objectContaining({ id: 'link-1' }));
  });

  it('preserves AbortError from Rust problem list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      problemsApi.listForPatient('patient-1', {}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
