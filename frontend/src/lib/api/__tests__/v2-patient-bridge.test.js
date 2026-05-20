import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { patientsApi } from '../patients';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 patient bridge', () => {
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

  it('searches Rust /api/v2 patients and adapts cursor envelopes for the existing registry page', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              display_name: 'Ama Mensah',
              sex: 'female',
              birth_year: 1989,
              status: 'active',
              created_at: '2026-05-01T08:00:00Z',
            },
          ],
          page: {
            limit: 25,
            has_next: true,
            next_cursor: 'cursor-2',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await patientsApi.searchPatientsWithMeta(
      { query: 'Ama', page_size: 25, registry_scope: 'active', include_total: 'false' },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients?limit=25&search=Ama&status=active',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual({
      results: [
        {
          id: 'patient-1',
          created_at: '2026-05-01T08:00:00Z',
          medical_record_number: 'MRN-MAIN-2026-000001',
          name: 'Ama Mensah',
          date_of_birth: '1989-01-01',
          gender: 'female',
          patient_location: null,
          active_clinic_names: [],
          registry_status: 'active',
        },
      ],
      page: 1,
      page_size: 25,
      count: 2,
      total: 2,
      count_exact: false,
      next: 'cursor-2',
      previous: null,
      next_cursor: 'cursor-2',
    });
  });

  it('preserves AbortError from Rust patient list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      patientsApi.searchPatientsWithMeta({ query: 'Ama' }, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('loads patient registration validation rules through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'rule-1',
              field_name: 'first_name',
              validation_regex: null,
              validation_message: 'First name is required',
              is_required: true,
              is_active: true,
              created_at: '2026-05-12T00:00:00Z',
              updated_at: '2026-05-12T00:00:00Z',
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

    const rules = await patientsApi.getValidationRules({ signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/validation-rules',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(rules).toEqual([
      expect.objectContaining({
        field_name: 'first_name',
        is_required: true,
        validation_message: 'First name is required',
      }),
    ]);
  });

  it('registers patients through Rust /api/v2 with the generated patient DTO', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            display_name: 'Ama Mensah',
            first_name: 'Ama',
            last_name: 'Mensah',
            date_of_birth: '1989-04-15',
            sex: 'female',
            status: 'active',
            created_at: '2026-05-12T08:00:00Z',
            updated_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await patientsApi.registerPatient({
      first_name: 'Ama',
      last_name: 'Mensah',
      date_of_birth: '1989-04-15',
      gender: 'Female',
      phone_number: '0240000000',
      admission_details: {
        admission_type: 'outpatient',
        clinic_id: 'clinic-1',
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Facility-Code': 'HMS',
        }),
        body: JSON.stringify({
          first_name: 'Ama',
          last_name: 'Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
        }),
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        id: 'patient-1',
        medical_record_number: 'MRN-MAIN-2026-000001',
        first_name: 'Ama',
        last_name: 'Mensah',
        gender: 'female',
        local_data: expect.objectContaining({
          id: 'patient-1',
          gender: 'female',
        }),
      }),
    );
  });

  it('creates patients through the same Rust V2 patient contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'patient-2',
            patient_code: 'MRN-MAIN-2026-000002',
            display_name: 'Kojo Asare',
            first_name: 'Kojo',
            last_name: 'Asare',
            date_of_birth: '1975-01-20',
            sex: 'male',
            status: 'active',
            created_at: '2026-05-12T08:00:00Z',
            updated_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await patientsApi.createPatient({
      local_data: {
        first_name: 'Kojo',
        last_name: 'Asare',
        date_of_birth: '1975-01-20',
        gender: 'male',
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          first_name: 'Kojo',
          last_name: 'Asare',
          date_of_birth: '1975-01-20',
          sex: 'male',
        }),
      }),
    );
    expect(response.local_data).toEqual(
      expect.objectContaining({
        id: 'patient-2',
        medical_record_number: 'MRN-MAIN-2026-000002',
      }),
    );
  });

  it('updates patient demographics through Rust /api/v2 patients', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            display_name: 'Ama Owusu',
            first_name: 'Ama',
            last_name: 'Owusu',
            date_of_birth: '1989-04-15',
            sex: 'female',
            status: 'active',
            created_at: '2026-05-12T08:00:00Z',
            updated_at: '2026-05-12T09:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await patientsApi.updatePatientWithFHIR('patient-1', {
      local_data: {
        last_name: 'Owusu',
        gender: 'Female',
        phone_number: '0240000000',
      },
      fhir_data: {
        telecom: [{ value: '0240000000' }],
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          last_name: 'Owusu',
          sex: 'female',
        }),
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        id: 'patient-1',
        last_name: 'Owusu',
        updated_at: '2026-05-12T09:00:00Z',
      }),
    );
  });

  it('preserves AbortError from Rust patient write calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      patientsApi.createPatient(
        {
          first_name: 'Ama',
          last_name: 'Mensah',
          date_of_birth: '1989-04-15',
          sex: 'female',
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toBe(abortError);
  });

  it('does not fall back to legacy patient-only actions without a Rust V2 contract', async () => {
    await expect(patientsApi.deletePatient('patient-1')).rejects.toThrow(
      'Patient deletion is not supported by Rust V2',
    );
    await expect(patientsApi.getPatientHistory('patient-1')).resolves.toEqual([]);
    await expect(patientsApi.requestBreakGlass('patient-1', { reason: 'care continuity' })).rejects.toThrow(
      'Break-glass access is not supported by Rust V2',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
