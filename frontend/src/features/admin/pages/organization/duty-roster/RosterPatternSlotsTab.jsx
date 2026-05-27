/**
 * RosterPatternSlotsTab - Manage roster pattern slots
 * Chronicle Design System styling
 */
import { useId, useMemo, useReducer } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import Grid from 'lucide-react/dist/esm/icons/grid-3x3.js';
import { toast } from 'sonner';
import { rosterPatternSlotsApi } from '@/features/admin/api';
import {
  useDepartmentRosterPlans,
  useDepartmentRosterPatterns,
  useDepartmentDutyTypes,
  useRosterPatternSlots,
  useCreateRosterPatternSlot,
  useUpdateRosterPatternSlot,
  useDeleteRosterPatternSlot,
} from '@/features/admin/hooks';
import { toList, toValue, formatRosterName, formatRosterTime } from './utils';
import { DUTY_CONTEXT_OPTIONS, DUTY_ROLE_OPTIONS, DEFAULT_CYCLE_LENGTH, SELECT_ALL, SELECT_DEFAULT } from './constants';
import { useUnitOptions } from './useUnitOptions';
import { EmptyState, RosterHeader, InlineField, FieldRow } from './components';

const INITIAL_FILTERS = {
  department: SELECT_ALL,
  plan: '',
  pattern: SELECT_ALL,
  showInactive: false,
};

const INITIAL_FORM_STATE = {
  plan: '',
  pattern: '',
  day_offset: 0,
  duty_type: '',
  team: '',
  context_override: '',
  role_override: '',
  start_time: '',
  end_time: '',
  is_active: true,
};

const INITIAL_DIALOG_STATE = {
  isOpen: false,
  editingSlot: null,
  form: INITIAL_FORM_STATE,
};

function filtersReducer(state, action) {
  switch (action.type) {
    case 'set-department':
      return {
        ...state,
        department: action.value,
        plan: '',
        pattern: SELECT_ALL,
      };
    case 'set-plan':
      return {
        ...state,
        plan: action.value,
        pattern: SELECT_ALL,
      };
    case 'set-pattern':
      return {
        ...state,
        pattern: action.value,
      };
    case 'toggle-inactive':
      return {
        ...state,
        showInactive: !state.showInactive,
      };
    default:
      return state;
  }
}

function dialogReducer(state, action) {
  switch (action.type) {
    case 'open-create':
      return {
        isOpen: true,
        editingSlot: null,
        form: buildSlotForm({
          plan: action.plan,
          pattern: action.pattern,
          dayOffset: action.dayOffset,
          dutyType: action.dutyType,
        }),
      };
    case 'open-edit':
      return {
        isOpen: true,
        editingSlot: action.slot,
        form: buildSlotFormFromSlot(action.slot, action.fallbackPlan),
      };
    case 'update-field':
      return {
        ...state,
        form: {
          ...state.form,
          [action.field]: action.value,
        },
      };
    case 'close':
      return {
        ...state,
        isOpen: false,
      };
    default:
      return state;
  }
}

function buildSlotForm({
  plan = '',
  pattern = '',
  dayOffset = 0,
  dutyType = '',
} = {}) {
  return {
    ...INITIAL_FORM_STATE,
    plan: plan || '',
    pattern: pattern || '',
    day_offset: dayOffset,
    duty_type: dutyType,
  };
}

function buildSlotFormFromSlot(slot, fallbackPlan) {
  return {
    plan: toValue(fallbackPlan || slot.plan),
    pattern: toValue(slot.pattern),
    day_offset: slot.day_offset ?? 0,
    duty_type: toValue(slot.duty_type),
    team: toValue(slot.team),
    context_override: slot.context_override || '',
    role_override: slot.role_override || '',
    start_time: slot.start_time ? slot.start_time.slice(0, 5) : '',
    end_time: slot.end_time ? slot.end_time.slice(0, 5) : '',
    is_active: slot.is_active ?? true,
  };
}

function pickActivePlan(plans, requestedPlan) {
  if (!plans.length) return '';
  return plans.some((plan) => plan.id === requestedPlan) ? requestedPlan : plans[0].id;
}

function pickActivePattern(patterns, requestedPattern) {
  if (!patterns.length) return '';
  if (requestedPattern === SELECT_ALL) return SELECT_ALL;
  return patterns.some((pattern) => pattern.id === requestedPattern) ? requestedPattern : SELECT_ALL;
}

export function RosterPatternSlotsTab() {
  const { isLoading: unitsLoading, departments, getTeamOptions, unitById } = useUnitOptions();
  const [filters, dispatchFilters] = useReducer(filtersReducer, INITIAL_FILTERS);
  const [dialogState, dispatchDialog] = useReducer(dialogReducer, INITIAL_DIALOG_STATE);

  const { department: selectedDepartment, plan: requestedPlan, pattern: requestedPattern, showInactive } = filters;
  const { isOpen: showForm, editingSlot, form: formState } = dialogState;
  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;

  const { data: plansData } = useDepartmentRosterPlans({ department: departmentFilter });
  const plans = toList(plansData);
  const selectedPlan = pickActivePlan(plans, requestedPlan);

  const { data: patternsData } = useDepartmentRosterPatterns({
    plan: selectedPlan || undefined,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const patterns = toList(patternsData);
  const selectedPattern = pickActivePattern(patterns, requestedPattern);
  const patternFilterValue = selectedPattern && selectedPattern !== SELECT_ALL ? selectedPattern : undefined;
  const patternById = useMemo(() => new Map(patterns.map((p) => [p.id, p])), [patterns]);

  const { data: dutyTypesData } = useDepartmentDutyTypes({
    department: departmentFilter,
    include_inactive: 'true',
  });
  const dutyTypes = toList(dutyTypesData);

  const { data: slotsData, isLoading } = useRosterPatternSlots({
    plan: selectedPlan || undefined,
    pattern: patternFilterValue,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const slots = toList(slotsData);

  const createSlot = useCreateRosterPatternSlot();
  const updateSlot = useUpdateRosterPatternSlot();
  const deleteSlot = useDeleteRosterPatternSlot();

  const openForm = async (slot) => {
    if (slot) {
      try {
        const result = await rosterPatternSlotsApi.get(slot.id);
        const payload = result?.data || result;
        dispatchDialog({ type: 'open-edit', slot: payload, fallbackPlan: selectedPlan });
      } catch (error) {
        toast.error(error.message || 'Failed to load pattern slot.');
        return;
      }
    } else {
      dispatchDialog({ type: 'open-create', plan: selectedPlan, pattern: patternFilterValue });
    }
  };

  const handleSubmit = async () => {
    try {
      const patternValue = formState.pattern === SELECT_DEFAULT ? null : formState.pattern;
      const roleValue = formState.role_override === SELECT_DEFAULT ? null : formState.role_override;
      const contextValue = formState.context_override === SELECT_DEFAULT ? null : formState.context_override;
      const payload = {
        plan: formState.plan,
        pattern: patternValue || null,
        day_offset: Number(formState.day_offset) || 0,
        duty_type: formState.duty_type,
        team: formState.team,
        context_override: contextValue || null,
        role_override: roleValue || null,
        start_time: formState.start_time || null,
        end_time: formState.end_time || null,
        is_active: !!formState.is_active,
      };
      if (!payload.plan || !payload.duty_type || !payload.team) {
        toast.error('Plan, duty type, and team are required.');
        return;
      }
      if ((payload.start_time && !payload.end_time) || (!payload.start_time && payload.end_time)) {
        toast.error('Start and end time must both be set or blank.');
        return;
      }
      if (editingSlot) {
        await updateSlot.mutateAsync({ id: editingSlot.id, data: payload });
        toast.success('Pattern slot updated.');
      } else {
        await createSlot.mutateAsync(payload);
        toast.success('Pattern slot created.');
      }
      dispatchDialog({ type: 'close' });
    } catch (error) {
      toast.error(error.message || 'Failed to save pattern slot.');
    }
  };

  const handleDelete = async (slot) => {
    if (!confirm('Delete this roster slot?')) return;
    try {
      await deleteSlot.mutateAsync(slot.id);
      toast.success('Roster slot deleted.');
    } catch (error) {
      toast.error(error.message || 'Failed to delete slot.');
    }
  };

  const teamOptions = getTeamOptions(departmentFilter);
  const activePlan = plans.find((p) => p.id === selectedPlan);
  const cycleLength = activePlan?.cycle_length_days || DEFAULT_CYCLE_LENGTH;
  const dayOffsets = useMemo(() => Array.from({ length: cycleLength }, (_, i) => i), [cycleLength]);

  const slotByKey = useMemo(() => {
    const map = new Map();
    slots.forEach((slot) => {
      map.set(`${slot.duty_type}-${slot.day_offset}`, slot);
    });
    return map;
  }, [slots]);

  const openGridCreate = (dayOffset, dutyTypeId) => {
    dispatchDialog({
      type: 'open-create',
      plan: selectedPlan || '',
      pattern: patternFilterValue || '',
      dayOffset,
      dutyType: dutyTypeId,
    });
  };

  const updateFormField = (field, value) => {
    dispatchDialog({ type: 'update-field', field, value });
  };

  const handleDialogOpenChange = (open) => {
    if (!open) {
      dispatchDialog({ type: 'close' });
    }
  };

  return (
    <div className="space-y-6">
      <RosterHeader
        title="Roster Pattern Slots"
        subtitle="Plan the cyclical coverage assignments for each department."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => dispatchFilters({ type: 'toggle-inactive' })}
              className="font-mono text-xs"
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button onClick={() => openForm(null)}>
              <Plus className="size-4 mr-2" />
              <span className="font-mono text-xs uppercase tracking-wide">Add Slot</span>
            </Button>
          </>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <FieldRow>
            <InlineField label="Department">
              <Select value={selectedDepartment} onValueChange={(value) => dispatchFilters({ type: 'set-department', value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
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
              <Select value={selectedPlan} onValueChange={(value) => dispatchFilters({ type: 'set-plan', value })}>
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
          <InlineField label="Pattern">
            <Select value={selectedPattern} onValueChange={(value) => dispatchFilters({ type: 'set-pattern', value })}>
              <SelectTrigger>
                <SelectValue placeholder="All patterns" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                <SelectItem value={SELECT_ALL}>All patterns</SelectItem>
                {patterns.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </InlineField>

          <RosterPatternSlotGrid
            cycleLength={cycleLength}
            dayOffsets={dayOffsets}
            dutyTypes={dutyTypes}
            selectedPattern={selectedPattern}
            selectedPlan={selectedPlan}
            slotByKey={slotByKey}
            unitById={unitById}
            onCreateSlot={openGridCreate}
            onEditSlot={openForm}
          />

          {unitsLoading || isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : slots.length === 0 ? (
            <EmptyState
              icon={Grid}
              title="No pattern slots yet"
              description="Add daily coverage slots within the roster cycle."
            />
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Day</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Pattern</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Duty Type</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Team</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Timing</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((slot, index) => (
                    <TableRow key={slot.id} className="animate-chronicle-enter" style={{ animationDelay: `${index * 30}ms` }}>
                      <TableCell className="font-mono text-xs">Day {slot.day_offset}</TableCell>
                      <TableCell className="text-sm">{formatRosterName(patternById.get(slot.pattern)?.name, 'Default')}</TableCell>
                      <TableCell className="text-sm">
                        {formatRosterName(dutyTypes.find((dt) => dt.id === slot.duty_type)?.name, slot.duty_type_name)}
                      </TableCell>
                      <TableCell className="text-sm">{formatRosterName(unitById.get(slot.team)?.name, slot.team_name)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {slot.start_time || slot.end_time
                          ? `${formatRosterTime(slot.start_time)} - ${formatRosterTime(slot.end_time)}`
                          : 'All day'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-[10px] font-mono', slot.is_active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground')}>
                          {slot.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openForm(slot)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(slot)}>Delete</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <RosterPatternSlotDialog
        isOpen={showForm}
        onOpenChange={handleDialogOpenChange}
        editingSlot={editingSlot}
        formState={formState}
        plans={plans}
        patterns={patterns}
        dutyTypes={dutyTypes}
        teamOptions={teamOptions}
        isSaving={createSlot.isPending || updateSlot.isPending}
        onCancel={() => dispatchDialog({ type: 'close' })}
        onFieldChange={updateFormField}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function RosterPatternSlotGrid({
  cycleLength,
  dayOffsets,
  dutyTypes,
  selectedPattern,
  selectedPlan,
  slotByKey,
  unitById,
  onCreateSlot,
  onEditSlot,
}) {
  if (!selectedPlan || !selectedPattern || dutyTypes.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="border-b border-border px-4 py-2.5 bg-muted/30">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Grid Editor - {cycleLength} Day Cycle
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-[10px] uppercase">Duty Type</TableHead>
              {dayOffsets.map((offset) => (
                <TableHead key={offset} className="text-center font-mono text-[10px] uppercase">
                  Day {offset}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dutyTypes.map((dutyType) => (
              <TableRow key={dutyType.id}>
                <TableCell className="font-heading font-medium text-sm">{dutyType.name}</TableCell>
                {dayOffsets.map((offset) => {
                  const slot = slotByKey.get(`${dutyType.id}-${offset}`);
                  const teamName = slot ? unitById.get(slot.team)?.name : null;
                  return (
                    <TableCell key={`${dutyType.id}-${offset}`} className="text-center p-2">
                      {slot ? (
                        <div className="space-y-1">
                          <div className="text-xs font-medium">{formatRosterName(teamName)}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {slot.start_time || slot.end_time
                              ? `${formatRosterTime(slot.start_time)} - ${formatRosterTime(slot.end_time)}`
                              : 'All day'}
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onEditSlot(slot)}>
                            Edit
                          </Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onCreateSlot(offset, dutyType.id)}>
                          Add
                        </Button>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RosterPatternSlotDialog({
  isOpen,
  onOpenChange,
  editingSlot,
  formState,
  plans,
  patterns,
  dutyTypes,
  teamOptions,
  isSaving,
  onCancel,
  onFieldChange,
  onSubmit,
}) {
  const fieldId = useId();

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{editingSlot ? 'Edit Pattern Slot' : 'Add Pattern Slot'}</DialogTitle>
          <DialogDescription>Slots define which team covers a duty type for each cycle day.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FieldRow>
            <InlineField label="Roster Plan">
              <Select value={formState.plan} onValueChange={(value) => onFieldChange('plan', value)}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  {plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
            <InlineField label="Pattern">
              <Select value={formState.pattern} onValueChange={(value) => onFieldChange('pattern', value)}>
                <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  <SelectItem value={SELECT_DEFAULT}>Default</SelectItem>
                  {patterns.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
          </FieldRow>
          <div className="grid gap-4 sm:grid-cols-3">
            <InlineField label="Day Offset">
              <Input type="number" min="0" value={formState.day_offset} onChange={(event) => onFieldChange('day_offset', event.target.value)} className="font-mono" />
            </InlineField>
            <InlineField label="Duty Type">
              <Select value={formState.duty_type} onValueChange={(value) => onFieldChange('duty_type', value)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  {dutyTypes.map((dt) => <SelectItem key={dt.id} value={dt.id}>{dt.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
            <InlineField label="Team">
              <Select value={formState.team} onValueChange={(value) => onFieldChange('team', value)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
          </div>
          <FieldRow>
            <InlineField label="Role Override">
              <Select value={formState.role_override} onValueChange={(value) => onFieldChange('role_override', value)}>
                <SelectTrigger><SelectValue placeholder="Default role" /></SelectTrigger>
                <SelectContent className="z-[200]">
                  <SelectItem value={SELECT_DEFAULT}>Default</SelectItem>
                  {DUTY_ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </InlineField>
            <InlineField label="Context Override">
              <Select value={formState.context_override} onValueChange={(value) => onFieldChange('context_override', value)}>
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
              <Input type="time" value={formState.start_time} onChange={(event) => onFieldChange('start_time', event.target.value)} className="font-mono" />
            </InlineField>
            <InlineField label="End Time">
              <Input type="time" value={formState.end_time} onChange={(event) => onFieldChange('end_time', event.target.value)} className="font-mono" />
            </InlineField>
          </FieldRow>
          <InlineField label="Status">
            <div className="pt-2">
              <label htmlFor={`${fieldId}-slot-active`} className="flex items-center gap-2 cursor-pointer">
                <Checkbox id={`${fieldId}-slot-active`} checked={formState.is_active} onCheckedChange={(value) => onFieldChange('is_active', Boolean(value))} />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </InlineField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSubmit} disabled={isSaving}>
            {editingSlot ? 'Save Changes' : 'Create Slot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
