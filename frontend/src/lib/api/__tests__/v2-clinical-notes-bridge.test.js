import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clinicalNotesApi } from '../clinical-notes';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 clinical notes bridge', () => {
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

  it('loads note templates through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'template-1',
              title: 'Consultation Note',
              note_type: 'consultation',
              body_template: 'SOAP template',
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

    const templates = await clinicalNotesApi.getNoteTemplates({}, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/note-templates',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(templates).toEqual([
      expect.objectContaining({
        id: 'template-1',
        title: 'Consultation Note',
        note_type: 'consultation',
        body_template: 'SOAP template',
        is_active: true,
      }),
    ]);
  });

  it('lists patient clinical notes through patient-scoped Rust endpoints only', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'note-1',
              patient_id: 'patient-1',
              note_type: 'consultation',
              title: 'Initial consult',
              status: 'draft',
              version: 1,
              updated_at: '2026-05-12T09:00:00Z',
            },
          ],
          page: { limit: 25, has_next: true, next_cursor: 'cursor-2' },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const notes = await clinicalNotesApi.getNoteEntries(
      { patient_id: 'patient-1', limit: 25 },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/notes?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(notes).toEqual([
      expect.objectContaining({
        id: 'note-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        title: 'Initial consult',
        note_type: 'consultation',
        version_number: 1,
      }),
    ]);
  });

  it('does not issue unbounded global note-entry lists in Rust V2 mode', async () => {
    await expect(clinicalNotesApi.getNoteEntries()).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('creates patient notes through Rust /api/v2 and serializes structured note data into the body', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'note-1',
            patient_id: 'patient-1',
            note_type: 'consultation',
            title: 'Initial consult',
            status: 'draft',
            version: 1,
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

    const note = await clinicalNotesApi.createNoteEntry({
      patient_id: 'patient-1',
      note_type: 'consultation',
      title: 'Initial consult',
      data: {
        subjective: 'Cough for two days',
        assessment: 'Upper respiratory infection',
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          note_type: 'consultation',
          title: 'Initial consult',
          body: JSON.stringify({
            subjective: 'Cough for two days',
            assessment: 'Upper respiratory infection',
          }),
        }),
      }),
    );
    expect(note).toEqual(
      expect.objectContaining({
        id: 'note-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        version_number: 1,
      }),
    );
  });

  it('writes note versions through Rust /api/v2 instead of patching legacy entries', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'version-2',
            note_id: 'note-1',
            version: 2,
            body: JSON.stringify({ assessment: 'Updated assessment' }),
            created_at: '2026-05-12T10:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const version = await clinicalNotesApi.updateNoteEntry('note-1', { assessment: 'Updated assessment' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/notes/note-1/versions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          body: JSON.stringify({ assessment: 'Updated assessment' }),
        }),
      }),
    );
    expect(version).toEqual(
      expect.objectContaining({
        id: 'version-2',
        note_id: 'note-1',
        version_number: 2,
        data: { assessment: 'Updated assessment' },
      }),
    );
  });

  it('loads note version history through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'version-1',
              note_id: 'note-1',
              version: 1,
              body: JSON.stringify({ subjective: 'Original' }),
              created_at: '2026-05-12T09:00:00Z',
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

    const history = await clinicalNotesApi.getNoteEntryHistory('note-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/notes/note-1/versions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(history).toEqual(
      expect.objectContaining({
        version_count: 1,
        versions: [
          expect.objectContaining({
            id: 'version-1',
            version_number: 1,
            data: { subjective: 'Original' },
          }),
        ],
      }),
    );
  });

  it('does not fall back to legacy template mutations without a Rust V2 contract', async () => {
    await expect(clinicalNotesApi.createNoteTemplate({ title: 'New template' })).rejects.toThrow(
      'Clinical note template creation is not supported by Rust V2',
    );
    await expect(clinicalNotesApi.deleteNoteTemplate('template-1')).rejects.toThrow(
      'Clinical note template deletion is not supported by Rust V2',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves AbortError from Rust clinical note calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      clinicalNotesApi.getNoteTemplates({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
