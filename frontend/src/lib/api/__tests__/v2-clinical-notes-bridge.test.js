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

    const templates = await clinicalNotesApi.getNoteTemplates(
      { page_size: 25 },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/note-templates?limit=25',
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

  it('adapts Rust template body templates into preserved UI structures', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'template-structured',
              title: 'Structured SOAP Note',
              note_type: 'soap',
              body_template: JSON.stringify([
                { section: 'Subjective', type: 'text', required: true },
                { section: 'Assessment', type: 'condition', required: true },
              ]),
              is_active: true,
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

    const templates = await clinicalNotesApi.getNoteTemplates({ page_size: 25 });

    expect(templates[0]).toEqual(
      expect.objectContaining({
        id: 'template-structured',
        category: 'soap',
        structure: [
          { section: 'Subjective', type: 'text', required: true },
          { section: 'Assessment', type: 'condition', required: true },
        ],
      }),
    );
  });

  it('routes clinical note template mutations through generated Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'template-2',
              title: 'Ward Round Note',
              note_type: 'ward_round',
              body_template: 'SOAP template',
              is_active: true,
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
              id: 'template-2',
              title: 'Updated Ward Round Note',
              note_type: 'ward_round',
              body_template: 'Updated template',
              is_active: true,
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
              id: 'template-2',
              title: 'Updated Ward Round Note',
              note_type: 'ward_round',
              body_template: 'Updated template',
              is_active: false,
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const created = await clinicalNotesApi.createNoteTemplate(
      {
        title: 'Ward Round Note',
        note_type: 'ward_round',
        body_template: 'SOAP template',
      },
      { signal: new AbortController().signal },
    );
    const updated = await clinicalNotesApi.updateNoteTemplate(
      'template-2',
      {
        title: 'Updated Ward Round Note',
        body_template: 'Updated template',
      },
      { signal: new AbortController().signal },
    );
    const deleted = await clinicalNotesApi.deleteNoteTemplate('template-2', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/clinical/note-templates',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          title: 'Ward Round Note',
          note_type: 'ward_round',
          body_template: 'SOAP template',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/clinical/note-templates/template-2',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          title: 'Updated Ward Round Note',
          body_template: 'Updated template',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/clinical/note-templates/template-2',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      }),
    );
    expect(created).toEqual(expect.objectContaining({ id: 'template-2', is_active: true }));
    expect(updated).toEqual(expect.objectContaining({ title: 'Updated Ward Round Note' }));
    expect(deleted).toEqual(expect.objectContaining({ id: 'template-2', is_active: false }));
  });

  it('serializes preserved template-builder structures into Rust body templates', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'template-structured',
            title: 'Structured SOAP Note',
            note_type: 'soap',
            body_template: JSON.stringify({
              sections: [
                { name: 'Subjective', type: 'text', required: true },
                { name: 'Assessment', type: 'condition', required: true },
              ],
            }),
            is_active: true,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const created = await clinicalNotesApi.createNoteTemplate({
      title: 'Structured SOAP Note',
      category: 'soap',
      structure: {
        sections: [
          { name: 'Subjective', type: 'text', required: true },
          { name: 'Assessment', type: 'condition', required: true },
        ],
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/note-templates',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          title: 'Structured SOAP Note',
          note_type: 'soap',
          body_template: JSON.stringify({
            sections: [
              { name: 'Subjective', type: 'text', required: true },
              { name: 'Assessment', type: 'condition', required: true },
            ],
          }),
        }),
      }),
    );
    expect(created.structure).toEqual([
      { name: 'Subjective', type: 'text', required: true },
      { name: 'Assessment', type: 'condition', required: true },
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

  it('loads a note entry detail through Rust /api/v2 with patient access enforced server-side', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'note-1',
            patient_id: 'patient-1',
            note_type: 'consultation',
            title: 'Initial consult',
            body: JSON.stringify({ assessment: 'Upper respiratory infection' }),
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

    const note = await clinicalNotesApi.getNoteEntry('note-1', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/notes/note-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(note).toEqual(
      expect.objectContaining({
        id: 'note-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        data: { assessment: 'Upper respiratory infection' },
      }),
    );
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

    const signal = new AbortController().signal;
    const version = await clinicalNotesApi.updateNoteEntry(
      'note-1',
      { assessment: 'Updated assessment' },
      '',
      { signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/notes/note-1/versions',
      expect.objectContaining({
        method: 'POST',
        signal,
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

    const signal = new AbortController().signal;
    const history = await clinicalNotesApi.getNoteEntryHistory('note-1', { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/notes/note-1/versions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal,
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

  it('threads signals through derived note version lookups', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'version-2',
              note_id: 'note-1',
              version: 2,
              body: JSON.stringify({ assessment: 'Updated' }),
              created_at: '2026-05-12T10:00:00Z',
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

    const signal = new AbortController().signal;
    const version = await clinicalNotesApi.getNoteEntryVersion('note-1', 2, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/notes/note-1/versions',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal,
      }),
    );
    expect(version).toEqual(expect.objectContaining({ version_number: 2 }));
  });

  it('clones note entries through Rust detail and patient-scoped create contracts', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'note-1',
              patient_id: 'patient-1',
              note_type: 'consultation',
              title: 'Initial consult',
              body: JSON.stringify({
                subjective: 'Cough for two days',
                assessment: 'Upper respiratory infection',
              }),
              status: 'signed',
              version: 2,
              updated_at: '2026-05-12T09:00:00Z',
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
              id: 'note-copy',
              patient_id: 'patient-2',
              note_type: 'consultation',
              title: 'Copied assessment',
              status: 'draft',
              version: 1,
              updated_at: '2026-05-12T10:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const note = await clinicalNotesApi.cloneNoteEntry(
      'note-1',
      {
        patient_id: 'patient-2',
        title: 'Copied assessment',
        sections: ['assessment'],
      },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/clinical/notes/note-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/patients/patient-2/clinical/notes',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          note_type: 'consultation',
          title: 'Copied assessment',
          body: JSON.stringify({
            assessment: 'Upper respiratory infection',
          }),
        }),
      }),
    );
    expect(note).toEqual(
      expect.objectContaining({
        id: 'note-copy',
        patient: 'patient-2',
        patient_id: 'patient-2',
        data: {
          assessment: 'Upper respiratory infection',
        },
      }),
    );
  });

  it('duplicates templates through Rust detail and create contracts', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'template-1',
              title: 'Consultation Note',
              note_type: 'consultation',
              body_template: 'SOAP template',
              is_active: true,
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
              id: 'template-copy',
              title: 'Copy of Consultation Note',
              note_type: 'consultation',
              body_template: 'SOAP template',
              is_active: true,
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const template = await clinicalNotesApi.duplicateTemplate('template-1', {
      signal: new AbortController().signal,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/clinical/note-templates/template-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/clinical/note-templates',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          title: 'Copy of Consultation Note',
          note_type: 'consultation',
          body_template: 'SOAP template',
        }),
      }),
    );
    expect(template).toEqual(
      expect.objectContaining({
        id: 'template-copy',
        title: 'Copy of Consultation Note',
        note_type: 'consultation',
      }),
    );
  });

  it('preserves AbortError from Rust clinical note calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      clinicalNotesApi.getNoteTemplates({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
