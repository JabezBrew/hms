import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

import { useAuth } from '@/lib/auth';
import { keyWith } from '@/shared/lib/queryKeys';
import { useDepartments, useRosterOnDutyDepartment } from '@/features/admin/hooks';
import { clinicsApi, clinicWalkInApi } from '@/features/clinics/api';

const walkInKeys = {
  clinicsByDepartment: (departmentId) => keyWith('clinics', 'by-department', departmentId),
};

export function WalkInCheckInDialog({ open, onOpenChange, patientId, onSuccess }) {
  const { facilityCode, user } = useAuth();
  const canUse = user?.role === 'receptionist' || user?.role === 'admin';

  if (!canUse) {
    return null;
  }

  const contentKey = open ? `${patientId || 'patient'}:${facilityCode || 'facility'}` : 'closed';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WalkInCheckInDialogContent
        key={contentKey}
        facilityCode={facilityCode}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
        open={open}
        patientId={patientId}
      />
    </Dialog>
  );
}

function WalkInCheckInDialogContent({ facilityCode, onOpenChange, onSuccess, open, patientId }) {
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedClinic, setSelectedClinic] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: departmentsData, isLoading: isDepartmentsLoading } = useDepartments();
  const departments = useMemo(
    () => {
      const allUnits = Array.isArray(departmentsData) ? departmentsData : [];
      return allUnits.filter((unit) => unit.unit_type_code === 'department' && unit.unit_category === 'clinical');
    },
    [departmentsData]
  );

  const { data: onDutyData, isLoading: isOnDutyLoading } = useRosterOnDutyDepartment(
    selectedDepartment,
    {},
    { enabled: Boolean(open) && Boolean(selectedDepartment) }
  );
  const onDutyEntries = useMemo(
    () => (Array.isArray(onDutyData) ? onDutyData : (onDutyData?.results || [])),
    [onDutyData]
  );

  const clinicsQuery = useQuery({
    queryKey: walkInKeys.clinicsByDepartment(selectedDepartment),
    queryFn: ({ signal }) => clinicsApi.list(
      { is_active: true, department: selectedDepartment },
      { signal },
    ),
    enabled: Boolean(open) && Boolean(facilityCode) && Boolean(selectedDepartment),
    staleTime: 60 * 1000,
  });

  const clinics = useMemo(
    () => (Array.isArray(clinicsQuery.data) ? clinicsQuery.data : []),
    [clinicsQuery.data]
  );
  const clinicById = useMemo(() => {
    const map = new Map();
    clinics.forEach((clinic) => {
      if (clinic?.id) {
        map.set(String(clinic.id), clinic);
      }
    });
    return map;
  }, [clinics]);

  const activePoolClinics = useMemo(() => {
    // Deduplicate active clinics by clinic_id from roster coverage.
    const seen = new Set();
    const results = [];
    for (const entry of onDutyEntries) {
      if (entry?.duty_type_category !== 'clinic') continue;
      if (!entry?.clinic_id) continue;
      const id = String(entry.clinic_id);
      if (seen.has(id)) continue;
      seen.add(id);

      const clinic = clinicById.get(id);
      if (!clinic) continue;
      if (clinic.booking_mode !== 'clinic_pool') continue;
      if (!clinic.accepts_walk_ins) continue;

      results.push({
        id,
        name: clinic.name || entry.clinic_name || 'Clinic',
      });
    }
    return results;
  }, [onDutyEntries, clinicById]);

  const selectedClinicForSubmit = activePoolClinics.length === 1
    ? activePoolClinics[0].id
    : activePoolClinics.some((clinic) => clinic.id === selectedClinic)
      ? selectedClinic
      : '';

  const handleDepartmentChange = (departmentId) => {
    setSelectedDepartment(departmentId);
    setSelectedClinic('');
  };

  const handleSubmit = async () => {
    if (!patientId) {
      toast.error('Missing patient context');
      return;
    }
    if (!selectedDepartment) {
      toast.error('Please select a department');
      return;
    }
    if (!selectedClinicForSubmit) {
      toast.error('Please select an active clinic');
      return;
    }

    setSubmitting(true);
    try {
      const result = await clinicWalkInApi.checkIn({
        patientId,
        clinicId: selectedClinicForSubmit,
        reason,
      });
      toast.success('Checked in to clinic', {
        description: result?.queue_number ? `Queue #${result.queue_number}` : undefined,
      });
      onSuccess?.(result, { clinicId: selectedClinicForSubmit, departmentId: selectedDepartment });
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message || 'Failed to check in walk-in patient');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="size-5 text-primary" />
            Arrived Now (Walk-In)
          </DialogTitle>
          <DialogDescription>
            Register this patient into an active clinic session and place them in the waiting room queue.
          </DialogDescription>
        </DialogHeader>

        {!facilityCode ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertCircle className="size-4" />
              <p className="text-sm">Facility context is required.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
	              <span className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
	                Department
	              </span>
	              <Select value={selectedDepartment} onValueChange={handleDepartmentChange}>
	                <SelectTrigger aria-label="Department" className="font-mono">
                  <SelectValue placeholder={isDepartmentsLoading ? 'Loading departments...' : 'Select department'} />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id} className="font-mono">
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
	              <span className="block font-mono text-xs uppercase tracking-wider text-muted-foreground">
	                Active Pool Clinic
	              </span>

              {!selectedDepartment ? (
                <div className="rounded-lg border border-border bg-card/50 p-3 text-sm text-muted-foreground">
                  Select a department to see active clinics on-duty now.
                </div>
              ) : (isOnDutyLoading || clinicsQuery.isLoading) ? (
                <Skeleton className="h-10 w-full" />
              ) : activePoolClinics.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-amber-800">
                    <AlertCircle className="size-4" />
                    <p className="text-sm">
                      No active pool clinics accepting walk-ins are on-duty right now for this department.
                    </p>
                  </div>
                </div>
              ) : activePoolClinics.length === 1 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle className="size-4" />
                    <p className="text-sm">
                      Auto-selected: <span className="font-mono font-medium">{activePoolClinics[0].name}</span>
                    </p>
                  </div>
                </div>
              ) : (
                <Select value={selectedClinicForSubmit} onValueChange={setSelectedClinic}>
	                  <SelectTrigger aria-label="Active pool clinic" className="font-mono">
                    <SelectValue placeholder="Select clinic" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePoolClinics.map((clinic) => (
                      <SelectItem key={clinic.id} value={clinic.id} className="font-mono">
                        {clinic.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
	              <label htmlFor="walk-in-check-in-reason" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
	                Reason (Optional)
	              </label>
	              <Textarea
	                id="walk-in-check-in-reason"
	                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief reason for visit..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Keep this short and structured. Avoid sensitive free-text unless necessary.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!facilityCode || submitting}>
            {submitting ? 'Checking in...' : 'Check In'}
          </Button>
        </DialogFooter>
    </DialogContent>
  );
}

export default WalkInCheckInDialog;
