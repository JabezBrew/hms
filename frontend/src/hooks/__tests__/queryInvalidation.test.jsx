import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chartKeys, invalidateChartAssignmentMutationQueries, invalidateChartEntryMutationQueries } from '@/hooks/useChartQueries';
import { clinicalNotesKeys, invalidateClinicalNoteMutationQueries } from '@/hooks/useClinicalNotesQueries';
import { invalidateEncounterMutationQueries } from '@/features/encounters/hooks/useEncounterQueries';
import { invalidateOperationalDoctorDashboardQueries } from '@/hooks/useDashboardQueries';
import { invalidatePrescriptionMutationQueries, prescriptionKeys } from '@/hooks/usePrescriptionMutations';
import { invalidatePatientTimelineQueries, timelineKeys } from '@/hooks/useTimelineQueries';
import { invalidateVisitMutationQueries, visitKeys } from '@/hooks/useVisitQueries';
import { encounterKeys } from '@/features/encounters/hooks/useEncounterQueries';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

describe('targeted query invalidation helpers', () => {
  let queryClient;
  let invalidateQueriesSpy;

  beforeEach(() => {
    queryClient = createQueryClient();
    invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries');
  });

  it('invalidates only patient-scoped timeline queries when patient id is provided', async () => {
    await invalidatePatientTimelineQueries(queryClient, 'patient-1');

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.list('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.stats('patient-1'),
    });
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
      queryKey: timelineKeys.all,
    });
  });

  it('invalidates encounter list, detail, and patient encounter queries together', async () => {
    await invalidateEncounterMutationQueries(queryClient, {
      encounterId: 'enc-1',
      patientId: 'patient-1',
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: encounterKeys.lists(),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: encounterKeys.detail('enc-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: encounterKeys.forPatient('patient-1'),
    });
  });

  it('invalidates only doctor operational dashboards instead of all dashboards', async () => {
    await invalidateOperationalDoctorDashboardQueries(queryClient);

    const predicateCall = invalidateQueriesSpy.mock.calls.find(
      ([config]) => typeof config?.predicate === 'function',
    );

    expect(predicateCall).toBeTruthy();

    const predicate = predicateCall[0].predicate;

    expect(predicate({ queryKey: ['dashboards', 'my-work', { filters: {} }] })).toBe(true);
    expect(predicate({ queryKey: ['dashboards', 'clinic', { filters: {} }] })).toBe(true);
    expect(predicate({ queryKey: ['dashboards', 'admin'] })).toBe(false);
    expect(predicate({ queryKey: ['dashboards', 'nurse', { filters: {} }] })).toBe(false);
  });

  it('invalidates waiting-room, doctor dashboards, and encounter detail for visit mutations', async () => {
    await invalidateVisitMutationQueries(queryClient, 'enc-1');

    const predicates = invalidateQueriesSpy.mock.calls
      .map(([config]) => config?.predicate)
      .filter(Boolean);

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: visitKeys.detail('enc-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: encounterKeys.lists(),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: encounterKeys.detail('enc-1'),
    });

    expect(
      predicates.some((predicate) => predicate({ queryKey: ['visits', 'waiting-room', 'clinic-1'] })),
    ).toBe(true);
    expect(
      predicates.some((predicate) => predicate({ queryKey: ['visits', 'detail', 'enc-1'] })),
    ).toBe(false);
  });

  it('invalidates chart assignment detail and patient-scoped assignment lists', async () => {
    await invalidateChartAssignmentMutationQueries(queryClient, {
      assignmentId: 'assignment-1',
      patientId: 'patient-1',
    });

    const predicateCall = invalidateQueriesSpy.mock.calls.find(
      ([config]) => typeof config?.predicate === 'function',
    );

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: chartKeys.assignmentDetail('assignment-1'),
    });
    expect(predicateCall).toBeTruthy();

    const predicate = predicateCall[0].predicate;

    expect(
      predicate({ queryKey: chartKeys.assignmentListParams('patient-1', undefined, undefined, 'active') }),
    ).toBe(true);
    expect(
      predicate({ queryKey: chartKeys.assignmentsByPatient('patient-1', 'active') }),
    ).toBe(true);
    expect(
      predicate({ queryKey: chartKeys.assignmentListParams('patient-2', undefined, undefined, 'active') }),
    ).toBe(false);
  });

  it('invalidates assignment-scoped chart entry queries and the patient timeline', async () => {
    await invalidateChartEntryMutationQueries(queryClient, {
      assignmentId: 'assignment-1',
      patientId: 'patient-1',
      entryId: 'entry-1',
    });

    const predicates = invalidateQueriesSpy.mock.calls
      .map(([config]) => config?.predicate)
      .filter(Boolean);

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: chartKeys.assignmentDetail('assignment-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: chartKeys.entryDetail('entry-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: chartKeys.entrySummary('assignment-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: chartKeys.entriesByPatient('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.list('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.stats('patient-1'),
    });

    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: chartKeys.entryList({ assignment: 'assignment-1', include_data: true }) }),
      ),
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: chartKeys.entryTrends('assignment-1', 'temperature') }),
      ),
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: chartKeys.entryList({ assignment: 'assignment-2' }) }),
      ),
    ).toBe(false);
  });

  it('invalidates clinical note entry, encounter list, and patient timeline together', async () => {
    await invalidateClinicalNoteMutationQueries(queryClient, {
      entryId: 'note-1',
      encounterId: 'enc-1',
      patientId: 'patient-1',
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: clinicalNotesKeys.entries(),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: clinicalNotesKeys.entry('note-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: clinicalNotesKeys.entriesByEncounter('enc-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.list('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.stats('patient-1'),
    });
  });

  it('invalidates patient-scoped prescription lists, detail, and timeline together', async () => {
    await invalidatePrescriptionMutationQueries(queryClient, {
      prescriptionId: 'rx-1',
      patientId: 'patient-1',
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: prescriptionKeys.detail('rx-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: prescriptionKeys.list('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: prescriptionKeys.active('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.list('patient-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: timelineKeys.stats('patient-1'),
    });
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
      queryKey: prescriptionKeys.all,
    });
  });

  it('falls back to broad prescription invalidation when the patient scope is unknown', async () => {
    await invalidatePrescriptionMutationQueries(queryClient, {
      prescriptionId: 'rx-1',
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: prescriptionKeys.detail('rx-1'),
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: prescriptionKeys.all,
    });
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
      queryKey: timelineKeys.list('patient-1'),
    });
  });
});
