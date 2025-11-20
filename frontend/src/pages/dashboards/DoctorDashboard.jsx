import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useDoctorDashboard } from '@/hooks/useDoctorDashboard';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  User,
  Calendar,
  CheckCircle,
  PlayCircle,
  RefreshCw,
} from 'lucide-react';

export default function DoctorDashboard() {
  const { data, loading, error, refetch } = useDoctorDashboard();
  const navigate = useNavigate();

  const handleStartConsultation = (patient) => {
    const params = new URLSearchParams({
      patient_id: patient.patient_id,
    });
    if (patient.id) {
      params.append('appointment_id', patient.id);
    }
    navigate(`/workflows/consultation?${params.toString()}`);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Error Loading Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{error.message}</p>
          <Button onClick={() => refetch()} className="mt-4">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const statusColors = {
    'arrived': 'bg-blue-100 text-blue-800',
    'in-progress': 'bg-green-100 text-green-800',
    'fulfilled': 'bg-gray-100 text-gray-800',
    'booked': 'bg-purple-100 text-purple-800',
    'cancelled': 'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Today's Clinic</h1>
          <p className="text-muted-foreground mt-1">
            {data.user_name} • {data.date ? new Date(data.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Today'}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Current Patient */}
      {data.current_patient ? (
        <Card className="border-primary">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <PlayCircle className="h-5 w-5 text-primary" />
                  Current Patient
                </CardTitle>
                <CardDescription className="mt-1">
                  {data.current_patient.time_display}
                </CardDescription>
              </div>
              <Badge variant="default">In Progress</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-lg">{data.current_patient.patient_name}</span>
                </div>
                {data.current_patient.reason && (
                  <p className="text-sm text-muted-foreground">
                    Reason: {data.current_patient.reason}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Type: {data.current_patient.appointment_type}
                </p>
              </div>
              <Button onClick={() => handleStartConsultation(data.current_patient)}>
                Begin Consultation
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No current patient</p>
            <p className="text-sm text-muted-foreground mt-1">
              {data.upcoming && data.upcoming.length > 0
                ? 'Next patient arriving soon'
                : 'No appointments scheduled'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Appointments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Upcoming ({data.upcoming?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.upcoming && data.upcoming.length > 0 ? (
            <div className="space-y-3">
              {data.upcoming.map((appointment) => (
                <div
                  key={appointment.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{appointment.patient_name}</span>
                      <Badge
                        variant="outline"
                        className={statusColors[appointment.status] || ''}
                      >
                        {appointment.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {appointment.time_display}
                      </span>
                      {appointment.reason && (
                        <span>{appointment.reason}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartConsultation(appointment)}
                  >
                    Start
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No upcoming appointments
            </p>
          )}
        </CardContent>
      </Card>

      {/* Completed Today */}
      {data.completed && data.completed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Completed Today ({data.completed.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.completed.map((appointment) => (
                <div
                  key={appointment.id}
                  className="flex items-center justify-between p-3 border rounded-lg opacity-60"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="font-medium">{appointment.patient_name}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {appointment.time_display} • {appointment.appointment_type}
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-green-100 text-green-800">
                    Completed
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
