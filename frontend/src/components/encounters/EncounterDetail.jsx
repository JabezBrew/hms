/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useNoteEntriesForEncounter } from '@/features/clinical-notes/hooks';
import { encountersApi } from '@/features/encounters/api';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { EncounterDetailContent } from './EncounterDetailContent';
import { EncounterDetailDialogs } from './EncounterDetailDialogs';
import { EncounterDetailErrorState } from './EncounterDetailErrorState';
import { EncounterDetailHeader } from './EncounterDetailHeader';
import { EncounterDetailLoadingState } from './EncounterDetailLoadingState';
import { EncounterDetailNotFoundState } from './EncounterDetailNotFoundState';
import {
  buildEncounterTimelineEntries,
  getEncounterActionState,
  getEncounterStatusConfig,
  getEncounterTypeConfig,
} from './encounterDetailUtils';

/**
 * EncounterDetail - Chronicle-style encounter view.
 *
 * The module owns encounter-level workflow state and delegates rendering to
 * focused view modules so clinical display, actions, and dialogs remain local.
 */
export function EncounterDetail({ encounter: initialEncounter, loading: initialLoading, isError }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [localEncounter, setLocalEncounter] = useState(null);
  const [showDischargeDialog, setShowDischargeDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [error, setError] = useState(null);

  const encounter = localEncounter?.id === initialEncounter?.id
    ? localEncounter
    : initialEncounter ?? null;

  const {
    data: clinicalNotes = [],
    isLoading: isLoadingNotes,
  } = useNoteEntriesForEncounter(id, { page_size: 200 });

  const timelineEntries = useMemo(
    () => buildEncounterTimelineEntries(clinicalNotes),
    [clinicalNotes]
  );

  const handleDischarge = async () => {
    try {
      setActionInProgress(true);
      await encountersApi.dischargePatient(id, {
        discharge_disposition: 'home',
        destination: 'Home',
      });
      const updatedEncounter = await encountersApi.getEncounter(id);
      setLocalEncounter(updatedEncounter);
      setShowDischargeDialog(false);
    } catch {
      setError('Failed to discharge patient. Please try again.');
    } finally {
      setActionInProgress(false);
    }
  };

  const handleCancel = async () => {
    try {
      setActionInProgress(true);
      await encountersApi.cancelEncounter(id);
      const updatedEncounter = await encountersApi.getEncounter(id);
      setLocalEncounter(updatedEncounter);
      setShowCancelDialog(false);
    } catch {
      setError('Failed to cancel encounter. Please try again.');
    } finally {
      setActionInProgress(false);
    }
  };

  if (initialLoading) {
    return <EncounterDetailLoadingState />;
  }

  if (isError || error) {
    return (
      <EncounterDetailErrorState
        message={error}
        onBack={() => navigate('/encounters')}
      />
    );
  }

  if (!encounter) {
    return <EncounterDetailNotFoundState onBack={() => navigate('/encounters')} />;
  }

  const rustV2Mode = isRustV2ApiMode();
  const actionState = getEncounterActionState(encounter, rustV2Mode);
  const statusConfig = getEncounterStatusConfig(encounter.status);
  const typeConfig = getEncounterTypeConfig(encounter.encounter_type);

  return (
    <div className="min-h-screen bg-background">
      <EncounterDetailHeader
        actionState={actionState}
        encounter={encounter}
        encounterId={id}
        onCancel={() => setShowCancelDialog(true)}
        onDischarge={() => setShowDischargeDialog(true)}
        onNavigate={navigate}
        statusConfig={statusConfig}
        typeConfig={typeConfig}
      />

      <EncounterDetailContent
        actionState={actionState}
        encounter={encounter}
        encounterId={id}
        isLoadingNotes={isLoadingNotes}
        onNavigate={navigate}
        timelineEntries={timelineEntries}
      />

      <EncounterDetailDialogs
        actionInProgress={actionInProgress}
        onCancelEncounter={handleCancel}
        onDischargePatient={handleDischarge}
        setShowCancelDialog={setShowCancelDialog}
        setShowDischargeDialog={setShowDischargeDialog}
        showCancelDialog={showCancelDialog}
        showDischargeDialog={showDischargeDialog}
      />
    </div>
  );
}
