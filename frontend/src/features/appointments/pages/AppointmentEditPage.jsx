import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import AppointmentForm from '@/features/appointments/components/AppointmentForm';
import { Button } from '@/components/ui/button';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { appointmentsApi } from '@/features/appointments/api';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const safeDate = (value) => {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? parseISO(value) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
};

const dateKey = (value) => {
  const date = safeDate(value) || new Date();
  return date.toISOString().slice(0, 10);
};

const addDaysKey = (value, days) => {
  const date = safeDate(value) || new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const formatSlotLabel = (slot) => {
  const start = safeDate(slot?.start);
  const end = safeDate(slot?.end);
  if (!start || !end) return 'Unavailable slot';
  return `${format(start, 'h:mm a')} - ${format(end, 'h:mm a')}`;
};

const formatAppointmentTime = (value) => {
  const date = safeDate(value);
  return date ? format(date, 'EEEE, MMMM d, yyyy h:mm a') : 'Not scheduled';
};

const AppointmentEditPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const rustV2Mode = isRustV2ApiMode();
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [updating, setUpdating] = useState(false);
  const canReschedule = !rustV2Mode
    || appointment?.v2_status === 'scheduled'
    || appointment?.status === 'booked';
  
  // Load appointment data
  useEffect(() => {
    const loadAppointment = async () => {
      try {
        const data = await appointmentsApi.getAppointment(id);

        if (rustV2Mode) {
          setAppointment(data);
          return;
        }
        
        // Extract patient and practitioner IDs from participants
        const patientParticipant = data.participant?.find(p => 
          p.actor?.reference?.startsWith('Patient/'));
        const practitionerParticipant = data.participant?.find(p => 
          p.actor?.reference?.startsWith('Practitioner/'));
        
        const patientId = patientParticipant?.actor?.reference?.split('/')[1] || '';
        const practitionerId = practitionerParticipant?.actor?.reference?.split('/')[1] || '';
        
        // Extract appointment type ID (this would need to be mapped to your local ID)
        const appointmentTypeId = ''; // This would need to be determined based on your data model
        
        // Format data for the form
        const formattedData = {
          patientId,
          practitionerId,
          appointmentTypeId,
          date: data.start,
          description: data.description || '',
          comment: data.comment || '',
        };
        
        setAppointment(formattedData);
      } catch (error) {
        console.error('Error loading appointment:', error);
        toast.error('Failed to load appointment details');
        navigate('/appointments');
      } finally {
        setLoading(false);
      }
    };
    
    loadAppointment();
  }, [id, navigate, rustV2Mode]);

  useEffect(() => {
    if (!rustV2Mode || !appointment || !canReschedule) {
      return;
    }

    const loadSlots = async () => {
      setSlotsLoading(true);
      try {
        const currentStart = appointment.start_time || appointment.start;
        const data = await appointmentsApi.getAvailableSlots({
          start_date: dateKey(currentStart),
          end_date: addDaysKey(currentStart, 2),
        });
        const currentStartMs = safeDate(currentStart)?.getTime();
        setSlots(
          (Array.isArray(data) ? data : [])
            .filter((slot) => safeDate(slot.start)?.getTime() !== currentStartMs)
            .slice(0, 12)
        );
      } catch (error) {
        toast.error(error.message || 'Failed to load appointment slots');
        setSlots([]);
      } finally {
        setSlotsLoading(false);
      }
    };

    loadSlots();
  }, [appointment, canReschedule, rustV2Mode]);
  
  // Handle successful appointment update
  const handleSuccess = (updatedAppointment) => {
    navigate(`/appointments/${updatedAppointment.id}`);
  };

  const handleRustV2Submit = async () => {
    if (!selectedSlot) {
      toast.error('Please select a time slot');
      return;
    }

    setUpdating(true);
    try {
      const updated = await appointmentsApi.updateAppointment(id, {
        start_time: selectedSlot.start,
        end_time: selectedSlot.end,
      });
      toast.success('Appointment updated successfully');
      navigate(`/appointments/${updated?.id || id}`);
    } catch (error) {
      toast.error(error.message || 'Failed to update appointment');
    } finally {
      setUpdating(false);
    }
  };
  
  // Handle back navigation
  const handleBack = () => {
    navigate(`/appointments/${id}`);
  };
  
  const pageMeta = usePageMeta({
    title: 'Edit Appointment | Hospital Management System',
    breadcrumbs: [
      { label: 'Schedule', path: '/appointments' },
      { label: 'Edit Appointment', path: `/appointments/${id}/edit` },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <div className="space-y-6 p-6">
        <Button variant="ghost" onClick={handleBack} className="pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Appointment Details
        </Button>
        
        <PageHeader
          title="Edit Appointment"
          description="Update the details of this appointment"
          wrap={false}
          className="border-none bg-transparent p-0"
          titleClassName="text-3xl"
        />
        
        <Card>
          <CardHeader>
            <CardTitle>Appointment Details</CardTitle>
            <CardDescription>
              Modify the appointment information below
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : rustV2Mode ? (
              <div className="space-y-6">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Current appointment time
                  </div>
                  <div className="mt-2 font-display text-xl text-foreground">
                    {formatAppointmentTime(appointment.start_time || appointment.start)}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    Select a new start time for this scheduled appointment.
                  </p>
                </div>

                {!canReschedule ? (
                  <div className="rounded-lg border border-border p-4 font-mono text-sm text-muted-foreground">
                    This appointment can no longer be rescheduled.
                  </div>
                ) : (
                <div className="space-y-3">
                  <div>
                    <h2 className="font-display text-lg text-foreground">Available reschedule slots</h2>
                    <p className="font-mono text-xs text-muted-foreground">
                      Choose a new appointment time.
                    </p>
                  </div>

                  {slotsLoading ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-11 w-full" />
                      ))}
                    </div>
                  ) : slots.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {slots.map((slot) => {
                        const active = selectedSlot?.id === slot.id;
                        return (
                          <Button
                            key={slot.id}
                            type="button"
                            variant={active ? 'default' : 'outline'}
                            className="justify-start font-mono text-xs"
                            onClick={() => setSelectedSlot(slot)}
                            disabled={updating}
                          >
                            {formatSlotLabel(slot)}
                          </Button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border p-4 font-mono text-sm text-muted-foreground">
                      No reschedule slots are available for this appointment.
                    </div>
                  )}
                </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={updating}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleRustV2Submit}
                    disabled={updating || !selectedSlot || !canReschedule}
                  >
                    {updating ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </div>
            ) : (
              <AppointmentForm 
                initialData={appointment} 
                onSuccess={handleSuccess}
                isEditing={true}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
};

export default AppointmentEditPage;
