import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import PatientContextPanel from '@/components/patients/PatientContextPanel';
import { getAppointmentPatientId } from '@/components/patients/patient-context-utils';
import { useAuth } from '@/lib/auth';
import { useAppointments } from '@/features/appointments/hooks/useAppointmentQueries';
import { PageState } from '@/shared/components/page/PageState';
import { useListFilters } from '@/shared/hooks/useListFilters';

import { AppointmentListEmptyState } from './AppointmentListEmptyState';
import { AppointmentListFilters } from './AppointmentListFilters';
import { AppointmentListLoadingState } from './AppointmentListLoadingState';
import { AppointmentListPagination } from './AppointmentListPagination';
import { AppointmentListTable } from './AppointmentListTable';
import { AppointmentListToolbar } from './AppointmentListToolbar';
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
    hasActiveFilters,
  } = useListFilters({ initialStatus: 'all', pageSize: 10 });
  const [showFilters, setShowFilters] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextAppointment, setContextAppointment] = useState(null);
  const navigate = useNavigate();
  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: pageSize,
    };

    if (status && status !== 'all') {
      params.status = status;
    }

    if (date) {
      params.date = date;
    }

    return params;
  }, [date, page, pageSize, status]);
  const {
    data: appointmentsData,
    isLoading,
    isError,
    error,
    refetch,
  } = useAppointments(queryParams);
  const { appointments, totalPages } = useMemo(
    () => normalizeAppointmentListData(appointmentsData, search, pageSize),
    [appointmentsData, pageSize, search]
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
    navigate(`/appointments/${appointmentId}`);
  }, [navigate]);

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
        filtersState={{ hasActiveFilters, showFilters }}
        onCreateAppointment={createAppointment}
        onSearchChange={handleSearch}
        onToggleFilters={() => setShowFilters((visible) => !visible)}
        search={search}
      />

      {showFilters && (
        <AppointmentListFilters
          date={date}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          onDateChange={updateDate}
          onStatusChange={updateStatus}
          status={status}
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
        page={page}
        setPage={setPage}
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
