# Care Team Assignment System Design

**Status:** Draft
**Date:** 2026-01-18
**Owner:** Clinical Systems

---

## Table of Contents

1. [Overview](#overview)
2. [Clinical Workflow Context](#clinical-workflow-context)
3. [Data Model](#data-model)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Access Control Integration](#access-control-integration)
7. [API Specification](#api-specification)
8. [Migration Plan](#migration-plan)
9. [Testing Requirements](#testing-requirements)

---

## Overview

### Problem Statement

The current system lacks a unified mechanism to assign care teams to patients during registration and admission. Care team assignment is essential for:

1. **Access Control**: Only members of the assigned care team should have clinical access to the patient
2. **Clinical Workflow**: Knowing which team is responsible for a patient at any given time
3. **Handoff Management**: Tracking when care responsibility transfers between teams
4. **Audit Trail**: Recording the history of which teams managed a patient

**Safety Note:** Team assignment is a security boundary; assignment and reassignment must be validated and audited with least privilege.

### Goals

1. Assign `primary_team` to every encounter at creation time
2. Support both **automatic** assignment (via duty roster) and **manual** selection
3. Track the **original admitting team** separately from the **current managing team**
4. Support **department-configurable ward assignment policies** (flexible vs strict)
5. Integrate with existing access control (`_has_team_access()` in `apps/core/security.py`)

### Non-Goals

- Real-time team reassignment notifications (future enhancement)
- Cross-facility team assignments (handled by existing facility scoping)
- Consulting team workflow UI (already exists via `EncounterCareTeam`)

---

## Efficiency & Safety Review Recommendations

1. **Access Control at Assignment Time**: Enforce `_has_team_access()` checks when `primary_team_id` is explicitly provided, and validate the team is within the selected department and `can_admit_patients=True`. Reject cross-department or inactive teams.
2. **Avoid PHI in Logs**: Replace the `logger.info` reassignment message with an audit-event write. Do not log team names, patient identifiers, or free-text reason fields.
3. **Atomic Reassignment**: Make bed assignment + `primary_team` reassignment atomic (transaction) to avoid a window where access is ambiguous.
4. **Roster Query Performance**: Add a composite index for `DutyRoster` on `(unit, date, role, context, is_active, is_primary, start_time, end_time)` and ensure midnight-crossing checks use indexed fields.
5. **Roster Endpoint Payload**: Keep `/duty-roster/on-duty/` response minimal (team id/code/name only). Return practitioner data only when explicitly requested and scoped by permission.
6. **Cache On-Duty Lookup**: Cache on-duty team lookups with a short TTL (30-60s) and invalidate on roster updates to reduce repeated queries during busy registration periods.
7. **Strict Policy Handoff**: When `primary_team` changes, ensure access revocation is immediate, and explicitly document that `admitted_by_team` never grants access.

---

## Clinical Workflow Context

### Admission Streams

| Stream | Source | Team Assignment Method |
|--------|--------|------------------------|
| **Clinic** | Outpatient clinic | Clinic's department team (already covered) |
| **Dedicated ED** | Central emergency dept | ED triages → routes to receiving dept's **on-duty team** (via roster) |
| **In-house ED** | Department's own emergency | Department's **on-duty team** (via roster) |
| **Referral** | External referral | Goes through clinic or ED first |

### Key Concepts

1. **Team = ClinicalUnit**: A team is represented by a `ClinicalUnit` (e.g., "Surgical Team A", "Medical Team B")

2. **Duty Roster**: The `DutyRoster` model (already exists in `apps/organization/models.py`) maps:
   - Department + Date + Time → On-duty ClinicalUnit + Practitioner
   - Supports role-based queries (admitting, covering, consulting)
   - Supports context-based queries (inpatient, outpatient, emergency)

3. **Ward Assignment Policy**: Departments can be configured as:
   - **Flexible**: Patient stays with admitting team regardless of bed location
   - **Strict**: Patient transfers to ward's owning team when bed is assigned

4. **Handoff Behavior**: When `primary_team` changes under strict policy:
   - Original team loses access immediately (clean handoff)
   - `admitted_by_team` preserves the audit trail

---

## Data Model

### Model Changes Summary

| Model | Change | Purpose |
|-------|--------|---------|
| `Encounter` | Add `admitted_by_team` FK | Track original admitting team (audit) |
| `ClinicalUnit` | Add `ward_assignment_policy` | Configure flexible vs strict |
| `DutyRoster` | Already exists | Lookup on-duty team |

### 1. Encounter Model Addition

**File:** `backend/apps/encounters/models.py`

```python
class Encounter(models.Model):
    # ... existing fields ...

    # EXISTING (already implemented)
    primary_team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='primary_encounters',
        help_text='Primary clinical team responsible for this encounter'
    )

    # NEW: Track original admitting team
    admitted_by_team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='admitted_encounters',
        help_text='Team that originally admitted the patient (never changes after initial assignment)'
    )
```

**Indexes to add:**
```python
models.Index(fields=['admitted_by_team', 'status']),
```

### 2. ClinicalUnit Model Addition

**File:** `backend/apps/organization/models.py`

Add to `ClinicalUnit` model (for department-level units):

```python
class ClinicalUnit(MPTTModel):
    # ... existing fields ...

    # Ward assignment policy (only meaningful for department-level units)
    WARD_ASSIGNMENT_POLICY_CHOICES = [
        ('flexible', 'Flexible - Patient stays with admitting team'),
        ('strict', 'Strict - Patient transfers to ward\'s team'),
    ]
    ward_assignment_policy = models.CharField(
        max_length=20,
        choices=WARD_ASSIGNMENT_POLICY_CHOICES,
        default='flexible',
        help_text='How to handle team assignment when patient is placed in a ward belonging to a different team'
    )
```

### 3. Existing Models (No Changes)

The following models already exist and require no structural changes:

**`DutyRoster`** (`apps/organization/models.py:1109`)
- Fields: `unit`, `practitioner`, `date`, `start_time`, `end_time`, `role`, `context`, `is_primary`
- Query: "Who is on admitting duty for unit X at datetime Y?"

**`EncounterCareTeam`** (`apps/encounters/models.py:444`)
- Tracks consulting/co-managing teams
- Already integrated with access control

---

## Backend Implementation

### 1. Duty Roster Service

**File:** `backend/apps/organization/services.py`

Create a service to query on-duty teams:

```python
class DutyRosterService:
    """Service for querying on-duty teams and practitioners."""

    @classmethod
    def get_on_duty_team(
        cls,
        department: ClinicalUnit,
        at_datetime: datetime = None,
        role: str = 'admitting',
        context: str = 'inpatient'
    ) -> Optional[ClinicalUnit]:
        """
        Get the on-duty team for a department at a given time.

        Args:
            department: The department (ClinicalUnit) to query
            at_datetime: The datetime to check (defaults to now)
            role: The duty role ('admitting', 'covering', 'on_call')
            context: The context ('inpatient', 'outpatient', 'emergency')

        Returns:
            The on-duty ClinicalUnit, or None if no roster entry exists
        """
        if at_datetime is None:
            at_datetime = timezone.now()

        date = at_datetime.date()
        time = at_datetime.time()

        # Query the duty roster
        # Handle shifts that cross midnight
        roster_entry = DutyRoster.objects.filter(
            unit=department,
            date=date,
            role=role,
            context__in=[context, 'all'],
            is_active=True,
            is_primary=True
        ).filter(
            # Normal shift (doesn't cross midnight)
            Q(start_time__lte=time, end_time__gt=time, start_time__lt=F('end_time')) |
            # Shift crosses midnight - check if we're in the first part (before midnight)
            Q(start_time__lte=time, start_time__gt=F('end_time')) |
            # Shift crosses midnight - check if we're in the second part (after midnight)
            Q(end_time__gt=time, start_time__gt=F('end_time'))
        ).select_related('unit', 'practitioner').first()

        if roster_entry:
            return roster_entry.unit

        # Fallback: check if yesterday's night shift extends into today
        yesterday = date - timedelta(days=1)
        night_entry = DutyRoster.objects.filter(
            unit=department,
            date=yesterday,
            role=role,
            context__in=[context, 'all'],
            is_active=True,
            is_primary=True,
            start_time__gt=F('end_time')  # Crosses midnight
        ).filter(
            end_time__gt=time  # Still active today
        ).select_related('unit', 'practitioner').first()

        return night_entry.unit if night_entry else None

    @classmethod
    def get_on_duty_practitioner(
        cls,
        department: ClinicalUnit,
        at_datetime: datetime = None,
        role: str = 'admitting',
        context: str = 'inpatient',
        seniority_level: str = None
    ) -> Optional[PractitionerProfile]:
        """
        Get the on-duty practitioner for a department.

        Args:
            department: The department to query
            at_datetime: The datetime to check
            role: The duty role
            context: The context
            seniority_level: Optional filter for seniority ('attending', 'resident', etc.)

        Returns:
            The on-duty PractitionerProfile, or None
        """
        if at_datetime is None:
            at_datetime = timezone.now()

        date = at_datetime.date()
        time = at_datetime.time()

        queryset = DutyRoster.objects.filter(
            unit=department,
            date=date,
            role=role,
            context__in=[context, 'all'],
            is_active=True
        )

        if seniority_level:
            queryset = queryset.filter(seniority_level=seniority_level)

        # Handle time-based filtering (same logic as above)
        queryset = queryset.filter(
            Q(start_time__lte=time, end_time__gt=time, start_time__lt=F('end_time')) |
            Q(start_time__lte=time, start_time__gt=F('end_time')) |
            Q(end_time__gt=time, start_time__gt=F('end_time'))
        ).select_related('practitioner').order_by('seniority_level')

        entry = queryset.first()
        return entry.practitioner if entry else None
```

### 2. Team Assignment Service

**File:** `backend/apps/organization/services.py`

Extend the existing `TeamAssignmentService`.

**Safety & Performance Notes:**
- Require a single entry point for initial assignment to prevent bypassing access control rules.
- `assign_initial_team` should be idempotent and reject reassignment attempts after first set.
- Ensure all queries use `select_related` for related units and avoid extra practitioner lookups when not needed.

```python
class TeamAssignmentService:
    """Service for managing care team assignments."""

    @classmethod
    def assign_initial_team(
        cls,
        encounter: Encounter,
        team: ClinicalUnit = None,
        use_duty_roster: bool = True,
        context: str = None
    ) -> ClinicalUnit:
        """
        Assign the initial care team to an encounter.

        This sets both `primary_team` and `admitted_by_team` on the encounter.
        Should only be called once during encounter creation.

        Args:
            encounter: The encounter to assign
            team: Explicit team to assign (overrides duty roster)
            use_duty_roster: Whether to use duty roster for auto-assignment
            context: The duty context ('inpatient', 'outpatient', 'emergency')

        Returns:
            The assigned ClinicalUnit

        Raises:
            ValueError: If no team can be determined
        """
        if encounter.admitted_by_team:
            raise ValueError("Encounter already has an admitted_by_team assigned")

        # Determine the team
        if team:
            assigned_team = team
        elif use_duty_roster and encounter.department:
            # Derive context from encounter type if not provided
            if context is None:
                context = {
                    'inpatient': 'inpatient',
                    'outpatient': 'outpatient',
                    'emergency': 'emergency',
                }.get(encounter.encounter_type, 'inpatient')

            assigned_team = DutyRosterService.get_on_duty_team(
                department=encounter.department,
                at_datetime=encounter.start_time,
                role='admitting',
                context=context
            )

            if not assigned_team:
                # Fallback to department itself if no roster entry
                assigned_team = encounter.department
        else:
            # Fallback to department
            assigned_team = encounter.department

        if not assigned_team:
            raise ValueError("Cannot determine care team for encounter")

        # Set both fields
        encounter.primary_team = assigned_team
        encounter.admitted_by_team = assigned_team
        encounter.save(update_fields=['primary_team', 'admitted_by_team', 'updated_at'])

        return assigned_team

    @classmethod
    def reassign_team_on_bed_assignment(
        cls,
        encounter: Encounter,
        bed: 'Bed'
    ) -> Optional[ClinicalUnit]:
        """
        Potentially reassign the primary team when a bed is assigned.

        Checks the department's ward_assignment_policy:
        - 'flexible': No change (patient stays with original team)
        - 'strict': Reassign to ward's owning team if different

        Args:
            encounter: The encounter being updated
            bed: The bed being assigned

        Returns:
            The new primary_team if reassigned, None if no change
        """
        if not encounter.department:
            return None

        # Get the department's policy
        department = encounter.department
        policy = department.ward_assignment_policy

        if policy == 'flexible':
            return None  # No change

        # Strict policy: check if ward's team differs
        ward = bed.ward
        ward_owning_team = cls._get_ward_owning_team(ward)

        if ward_owning_team and ward_owning_team != encounter.primary_team:
            # Reassign
            encounter.primary_team = ward_owning_team
            encounter.save(update_fields=['primary_team', 'updated_at'])
            return ward_owning_team

        return None

    @classmethod
    def _get_ward_owning_team(cls, ward: 'Ward') -> Optional[ClinicalUnit]:
        """
        Get the clinical unit that owns a ward.

        Checks UnitWardAllocation for dedicated allocations.
        """
        from apps.organization.models import UnitWardAllocation

        allocation = UnitWardAllocation.objects.filter(
            ward=ward,
            allocation_type='dedicated',
            is_active=True
        ).select_related('unit').first()

        return allocation.unit if allocation else None
```

### 3. Registration Flow Updates

**File:** `backend/apps/patients/serializers.py`

Update `_handle_encounter_creation()` to use the team assignment service.

**Safety & Efficiency Notes:**
- Validate `primary_team_id` with department scoping and `can_admit_patients=True` before assignment.
- Use duty roster lookup service rather than re-implementing query logic in serializer.
- Avoid logging patient identifiers or free-text admission notes in this flow.

```python
def _handle_encounter_creation(self, patient_profile, admission_details, facility, department, clinic, user):
    """Create encounter with appropriate team assignment."""
    from apps.organization.services import TeamAssignmentService, DutyRosterService

    encounter_type = admission_details.get('encounter_type', 'outpatient')

    # Determine the primary team
    primary_team = None
    explicit_team_id = admission_details.get('primary_team_id')

    if explicit_team_id:
        # Explicit team specified
        primary_team = ClinicalUnit.objects.filter(id=explicit_team_id, is_active=True).first()
    elif encounter_type in ['inpatient', 'emergency']:
        # Use duty roster for inpatient/emergency
        context = 'emergency' if encounter_type == 'emergency' else 'inpatient'
        primary_team = DutyRosterService.get_on_duty_team(
            department=department,
            role='admitting',
            context=context
        )

    # Fallback to department if no team determined
    if not primary_team:
        primary_team = department

    # Create the encounter
    encounter = Encounter.objects.create(
        patient=patient_profile,
        facility=facility,
        department=department,
        primary_team=primary_team,
        admitted_by_team=primary_team,  # Same at creation time
        clinic=clinic,
        encounter_type=encounter_type,
        status='in-progress',
        reason=admission_details.get('notes', ''),
        created_by=user,
    )

    return encounter
```

### 4. Bed Assignment Hook

**File:** `backend/apps/wards/services.py` (or appropriate location)

Add a hook to check team reassignment when a bed is assigned.

**Safety & Efficiency Notes:**
- Wrap bed updates and any `primary_team` reassignment in a transaction.
- Replace log lines with structured audit events that avoid PHI.
- Ensure idempotency if bed reassignments are retried.

```python
def assign_bed_to_admission(admission: Admission, bed: Bed, user: User) -> None:
    """
    Assign a bed to an admission, handling team reassignment if needed.
    """
    from apps.organization.services import TeamAssignmentService

    # Assign the bed
    old_bed = admission.bed
    admission.bed = bed
    admission.save(update_fields=['bed', 'updated_at'])

    # Update bed statuses
    if old_bed:
        old_bed.status = 'available'
        old_bed.save(update_fields=['status'])
    bed.status = 'occupied'
    bed.save(update_fields=['status'])

    # Check for team reassignment (only for linked encounters)
    if hasattr(admission, 'encounter') and admission.encounter:
        new_team = TeamAssignmentService.reassign_team_on_bed_assignment(
            encounter=admission.encounter,
            bed=bed
        )
        if new_team:
            # Log the reassignment for audit
            logger.info(
                f"Team reassigned for encounter {admission.encounter.id}: "
                f"{admission.encounter.admitted_by_team} -> {new_team}"
            )
```

---

## Frontend Implementation

### 1. Registration Form Updates

**File:** `frontend/src/components/registration/PatientRegistrationForm.jsx`

Add team selection for inpatient/emergency registrations:

```jsx
// Component: TeamSelectionField
// Location: frontend/src/components/registration/TeamSelectionField.jsx

import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { organizationApi } from '@/lib/api/organization';

/**
 * Team selection field for registration forms.
 *
 * Behavior:
 * - Shows the on-duty team by default (from duty roster)
 * - Allows manual override if user has permission
 * - Displays duty status badge (on-duty, off-duty)
 *
 * Props:
 * - departmentId: UUID of the department
 * - encounterType: 'inpatient' | 'emergency' | 'outpatient'
 * - value: Selected team UUID
 * - onChange: Callback when selection changes
 * - disabled: Whether the field is disabled
 */
export function TeamSelectionField({
  departmentId,
  encounterType,
  value,
  onChange,
  disabled = false
}) {
  // Fetch on-duty team
  const { data: onDutyTeam, isLoading: loadingDuty } = useQuery({
    queryKey: ['duty-roster', 'on-duty', departmentId, encounterType],
    queryFn: () => organizationApi.getOnDutyTeam({
      departmentId,
      context: encounterType === 'emergency' ? 'emergency' : 'inpatient'
    }),
    enabled: !!departmentId && encounterType !== 'outpatient',
    staleTime: 60000, // 1 minute
  });

  // Fetch available teams in department
  const { data: teams, isLoading: loadingTeams } = useQuery({
    queryKey: ['clinical-units', 'teams', departmentId],
    queryFn: () => organizationApi.getTeamsInDepartment(departmentId),
    enabled: !!departmentId,
  });

  // Auto-select on-duty team when available
  useEffect(() => {
    if (onDutyTeam && !value) {
      onChange(onDutyTeam.id);
    }
  }, [onDutyTeam, value, onChange]);

  if (encounterType === 'outpatient') {
    return null; // Outpatient uses clinic's department
  }

  const isLoading = loadingDuty || loadingTeams;

  return (
    <div className="space-y-2">
      <Label htmlFor="primary-team">
        Admitting Team
        {onDutyTeam && (
          <Badge variant="outline" className="ml-2 text-emerald-600">
            On Duty: {onDutyTeam.name}
          </Badge>
        )}
      </Label>

      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled || isLoading}
      >
        <SelectTrigger id="primary-team">
          <SelectValue placeholder={isLoading ? "Loading..." : "Select team"} />
        </SelectTrigger>
        <SelectContent>
          {teams?.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              <div className="flex items-center gap-2">
                {team.name}
                {team.id === onDutyTeam?.id && (
                  <Badge variant="secondary" className="text-xs">On Duty</Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p className="text-xs text-muted-foreground">
        {onDutyTeam
          ? "Showing on-duty team from duty roster. Select a different team if needed."
          : "No duty roster entry found. Please select a team manually."}
      </p>
    </div>
  );
}
```

### 2. API Client Updates

**File:** `frontend/src/lib/api/organization.js`

Add API methods for team queries:

```javascript
// Add to organizationApi object

/**
 * Get the on-duty team for a department.
 *
 * @param {Object} params
 * @param {string} params.departmentId - Department UUID
 * @param {string} params.context - 'inpatient' | 'emergency' | 'outpatient'
 * @param {string} [params.atDatetime] - ISO datetime string (defaults to now)
 * @returns {Promise<{id: string, name: string, practitioner?: {...}}>}
 */
async getOnDutyTeam({ departmentId, context, atDatetime }) {
  const params = new URLSearchParams({
    department: departmentId,
    context,
  });
  if (atDatetime) {
    params.append('at_datetime', atDatetime);
  }
  const response = await apiClient.get(`/api/organization/duty-roster/on-duty/?${params}`);
  return response.data;
},

/**
 * Get teams within a department.
 *
 * @param {string} departmentId - Department UUID
 * @returns {Promise<Array<{id: string, name: string, code: string}>>}
 */
async getTeamsInDepartment(departmentId) {
  const response = await apiClient.get(`/api/organization/clinical-units/`, {
    params: {
      parent: departmentId,
      unit_type__can_admit_patients: true,
      is_active: true,
      limit: 50,
    }
  });
  return response.data.results;
},
```

### 3. Registration Form Integration

**File:** `frontend/src/components/registration/AdmissionDetailsStep.jsx`

Integrate team selection into admission workflow:

```jsx
import { TeamSelectionField } from './TeamSelectionField';

export function AdmissionDetailsStep({
  form,
  departmentId,
  encounterType,
}) {
  const { control, watch, setValue } = form;

  return (
    <div className="space-y-6">
      {/* Existing fields: ward, bed, admission type, etc. */}

      {/* Team Selection */}
      <Controller
        name="primary_team_id"
        control={control}
        render={({ field }) => (
          <TeamSelectionField
            departmentId={departmentId}
            encounterType={encounterType}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />

      {/* Rest of form fields */}
    </div>
  );
}
```

### 4. Patient Chronicle Display

**File:** `frontend/src/components/chronicle/PatientCareTeamCard.jsx`

Display current and historical care team assignments:

```jsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, ArrowRight } from 'lucide-react';

/**
 * Displays care team information for a patient encounter.
 *
 * Shows:
 * - Current primary team
 * - Original admitting team (if different)
 * - Consulting teams
 */
export function PatientCareTeamCard({ encounter }) {
  const { primary_team, admitted_by_team, care_team_assignments } = encounter;

  const wasTransferred = admitted_by_team &&
    primary_team?.id !== admitted_by_team?.id;

  const activeConsults = care_team_assignments?.filter(
    a => a.is_active && a.status === 'active'
  ) || [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Care Team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Primary Team */}
        <div>
          <p className="text-sm text-muted-foreground">Primary Team</p>
          <p className="font-medium">{primary_team?.name || 'Not assigned'}</p>
        </div>

        {/* Transfer History */}
        {wasTransferred && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Originally: {admitted_by_team.name}</span>
            <ArrowRight className="h-3 w-3" />
            <span>Transferred to current</span>
          </div>
        )}

        {/* Consulting Teams */}
        {activeConsults.length > 0 && (
          <div>
            <p className="text-sm text-muted-foreground mb-1">Consulting</p>
            <div className="flex flex-wrap gap-1">
              {activeConsults.map((consult) => (
                <Badge key={consult.id} variant="outline">
                  {consult.team_name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### 5. Ward Assignment Policy Admin

**File:** `frontend/src/pages/admin/DepartmentSettings.jsx`

Admin UI for configuring ward assignment policy:

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { organizationApi } from '@/lib/api/organization';

export function DepartmentWardPolicySettings({ departmentId }) {
  const queryClient = useQueryClient();

  const { data: department, isLoading } = useQuery({
    queryKey: ['clinical-unit', departmentId],
    queryFn: () => organizationApi.getClinicalUnit(departmentId),
  });

  const mutation = useMutation({
    mutationFn: (policy) => organizationApi.updateClinicalUnit(departmentId, {
      ward_assignment_policy: policy
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['clinical-unit', departmentId]);
      toast.success('Ward assignment policy updated');
    },
    onError: () => {
      toast.error('Failed to update policy');
    },
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ward Assignment Policy</CardTitle>
        <CardDescription>
          Controls how care team responsibility is assigned when patients are placed in wards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ward-policy">Policy</Label>
          <Select
            value={department.ward_assignment_policy}
            onValueChange={(value) => mutation.mutate(value)}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="ward-policy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flexible">
                <div>
                  <p className="font-medium">Flexible</p>
                  <p className="text-xs text-muted-foreground">
                    Patient stays with admitting team regardless of bed location
                  </p>
                </div>
              </SelectItem>
              <SelectItem value="strict">
                <div>
                  <p className="font-medium">Strict</p>
                  <p className="text-xs text-muted-foreground">
                    Patient transfers to ward's owning team when bed is assigned
                  </p>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="text-sm text-muted-foreground border-l-2 pl-3">
          <strong>Flexible:</strong> Any team can admit patients to any ward.
          The admitting team retains responsibility throughout the stay.
          <br /><br />
          <strong>Strict:</strong> When a patient is placed in a ward,
          responsibility transfers to the team that owns that ward.
          The original admitting team is recorded for audit purposes.
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Access Control Integration

### Current Implementation

The access control in `apps/core/security.py` already checks `primary_team`:

```python
# From _has_team_access() - already implemented
ACTIVE_ENCOUNTER_STATUSES = ['planned', 'in-progress']

# Primary team access
if Encounter.objects.filter(
    patient=patient,
    status__in=ACTIVE_ENCOUNTER_STATUSES,
    primary_team_id__in=user_unit_ids
).exists():
    return True

# Consulting team access
if Encounter.objects.filter(
    patient=patient,
    status__in=ACTIVE_ENCOUNTER_STATUSES,
    care_team_assignments__team_id__in=user_unit_ids,
    care_team_assignments__is_active=True
).exists():
    return True
```

### Access Control Summary

| Field | Grants Access? | Purpose |
|-------|----------------|---------|
| `primary_team` | **Yes** | Current managing team has access |
| `admitted_by_team` | **No** | Audit trail only |
| `EncounterCareTeam` | **Yes** | Consulting teams have access |
| `practitioner` | **Yes** | Individual practitioner has access |

### Behavior on Team Reassignment

When `primary_team` changes (under strict ward policy):
1. Old team members **immediately lose access**
2. New team members **immediately gain access**
3. `admitted_by_team` is preserved for audit
4. No automatic consulting team assignment (clean handoff per user requirement)

**Safety Note:** Any reassignment must trigger an access-control cache invalidation if cached permissions are used.

---

## API Specification

### 1. Get On-Duty Team

**Endpoint:** `GET /api/organization/duty-roster/on-duty/`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `department` | UUID | Yes | Department to query |
| `context` | string | Yes | `inpatient`, `outpatient`, `emergency` |
| `at_datetime` | ISO datetime | No | Defaults to current time |
| `role` | string | No | Defaults to `admitting` |
| `include_practitioner` | boolean | No | Defaults to false; requires permission |

**Response (default, minimal):**
```json
{
  "team": {
    "id": "uuid",
    "name": "Surgical Team A",
    "code": "SURG-A"
  },
  "practitioner": null,
  "roster_entry": {
    "id": "uuid",
    "date": "2026-01-18",
    "start_time": "08:00:00",
    "end_time": "17:00:00"
  }
}
```

**Response (with practitioner):**
```json
{
  "team": {
    "id": "uuid",
    "name": "Surgical Team A",
    "code": "SURG-A"
  },
  "practitioner": {
    "id": "uuid",
    "name": "Dr. Smith",
    "seniority_level": "attending"
  },
  "roster_entry": {
    "id": "uuid",
    "date": "2026-01-18",
    "start_time": "08:00:00",
    "end_time": "17:00:00"
  }
}
```

**Response (no roster entry):**
```json
{
  "team": null,
  "practitioner": null,
  "roster_entry": null,
  "message": "No duty roster entry found for this time"
}
```

### 2. Get Teams in Department

**Endpoint:** `GET /api/organization/clinical-units/`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `parent` | UUID | Department UUID |
| `unit_type__can_admit_patients` | boolean | Filter for teams that can admit |
| `is_active` | boolean | Filter for active teams |

**Response:**
```json
{
  "count": 3,
  "results": [
    {"id": "uuid1", "name": "Medical Team A", "code": "MED-A"},
    {"id": "uuid2", "name": "Medical Team B", "code": "MED-B"},
    {"id": "uuid3", "name": "Medical Team C", "code": "MED-C"}
  ]
}
```

**Safety Note:** This endpoint must enforce department scoping at the queryset level and must not return teams from other departments.

### 3. Patient Registration (Updated)

**Endpoint:** `POST /api/patients/register/`

**Request Body (admission_details section):**
```json
{
  "admission_details": {
    "encounter_type": "inpatient",
    "department_id": "uuid",
    "primary_team_id": "uuid",  // NEW: Optional, overrides duty roster
    "ward_id": "uuid",
    "bed_id": "uuid",
    "admission_type": "emergency",
    "notes": "Acute appendicitis"
  }
}
```

**Behavior:**
- If `primary_team_id` is provided, use it
- Otherwise, lookup duty roster for on-duty team
- Fallback to department if no roster entry

### 4. Update Clinical Unit (Admin)

**Endpoint:** `PATCH /api/organization/clinical-units/{id}/`

**Request Body:**
```json
{
  "ward_assignment_policy": "strict"
}
```

**Response:**
```json
{
  "id": "uuid",
  "name": "Surgery Department",
  "ward_assignment_policy": "strict"
}
```

---

## Migration Plan

### Phase 1: Schema Migration

1. Add `admitted_by_team` to Encounter model
2. Add `ward_assignment_policy` to ClinicalUnit model
3. Create and run migrations

```bash
cd backend
python manage.py makemigrations encounters --name add_admitted_by_team
python manage.py makemigrations organization --name add_ward_assignment_policy
python manage.py migrate
```

### Phase 2: Data Backfill

For existing encounters with `primary_team` but no `admitted_by_team`:

```python
# Data migration
def backfill_admitted_by_team(apps, schema_editor):
    Encounter = apps.get_model('encounters', 'Encounter')

    # Set admitted_by_team = primary_team for all existing encounters
    Encounter.objects.filter(
        primary_team__isnull=False,
        admitted_by_team__isnull=True
    ).update(admitted_by_team=F('primary_team'))
```

### Phase 3: Service Layer

1. Implement `DutyRosterService.get_on_duty_team()`
2. Extend `TeamAssignmentService` with new methods
3. Update registration flow to use services

### Phase 4: API Endpoints

1. Add `GET /api/organization/duty-roster/on-duty/` endpoint
2. Update registration serializer to accept `primary_team_id`
3. Add `ward_assignment_policy` to ClinicalUnit serializer
4. Document permission requirements for roster and team list endpoints

### Phase 5: Frontend

1. Implement `TeamSelectionField` component
2. Integrate into registration forms
3. Add policy configuration UI for admins
4. Update patient chronicle to show care team info

---

## Testing Requirements

### Backend Tests

**File:** `backend/apps/organization/tests/test_duty_roster_service.py`

```python
@pytest.mark.tier1
class TestDutyRosterService:
    def test_get_on_duty_team_returns_primary_roster_entry(self):
        """Primary on-duty entry should be returned."""

    def test_get_on_duty_team_handles_midnight_crossing_shift(self):
        """Night shifts crossing midnight should work correctly."""

    def test_get_on_duty_team_returns_none_when_no_roster(self):
        """Should return None when no roster entry exists."""

    def test_get_on_duty_team_filters_by_context(self):
        """Should filter by inpatient/outpatient/emergency context."""


@pytest.mark.tier1
class TestTeamAssignmentService:
    def test_assign_initial_team_sets_both_fields(self):
        """Should set both primary_team and admitted_by_team."""

    def test_assign_initial_team_uses_duty_roster(self):
        """Should use duty roster when no explicit team provided."""

    def test_assign_initial_team_fallback_to_department(self):
        """Should fallback to department when no roster entry."""

    def test_reassign_on_bed_flexible_policy_no_change(self):
        """Flexible policy: team should not change on bed assignment."""

    def test_reassign_on_bed_strict_policy_changes_team(self):
        """Strict policy: team should change to ward's owner."""

    def test_reassign_preserves_admitted_by_team(self):
        """admitted_by_team should never change after initial assignment."""
```

**File:** `backend/apps/core/tests/test_security.py`

```python
@pytest.mark.tier1
class TestTeamAccessAfterReassignment:
    def test_old_team_loses_access_after_reassignment(self, settings):
        """When primary_team changes, old team should lose access."""

    def test_new_team_gains_access_after_reassignment(self, settings):
        """When primary_team changes, new team should gain access."""

    def test_admitted_by_team_does_not_grant_access(self, settings):
        """admitted_by_team field should not grant clinical access."""
```

### Frontend Tests

**File:** `frontend/src/components/registration/__tests__/TeamSelectionField.test.jsx`

```javascript
describe('TeamSelectionField', () => {
  it('shows on-duty team badge when roster entry exists', async () => {});
  it('auto-selects on-duty team on mount', async () => {});
  it('allows manual team selection override', async () => {});
  it('shows fallback message when no roster entry', async () => {});
  it('is hidden for outpatient encounters', () => {});
});
```

### Integration Tests

```python
@pytest.mark.integration
class TestRegistrationWithTeamAssignment:
    def test_register_inpatient_uses_duty_roster(self):
        """Inpatient registration should auto-assign on-duty team."""

    def test_register_with_explicit_team_override(self):
        """Explicit team_id should override duty roster."""

    def test_bed_assignment_triggers_reassignment_strict_policy(self):
        """Bed assignment in strict department should reassign team."""

    def test_access_control_reflects_team_changes(self):
        """Access control should immediately reflect team changes."""
```

---

## Appendix: Existing Model References

### DutyRoster Model (Already Exists)

**Location:** `backend/apps/organization/models.py:1109`

Key fields:
- `unit`: FK to ClinicalUnit (the team)
- `practitioner`: FK to PractitionerProfile
- `date`: Date of the duty
- `start_time`, `end_time`: Shift times
- `role`: admitting, covering, consulting, clinic, on_call
- `context`: inpatient, outpatient, emergency, all
- `is_primary`: Whether this is the primary on-duty entry

### EncounterCareTeam Model (Already Exists)

**Location:** `backend/apps/encounters/models.py:444`

Key fields:
- `encounter`: FK to Encounter
- `team`: FK to ClinicalUnit
- `role`: consulting, co_managing, procedure
- `status`: requested, accepted, active, completed, declined
- `is_active`: Boolean

### ClinicalUnit Hierarchy

```
Facility (root)
└── Department (can_have_wards=True, can_admit_patients=True)
    └── Team (can_admit_patients=True)
```

Teams are ClinicalUnits that can have staff assigned and can be set as `primary_team` on encounters.
