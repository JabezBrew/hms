/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
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

const EMPTY_CLINIC_FORM_STATE = {
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
};

function toResultList(data) {
  return Array.isArray(data) ? data : (data?.results || []);
}

function getClinicFormState(clinic) {
  if (!clinic) return EMPTY_CLINIC_FORM_STATE;

  const bookingMode = String(clinic.booking_mode || 'clinic_pool');
  return {
    code: clinic.code || '',
    name: clinic.name || '',
    description: clinic.description || '',
    operating_hours_start: clinic.operating_hours_start?.slice(0, 5) || '08:00',
    operating_hours_end: clinic.operating_hours_end?.slice(0, 5) || '17:00',
    operates_24_hours: clinic.operates_24_hours || false,
    accepts_walk_ins: clinic.accepts_walk_ins ?? true,
    booking_mode: bookingMode,
    assignment_timing: bookingMode === 'clinic_pool' ? 'check_in' : 'booking',
    is_active: clinic.is_active ?? true,
  };
}

function getClinicHoursLabel(clinic) {
  if (clinic.operates_24_hours) return '24 hours';
  if (clinic.operating_hours_start && clinic.operating_hours_end) {
    return `${clinic.operating_hours_start.slice(0, 5)} - ${clinic.operating_hours_end.slice(0, 5)}`;
  }
  return 'Hours not set';
}

function buildClinicDutyTypesByClinicId(dutyTypes) {
  const map = new Map();
  for (const dutyType of dutyTypes) {
    if (dutyType?.category === 'clinic' && dutyType?.clinic) {
      const key = String(dutyType.clinic);
      const list = map.get(key) || [];
      list.push(dutyType);
      map.set(key, list);
    }
  }
  return map;
}

function buildClinicDutyTypeOptions(dutyTypes, currentClinicId) {
  const options = [];
  for (const dutyType of dutyTypes) {
    if (dutyType?.category !== 'clinic') continue;

    const linkedClinicId = dutyType?.clinic ? String(dutyType.clinic) : null;
    options.push({
      dutyType,
      isTaken: Boolean(linkedClinicId) && linkedClinicId !== currentClinicId,
    });
  }
  return options;
}

function ClinicsUnavailableState() {
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

function ClinicsLoadingState() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function ClinicsPanelHeader({ onAddClinic, onAddRoster }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Outpatient Clinics
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Clinics can be linked to duty types for appointment scheduling
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onAddClinic} size="sm" className="font-mono text-xs">
          <Plus className="size-4 mr-1" />
          Add Clinic
        </Button>
        <Button onClick={onAddRoster} size="sm" variant="outline" className="font-mono text-xs">
          <CalendarClock className="size-4 mr-1" />
          Add + Roster
        </Button>
      </div>
    </div>
  );
}

function EmptyClinicsState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 border border-dashed rounded-lg">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted/50 mb-3">
        <Stethoscope className="size-6 text-muted-foreground/50" />
      </div>
      <p className="text-sm text-muted-foreground">No clinics configured</p>
      <p className="text-xs text-muted-foreground mt-1">
        Add clinics to enable outpatient appointment scheduling
      </p>
    </div>
  );
}

function ClinicStatusBadge({ clinic }) {
  return (
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
  );
}

function ClinicCard({ clinic, linkedTemplateCount, onLink, onRoster, onEdit, onDelete }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-card hover:shadow-sm transition-shadow">
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
              {getClinicHoursLabel(clinic)}
            </span>
            {clinic.accepts_walk_ins && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                Walk-ins
              </Badge>
            )}
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Template: <span className="text-foreground">{linkedTemplateCount}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <ClinicStatusBadge clinic={clinic} />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onLink(clinic)}
          title="Link roster template"
        >
          <Link2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => onRoster(clinic)}
          title="Roster clinic"
        >
          <CalendarClock className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(clinic)}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => onDelete(clinic)}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ClinicsList({ clinics, clinicDutyTypesByClinicId, onLink, onRoster, onEdit, onDelete }) {
  if (clinics.length === 0) return <EmptyClinicsState />;

  return (
    <div className="space-y-2">
      {clinics.map((clinic) => (
        <ClinicCard
          key={clinic.id}
          clinic={clinic}
          linkedTemplateCount={(clinicDutyTypesByClinicId.get(String(clinic.id)) || []).length || 0}
          onLink={onLink}
          onRoster={onRoster}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function ClinicFormDialog({
  fieldId,
  open,
  onOpenChange,
  editingClinic,
  formState,
  setFormState,
  onSubmit,
  isSaving,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
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
                onChange={(event) => setFormState((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
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
              onChange={(event) => setFormState((current) => ({ ...current, description: event.target.value }))}
              placeholder="Brief description of the clinic..."
              rows={2}
            />
          </div>

          <ClinicHoursFields fieldId={fieldId} formState={formState} setFormState={setFormState} />
          <ClinicBookingFields fieldId={fieldId} formState={formState} setFormState={setFormState} />
          <ClinicBooleanFields fieldId={fieldId} formState={formState} setFormState={setFormState} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-xs">
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSaving} className="font-mono text-xs">
            {isSaving ? 'Saving...' : 'Save Clinic'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClinicHoursFields({ fieldId, formState, setFormState }) {
  return (
    <div className="space-y-3">
      <label htmlFor={`${fieldId}-clinic-24-hours`} className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          id={`${fieldId}-clinic-24-hours`}
          checked={formState.operates_24_hours}
          onCheckedChange={(value) => setFormState((current) => ({ ...current, operates_24_hours: Boolean(value) }))}
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
              onChange={(event) => setFormState((current) => ({ ...current, operating_hours_start: event.target.value }))}
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
              onChange={(event) => setFormState((current) => ({ ...current, operating_hours_end: event.target.value }))}
              className="font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ClinicBookingFields({ fieldId, formState, setFormState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-booking-mode`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Booking Mode
        </label>
        <Select
          value={formState.booking_mode}
          onValueChange={(value) => {
            const bookingMode = String(value);
            setFormState((current) => ({
              ...current,
              booking_mode: bookingMode,
              assignment_timing: bookingMode === 'clinic_pool' ? 'check_in' : 'booking',
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
        <p className="text-xs text-muted-foreground">Enforced by booking mode.</p>
      </div>
    </div>
  );
}

function ClinicBooleanFields({ fieldId, formState, setFormState }) {
  return (
    <div className="flex items-center gap-6 pt-2">
      <label htmlFor={`${fieldId}-accepts-walk-ins`} className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          id={`${fieldId}-accepts-walk-ins`}
          checked={formState.accepts_walk_ins}
          onCheckedChange={(value) => setFormState((current) => ({ ...current, accepts_walk_ins: Boolean(value) }))}
        />
        <span className="text-sm">Accepts walk-ins</span>
      </label>

      <label htmlFor={`${fieldId}-clinic-active`} className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          id={`${fieldId}-clinic-active`}
          checked={formState.is_active}
          onCheckedChange={(value) => setFormState((current) => ({ ...current, is_active: Boolean(value) }))}
        />
        <span className="text-sm">Active</span>
      </label>
    </div>
  );
}

function DeleteClinicDialog({ clinic, onOpenChange, onDelete, isDeleting }) {
  return (
    <AlertDialog open={Boolean(clinic)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Clinic</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <span className="font-medium">{clinic?.name}</span>?
            This may affect linked duty types and scheduled appointments.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-xs"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LinkTemplateDialog({
  fieldId,
  open,
  onOpenChange,
  clinic,
  selectedDutyTypeId,
  onSelectedDutyTypeChange,
  options,
  onLink,
  isLinking,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Link Roster Template</DialogTitle>
          <DialogDescription>
            Link an existing clinic session duty type (template) to this clinic. This is what connects the roster to outpatient clinic availability.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border bg-card/50 p-3 text-sm">
            Clinic: <span className="font-medium">{clinic?.name}</span>{' '}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{clinic?.code}</span>
          </div>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-link-duty-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Clinic Session Duty Type
            </label>
            <Select value={selectedDutyTypeId} onValueChange={onSelectedDutyTypeChange}>
              <SelectTrigger id={`${fieldId}-link-duty-type`} className="font-mono">
                <SelectValue placeholder="Select duty type" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {options.map(({ dutyType, isTaken }) => (
                  <SelectItem
                    key={dutyType.id}
                    value={String(dutyType.id)}
                    className="font-mono"
                    disabled={isTaken}
                  >
                    {dutyType.name} ({dutyType.code}){isTaken ? ' - linked elsewhere' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only duty types with category <span className="font-mono">clinic</span> appear here.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-xs">
            Cancel
          </Button>
          <Button onClick={onLink} disabled={isLinking} className="font-mono text-xs">
            {isLinking ? 'Linking...' : 'Link Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClinicsPanelDialogs({ controller }) {
  return (
    <>
      <ClinicFormDialog
        fieldId={controller.fieldId}
        open={controller.showForm}
        onOpenChange={controller.setShowForm}
        editingClinic={controller.editingClinic}
        formState={controller.formState}
        setFormState={controller.setFormState}
        onSubmit={controller.handleSubmit}
        isSaving={controller.createMutation.isPending || controller.updateMutation.isPending}
      />

      <DeleteClinicDialog
        clinic={controller.deleteConfirm}
        onOpenChange={() => controller.setDeleteConfirm(null)}
        onDelete={controller.handleDelete}
        isDeleting={controller.deleteMutation.isPending}
      />

      <LinkTemplateDialog
        fieldId={controller.fieldId}
        open={controller.linkOpen}
        onOpenChange={controller.setLinkOpen}
        clinic={controller.linkClinic}
        selectedDutyTypeId={controller.linkDutyTypeId}
        onSelectedDutyTypeChange={controller.setLinkDutyTypeId}
        options={controller.clinicDutyTypeOptions}
        onLink={controller.handleLinkDutyType}
        isLinking={controller.updateDutyType.isPending}
      />

      <ClinicRosterWizardDialog
        open={controller.wizardOpen}
        onOpenChange={controller.setWizardOpen}
        unitId={controller.unitId}
        unitType={controller.unitType}
        existingClinic={controller.wizardClinic}
      />
    </>
  );
}

function useClinicsPanelController({ unitId, unitType }) {
  const fieldId = useId();
  const [showForm, setShowForm] = useState(false);
  const [editingClinic, setEditingClinic] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardClinic, setWizardClinic] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkClinic, setLinkClinic] = useState(null);
  const [linkDutyTypeId, setLinkDutyTypeId] = useState('');
  const [formState, setFormState] = useState(EMPTY_CLINIC_FORM_STATE);

  const canHaveClinics = unitType === 'department' || unitType === 'division';
  const { data: clinicsData, isLoading } = useClinics(
    { department: unitId, is_active: true },
    { enabled: canHaveClinics && !!unitId }
  );
  const dutyTypesQuery = useDepartmentDutyTypes(
    { department: unitId, is_active: true },
    { enabled: canHaveClinics && !!unitId }
  );

  const clinics = useMemo(() => toResultList(clinicsData), [clinicsData]);
  const dutyTypes = useMemo(() => toResultList(dutyTypesQuery.data), [dutyTypesQuery.data]);
  const clinicDutyTypesByClinicId = useMemo(
    () => buildClinicDutyTypesByClinicId(dutyTypes),
    [dutyTypes]
  );
  const clinicDutyTypeOptions = useMemo(
    () => buildClinicDutyTypeOptions(dutyTypes, String(linkClinic?.id || '')),
    [dutyTypes, linkClinic?.id]
  );

  const createMutation = useCreateClinic();
  const updateMutation = useUpdateClinic();
  const deleteMutation = useDeleteClinic();
  const updateDutyType = useUpdateDepartmentDutyType();

  const openForm = (clinic = null) => {
    setEditingClinic(clinic);
    setFormState(getClinicFormState(clinic));
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

  return {
    fieldId,
    unitId,
    unitType,
    canHaveClinics,
    isLoading,
    clinics,
    clinicDutyTypesByClinicId,
    clinicDutyTypeOptions,
    showForm,
    setShowForm,
    editingClinic,
    deleteConfirm,
    setDeleteConfirm,
    wizardOpen,
    setWizardOpen,
    wizardClinic,
    linkOpen,
    setLinkOpen,
    linkClinic,
    linkDutyTypeId,
    setLinkDutyTypeId,
    formState,
    setFormState,
    createMutation,
    updateMutation,
    deleteMutation,
    updateDutyType,
    openForm,
    openWizard,
    openLink,
    handleSubmit,
    handleDelete,
    handleLinkDutyType,
  };
}

function ClinicsPanelView({ controller }) {
  if (!controller.canHaveClinics) return <ClinicsUnavailableState />;
  if (controller.isLoading) return <ClinicsLoadingState />;

  return (
    <div className="space-y-4">
      <ClinicsPanelHeader
        onAddClinic={() => controller.openForm()}
        onAddRoster={() => controller.openWizard()}
      />
      <ClinicsList
        clinics={controller.clinics}
        clinicDutyTypesByClinicId={controller.clinicDutyTypesByClinicId}
        onLink={controller.openLink}
        onRoster={controller.openWizard}
        onEdit={controller.openForm}
        onDelete={controller.setDeleteConfirm}
      />
      <ClinicsPanelDialogs controller={controller} />
    </div>
  );
}

/**
 * ClinicsPanel - Displays and manages clinics for a unit (department)
 */
export function ClinicsPanel({ unitId, unitType }) {
  const controller = useClinicsPanelController({ unitId, unitType });
  return <ClinicsPanelView controller={controller} />;
}
