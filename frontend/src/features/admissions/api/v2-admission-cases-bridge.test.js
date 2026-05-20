import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { admissionsApi } from './index';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 admission cases bridge', () => {
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

  it('loads admission cases through Rust /api/v2 and adapts queue fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'case-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              ward_id: 'ward-1',
              ward_name: 'Medical Ward',
              bed_id: 'bed-1',
              bed_code: 'A1',
              status: 'ready_for_activation',
              created_at: '2026-05-12T05:00:00Z',
              admitted_at: null,
              discharged_at: null,
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

    const cases = await admissionsApi.getCases({}, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions/cases?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(cases).toEqual([
      expect.objectContaining({
        id: 'case-1',
        patient: 'patient-1',
        patient_name: 'Ama Mensah',
        medical_record_number: 'MRN-001',
        requested_ward: 'ward-1',
        requested_ward_name: 'Medical Ward',
        requested_bed_label: 'Medical Ward · Bed A1',
        status: 'ready_for_activation',
        requested_at: '2026-05-12T05:00:00Z',
        blockers: [],
      }),
    ]);
  });

  it('preserves AbortError from Rust admission case list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      admissionsApi.getCases({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('loads admission case detail through the Rust /api/v2 detail endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'case-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            ward_id: 'ward-1',
            ward_name: 'Medical Ward',
            bed_id: 'bed-1',
            bed_code: 'A1',
            status: 'ready_for_activation',
            created_at: '2026-05-12T05:00:00Z',
            admitted_at: null,
            discharged_at: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const admissionCase = await admissionsApi.getCase('case-1', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions/cases/case-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(admissionCase).toEqual(expect.objectContaining({
      id: 'case-1',
      patient_name: 'Ama Mensah',
      requested_ward_name: 'Medical Ward',
      requested_bed_label: 'Medical Ward · Bed A1',
    }));
  });

  it('loads active admissions from the bounded Rust V2 ward board', async () => {
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
              bed_code: 'A1',
              admission_status: 'admitted',
              admitted_at: '2026-05-12T05:30:00Z',
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
    );

    const admissions = await admissionsApi.getAdmissions({
      ward: 'ward-1',
      status: 'admitted',
      page_size: 200,
    }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board?limit=100&ward_id=ward-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(admissions).toEqual([
      expect.objectContaining({
        id: 'admission-1',
        patient_name: 'Ama Mensah',
        status: 'admitted',
        patient: expect.objectContaining({
          id: 'patient-1',
          user: { full_name: 'Ama Mensah' },
        }),
        bed: expect.objectContaining({ bed_number: 'A1' }),
      }),
    ]);
  });

  it('loads admission detail through the Rust /api/v2 admission detail endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            admission_id: 'admission-2',
            patient_id: 'patient-2',
            patient_code: 'MRN-002',
            patient_display_name: 'Kojo Mensah',
            ward_id: 'ward-2',
            ward_name: 'Surgical Ward',
            bed_id: 'bed-2',
            bed_code: 'B4',
            admission_status: 'admitted',
            admitted_at: '2026-05-12T05:45:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const admission = await admissionsApi.getAdmission('admission-2', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions/admission-2',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(admission).toEqual(expect.objectContaining({
      id: 'admission-2',
      patient_name: 'Kojo Mensah',
      bed_details: expect.objectContaining({
        bed_number: 'B4',
        ward_details: expect.objectContaining({ id: 'ward-2', name: 'Surgical Ward' }),
      }),
    }));
  });

  it('starts admission cases through the Rust V2 contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'case-2',
            patient_id: 'patient-2',
            patient_code: 'MRN-002',
            patient_display_name: 'Kojo Mensah',
            ward_id: 'ward-2',
            ward_name: 'Surgical Ward',
            bed_id: null,
            bed_code: null,
            status: 'pending',
            created_at: '2026-05-12T06:00:00Z',
            admitted_at: null,
            discharged_at: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const admissionCase = await admissionsApi.startCase({
      patient: 'patient-2',
      requested_ward: 'ward-2',
    }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions/cases',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ patient_id: 'patient-2', ward_id: 'ward-2' }),
      }),
    );
    expect(admissionCase).toEqual(expect.objectContaining({
      id: 'case-2',
      patient: 'patient-2',
      requested_ward: 'ward-2',
      status: 'pending',
    }));
  });

  it('creates direct ward admissions through Rust V2 when a bed is selected', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            admission_id: 'admission-3',
            patient_id: 'patient-3',
            patient_code: 'MRN-003',
            patient_display_name: 'Adjoa Boateng',
            ward_id: 'ward-3',
            ward_name: 'Medical Ward',
            bed_id: 'bed-3',
            bed_code: 'C1',
            admission_status: 'admitted',
            admitted_at: '2026-05-12T07:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const admission = await admissionsApi.createAdmission({
      patient: 'patient-3',
      requested_ward: 'ward-3',
      bed: 'bed-3',
    }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ patient_id: 'patient-3', ward_id: 'ward-3', bed_id: 'bed-3' }),
      }),
    );
    expect(admission).toEqual(expect.objectContaining({
      id: 'admission-3',
      admission_id: 'admission-3',
      status: 'admitted',
    }));
  });

  it('reserves beds and transitions admission cases through Rust V2 actions', async () => {
    const actionResponse = (status, bedId = 'bed-2') => new Response(
      JSON.stringify({
        data: {
          id: 'case-3',
          patient_id: 'patient-3',
          patient_code: 'MRN-003',
          patient_display_name: 'Adjoa Boateng',
          ward_id: 'ward-3',
          ward_name: 'Medical Ward',
          bed_id: bedId,
          bed_code: bedId ? 'B2' : null,
          status,
          created_at: '2026-05-12T07:00:00Z',
          admitted_at: status === 'admitted' ? '2026-05-12T07:30:00Z' : null,
          discharged_at: null,
        },
        meta: {},
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
    globalThis.fetch
      .mockResolvedValueOnce(actionResponse('ready_for_activation'))
      .mockResolvedValueOnce(actionResponse('admitted'))
      .mockResolvedValueOnce(actionResponse('cancelled', null));

    await admissionsApi.reserveBed('case-3', { bed: 'bed-2' }, { signal: new AbortController().signal });
    await admissionsApi.activateCase('case-3', {}, { signal: new AbortController().signal });
    await admissionsApi.cancelCase('case-3', 'duplicate', { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/admissions/cases/case-3/reserve-bed',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ bed_id: 'bed-2' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/admissions/cases/case-3/activate',
      expect.objectContaining({ method: 'POST', body: undefined }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/admissions/cases/case-3/cancel',
      expect.objectContaining({ method: 'POST', body: undefined }),
    );
  });

  it('exposes an active stay id after a Rust V2 admission case is activated', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'case-4',
            patient_id: 'patient-4',
            patient_code: 'MRN-004',
            patient_display_name: 'Akosua Owusu',
            ward_id: 'ward-4',
            ward_name: 'Medical Ward',
            bed_id: 'bed-4',
            bed_code: 'C4',
            status: 'admitted',
            created_at: '2026-05-12T08:00:00Z',
            admitted_at: '2026-05-12T08:30:00Z',
            discharged_at: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const admissionCase = await admissionsApi.activateCase('case-4', {}, {
      signal: new AbortController().signal,
    });

    expect(admissionCase).toEqual(expect.objectContaining({
      id: 'case-4',
      admission_id: 'case-4',
      status: 'admitted',
      admitted_at: '2026-05-12T08:30:00Z',
    }));
  });

  it('searches patients and practitioners through bounded Rust V2 search contracts', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'patient-4',
                medical_record_number: 'MRN-004',
                full_name: 'Akosua Owusu',
                date_of_birth: '1990-01-01',
                sex: 'Female',
              },
            ],
            page: { limit: 10, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'staff-1',
                full_name: 'Dr. Kofi Grant',
                email: 'kofi@example.test',
                role: 'Doctor',
              },
              {
                id: 'staff-2',
                full_name: 'Nurse Ama',
                email: 'ama@example.test',
                role: 'Nurse',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const patients = await admissionsApi.searchPatients('ako', { signal: new AbortController().signal });
    const practitioners = await admissionsApi.searchPractitioners('kofi', true, {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/patients?limit=10&search=ako',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/admin/practitioners?limit=20&search=kofi&is_active=true',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(patients).toEqual([
      expect.objectContaining({
        id: 'patient-4',
        medical_record_number: 'MRN-004',
        name: 'Akosua Owusu',
      }),
    ]);
    expect(practitioners).toEqual([
      expect.objectContaining({
        id: 'staff-1',
        name: 'Dr. Kofi Grant',
        role: 'Doctor',
      }),
    ]);
  });

  it('fails closed for admission workflow steps missing from the Rust V2 contract', async () => {
    await expect(admissionsApi.updateAdmission('admission-1', {})).rejects.toThrow('/api/v2 admission update contract');
    await expect(admissionsApi.dischargePatient('admission-1', {})).rejects.toThrow('/api/v2 admission discharge contract');
    await expect(admissionsApi.clearRegistration('case-1')).rejects.toThrow('/api/v2 admission registration clearance contract');
    await expect(admissionsApi.clearFinancial('case-1')).rejects.toThrow('/api/v2 admission financial clearance contract');
    await expect(admissionsApi.addAdvisoryTask('case-1', {})).rejects.toThrow('/api/v2 admission advisory task contract');
    await expect(admissionsApi.completeIntake('case-1')).rejects.toThrow('/api/v2 admission intake completion contract');
    await expect(admissionsApi.completeTask('task-1')).rejects.toThrow('/api/v2 admission task completion contract');
    await expect(admissionsApi.acknowledgeTask('task-1')).rejects.toThrow('/api/v2 admission task acknowledgement contract');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
