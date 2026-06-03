import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import PatientContextPanel from '@/components/patients/PatientContextPanel';
import { getAppointmentPatientId } from '@/components/patients/patient-context-utils';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useAppointments } from '@/features/appointments/hooks/useAppointmentQueries';
import { PageState } from '@/shared/components/page/PageState';
import { useListFilters } from '@/shared/hooks/useListFilters';
import { createReturnToLocation } from '@/shared/lib/returnTo';

import { AppointmentListEmptyState } from './AppointmentListEmptyState';
import { AppointmentListFilters } from './AppointmentListFilters';
import { AppointmentListLoadingState } from './AppointmentListLoadingState';
import { AppointmentListPagination } from './AppointmentListPagination';
import { AppointmentListTable } from './AppointmentListTable';
import { AppointmentListToolbar } from './AppointmentListToolbar';
import { RUST_V2_STATUS_OPTIONS } from './appointmentListConstants';
import {
  getPatientName,
  normalizeAppointmentListData,
} from './appointmentListUtils';

export default function AppointmentList() {
  const { user } = useAuth();
  const userRole = user?.role || user?.user_type;
  const canOpenContext = ['receptionist', 'admin'].includes(userRole);
  const {
    search,
    status,
    date,
    page,
    pageSize,
    setPage,
    updateSearch,
    updateStatus,
    updateDate,
    clearFilters,
  } = useListFilters({
    initialStatus: 'all',
    pageSize: 10,
    persistKey: 'appointments:listFilters',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextAppointment, setContextAppointment] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const rustV2Mode = isRustV2ApiMode();
  const showSearch = true;
  const showStatusFilter = true;
  const effectiveHasActiveFilters = Boolean(date)
    || Boolean(search.trim())
    || (status && status !== 'all');
  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: pageSize,
    };

    if (status && status !== 'all') {
      params.status = status;
    }

    if (search.trim()) {
      params.search = search.trim();
    }

    if (date) {
      params.date = date;
    }

    return params;
  }, [date, page, pageSize, search, status]);
  const {
    data: appointmentsData,
    isLoading,
    isError,
    error,
    refetch,
  } = useAppointments(queryParams);
  const {
    appointments,
    countExact,
    hasNextPage,
    totalCount,
    totalPages,
  } = useMemo(
    () => normalizeAppointmentListData(appointmentsData, '', pageSize),
    [appointmentsData, pageSize]
  );

  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load appointments. Please try again.');
    }
  }, [isError, error]);

  const handleSearch = (event) => {
    updateSearch(event.target.value);
  };

  const viewAppointmentDetail = useCallback((appointmentId) => {
    navigate(`/appointments/${appointmentId}`, {
      state: {
        returnTo: createReturnToLocation(location),
      },
    });
  }, [location, navigate]);

  const handlePatientContext = useCallback((appointment) => {
    setContextAppointment(appointment);
    setContextOpen(true);
  }, []);

  const handleCloseContext = () => {
    setContextOpen(false);
    setContextAppointment(null);
  };

  const createAppointment = () => {
    navigate('/appointments/create');
  };

  if (isLoading) {
    return <AppointmentListLoadingState />;
  }

  if (isError) {
    return (
      <PageState
        variant="error"
        title="Error Loading Appointments"
        description={error?.message || 'Failed to load appointments.'}
        action={() => refetch()}
        fullHeight={false}
        className="min-h-[60vh]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <AppointmentListToolbar
        filtersState={{ hasActiveFilters: effectiveHasActiveFilters, showFilters }}
        onCreateAppointment={createAppointment}
        onSearchChange={handleSearch}
        onToggleFilters={() => setShowFilters((visible) => !visible)}
        search={search}
        showSearch={showSearch}
      />

      {showFilters && (
        <AppointmentListFilters
          date={date}
          hasActiveFilters={effectiveHasActiveFilters}
          onClearFilters={clearFilters}
          onDateChange={updateDate}
          onStatusChange={updateStatus}
          showStatus={showStatusFilter}
          status={status}
          statusOptions={rustV2Mode ? RUST_V2_STATUS_OPTIONS : undefined}
        />
      )}

      {appointments.length === 0 ? (
        <AppointmentListEmptyState onCreateAppointment={createAppointment} />
      ) : (
        <AppointmentListTable
          appointments={appointments}
          canOpenContext={canOpenContext}
          onOpenPatientContext={handlePatientContext}
          onViewAppointment={viewAppointmentDetail}
        />
      )}

      <AppointmentListPagination
        canJumpToPage={!rustV2Mode}
        countExact={countExact}
        hasNextPage={hasNextPage}
        page={page}
        pageSize={pageSize}
        setPage={setPage}
        totalCount={totalCount}
        totalPages={totalPages}
      />

      {contextOpen && contextAppointment && (
        <PatientContextPanel
          open
          onClose={handleCloseContext}
          mode="reception"
          patientId={
            contextAppointment?.patient_details?.id ||
            contextAppointment?.patient?.id ||
            contextAppointment?.patient ||
            null
          }
          fhirPatientId={getAppointmentPatientId(contextAppointment)}
          patientContext={contextAppointment.hms_patient_context}
          patientName={getPatientName(contextAppointment)}
        />
      )}
    </div>
  );
}
