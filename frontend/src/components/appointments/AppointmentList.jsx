import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { cn } from '@/lib/utils';
import VirtualizedTable from '@/components/ui/VirtualizedTable';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import PatientContextPanel from '@/components/patients/PatientContextPanel';
import { getAppointmentPatientId } from '@/components/patients/patient-context-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import { useAppointments } from '@/features/appointments/hooks/useAppointmentQueries';
import { PageState } from '@/shared/components/page/PageState';
import { useListFilters } from '@/shared/hooks/useListFilters';

const AppointmentList = () => {
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

  // Build query parameters
  // Note: Backend automatically filters by practitioner for doctors/nurses
  const queryParams = {};

  if (status && status !== 'all') {
    queryParams.status = status;
  }

  if (date) {
    queryParams.date = date;
  }

  // Add pagination
  queryParams.page = page;
  queryParams.limit = pageSize;

  // Use React Query to fetch appointments
  const {
    data: appointmentsData,
    isLoading,
    isError,
    error,
    refetch
  } = useAppointments(queryParams);

  // Process appointments data
  let appointments = [];
  let totalPages = 1;

  if (appointmentsData) {
    // Extract appointments from response
    if (appointmentsData.entry) {
      appointments = [];
      for (const entry of appointmentsData.entry) {
        if (entry.resource && entry.resource.resourceType === 'Appointment') {
          appointments.push(entry.resource);
        }
      }
    } else if (Array.isArray(appointmentsData)) {
      appointments = appointmentsData;
    } else if (appointmentsData.results) {
      appointments = appointmentsData.results;
    }

    // Apply client-side search if needed
    if (search) {
      appointments = appointments.filter(appointment => {
        // Search in patient and practitioner names (local and FHIR shapes)
        const patientName = (() => {
          if (appointment.patient_name) return appointment.patient_name;
          if (appointment.patient_details?.user_details) {
            const first = appointment.patient_details.user_details.first_name || '';
            const last = appointment.patient_details.user_details.last_name || '';
            return `${first} ${last}`.replace(/\s+/g, ' ').trim();
          }
          return (
            appointment.participant?.find((p) =>
              p.actor?.reference?.startsWith('Patient/')
            )?.actor?.display || ''
          );
        })();

        const practitionerName = (() => {
          if (appointment.practitioner_name) return appointment.practitioner_name;
          if (appointment.practitioner_details?.staff_details?.user_details) {
            const first = appointment.practitioner_details.staff_details.user_details.first_name || '';
            const last = appointment.practitioner_details.staff_details.user_details.last_name || '';
            return `${first} ${last}`.replace(/\s+/g, ' ').trim();
          }
          return (
            appointment.participant?.find((p) =>
              p.actor?.reference?.startsWith('Practitioner/')
            )?.actor?.display || ''
          );
        })();

        // Search in description and comment
        const description = appointment.description || '';
        const comment = appointment.comment || '';

        return (
          patientName.toLowerCase().includes(search.toLowerCase()) ||
          practitionerName.toLowerCase().includes(search.toLowerCase()) ||
          description.toLowerCase().includes(search.toLowerCase()) ||
          comment.toLowerCase().includes(search.toLowerCase())
        );
      });
    }

    // Calculate total pages
    const totalCount = appointmentsData.total || appointments.length;
    totalPages = Math.ceil(totalCount / pageSize);
  }

  // Show error toast if query fails
  useEffect(() => {
    if (isError) {
      toast.error(error?.message || 'Failed to load appointments. Please try again.');
    }
  }, [isError, error]);

  // Handle search
  const handleSearch = (e) => {
    updateSearch(e.target.value);
  };

  // Handle status filter change
  const handleStatusFilterChange = (value) => {
    updateStatus(value);
  };

  // Handle date filter change
  const handleDateFilterChange = (value) => {
    updateDate(value);
  };

  // Navigate to appointment detail
  const viewAppointmentDetail = (appointmentId) => {
    navigate(`/appointments/${appointmentId}`);
  };

  const handlePatientContext = (appointment) => {
    setContextAppointment(appointment);
    setContextOpen(true);
  };

  const handleCloseContext = () => {
    setContextOpen(false);
    setContextAppointment(null);
  };

  // Navigate to create appointment
  const createAppointment = () => {
    navigate('/appointments/create');
  };

  // Format date and time
  const formatDateTime = (dateTimeString) => {
    if (!dateTimeString) return 'N/A';
    try {
      const dateTime = parseISO(dateTimeString);
      return format(dateTime, 'MMM d, yyyy h:mm a');
    } catch (error) {
      return 'Invalid date';
    }
  };

  // Get patient name from appointment
  const getPatientName = (appointment) => {
    if (!appointment) return 'Unknown Patient';
    if (appointment.patient_name) return appointment.patient_name;
    if (appointment.patient_details?.user_details) {
      const first = appointment.patient_details.user_details.first_name || '';
      const last = appointment.patient_details.user_details.last_name || '';
      const full = `${first} ${last}`.replace(/\s+/g, ' ').trim();
      if (full) return full;
    }
    const patientParticipant = appointment.participant?.find((p) =>
      p.actor?.reference?.startsWith('Patient/')
    );
    return patientParticipant?.actor?.display || 'Unknown Patient';
  };

  // Get practitioner name from appointment
  const getPractitionerName = (appointment) => {
    if (!appointment) return 'Unknown Practitioner';
    if (appointment.practitioner_name) return appointment.practitioner_name;
    if (!appointment.practitioner) return 'Assigned at check-in';
    if (appointment.practitioner_details?.staff_details?.user_details) {
      const first = appointment.practitioner_details.staff_details.user_details.first_name || '';
      const last = appointment.practitioner_details.staff_details.user_details.last_name || '';
      const full = `${first} ${last}`.replace(/\s+/g, ' ').trim();
      if (full) return full;
    }
    const practitionerParticipant = appointment.participant?.find((p) =>
      p.actor?.reference?.startsWith('Practitioner/')
    );
    return practitionerParticipant?.actor?.display || 'Unknown Practitioner';
  };

  const getStatusConfig = (status) => {
    switch (status) {
      case 'proposed':
        return { className: 'border-sky-200 bg-sky-50 text-sky-700', label: 'Proposed' };
      case 'pending':
        return { className: 'border-amber-200 bg-amber-50 text-amber-700', label: 'Pending' };
      case 'booked':
        return { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Booked' };
      case 'arrived':
        return { className: 'border-amber-200 bg-amber-50 text-amber-700', label: 'Arrived' };
      case 'fulfilled':
        return { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Fulfilled' };
      case 'cancelled':
        return { className: 'border-rose-200 bg-rose-50 text-rose-700', label: 'Cancelled' };
      case 'noshow':
        return { className: 'border-border bg-muted text-muted-foreground', label: 'No Show' };
      default:
        return { className: 'border-border bg-muted text-muted-foreground', label: status || 'Unknown' };
    }
  };

  const appointmentColumns = useMemo(() => ([
    {
      key: 'patient',
      header: 'Patient',
      width: '240px',
      render: (appointment) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{getPatientName(appointment)}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {appointment.patient_identifier || appointment.patient_mrn || appointment.description || 'Appointment'}
          </p>
        </div>
      ),
    },
    {
      key: 'practitioner',
      header: 'Practitioner',
      width: '220px',
      render: (appointment) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">{getPractitionerName(appointment)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {appointment.service_category?.[0]?.coding?.[0]?.display || appointment.specialty?.[0]?.coding?.[0]?.display || 'Assigned care team'}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Appointment',
      width: '220px',
      render: (appointment) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">
            {appointment.appointment_type_name ||
              appointment.appointment_type_details?.name ||
              appointment.appointmentType?.coding?.[0]?.display ||
              'General'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {appointment.comment || appointment.reason_code?.[0]?.text || 'No notes'}
          </p>
        </div>
      ),
    },
    {
      key: 'scheduled',
      header: 'Scheduled',
      width: '180px',
      render: (appointment) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatDateTime(appointment.start || appointment.start_time)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (appointment) => {
        const statusConfig = getStatusConfig(appointment.status);
        return (
          <Badge variant="outline" className={cn('text-xs', statusConfig.className)}>
            {statusConfig.label}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: canOpenContext ? '148px' : '88px',
      render: (appointment) => (
        <div className="flex items-center justify-end gap-2">
          {canOpenContext && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                handlePatientContext(appointment);
              }}
            >
              Patient
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              viewAppointmentDetail(appointment.id);
            }}
          >
            View
          </Button>
        </div>
      ),
    },
  ]), [canOpenContext]);

  // Render loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // Render error state
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
      {/* Search and Quick Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search appointments..."
            className="pl-10 font-mono text-sm"
            value={search}
            onChange={handleSearch}
          />
        </div>

        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className={cn("font-mono text-xs", hasActiveFilters && "border-primary text-primary")}
        >
          <Filter className="size-4 mr-2" />
          Filters
          {hasActiveFilters && <span className="ml-2 size-2 rounded-full bg-primary" />}
        </Button>

        <Button onClick={createAppointment} className="font-mono text-xs">
          <Plus className="mr-2 size-4" />
          New Appointment
        </Button>
      </div>

      {/* Expanded Filters */}
      {showFilters && (
        <div className={cn(
          "bg-card border border-border rounded-2xl p-6",
          "animate-chronicle-enter"
        )}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg text-foreground">Filter Appointments</h3>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="font-mono text-xs text-muted-foreground"
              >
                <X className="size-3 mr-1" />
                Clear All
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
	              <span className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
	                Status
	              </span>
	              <Select value={status} onValueChange={handleStatusFilterChange}>
	                <SelectTrigger aria-label="Filter appointments by status" className="w-[180px] font-mono text-sm">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="proposed">Proposed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="booked">Booked</SelectItem>
                  <SelectItem value="arrived">Arrived</SelectItem>
                  <SelectItem value="fulfilled">Fulfilled</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="noshow">No Show</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
	              <span className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
	                Date
	              </span>
              <Popover>
                <PopoverTrigger asChild>
	                  <Button variant="outline" className="w-[180px] font-mono text-sm justify-start" aria-label="Filter appointments by date">
                    <CalendarIcon className="mr-2 size-4" />
                    {date ? format(parseISO(date), 'MMM d, yyyy') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date ? parseISO(date) : undefined}
                    onSelect={(nextDate) => handleDateFilterChange(nextDate ? format(nextDate, 'yyyy-MM-dd') : '')}
                    initialFocus={true}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      )}

      {/* Appointments List */}
      {appointments.length === 0 ? (
        <div className={cn(
          "bg-card/50 border border-border rounded-2xl p-12 text-center",
          "animate-chronicle-enter"
        )}>
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <CalendarIcon className="size-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl text-foreground mb-2">No Appointments Found</h3>
          <p className="text-muted-foreground text-sm mb-6">
            No appointments match your current filters.
          </p>
          <Button onClick={createAppointment} className="font-mono text-xs">
            <Plus className="size-4 mr-2" />
            Create New Appointment
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={appointments}
            rowKey={(appointment) => appointment.id}
            rowHeight={68}
            columns={appointmentColumns}
            onRowClick={(appointment) => viewAppointmentDetail(appointment.id)}
            rowClassName="hover:bg-muted/30"
            className="min-w-[1140px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(prev => Math.max(prev - 1, 1))}
              disabled={page === 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
              disabled={page === totalPages}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

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
};

export default AppointmentList;
