import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { fetchUpcomingAppointments } from '@/lib/api';

const AppointmentNotifications = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Load upcoming appointments
  useEffect(() => {
    const loadAppointments = async () => {
      setLoading(true);
      try {
        const data = await fetchUpcomingAppointments();
        setAppointments(data);
      } catch (error) {
        console.error('Error loading upcoming appointments:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAppointments();

    // Refresh appointments every 5 minutes
    const interval = setInterval(loadAppointments, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Navigate to appointment detail
  const handleAppointmentClick = (id) => {
    setOpen(false);
    navigate(`/appointments/${id}`);
  };

  // Get notification count
  const notificationCount = appointments.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {notificationCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 font-medium">
          Upcoming Appointments
        </div>
        <Separator />
        <div className="max-h-80 overflow-auto">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">
              Loading appointments...
            </div>
          ) : appointments.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No upcoming appointments
            </div>
          ) : (
            <div>
              {appointments.map((appointment) => (
                <div 
                  key={appointment.id}
                  className="p-4 hover:bg-muted cursor-pointer"
                  onClick={() => handleAppointmentClick(appointment.id)}
                >
                  <div className="font-medium">{appointment.patientName}</div>
                  <div className="text-sm text-muted-foreground">
                    {appointment.type} - {appointment.startTime}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <Separator />
        <div className="p-2">
          <Button 
            variant="ghost" 
            className="w-full justify-center"
            onClick={() => {
              setOpen(false);
              navigate('/appointments');
            }}
          >
            View All Appointments
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default AppointmentNotifications;