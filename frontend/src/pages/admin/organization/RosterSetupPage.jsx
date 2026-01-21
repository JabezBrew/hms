/**
 * RosterSetupPage - One-time configuration per department
 * Manages teams, duty types, and rotation rules
 * Chronicle Design System styling
 */
import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
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
} from '@/hooks/useOrganization';
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
  { value: 'exclusion', label: 'Sequential with Exclusion', description: 'Skip teams based on rules' },
];

/**
 * Department selector with tree navigation
 */
function DepartmentSelector({ value, onChange, departments, isLoading }) {
  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a department" />
      </SelectTrigger>
      <SelectContent className="z-[200]">
        {departments.map((dept) => (
          <SelectItem key={dept.id} value={dept.id}>
            {dept.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Teams panel - shows teams under the selected department
 */
function TeamsPanel({ departmentId, flatUnits }) {
  const teams = useMemo(() => {
    if (!departmentId) return [];
    return flatUnits.filter(
      (u) => u.unit_type_code === 'team' && u.parentId === departmentId
    );
  }, [departmentId, flatUnits]);

  if (!departmentId) {
    return (
      <EmptyState
        icon={Users}
        title="Select a department"
        description="Choose a department to view its teams."
      />
    );
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No teams found"
        description="Create teams under this department in the Organization page."
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
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const { data, isLoading } = useDepartmentDutyTypes(
    departmentId ? { department: departmentId } : null
  );
  const dutyTypes = toList(data);

  const createMutation = useCreateDepartmentDutyType();
  const updateMutation = useUpdateDepartmentDutyType();
  const deleteMutation = useDeleteDepartmentDutyType();

  const [formState, setFormState] = useState({
    name: '',
    code: '',
    applicable_days: [0, 1, 2, 3, 4],
    is_24_hour: false,
    start_time: '08:00',
    end_time: '17:00',
    display_order: 0,
    is_active: true,
  });

  const openForm = (item = null) => {
    if (item) {
      setEditingItem(item);
      setFormState({
        name: item.name || '',
        code: item.code || '',
        applicable_days: item.applicable_days || [0, 1, 2, 3, 4],
        is_24_hour: item.is_24_hour || false,
        start_time: item.start_time?.slice(0, 5) || '08:00',
        end_time: item.end_time?.slice(0, 5) || '17:00',
        display_order: item.display_order ?? 0,
        is_active: item.is_active ?? true,
      });
    } else {
      setEditingItem(null);
      setFormState({
        name: '',
        code: '',
        applicable_days: [0, 1, 2, 3, 4],
        is_24_hour: false,
        start_time: '08:00',
        end_time: '17:00',
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

    const payload = {
      name: formState.name.trim(),
      code: formState.code.trim().toUpperCase(),
      department: departmentId,
      applicable_days: formState.applicable_days,
      is_24_hour: formState.is_24_hour,
      start_time: formState.is_24_hour ? null : formState.start_time,
      end_time: formState.is_24_hour ? null : formState.end_time,
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

  const handleDelete = async (item) => {
    if (!confirm('Delete this duty type?')) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success('Duty type deleted.');
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
        title="Select a department"
        description="Choose a department to manage its duty types."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => openForm()} size="sm">
          <Plus className="h-4 w-4 mr-1" />
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
                  <div className="flex gap-1 flex-wrap">
                    {DAYS_OF_WEEK.filter((d) =>
                      (dt.applicable_days || []).includes(d.value)
                    ).map((d) => (
                      <Badge key={d.value} variant="outline" className="text-[9px] px-1.5">
                        {d.label}
                      </Badge>
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
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(dt)}>
                    <Trash2 className="h-4 w-4" />
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

          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Name
                </label>
                <Input
                  value={formState.name}
                  onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
                  placeholder="OBS Clinic"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Code
                </label>
                <Input
                  value={formState.code}
                  onChange={(e) => setFormState((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="OBS"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Applicable Days
                </label>
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
              <div className="flex flex-wrap gap-2">
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
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={formState.is_24_hour}
                  onCheckedChange={(v) => setFormState((p) => ({ ...p, is_24_hour: Boolean(v) }))}
                />
                <span className="text-sm">24-hour duty</span>
              </label>

              {!formState.is_24_hour && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Start Time
                    </label>
                    <Input
                      type="time"
                      value={formState.start_time}
                      onChange={(e) => setFormState((p) => ({ ...p, start_time: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      End Time
                    </label>
                    <Input
                      type="time"
                      value={formState.end_time}
                      onChange={(e) => setFormState((p) => ({ ...p, end_time: e.target.value }))}
                      className="font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Display Order
                </label>
                <Input
                  type="number"
                  min="0"
                  value={formState.display_order}
                  onChange={(e) => setFormState((p) => ({ ...p, display_order: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2 pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
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
    </div>
  );
}

/**
 * Rotation Rules panel
 */
function RotationRulesPanel({ departmentId, teams, dutyTypes }) {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

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

  const handleDelete = async (item) => {
    if (!confirm('Delete this rotation rule?')) return;
    try {
      await deleteMutation.mutateAsync(item.id);
      toast.success('Rotation rule deleted.');
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
        title="Select a department"
        description="Choose a department to manage its rotation rules."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => openForm()} size="sm" disabled={teams.length === 0 || dutyTypes.length === 0}>
          <Plus className="h-4 w-4 mr-1" />
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
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(rule)}>
                      <Trash2 className="h-4 w-4" />
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
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Rule Name
              </label>
              <Input
                value={formState.name}
                onChange={(e) => setFormState((p) => ({ ...p, name: e.target.value }))}
                placeholder="OBS Clinic Weekday Rotation"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Duty Type
              </label>
              <Select
                value={formState.duty_type}
                onValueChange={(v) => setFormState((p) => ({ ...p, duty_type: v }))}
              >
                <SelectTrigger>
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
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Rule Type
              </label>
              <Select
                value={formState.rule_type}
                onValueChange={(v) => setFormState((p) => ({ ...p, rule_type: v }))}
              >
                <SelectTrigger>
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

            {(formState.rule_type === 'sequential' || formState.rule_type === 'exclusion') && (
              <div className="space-y-2">
                <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Team Sequence (click to toggle)
                </label>
                <div className="flex flex-wrap gap-2">
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

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
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

  const departments = useMemo(
    () => flatUnits.filter((u) => u.unit_type_code === 'department'),
    [flatUnits]
  );

  const teams = useMemo(
    () =>
      selectedDepartment
        ? flatUnits.filter(
            (u) => u.unit_type_code === 'team' && u.parentId === selectedDepartment
          )
        : [],
    [selectedDepartment, flatUnits]
  );

  const { data: dutyTypeData } = useDepartmentDutyTypes(
    selectedDepartment ? { department: selectedDepartment } : null
  );
  const dutyTypes = toList(dutyTypeData);

  return (
    <>
      <Helmet>
        <title>Roster Setup | Organization</title>
      </Helmet>

      <div className="min-h-screen bg-background">
        <div className="container max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header className="mb-8">
            <div className="flex items-center gap-4 mb-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/organization/duty-roster">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to Roster
                </Link>
              </Button>
            </div>
            <div className="flex items-start justify-between">
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  Roster Setup
                </h1>
                <p className="mt-2 text-muted-foreground text-sm">
                  Configure teams, duty types, and rotation rules for each department.
                </p>
              </div>
            </div>
          </header>

          {/* Department Selector */}
          <Card className="mb-6 border-border">
            <CardHeader className="pb-3">
              <CardTitle className="font-heading text-lg flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                Select Department
              </CardTitle>
              <CardDescription>
                Choose a department to configure its roster settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DepartmentSelector
                value={selectedDepartment}
                onChange={setSelectedDepartment}
                departments={departments}
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
                  <div className="h-8 w-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                    <Users className="h-4 w-4 text-sky-500" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-heading font-medium">Teams</h3>
                    <p className="text-xs text-muted-foreground">
                      {teams.length} team{teams.length !== 1 ? 's' : ''} in this department
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <TeamsPanel departmentId={selectedDepartment} flatUnits={flatUnits} />
              </AccordionContent>
            </AccordionItem>

            {/* Duty Types Section */}
            <AccordionItem value="duty-types" className="border rounded-lg">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Clipboard className="h-4 w-4 text-amber-500" />
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
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <RotateCw className="h-4 w-4 text-emerald-500" />
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
      </div>
    </>
  );
}
