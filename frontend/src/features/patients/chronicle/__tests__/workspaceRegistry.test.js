import { describe, expect, it, vi } from 'vitest';

import { chartKeys } from '@/features/charts/hooks';
import { labKeys } from '@/features/laboratory/hooks';
import { drugSafetyKeys } from '@/hooks/useDrugSafetyQueries';
import { keyWith } from '@/shared/lib/queryKeys';
import {
  buildChronicleWorkspaceProps,
  chronicleWorkspaceIds,
  getChronicleAdmissionReference,
  prefetchChronicleWorkspaceResources,
} from '@/features/patients/chronicle/workspaceRegistry';

describe('chronicle workspace registry', () => {
  it('exposes the expected workspace ids in a stable order', () => {
    expect(chronicleWorkspaceIds).toEqual([
      'copilot',
      'note',
      'vitals',
      'prescription',
      'labs',
      'referral',
      'crossFacility',
      'receiveRecord',
      'fluids',
      'charts',
      'chartEntry',
      'insurance',
      'wardRound',
      'consultation',
      'discharge',
    ]);
  });

  it('builds note workspace props with edit data taking precedence over copy-forward data', () => {
    const props = buildChronicleWorkspaceProps('note', {
      patient: { id: 'patient-1' },
      activeEncounter: { id: 'enc-1' },
      editNoteData: {
        noteId: 'note-1',
        template: { id: 'template-edit' },
        data: { title: 'Edited' },
      },
      copyForwardData: {
        template: { id: 'template-copy' },
        data: { title: 'Copied' },
      },
      onClose: vi.fn(),
      onNoteCreated: vi.fn(),
    });

    expect(props).toMatchObject({
      open: true,
      editNoteId: 'note-1',
      initialTemplate: { id: 'template-edit' },
      initialData: { title: 'Edited' },
    });
  });

  it('prefers the requested discharge admission when building admission-scoped workspace props', () => {
    const props = buildChronicleWorkspaceProps('discharge', {
      patient: {
        local_data: { current_admission_id: 'admission-current' },
      },
      requestedDischargeAdmissionId: 'admission-requested',
      onClose: vi.fn(),
      onDischargeCompleted: vi.fn(),
    });

    expect(props.admission).toEqual({ id: 'admission-requested' });
  });

  it('prefetches prescription workspace dependencies with patient-scoped allergy data', () => {
    const loaders = {
      prescription: vi.fn(),
    };
    const queryClient = {
      prefetchQuery: vi.fn(),
    };

    prefetchChronicleWorkspaceResources('prescription', {
      patientLocalId: 'patient-1',
      queryClient,
      loaders,
    });

    expect(loaders.prescription).toHaveBeenCalledTimes(1);
    expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: drugSafetyKeys.patientAllergies('patient-1'),
      }),
    );
  });

  it('prefetches chart workspace metadata queries together', () => {
    const loaders = {
      charts: vi.fn(),
    };
    const queryClient = {
      prefetchQuery: vi.fn(),
    };

    prefetchChronicleWorkspaceResources('charts', {
      patientLocalId: 'patient-1',
      queryClient,
      loaders,
    });

    expect(loaders.charts).toHaveBeenCalledTimes(1);
    expect(queryClient.prefetchQuery).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        queryKey: keyWith('charts', 'templates', 'list', undefined, undefined, undefined, true),
      }),
    );
    expect(queryClient.prefetchQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        queryKey: chartKeys.categories(),
      }),
    );
    expect(queryClient.prefetchQuery).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        queryKey: chartKeys.intervals(),
      }),
    );
  });

  it('normalizes admission references to the current patient admission when no override is provided', () => {
    expect(
      getChronicleAdmissionReference({
        local_data: { current_admission_id: 'admission-1' },
      }),
    ).toEqual({ id: 'admission-1' });
    expect(getChronicleAdmissionReference({ current_admission_id: 'admission-2' })).toEqual({
      id: 'admission-2',
    });
    expect(getChronicleAdmissionReference({})).toBeNull();
  });

  it('prefetches lab workspace metadata queries together', () => {
    const loaders = {
      labs: vi.fn(),
    };
    const queryClient = {
      prefetchQuery: vi.fn(),
    };

    prefetchChronicleWorkspaceResources('labs', {
      queryClient,
      loaders,
    });

    expect(loaders.labs).toHaveBeenCalledTimes(1);
    expect(queryClient.prefetchQuery).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        queryKey: labKeys.testsList({}),
      }),
    );
    expect(queryClient.prefetchQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        queryKey: labKeys.panelsList({}),
      }),
    );
  });
});
