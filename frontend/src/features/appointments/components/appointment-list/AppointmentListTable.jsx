import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import VirtualizedTable from '@/components/ui/VirtualizedTable';

import {
  formatAppointmentDateTime,
  getPatientName,
  getPractitionerName,
  getStatusConfig,
} from './appointmentListUtils';

export function AppointmentListTable({
  appointments,
  canOpenContext,
  onOpenPatientContext,
  onViewAppointment,
}) {
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
          {formatAppointmentDateTime(appointment.start || appointment.start_time)}
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
                onOpenPatientContext(appointment);
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
              onViewAppointment(appointment.id);
            }}
          >
            View
          </Button>
        </div>
      ),
    },
  ]), [canOpenContext, onOpenPatientContext, onViewAppointment]);

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={appointments}
        rowKey={(appointment) => appointment.id}
        rowHeight={68}
        columns={appointmentColumns}
        onRowClick={(appointment) => onViewAppointment(appointment.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1140px]"
        headerClassName="border-b border-border bg-muted/50"
      />
    </div>
  );
}
