import { describe, expect, it, vi } from 'vitest';

import { labKeys } from '@/features/laboratory/hooks';
import { drugSafetyKeys } from '@/hooks/useDrugSafetyQueries';
import { IMMUTABLE_METADATA_GC_TIME } from '@/lib/react-query';
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
      'medicationHistory',
      'treatmentSheet',
      'fluids',
      'trends',
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

  it('builds historical medication workspace props without requiring an admission', () => {
    const props = buildChronicleWorkspaceProps('medicationHistory', {
      patient: { id: 'patient-1' },
      onClose: vi.fn(),
    });

    expect(props).toMatchObject({
      open: true,
      patient: { id: 'patient-1' },
    });
  });

  it('builds treatment sheet workspace props with the requested admission', () => {
    const props = buildChronicleWorkspaceProps('treatmentSheet', {
      patient: {
        local_data: { current_admission_id: 'admission-current' },
      },
      requestedTreatmentSheetAdmissionId: 'admission-requested',
      onClose: vi.fn(),
    });

    expect(props).toMatchObject({
      open: true,
      admission: { id: 'admission-requested' },
    });
  });

  it('builds fluid workspace props as history-only when no active admission or encounter exists', () => {
    const props = buildChronicleWorkspaceProps('fluids', {
      patient: { id: 'patient-1' },
      activeEncounter: null,
      onClose: vi.fn(),
      onFluidRecorded: vi.fn(),
    });

    expect(props.allowEntry).toBe(false);
    expect(props.admission).toBeNull();
  });

  it('passes scoped visit context into the trend review workspace', () => {
    const props = buildChronicleWorkspaceProps('trends', {
      patient: { id: 'patient-1' },
      selectedEncounterId: 'enc-1',
      selectedAdmissionId: 'adm-1',
      chronicleAllHistory: false,
      initialTrendTab: 'fluids',
      onClose: vi.fn(),
    });

    expect(props).toMatchObject({
      open: true,
      encounterId: 'enc-1',
      admissionId: 'adm-1',
      allHistory: false,
      initialTab: 'fluids',
    });
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

  it('loads the trend review workspace without extra metadata prefetches', () => {
    const loaders = {
      trends: vi.fn(),
    };
    const queryClient = {
      prefetchQuery: vi.fn(),
    };

    prefetchChronicleWorkspaceResources('trends', {
      patientLocalId: 'patient-1',
      queryClient,
      loaders,
    });

    expect(loaders.trends).toHaveBeenCalledTimes(1);
    expect(queryClient.prefetchQuery).not.toHaveBeenCalled();
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
        staleTime: Infinity,
        gcTime: IMMUTABLE_METADATA_GC_TIME,
      }),
    );
    expect(queryClient.prefetchQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        queryKey: labKeys.panelsList({}),
        staleTime: Infinity,
        gcTime: IMMUTABLE_METADATA_GC_TIME,
      }),
    );
  });
});
