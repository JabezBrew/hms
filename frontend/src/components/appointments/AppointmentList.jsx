import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  UserRound,
  Search,
  Plus,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import PatientContextPanel, { getAppointmentPatientId } from '@/components/patients/PatientContextPanel';
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
import { useAppointments } from '@/hooks/useAppointmentQueries';

const AppointmentList = () => {
  const { user } = useAuth();
  const userRole = user?.role || user?.user_type;
  const canOpenContext = ['receptionist', 'admin'].includes(userRole);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [showFilters, setShowFilters] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextAppointment, setContextAppointment] = useState(null);

  const navigate = useNavigate();

  // Build query parameters
  const queryParams = {};

  if (statusFilter && statusFilter !== 'all') {
    queryParams.status = statusFilter;
  }

  if (dateFilter) {
    queryParams.date = dateFilter;
  }

  // Add pagination
  queryParams.page = currentPage;
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
      appointments = appointmentsData.entry
        .filter(entry => entry.resource && entry.resource.resourceType === 'Appointment')
        .map(entry => entry.resource);
    } else if (Array.isArray(appointmentsData)) {
      appointments = appointmentsData;
    } else if (appointmentsData.results) {
      appointments = appointmentsData.results;
    }

    // Apply client-side search if needed
    if (searchTerm) {
      appointments = appointments.filter(appointment => {
        // Search in patient and practitioner names
        const patientName = appointment.participant?.find(p =>
          p.actor?.reference?.startsWith('Patient/'))?.actor?.display || '';

        const practitionerName = appointment.participant?.find(p =>
          p.actor?.reference?.startsWith('Practitioner/'))?.actor?.display || '';

        // Search in description and comment
        const description = appointment.description || '';
        const comment = appointment.comment || '';

        return (
          patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          practitionerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          comment.toLowerCase().includes(searchTerm.toLowerCase())
        );
      });
    }

    // Calculate total pages
    const totalCount = appointmentsData.total || appointments.length;
    totalPages = Math.ceil(totalCount / pageSize);
  }

  // Show error toast if query fails
  if (isError) {
    toast.error(error?.message || 'Failed to load appointments. Please try again.');
  }

  // Handle search
  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  // Handle status filter change
  const handleStatusFilterChange = (value) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  // Handle date filter change
  const handleDateFilterChange = (value) => {
    setDateFilter(value);
    setCurrentPage(1);
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFilter('');
    setCurrentPage(1);
  };

  // Check if filters are active
  const hasActiveFilters = searchTerm || statusFilter !== 'all' || dateFilter;

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
    const patientParticipant = appointment.participant?.find(p =>
      p.actor?.reference?.startsWith('Patient/'));
    return patientParticipant?.actor?.display || 'Unknown Patient';
  };

  // Get practitioner name from appointment
  const getPractitionerName = (appointment) => {
    const practitionerParticipant = appointment.participant?.find(p =>
      p.actor?.reference?.startsWith('Practitioner/'));
    return practitionerParticipant?.actor?.display || 'Unknown Practitioner';
  };

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
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">Error Loading Appointments</h2>
          <p className="text-muted-foreground">{error?.message || 'Failed to load appointments.'}</p>
          <Button onClick={() => refetch()} className="font-mono text-xs">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search and Quick Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search appointments..."
            className="pl-10 font-mono text-sm"
            value={searchTerm}
            onChange={handleSearch}
          />
        </div>

        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className={cn("font-mono text-xs", hasActiveFilters && "border-primary text-primary")}
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
          {hasActiveFilters && <span className="ml-2 w-2 h-2 rounded-full bg-primary" />}
        </Button>

        <Button onClick={createAppointment} className="font-mono text-xs">
          <Plus className="mr-2 h-4 w-4" />
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
                <X className="h-3 w-3 mr-1" />
                Clear All
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Status
              </label>
              <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                <SelectTrigger className="w-[180px] font-mono text-sm">
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
              <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[180px] font-mono text-sm justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFilter ? format(parseISO(dateFilter), 'MMM d, yyyy') : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dateFilter ? parseISO(dateFilter) : undefined}
                    onSelect={(date) => handleDateFilterChange(date ? format(date, 'yyyy-MM-dd') : '')}
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
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <CalendarIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl text-foreground mb-2">No Appointments Found</h3>
          <p className="text-muted-foreground text-sm mb-6">
            No appointments match your current filters.
          </p>
          <Button onClick={createAppointment} className="font-mono text-xs">
            <Plus className="h-4 w-4 mr-2" />
            Create New Appointment
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appointment, index) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              index={index}
              formatDateTime={formatDateTime}
              getPatientName={getPatientName}
              getPractitionerName={getPractitionerName}
              onClick={() => viewAppointmentDetail(appointment.id)}
              onPatientContext={canOpenContext ? handlePatientContext : null}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {contextOpen && contextAppointment && (
        <PatientContextPanel
          open
          onClose={handleCloseContext}
          mode="reception"
          fhirPatientId={getAppointmentPatientId(contextAppointment)}
          patientContext={contextAppointment.hms_patient_context}
          patientName={getPatientName(contextAppointment)}
        />
      )}
    </div>
  );
};

/**
 * AppointmentCard - Individual appointment card in Chronicle style
 */
function AppointmentCard({
  appointment,
  index,
  formatDateTime,
  getPatientName,
  getPractitionerName,
  onClick,
  onPatientContext,
}) {
  const getStatusConfig = (status) => {
    switch (status) {
      case 'proposed':
        return { badge: 'badge-chronicle-sky', label: 'Proposed' };
      case 'pending':
        return { badge: 'badge-chronicle-amber', label: 'Pending' };
      case 'booked':
        return { badge: 'badge-chronicle-emerald', label: 'Booked' };
      case 'arrived':
        return { badge: 'badge-chronicle-amber', label: 'Arrived', ribbon: 'status-ribbon-warning' };
      case 'fulfilled':
        return { badge: 'badge-chronicle-emerald', label: 'Fulfilled' };
      case 'cancelled':
        return { badge: 'badge-chronicle-rose', label: 'Cancelled' };
      case 'noshow':
        return { badge: 'font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground', label: 'No Show' };
      default:
        return { badge: 'font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground', label: status || 'Unknown' };
    }
  };

  const statusConfig = getStatusConfig(appointment.status);
  const patientName = getPatientName(appointment);
  const practitionerName = getPractitionerName(appointment);
  const appointmentType = appointment.appointmentType?.coding?.[0]?.display || 'General';

  return (
    <article
      className={cn(
        "group relative bg-card/50 border border-border rounded-xl p-5",
        "hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]",
        "transition-all duration-300 cursor-pointer",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      {statusConfig.ribbon && <div className={cn("status-ribbon", statusConfig.ribbon)} />}

      <div className="flex items-center gap-4">
        {/* Avatar */}
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-display text-primary border-2 border-background">
          {patientName.split(' ').map(n => n[0]).join('').slice(0, 2)}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-display text-xl text-foreground truncate">
              {patientName}
            </h3>
            <span className={statusConfig.badge}>
              {statusConfig.label}
            </span>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {appointmentType}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <Clock className="h-3 w-3" />
              {formatDateTime(appointment.start)}
            </span>
            <span className="flex items-center gap-1.5">
              <UserRound className="h-3 w-3" />
              {practitionerName}
            </span>
          </div>
        </div>

        {/* Hover Action */}
        <div className="flex items-center gap-2">
          {onPatientContext && (
            <Button
              variant="ghost"
              size="sm"
              className="font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(event) => {
                event.stopPropagation();
                onPatientContext(appointment);
              }}
            >
              Patient
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            View
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export default AppointmentList;
