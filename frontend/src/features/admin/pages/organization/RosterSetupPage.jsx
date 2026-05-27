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
      <div className="flex justify-end">
        <Button onClick={() => openForm()} size="sm">
          <Plus className="size-4 mr-1" />
          <span className="font-mono text-xs">Add Duty Type</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : dutyTypes.length === 0 ? (
        <EmptyState
          icon={Clipboard}
          title="No duty types yet"
          description="Add duty types like 'OBS Clinic', 'Theatre', 'Weekend Duty'."
        />
      ) : (
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
            {dutyTypes.map((dt, index) => (
              <TableRow
                key={dt.id}
                className="animate-chronicle-enter"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <TableCell>
                  <div className="font-heading font-medium">{dt.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{dt.code}</div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      dt.category === 'clinic'
                        ? 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                        : 'bg-muted/50'
                    )}
                  >
                    {dt.category_display || dt.category || 'Ward'}
                  </Badge>
                  {dt.category === 'clinic' && (
                    <div className="font-mono text-[9px] text-muted-foreground mt-0.5">
                      {dt.clinic_name ? dt.clinic_name : dt.slot_duration_minutes ? `${dt.slot_duration_minutes}min slots` : 'No clinic linked'}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {DAYS_OF_WEEK.map((d) => (
                      (dt.applicable_days || []).includes(d.value) ? (
                        <Badge key={d.value} variant="outline" className="text-[9px] px-1.5">
                          {d.label}
                        </Badge>
                      ) : null
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {dt.is_24_hour ? '24hr' : `${dt.start_time?.slice(0, 5) || '--'}-${dt.end_time?.slice(0, 5) || '--'}`}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      dt.is_active
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {dt.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openForm(dt)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(dt)}>
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
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

            {/* Category Selector */}
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-duty-category`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Category
              </label>
              <Select
                value={formState.category}
                onValueChange={(v) => setFormState((p) => ({ ...p, category: v }))}
              >
                <SelectTrigger id={`${fieldId}-duty-category`} className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {DUTY_CATEGORY_OPTIONS.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex flex-col">
                        <span>{cat.label}</span>
                        <span className="text-xs text-muted-foreground">{cat.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p id={`${fieldId}-applicable-days-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Applicable Days
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setFormState((p) => ({ ...p, applicable_days: [0, 1, 2, 3, 4] }))}
                    className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Weekdays
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormState((p) => ({ ...p, applicable_days: [5, 6] }))}
                    className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Weekends
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormState((p) => ({ ...p, applicable_days: [0, 1, 2, 3, 4, 5, 6] }))}
                    className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormState((p) => ({ ...p, applicable_days: [] }))}
                    className="px-2 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div role="group" aria-labelledby={`${fieldId}-applicable-days-label`} className="flex flex-wrap gap-2">
                {DAYS_OF_WEEK.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                      formState.applicable_days.includes(day.value)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border hover:bg-muted'
                    )}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label htmlFor={`${fieldId}-is-24-hour`} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id={`${fieldId}-is-24-hour`}
                  checked={formState.is_24_hour}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, is_24_hour: Boolean(v) }))}
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

            {/* Clinic-specific fields - shown when category is 'clinic' */}
            {formState.category === 'clinic' && (
              <div className="space-y-4 pt-2 border-t border-border">
                <div className="flex items-center gap-2 text-amber-600">
                  <CalendarClock className="size-4" />
                  <span className="text-xs font-medium">Appointment Scheduling Settings</span>
                </div>

                {/* Clinic Selector */}
                <div className="space-y-2">
                  <label htmlFor={`${fieldId}-clinic-link`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Link to Clinic
                  </label>
                  <Select
                    value={formState.clinic || ''}
                    onValueChange={(v) => setFormState((p) => ({ ...p, clinic: v }))}
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
                      ? 'No clinics available. Create clinics in Organization → unit → Clinics tab.'
                      : 'Required. This is what connects the roster to outpatient clinic availability.'}
                  </p>
                </div>

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
                      For group sessions or overbooking per doctor. Multiple doctors in same clinic each get their own slots via roster.
                    </p>
                  </div>
                </div>

                {/* Breaks Editor */}
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

                  {formState.breaks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No breaks configured. Slots will be generated continuously.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {formState.breaks.map((brk, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            aria-label={`Break ${idx + 1} start time`}
                            type="time"
                            value={brk.start}
                            onChange={(e) => {
                              const updated = [...formState.breaks];
                              updated[idx] = { ...updated[idx], start: e.target.value };
                              setFormState((p) => ({ ...p, breaks: updated }));
                            }}
                            className="font-mono w-28"
                          />
                          <span className="text-muted-foreground">to</span>
                          <Input
                            aria-label={`Break ${idx + 1} end time`}
                            type="time"
                            value={brk.end}
                            onChange={(e) => {
                              const updated = [...formState.breaks];
                              updated[idx] = { ...updated[idx], end: e.target.value };
                              setFormState((p) => ({ ...p, breaks: updated }));
                            }}
                            className="font-mono w-28"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setFormState((p) => ({
                                ...p,
                                breaks: p.breaks.filter((_, i) => i !== idx),
                              }));
                            }}
                          >
                            <Trash2 className="size-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

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
                    onCheckedChange={(v) => setFormState((p) => ({ ...p, is_active: Boolean(v) }))}
                  />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-destructive">
              Delete Duty Type
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>"{deleteConfirm?.name}"</strong>? This may affect existing roster entries and rotation rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDutyType}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
      <div className="flex justify-end">
        <Button onClick={() => openForm()} size="sm" disabled={teams.length === 0 || dutyTypes.length === 0}>
          <Plus className="size-4 mr-1" />
          <span className="font-mono text-xs">Add Rule</span>
        </Button>
      </div>

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

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={RotateCw}
          title="No rotation rules yet"
          description="Define how teams rotate through duty types."
        />
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <Card
              key={rule.id}
              className="animate-chronicle-enter"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-heading font-medium">{rule.name}</h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {getDutyTypeName(rule.duty_type)} &middot;{' '}
                      {RULE_TYPES.find((r) => r.value === rule.rule_type)?.label || rule.rule_type}
                    </p>
                    {rule.team_sequence?.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {rule.team_sequence.map((teamId, i) => (
                          <span key={teamId} className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {getTeamName(teamId)}
                            </Badge>
                            {i < rule.team_sequence.length - 1 && (
                              <span className="text-muted-foreground">→</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        rule.is_active
                          ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => openForm(rule)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(rule)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
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
                onValueChange={(v) => setFormState((p) => ({ ...p, duty_type: v }))}
              >
                <SelectTrigger id={`${fieldId}-duty-type`}>
                  <SelectValue placeholder="Select duty type" />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {dutyTypes.map((dt) => (
                    <SelectItem key={dt.id} value={dt.id}>
                      {dt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label htmlFor={`${fieldId}-rule-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Rule Type
              </label>
              <Select
                value={formState.rule_type}
                onValueChange={(v) => setFormState((p) => ({ ...p, rule_type: v }))}
              >
                <SelectTrigger id={`${fieldId}-rule-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {RULE_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>
                      <div>
                        <div>{rt.label}</div>
                        <div className="text-xs text-muted-foreground">{rt.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formState.rule_type === 'sequential' && (
              <div className="space-y-2">
                <p id={`${fieldId}-team-sequence-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Team Sequence (click to toggle)
                </p>
                <div role="group" aria-labelledby={`${fieldId}-team-sequence-label`} className="flex flex-wrap gap-2">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => toggleTeamInSequence(team.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                        formState.team_sequence.includes(team.id)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border hover:bg-muted'
                      )}
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
                {formState.team_sequence.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Order: {formState.team_sequence.map((t) => getTeamName(t)).join(' → ')}
                  </p>
                )}
              </div>
            )}

            {formState.rule_type === 'fixed_weekly' && (
              <div className="space-y-3">
                <p id={`${fieldId}-day-assignments-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Day Assignments (click to assign)
                </p>
                <div role="group" aria-labelledby={`${fieldId}-day-assignments-label`} className="border rounded-lg overflow-hidden">
                  {/* Header row with team names */}
                  <div className="grid bg-muted/50 border-b" style={{ gridTemplateColumns: `60px repeat(${teams.length}, 1fr)` }}>
                    <div className="p-2 text-[10px] font-mono uppercase text-muted-foreground border-r">Day</div>
                    {teams.map((team) => (
                      <div key={team.id} className="p-2 text-[10px] font-mono uppercase text-center text-muted-foreground truncate">
                        {team.code || team.name.slice(0, 6)}
                      </div>
                    ))}
                  </div>
                  {/* Day rows */}
                  {DAYS_OF_WEEK.map((day, dayIndex) => (
                    <div
                      key={day.value}
                      className={cn('grid', dayIndex < DAYS_OF_WEEK.length - 1 && 'border-b')}
                      style={{ gridTemplateColumns: `60px repeat(${teams.length}, 1fr)` }}
                    >
                      <div className="p-2 text-xs font-mono text-muted-foreground border-r bg-muted/30">
                        {day.label}
                      </div>
                      {teams.map((team) => {
                        const isSelected = formState.day_assignments[String(day.value)] === team.id;
                        return (
                          <button
                            key={team.id}
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
                              isSelected
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted/50'
                            )}
                          >
                            {isSelected && <span className="text-xs">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click a cell to assign that team to that day. Only one team per day.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor={`${fieldId}-rotation-active`} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id={`${fieldId}-rotation-active`}
                  checked={formState.is_active}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, is_active: Boolean(v) }))}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-destructive">
              Delete Rotation Rule
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>"{deleteConfirm?.name}"</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRotationRule}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
      <div className="flex justify-end">
        <Button size="sm" onClick={() => openForm()}>
          <Plus className="size-4 mr-1" />
          Add Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="p-4 rounded-lg border border-dashed border-border text-center">
          <p className="text-sm text-muted-foreground">
            No validation rules defined. Rules help prevent scheduling conflicts.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="p-4 rounded-lg border border-border hover:border-primary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-heading font-medium">{rule.name}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[9px] font-mono',
                        rule.severity === 'error'
                          ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                          : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      )}
                    >
                      {rule.severity}
                    </Badge>
                    {!rule.is_active && (
                      <Badge variant="secondary" className="text-[9px]">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {rule.rule_type_display} •{' '}
                    {rule.rule_type === 'linked_duty_no_consecutive'
                      ? (rule.params?.duty_type_ids || [])
                          .map((id) => dutyTypes.find((dt) => dt.id === id)?.name || id)
                          .join(', ') || 'No duty types linked'
                      : getDutyTypeName(rule.duty_type)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openForm(rule)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirm(rule)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
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
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-validation-name`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Rule Name
              </label>
              <Input
                id={`${fieldId}-validation-name`}
                value={formState.name}
                onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g., No back-to-back weekends"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor={`${fieldId}-validation-rule-type`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Rule Type
              </label>
              <Select
                value={formState.rule_type}
                onValueChange={(v) => setFormState((p) => ({ ...p, rule_type: v, params: {} }))}
              >
                <SelectTrigger id={`${fieldId}-validation-rule-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[200]">
                  {templates && Object.entries(templates).map(([key, tmpl]) => (
                    <SelectItem key={key} value={key}>
                      <div>
                        <div>{tmpl.name}</div>
                        <div className="text-xs text-muted-foreground">{tmpl.description}</div>
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

            {/* Apply To - not shown for linked_duty_no_consecutive which uses duty_type_ids param */}
            {formState.rule_type !== 'linked_duty_no_consecutive' && (
              <div className="space-y-2">
                <label htmlFor={`${fieldId}-validation-apply-to`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Apply To
                </label>
                <Select
                  value={formState.duty_type || '_all_'}
                  onValueChange={(v) => setFormState((p) => ({ ...p, duty_type: v === '_all_' ? '' : v }))}
                >
                  <SelectTrigger id={`${fieldId}-validation-apply-to`}>
                    <SelectValue placeholder="All duty types" />
                  </SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value="_all_">All duty types</SelectItem>
                    {dutyTypes.map((dt) => (
                      <SelectItem key={dt.id} value={dt.id}>
                        {dt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Dynamic params based on rule type */}
            {formState.rule_type === 'no_consecutive_days' && (
              <div className="space-y-2">
                <label htmlFor={`${fieldId}-validation-days-apart`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Days Apart
                </label>
                <Input
                  id={`${fieldId}-validation-days-apart`}
                  type="number"
                  min={1}
                  max={6}
                  value={formState.params.days_apart || 1}
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
            )}

            {formState.rule_type === 'day_pair_exclusion' && (
              <div className="space-y-2">
                <p id={`${fieldId}-excluded-day-pairs-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Excluded Day Pairs
                </p>
                <div role="group" aria-labelledby={`${fieldId}-excluded-day-pairs-label`} className="space-y-2">
                  {(formState.params.pairs || []).map((pair, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        value={String(pair[0])}
                        onValueChange={(v) => {
                          const newPairs = [...(formState.params.pairs || [])];
                          newPairs[idx] = [parseInt(v), pair[1]];
                          setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
                        }}
                      >
                        <SelectTrigger aria-label={`Excluded day pair ${idx + 1} first day`} className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {DAYS_OF_WEEK.map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">→</span>
                      <Select
                        value={String(pair[1])}
                        onValueChange={(v) => {
                          const newPairs = [...(formState.params.pairs || [])];
                          newPairs[idx] = [pair[0], parseInt(v)];
                          setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
                        }}
                      >
                        <SelectTrigger aria-label={`Excluded day pair ${idx + 1} second day`} className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {DAYS_OF_WEEK.map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          const newPairs = (formState.params.pairs || []).filter((_, i) => i !== idx);
                          setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newPairs = [...(formState.params.pairs || []), [4, 5]]; // Default Fri-Sat
                      setFormState((p) => ({ ...p, params: { ...p.params, pairs: newPairs } }));
                    }}
                  >
                    <Plus className="size-4 mr-1" />
                    Add Pair
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Team cannot work both days of a pair in the same week.
                </p>
              </div>
            )}

            {formState.rule_type === 'max_per_period' && (
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
                    value={formState.params.max || 2}
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
                    value={formState.params.period || 'week'}
                    onValueChange={(v) =>
                      setFormState((p) => ({ ...p, params: { ...p.params, period: v } }))
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
            )}

            {formState.rule_type === 'team_day_exclusion' && (
              <>
                <div className="space-y-2">
                  <p id={`${fieldId}-excluded-teams-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Excluded Teams
                  </p>
                  <div role="group" aria-labelledby={`${fieldId}-excluded-teams-label`} className="flex flex-wrap gap-2">
                    {teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => {
                          const currentTeams = formState.params.team_ids || [];
                          const newTeams = currentTeams.includes(team.id)
                            ? currentTeams.filter((t) => t !== team.id)
                            : [...currentTeams, team.id];
                          setFormState((p) => ({ ...p, params: { ...p.params, team_ids: newTeams } }));
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                          (formState.params.team_ids || []).includes(team.id)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:bg-muted'
                        )}
                      >
                        {team.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p id={`${fieldId}-excluded-days-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Excluded Days
                  </p>
                  <div role="group" aria-labelledby={`${fieldId}-excluded-days-label`} className="flex flex-wrap gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => {
                          const currentDays = formState.params.days || [];
                          const newDays = currentDays.includes(day.value)
                            ? currentDays.filter((d) => d !== day.value)
                            : [...currentDays, day.value];
                          setFormState((p) => ({ ...p, params: { ...p.params, days: newDays } }));
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                          (formState.params.days || []).includes(day.value)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:bg-muted'
                        )}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {formState.rule_type === 'linked_duty_no_consecutive' && (
              <>
                <div className="space-y-2">
                  <p id={`${fieldId}-linked-duty-types-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Linked Duty Types
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Select duty types that should be treated as linked for consecutive day checking.
                  </p>
                  <div role="group" aria-labelledby={`${fieldId}-linked-duty-types-label`} className="flex flex-wrap gap-2">
                    {dutyTypes.map((dt) => (
                      <button
                        key={dt.id}
                        type="button"
                        onClick={() => {
                          const currentTypes = formState.params.duty_type_ids || [];
                          const newTypes = currentTypes.includes(dt.id)
                            ? currentTypes.filter((t) => t !== dt.id)
                            : [...currentTypes, dt.id];
                          setFormState((p) => ({ ...p, params: { ...p.params, duty_type_ids: newTypes } }));
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md border text-xs font-mono transition-colors',
                          (formState.params.duty_type_ids || []).includes(dt.id)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:bg-muted'
                        )}
                      >
                        {dt.name}
                      </button>
                    ))}
                  </div>
                  {(formState.params.duty_type_ids || []).length < 2 && (
                    <p className="text-xs text-amber-600">Select at least 2 duty types to link.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${fieldId}-linked-days-apart`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Days Apart
                  </label>
                  <Input
                    id={`${fieldId}-linked-days-apart`}
                    type="number"
                    min={1}
                    max={6}
                    value={formState.params.days_apart || 1}
                    onChange={(e) =>
                      setFormState((p) => ({
                        ...p,
                        params: { ...p.params, days_apart: parseInt(e.target.value) || 1 },
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    1 = no back-to-back days (e.g., Fri Emergency Weekdays → Sat Emergency Weekends)
                  </p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <label htmlFor={`${fieldId}-validation-severity`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Severity
              </label>
              <Select
                value={formState.severity}
                onValueChange={(v) => setFormState((p) => ({ ...p, severity: v }))}
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

            <div className="space-y-2">
              <label htmlFor={`${fieldId}-validation-active`} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id={`${fieldId}-validation-active`}
                  checked={formState.is_active}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, is_active: Boolean(v) }))}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingItem ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-destructive">
              Delete Validation Rule
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>"{deleteConfirm?.name}"</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
