/**
 * ClinicsPanel - Manages clinics for a department
 * Used in OrganizationPage unit detail view
 */
import { useId, useMemo, useState } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import Link2 from 'lucide-react/dist/esm/icons/link-2.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useClinics,
  useCreateClinic,
  useUpdateClinic,
  useDeleteClinic,
  useDepartmentDutyTypes,
  useUpdateDepartmentDutyType,
} from '@/features/admin/hooks';
import ClinicRosterWizardDialog from './ClinicRosterWizardDialog';

/**
 * ClinicsPanel - Displays and manages clinics for a unit (department)
 */
export function ClinicsPanel({ unitId, unitType }) {
  const fieldId = useId();
  const [showForm, setShowForm] = useState(false);
  const [editingClinic, setEditingClinic] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardClinic, setWizardClinic] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkClinic, setLinkClinic] = useState(null);
  const [linkDutyTypeId, setLinkDutyTypeId] = useState('');

  // Only departments can have clinics
  const canHaveClinics = unitType === 'department' || unitType === 'division';

  const { data: clinicsData, isLoading } = useClinics(
    { department: unitId, is_active: true },
    { enabled: canHaveClinics && !!unitId }
  );
  const clinics = Array.isArray(clinicsData) ? clinicsData : (clinicsData?.results || []);

  const createMutation = useCreateClinic();
  const updateMutation = useUpdateClinic();
  const deleteMutation = useDeleteClinic();
  const updateDutyType = useUpdateDepartmentDutyType();

  const [formState, setFormState] = useState({
    code: '',
    name: '',
    description: '',
    operating_hours_start: '08:00',
    operating_hours_end: '17:00',
    operates_24_hours: false,
    accepts_walk_ins: true,
    booking_mode: 'clinic_pool',
    assignment_timing: 'check_in',
    is_active: true,
  });

  const dutyTypesQuery = useDepartmentDutyTypes(
    { department: unitId, is_active: true },
    { enabled: canHaveClinics && !!unitId }
  );
  const dutyTypes = useMemo(() => {
    const data = dutyTypesQuery.data;
    return Array.isArray(data) ? data : (data?.results || []);
  }, [dutyTypesQuery.data]);

  const clinicDutyTypesByClinicId = useMemo(() => {
    const map = new Map();
    for (const dt of dutyTypes) {
      if (dt?.category === 'clinic' && dt?.clinic) {
        const key = String(dt.clinic);
        const list = map.get(key) || [];
        list.push(dt);
        map.set(key, list);
      }
    }
    return map;
  }, [dutyTypes]);

  const clinicDutyTypeOptions = useMemo(() => {
    const options = [];
    const currentClinicId = String(linkClinic?.id || '');
    for (const dt of dutyTypes) {
      if (dt?.category !== 'clinic') {
        continue;
      }
      const linkedClinicId = dt?.clinic ? String(dt.clinic) : null;
      options.push({
        dutyType: dt,
        isTaken: Boolean(linkedClinicId) && linkedClinicId !== currentClinicId,
      });
    }
    return options;
  }, [dutyTypes, linkClinic?.id]);

  const openForm = (clinic = null) => {
    if (clinic) {
      setEditingClinic(clinic);
      const bookingMode = String(clinic.booking_mode || 'clinic_pool');
      const assignmentTiming = bookingMode === 'clinic_pool' ? 'check_in' : 'booking';
      setFormState({
        code: clinic.code || '',
        name: clinic.name || '',
        description: clinic.description || '',
        operating_hours_start: clinic.operating_hours_start?.slice(0, 5) || '08:00',
        operating_hours_end: clinic.operating_hours_end?.slice(0, 5) || '17:00',
        operates_24_hours: clinic.operates_24_hours || false,
        accepts_walk_ins: clinic.accepts_walk_ins ?? true,
        booking_mode: bookingMode,
        assignment_timing: assignmentTiming,
        is_active: clinic.is_active ?? true,
      });
    } else {
      setEditingClinic(null);
      setFormState({
        code: '',
        name: '',
        description: '',
        operating_hours_start: '08:00',
        operating_hours_end: '17:00',
        operates_24_hours: false,
        accepts_walk_ins: true,
        booking_mode: 'clinic_pool',
        assignment_timing: 'check_in',
        is_active: true,
      });
    }
    setShowForm(true);
  };

  const openWizard = (clinic = null) => {
    setWizardClinic(clinic);
    setWizardOpen(true);
  };

  const openLink = (clinic) => {
    setLinkClinic(clinic);
    setLinkDutyTypeId('');
    setLinkOpen(true);
  };

  const handleSubmit = async () => {
    if (!formState.name.trim() || !formState.code.trim()) {
      toast.error('Name and code are required.');
      return;
    }

    const payload = {
      department: unitId,
      code: formState.code.trim().toUpperCase(),
      name: formState.name.trim(),
      description: formState.description.trim(),
      operating_hours_start: formState.operates_24_hours ? null : formState.operating_hours_start,
      operating_hours_end: formState.operates_24_hours ? null : formState.operating_hours_end,
      operates_24_hours: formState.operates_24_hours,
      accepts_walk_ins: formState.accepts_walk_ins,
      booking_mode: formState.booking_mode,
      assignment_timing: formState.assignment_timing,
      is_active: formState.is_active,
    };

    try {
      if (editingClinic) {
        await updateMutation.mutateAsync({ id: editingClinic.id, data: payload });
        toast.success('Clinic updated successfully.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Clinic created successfully.');
      }
      setShowForm(false);
      setEditingClinic(null);
    } catch (error) {
      const message = error.response?.data?.detail || error.message || 'Failed to save clinic.';
      toast.error(message);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      toast.success('Clinic deleted successfully.');
      setDeleteConfirm(null);
    } catch (error) {
      toast.error(error.message || 'Failed to delete clinic.');
    }
  };

  const handleLinkDutyType = async () => {
    if (!linkClinic?.id) return;
    if (!linkDutyTypeId) {
      toast.error('Select a roster template to link.');
      return;
    }

    try {
      await updateDutyType.mutateAsync({
        id: linkDutyTypeId,
        data: { clinic: linkClinic.id },
      });
      toast.success('Linked roster template to clinic.');
      setLinkOpen(false);
      setLinkClinic(null);
      setLinkDutyTypeId('');
    } catch (error) {
      const message = error.response?.data?.detail || error.message || 'Failed to link roster template.';
      toast.error(message);
    }
  };

  if (!canHaveClinics) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
          <Stethoscope className="size-7 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground">
          Clinics can only be added to departments or divisions
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Outpatient Clinics
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Clinics can be linked to duty types for appointment scheduling
          </p>
        </div>
        <Button onClick={() => openForm()} size="sm" className="font-mono text-xs">
          <Plus className="size-4 mr-1" />
          Add Clinic
        </Button>
        <Button onClick={() => openWizard()} size="sm" variant="outline" className="font-mono text-xs">
          <CalendarClock className="size-4 mr-1" />
          Add + Roster
        </Button>
      </div>

      {clinics.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed rounded-lg">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
            <Stethoscope className="size-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm text-muted-foreground">No clinics configured</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add clinics to enable outpatient appointment scheduling
          </p>
        </div>
      ) : (
        <div className="space-y-2">
	          {clinics.map((clinic) => (
	            <div
	              key={clinic.id}
	              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow"
	            >
	              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Stethoscope className="size-5 text-amber-600 dark:text-amber-400" />
                </div>
	                <div>
	                  <div className="flex items-center gap-2">
	                    <span className="font-heading font-medium">{clinic.name}</span>
	                    <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
	                      {clinic.code}
	                    </span>
	                    <Badge variant="secondary" className="font-mono text-[9px] px-1.5 py-0 uppercase tracking-wider">
	                      {String(clinic.booking_mode || 'clinic_pool') === 'clinic_pool' ? 'Pool' : 'Direct'}
	                    </Badge>
	                  </div>
	                  <div className="flex items-center gap-3 mt-1">
	                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
	                      <Clock className="size-3" />
                      {clinic.operates_24_hours
                        ? '24 hours'
                        : clinic.operating_hours_start && clinic.operating_hours_end
                          ? `${clinic.operating_hours_start.slice(0, 5)} - ${clinic.operating_hours_end.slice(0, 5)}`
                          : 'Hours not set'}
                    </span>
	                    {clinic.accepts_walk_ins && (
	                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
	                        Walk-ins
	                      </Badge>
	                    )}
	                    <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
	                      Template:{' '}
	                      <span className="text-foreground">
	                        {(clinicDutyTypesByClinicId.get(String(clinic.id)) || []).length || 0}
	                      </span>
	                    </span>
	                  </div>
	                </div>
	              </div>
	              <div className="flex items-center gap-1">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    clinic.is_active
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {clinic.is_active ? 'Active' : 'Inactive'}
	                </Badge>
	                <Button
	                  variant="ghost"
	                  size="icon"
	                  className="size-8"
	                  onClick={() => openLink(clinic)}
	                  title="Link roster template"
	                >
	                  <Link2 className="size-4" />
	                </Button>
	                <Button
	                  variant="ghost"
	                  size="icon"
	                  className="size-8"
	                  onClick={() => openWizard(clinic)}
                  title="Roster clinic"
                >
                  <CalendarClock className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => openForm(clinic)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleteConfirm(clinic)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Clinic Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingClinic ? 'Edit Clinic' : 'Add Clinic'}
            </DialogTitle>
            <DialogDescription>
              Configure an outpatient clinic for this department.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor={`${fieldId}-clinic-name`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Name *
                </label>
                <Input
                  id={`${fieldId}-clinic-name`}
                  value={formState.name}
                  onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Cardiology Clinic"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor={`${fieldId}-clinic-code`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Code *
                </label>
                <Input
                  id={`${fieldId}-clinic-code`}
                  value={formState.code}
                  onChange={(e) => setFormState((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="CARDIO"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor={`${fieldId}-clinic-description`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Description
              </label>
              <Textarea
                id={`${fieldId}-clinic-description`}
                value={formState.description}
                onChange={(e) => setFormState((p) => ({ ...p, description: e.target.value }))}
                placeholder="Brief description of the clinic..."
                rows={2}
              />
            </div>

	            <div className="space-y-3">
		              <label htmlFor={`${fieldId}-clinic-24-hours`} className="flex items-center gap-2 cursor-pointer">
		                <Checkbox
		                  id={`${fieldId}-clinic-24-hours`}
		                  checked={formState.operates_24_hours}
	                  onCheckedChange={(v) => setFormState((p) => ({ ...p, operates_24_hours: Boolean(v) }))}
	                />
	                <span className="text-sm">24-hour operation</span>
	              </label>

              {!formState.operates_24_hours && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor={`${fieldId}-opening-time`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Opening Time
                    </label>
                    <Input
                      id={`${fieldId}-opening-time`}
                      type="time"
                      value={formState.operating_hours_start}
                      onChange={(e) => setFormState((p) => ({ ...p, operating_hours_start: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`${fieldId}-closing-time`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Closing Time
                    </label>
                    <Input
                      id={`${fieldId}-closing-time`}
                      type="time"
                      value={formState.operating_hours_end}
                      onChange={(e) => setFormState((p) => ({ ...p, operating_hours_end: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                </div>
	              )}
	            </div>

	            <div className="grid gap-4 sm:grid-cols-2">
	              <div className="space-y-2">
		                <label htmlFor={`${fieldId}-booking-mode`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
		                  Booking Mode
		                </label>
	                <Select
	                  value={formState.booking_mode}
	                  onValueChange={(v) => {
	                    const bookingMode = String(v);
	                    const assignmentTiming = bookingMode === 'clinic_pool' ? 'check_in' : 'booking';
	                    setFormState((p) => ({
	                      ...p,
	                      booking_mode: bookingMode,
	                      assignment_timing: assignmentTiming,
	                    }));
	                  }}
	                >
		                  <SelectTrigger id={`${fieldId}-booking-mode`} className="font-mono">
	                    <SelectValue placeholder="Select booking mode" />
	                  </SelectTrigger>
	                  <SelectContent className="z-[200]">
	                    <SelectItem value="clinic_pool" className="font-mono">
	                      clinic_pool (book to session)
	                    </SelectItem>
	                    <SelectItem value="practitioner_direct" className="font-mono">
	                      practitioner_direct (book to clinician)
	                    </SelectItem>
	                  </SelectContent>
	                </Select>
	                <p className="text-xs text-muted-foreground">
	                  Pool clinics assign the final clinician at check-in. Practitioner-direct clinics lock the clinician at booking time.
	                </p>
	              </div>

	              <div className="space-y-2">
		                <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
		                  Assignment Timing
		                </p>
	                <div className="rounded-md border bg-muted/20 px-3 py-2">
	                  <span className="font-mono text-xs">{formState.assignment_timing}</span>
	                </div>
	                <p className="text-xs text-muted-foreground">
	                  Enforced by booking mode.
	                </p>
	              </div>
	            </div>

	            <div className="flex items-center gap-6 pt-2">
		              <label htmlFor={`${fieldId}-accepts-walk-ins`} className="flex items-center gap-2 cursor-pointer">
		                <Checkbox
		                  id={`${fieldId}-accepts-walk-ins`}
		                  checked={formState.accepts_walk_ins}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, accepts_walk_ins: Boolean(v) }))}
                />
                <span className="text-sm">Accepts walk-ins</span>
              </label>

              <label htmlFor={`${fieldId}-clinic-active`} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id={`${fieldId}-clinic-active`}
                  checked={formState.is_active}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, is_active: Boolean(v) }))}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="font-mono text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="font-mono text-xs"
            >
              {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save Clinic'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

	      {/* Delete Confirmation */}
	      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
	        <AlertDialogContent>
	          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clinic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-medium">{deleteConfirm?.name}</span>?
              This may affect linked duty types and scheduled appointments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-xs"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
	      </AlertDialog>

	      {/* Link Template Dialog */}
	      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
	        <DialogContent className="sm:max-w-lg">
	          <DialogHeader>
	            <DialogTitle className="font-display text-xl">Link Roster Template</DialogTitle>
	            <DialogDescription>
	              Link an existing clinic session duty type (template) to this clinic. This is what connects the roster to outpatient clinic availability.
	            </DialogDescription>
	          </DialogHeader>

	          <div className="space-y-4 py-2">
	            <div className="rounded-lg border bg-card/50 p-3 text-sm">
	              Clinic: <span className="font-medium">{linkClinic?.name}</span>{' '}
	              <span className="ml-2 font-mono text-xs text-muted-foreground">{linkClinic?.code}</span>
	            </div>

	            <div className="space-y-2">
		              <label htmlFor={`${fieldId}-link-duty-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
		                Clinic Session Duty Type
		              </label>
		              <Select value={linkDutyTypeId} onValueChange={setLinkDutyTypeId}>
		                <SelectTrigger id={`${fieldId}-link-duty-type`} className="font-mono">
	                  <SelectValue placeholder="Select duty type" />
	                </SelectTrigger>
	                <SelectContent className="z-[200]">
	                  {clinicDutyTypeOptions.map(({ dutyType: dt, isTaken }) => {
	                      return (
	                        <SelectItem
	                          key={dt.id}
	                          value={String(dt.id)}
	                          className="font-mono"
	                          disabled={isTaken}
	                        >
	                          {dt.name} ({dt.code}){isTaken ? ' - linked elsewhere' : ''}
	                        </SelectItem>
	                      );
	                    })}
	                </SelectContent>
	              </Select>
	              <p className="text-xs text-muted-foreground">
	                Only duty types with category <span className="font-mono">clinic</span> appear here.
	              </p>
	            </div>
	          </div>

	          <DialogFooter>
	            <Button variant="outline" onClick={() => setLinkOpen(false)} className="font-mono text-xs">
	              Cancel
	            </Button>
	            <Button
	              onClick={handleLinkDutyType}
	              disabled={updateDutyType.isPending}
	              className="font-mono text-xs"
	            >
	              {updateDutyType.isPending ? 'Linking...' : 'Link Template'}
	            </Button>
	          </DialogFooter>
	        </DialogContent>
	      </Dialog>

	      <ClinicRosterWizardDialog
	        open={wizardOpen}
	        onOpenChange={setWizardOpen}
	        unitId={unitId}
        unitType={unitType}
        existingClinic={wizardClinic}
      />
    </div>
  );
}

