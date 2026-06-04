/* oxlint-disable react-doctor/prefer-useReducer -- These independent dialog and tab states do not share one transition invariant. */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useAvailabilityRules,
  useDeleteAvailabilityRule,
  useBlockedTimes,
  useDeleteBlockedTime,
} from '@/features/appointments/hooks/useAppointmentQueries';
import { useSearchPractitioners } from '@/features/encounters/hooks/useEncounterQueries';
import { usePractitioner } from '@/features/staff/hooks';
import { Skeleton } from '@/components/ui/skeleton';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useUrlEnumParam } from '@/shared/hooks/useUrlEnumParam';

import { AvailabilityCalendarPanel } from './AvailabilityCalendarPanel';
import { AvailabilityDialogs } from './AvailabilityDialogs';
import { AvailabilityHeader } from './AvailabilityHeader';
import { AvailabilitySidebar } from './AvailabilitySidebar';

const AVAILABILITY_TABS = ['schedules', 'blocked'];

const getPractitionerOption = (practitioner) => {
  if (practitioner?.name) {
    return {
      label: practitioner.name,
      value: String(practitioner.id),
    };
  }

  if (practitioner.fhir_resource) {
    const name = practitioner.fhir_resource.name?.[0];
    const given = name?.given?.join(' ') || '';
    const family = name?.family || '';
    const displayName = `${family}, ${given}`.trim() || 'Unknown';
    return {
      label: displayName,
      value: String(practitioner.local_data?.id || practitioner.fhir_resource.id),
    };
  }

  if (practitioner.local_data?.staff_details?.user_details) {
    const user = practitioner.local_data.staff_details.user_details;
    return {
      label: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
      value: String(practitioner.local_data.id),
    };
  }

  if (practitioner.staff_details?.user_details) {
    const user = practitioner.staff_details.user_details;
    return {
      label: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown',
      value: String(practitioner.id),
    };
  }

  return {
    label: practitioner.user?.full_name || 'Unknown',
    value: String(practitioner.id),
  };
};

const getPractitionerLabel = (practitioner) => {
  if (!practitioner) return null;
  if (practitioner.name) return practitioner.name;

  const userDetails = practitioner.staff_details?.user_details
    || practitioner.staff?.user_details
    || practitioner.staff?.user
    || practitioner.user;

  const first = userDetails?.first_name || '';
  const last = userDetails?.last_name || '';
  return `${first} ${last}`.trim() || null;
};

const getActiveBlockedTimes = (blockedTimes) => {
  return blockedTimes.filter((blockedTime) => {
    const endDate = new Date(blockedTime.end_date || blockedTime.date);
    return endDate >= new Date();
  }).length;
};

const PractitionerAvailabilityWorkspace = ({
  isDoctor,
  availabilityMutationsAvailable,
  initialSelectedPractitioner,
  pageMeta,
}) => {
  const [activeTab, setActiveTab] = useUrlEnumParam({
    param: 'tab',
    values: AVAILABILITY_TABS,
    defaultValue: 'schedules',
  });
  const [selectedPractitioner, setSelectedPractitioner] = useState(initialSelectedPractitioner);
  const [isCreateAvailabilityDialogOpen, setIsCreateAvailabilityDialogOpen] = useState(false);
  const [isEditAvailabilityDialogOpen, setIsEditAvailabilityDialogOpen] = useState(false);
  const [isDeleteAvailabilityDialogOpen, setIsDeleteAvailabilityDialogOpen] = useState(false);
  const [selectedAvailabilityRule, setSelectedAvailabilityRule] = useState(null);
  const [availabilityToDelete, setAvailabilityToDelete] = useState(null);
  const [isCreateBlockedTimeDialogOpen, setIsCreateBlockedTimeDialogOpen] = useState(false);
  const [isEditBlockedTimeDialogOpen, setIsEditBlockedTimeDialogOpen] = useState(false);
  const [isDeleteBlockedTimeDialogOpen, setIsDeleteBlockedTimeDialogOpen] = useState(false);
  const [selectedBlockedTime, setSelectedBlockedTime] = useState(null);
  const [blockedTimeToDelete, setBlockedTimeToDelete] = useState(null);

  const scheduleFilters = useMemo(() => {
    if (selectedPractitioner) {
      return { practitioner: selectedPractitioner };
    }
    return {};
  }, [selectedPractitioner]);

  const {
    data: availabilityRules = [],
    isLoading: availabilityLoading,
    isError: isAvailabilityError,
    error: availabilityError,
    refetch: refetchAvailability,
  } = useAvailabilityRules(scheduleFilters);

  const {
    data: blockedTimes = [],
    isLoading: blockedTimesLoading,
    isError: isBlockedTimesError,
    error: blockedTimesError,
    refetch: refetchBlocked,
  } = useBlockedTimes(scheduleFilters);

  const {
    data: practitioners = [],
    isLoading: practitionersLoading,
    setSearchTerm: setPractitionerSearchTerm,
  } = useSearchPractitioners();

  const { data: selectedPractitionerDetails } = usePractitioner(selectedPractitioner);
  const selectedPractitionerLabel = useMemo(
    () => getPractitionerLabel(selectedPractitionerDetails),
    [selectedPractitionerDetails],
  );

  const practitionerOptions = useMemo(() => {
    if (!Array.isArray(practitioners)) return [];

    const options = practitioners.map(getPractitionerOption);
    if (!selectedPractitioner) return options;

    const hasSelectedOption = options.some((option) => option.value === String(selectedPractitioner));
    if (hasSelectedOption) return options;

    return [
      {
        label: selectedPractitionerLabel || 'Selected practitioner',
        value: String(selectedPractitioner),
      },
      ...options,
    ];
  }, [practitioners, selectedPractitioner, selectedPractitionerLabel]);

  const deleteAvailabilityMutation = useDeleteAvailabilityRule();
  const deleteBlockedTimeMutation = useDeleteBlockedTime();

  const stats = useMemo(() => ({
    activeSchedules: availabilityRules.filter((schedule) => schedule.is_active).length,
    totalSchedules: availabilityRules.length,
    activeBlocks: getActiveBlockedTimes(blockedTimes),
    totalBlocks: blockedTimes.length,
  }), [availabilityRules, blockedTimes]);

  const loadErrorMessage = [
    isAvailabilityError && (availabilityError?.message || 'Failed to load personal calendar rules'),
    isBlockedTimesError && (blockedTimesError?.message || 'Failed to load blocked times'),
  ].filter(Boolean).join(' ');

  const handleCreateAvailabilitySuccess = () => {
    setIsCreateAvailabilityDialogOpen(false);
    toast.success('Personal calendar rule created successfully');
  };

  const handleUpdateAvailabilitySuccess = () => {
    setIsEditAvailabilityDialogOpen(false);
    toast.success('Personal calendar rule updated successfully');
  };

  const handleDeleteAvailability = (scheduleId) => {
    deleteAvailabilityMutation.mutate(scheduleId, {
      onSuccess: () => {
        setIsDeleteAvailabilityDialogOpen(false);
        toast.success('Personal calendar rule deleted successfully');
      },
      onError: () => {
        toast.error('Failed to delete personal calendar rule');
      },
    });
  };

  const handleCreateBlockedTimeSuccess = () => {
    setIsCreateBlockedTimeDialogOpen(false);
    toast.success('Time blocked successfully');
  };

  const handleUpdateBlockedTimeSuccess = () => {
    setIsEditBlockedTimeDialogOpen(false);
    toast.success('Blocked time updated successfully');
  };

  const handleDeleteBlockedTime = (id) => {
    deleteBlockedTimeMutation.mutate(id, {
      onSuccess: () => {
        setIsDeleteBlockedTimeDialogOpen(false);
        toast.success('Blocked time deleted successfully');
      },
      onError: () => {
        toast.error('Failed to delete blocked time');
      },
    });
  };

  if (availabilityLoading && blockedTimesLoading) {
    return <AvailabilityLoadingState pageMeta={pageMeta} />;
  }

  return (
    <PageShell>
      {pageMeta}
      <AvailabilityHeader
        isDoctor={isDoctor}
        canMutate={availabilityMutationsAvailable}
        stats={stats}
        onCreateAvailability={() => setIsCreateAvailabilityDialogOpen(true)}
        onCreateBlockedTime={() => setIsCreateBlockedTimeDialogOpen(true)}
      />

      <div className="max-w-7xl mx-auto px-6 py-8">
        {loadErrorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {loadErrorMessage}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <AvailabilityCalendarPanel
              isDoctor={isDoctor}
              practitionerOptions={practitionerOptions}
              practitionersLoading={practitionersLoading}
              selectedPractitioner={selectedPractitioner}
              onPractitionerChange={setSelectedPractitioner}
              onSearchChange={setPractitionerSearchTerm}
              onSlotSelect={(slot) => {
                toast.info(`Selected: ${new Date(slot.start).toLocaleTimeString()} - ${new Date(slot.end).toLocaleTimeString()}`);
              }}
            />
          </div>

          <AvailabilitySidebar
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            availabilityRules={availabilityRules}
            availabilityLoading={availabilityLoading}
            blockedTimes={blockedTimes}
            blockedTimesLoading={blockedTimesLoading}
            canMutate={availabilityMutationsAvailable}
            onCreateAvailability={() => setIsCreateAvailabilityDialogOpen(true)}
            onCreateBlockedTime={() => setIsCreateBlockedTimeDialogOpen(true)}
            onRefetchAvailability={() => refetchAvailability()}
            onRefetchBlocked={() => refetchBlocked()}
            onEditAvailability={(schedule) => {
              setSelectedAvailabilityRule(schedule);
              setIsEditAvailabilityDialogOpen(true);
            }}
            onDeleteAvailability={(schedule) => {
              setAvailabilityToDelete(schedule);
              setIsDeleteAvailabilityDialogOpen(true);
            }}
            onEditBlockedTime={(blocked) => {
              setSelectedBlockedTime(blocked);
              setIsEditBlockedTimeDialogOpen(true);
            }}
            onDeleteBlockedTime={(blocked) => {
              setBlockedTimeToDelete(blocked);
              setIsDeleteBlockedTimeDialogOpen(true);
            }}
          />
        </div>
      </div>

      <AvailabilityDialogs
        isDoctor={isDoctor}
        createAvailabilityOpen={isCreateAvailabilityDialogOpen}
        onCreateAvailabilityOpenChange={setIsCreateAvailabilityDialogOpen}
        editAvailabilityOpen={isEditAvailabilityDialogOpen}
        onEditAvailabilityOpenChange={setIsEditAvailabilityDialogOpen}
        deleteAvailabilityOpen={isDeleteAvailabilityDialogOpen}
        onDeleteAvailabilityOpenChange={setIsDeleteAvailabilityDialogOpen}
        selectedAvailabilityRule={selectedAvailabilityRule}
        availabilityToDelete={availabilityToDelete}
        onCreateAvailabilitySuccess={handleCreateAvailabilitySuccess}
        onUpdateAvailabilitySuccess={handleUpdateAvailabilitySuccess}
        onDeleteAvailability={handleDeleteAvailability}
        createBlockedTimeOpen={isCreateBlockedTimeDialogOpen}
        onCreateBlockedTimeOpenChange={setIsCreateBlockedTimeDialogOpen}
        editBlockedTimeOpen={isEditBlockedTimeDialogOpen}
        onEditBlockedTimeOpenChange={setIsEditBlockedTimeDialogOpen}
        deleteBlockedTimeOpen={isDeleteBlockedTimeDialogOpen}
        onDeleteBlockedTimeOpenChange={setIsDeleteBlockedTimeDialogOpen}
        selectedBlockedTime={selectedBlockedTime}
        blockedTimeToDelete={blockedTimeToDelete}
        onCreateBlockedTimeSuccess={handleCreateBlockedTimeSuccess}
        onUpdateBlockedTimeSuccess={handleUpdateBlockedTimeSuccess}
        onDeleteBlockedTime={handleDeleteBlockedTime}
      />
    </PageShell>
  );
};

function AvailabilityLoadingState({ pageMeta }) {
  return (
    <PageState variant="loading">
      {pageMeta}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-[500px] w-full" />
      </div>
    </PageState>
  );
}

export default PractitionerAvailabilityWorkspace;
