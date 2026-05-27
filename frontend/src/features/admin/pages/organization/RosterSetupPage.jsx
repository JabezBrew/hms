/**
 * RosterSetupPage - One-time configuration per department
 * Manages teams, duty types, and rotation rules
 * Chronicle Design System styling
 */
import { useId, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Clipboard from 'lucide-react/dist/esm/icons/clipboard.js';
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';
import { toast } from 'sonner';

import {
  useClinicalUnitsTree,
  useDepartmentDutyTypes,
  useCreateDepartmentDutyType,
  useUpdateDepartmentDutyType,
  useDeleteDepartmentDutyType,
  useRotationRules,
  useCreateRotationRule,
  useUpdateRotationRule,
  useDeleteRotationRule,
  useValidationRules,
  useValidationRuleTemplates,
  useCreateValidationRule,
  useUpdateValidationRule,
  useDeleteValidationRule,
  useClinics,
} from '@/features/admin/hooks';
import { flattenUnitTree, toList } from './duty-roster/utils';
import { EmptyState } from './duty-roster/components';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Mon' },
  { value: 1, label: 'Tue' },
  { value: 2, label: 'Wed' },
  { value: 3, label: 'Thu' },
  { value: 4, label: 'Fri' },
  { value: 5, label: 'Sat' },
  { value: 6, label: 'Sun' },
];

const RULE_TYPES = [
  { value: 'sequential', label: 'Sequential', description: 'Teams rotate in order: A → B → C → D' },
  { value: 'fixed_weekly', label: 'Fixed Weekly', description: 'Same team each weekday: Mon=A, Tue=B' },
];

const DUTY_CATEGORY_OPTIONS = [
  { value: 'clinic', label: 'Clinic Session', description: 'Generates appointment slots' },
  { value: 'ward', label: 'Ward Duty', description: 'Inpatient coverage' },
  { value: 'on_call', label: 'On-Call', description: 'Emergency/on-call coverage' },
  { value: 'theatre', label: 'Theatre/Procedure', description: 'Surgical/procedural' },
  { value: 'admin', label: 'Administrative', description: 'Non-clinical duties' },
];

/**
 * Unit selector showing departments and divisions grouped
 */
function UnitSelector({ value, onChange, units, isLoading }) {
  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  // Group by type and organize divisions under their parent department
  const departments = [];
  const divisionsByParent = new Map();
  units.forEach((unit) => {
    if (unit.unit_type_code === 'department') {
      departments.push(unit);
    } else if (unit.unit_type_code === 'division') {
      const divisions = divisionsByParent.get(unit.parentId) || [];
      divisions.push(unit);
      divisionsByParent.set(unit.parentId, divisions);
    }
  });

  // Build grouped structure
  const groupedUnits = [];
  departments.forEach((dept) => {
    groupedUnits.push({ ...dept, indent: 0 });
    // Add divisions under this department
    (divisionsByParent.get(dept.id) || []).forEach((div) => {
      groupedUnits.push({ ...div, indent: 1, parentName: dept.name });
    });
  });

  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a department or division" />
      </SelectTrigger>
      <SelectContent className="z-[200]">
        {groupedUnits.map((unit) => (
          <SelectItem key={unit.id} value={unit.id}>
            <span className={unit.indent ? 'pl-4' : ''}>
              {unit.name}
              {unit.unit_type_code === 'division' && (
                <span className="ml-2 text-xs text-muted-foreground">(Division)</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Teams panel - shows teams for the selected unit
 */
function TeamsPanel({ unitId, teams }) {
  if (!unitId) {
    return (
      <EmptyState
        icon={Users}
        title="Select a unit"
        description="Choose a department or division to view its teams."
      />
    );
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No teams found"
        description="Create teams under this unit in the Organization page."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/organization">Go to Organization</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-2">
      {teams.map((team, index) => (
        <div
          key={team.id}
          className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors animate-chronicle-enter"
          style={{ animationDelay: `${index * 30}ms` }}
        >
          <div>
            <span className="font-heading font-medium text-sm">{team.name}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">{team.code}</span>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">
            Team
          </Badge>
        </div>
      ))}
      <p className="text-xs text-muted-foreground pt-2">
        To add or edit teams, go to the{' '}
        <Link to="/admin/organization" className="text-primary hover:underline">
          Organization page
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Duty Types panel
 */
function DutyTypesPanel({ departmentId }) {
  const fieldId = useId();
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const { data, isLoading } = useDepartmentDutyTypes(
    departmentId ? { department: departmentId } : null
  );
  const dutyTypes = toList(data);

  // Fetch clinics for this department to link to clinic duty types
  const { data: clinicsData } = useClinics(
    { department: departmentId, is_active: true },
    { enabled: !!departmentId }
  );
  const clinics = Array.isArray(clinicsData) ? clinicsData : (clinicsData?.results || []);

  const createMutation = useCreateDepartmentDutyType();
  const updateMutation = useUpdateDepartmentDutyType();
  const deleteMutation = useDeleteDepartmentDutyType();

  const [formState, setFormState] = useState({
    name: '',
    code: '',
    category: 'ward',
    applicable_days: [0, 1, 2, 3, 4],
    is_24_hour: false,
    start_time: '08:00',
    end_time: '17:00',
    // Clinic-specific fields
    clinic: '', // FK to Clinic model
    slot_duration_minutes: 15,
    max_patients_per_slot: 1,
    breaks: [],
    display_order: 0,
    is_active: true,
  });

  const openForm = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormState({
        name: item.name || '',
        code: item.code || '',
        category: item.category || 'ward',
        applicable_days: item.applicable_days || [0, 1, 2, 3, 4],
        is_24_hour: item.is_24_hour || false,
        start_time: item.start_time?.slice(0, 5) || '08:00',
        end_time: item.end_time?.slice(0, 5) || '17:00',
        // Clinic-specific fields
        clinic: item.clinic || '',
        slot_duration_minutes: item.slot_duration_minutes || 15,
        max_patients_per_slot: item.max_patients_per_slot || 1,
        breaks: item.breaks || [],
        display_order: item.display_order ?? 0,
        is_active: item.is_active ?? true,
      });
    } else {
      setEditingItem(null);
      setFormState({
        name: '',
        code: '',
        category: 'ward',
        applicable_days: [0, 1, 2, 3, 4],
        is_24_hour: false,
        start_time: '08:00',
        end_time: '17:00',
        // Clinic-specific fields
        clinic: '',
        slot_duration_minutes: 15,
        max_patients_per_slot: 1,
        breaks: [],
        display_order: 0,
        is_active: true,
      });
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formState.name.trim() || !formState.code.trim()) {
      toast.error('Name and code are required.');
      return;
    }

    // Validate clinic-specific fields
    if (formState.category === 'clinic') {
      if (!formState.clinic) {
        toast.error('Select a clinic to link this clinic duty type.');
        return;
      }
      if (!formState.slot_duration_minutes || formState.slot_duration_minutes < 5) {
        toast.error('Slot duration must be at least 5 minutes for clinic duties.');
        return;
      }
    }

    const payload = {
      name: formState.name.trim(),
      code: formState.code.trim().toUpperCase(),
      department: departmentId,
      category: formState.category,
      applicable_days: formState.applicable_days,
      is_24_hour: formState.is_24_hour,
      start_time: formState.is_24_hour ? null : formState.start_time,
      end_time: formState.is_24_hour ? null : formState.end_time,
      // Include clinic-specific fields when category is 'clinic'
      clinic: formState.category === 'clinic' ? formState.clinic : null,
      slot_duration_minutes: formState.category === 'clinic' ? Number(formState.slot_duration_minutes) : null,
      max_patients_per_slot: formState.category === 'clinic' ? Number(formState.max_patients_per_slot) || 1 : null,
      breaks: formState.category === 'clinic' ? formState.breaks : [],
      display_order: Number(formState.display_order) || 0,
      is_active: formState.is_active,
    };

    try {
      if (editingItem) {
        await updateMutation.mutateAsync({ id: editingItem.id, data: payload });
        toast.success('Duty type updated.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Duty type created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save duty type.');
    }
  };

  const handleDeleteDutyType = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      toast.success('Duty type deleted.');
      setDeleteConfirm(null);
    } catch (error) {
      toast.error(error.message || 'Failed to delete.');
    }
  };

  const toggleDay = (day) => {
    setFormState((prev) => ({
      ...prev,
      applicable_days: prev.applicable_days.includes(day)
        ? prev.applicable_days.filter((d) => d !== day)
        : [...prev.applicable_days, day].sort(),
    }));
  };

  if (!departmentId) {
    return (
      <EmptyState
        icon={Clipboard}
        title="Select a unit"
        description="Choose a department or division to manage its duty types."
      />
    );
  }

  return (
    <div className="space-y-4">
      <DutyTypesToolbar onAdd={() => openForm()} />
      <DutyTypesContent
        isLoading={isLoading}
        dutyTypes={dutyTypes}
        onEdit={openForm}
        onDelete={setDeleteConfirm}
      />
      <DutyTypeFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        fieldId={fieldId}
        editingItem={editingItem}
        formState={formState}
        setFormState={setFormState}
        clinics={clinics}
        onToggleDay={toggleDay}
        onSubmit={handleSubmit}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
      <DutyTypeDeleteDialog
        dutyType={deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        onDelete={handleDeleteDutyType}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

function DutyTypesToolbar({ onAdd }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onAdd} size="sm">
        <Plus className="size-4 mr-1" />
        <span className="font-mono text-xs">Add Duty Type</span>
      </Button>
    </div>
  );
}

function DutyTypesContent({ isLoading, dutyTypes, onEdit, onDelete }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (dutyTypes.length === 0) {
    return (
      <EmptyState
        icon={Clipboard}
        title="No duty types yet"
        description="Add duty types like 'OBS Clinic', 'Theatre', 'Weekend Duty'."
      />
    );
  }

  return <DutyTypesTable dutyTypes={dutyTypes} onEdit={onEdit} onDelete={onDelete} />;
}

function DutyTypesTable({ dutyTypes, onEdit, onDelete }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
          <TableHead className="font-mono text-[10px] uppercase">Category</TableHead>
          <TableHead className="font-mono text-[10px] uppercase">Days</TableHead>
          <TableHead className="font-mono text-[10px] uppercase">Time</TableHead>
          <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
          <TableHead className="font-mono text-[10px] uppercase text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {dutyTypes.map((dutyType, index) => (
          <DutyTypeTableRow
            key={dutyType.id}
            dutyType={dutyType}
            index={index}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function DutyTypeTableRow({ dutyType, index, onEdit, onDelete }) {
  return (
    <TableRow
      className="animate-chronicle-enter"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <TableCell>
        <div className="font-heading font-medium">{dutyType.name}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{dutyType.code}</div>
      </TableCell>
      <TableCell>
        <DutyTypeCategoryBadge dutyType={dutyType} />
      </TableCell>
      <TableCell>
        <DutyTypeDaysBadges days={dutyType.applicable_days || []} />
      </TableCell>
      <TableCell className="font-mono text-xs">
        {dutyType.is_24_hour
          ? '24hr'
          : `${dutyType.start_time?.slice(0, 5) || '--'}-${dutyType.end_time?.slice(0, 5) || '--'}`}
      </TableCell>
      <TableCell>
        <DutyTypeStatusBadge isActive={dutyType.is_active} />
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="icon" onClick={() => onEdit(dutyType)}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onDelete(dutyType)}>
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function DutyTypeCategoryBadge({ dutyType }) {
  return (
    <>
      <Badge
        variant="outline"
        className={cn(
          'text-[10px]',
          dutyType.category === 'clinic'
            ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
            : 'bg-muted/50'
        )}
      >
        {dutyType.category_display || dutyType.category || 'Ward'}
      </Badge>
      {dutyType.category === 'clinic' && (
        <div className="font-mono text-[9px] text-muted-foreground mt-0.5">
          {dutyType.clinic_name
            ? dutyType.clinic_name
            : dutyType.slot_duration_minutes
              ? `${dutyType.slot_duration_minutes}min slots`
              : 'No clinic linked'}
        </div>
      )}
    </>
  );
}

function DutyTypeDaysBadges({ days }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {DAYS_OF_WEEK.map((day) => (
        days.includes(day.value) ? (
          <Badge key={day.value} variant="outline" className="text-[9px] px-1.5">
            {day.label}
          </Badge>
        ) : null
      ))}
    </div>
  );
}

function DutyTypeStatusBadge({ isActive }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px]',
        isActive
          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {isActive ? 'Active' : 'Inactive'}
    </Badge>
  );
}

function DutyTypeFormDialog({
  open,
  onOpenChange,
  fieldId,
  editingItem,
  formState,
  setFormState,
  clinics,
  onToggleDay,
  onSubmit,
  isSaving,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editingItem ? 'Edit Duty Type' : 'Add Duty Type'}
          </DialogTitle>
          <DialogDescription>
            Define when this duty type applies and its time configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
          <DutyTypeIdentityFields
            fieldId={fieldId}
            formState={formState}
            setFormState={setFormState}
          />
          <DutyTypeCategoryField
            fieldId={fieldId}
            category={formState.category}
            setFormState={setFormState}
          />
          <ApplicableDaysField
            fieldId={fieldId}
            applicableDays={formState.applicable_days}
            setFormState={setFormState}
            onToggleDay={onToggleDay}
          />
          <DutyTimeFields
            fieldId={fieldId}
            formState={formState}
            setFormState={setFormState}
          />

          {formState.category === 'clinic' && (
            <ClinicDutySettingsFields
              fieldId={fieldId}
              formState={formState}
              setFormState={setFormState}
              clinics={clinics}
            />
          )}

          <DutyTypeOrderStatusFields
            fieldId={fieldId}
            formState={formState}
            setFormState={setFormState}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSaving}>
            {editingItem ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DutyTypeIdentityFields({ fieldId, formState, setFormState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-duty-name`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Name
        </label>
        <Input
          id={`${fieldId}-duty-name`}
          value={formState.name}
          onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
          placeholder="OBS Clinic"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-duty-code`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Code
        </label>
        <Input
          id={`${fieldId}-duty-code`}
          value={formState.code}
          onChange={(e) => setFormState((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
          placeholder="OBS"
          className="font-mono"
        />
      </div>
    </div>
  );
}

function DutyTypeCategoryField({ fieldId, category, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-duty-category`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Category
      </label>
      <Select
        value={category}
        onValueChange={(value) => setFormState((p) => ({ ...p, category: value }))}
      >
        <SelectTrigger id={`${fieldId}-duty-category`} className="w-full">
          <SelectValue placeholder="Select category" />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {DUTY_CATEGORY_OPTIONS.map((categoryOption) => (
            <SelectItem key={categoryOption.value} value={categoryOption.value}>
              <div className="flex flex-col">
                <span>{categoryOption.label}</span>
                <span className="text-xs text-muted-foreground">
                  {categoryOption.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ApplicableDaysField({ fieldId, applicableDays, setFormState, onToggleDay }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p id={`${fieldId}-applicable-days-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Applicable Days
        </p>
        <ApplicableDaysPresets setFormState={setFormState} />
      </div>
      <fieldset
        aria-labelledby={`${fieldId}-applicable-days-label`}
        className="m-0 flex flex-wrap gap-2 border-0 p-0"
      >
        {DAYS_OF_WEEK.map((day) => (
          <button
            key={day.value}
            type="button"
            onClick={() => onToggleDay(day.value)}
            className={cn(
              'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
              applicableDays.includes(day.value)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            )}
          >
            {day.label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function ApplicableDaysPresets({ setFormState }) {
  const presets = [
    { label: 'Weekdays', days: [0, 1, 2, 3, 4] },
    { label: 'Weekends', days: [5, 6] },
    { label: 'All', days: [0, 1, 2, 3, 4, 5, 6] },
    { label: 'Clear', days: [] },
  ];

  return (
    <div className="flex gap-1">
      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => setFormState((p) => ({ ...p, applicable_days: preset.days }))}
          className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

function DutyTimeFields({ fieldId, formState, setFormState }) {
  return (
    <div className="space-y-3">
      <label htmlFor={`${fieldId}-is-24-hour`} className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          id={`${fieldId}-is-24-hour`}
          checked={formState.is_24_hour}
          onCheckedChange={(value) =>
            setFormState((p) => ({ ...p, is_24_hour: Boolean(value) }))
          }
        />
        <span className="text-sm">24-hour duty</span>
      </label>

      {!formState.is_24_hour && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor={`${fieldId}-start-time`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Start Time
            </label>
            <Input
              id={`${fieldId}-start-time`}
              type="time"
              value={formState.start_time}
              onChange={(e) => setFormState((p) => ({ ...p, start_time: e.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={`${fieldId}-end-time`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              End Time
            </label>
            <Input
              id={`${fieldId}-end-time`}
              type="time"
              value={formState.end_time}
              onChange={(e) => setFormState((p) => ({ ...p, end_time: e.target.value }))}
              className="font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ClinicDutySettingsFields({ fieldId, formState, setFormState, clinics }) {
  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <div className="flex items-center gap-2 text-amber-600">
        <CalendarClock className="size-4" />
        <span className="text-xs font-medium">Appointment Scheduling Settings</span>
      </div>

      <ClinicLinkField
        fieldId={fieldId}
        clinicId={formState.clinic}
        clinics={clinics}
        setFormState={setFormState}
      />
      <ClinicSlotFields fieldId={fieldId} formState={formState} setFormState={setFormState} />
      <ClinicBreaksEditor
        fieldId={fieldId}
        breaks={formState.breaks}
        setFormState={setFormState}
      />
    </div>
  );
}

function ClinicLinkField({ fieldId, clinicId, clinics, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-clinic-link`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Link to Clinic
      </label>
      <Select
        value={clinicId || ''}
        onValueChange={(value) => setFormState((p) => ({ ...p, clinic: value }))}
      >
        <SelectTrigger id={`${fieldId}-clinic-link`} className="w-full">
          <SelectValue placeholder="Select a clinic" />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {clinics.map((clinic) => (
            <SelectItem key={clinic.id} value={clinic.id}>
              {clinic.name} ({clinic.code})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        {clinics.length === 0
          ? 'No clinics available. Create clinics in Organization -> unit -> Clinics tab.'
          : 'Required. This is what connects the roster to outpatient clinic availability.'}
      </p>
    </div>
  );
}

function ClinicSlotFields({ fieldId, formState, setFormState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-slot-duration`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Slot Duration (minutes)
        </label>
        <Input
          id={`${fieldId}-slot-duration`}
          type="number"
          min="5"
          max="480"
          step="5"
          value={formState.slot_duration_minutes}
          onChange={(e) =>
            setFormState((p) => ({ ...p, slot_duration_minutes: e.target.value }))
          }
          className="font-mono"
          placeholder="15"
        />
        <p className="text-[10px] text-muted-foreground">
          Duration of each appointment slot
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-max-patients`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Patients/Slot
        </label>
        <Input
          id={`${fieldId}-max-patients`}
          type="number"
          min="1"
          max="20"
          value={formState.max_patients_per_slot}
          onChange={(e) =>
            setFormState((p) => ({ ...p, max_patients_per_slot: e.target.value }))
          }
          className="font-mono"
          placeholder="1"
        />
        <p className="text-[10px] text-muted-foreground">
          For group sessions or overbooking per doctor. Multiple doctors in same clinic
          each get their own slots via roster.
        </p>
      </div>
    </div>
  );
}

function ClinicBreaksEditor({ fieldId, breaks, setFormState }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p id={`${fieldId}-breaks-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Breaks
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setFormState((p) => ({
              ...p,
              breaks: [...p.breaks, { start: '12:00', end: '13:00' }],
            }))
          }
        >
          <Plus className="size-3 mr-1" />
          <span className="text-xs">Add Break</span>
        </Button>
      </div>

      {breaks.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No breaks configured. Slots will be generated continuously.
        </p>
      ) : (
        <div className="space-y-2">
          {breaks.map((brk, index) => (
            <ClinicBreakRow
              key={`${brk.start}-${brk.end}`}
              breakItem={brk}
              index={index}
              breaks={breaks}
              setFormState={setFormState}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClinicBreakRow({ breakItem, index, breaks, setFormState }) {
  const updateBreak = (field, value) => {
    const updated = [...breaks];
    updated[index] = { ...updated[index], [field]: value };
    setFormState((p) => ({ ...p, breaks: updated }));
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={`Break ${index + 1} start time`}
        type="time"
        value={breakItem.start}
        onChange={(e) => updateBreak('start', e.target.value)}
        className="font-mono w-28"
      />
      <span className="text-muted-foreground">to</span>
      <Input
        aria-label={`Break ${index + 1} end time`}
        type="time"
        value={breakItem.end}
        onChange={(e) => updateBreak('end', e.target.value)}
        className="font-mono w-28"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => {
          setFormState((p) => ({
            ...p,
            breaks: p.breaks.filter((_, i) => i !== index),
          }));
        }}
      >
        <Trash2 className="size-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

function DutyTypeOrderStatusFields({ fieldId, formState, setFormState }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-display-order`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Display Order
        </label>
        <Input
          id={`${fieldId}-display-order`}
          type="number"
          min="0"
          value={formState.display_order}
          onChange={(e) => setFormState((p) => ({ ...p, display_order: e.target.value }))}
          className="font-mono"
        />
      </div>
      <div className="space-y-2 pt-6">
        <label htmlFor={`${fieldId}-duty-active`} className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            id={`${fieldId}-duty-active`}
            checked={formState.is_active}
            onCheckedChange={(value) =>
              setFormState((p) => ({ ...p, is_active: Boolean(value) }))
            }
          />
          <span className="text-sm">Active</span>
        </label>
      </div>
    </div>
  );
}

function DutyTypeDeleteDialog({ dutyType, onOpenChange, onDelete, isDeleting }) {
  return (
    <AlertDialog open={!!dutyType} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-destructive">
            Delete Duty Type
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>"{dutyType?.name}"</strong>? This may
            affect existing roster entries and rotation rules.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Rotation Rules panel
 */
function RotationRulesPanel({ departmentId, teams, dutyTypes }) {
  const fieldId = useId();
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const { data, isLoading } = useRotationRules(departmentId);
  const rules = toList(data);

  const createMutation = useCreateRotationRule();
  const updateMutation = useUpdateRotationRule();
  const deleteMutation = useDeleteRotationRule();

  const [formState, setFormState] = useState({
    name: '',
    duty_type: '',
    rule_type: 'sequential',
    team_sequence: [],
    day_assignments: {},
    exclusion_rule: null,
    applicable_days: [],
    is_active: true,
  });

  const openForm = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormState({
        name: item.name || '',
        duty_type: item.duty_type || '',
        rule_type: item.rule_type || 'sequential',
        team_sequence: item.team_sequence || [],
        day_assignments: item.day_assignments || {},
        exclusion_rule: item.exclusion_rule || null,
        applicable_days: item.applicable_days || [],
        is_active: item.is_active ?? true,
      });
    } else {
      setEditingItem(null);
      setFormState({
        name: '',
        duty_type: '',
        rule_type: 'sequential',
        team_sequence: [],
        day_assignments: {},
        exclusion_rule: null,
        applicable_days: [],
        is_active: true,
      });
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formState.name.trim() || !formState.duty_type) {
      toast.error('Name and duty type are required.');
      return;
    }

    const payload = {
      name: formState.name.trim(),
      duty_type: formState.duty_type,
      rule_type: formState.rule_type,
      team_sequence: formState.team_sequence,
      day_assignments: formState.day_assignments,
      exclusion_rule: formState.exclusion_rule,
      applicable_days: formState.applicable_days,
      is_active: formState.is_active,
    };

    try {
      if (editingItem) {
        await updateMutation.mutateAsync({ id: editingItem.id, data: payload });
        toast.success('Rotation rule updated.');
      } else {
        await createMutation.mutateAsync({ departmentId, data: payload });
        toast.success('Rotation rule created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save rotation rule.');
    }
  };

  const handleDeleteRotationRule = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      toast.success('Rotation rule deleted.');
      setDeleteConfirm(null);
    } catch (error) {
      toast.error(error.message || 'Failed to delete.');
    }
  };

  const toggleTeamInSequence = (teamId) => {
    setFormState((prev) => ({
      ...prev,
      team_sequence: prev.team_sequence.includes(teamId)
        ? prev.team_sequence.filter((t) => t !== teamId)
        : [...prev.team_sequence, teamId],
    }));
  };

  const getTeamName = (teamId) => {
    const team = teams.find((t) => t.id === teamId);
    return team?.name || teamId;
  };

  const getDutyTypeName = (dutyTypeId) => {
    const dt = dutyTypes.find((d) => d.id === dutyTypeId);
    return dt?.name || dutyTypeId;
  };

  if (!departmentId) {
    return (
      <EmptyState
        icon={RotateCw}
        title="Select a unit"
        description="Choose a department or division to manage its rotation rules."
      />
    );
  }

  return (
    <div className="space-y-4">
      <RotationRulesToolbar
        onAdd={() => openForm()}
        disabled={teams.length === 0 || dutyTypes.length === 0}
      />
      <RotationRulesPrerequisites teams={teams} dutyTypes={dutyTypes} />
      <RotationRulesContent
        isLoading={isLoading}
        rules={rules}
        getTeamName={getTeamName}
        getDutyTypeName={getDutyTypeName}
        onEdit={openForm}
        onDelete={setDeleteConfirm}
      />
      <RotationRuleFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        fieldId={fieldId}
        editingItem={editingItem}
        formState={formState}
        setFormState={setFormState}
        teams={teams}
        dutyTypes={dutyTypes}
        getTeamName={getTeamName}
        onToggleTeam={toggleTeamInSequence}
        onSubmit={handleSubmit}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
      <RotationRuleDeleteDialog
        rule={deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        onDelete={handleDeleteRotationRule}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

function RotationRulesToolbar({ onAdd, disabled }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onAdd} size="sm" disabled={disabled}>
        <Plus className="size-4 mr-1" />
        <span className="font-mono text-xs">Add Rule</span>
      </Button>
    </div>
  );
}

function RotationRulesPrerequisites({ teams, dutyTypes }) {
  return (
    <>
      {teams.length === 0 && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
          No teams found. Create teams in the Organization page first.
        </div>
      )}

      {dutyTypes.length === 0 && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
          No duty types found. Add duty types above first.
        </div>
      )}
    </>
  );
}

function RotationRulesContent({
  isLoading,
  rules,
  getTeamName,
  getDutyTypeName,
  onEdit,
  onDelete,
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <EmptyState
        icon={RotateCw}
        title="No rotation rules yet"
        description="Define how teams rotate through duty types."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule, index) => (
        <RotationRuleCard
          key={rule.id}
          rule={rule}
          index={index}
          getTeamName={getTeamName}
          getDutyTypeName={getDutyTypeName}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function RotationRuleCard({ rule, index, getTeamName, getDutyTypeName, onEdit, onDelete }) {
  return (
    <Card className="animate-chronicle-enter" style={{ animationDelay: `${index * 30}ms` }}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h4 className="font-heading font-medium">{rule.name}</h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              {getDutyTypeName(rule.duty_type)} &middot;{' '}
              {RULE_TYPES.find((r) => r.value === rule.rule_type)?.label || rule.rule_type}
            </p>
            {rule.team_sequence?.length > 0 && (
              <RotationTeamSequenceBadges
                teamSequence={rule.team_sequence}
                getTeamName={getTeamName}
              />
            )}
          </div>
          <div className="flex gap-1">
            <DutyTypeStatusBadge isActive={rule.is_active} />
            <Button variant="ghost" size="icon" onClick={() => onEdit(rule)}>
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(rule)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RotationTeamSequenceBadges({ teamSequence, getTeamName }) {
  return (
    <div className="flex gap-1 mt-2 flex-wrap">
      {teamSequence.map((teamId, index) => (
        <span key={teamId} className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            {getTeamName(teamId)}
          </Badge>
          {index < teamSequence.length - 1 && (
            <span className="text-muted-foreground">→</span>
          )}
        </span>
      ))}
    </div>
  );
}

function RotationRuleFormDialog({
  open,
  onOpenChange,
  fieldId,
  editingItem,
  formState,
  setFormState,
  teams,
  dutyTypes,
  getTeamName,
  onToggleTeam,
  onSubmit,
  isSaving,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editingItem ? 'Edit Rotation Rule' : 'Add Rotation Rule'}
          </DialogTitle>
          <DialogDescription>
            Define how teams rotate for a duty type.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RotationRuleBasics
            fieldId={fieldId}
            formState={formState}
            setFormState={setFormState}
            dutyTypes={dutyTypes}
          />
          {formState.rule_type === 'sequential' && (
            <SequentialTeamSequenceField
              fieldId={fieldId}
              teams={teams}
              teamSequence={formState.team_sequence}
              getTeamName={getTeamName}
              onToggleTeam={onToggleTeam}
            />
          )}
          {formState.rule_type === 'fixed_weekly' && (
            <FixedWeeklyAssignmentGrid
              fieldId={fieldId}
              teams={teams}
              dayAssignments={formState.day_assignments}
              setFormState={setFormState}
            />
          )}
          <RotationRuleActiveField
            fieldId={fieldId}
            isActive={formState.is_active}
            setFormState={setFormState}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSaving}>
            {editingItem ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RotationRuleBasics({ fieldId, formState, setFormState, dutyTypes }) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-rule-name`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Rule Name
        </label>
        <Input
          id={`${fieldId}-rule-name`}
          value={formState.name}
          onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
          placeholder="OBS Clinic Weekday Rotation"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor={`${fieldId}-duty-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Duty Type
        </label>
        <Select
          value={formState.duty_type}
          onValueChange={(value) => setFormState((p) => ({ ...p, duty_type: value }))}
        >
          <SelectTrigger id={`${fieldId}-duty-type`}>
            <SelectValue placeholder="Select duty type" />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {dutyTypes.map((dutyType) => (
              <SelectItem key={dutyType.id} value={dutyType.id}>
                {dutyType.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <RotationRuleTypeField
        fieldId={fieldId}
        ruleType={formState.rule_type}
        setFormState={setFormState}
      />
    </>
  );
}

function RotationRuleTypeField({ fieldId, ruleType, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-rule-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Rule Type
      </label>
      <Select
        value={ruleType}
        onValueChange={(value) => setFormState((p) => ({ ...p, rule_type: value }))}
      >
        <SelectTrigger id={`${fieldId}-rule-type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {RULE_TYPES.map((ruleTypeOption) => (
            <SelectItem key={ruleTypeOption.value} value={ruleTypeOption.value}>
              <div>
                <div>{ruleTypeOption.label}</div>
                <div className="text-xs text-muted-foreground">
                  {ruleTypeOption.description}
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SequentialTeamSequenceField({
  fieldId,
  teams,
  teamSequence,
  getTeamName,
  onToggleTeam,
}) {
  return (
    <div className="space-y-2">
      <p id={`${fieldId}-team-sequence-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Team Sequence (click to toggle)
      </p>
      <fieldset
        aria-labelledby={`${fieldId}-team-sequence-label`}
        className="m-0 flex flex-wrap gap-2 border-0 p-0"
      >
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => onToggleTeam(team.id)}
            className={cn(
              'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
              teamSequence.includes(team.id)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            )}
          >
            {team.name}
          </button>
        ))}
      </fieldset>
      {teamSequence.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Order: {teamSequence.map((teamId) => getTeamName(teamId)).join(' → ')}
        </p>
      )}
    </div>
  );
}

function FixedWeeklyAssignmentGrid({ fieldId, teams, dayAssignments, setFormState }) {
  const gridTemplateColumns = `60px repeat(${teams.length}, 1fr)`;

  return (
    <div className="space-y-3">
      <p id={`${fieldId}-day-assignments-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Day Assignments (click to assign)
      </p>
      <fieldset
        aria-labelledby={`${fieldId}-day-assignments-label`}
        className="m-0 overflow-hidden rounded-lg border p-0"
      >
        <FixedWeeklyGridHeader teams={teams} gridTemplateColumns={gridTemplateColumns} />
        {DAYS_OF_WEEK.map((day, dayIndex) => (
          <FixedWeeklyGridRow
            key={day.value}
            day={day}
            dayIndex={dayIndex}
            teams={teams}
            dayAssignments={dayAssignments}
            gridTemplateColumns={gridTemplateColumns}
            setFormState={setFormState}
          />
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Click a cell to assign that team to that day. Only one team per day.
      </p>
    </div>
  );
}

function FixedWeeklyGridHeader({ teams, gridTemplateColumns }) {
  return (
    <div className="grid bg-muted/50 border-b" style={{ gridTemplateColumns }}>
      <div className="p-2 text-[10px] font-mono uppercase text-muted-foreground border-r">
        Day
      </div>
      {teams.map((team) => (
        <div key={team.id} className="p-2 text-[10px] font-mono uppercase text-center text-muted-foreground truncate">
          {team.code || team.name.slice(0, 6)}
        </div>
      ))}
    </div>
  );
}

function FixedWeeklyGridRow({
  day,
  dayIndex,
  teams,
  dayAssignments,
  gridTemplateColumns,
  setFormState,
}) {
  return (
    <div
      className={cn('grid', dayIndex < DAYS_OF_WEEK.length - 1 && 'border-b')}
      style={{ gridTemplateColumns }}
    >
      <div className="p-2 text-xs font-mono text-muted-foreground border-r bg-muted/30">
        {day.label}
      </div>
      {teams.map((team) => (
        <FixedWeeklyAssignmentCell
          key={team.id}
          day={day}
          team={team}
          isSelected={dayAssignments[String(day.value)] === team.id}
          setFormState={setFormState}
        />
      ))}
    </div>
  );
}

function FixedWeeklyAssignmentCell({ day, team, isSelected, setFormState }) {
  return (
    <button
      type="button"
      onClick={() =>
        setFormState((prev) => {
          const newAssignments = { ...prev.day_assignments };
          if (isSelected) {
            delete newAssignments[String(day.value)];
          } else {
            newAssignments[String(day.value)] = team.id;
          }
          return { ...prev, day_assignments: newAssignments };
        })
      }
      className={cn(
        'p-2 transition-colors text-center',
        isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'
      )}
    >
      {isSelected && <span className="text-xs">✓</span>}
    </button>
  );
}

function RotationRuleActiveField({ fieldId, isActive, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-rotation-active`} className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          id={`${fieldId}-rotation-active`}
          checked={isActive}
          onCheckedChange={(value) =>
            setFormState((p) => ({ ...p, is_active: Boolean(value) }))
          }
        />
        <span className="text-sm">Active</span>
      </label>
    </div>
  );
}

function RotationRuleDeleteDialog({ rule, onOpenChange, onDelete, isDeleting }) {
  return (
    <AlertDialog open={!!rule} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-destructive">
            Delete Rotation Rule
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>"{rule?.name}"</strong>? This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Validation Rules Panel - Manage configurable validation constraints
 */
function ValidationRulesPanel({ departmentId, teams, dutyTypes }) {
  const fieldId = useId();
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // Item to delete

  const { data, isLoading } = useValidationRules(departmentId);
  const { data: templates } = useValidationRuleTemplates();
  const rules = toList(data);

  const createMutation = useCreateValidationRule();
  const updateMutation = useUpdateValidationRule();
  const deleteMutation = useDeleteValidationRule();

  const [formState, setFormState] = useState({
    name: '',
    rule_type: 'no_consecutive_days',
    duty_type: '',
    params: {},
    severity: 'error',
    is_active: true,
  });

  const openForm = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormState({
        name: item.name || '',
        rule_type: item.rule_type || 'no_consecutive_days',
        duty_type: item.duty_type || '',
        params: item.params || {},
        severity: item.severity || 'error',
        is_active: item.is_active ?? true,
      });
    } else {
      setEditingItem(null);
      setFormState({
        name: '',
        rule_type: 'no_consecutive_days',
        duty_type: '',
        params: {},
        severity: 'error',
        is_active: true,
      });
    }
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formState.name.trim()) {
      toast.error('Name is required.');
      return;
    }

    const payload = {
      name: formState.name.trim(),
      rule_type: formState.rule_type,
      duty_type: formState.duty_type || null,
      params: formState.params,
      severity: formState.severity,
      is_active: formState.is_active,
    };

    try {
      if (editingItem) {
        await updateMutation.mutateAsync({ id: editingItem.id, data: payload });
        toast.success('Validation rule updated.');
      } else {
        await createMutation.mutateAsync({ departmentId, data: payload });
        toast.success('Validation rule created.');
      }
      setShowForm(false);
    } catch (error) {
      toast.error(error.message || 'Failed to save validation rule.');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteMutation.mutateAsync(deleteConfirm.id);
      toast.success('Validation rule deleted.');
      setDeleteConfirm(null);
    } catch (error) {
      toast.error(error.message || 'Failed to delete.');
    }
  };

  const getDutyTypeName = (dutyTypeId) => {
    if (!dutyTypeId) return 'All duty types';
    const dt = dutyTypes.find((d) => d.id === dutyTypeId);
    return dt?.name || dutyTypeId;
  };

  const currentTemplate = templates?.[formState.rule_type];

  if (!departmentId) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Select a unit"
        description="Choose a department or division to manage its validation rules."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ValidationRulesToolbar onAdd={() => openForm()} />
      <ValidationRulesList
        rules={rules}
        dutyTypes={dutyTypes}
        getDutyTypeName={getDutyTypeName}
        onEdit={openForm}
        onDelete={setDeleteConfirm}
        isDeleting={deleteMutation.isPending}
      />
      <ValidationRuleFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        fieldId={fieldId}
        editingItem={editingItem}
        formState={formState}
        setFormState={setFormState}
        templates={templates}
        currentTemplate={currentTemplate}
        teams={teams}
        dutyTypes={dutyTypes}
        onSubmit={handleSubmit}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
      <ValidationRuleDeleteDialog
        rule={deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        onDelete={handleDelete}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

function ValidationRulesToolbar({ onAdd }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={onAdd}>
        <Plus className="size-4 mr-1" />
        Add Rule
      </Button>
    </div>
  );
}

function ValidationRulesList({ rules, dutyTypes, getDutyTypeName, onEdit, onDelete, isDeleting }) {
  if (rules.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-dashed border-border text-center">
        <p className="text-sm text-muted-foreground">
          No validation rules defined. Rules help prevent scheduling conflicts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rules.map((rule) => (
        <ValidationRuleCard
          key={rule.id}
          rule={rule}
          dutyTypes={dutyTypes}
          getDutyTypeName={getDutyTypeName}
          onEdit={onEdit}
          onDelete={onDelete}
          isDeleting={isDeleting}
        />
      ))}
    </div>
  );
}

function ValidationRuleCard({ rule, dutyTypes, getDutyTypeName, onEdit, onDelete, isDeleting }) {
  const linkedDutyLabel =
    (rule.params?.duty_type_ids || [])
      .map((id) => dutyTypes.find((dutyType) => dutyType.id === id)?.name || id)
      .join(', ') || 'No duty types linked';

  return (
    <div className="p-4 rounded-lg border border-border hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-heading font-medium">{rule.name}</span>
            <ValidationSeverityBadge severity={rule.severity} />
            {!rule.is_active && (
              <Badge variant="secondary" className="text-[9px]">
                Inactive
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {rule.rule_type_display} •{' '}
            {rule.rule_type === 'linked_duty_no_consecutive'
              ? linkedDutyLabel
              : getDutyTypeName(rule.duty_type)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => onEdit(rule)}>
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(rule)}
            disabled={isDeleting}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ValidationSeverityBadge({ severity }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[9px] font-mono',
        severity === 'error'
          ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
          : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
      )}
    >
      {severity}
    </Badge>
  );
}

function ValidationRuleFormDialog({
  open,
  onOpenChange,
  fieldId,
  editingItem,
  formState,
  setFormState,
  templates,
  currentTemplate,
  teams,
  dutyTypes,
  onSubmit,
  isSaving,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {editingItem ? 'Edit Validation Rule' : 'Add Validation Rule'}
          </DialogTitle>
          <DialogDescription>
            Define constraints to prevent scheduling conflicts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <ValidationRuleNameField
            fieldId={fieldId}
            name={formState.name}
            setFormState={setFormState}
          />
          <ValidationRuleTypeField
            fieldId={fieldId}
            ruleType={formState.rule_type}
            templates={templates}
            currentTemplate={currentTemplate}
            setFormState={setFormState}
          />
          {formState.rule_type !== 'linked_duty_no_consecutive' && (
            <ValidationRuleApplyToField
              fieldId={fieldId}
              dutyTypeId={formState.duty_type}
              dutyTypes={dutyTypes}
              setFormState={setFormState}
            />
          )}
          <ValidationRuleParamsFields
            fieldId={fieldId}
            ruleType={formState.rule_type}
            params={formState.params}
            teams={teams}
            dutyTypes={dutyTypes}
            setFormState={setFormState}
          />
          <ValidationRuleSeverityField
            fieldId={fieldId}
            severity={formState.severity}
            setFormState={setFormState}
          />
          <ValidationRuleActiveField
            fieldId={fieldId}
            isActive={formState.is_active}
            setFormState={setFormState}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSaving}>
            {editingItem ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValidationRuleNameField({ fieldId, name, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-validation-name`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Rule Name
      </label>
      <Input
        id={`${fieldId}-validation-name`}
        value={name}
        onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
        placeholder="e.g., No back-to-back weekends"
      />
    </div>
  );
}

function ValidationRuleTypeField({
  fieldId,
  ruleType,
  templates,
  currentTemplate,
  setFormState,
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-validation-rule-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Rule Type
      </label>
      <Select
        value={ruleType}
        onValueChange={(value) =>
          setFormState((p) => ({ ...p, rule_type: value, params: {} }))
        }
      >
        <SelectTrigger id={`${fieldId}-validation-rule-type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {templates && Object.entries(templates).map(([key, template]) => (
            <SelectItem key={key} value={key}>
              <div>
                <div>{template.name}</div>
                <div className="text-xs text-muted-foreground">{template.description}</div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {currentTemplate?.example && (
        <p className="text-xs text-muted-foreground italic">
          Example: {currentTemplate.example}
        </p>
      )}
    </div>
  );
}

function ValidationRuleApplyToField({ fieldId, dutyTypeId, dutyTypes, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-validation-apply-to`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Apply To
      </label>
      <Select
        value={dutyTypeId || '_all_'}
        onValueChange={(value) =>
          setFormState((p) => ({ ...p, duty_type: value === '_all_' ? '' : value }))
        }
      >
        <SelectTrigger id={`${fieldId}-validation-apply-to`}>
          <SelectValue placeholder="All duty types" />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          <SelectItem value="_all_">All duty types</SelectItem>
          {dutyTypes.map((dutyType) => (
            <SelectItem key={dutyType.id} value={dutyType.id}>
              {dutyType.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ValidationRuleParamsFields({ fieldId, ruleType, params, teams, dutyTypes, setFormState }) {
  if (ruleType === 'no_consecutive_days') {
    return <NoConsecutiveDaysParams fieldId={fieldId} params={params} setFormState={setFormState} />;
  }
  if (ruleType === 'day_pair_exclusion') {
    return <DayPairExclusionParams fieldId={fieldId} params={params} setFormState={setFormState} />;
  }
  if (ruleType === 'max_per_period') {
    return <MaxPerPeriodParams fieldId={fieldId} params={params} setFormState={setFormState} />;
  }
  if (ruleType === 'team_day_exclusion') {
    return (
      <TeamDayExclusionParams
        fieldId={fieldId}
        params={params}
        teams={teams}
        setFormState={setFormState}
      />
    );
  }
  if (ruleType === 'linked_duty_no_consecutive') {
    return (
      <LinkedDutyNoConsecutiveParams
        fieldId={fieldId}
        params={params}
        dutyTypes={dutyTypes}
        setFormState={setFormState}
      />
    );
  }
  return null;
}

function NoConsecutiveDaysParams({ fieldId, params, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-validation-days-apart`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Days Apart
      </label>
      <Input
        id={`${fieldId}-validation-days-apart`}
        type="number"
        min={1}
        max={6}
        value={params.days_apart || 1}
        onChange={(e) =>
          setFormState((p) => ({
            ...p,
            params: { ...p.params, days_apart: parseInt(e.target.value) || 1 },
          }))
        }
      />
      <p className="text-xs text-muted-foreground">
        1 = no back-to-back days (Fri then Sat)
      </p>
    </div>
  );
}

function DayPairExclusionParams({ fieldId, params, setFormState }) {
  return (
    <div className="space-y-2">
      <p id={`${fieldId}-excluded-day-pairs-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Excluded Day Pairs
      </p>
      <fieldset
        aria-labelledby={`${fieldId}-excluded-day-pairs-label`}
        className="m-0 space-y-2 border-0 p-0"
      >
        {(params.pairs || []).map((pair, index) => (
          <DayPairRow
            key={`${pair[0]}-${pair[1]}`}
            pair={pair}
            index={index}
            pairs={params.pairs || []}
            setFormState={setFormState}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newPairs = [...(params.pairs || []), [4, 5]];
            setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
          }}
        >
          <Plus className="size-4 mr-1" />
          Add Pair
        </Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Team cannot work both days of a pair in the same week.
      </p>
    </div>
  );
}

function DayPairRow({ pair, index, pairs, setFormState }) {
  const updatePair = (nextPair) => {
    const newPairs = [...pairs];
    newPairs[index] = nextPair;
    setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={String(pair[0])}
        onValueChange={(value) => updatePair([parseInt(value), pair[1]])}
      >
        <SelectTrigger aria-label={`Excluded day pair ${index + 1} first day`} className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {DAYS_OF_WEEK.map((day) => (
            <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground">→</span>
      <Select
        value={String(pair[1])}
        onValueChange={(value) => updatePair([pair[0], parseInt(value)])}
      >
        <SelectTrigger aria-label={`Excluded day pair ${index + 1} second day`} className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {DAYS_OF_WEEK.map((day) => (
            <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          const newPairs = pairs.filter((_, pairIndex) => pairIndex !== index);
          setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function MaxPerPeriodParams({ fieldId, params, setFormState }) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-validation-max-duties`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Maximum Duties
        </label>
        <Input
          id={`${fieldId}-validation-max-duties`}
          type="number"
          min={1}
          max={10}
          value={params.max || 2}
          onChange={(e) =>
            setFormState((p) => ({
              ...p,
              params: { ...p.params, max: parseInt(e.target.value) || 2 },
            }))
          }
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-validation-period`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Period
        </label>
        <Select
          value={params.period || 'week'}
          onValueChange={(value) =>
            setFormState((p) => ({ ...p, params: { ...p.params, period: value } }))
          }
        >
          <SelectTrigger id={`${fieldId}-validation-period`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            <SelectItem value="week">Per Week</SelectItem>
            <SelectItem value="month">Per Month</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function TeamDayExclusionParams({ fieldId, params, teams, setFormState }) {
  return (
    <>
      <ValidationToggleGroup
        id={`${fieldId}-excluded-teams-label`}
        label="Excluded Teams"
        items={teams}
        selectedValues={params.team_ids || []}
        getItemValue={(team) => team.id}
        getItemLabel={(team) => team.name}
        onToggle={(teamId) => {
          const currentTeams = params.team_ids || [];
          const newTeams = currentTeams.includes(teamId)
            ? currentTeams.filter((t) => t !== teamId)
            : [...currentTeams, teamId];
          setFormState((p) => ({ ...p, params: { ...p.params, team_ids: newTeams } }));
        }}
      />
      <ValidationToggleGroup
        id={`${fieldId}-excluded-days-label`}
        label="Excluded Days"
        items={DAYS_OF_WEEK}
        selectedValues={params.days || []}
        getItemValue={(day) => day.value}
        getItemLabel={(day) => day.label}
        onToggle={(dayValue) => {
          const currentDays = params.days || [];
          const newDays = currentDays.includes(dayValue)
            ? currentDays.filter((day) => day !== dayValue)
            : [...currentDays, dayValue];
          setFormState((p) => ({ ...p, params: { ...p.params, days: newDays } }));
        }}
      />
    </>
  );
}

function LinkedDutyNoConsecutiveParams({ fieldId, params, dutyTypes, setFormState }) {
  return (
    <>
      <div className="space-y-2">
        <p id={`${fieldId}-linked-duty-types-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Linked Duty Types
        </p>
        <p className="text-xs text-muted-foreground">
          Select duty types that should be treated as linked for consecutive day checking.
        </p>
        <fieldset
          aria-labelledby={`${fieldId}-linked-duty-types-label`}
          className="m-0 flex flex-wrap gap-2 border-0 p-0"
        >
          {dutyTypes.map((dutyType) => (
            <button
              key={dutyType.id}
              type="button"
              onClick={() => {
                const currentTypes = params.duty_type_ids || [];
                const newTypes = currentTypes.includes(dutyType.id)
                  ? currentTypes.filter((typeId) => typeId !== dutyType.id)
                  : [...currentTypes, dutyType.id];
                setFormState((p) => ({
                  ...p,
                  params: { ...p.params, duty_type_ids: newTypes },
                }));
              }}
              className={cn(
                'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                (params.duty_type_ids || []).includes(dutyType.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted'
              )}
            >
              {dutyType.name}
            </button>
          ))}
        </fieldset>
        {(params.duty_type_ids || []).length < 2 && (
          <p className="text-xs text-amber-600">Select at least 2 duty types to link.</p>
        )}
      </div>
      <NoConsecutiveDaysParams
        fieldId={`${fieldId}-linked`}
        params={params}
        setFormState={setFormState}
      />
    </>
  );
}

function ValidationToggleGroup({
  id,
  label,
  items,
  selectedValues,
  getItemValue,
  getItemLabel,
  onToggle,
}) {
  return (
    <div className="space-y-2">
      <p id={id} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <fieldset aria-labelledby={id} className="m-0 flex flex-wrap gap-2 border-0 p-0">
        {items.map((item) => {
          const value = getItemValue(item);
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className={cn(
                'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                selectedValues.includes(value)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-muted'
              )}
            >
              {getItemLabel(item)}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

function ValidationRuleSeverityField({ fieldId, severity, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-validation-severity`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
        Severity
      </label>
      <Select
        value={severity}
        onValueChange={(value) => setFormState((p) => ({ ...p, severity: value }))}
      >
        <SelectTrigger id={`${fieldId}-validation-severity`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          <SelectItem value="warning">
            <div>
              <div>Warning</div>
              <div className="text-xs text-muted-foreground">Show warning but allow save</div>
            </div>
          </SelectItem>
          <SelectItem value="error">
            <div>
              <div>Error</div>
              <div className="text-xs text-muted-foreground">Block publish until fixed</div>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ValidationRuleActiveField({ fieldId, isActive, setFormState }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${fieldId}-validation-active`} className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          id={`${fieldId}-validation-active`}
          checked={isActive}
          onCheckedChange={(value) =>
            setFormState((p) => ({ ...p, is_active: Boolean(value) }))
          }
        />
        <span className="text-sm">Active</span>
      </label>
    </div>
  );
}

function ValidationRuleDeleteDialog({ rule, onOpenChange, onDelete, isDeleting }) {
  return (
    <AlertDialog open={!!rule} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-destructive">
            Delete Validation Rule
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>"{rule?.name}"</strong>? This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * RosterSetupPage - Main component
 */
export default function RosterSetupPage() {
  const [selectedDepartment, setSelectedDepartment] = useState(null);

  const { data: treeData, isLoading: treeLoading } = useClinicalUnitsTree();
  const flatUnits = useMemo(() => {
    const nodes = treeData?.data || treeData || [];
    return flattenUnitTree(Array.isArray(nodes) ? nodes : []);
  }, [treeData]);

  // Include both departments and divisions for roster setup
  // Filter out ancillary and ops_only units (Lab, Radiology, Pharmacy, Administration)
  const rosterUnits = useMemo(
    () => flatUnits.filter((u) =>
      (u.unit_type_code === 'department' || u.unit_type_code === 'division') &&
      u.unit_category === 'clinical'
    ),
    [flatUnits]
  );

  // Get teams for selected unit - look under the unit itself OR its parent (for divisions)
  // This handles both Model A (teams under department) and Model B (teams under division)
  const teams = useMemo(() => {
    if (!selectedDepartment) return [];
    const selectedUnit = flatUnits.find((u) => u.id === selectedDepartment);
    if (!selectedUnit) return [];

    // If it's a division, also look for teams under the parent department
    // since teams might be siblings of divisions, not children
    const unitIdsToCheck = [selectedDepartment];
    if (selectedUnit.unit_type_code === 'division' && selectedUnit.parentId) {
      unitIdsToCheck.push(selectedUnit.parentId);
    }

    return flatUnits.filter(
      (u) => u.unit_type_code === 'team' && unitIdsToCheck.includes(u.parentId)
    );
  }, [selectedDepartment, flatUnits]);

  const { data: dutyTypeData } = useDepartmentDutyTypes(
    selectedDepartment ? { department: selectedDepartment } : null
  );
  const dutyTypes = toList(dutyTypeData);

  const pageMeta = usePageMeta({
    title: 'Roster Setup | Organization',
    breadcrumbs: [
      { label: 'Admin', href: '/admin' },
      { label: 'Organization', href: '/admin/organization' },
      { label: 'Roster Setup' },
    ],
  });

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Roster Setup"
        description="Configure teams, duty types, and rotation rules for each department or division."
        actions={(
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/organization/duty-roster">
              <ArrowLeft className="size-4 mr-1" />
              Back to Roster
            </Link>
          </Button>
        )}
      />

      <div className="container max-w-5xl mx-auto py-8 pb-24 px-4 sm:px-6 lg:px-8">

          {/* Department Selector */}
          <Card className="mb-6 border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-lg flex items-center gap-2">
                <CalendarClock className="size-5 text-primary" />
                Select Unit
              </CardTitle>
              <CardDescription>
                Choose a department or division to configure its roster settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UnitSelector
                value={selectedDepartment}
                onChange={setSelectedDepartment}
                units={rosterUnits}
                isLoading={treeLoading}
              />
            </CardContent>
          </Card>

          {/* Accordion sections */}
          <Accordion type="multiple" defaultValue={['teams', 'duty-types', 'rotation-rules']} className="space-y-4">
            {/* Teams Section */}
            <AccordionItem value="teams" className="border rounded-lg">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                    <Users className="size-4 text-sky-500" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-heading font-medium">Teams</h3>
                    <p className="text-xs text-muted-foreground">
                      {teams.length} team{teams.length !== 1 ? 's' : ''} available
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <TeamsPanel unitId={selectedDepartment} teams={teams} />
              </AccordionContent>
            </AccordionItem>

            {/* Duty Types Section */}
            <AccordionItem value="duty-types" className="border rounded-lg">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Clipboard className="size-4 text-amber-500" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-heading font-medium">Duty Types</h3>
                    <p className="text-xs text-muted-foreground">
                      {dutyTypes.length} duty type{dutyTypes.length !== 1 ? 's' : ''} defined
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <DutyTypesPanel departmentId={selectedDepartment} />
              </AccordionContent>
            </AccordionItem>

            {/* Rotation Rules Section */}
            <AccordionItem value="rotation-rules" className="border rounded-lg">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <RotateCw className="size-4 text-emerald-500" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-heading font-medium">Rotation Rules</h3>
                    <p className="text-xs text-muted-foreground">
                      How teams rotate through duties
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <RotationRulesPanel
                  departmentId={selectedDepartment}
                  teams={teams}
                  dutyTypes={dutyTypes}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Validation Rules Section */}
            <AccordionItem value="validation-rules" className="border rounded-lg !border-b">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-rose-500/10 flex items-center justify-center">
                    <ShieldAlert className="size-4 text-rose-500" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-heading font-medium">Validation Rules</h3>
                    <p className="text-xs text-muted-foreground">
                      Constraints on roster assignments
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <ValidationRulesPanel
                  departmentId={selectedDepartment}
                  teams={teams}
                  dutyTypes={dutyTypes}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Next Steps */}
          {selectedDepartment && dutyTypes.length > 0 && (
            <Card className="mt-6 border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-heading font-medium">Setup Complete?</h4>
                    <p className="text-sm text-muted-foreground">
                      Build your roster for this department.
                    </p>
                  </div>
                  <Button asChild>
                    <Link to={`/admin/organization/roster-builder?department=${selectedDepartment}`}>
                      Go to Roster Builder
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </PageShell>
  );
}
