import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wardBoardApi } from './index';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 ward-board bridge', () => {
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

  it('loads the current user ward-board context through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            assigned_wards: [
              {
                assignment_id: 'assignment-1',
                ward_id: 'ward-1',
                ward_name: 'Medical Ward',
                role_name: 'Staff Nurse',
                role_category: 'nursing',
                is_primary: true,
              },
            ],
            primary_ward_id: 'ward-1',
            default_ward_id: 'ward-1',
            can_view_all_wards: false,
            default_route: '/wards/ward-1/board',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await wardBoardApi.getBoardContext();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/my-board-context',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(response).toMatchObject({
      default_ward_id: 'ward-1',
      can_view_all_wards: false,
      assigned_wards: [
        expect.objectContaining({
          ward_id: 'ward-1',
          ward_name: 'Medical Ward',
          is_primary: true,
        }),
      ],
    });
  });

  it('loads ward-scoped board rows through Rust /api/v2 and adapts them for the existing board UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              admission_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              ward_id: 'ward-1',
              ward_name: 'Medical Ward',
              bed_id: 'bed-1',
              bed_code: 'B-1',
              admission_status: 'admitted',
              admitted_at: '2026-05-12T08:00:00Z',
              open_nursing_task_count: 2,
              due_medication_count: 1,
            },
          ],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await wardBoardApi.getBoard(
      { ward: 'ward-1', page_size: 25, view: 'by-patient' },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board?limit=25&ward_id=ward-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toMatchObject({
      count: 1,
      next: null,
      previous: null,
      next_cursor: null,
      results: [
        expect.objectContaining({
          id: 'admission-1',
          admission_id: 'admission-1',
          patient_id: 'patient-1',
          patient_name: 'Ama Mensah',
          name: 'Ama Mensah',
          medical_record_number: 'MRN-001',
          ward_id: 'ward-1',
          ward_name: 'Medical Ward',
          bed_id: 'bed-1',
          bed_label: 'B-1',
          status: 'admitted',
          open_task_count: 2,
          due_medication_count: 1,
        }),
      ],
    });
  });

  it('passes patient-scoped board filters through to Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await wardBoardApi.getBoard({ patient: 'patient-1', page_size: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 25, patient_id: 'patient-1' }),
      }),
    );
  });

  it('searches ward board rows through the private Rust V2 search endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await wardBoardApi.getBoard({ search: 'Ama', ward: 'ward-1', page_size: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 25, ward_id: 'ward-1', search: 'Ama' }),
      }),
    );
  });

  it('preserves AbortError from Rust ward-board calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      wardBoardApi.getBoard({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('loads patient task details from the Rust V2 nursing task board', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'task-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              task_type: 'vitals',
              title: 'Record vitals',
              instruction: 'Repeat observations',
              status: 'open',
              due_at: '2026-05-12T10:00:00Z',
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

    const response = await wardBoardApi.getPatient('patient-1', { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks?limit=50&patient_id=patient-1',
      expect.objectContaining({ method: 'GET', credentials: 'include', signal }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        patient_id: 'patient-1',
        open_task_count: 1,
        tasks: [
          expect.objectContaining({
            id: 'task-1',
            patient_id: 'patient-1',
            category: 'Vitals',
            title: 'Record vitals',
            status: 'open',
          }),
        ],
      }),
    );
  });

  it('runs supported task actions through Rust V2 nursing task endpoints', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'task-1',
            patient_id: 'patient-1',
            status: 'completed',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await expect(
      wardBoardApi.runTaskAction({ taskId: 'task-1', action: 'complete' }),
    ).resolves.toEqual(expect.objectContaining({ id: 'task-1', status: 'completed' }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks/task-1/complete',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('rejects legacy-only task actions in Rust V2 mode', async () => {
    await expect(
      wardBoardApi.runTaskAction({ taskId: 'task-1', action: 'acknowledge' }),
    ).rejects.toThrow(/Unsupported task action in Rust V2 mode/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
