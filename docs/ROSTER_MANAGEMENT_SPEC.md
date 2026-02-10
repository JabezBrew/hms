# Roster Management System Specification

**Status:** Revision 2 - Major Redesign
**Date:** 2026-01-20
**Owner:** Clinical Systems

---

## Executive Summary

The current roster system is over-engineered and unusable. This revision proposes a complete redesign based on real-world roster documents and user interviews.

**Key insight:** A department secretary should be able to recreate their paper roster in the system within 10 minutes, not 2 hours.

---

## Real-World Context

### Sample Roster: O&G Department (5 Teams)

This is what a real paper roster looks like:

**Weekday Rotation Table:**
| Day | OBS Clinic | GYN Clinic | Theatre |
|-----|------------|------------|---------|
| Monday | Team B | Team D | Team C |
| Tuesday | Team C | Team E | Team D |
| Wednesday | Team D | Team A | Team E |
| Thursday | Team E | Team B | Team A |
| Friday | Team A | Team C | Team B |

**Weekend Duty (24-hour shifts):**
- Saturday: Rotates among B, C, D, E (Team A excluded - works Friday)
- Sunday: Rotates among A, C, D, E (Team B excluded - works Monday)

**Fixed Assignments:**
- Labour Ward Cover (Mon-Fri 8am-5pm): Dr. Agongo, Dr. Lokko (Team A)
- Gynae Emergency (Mon-Fri 8am-5pm): Dr. Abena Mensah (Team A)

**Leave List:** Names of doctors on leave that month

### Other Department Examples

| Department | Teams | Rotation Style |
|------------|-------|----------------|
| **Medicine** | 4 | Simple: A→B→C→D continuous through all days |
| **Surgery** | 4 | Split: Mon-Thu shared, Fri-Sun block rotates |
| **O&G** | 5 | Complex: Different rotations for weekdays vs weekends, with exclusion rules |

---

## Problem Statement

### Current System Issues

1. **Too many concepts:** Plans → Patterns → Pattern Slots → Overrides → Team Plans → Team Entries → Shift Definitions → Templates → Duty Types → Stations (9+ concepts)

2. **Database-driven UI:** The UI exposes database tables, not user workflows

3. **No clear path:** User doesn't know where to start or what order to do things

4. **Missing core features:**
   - Cannot easily create a simple weekly rotation table
   - Cannot print a roster that looks like their paper version
   - No rotation rule enforcement
   - No "who's on duty now" prominent display

### What Users Actually Need

1. "Team A works Mondays" → should be 1 click, not 5 screens
2. "Dr. Smith is sick, Dr. Jones covers" → simple override
3. "Print this month's roster" → PDF that looks like their paper
4. "Who's on call right now?" → instant answer

---

## Proposed Architecture

### Conceptual Model (User-Facing)

```
┌─────────────────────────────────────────────────────────────┐
│                     DEPARTMENT                              │
│  (e.g., O&G, Medicine, Surgery)                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TEAMS (or individual doctors for small facilities)        │
│  ├── Team A: Dr. Smith, Dr. Jones                          │
│  ├── Team B: Dr. Patel, Dr. Wilson                         │
│  └── ...                                                    │
│                                                             │
│  DUTY TYPES (what needs coverage)                          │
│  ├── OBS Clinic (Mon-Fri, 8am-5pm)                         │
│  ├── Theatre (Mon-Fri, 8am-5pm)                            │
│  ├── Weekend Duty (Sat-Sun, 24hr)                          │
│  └── ...                                                    │
│                                                             │
│  ROTATION RULES (how teams rotate)                         │
│  ├── OBS Clinic: B→C→D→E→A weekly                          │
│  ├── Weekend Sat: B→C→D→E, exclude Friday team             │
│  └── ...                                                    │
│                                                             │
│  ROSTER (the actual schedule)                              │
│  ├── Generated from rules, OR                              │
│  ├── Manually entered, OR                                  │
│  └── Imported from spreadsheet                             │
│                                                             │
│  OVERRIDES (exceptions)                                    │
│  └── Jan 15: Team C → Team D (Dr. Smith sick)              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Model (Backend)

#### Simplified Core Models

```python
# 1. TEAMS - Use existing ClinicalUnit with type='team'
#    Already exists, no changes needed

# 2. DUTY TYPES - Simplified
class DepartmentDutyType(models.Model):
    department = models.ForeignKey(ClinicalUnit)
    name = models.CharField(max_length=120)  # "OBS Clinic"
    code = models.CharField(max_length=40)   # "obs_clinic"

    # When this duty applies
    applicable_days = models.JSONField(default=list)  # [0,1,2,3,4] for Mon-Fri

    # Time configuration
    is_24_hour = models.BooleanField(default=False)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)

    # Display
    display_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

# 3. ROTATION RULES - New simplified model
class RotationRule(models.Model):
    department = models.ForeignKey(ClinicalUnit)
    duty_type = models.ForeignKey(DepartmentDutyType)
    name = models.CharField(max_length=120)  # "Weekend Saturday Rotation"

    # Rule type
    RULE_TYPES = [
        ('sequential', 'Simple Sequential'),      # A→B→C→D→A
        ('fixed_weekly', 'Fixed Weekly Pattern'), # Mon=A, Tue=B, etc.
        ('exclusion', 'Sequential with Exclusion'), # A→B→C but exclude X
    ]
    rule_type = models.CharField(max_length=20, choices=RULE_TYPES)

    # For sequential/exclusion: team order
    team_sequence = models.JSONField(default=list)  # [team_id_1, team_id_2, ...]

    # For fixed_weekly: day-to-team mapping
    day_assignments = models.JSONField(default=dict)  # {0: team_id, 1: team_id, ...}

    # For exclusion rules
    exclusion_rule = models.JSONField(null=True, blank=True)
    # Example: {"team_working_on": "friday", "excluded_from": "saturday"}

    # Applicable days (for rules that only apply to certain days)
    applicable_days = models.JSONField(default=list)  # [5, 6] for Sat-Sun only

    is_active = models.BooleanField(default=True)

# 4. ROSTER ENTRIES - Simplified flat structure
class RosterEntry(models.Model):
    department = models.ForeignKey(ClinicalUnit)
    duty_type = models.ForeignKey(DepartmentDutyType)
    date = models.DateField()

    # Assignment (either team OR individual, not both)
    team = models.ForeignKey(ClinicalUnit, null=True, blank=True, related_name='roster_entries')
    practitioner = models.ForeignKey(Practitioner, null=True, blank=True)

    # Time (inherits from duty_type if not specified)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)

    # Source tracking
    SOURCE_CHOICES = [
        ('generated', 'Auto-generated from rules'),
        ('manual', 'Manually entered'),
        ('imported', 'Imported from spreadsheet'),
        ('override', 'Override'),
    ]
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)

    # For overrides
    is_override = models.BooleanField(default=False)
    override_reason = models.CharField(max_length=255, blank=True)
    original_team = models.ForeignKey(ClinicalUnit, null=True, blank=True, related_name='overridden_entries')

    # Status
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('published', 'Published'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User)

    class Meta:
        indexes = [
            models.Index(fields=['department', 'date']),
            models.Index(fields=['department', 'duty_type', 'date']),
            models.Index(fields=['team', 'date']),
            models.Index(fields=['date', 'status']),
        ]
        # Only one entry per department+duty_type+date (overrides replace, not duplicate)
        constraints = [
            models.UniqueConstraint(
                fields=['department', 'duty_type', 'date'],
                name='unique_roster_entry'
            )
        ]
```

#### Migration Strategy

The existing models (`DepartmentRosterPlan`, `RosterPatternSlot`, `RosterOverride`, etc.) are overly complex. Options:

**Option A: Parallel Implementation (Recommended)**
- Create new simplified models alongside existing ones
- Build new UI against new models
- Migrate data from old to new
- Deprecate old models

**Option B: Refactor Existing**
- Simplify existing models in place
- Higher risk, requires careful migration

---

## Frontend Architecture

### Three Pages Only

#### Page 1: Roster Setup
**URL:** `/admin/organization/roster-setup`
**Purpose:** One-time configuration per department

```
┌─────────────────────────────────────────────────────────────┐
│ Roster Setup                          Department: [O&G ▼]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ TEAMS                                          [+ Add Team] │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Team A  │ Dr. Agongo, Dr. Lokko, Dr. Mensah  │ [Edit]  ││
│ │ Team B  │ Dr. Newman, Dr. Bayel              │ [Edit]  ││
│ │ Team C  │ Dr. Amegah, Dr. Kanu               │ [Edit]  ││
│ │ Team D  │ Dr. Nimbare                        │ [Edit]  ││
│ │ Team E  │ Dr. Allotey                        │ [Edit]  ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ DUTY TYPES                                 [+ Add Duty Type]│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ OBS Clinic    │ Mon-Fri │ 08:00-17:00      │ [Edit]    ││
│ │ GYN Clinic    │ Mon-Fri │ 08:00-17:00      │ [Edit]    ││
│ │ Theatre       │ Mon-Fri │ 08:00-17:00      │ [Edit]    ││
│ │ Weekend Duty  │ Sat-Sun │ 24 hours         │ [Edit]    ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ ROTATION RULES                                  [+ Add Rule]│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ OBS Clinic Weekday                                      ││
│ │   Type: Fixed Weekly                                    ││
│ │   Mon=B, Tue=C, Wed=D, Thu=E, Fri=A                    ││
│ │                                                         ││
│ │ Weekend Saturday                                        ││
│ │   Type: Sequential with Exclusion                       ││
│ │   Sequence: B → C → D → E                              ││
│ │   Rule: Team working Friday excluded from Saturday      ││
│ │                                                         ││
│ │ Weekend Sunday                                          ││
│ │   Type: Sequential with Exclusion                       ││
│ │   Sequence: A → C → D → E                              ││
│ │   Rule: Team working Monday excluded from Sunday        ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

#### Page 2: Roster Builder
**URL:** `/admin/organization/roster-builder`
**Purpose:** Create/edit roster for a period

```
┌─────────────────────────────────────────────────────────────┐
│ Roster Builder                                              │
│                                                             │
│ Department: [O&G ▼]     Period: [January 2026 ▼]           │
├─────────────────────────────────────────────────────────────┤
│ START FROM:                                                 │
│  ○ Blank        ○ Copy previous     ● Auto-generate        │
│  ○ Import CSV                               [Generate →]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│         │OBS Clinic│GYN Clinic│Theatre │Weekend│            │
│ ────────┼──────────┼──────────┼────────┼───────┤            │
│ Mon 6   │ Team B   │ Team D   │ Team C │   -   │            │
│ Tue 7   │ Team C   │ Team E   │ Team D │   -   │            │
│ Wed 8   │ Team D   │ Team A   │ Team E │   -   │            │
│ Thu 9   │ Team E   │ Team B   │ Team A │   -   │            │
│ Fri 10  │ Team A   │ Team C   │ Team B │   -   │            │
│ Sat 11  │    -     │    -     │   -    │Team C │ ← click to │
│ Sun 12  │    -     │    -     │   -    │Team D │   edit     │
│ Mon 13  │ Team B   │ Team D   │ Team C │   -   │            │
│ ...     │          │          │        │       │            │
│                                                             │
│ ✓ 0 rule violations                                        │
│                                                             │
│              [Save Draft]  [Publish]  [Print PDF 🖨️]       │
└─────────────────────────────────────────────────────────────┘
```

**Cell Edit:**
```
┌───────────────────────────────────┐
│ Saturday, Jan 11 - Weekend Duty   │
├───────────────────────────────────┤
│ Assign: [Team C ▼]               │
│                                   │
│ Available:                        │
│  ✓ Team B  ✓ Team C              │
│  ✓ Team D  ✓ Team E              │
│  ✗ Team A (works Friday)         │
│                                   │
│         [Cancel] [Save]           │
└───────────────────────────────────┘
```

#### Page 3: Duty Roster (Operations)
**URL:** `/admin/organization/duty-roster`
**Purpose:** Daily use - who's on duty, quick overrides

```
┌─────────────────────────────────────────────────────────────┐
│ Duty Roster                       [Edit Roster] [⚙️ Setup]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ON DUTY NOW                              Monday, Jan 6 2026 │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ OBS Clinic  │ Team B │ 08:00-17:00                     ││
│ │ GYN Clinic  │ Team D │ 08:00-17:00                     ││
│ │ Theatre     │ Team C │ 08:00-17:00                     ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ QUICK OVERRIDE                                              │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Date: [Jan 15] Duty: [OBS Clinic ▼] Replace with: [▼]  ││
│ │ Reason: [_______________________]     [Add Override]   ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ CALENDAR VIEW                          ◀ January 2026 ▶    │
│ [Calendar grid showing the month]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## API Design

### New Simplified Endpoints

```
# Rotation Rules
GET    /api/organization/departments/{id}/rotation-rules/
POST   /api/organization/departments/{id}/rotation-rules/
PATCH  /api/organization/rotation-rules/{id}/
DELETE /api/organization/rotation-rules/{id}/

# Roster Entries (flat, simple)
GET    /api/organization/departments/{id}/roster/
       ?date_from=2026-01-01&date_to=2026-01-31
       &status=published
POST   /api/organization/departments/{id}/roster/generate/
       {period: "2026-01", source: "rules"}
POST   /api/organization/departments/{id}/roster/
       {date, duty_type, team, source: "manual"}
PATCH  /api/organization/roster/{id}/
DELETE /api/organization/roster/{id}/

# Bulk operations
POST   /api/organization/departments/{id}/roster/bulk/
       [{date, duty_type, team}, ...]
POST   /api/organization/departments/{id}/roster/import/
       (CSV file)
POST   /api/organization/departments/{id}/roster/publish/
       {date_from, date_to}

# Override (just a special roster entry)
POST   /api/organization/roster/{id}/override/
       {replacement_team, reason}

# Real-time lookup
GET    /api/organization/departments/{id}/on-duty/
       ?datetime=2026-01-06T10:00:00
GET    /api/organization/on-duty/
       ?datetime=2026-01-06T10:00:00
       (returns all departments)

# Print
GET    /api/organization/departments/{id}/roster/print/
       ?period=2026-01
       (returns PDF)
```

### Roster Generation Logic

```python
def generate_roster(department, period, rules):
    """
    Generate roster entries from rotation rules.

    For each date in period:
        For each duty_type applicable to that day:
            Find matching rotation rule
            Apply rule to determine team:
                - sequential: next in sequence
                - fixed_weekly: lookup by day of week
                - exclusion: next in sequence, skip excluded team
            Create RosterEntry(date, duty_type, team, source='generated')
    """
    entries = []

    for date in period.dates():
        day_of_week = date.weekday()  # 0=Mon, 6=Sun

        for duty_type in department.duty_types.filter(
            applicable_days__contains=day_of_week,
            is_active=True
        ):
            rule = rules.filter(duty_type=duty_type).first()
            if not rule:
                continue

            team = apply_rule(rule, date, entries)

            if team:
                entries.append(RosterEntry(
                    department=department,
                    duty_type=duty_type,
                    date=date,
                    team=team,
                    source='generated',
                    status='draft'
                ))

    return entries


def apply_rule(rule, date, existing_entries):
    """Apply rotation rule to determine team for a date."""

    if rule.rule_type == 'fixed_weekly':
        day_of_week = str(date.weekday())
        return rule.day_assignments.get(day_of_week)

    elif rule.rule_type == 'sequential':
        # Count how many times we've cycled through
        sequence = rule.team_sequence
        # Find position based on week number or continuous count
        position = calculate_position(rule, date)
        return sequence[position % len(sequence)]

    elif rule.rule_type == 'exclusion':
        sequence = rule.team_sequence
        excluded_team = get_excluded_team(rule, date, existing_entries)

        # Get available teams (sequence minus excluded)
        available = [t for t in sequence if t != excluded_team]
        position = calculate_position(rule, date)
        return available[position % len(available)]

    return None


def get_excluded_team(rule, date, existing_entries):
    """Find which team is excluded based on rule."""
    # Example rule: {"team_working_on": "friday", "excluded_from": "saturday"}

    exclusion = rule.exclusion_rule
    if not exclusion:
        return None

    # Find what team works the excluding day
    excluding_day = exclusion['team_working_on']  # e.g., 'friday'
    excluded_from = exclusion['excluded_from']     # e.g., 'saturday'

    # Only apply if current date matches excluded_from day
    if date.strftime('%A').lower() != excluded_from:
        return None

    # Find the date of the excluding day in same week
    excluding_date = get_day_in_same_week(date, excluding_day)

    # Find who works that day
    entry = existing_entries.filter(date=excluding_date).first()
    return entry.team if entry else None
```

---

## Validation Rules

### Strict Enforcement (Block, Don't Warn)

1. **No back-to-back 24hr shifts**
   ```python
   if duty_type.is_24_hour:
       previous_day_team = get_team_for_date(date - 1 day)
       next_day_team = get_team_for_date(date + 1 day)
       if team == previous_day_team or team == next_day_team:
           raise ValidationError("Cannot assign back-to-back 24hr shifts")
   ```

2. **Exclusion rules**
   ```python
   excluded = get_excluded_team(rule, date)
   if team == excluded:
       raise ValidationError(f"Team {team} is excluded from {date} per rule")
   ```

3. **Coverage completeness**
   ```python
   for duty_type in department.duty_types.active():
       for date in period:
           if duty_type.applies_to(date) and not has_entry(date, duty_type):
               warnings.append(f"No coverage for {duty_type} on {date}")
   ```

---

## Print Output Specification

The PDF should match the paper roster format:

```
┌─────────────────────────────────────────────────────────────┐
│           O&G DEPARTMENT DUTY ROSTER                        │
│                  JANUARY 2026                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ WEEKDAYS                                                    │
│ ┌─────────┬──────────┬──────────┬─────────┐                │
│ │         │OBS Clinic│GYN Clinic│ Theatre │                │
│ ├─────────┼──────────┼──────────┼─────────┤                │
│ │ Monday  │ Team B   │ Team D   │ Team C  │                │
│ │ Tuesday │ Team C   │ Team E   │ Team D  │                │
│ │Wednesday│ Team D   │ Team A   │ Team E  │                │
│ │Thursday │ Team E   │ Team B   │ Team A  │                │
│ │ Friday  │ Team A   │ Team C   │ Team B  │                │
│ └─────────┴──────────┴──────────┴─────────┘                │
│                                                             │
│ WEEKEND DUTY                                                │
│ ┌──────────────────────────────────────────┐               │
│ │ Sat 4th  - Team C   │ Sat 18th - Team B  │               │
│ │ Sun 5th  - Team D   │ Sun 19th - Team A  │               │
│ │ Sat 11th - Team D   │ Sat 25th - Team C  │               │
│ │ Sun 12th - Team E   │ Sun 26th - Team D  │               │
│ └──────────────────────────────────────────┘               │
│                                                             │
│ FIXED ASSIGNMENTS                                           │
│ Labour Ward (Mon-Fri 8am-5pm): Dr. Agongo, Dr. Lokko       │
│ Gynae Emergency (Mon-Fri 8am-5pm): Dr. Abena Mensah        │
│                                                             │
│                                                             │
│ Generated: 2026-01-06          Approved: ____________      │
└─────────────────────────────────────────────────────────────┘
```

---

## Migration Plan

### Phase 1: New Models (Backend)
1. Create new simplified models (`RotationRule`, simplified `RosterEntry`)
2. Create new API endpoints
3. Keep old models/endpoints running in parallel

### Phase 2: New UI (Frontend)
1. Build Roster Setup page against new API
2. Build Roster Builder page against new API
3. Update Duty Roster page to use new API
4. Remove old 12-tab Roster Settings page

### Phase 3: Data Migration
1. Migrate existing `RosterPatternSlot` → `RotationRule`
2. Migrate existing `DutyRoster` → `RosterEntry`
3. Deprecate old models

### Phase 4: Cleanup
1. Remove old models
2. Remove old API endpoints
3. Remove old frontend components

---

## Security & Access

| Page | Admin | Dept Secretary | Head Nurse | Staff |
|------|-------|----------------|------------|-------|
| Roster Setup | Full | Full | None | None |
| Roster Builder | Full | Full | None | None |
| Duty Roster | Full | Full | View | View |
| On-Duty API | Full | Full | Full | Full |

---

## Performance Requirements

- Roster generation: < 2 seconds for 1 month
- On-duty lookup: < 100ms (cached)
- Calendar view load: < 500ms
- Print PDF generation: < 3 seconds

---

## Open Questions

1. **Fixed Assignments:** Should "Labour Ward Cover" (specific doctors, not rotating teams) be a separate concept or a duty type with `rotation_type='none'`?

2. **Leave Integration:** Should roster builder show who's on leave and warn/block assignments?

3. **Notifications:** Future feature - notify teams/doctors of schedule? SMS/email/in-app?

4. **Audit History:** How much change history to retain? Show "edited by X on date"?

---

## Success Metrics

1. **Time to create roster:** < 10 minutes for a new monthly roster
2. **User errors:** < 5% of roster submissions have validation errors
3. **Support tickets:** Reduce roster-related tickets by 80%
4. **Adoption:** 90% of departments using system within 3 months

---

## Summary

**Current:** 9+ concepts, 12 tabs, database-driven UI, unusable

**Proposed:** 3 concepts (Setup, Build, Operate), 3 pages, workflow-driven UI, matches paper roster

The backend needs simplification too - the current `DepartmentRosterPlan` → `RosterPatternSlot` → `RosterOverride` chain is too complex. A flat `RosterEntry` model with source tracking (`generated`, `manual`, `override`) is simpler and sufficient.
