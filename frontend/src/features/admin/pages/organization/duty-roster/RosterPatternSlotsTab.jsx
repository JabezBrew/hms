/**
 * RosterPatternSlotsTab - Manage roster pattern slots
 * Chronicle Design System styling
 */
import { useState, useEffect, useMemo } from 'react';
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

export function RosterPatternSlotsTab() {
  const { isLoading: unitsLoading, departments, getTeamOptions, unitById } = useUnitOptions();
  const [selectedDepartment, setSelectedDepartment] = useState(SELECT_ALL);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedPattern, setSelectedPattern] = useState(SELECT_ALL);
  const [showInactive, setShowInactive] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const departmentFilter = selectedDepartment === SELECT_ALL ? undefined : selectedDepartment;
  const patternFilter = selectedPattern === SELECT_ALL ? undefined : selectedPattern;

  const { data: plansData } = useDepartmentRosterPlans({ department: departmentFilter });
  const plans = toList(plansData);

  const { data: patternsData } = useDepartmentRosterPatterns({
    plan: selectedPlan || undefined,
    include_inactive: showInactive ? 'true' : undefined,
  });
  const patternFilterValue = patternFilter;
  const patterns = toList(patternsData);
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

  const [formState, setFormState] = useState({
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
  });

  useEffect(() => {
    if (!showForm) {
      setEditingSlot(null);
      setFormState({
        plan: selectedPlan || '',
        pattern: patternFilterValue || '',
        day_offset: 0,
        duty_type: '',
        team: '',
        context_override: '',
        role_override: '',
        start_time: '',
        end_time: '',
        is_active: true,
      });
    }
  }, [showForm, selectedPlan, selectedPattern]);

  useEffect(() => {
    if (!plans.length) {
      setSelectedPlan('');
      setSelectedPattern('');
      return;
    }
    if (!selectedPlan || !plans.some((p) => p.id === selectedPlan)) {
      setSelectedPlan(plans[0].id);
    }
  }, [plans, selectedPlan]);

  useEffect(() => {
    if (!patterns.length) {
      setSelectedPattern('');
      return;
    }
    if (selectedPattern !== SELECT_ALL && !patterns.some((p) => p.id === selectedPattern)) {
      setSelectedPattern(SELECT_ALL);
    }
  }, [patterns, selectedPattern]);

  const openForm = async (slot) => {
    if (slot) {
      try {
        const result = await rosterPatternSlotsApi.get(slot.id);
        const payload = result?.data || result;
        setEditingSlot(payload);
        setFormState({
          plan: toValue(selectedPlan || payload.plan),
          pattern: toValue(payload.pattern),
          day_offset: payload.day_offset ?? 0,
          duty_type: toValue(payload.duty_type),
          team: toValue(payload.team),
          context_override: payload.context_override || '',
          role_override: payload.role_override || '',
          start_time: payload.start_time ? payload.start_time.slice(0, 5) : '',
          end_time: payload.end_time ? payload.end_time.slice(0, 5) : '',
          is_active: payload.is_active ?? true,
        });
      } catch (error) {
        toast.error(error.message || 'Failed to load pattern slot.');
        return;
      }
    } else {
      setEditingSlot(null);
      setFormState((prev) => ({
        ...prev,
        plan: selectedPlan || prev.plan,
        pattern: patternFilterValue || prev.pattern,
      }));
    }
    setShowForm(true);
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
      setShowForm(false);
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
    setEditingSlot(null);
    setFormState({
      plan: selectedPlan || '',
      pattern: patternFilterValue || '',
      day_offset: dayOffset,
      duty_type: dutyTypeId,
      team: '',
      context_override: '',
      role_override: '',
      start_time: '',
      end_time: '',
      is_active: true,
    });
    setShowForm(true);
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
              onClick={() => setShowInactive((prev) => !prev)}
              className="font-mono text-xs"
            >
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
            <Button onClick={() => openForm(null)}>
              <Plus className="h-4 w-4 mr-2" />
              <span className="font-mono text-xs uppercase tracking-wide">Add Slot</span>
            </Button>
          </>
        }
      />

      <Card className="border-border">
        <CardContent className="p-4 space-y-4">
          <FieldRow>
            <InlineField label="Department">
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
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
              <Select value={selectedPlan} onValueChange={setSelectedPlan}>
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
            <Select value={selectedPattern} onValueChange={setSelectedPattern}>
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

          {/* Grid Editor */}
          {selectedPlan && selectedPattern && dutyTypes.length > 0 && (
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
                    {dutyTypes.map((dt) => (
                      <TableRow key={dt.id}>
                        <TableCell className="font-heading font-medium text-sm">{dt.name}</TableCell>
                        {dayOffsets.map((offset) => {
                          const slot = slotByKey.get(`${dt.id}-${offset}`);
                          const teamName = slot ? unitById.get(slot.team)?.name : null;
                          return (
                            <TableCell key={`${dt.id}-${offset}`} className="text-center p-2">
                              {slot ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium">{formatRosterName(teamName)}</div>
                                  <div className="text-[10px] text-muted-foreground font-mono">
                                    {slot.start_time || slot.end_time
                                      ? `${formatRosterTime(slot.start_time)} - ${formatRosterTime(slot.end_time)}`
                                      : 'All day'}
                                  </div>
                                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => openForm(slot)}>
                                    Edit
                                  </Button>
                                </div>
                              ) : (
                                <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => openGridCreate(offset, dt.id)}>
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
          )}

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

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{editingSlot ? 'Edit Pattern Slot' : 'Add Pattern Slot'}</DialogTitle>
            <DialogDescription>Slots define which team covers a duty type for each cycle day.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FieldRow>
              <InlineField label="Roster Plan">
                <Select value={formState.plan} onValueChange={(v) => setFormState((p) => ({ ...p, plan: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Pattern">
                <Select value={formState.pattern} onValueChange={(v) => setFormState((p) => ({ ...p, pattern: v }))}>
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
                <Input type="number" min="0" value={formState.day_offset} onChange={(e) => setFormState((p) => ({ ...p, day_offset: e.target.value }))} className="font-mono" />
              </InlineField>
              <InlineField label="Duty Type">
                <Select value={formState.duty_type} onValueChange={(v) => setFormState((p) => ({ ...p, duty_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {dutyTypes.map((dt) => <SelectItem key={dt.id} value={dt.id}>{dt.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Team">
                <Select value={formState.team} onValueChange={(v) => setFormState((p) => ({ ...p, team: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    {teamOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
            </div>
            <FieldRow>
              <InlineField label="Role Override">
                <Select value={formState.role_override} onValueChange={(v) => setFormState((p) => ({ ...p, role_override: v }))}>
                  <SelectTrigger><SelectValue placeholder="Default role" /></SelectTrigger>
                  <SelectContent className="z-[200]">
                    <SelectItem value={SELECT_DEFAULT}>Default</SelectItem>
                    {DUTY_ROLE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </InlineField>
              <InlineField label="Context Override">
                <Select value={formState.context_override} onValueChange={(v) => setFormState((p) => ({ ...p, context_override: v }))}>
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
                <Input type="time" value={formState.start_time} onChange={(e) => setFormState((p) => ({ ...p, start_time: e.target.value }))} className="font-mono" />
              </InlineField>
              <InlineField label="End Time">
                <Input type="time" value={formState.end_time} onChange={(e) => setFormState((p) => ({ ...p, end_time: e.target.value }))} className="font-mono" />
              </InlineField>
            </FieldRow>
            <InlineField label="Status">
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={formState.is_active} onCheckedChange={(v) => setFormState((p) => ({ ...p, is_active: Boolean(v) }))} />
                  <span className="text-sm">Active</span>
                </label>
              </div>
            </InlineField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createSlot.isPending || updateSlot.isPending}>
              {editingSlot ? 'Save Changes' : 'Create Slot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
