import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {toast} from 'sonner';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import isToday from 'date-fns/isToday';
import isSameDay from 'date-fns/isSameDay';

import { useNavigate } from 'react-router-dom';
import { fetchAppointments } from '@/features/appointments/api';

const AppointmentCalendar = ({ practitionerId, patientId, onSelectDate, onCreateAppointment }) => {
  const [date, setDate] = useState(new Date());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  // Function to load appointments for the selected month
  const loadAppointments = async () => {
    setLoading(true);
    try {
      // Get first and last day of the month
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      // Format dates for API
      const startDate = format(firstDay, 'yyyy-MM-dd');
      const endDate = format(lastDay, 'yyyy-MM-dd');

      // Build query parameters
      const params = new URLSearchParams();
      params.append('date', `${startDate},${endDate}`);

      if (practitionerId) {
        params.append('practitioner_id', practitionerId);
      }

      if (patientId) {
        params.append('patient_id', patientId);
      }

      // Fetch appointments
      const response = await fetchAppointments(params);

      // Process appointments
      let appointmentData = [];
      if (response && response.entry) {
        appointmentData = response.entry
          .filter(entry => entry.resource && entry.resource.resourceType === 'Appointment')
          .map(entry => entry.resource);
      }

      setAppointments(appointmentData);
    } catch (error) {
      console.error('Error loading appointments:', error);
      toast.error('Failed to load appointments. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Load appointments when the date changes
  useEffect(() => {
    loadAppointments();
  }, [date, practitionerId, patientId]);

  // Function to get appointments for a specific day
  const getAppointmentsForDay = (day) => {
    return appointments.filter(appointment => {
      const appointmentDate = parseISO(appointment.start);
      return isSameDay(appointmentDate, day);
    });
  };

  // Function to render appointment badges on calendar days
  const renderAppointmentBadges = (day) => {
    const dayAppointments = getAppointmentsForDay(day);

    if (dayAppointments.length === 0) return null;

    return (
      <div className="absolute bottom-0 left-0 right-0 flex justify-center">
        <Badge variant="outline" className="text-xs">
          {dayAppointments.length} {dayAppointments.length === 1 ? 'appt' : 'appts'}
        </Badge>
      </div>
    );
  };

  // Function to handle date selection
  const handleSelect = (selectedDate) => {
    setDate(selectedDate);
    if (onSelectDate) {
      const dayAppointments = getAppointmentsForDay(selectedDate);
      onSelectDate(selectedDate, dayAppointments);
    }
  };

  // Function to navigate to appointment creation
  const handleCreateAppointment = () => {
    if (onCreateAppointment) {
      onCreateAppointment(date);
    } else {
      navigate('/appointments/create', { state: { date: date.toISOString() } });
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Appointments</CardTitle>
          <Button variant="outline" size="sm" onClick={handleCreateAppointment}>
            <Plus className="size-4 mr-2" />
            New Appointment
          </Button>
        </div>
        <CardDescription>
          View and manage your appointments
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-[350px] w-full" />
          </div>
        ) : (
          <Calendar
            mode="single"
            selected={date}
            onSelect={handleSelect}
            className="rounded-md border"
            components={{
              DayContent: ({ day, displayMonth, activeModifiers, ...dayProps }) => {
                // Check if day is a valid date object
                const isValidDate = day instanceof Date && !isNaN(day);
                if (!isValidDate) {
                  return <div className="relative size-full flex items-center justify-center"></div>;
                }

                return (
                  <div className="relative size-full flex items-center justify-center">
                    <span className={isToday(day) ? 'font-bold' : ''}>
                      {day.getDate()}
                    </span>
                    {renderAppointmentBadges(day)}
                  </div>
                );
              },
            }}
          />
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() - 1, 1))}
        >
          <ChevronLeft className="size-4 mr-2" />
          Previous Month
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() + 1, 1))}
        >
          Next Month
          <ChevronRight className="size-4 ml-2" />
        </Button>
      </CardFooter>
    </Card>
  );
};

export default AppointmentCalendar;
