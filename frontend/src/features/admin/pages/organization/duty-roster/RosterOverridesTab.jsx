/**
 * RosterOverridesTab - Manage roster overrides
 * Chronicle Design System styling
 */
import { useReducer, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Card, CardContent } from '@/components/ui/card';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import { toast } from 'sonner';
import { rosterOverridesApi } from '@/features/admin/api';
import {
  useDepartmentRosterPlans,
  useDepartmentDutyTypes,
  useRosterOverrides,
  useCreateRosterOverride,
  useUpdateRosterOverride,
  useDeleteRosterOverride,
} from '@/features/admin/hooks';
import { toList, toValue, formatRosterName, safeDate, formatRosterTime } from './utils';
import { DUTY_CONTEXT_OPTIONS, DUTY_ROLE_OPTIONS, SELECT_ALL, SELECT_DEFAULT } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

function createBlankOverrideForm(plan = '') {
  return {
    plan,
    date: '',
    duty_type: '',
    team: '',
    context_override: SELECT_DEFAULT,
    role_override: SELECT_DEFAULT,
    start_time: '',
    end_time: '',
    reason: '',
  };
}

function createOverrideFormState({ override, plan }) {
  if (!override) {
    return createBlankOverrideForm(plan);
  }
  return {
    plan: toValue(override.plan),
    date: safeDate(override.date),
    duty_type: toValue(override.duty_type),
    team: toValue(override.team),
    context_override: override.context_override || SELECT_DEFAULT,
    role_override: override.role_override || SELECT_DEFAULT,
    start_time: override.start_time ? override.start_time.slice(0, 5) : '',
    end_time: override.end_time ? override.end_time.slice(0, 5) : '',
    reason: override.reason || '',
  };
}

function overrideFormReducer(state, action) {
  if (action.type === 'field') {
    return { ...state, [action.name]: action.value };
  }
  return state;
}

function RosterOverrideFilters({
  departments,
  plans,
  selectedDepartment,
  selectedPlan,
  onDepartmentChange,
  onPlanChange,
}) {
  return (
    <FieldRow>
      <InlineField label="Filter by Department">
        <Select value={selectedDepartment} onValueChange={onDepartmentChange}>
          <SelectTrigger>
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            <SelectItem value={SELECT_ALL}>All departments</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InlineField>
      <InlineField label="Roster Plan">
        <Select value={selectedPlan} onValueChange={onPlanChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select plan" />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {plans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InlineField>
    </FieldRow>
  );
}

function RosterOverridesList({
  dutyTypes,
  isLoading,
  overrides,
  unitById,
  onEdit,
  onDelete,
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  if (overrides.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No overrides yet"
        description="Use overrides to capture ad-hoc duty changes."
      />
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Date</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Duty Type</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Team</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Timing</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Reason</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overrides.map((override, index) => (
            <TableRow key={override.id} className="animate-chronicle-enter" style={{ animationDelay: `${index * 30}ms` }}>
              <TableCell className="font-mono text-xs">{safeDate(override.date)}</TableCell>
              <TableCell className="text-sm">
                {formatRosterName(dutyTypes.find((dt) => dt.id === override.duty_type)?.name, override.duty_type_name)}
              </TableCell>
              <TableCell className="text-sm">{formatRosterName(unitById.get(override.team)?.name, override.team_name)}</TableCell>
              <TableCell className="font-mono text-xs">
                {override.start_time || override.end_time
                  ? `${formatRosterTime(override.start_time)} - ${formatRosterTime(override.end_time)}`
                  : 'All day'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{override.reason || '—'}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(override)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(override)}>Delete</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RosterOverrideFormDialog({
  createOverride,
  dutyTypes,
  editingOverride,
  onOpenChange,
  open,
  plans,
  selectedPlan,
  teamOptions,
  updateOverride,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <RosterOverrideFormContent
          key={editingOverride ? editingOverride.id : `new-${selectedPlan}`}
          createOverride={createOverride}
          dutyTypes={dutyTypes}
          editingOverride={editingOverride}
          onClose={() => onOpenChange(false)}
          plans={plans}
          selectedPlan={selectedPlan}
          teamOptions={teamOptions}
          updateOverride={updateOverride}
        />
      ) : null}
    </Dialog>
  );
}

function RosterOverrideFormContent({
  createOverride,
  dutyTypes,
  editingOverride,
  onClose,
  plans,
  selectedPlan,
  teamOptions,
  updateOverride,
}) {
  const [formState, dispatchForm] = useReducer(
    overrideFormReducer,
    { override: editingOverride, plan: selectedPlan },
    createOverrideFormState,
  );
  const updateField = (name) => (value) => dispatchForm({ type: 'field', name, value });
  const updateInputField = (name) => (event) => updateField(name)(event.target.value);

  const handleSubmit = async () => {
    try {
      const roleValue = formState.role_override === SELECT_DEFAULT ? null : formState.role_override;
      const contextValue = formState.context_override === SELECT_DEFAULT ? null : formState.context_override;
      const payload = {
        plan: formState.plan,
        date: formState.date,
        duty_type: formState.duty_type,
        team: formState.team,
        context_override: contextValue || null,
        role_override: roleValue || null,
        start_time: formState.start_time || null,
        end_time: formState.end_time || null,
        reason: formState.reason || '',
      };
      if (!payload.plan || !payload.date || !payload.duty_type || !payload.team) {
        toast.error('Plan, date, duty type, and team are required.');
        return;
      }
      if ((payload.start_time && !payload.end_time) || (!payload.start_time && payload.end_time)) {
        toast.error('Start and end time must both be set or blank.');
        return;
      }
      if (editingOverride) {
        await updateOverride.mutateAsync({ id: editingOverride.id, data: payload });
        toast.success('Override updated.');
      } else {
        await createOverride.mutateAsync(payload);
        toast.success('Override created.');
      }
      onClose();
    } catch (error) {
      toast.error(error.message || 'Failed to save override.');
    }
  };

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display text-xl">{editingOverride ? 'Edit Override' : 'Add Override'}</DialogTitle>
        <DialogDescription>Overrides replace the coverage for a specific date.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <FieldRow>
          <InlineField label="Roster Plan">
            <Select value={formState.plan} onValueChange={updateField('plan')}>
              <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
              <SelectContent className="z-[200]">
                {plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
          <InlineField label="Date">
            <Input type="date" value={formState.date} onChange={updateInputField('date')} className="font-mono" />
          </InlineField>
        </FieldRow>
        <FieldRow>
          <InlineField label="Duty Type">
            <Select value={formState.duty_type} onValueChange={updateField('duty_type')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="z-[200]">
                {dutyTypes.map((dt) => <SelectItem key={dt.id} value={dt.id}>{dt.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
          <InlineField label="Team">
            <Select value={formState.team} onValueChange={updateField('team')}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent className="z-[200]">
                {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
        </FieldRow>
        <FieldRow>
          <InlineField label="Role Override">
            <Select value={formState.role_override} onValueChange={updateField('role_override')}>
              <SelectTrigger><SelectValue placeholder="Default role" /></SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_DEFAULT}>Default</SelectItem>
                {DUTY_ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
          <InlineField label="Context Override">
            <Select value={formState.context_override} onValueChange={updateField('context_override')}>
              <SelectTrigger><SelectValue placeholder="Default context" /></SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_DEFAULT}>Default</SelectItem>
                {DUTY_CONTEXT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </InlineField>
        </FieldRow>
        <FieldRow>
          <InlineField label="Start Time">
            <Input type="time" value={formState.start_time} onChange={updateInputField('start_time')} className="font-mono" />
          </InlineField>
          <InlineField label="End Time">
            <Input type="time" value={formState.end_time} onChange={updateInputField('end_time')} className="font-mono" />
          </InlineField>
        </FieldRow>
        <InlineField label="Reason">
          <Textarea value={formState.reason} onChange={updateInputField('reason')} rows={2} />
        </InlineField>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={createOverride.isPending || updateOverride.isPending}>
          {editingOverride ? 'Save Changes' : 'Create Override'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function RosterOverridesTab() {
  const { isLoading: unitsLoading, departments, getTeamOptions, unitById } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [formDialog, setFormDialog] = useState({ open: false, editingOverride: null });

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: plansData } = useDepartmentRosterPlans({ department: departmentFilter });
  const plans = toList(plansData);
  const selectedPlanExists = plans.some((plan) => plan.id === selectedPlan);
  const activePlan = selectedPlanExists ? selectedPlan : plans[0]?.id || '';

  const { data: dutyTypesData } = useDepartmentDutyTypes({
    department: departmentFilter,
    include_inactive: 'true',
  });
  const dutyTypes = toList(dutyTypesData);

  const { data: overridesData, isLoading } = useRosterOverrides({ plan: activePlan || undefined });
  const overrides = toList(overridesData);

  const createOverride = useCreateRosterOverride();
  const updateOverride = useUpdateRosterOverride();
  const deleteOverride = useDeleteRosterOverride();

  const openForm = async (override) => {
    if (override) {
      try {
        const result = await rosterOverridesApi.get(override.id);
        const payload = result?.data || result;
        setFormDialog({ open: true, editingOverride: payload });
      } catch (error) {
        toast.error(error.message || 'Failed to load roster override.');
      }
    } else {
      setFormDialog({ open: true, editingOverride: null });
    }
  };

  const handleFormOpenChange = (open) => {
    if (!open) {
      setFormDialog({ open: false, editingOverride: null });
    }
  };

  const handleDelete = async (override) => {
    if (!confirm('Delete this override?')) return;
    try {
      await deleteOverride.mutateAsync(override.id);
      toast.success('Override deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete override.');
    }
  };

  const teamOptions = getTeamOptions(departmentFilter);

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Roster Overrides"
        subtitle="Record date-specific changes to the authoritative roster plan."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus className="size-4 mr-2" />
            <span className="font-mono text-xs uppercase tracking-wide">Add Override</span>
          </Button>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <RosterOverrideFilters
            departments={departments}
            onDepartmentChange={setSelectedDepartment}
            onPlanChange={setSelectedPlan}
            plans={plans}
            selectedDepartment={selectedDepartment}
            selectedPlan={activePlan}
          />
          <RosterOverridesList
            dutyTypes={dutyTypes}
            isLoading={unitsLoading || isLoading}
            onDelete={handleDelete}
            onEdit={openForm}
            overrides={overrides}
            unitById={unitById}
          />
        </CardContent>
      </Card>

      <RosterOverrideFormDialog
        createOverride={createOverride}
        dutyTypes={dutyTypes}
        editingOverride={formDialog.editingOverride}
        onOpenChange={handleFormOpenChange}
        open={formDialog.open}
        plans={plans}
        selectedPlan={activePlan}
        teamOptions={teamOptions}
        updateOverride={updateOverride}
      />
    </div>
  );
}
