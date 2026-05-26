import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { Badge } from '@/components/ui/badge';

import { useScheduleMappings, useScheduleSlots } from '@/features/appointments/hooks/useAppointmentQueries';
import { usePractitioner } from '@/features/staff/hooks';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';

const ScheduleSlotsPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();

    // Use React Query to fetch schedule mappings
    const { 
        data: scheduleMappings = [], 
        isLoading: isScheduleLoading,
        isError: isScheduleError,
        error: scheduleError
    } = useScheduleMappings({ id });

    // Find the specific schedule mapping by ID
    const schedule = Array.isArray(scheduleMappings) && scheduleMappings.length > 0
        ? scheduleMappings.find(s => s.id === id) || scheduleMappings[0]
        : null;

    const pageMeta = usePageMeta({
        title: schedule?.template_name
            ? `${schedule.template_name} Slots | Hospital Management System`
            : 'Schedule Slots | Hospital Management System',
        breadcrumbs: [
            { label: 'Availability', path: '/practitioner-availability' },
            { label: 'Schedule Slots', path: `/schedules/${id}/slots` },
        ],
    });

    // Use React Query to fetch slots for the schedule
    const { 
        data: slotsData = [], 
        isLoading: isSlotsLoading,
        isError: isSlotsError,
        error: slotsError
    } = useScheduleSlots(schedule?.fhir_schedule_id, {}, {
        enabled: !!schedule?.fhir_schedule_id
    });

    // Process the slots data
    const slots = slotsData && slotsData.entry && Array.isArray(slotsData.entry)
        ? slotsData.entry
            .filter(entry => entry.resource && entry.resource.resourceType === 'Slot')
            .map(entry => {
                const slot = entry.resource;
                return {
                    id: slot.id,
                    start: slot.start,
                    end: slot.end,
                    status: slot.status,
                    scheduleReference: slot.schedule?.reference,
                };
            })
        : [];

    // Use React Query to fetch practitioner details
    const { 
        data: practitioner,
        isLoading: isPractitionerLoading
    } = usePractitioner(schedule?.practitioner, {
        enabled: !!schedule?.practitioner
    });

    // Determine practitioner name - check for simple name field first (from search API)
    const practitionerName = practitioner?.name
        || (practitioner?.staff_details?.user_details
            ? `${practitioner.staff_details.user_details.first_name} ${practitioner.staff_details.user_details.last_name}`
            : 'Unknown');

    // Show error toast if queries fail
    useEffect(() => {
        if (isScheduleError) {
            toast.error(scheduleError?.message || 'Failed to load schedule');
        }
        if (isSlotsError) {
            toast.error(slotsError?.message || 'Failed to load slots');
        }
    }, [isScheduleError, scheduleError, isSlotsError, slotsError]);

    // Determine overall loading state
    const loading = isScheduleLoading || isSlotsLoading || isPractitionerLoading;

    // Format date for display
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            return date.toLocaleString();
            // eslint-disable-next-line no-unused-vars
        } catch (error) {
            return dateString;
        }
    };

    // Get status badge color
    const getStatusBadge = (status) => {
        switch (status) {
            case 'free':
                return <Badge className="bg-green-100 text-green-800">Free</Badge>;
            case 'busy':
                return <Badge className="bg-red-100 text-red-800">Busy</Badge>;
            case 'busy-unavailable':
                return <Badge className="bg-gray-100 text-gray-800">Unavailable</Badge>;
            case 'busy-tentative':
                return <Badge className="bg-yellow-100 text-yellow-800">Tentative</Badge>;
            default:
                return <Badge className="bg-blue-100 text-blue-800">{status}</Badge>;
        }
    };

    if (loading) {
        return (
            <PageState variant="loading">
                {pageMeta}
                <div className="container mx-auto py-6 space-y-6">
                    <div className="flex items-center gap-x-4">
                        <Skeleton className="size-10 rounded-full" />
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-[250px]" />
                            <Skeleton className="h-4 w-[200px]" />
                        </div>
                    </div>
                    <Skeleton className="h-[500px] w-full" />
                </div>
            </PageState>
        );
    }

    if (!schedule) {
        return (
            <>
                {pageMeta}
                <PageState
                    variant="empty"
                    title="Schedule not found"
                    description="We could not find a schedule for the selected slot set."
                    action={
                        <Button variant="outline" onClick={() => navigate('/practitioner-availability')}>
                            <ArrowLeft className="mr-2 size-4" />
                            Back to Availability
                        </Button>
                    }
                />
            </>
        );
    }

    return (
        <PageShell>
            {pageMeta}
            <PageHeader
                title="Schedule Slots"
                description={`${schedule.template_name} (${schedule.start_date} to ${schedule.end_date})`}
                actions={(
                    <Button variant="outline" onClick={() => navigate('/practitioner-availability')}>
                        <ArrowLeft className="mr-2 size-4" />
                        Back
                    </Button>
                )}
            />

            <main className="p-6 space-y-6">
                <Card>
                <CardHeader>
                    <CardTitle>Schedule Details</CardTitle>
                    <CardDescription>
                        Details about the schedule and its slots
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {schedule ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <h3 className="font-medium">Template</h3>
                                <p>{schedule.template_name}</p>
                            </div>
                            <div>
                                <h3 className="font-medium">Practitioner</h3>
                                <p>{practitionerName}</p>
                            </div>
                            <div>
                                <h3 className="font-medium">Status</h3>
                                <p>{schedule.status}</p>
                            </div>
                            <div>
                                <h3 className="font-medium">Start Date</h3>
                                <p>{schedule.start_date}</p>
                            </div>
                            <div>
                                <h3 className="font-medium">End Date</h3>
                                <p>{schedule.end_date}</p>
                            </div>
                            <div>
                                <h3 className="font-medium">Total Slots</h3>
                                <p>{schedule.slots_count || 0}</p>
                            </div>
                        </div>
                    ) : (
                        <p>No schedule details available</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Slots</CardTitle>
                    <CardDescription>
                        All slots for this schedule
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {slots.length === 0 ? (
                        <div className="text-center py-6">
                            <Calendar className="mx-auto size-12 text-muted-foreground" />
                            <h3 className="mt-4 text-lg font-medium">No Slots Found</h3>
                            <p className="mt-2 text-sm text-muted-foreground">
                                There are no slots available for this schedule.
                            </p>
                        </div>
                    ) : (
                        <VirtualizedTable
                            rows={slots}
                            rowKey={(slot) => slot.id}
                            rowHeight={56}
                            columns={[
                                {
                                    key: 'start',
                                    header: 'Start Time',
                                    render: (slot) => (
                                        <div className="flex items-center">
                                            <Clock className="mr-2 size-4 text-muted-foreground" />
                                            {formatDate(slot.start)}
                                        </div>
                                    ),
                                },
                                {
                                    key: 'end',
                                    header: 'End Time',
                                    render: (slot) => formatDate(slot.end),
                                },
                                {
                                    key: 'status',
                                    header: 'Status',
                                    render: (slot) => getStatusBadge(slot.status),
                                },
                            ]}
                        />
                    )}
                </CardContent>
            </Card>
        </main>
        </PageShell>
    );
};

export default ScheduleSlotsPage;
