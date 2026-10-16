import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  createPrescription,
  discontinuePrescription,
  fetchPatientActivePrescriptions,
  fetchPrescription,
  holdPrescription,
  resumePrescription,
  updatePrescription,
  useRenewPrescription,
  useUpdatePrescription,
  useDiscontinuePrescription,
  prescriptionKeys,
} from '../usePrescriptionMutations';
import { patientKeys, usePatientChronicleStartup } from '@/features/patients/hooks/usePatientQueries';
import { useChronicleTimelineData } from '@/features/patients/chronicle/useChronicleTimelineData';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { apiClient } from '@/lib/api-client';
import { nursingKeys } from '../nursing/nursingQueryKeys';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  },
}));

describe('Rust V2 prescription mutations bridge', () => {
  const stockRequest = { inventory_item_id: 'item-1', scheduled_stock_policy: { expected_stock_unit: 'tablet', stock_units_per_dose: 2 } };
  const stockSaved = { inventory_item_id: 'item-1', scheduled_stock_policy: { stock_unit: 'tablet', stock_units_per_dose: 2 } };
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

  it('creates prescriptions through Rust /api/v2 with the generated patient-scoped contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '5 mg',
            frequency: 'daily',
            status: 'active',
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await createPrescription({
      patient: 'patient-1',
      medication_name: 'Amlodipine',
      dosage: '5 mg',
      frequency: 'daily',
      route: 'oral',
      instructions: '  Synthetic saved instructions  ',
      reason: '  Synthetic saved reason  ',
    }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/prescriptions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      medication_name: 'Amlodipine',
      dose: '5 mg',
      frequency: 'daily',
      route: 'oral',
      instructions: 'Synthetic saved instructions',
      reason: 'Synthetic saved reason',
    });
    expect(response).toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '5 mg',
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('generates MAR after creating a Rust V2 prescription when requested', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'rx-1',
              patient_id: 'patient-1',
              medication_name: 'Amlodipine',
              dose: '5 mg',
              route: 'oral',
              frequency: 'bid',
              ...stockSaved,
              status: 'active',
              prescribed_at: '2026-05-12T08:30:00Z',
            },
            meta: {},
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              prescription_id: 'rx-1',
              created_count: 14,
              existing_count: 0,
              requested_dose_count: 14,
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await createPrescription({
      patient: 'patient-1',
      medication_name: 'Amlodipine',
      dosage: '5 mg',
      route: 'oral',
      frequency: 'bid',
      start_date: '2026-06-04',
      duration_days: 7,
      ...stockRequest,
      generate_mar: 'yes',
      mar_days: 7,
      admission_case_id: 'admission-1',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/patients/patient-1/clinical/prescriptions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      medication_name: 'Amlodipine',
      dose: '5 mg',
      frequency: 'bid',
      route: 'oral',
      start_date: '2026-06-04',
      duration_days: 7,
      admission_case_id: 'admission-1',
      ...stockRequest,
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1/generate-mar',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toEqual({
      admission_case_id: 'admission-1',
      days: 7,
    });
    expect(response).toEqual(
      expect.objectContaining({
        id: 'rx-1',
        mar_generated: true,
        mar_generation: expect.objectContaining({
          created_count: 14,
        }),
      }),
    );
  });

  it('updates prescription dose, frequency, and status through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '10 mg',
            frequency: 'twice daily',
            status: 'stopped',
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      updatePrescription(
        'rx-1',
        { dosage: '10 mg', frequency: 'twice daily', status: 'stopped' },
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '10 mg',
        status: 'stopped',
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          dose: '10 mg',
          frequency: 'twice daily',
          status: 'stopped',
        }),
      }),
    );
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('rejects missing MAR admission before creating and allows an outpatient prescription without MAR', async () => {
    const data = { patient: 'patient-1', medication_name: 'Medication', dose: '5 mg', frequency: 'daily' };
    await expect(createPrescription({ ...data, generate_mar: true })).rejects.toThrow('Active admission is required');
    expect(globalThis.fetch).not.toHaveBeenCalled();

    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-outpatient', patient_id: 'patient-1' } }), {
      status: 201, headers: { 'content-type': 'application/json' },
    }));
    await expect(createPrescription({ ...data, generate_mar: false })).resolves.toMatchObject({ id: 'rx-outpatient' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejected', () => Promise.resolve(new Response(JSON.stringify({ error: { message: 'Schedule rejected' } }), { status: 409, headers: { 'content-type': 'application/json' } })), 'failed'],
    ['network failure', () => Promise.reject(new TypeError('Network unavailable')), 'unconfirmed'],
    ['aborted response', () => Promise.reject(new DOMException('Aborted', 'AbortError')), 'unconfirmed'],
  ])('returns the saved prescription after MAR %s without reporting a failed create', async (_label, marRequest, status) => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-saved', patient_id: 'patient-1', ...stockSaved } }), {
        status: 201, headers: { 'content-type': 'application/json' },
      }))
      .mockImplementationOnce(marRequest);

    await expect(createPrescription({
      patient: 'patient-1', medication_name: 'Medication', dose: '5 mg', frequency: 'daily',
      ...stockRequest, generate_mar: true, admission_case_id: 'admission-1',
    })).resolves.toMatchObject({ id: 'rx-saved', mar_generated: false, mar_generation_status: status });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls.filter(([url]) => url.endsWith('/clinical/prescriptions'))).toHaveLength(1);
  });

  it.each([
    undefined,
    {},
    { prescription_id: 'another-prescription', created_count: 2, existing_count: 0, requested_dose_count: 2 },
    { prescription_id: 'rx-saved', created_count: -1, existing_count: 0, requested_dose_count: 2 },
  ])('keeps the saved prescription but never claims MAR generation from a malformed receipt', async (data) => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-saved', patient_id: 'patient-1', ...stockSaved } }), {
        status: 201, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    await expect(createPrescription({
      patient: 'patient-1', medication_name: 'Medication', dose: '5 mg', frequency: 'daily',
      ...stockRequest, generate_mar: true, admission_case_id: 'admission-1',
    })).resolves.toMatchObject({ id: 'rx-saved', mar_generated: false, mar_generation_status: 'unconfirmed' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves supported duration and regimen fields on update', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-1', patient_id: 'patient-1', duration_days: 14 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await updatePrescription('rx-1', { duration_days: '14', route: 'oral', inventory_item_id: 'item-1', start_date: '2026-10-15' });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      route: 'oral', inventory_item_id: 'item-1', start_date: '2026-10-15', duration_days: 14,
    });
  });

  it('does not generate a fixed MAR schedule for an as-needed order', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-prn', patient_id: 'patient-1' } }), {
      status: 201, headers: { 'content-type': 'application/json' },
    }));
    await expect(createPrescription({
      patient: 'patient-1', medication_name: 'Medication', dose: '5 mg', frequency: 'prn',
      generate_mar: true, admission_case_id: 'admission-1',
    })).resolves.toMatchObject({ id: 'rx-prn' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/clinical\/prescriptions$/);
  });

  const prnPolicy = { minimum_interval_hours: 6, maximum_doses_per_24_hours: 3,
    indication: 'Synthetic indication', stock_units_per_dose: 2, expected_stock_unit: 'tablet' };
  const prnCreate = { patient: 'patient-1', medication_name: 'Synthetic', dose: '2 tablets',
    frequency: 'prn', inventory_item_id: 'item-1', prn_policy: prnPolicy };
  const savedPrnPolicy = { minimum_interval_hours: 6, maximum_doses_per_24_hours: 3,
    indication: 'Synthetic indication', stock_units_per_dose: 2, stock_unit: 'tablet' };

  it('sends explicit PRN limits with the selected unit through the real generated contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      id: 'rx-prn', patient_id: 'patient-1', prn_policy: savedPrnPolicy,
    } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(createPrescription(prnCreate)).resolves.toMatchObject({ id: 'rx-prn', prn_policy: savedPrnPolicy });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({ prn_policy: prnPolicy });
  });

  it.each([undefined, { ...savedPrnPolicy, stock_unit: 'pack' }, { ...savedPrnPolicy, maximum_doses_per_24_hours: 4 }])(
    'blocks a retry if the server does not confirm the same PRN order and stock basis', async (saved) => {
      globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-prn', prn_policy: saved } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
      await expect(createPrescription(prnCreate)).rejects.toMatchObject({ name: 'PrescriptionWriteUnconfirmedError' });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

  it.each([
    { ...prnPolicy, maximum_doses_per_24_hours: 5 }, { ...prnPolicy, expected_stock_unit: '' },
    { ...prnPolicy, stock_units_per_dose: Number.MAX_SAFE_INTEGER + 1 },
    { ...prnPolicy, indication: ' ' }, { ...prnPolicy, minimum_interval_hours: 3 },
  ])('rejects incomplete or unsafe PRN policies before the write', async (policy) => {
    await expect(createPrescription({ ...prnCreate, prn_policy: policy })).rejects.toThrow('dose limits');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([409, 503])('keeps a generic %s prescription write unconfirmed', async (status) => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'prescription_create_failed', message: 'Write failed' } }), {
      status, headers: { 'content-type': 'application/json' },
    }));
    await expect(createPrescription(prnCreate)).rejects.toMatchObject({ name: 'PrescriptionWriteUnconfirmedError' });
  });

  it('allows review after an explicit stale stock unit refusal without claiming a saved prescription', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'prn_stock_unit_changed', message: 'Review the stock unit' } }), {
      status: 409, headers: { 'content-type': 'application/json' },
    }));
    await expect(createPrescription(prnCreate)).rejects.toThrow('Review the stock unit');
  });

  it('rejects invalid duration before a write', async () => {
    await expect(updatePrescription('rx-1', { duration_days: '1.5' })).rejects.toThrow('whole number');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects unavailable V2 renewal without calling a legacy endpoint', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useRenewPrescription(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ prescriptionId: 'rx-1' })).rejects.toThrow('Renewal is not available');
    });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshes the actual patient and medication fulfillment after a prescription mutation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children);
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-1', patient_id: 'patient-1', status: 'on_hold' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const { result } = renderHook(() => useUpdatePrescription(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ prescriptionId: 'rx-1', data: { status: 'on_hold' } }); });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: prescriptionKeys.list('patient-1') });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: prescriptionKeys.list('rx-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: nursingKeys.patientMarAll() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: nursingKeys.prnOrdersAll() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: nursingKeys.pendingDispensingAll() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: nursingKeys.medicationAdministrationHistoryAll() });
  });

  it.each([
    { loadSecondPage: false, activeFilter: 'all' },
    { loadSecondPage: true, activeFilter: 'all' },
    { loadSecondPage: false, activeFilter: 'medication' },
    { loadSecondPage: true, activeFilter: 'all', pendingRefetch: true },
    { loadSecondPage: true, activeFilter: 'all', pendingRefetch: true, delayedStartup: true },
    { loadSecondPage: false, activeFilter: 'all', delayedStartup: true, paginateDuringRefresh: true },
  ])('refreshes visible Chronicle medication status and summary after stopping ($activeFilter, second page: $loadSecondPage, pending read: $pendingRefetch, delayed startup: $delayedStartup, new page during refresh: $paginateDuringRefresh)', async ({ loadSecondPage, activeFilter, pendingRefetch, delayedStartup, paginateDuringRefresh }) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children);
    let status = 'active';
    let startupReads = 0;
    let deferNextSecondPage = false;
    let releaseStalePage;
    let releaseFreshStartup;
    const prescription = () => ({ id: 'rx-1', patient_id: 'patient-1', medication_name: 'Medication', status });
    const medicationEntry = () => ({ id: 'medication-entry', type: 'prescription', data: prescription() });
    const firstPage = () => ({
      data: loadSecondPage ? [{ id: 'note-entry', type: 'doctor_note', data: {} }] : [medicationEntry()],
      page: { has_next: loadSecondPage || paginateDuringRefresh, next_cursor: loadSecondPage || paginateDuringRefresh ? 'older' : null, limit: 20 },
    });
    const jsonResponse = (data) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    globalThis.fetch.mockImplementation(async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (requestUrl.pathname.endsWith('/clinical/prescriptions/rx-1') && options.method === 'PATCH') {
        status = JSON.parse(options.body).status;
        return jsonResponse({ data: prescription() });
      }
      if (requestUrl.pathname.endsWith('/chronicle')) {
        startupReads += 1;
        const response = jsonResponse({ data: {
          patient: { id: 'patient-1' },
          generated_at: `2026-10-15T12:00:0${startupReads}Z`,
          active_medications: status === 'active' ? [prescription()] : [],
          timeline: firstPage(),
        } });
        if (delayedStartup && startupReads === 2) {
          return new Promise((resolve) => { releaseFreshStartup = () => resolve(response); });
        }
        return response;
      }
      if (requestUrl.pathname.endsWith('/chronicle/timeline')) {
        const response = jsonResponse(requestUrl.searchParams.get('cursor') === 'older'
          ? { data: paginateDuringRefresh ? [{ id: 'older-note', type: 'doctor_note', data: {} }] : [medicationEntry()], page: { has_next: false, next_cursor: null, limit: 20 } }
          : firstPage());
        if (requestUrl.searchParams.get('cursor') === 'older' && deferNextSecondPage) {
          deferNextSecondPage = false;
          return new Promise((resolve) => { releaseStalePage = () => resolve(response); });
        }
        return response;
      }
      throw new Error('Unexpected request in Chronicle mutation regression');
    });
    const otherStartupKey = patientKeys.chronicleStartup('patient-2');
    const otherTimelineKey = patientKeys.chronicleTimeline('patient-2', { type: 'all' });
    const demographicsKey = patientKeys.detail('patient-1');
    const filteredTimelineKey = patientKeys.chronicleTimeline('patient-1', { type: 'prescriptions' });
    queryClient.setQueryData(otherStartupKey, { active_medications: [{ id: 'other-rx' }] });
    queryClient.setQueryData(otherTimelineKey, { pages: [{ results: [] }], pageParams: [null] });
    queryClient.setQueryData(demographicsKey, { id: 'patient-1' });
    queryClient.setQueryData(filteredTimelineKey, { pages: [{ results: [] }], pageParams: [null] });

    const { result, unmount } = renderHook(() => {
      const startup = usePatientChronicleStartup('patient-1');
      const timeline = useChronicleTimelineData({
        activeFilter, canFetchClinical: true, chronicleContext: startup.data,
        debouncedSearch: '', isWardRoundMode: false, patientId: 'patient-1',
        resolvedVisitScope: 'current', rustV2Mode: true, selectedEncounterId: null,
      });
      return { startup, timeline, stop: useDiscontinuePrescription() };
    }, { wrapper });
    const visibleMedication = () => result.current.timeline.timelineDisplayData?.pages
      .flatMap((page) => page.results).find((entry) => entry.id === 'medication-entry');
    try {
      await waitFor(() => expect(result.current.startup.data?.active_medications).toHaveLength(1));
      if (loadSecondPage || paginateDuringRefresh) {
        await waitFor(() => expect(result.current.timeline.hasNextPage).toBe(true));
      }
      if (loadSecondPage) {
        await act(async () => { await result.current.timeline.fetchNextPage(); });
        await waitFor(() => expect(result.current.timeline.timelineDisplayData.pages).toHaveLength(2));
      }
      await waitFor(() => expect(visibleMedication()?.data.status).toBe('active'));
      if (pendingRefetch) {
        deferNextSecondPage = true;
        act(() => { void result.current.timeline.refetchTimeline(); });
        await waitFor(() => expect(releaseStalePage).toBeTypeOf('function'));
      }

      await act(async () => { await result.current.stop.mutateAsync({ prescriptionId: 'rx-1' }); });
      if (delayedStartup) {
        await waitFor(() => expect(releaseFreshStartup).toBeTypeOf('function'));
        if (paginateDuringRefresh) {
          await act(async () => { await result.current.timeline.fetchNextPage(); });
          await waitFor(() => expect(result.current.timeline.timelineDisplayData.pages).toHaveLength(2));
        } else {
          await act(async () => { releaseStalePage(); });
        }
        expect(visibleMedication()?.data.status).toBe('active');
        await act(async () => { releaseFreshStartup(); });
      }

      await waitFor(() => {
        expect(result.current.startup.data.active_medications).toHaveLength(0);
        expect(visibleMedication()?.data.status).toBe('stopped');
      });
      if (pendingRefetch) {
        await act(async () => { releaseStalePage(); });
        expect(visibleMedication()?.data.status).toBe('stopped');
      }
      if (loadSecondPage || paginateDuringRefresh) expect(result.current.timeline.timelineDisplayData.pages).toHaveLength(2);
      const visibleTimelineKey = patientKeys.chronicleTimeline('patient-1', {
        type: activeFilter === 'all' ? 'all' : 'prescriptions', search: '', limit: 20, encounterId: undefined,
      });
      expect(queryClient.getQueryState(visibleTimelineKey).isInvalidated).toBe(false);
      expect(queryClient.getQueryState(filteredTimelineKey).isInvalidated).toBe(true);
      expect(startupReads).toBe(2);
      expect(globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/chronicle/timeline')))
        .toHaveLength(pendingRefetch ? 5 : loadSecondPage || paginateDuringRefresh ? 3 : activeFilter === 'all' ? 0 : 2);
      expect(queryClient.getQueryState(otherStartupKey).isInvalidated).toBe(false);
      expect(queryClient.getQueryState(otherTimelineKey).isInvalidated).toBe(false);
      expect(queryClient.getQueryState(demographicsKey).isInvalidated).toBe(false);
    } finally {
      releaseStalePage?.();
      releaseFreshStartup?.();
      unmount();
      queryClient.clear();
    }
  });

  it('fetches prescription detail through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '10 mg',
            frequency: 'twice daily',
            status: 'active',
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(fetchPrescription('rx-1', { signal: new AbortController().signal })).resolves.toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        dosage: '10 mg',
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('fetches active patient prescriptions through the bounded Rust patient list contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'rx-active',
              patient_id: 'patient-1',
              medication_name: 'Amlodipine',
              dose: '10 mg',
              frequency: 'daily',
              status: 'active',
              prescribed_at: '2026-05-12T08:30:00Z',
            },
            {
              id: 'rx-stopped',
              patient_id: 'patient-1',
              medication_name: 'Lisinopril',
              dose: '5 mg',
              frequency: 'daily',
              status: 'stopped',
              prescribed_at: '2026-05-11T08:30:00Z',
            },
          ],
          page: { limit: 50, next_cursor: null },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      fetchPatientActivePrescriptions('patient-1', { signal: new AbortController().signal }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'rx-active',
        patient: 'patient-1',
        status: 'active',
      }),
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/prescriptions?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it.each([
    ['discontinues', discontinuePrescription, { reason: 'Changed therapy' }, 'stopped'],
    ['holds', holdPrescription, { reason: 'NPO' }, 'on_hold'],
    ['resumes', resumePrescription, {}, 'active'],
  ])('%s prescriptions through Rust /api/v2 status updates', async (
    _label,
    action,
    variables,
    status,
  ) => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'rx-1',
            patient_id: 'patient-1',
            medication_name: 'Amlodipine',
            dose: '10 mg',
            frequency: 'twice daily',
            status,
            prescribed_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(action('rx-1', variables)).resolves.toEqual(
      expect.objectContaining({
        id: 'rx-1',
        patient: 'patient-1',
        status,
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/prescriptions/rx-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ status }),
      }),
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });

it('invalidates actual scoped PRN-order caches after a persisted lifecycle change without invalidating unrelated patient detail', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); const key = nursingKeys.prnOrders('synthetic-admission', 'synthetic-authority'); const other = ['synthetic-unrelated-patient-detail']; client.setQueryData(key, { pages: [{ items: [{ prescription_id: 'rx-1', status: 'active' }] }] }); client.setQueryData(other, { unchanged: true });
  globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-1', patient_id: 'patient-1', status: 'on_hold' } }), { status: 200, headers: { 'content-type': 'application/json' } })); const wrapper = ({ children }) => createElement(QueryClientProvider, { client }, children); const { result } = renderHook(() => useUpdatePrescription(), { wrapper }); await act(async () => { await result.current.mutateAsync({ prescriptionId: 'rx-1', data: { status: 'on_hold' } }); }); expect(client.getQueryState(key).isInvalidated).toBe(true); expect(client.getQueryState(other).isInvalidated).toBe(false); client.clear();
});

  it.each([undefined, { expected_stock_unit: 'tablet', stock_units_per_dose: 0 }, { expected_stock_unit: 'tablet', stock_units_per_dose: 1.5 }, { expected_stock_unit: 'tablet', stock_units_per_dose: 9007199254740992 }])('requires reviewed whole base units before a linked scheduled create (%j)', async (policy) => {
    await expect(createPrescription({ patient: 'patient-1', medication_name: 'Synthetic', dose: '500 mg', frequency: 'daily', inventory_item_id: 'item-1', scheduled_stock_policy: policy })).rejects.toThrow(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([null, { stock_unit: 'pack', stock_units_per_dose: 2 }, { stock_unit: 'tablet', stock_units_per_dose: 1 }])('does not schedule MAR when the server ignored or changed the reviewed stock policy (%j)', async (scheduled_stock_policy) => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-ignored-policy', patient_id: 'patient-1', inventory_item_id: 'item-1', scheduled_stock_policy } }), { status: 201, headers: { 'content-type': 'application/json' } }));
    await expect(createPrescription({ patient: 'patient-1', medication_name: 'Synthetic', dose: '500 mg', frequency: 'daily', ...stockRequest, generate_mar: true, admission_case_id: 'admission-1' })).rejects.toMatchObject({ name: 'PrescriptionWriteUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ frequency: 'prn', inventory_item_id: 'item-1' }, { frequency: 'daily' }])('rejects a scheduled policy on a PRN or unlinked request before fetch', async (data) => {
    await expect(createPrescription({ patient: 'patient-1', medication_name: 'Synthetic', dose: '1 dose', ...data, scheduled_stock_policy: stockRequest.scheduled_stock_policy })).rejects.toThrow(/linked scheduled/); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not follow up with MAR when a create receipt echoes units for a different stock item', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'rx-wrong-stock', patient_id: 'patient-1', ...stockSaved, inventory_item_id: 'another-item' } }), { status: 201, headers: { 'content-type': 'application/json' } })); await expect(createPrescription({ patient: 'patient-1', medication_name: 'Synthetic', dose: '500 mg', frequency: 'daily', ...stockRequest, generate_mar: true, admission_case_id: 'admission-1' })).rejects.toMatchObject({ name: 'PrescriptionWriteUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

});
