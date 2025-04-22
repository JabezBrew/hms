import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
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
  ChevronRight
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {toast} from 'sonner';
import { useAppointments } from '@/hooks/useAppointmentQueries';

// Status badge colors
const statusColors = {
  proposed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  booked: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  arrived: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  fulfilled: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  noshow: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

const AppointmentList = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

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
    error 
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
    setCurrentPage(1); // Reset to first page on new search
  };

  // Handle status filter change
  const handleStatusFilterChange = (value) => {
    setStatusFilter(value);
    setCurrentPage(1); // Reset to first page on filter change
  };

  // Handle date filter change
  const handleDateFilterChange = (value) => {
    setDateFilter(value);
    setCurrentPage(1); // Reset to first page on filter change
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFilter('');
    setCurrentPage(1);
  };

  // Navigate to appointment detail
  const viewAppointmentDetail = (appointmentId) => {
    navigate(`/appointments/${appointmentId}`);
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

  // Render loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="flex space-x-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="border rounded-md">
          <div className="border-b h-12 px-4 flex items-center">
            <Skeleton className="h-4 w-full" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-b p-4 flex justify-between items-center">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-24" />
          <div className="flex space-x-2">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Appointments</CardTitle>
          <Button onClick={createAppointment}>
            <Plus className="mr-2 h-4 w-4" /> New Appointment
          </Button>
        </div>
        <CardDescription>
          View and manage all appointments
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search appointments..."
              className="pl-8"
              value={searchTerm}
              onChange={handleSearch}
            />
          </div>

          <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
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

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[180px]">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateFilter ? format(parseISO(dateFilter), 'MMM d, yyyy') : 'Filter by date'}
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

          {(searchTerm || statusFilter || dateFilter) && (
            <Button variant="ghost" onClick={clearFilters} className="px-2 sm:px-3">
              <X className="h-4 w-4" />
              <span className="ml-2 hidden sm:inline">Clear Filters</span>
            </Button>
          )}
        </div>

        {/* Appointments Table */}
        {appointments.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-muted-foreground mb-2">No appointments found</div>
            <Button variant="outline" onClick={createAppointment}>
              <Plus className="mr-2 h-4 w-4" /> Create New Appointment
            </Button>
          </div>
        ) : (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Practitioner</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {appointments.map((appointment) => (
                  <TableRow 
                    key={appointment.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => viewAppointmentDetail(appointment.id)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <User className="h-4 w-4 mr-2 text-muted-foreground" />
                        {getPatientName(appointment)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <UserRound className="h-4 w-4 mr-2 text-muted-foreground" />
                        {getPractitionerName(appointment)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                        {formatDateTime(appointment.start)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {appointment.appointmentType?.coding?.[0]?.display || 'General'}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className={statusColors[appointment.status] || ""}
                      >
                        {appointment.status?.charAt(0).toUpperCase() + appointment.status?.slice(1) || 'Unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          viewAppointmentDetail(appointment.id);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Pagination */}
      {totalPages > 1 && (
        <CardFooter className="flex justify-between">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
};

export default AppointmentList;
