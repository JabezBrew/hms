/**
 * ClinicRosterWizardDialog
 *
 * Clinic-centric wizard that creates/links:
 * - Clinic
 * - DepartmentDutyType (category='clinic', linked to clinic) as the single session template
 * - Optional RotationRule (team clinics)
 * - RosterEntry rows (bulk) and publishes them
 *
 * This keeps the user in a single flow instead of bouncing between Clinic and Roster UIs.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import UserRound from 'lucide-react/dist/esm/icons/user-round.js';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import { cn } from '@/lib/utils';
import { keyWith } from '@/shared/lib/queryKeys';
import { clinicalUnitsApi } from '@/lib/api/organization';
import { flattenUnitTree, toList } from '../duty-roster/utils';
import {
  useClinicalUnitsTree,
  useCreateClinic,
  useUpdateClinic,
  useCreateDepartmentDutyType,
  useDepartmentDutyTypes,
  useCreateRotationRule,
  useRotationRules,
  useBulkRosterEntries,
  usePublishRoster,
} from '@/features/admin/hooks';

const DAYS = [
  { value: 0, label: 'Monday' },
  { value: 1, label: 'Tuesday' },
  { value: 2, label: 'Wednesday' },
  { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' },
  { value: 5, label: 'Saturday' },
  { value: 6, label: 'Sunday' },
];

const wizardKeys = {
  unitStaffSearch: (unitId, query) => keyWith('org', 'unit-staff-search', unitId, query || ''),
};

function toIsoDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function enumerateWeekdayDates(dateFrom, dateTo, weekday) {
  const start = new Date(`${dateFrom}T00:00:00`);
  const end = new Date(`${dateTo}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const results = [];
  // Backend convention: 0=Mon..6=Sun. JS: 0=Sun..6=Sat.
  const jsWeekday = (Number(weekday) + 1) % 7;
  // Find first matching weekday on/after start.
  let cursor = new Date(start);
  const delta = (jsWeekday - cursor.getDay() + 7) % 7;
  cursor = addDays(cursor, delta);
  while (cursor <= end) {
    results.push(toIsoDate(cursor));
    cursor = addDays(cursor, 7);
  }
  return results;
}

function buildParentMap(flatUnits) {
  const map = new Map();
  flatUnits.forEach((u) => map.set(String(u.id), u.parentId ? String(u.parentId) : null));
  return map;
}

function isDescendant(parentMap, nodeId, ancestorId) {
  const target = String(ancestorId);
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 2000) {
    if (cursor === target) return true;
    cursor = parentMap.get(cursor);
    guard += 1;
  }
  return false;
}

function StepPill({ active, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
        active ? 'border-amber-500/30 bg-amber-500/10 text-amber-700' : 'border-border text-muted-foreground'
      )}
    >
      {children}
    </span>
  );
}

export default function ClinicRosterWizardDialog({ open, onOpenChange, unitId, unitType, existingClinic = null }) {
  const fieldId = useId();
  const canHaveClinics = unitType === 'department' || unitType === 'division';
  const isEditClinic = Boolean(existingClinic?.id);

  const createClinic = useCreateClinic();
  const updateClinic = useUpdateClinic();
  const createDutyType = useCreateDepartmentDutyType();
  const createRotationRule = useCreateRotationRule();
  const bulkRoster = useBulkRosterEntries();
  const publishRoster = usePublishRoster();

  const dutyTypesQuery = useDepartmentDutyTypes(
    { department: unitId, is_active: true },
    { enabled: open && canHaveClinics && Boolean(unitId) }
  );
  const dutyTypes = useMemo(() => {
    const data = dutyTypesQuery.data;
    return Array.isArray(data) ? data : (data?.results || []);
  }, [dutyTypesQuery.data]);

  const { data: treeData, isLoading: treeLoading } = useClinicalUnitsTree({ enabled: open });
  const flatUnits = useMemo(() => flattenUnitTree(toList(treeData)), [treeData]);
  const parentMap = useMemo(() => buildParentMap(flatUnits), [flatUnits]);

  const teamOptions = useMemo(() => {
    if (!unitId) return [];
    return flatUnits
      .filter((u) => u.unit_type_code === 'team')
      .filter((u) => isDescendant(parentMap, u.id, unitId))
      .map((u) => ({ id: String(u.id), name: u.name, code: u.code }));
  }, [flatUnits, parentMap, unitId]);

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('team'); // 'team' | 'practitioner'

  const requiredBookingMode = mode === 'team' ? 'clinic_pool' : 'practitioner_direct';
  const requiredAssignmentTiming = requiredBookingMode === 'clinic_pool' ? 'check_in' : 'booking';
  const [existingClinicBookingMode, setExistingClinicBookingMode] = useState(null);
  const effectiveExistingBookingMode = isEditClinic
    ? String(existingClinicBookingMode || existingClinic?.booking_mode || requiredBookingMode)
    : requiredBookingMode;
  const supportedExistingClinic = !isEditClinic || effectiveExistingBookingMode === requiredBookingMode;

  const [clinic, setClinic] = useState({
    code: '',
    name: '',
    description: '',
    accepts_walk_ins: true,
    waitlist_enabled: true,
    assignment_timing: 'check_in',
    overbook_percent: 0,
    overbook_hard_cap: 0,
  });

  const [template, setTemplate] = useState({
    day_of_week: 4, // Friday default
    start_time: '10:00',
    end_time: '14:00',
    slot_duration_minutes: 30,
    max_patients_per_slot: 1,
    breaks: [],
  });

  const [teamSequence, setTeamSequence] = useState([]);
  const [teamToAdd, setTeamToAdd] = useState('');

  const [staffQuery, setStaffQuery] = useState('');
  const [practitionerSequence, setPractitionerSequence] = useState([]); // [{id,name,employeeId}]
  const [selectedPractitionerId, setSelectedPractitionerId] = useState('');

  const staffSearch = useQuery({
    queryKey: wizardKeys.unitStaffSearch(unitId, staffQuery),
    queryFn: async () => clinicalUnitsApi.staffPaginated(unitId, { q: staffQuery, include_descendants: true, page: 1, page_size: 20 }),
    enabled: open && canHaveClinics && Boolean(unitId) && mode === 'practitioner' && staffQuery.trim().length >= 2,
    staleTime: 30 * 1000,
  });

  const staffResults = useMemo(() => {
    const payload = staffSearch.data;
    const results = payload?.results || payload?.data?.results || payload?.data || [];
    return Array.isArray(results) ? results : [];
  }, [staffSearch.data]);

  const practitionerById = useMemo(() => {
    const map = new Map();
    staffResults.forEach((row) => {
      if (row?.practitioner) {
        map.set(String(row.practitioner), row);
      }
    });
    return map;
  }, [staffResults]);

  const today = useMemo(() => toIsoDate(new Date()), []);
  const defaultTo = useMemo(() => toIsoDate(addDays(new Date(), 56)), []);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [publishNow, setPublishNow] = useState(true);

  const existingClinicDutyTypes = useMemo(() => {
    if (!isEditClinic) return [];
    return dutyTypes.filter((dt) => dt?.category === 'clinic' && String(dt?.clinic) === String(existingClinic?.id));
  }, [dutyTypes, existingClinic, isEditClinic]);
  const [dutyTypeChoiceId, setDutyTypeChoiceId] = useState('');
  const selectedExistingDutyType = useMemo(() => {
    if (!isEditClinic) return null;
    if (existingClinicDutyTypes.length === 1) return existingClinicDutyTypes[0];
    if (existingClinicDutyTypes.length > 1 && dutyTypeChoiceId) {
      return existingClinicDutyTypes.find((dt) => String(dt.id) === String(dutyTypeChoiceId)) || null;
    }
    return null;
  }, [isEditClinic, existingClinicDutyTypes, dutyTypeChoiceId]);

  const rotationRulesQuery = useRotationRules(
    unitId,
    selectedExistingDutyType ? { duty_type: selectedExistingDutyType.id, is_active: true } : {},
    { enabled: open && canHaveClinics && Boolean(unitId) && Boolean(selectedExistingDutyType?.id) }
  );
  const existingRotationRules = useMemo(() => {
    const payload = rotationRulesQuery.data;
    return Array.isArray(payload) ? payload : (payload?.results || []);
  }, [rotationRulesQuery.data]);
  const existingRotationRule = existingRotationRules[0] || null;

  const previewDates = useMemo(
    () => enumerateWeekdayDates(dateFrom, dateTo, Number(template.day_of_week)),
    [dateFrom, dateTo, template.day_of_week]
  );

  const previewRows = useMemo(() => {
    if (previewDates.length === 0) return [];
    if (mode === 'team') {
      if (teamSequence.length === 0) return [];
      return previewDates.map((d, idx) => ({
        date: d,
        team: teamSequence[idx % teamSequence.length],
      }));
    }
    if (practitionerSequence.length === 0) return [];
    return previewDates.map((d, idx) => ({
      date: d,
      practitioner: practitionerSequence[idx % practitionerSequence.length],
    }));
  }, [previewDates, mode, teamSequence, practitionerSequence]);

  const isBusy = (
    createClinic.isPending
    || updateClinic.isPending
    || createDutyType.isPending
    || createRotationRule.isPending
    || bulkRoster.isPending
    || publishRoster.isPending
  );

  useEffect(() => {
    if (!open) return;
    setStep(0);
    const initialMode = (
      isEditClinic && String(existingClinic?.booking_mode || '') === 'practitioner_direct'
        ? 'practitioner'
        : 'team'
    );
    setMode(initialMode);
    setTeamSequence([]);
    setTeamToAdd('');
    setStaffQuery('');
    setPractitionerSequence([]);
    setSelectedPractitionerId('');
    setPublishNow(true);
    setDutyTypeChoiceId('');
    setDateFrom(today);
    setDateTo(defaultTo);
    setTemplate({
      day_of_week: 4,
      start_time: '10:00',
      end_time: '14:00',
      slot_duration_minutes: 30,
      max_patients_per_slot: 1,
      breaks: [],
    });
    if (isEditClinic) {
      setExistingClinicBookingMode(String(existingClinic?.booking_mode || ''));
      setClinic((prev) => ({
        ...prev,
        code: existingClinic.code || '',
        name: existingClinic.name || '',
        description: existingClinic.description || '',
        accepts_walk_ins: existingClinic.accepts_walk_ins ?? true,
        waitlist_enabled: existingClinic.waitlist_enabled ?? true,
        assignment_timing: existingClinic.assignment_timing || (initialMode === 'team' ? 'check_in' : 'booking'),
        overbook_percent: existingClinic.overbook_percent || 0,
        overbook_hard_cap: existingClinic.overbook_hard_cap || 0,
      }));
    } else {
      setExistingClinicBookingMode(null);
      setClinic({
        code: '',
        name: '',
        description: '',
        accepts_walk_ins: true,
        waitlist_enabled: true,
        assignment_timing: initialMode === 'team' ? 'check_in' : 'booking',
        overbook_percent: 0,
        overbook_hard_cap: 0,
      });
    }
  }, [open, isEditClinic, existingClinic, today, defaultTo]);

  // When rostering an existing clinic with an existing duty type, lock template to that duty type.
  useEffect(() => {
    if (!open) return;
    if (!isEditClinic) return;
    if (!selectedExistingDutyType && existingClinicDutyTypes.length > 1 && !dutyTypeChoiceId) {
      setDutyTypeChoiceId(String(existingClinicDutyTypes[0]?.id || ''));
      return;
    }
    if (!selectedExistingDutyType) return;

    const dow = Array.isArray(selectedExistingDutyType.applicable_days) && selectedExistingDutyType.applicable_days.length
      ? Number(selectedExistingDutyType.applicable_days[0])
      : 4;

    setTemplate({
      day_of_week: dow,
      start_time: String(selectedExistingDutyType.start_time || '10:00').slice(0, 5),
      end_time: String(selectedExistingDutyType.end_time || '14:00').slice(0, 5),
      slot_duration_minutes: Number(selectedExistingDutyType.slot_duration_minutes || 30),
      max_patients_per_slot: Number(selectedExistingDutyType.max_patients_per_slot || 1),
      breaks: Array.isArray(selectedExistingDutyType.breaks) ? selectedExistingDutyType.breaks : [],
    });

    if (existingRotationRule?.rule_type === 'sequential' && Array.isArray(existingRotationRule.team_sequence)) {
      setMode('team');
      setTeamSequence(existingRotationRule.team_sequence.map(String));
    }
  }, [
    open,
    isEditClinic,
    selectedExistingDutyType,
    existingRotationRule,
    existingClinicDutyTypes,
    dutyTypeChoiceId,
  ]);

  useEffect(() => {
    if (!open) return;
    if (isEditClinic) return;
    setClinic((p) => ({ ...p, assignment_timing: requiredAssignmentTiming }));
  }, [open, isEditClinic, requiredAssignmentTiming]);

  const canNext = useMemo(() => {
    if (!canHaveClinics || !unitId) return false;
    if (isEditClinic && step > 0 && !supportedExistingClinic) return false;
    if (step === 0) {
      if (!mode) return false;
      return true;
    }
    if (step === 1) {
      if (isEditClinic) return true;
      return Boolean(clinic.name.trim()) && Boolean(clinic.code.trim());
    }
    if (step === 2) {
      if (isEditClinic && existingClinicDutyTypes.length > 0 && !selectedExistingDutyType) return false;
      if (selectedExistingDutyType) return true;
      return Boolean(template.start_time) && Boolean(template.end_time) && Number(template.slot_duration_minutes) >= 5;
    }
    if (step === 3) {
      if (mode === 'team') return teamSequence.length >= 1;
      return practitionerSequence.length >= 1;
    }
    if (step === 4) {
      return previewRows.length >= 1;
    }
    return false;
  }, [
    canHaveClinics,
    unitId,
    step,
    mode,
    clinic,
    template,
    teamSequence,
    practitionerSequence,
    previewRows,
    isEditClinic,
    selectedExistingDutyType,
    existingClinicDutyTypes,
    supportedExistingClinic,
  ]);

  const handleAddTeam = () => {
    if (!teamToAdd) return;
    if (teamSequence.includes(teamToAdd)) return;
    setTeamSequence((prev) => [...prev, teamToAdd]);
    setTeamToAdd('');
  };

  const handleAddPractitioner = () => {
    if (!selectedPractitionerId) return;
    if (practitionerSequence.some((p) => p.id === selectedPractitionerId)) return;
    const row = practitionerById.get(String(selectedPractitionerId));
    const name = row?.practitioner_name || row?.employee_id || selectedPractitionerId;
    setPractitionerSequence((prev) => [...prev, { id: String(selectedPractitionerId), name }]);
    setSelectedPractitionerId('');
    setStaffQuery('');
  };

  const handleConvertExistingClinic = async () => {
    if (!isEditClinic || !existingClinic?.id) return;
    try {
      await updateClinic.mutateAsync({
        id: existingClinic.id,
        data: {
          booking_mode: requiredBookingMode,
          assignment_timing: requiredAssignmentTiming,
        },
      });
      setExistingClinicBookingMode(requiredBookingMode);
      toast.success(`Updated clinic booking mode to ${requiredBookingMode}.`);
    } catch (error) {
      const message = error.response?.data?.detail || error.message || 'Failed to update clinic booking mode.';
      toast.error(message);
    }
  };

  const handleCreate = async () => {
    if (!canNext) return;
    if (!unitId) return;

    try {
      // 1) Clinic (create or reuse)
      const clinicPayload = {
        department: unitId,
        code: clinic.code.trim().toUpperCase(),
        name: clinic.name.trim(),
        description: (clinic.description || '').trim(),
        booking_mode: requiredBookingMode,
        assignment_timing: requiredAssignmentTiming,
        accepts_walk_ins: Boolean(clinic.accepts_walk_ins),
        waitlist_enabled: Boolean(clinic.waitlist_enabled),
        overbook_percent: Number(clinic.overbook_percent) || 0,
        overbook_hard_cap: Number(clinic.overbook_hard_cap) || 0,
        is_active: true,
      };

      const createdClinic = isEditClinic
        ? existingClinic
        : await createClinic.mutateAsync(clinicPayload);

      // 2) Duty type template linked to clinic (one clinic = one template)
      let createdDutyType = selectedExistingDutyType;
      if (!createdDutyType) {
        const dutyTypeCode = `${clinicPayload.code}-SESSION`;
        const dutyTypeName = `${clinicPayload.name} Session`;
        const dutyTypePayload = {
          department: unitId,
          name: dutyTypeName,
          code: dutyTypeCode,
          category: 'clinic',
          clinic: createdClinic.id,
          rotation_type: mode === 'team' ? 'sequential' : 'none',
          applicable_days: [Number(template.day_of_week)],
          is_24_hour: false,
          start_time: template.start_time,
          end_time: template.end_time,
          slot_duration_minutes: Number(template.slot_duration_minutes),
          max_patients_per_slot: Number(template.max_patients_per_slot) || 1,
          breaks: template.breaks || [],
          is_active: true,
        };
        createdDutyType = await createDutyType.mutateAsync(dutyTypePayload);
      }

      // 3) Optional: store team rotation rule for later extension/auditing
      if (mode === 'team' && teamSequence.length && !existingRotationRule) {
        await createRotationRule.mutateAsync({
          departmentId: unitId,
          data: {
            duty_type: createdDutyType.id,
            name: `${clinicPayload.name} Rotation`,
            rule_type: 'sequential',
            team_sequence: teamSequence,
            day_assignments: {},
            applicable_days: [Number(template.day_of_week)],
            is_active: true,
          },
        });
      }

      // 4) Bulk create draft roster entries for the date range (clinic-only duty type)
      const entries = previewRows.map((row) => {
        if (mode === 'team') {
          return {
            date: row.date,
            duty_type: createdDutyType.id,
            team: row.team,
            source: 'generated',
            status: 'draft',
          };
        }
        return {
          date: row.date,
          duty_type: createdDutyType.id,
          practitioner: row.practitioner.id,
          source: 'generated',
          status: 'draft',
        };
      });

      await bulkRoster.mutateAsync({ departmentId: unitId, data: { entries } });

      // 5) Publish if requested
      if (publishNow) {
        await publishRoster.mutateAsync({
          departmentId: unitId,
          data: { date_from: dateFrom, date_to: dateTo },
        });
      }

      toast.success(isEditClinic ? 'Roster published for clinic.' : 'Clinic created and roster published.');
      onOpenChange(false);
    } catch (error) {
      const message =
        error?.response?.data?.detail
        || error?.response?.data?.error
        || error?.message
        || 'Failed to create clinic roster.';
      toast.error(message);
    }
  };

  if (!canHaveClinics) return null;

  const steps = [
    { id: 'mode', label: 'Mode' },
    { id: 'clinic', label: 'Clinic' },
    { id: 'template', label: 'Template' },
    { id: 'staffing', label: 'Staffing' },
    { id: 'preview', label: 'Preview' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {isEditClinic ? 'Roster Clinic' : 'Create Clinic + Roster'}
          </DialogTitle>
          <DialogDescription>
            Define a single clinic session template and generate a roster for a date range.
          </DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            {steps.map((s, idx) => (
              <StepPill key={s.id} active={idx === step}>
                {s.label}
              </StepPill>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-[360px] space-y-6 py-2">
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('team')}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors',
                  mode === 'team' ? 'border-amber-500/30 bg-amber-500/10' : 'border-border hover:bg-muted/30'
                )}
              >
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="font-heading font-medium">Team Clinic</span>
                  <Badge variant="outline" className="ml-auto text-[10px] font-mono">Pool</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Whole team is on duty for the clinic session. Rotate teams across dates.
                </p>
              </button>

	              <button
	                type="button"
	                onClick={() => setMode('practitioner')}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors',
                  mode === 'practitioner' ? 'border-amber-500/30 bg-amber-500/10' : 'border-border hover:bg-muted/30'
                )}
              >
	                <div className="flex items-center gap-2">
	                  <UserRound className="size-4 text-muted-foreground" />
	                  <span className="font-heading font-medium">Practitioner Clinic</span>
	                  <Badge variant="outline" className="ml-auto text-[10px] font-mono">Direct</Badge>
	                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Individual clinician(s) run the session. Rotate practitioners across dates.
                </p>
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {isEditClinic && (
                <div className="rounded-lg border border-border bg-card/50 p-3 text-sm">
                  Rostering existing clinic: <span className="font-heading font-medium">{existingClinic?.name}</span>{' '}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{existingClinic?.code}</span>
                </div>
              )}
              {isEditClinic && !supportedExistingClinic && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      This clinic is currently in booking mode{' '}
                      <span className="font-mono">{effectiveExistingBookingMode}</span>. This wizard step requires{' '}
                      <span className="font-mono">{requiredBookingMode}</span>.
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="font-mono text-xs"
                      onClick={handleConvertExistingClinic}
                      disabled={isBusy}
                    >
                      Convert
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor={`${fieldId}-clinic-name`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Clinic Name {!isEditClinic && '*'}
                  </label>
                  <Input
                    id={`${fieldId}-clinic-name`}
                    value={clinic.name}
                    onChange={(e) => setClinic((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Cardiology Clinic (Tue AM)"
                    disabled={isEditClinic}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${fieldId}-clinic-code`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Clinic Code {!isEditClinic && '*'}
                  </label>
                  <Input
                    id={`${fieldId}-clinic-code`}
                    value={clinic.code}
                    onChange={(e) => setClinic((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="CARDIO-TUE"
                    className="font-mono"
                    disabled={isEditClinic}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor={`${fieldId}-clinic-description`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  Description (Optional)
                </label>
                <Textarea
                  id={`${fieldId}-clinic-description`}
                  value={clinic.description}
                  onChange={(e) => setClinic((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Short operational description..."
                  rows={2}
                  disabled={isEditClinic}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label htmlFor={`${fieldId}-clinic-walk-ins`} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    id={`${fieldId}-clinic-walk-ins`}
                    checked={clinic.accepts_walk_ins}
                    onCheckedChange={(v) => setClinic((p) => ({ ...p, accepts_walk_ins: Boolean(v) }))}
                    disabled={isEditClinic}
                  />
                  <span className="text-sm">Accepts walk-ins</span>
                </label>
                <label htmlFor={`${fieldId}-clinic-waitlist`} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    id={`${fieldId}-clinic-waitlist`}
                    checked={clinic.waitlist_enabled}
                    onCheckedChange={(v) => setClinic((p) => ({ ...p, waitlist_enabled: Boolean(v) }))}
                    disabled={isEditClinic}
                  />
                  <span className="text-sm">Waitlist enabled</span>
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {selectedExistingDutyType ? (
                <div className="rounded-xl border border-border bg-card/50 p-4">
                  {existingClinicDutyTypes.length > 1 && (
                    <div className="mb-4 space-y-2">
                      <label htmlFor={`${fieldId}-template-choice`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        Select template
                      </label>
                      <Select value={dutyTypeChoiceId} onValueChange={setDutyTypeChoiceId}>
                        <SelectTrigger id={`${fieldId}-template-choice`} className="font-mono">
                          <SelectValue placeholder="Select duty type template" />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {existingClinicDutyTypes.map((dt) => (
                            <SelectItem key={dt.id} value={String(dt.id)} className="font-mono">
                              {dt.name} ({dt.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-heading font-medium">{selectedExistingDutyType.name}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {selectedExistingDutyType.code}
                      </p>
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px]">Existing template</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-border bg-background p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Day</p>
                      <p className="mt-1 text-sm">
                        {DAYS.find((d) => d.value === Number(template.day_of_week))?.label}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Time</p>
                      <p className="mt-1 text-sm">{template.start_time}-{template.end_time}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Slots</p>
                      <p className="mt-1 text-sm">
                        {template.slot_duration_minutes}m, cap {template.max_patients_per_slot}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    To edit this template, use the Duty Roster setup screens. This wizard will only generate roster entries.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2 sm:col-span-2">
                      <label htmlFor={`${fieldId}-template-day`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        Day of week
                      </label>
                      <Select
                        value={String(template.day_of_week)}
                        onValueChange={(v) => setTemplate((p) => ({ ...p, day_of_week: Number(v) }))}
                      >
                        <SelectTrigger id={`${fieldId}-template-day`} className="font-mono">
                          <SelectValue placeholder="Select day" />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {DAYS.map((d) => (
                            <SelectItem key={d.value} value={String(d.value)} className="font-mono">
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor={`${fieldId}-template-start`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        Start
                      </label>
                      <Input
                        id={`${fieldId}-template-start`}
                        type="time"
                        value={template.start_time}
                        onChange={(e) => setTemplate((p) => ({ ...p, start_time: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor={`${fieldId}-template-end`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        End
                      </label>
                      <Input
                        id={`${fieldId}-template-end`}
                        type="time"
                        value={template.end_time}
                        onChange={(e) => setTemplate((p) => ({ ...p, end_time: e.target.value }))}
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2 sm:col-span-2">
                      <label htmlFor={`${fieldId}-slot-duration`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        Slot duration (minutes)
                      </label>
                      <Input
                        id={`${fieldId}-slot-duration`}
                        type="number"
                        min="5"
                        max="480"
                        value={template.slot_duration_minutes}
                        onChange={(e) => setTemplate((p) => ({ ...p, slot_duration_minutes: Number(e.target.value) }))}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label htmlFor={`${fieldId}-max-patients`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        Max patients per slot
                      </label>
                      <Input
                        id={`${fieldId}-max-patients`}
                        type="number"
                        min="1"
                        max="20"
                        value={template.max_patients_per_slot}
                        onChange={(e) => setTemplate((p) => ({ ...p, max_patients_per_slot: Number(e.target.value) }))}
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card/50 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarClock className="size-4 text-muted-foreground" />
                      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Result</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {DAYS.find((d) => d.value === Number(template.day_of_week))?.label} {template.start_time}-{template.end_time}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {treeLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : mode === 'team' ? (
                <>
                  <div className="space-y-2">
                    <p id={`${fieldId}-team-rotation-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Team rotation (add in order)
                    </p>
                    <div className="flex gap-2">
                      <Select value={teamToAdd} onValueChange={setTeamToAdd}>
                        <SelectTrigger aria-labelledby={`${fieldId}-team-rotation-label`} className="font-mono">
                          <SelectValue placeholder={teamOptions.length ? 'Select team' : 'No teams found'} />
                        </SelectTrigger>
                        <SelectContent className="z-[200]">
                          {teamOptions.map((t) => (
                            <SelectItem key={t.id} value={t.id} className="font-mono">
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" onClick={handleAddTeam} disabled={!teamToAdd}>
                        Add
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Rotation is sequential: first date uses Team 1, next date uses Team 2, etc.
                    </p>
                  </div>

                  {teamSequence.length > 0 && (
                    <div className="space-y-2">
                      {teamSequence.map((id, idx) => {
                        const team = teamOptions.find((t) => t.id === id);
                        return (
                          <div key={id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                            <div className="flex items-center gap-2">
                              <Users className="size-4 text-muted-foreground" />
                              <span className="text-sm">{team?.name || id}</span>
                              <Badge variant="outline" className="text-[10px] font-mono">#{idx + 1}</Badge>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setTeamSequence((prev) => prev.filter((x) => x !== id))}
                            >
                              Remove
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <p id={`${fieldId}-practitioner-rotation-label`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      Practitioner rotation (search, then add in order)
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        aria-labelledby={`${fieldId}-practitioner-rotation-label`}
                        value={staffQuery}
                        onChange={(e) => setStaffQuery(e.target.value)}
                        placeholder="Search practitioner (min 2 chars)"
                        className="font-mono"
                      />
                      <div className="flex gap-2">
                        <Select value={selectedPractitionerId} onValueChange={setSelectedPractitionerId}>
                          <SelectTrigger aria-labelledby={`${fieldId}-practitioner-rotation-label`} className="font-mono">
                            <SelectValue
                              placeholder={
                                staffQuery.trim().length < 2
                                  ? 'Type to search'
                                  : staffSearch.isLoading
                                    ? 'Searching...'
                                    : 'Select practitioner'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="z-[200]">
                            {staffResults.map((row) => (
                              <SelectItem key={row.id} value={String(row.practitioner)} className="font-mono">
                                {row.practitioner_name || row.employee_id || row.practitioner}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="outline" onClick={handleAddPractitioner} disabled={!selectedPractitionerId}>
                          Add
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Rotation is sequential across the selected date range.
                    </p>
                  </div>

                  {practitionerSequence.length > 0 && (
                    <div className="space-y-2">
                      {practitionerSequence.map((p, idx) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                          <div className="flex items-center gap-2">
                            <UserRound className="size-4 text-muted-foreground" />
                            <span className="text-sm">{p.name}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">#{idx + 1}</Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPractitionerSequence((prev) => prev.filter((x) => x.id !== p.id))}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor={`${fieldId}-date-from`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Date from
                  </label>
                  <Input id={`${fieldId}-date-from`} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <label htmlFor={`${fieldId}-date-to`} className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Date to
                  </label>
                  <Input id={`${fieldId}-date-to`} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="font-mono" />
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                    Publish
                  </p>
                  <label htmlFor={`${fieldId}-publish-now`} className="flex h-10 items-center gap-2 rounded-md border border-border px-3 cursor-pointer">
                    <Checkbox id={`${fieldId}-publish-now`} checked={publishNow} onCheckedChange={(v) => setPublishNow(Boolean(v))} />
                    <span className="text-sm">Publish roster now</span>
                  </label>
                </div>
              </div>

              {previewRows.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  No preview available. Check your date range and staffing selections.
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="flex items-center justify-between bg-muted/30 px-4 py-2">
                    <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Preview ({previewRows.length} sessions)
                    </div>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {mode === 'team' ? 'Teams' : 'Practitioners'}
                    </Badge>
                  </div>
                  <div className="max-h-[240px] overflow-auto">
                    {previewRows.map((row) => (
                      <div key={row.date} className="flex items-center justify-between px-4 py-2 border-t border-border">
                        <span className="font-mono text-xs text-muted-foreground">{row.date}</span>
                        {mode === 'team' ? (
                          <span className="text-sm">
                            {teamOptions.find((t) => t.id === row.team)?.name || row.team}
                          </span>
                        ) : (
                          <span className="text-sm">{row.practitioner?.name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={isBusy || step === 0}
              className="font-mono text-xs"
            >
              Back
            </Button>
            {step < 4 ? (
              <Button
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={isBusy || !canNext}
                className="font-mono text-xs"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={isBusy || !canNext}
                className="font-mono text-xs"
              >
                {isBusy ? 'Working...' : publishNow ? 'Create + Publish' : 'Create Draft'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
