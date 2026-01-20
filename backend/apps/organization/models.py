"""
Organization models for flexible hospital hierarchy.

This module implements a configurable organizational structure using:
- MPTT for efficient tree queries on ClinicalUnit
- Configuration tables for unit types, leadership roles, and staff assignment types
- Denormalized fields for O(1) access to commonly-needed properties
"""
import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils import timezone
from mptt.models import MPTTModel, TreeForeignKey


DUTY_ROSTER_ROLE_CHOICES = [
    ('admitting', 'Admitting'),
    ('covering', 'Covering'),
    ('consulting', 'Consulting'),
    ('clinic', 'Clinic'),
    ('on_call', 'On Call'),
]

DUTY_ROSTER_CONTEXT_CHOICES = [
    ('inpatient', 'Inpatient'),
    ('outpatient', 'Outpatient'),
    ('emergency', 'Emergency'),
    ('all', 'All Contexts'),
]

DUTY_ROSTER_SENIORITY_CHOICES = [
    ('attending', 'Attending'),
    ('fellow', 'Fellow'),
    ('resident', 'Resident'),
    ('intern', 'Intern'),
]


# =============================================================================
# Configuration Models
# =============================================================================


class UnitTypeConfig(models.Model):
    """
    Defines what types of units a hospital can have.
    Examples: facility, department, division, team, specialty
    """
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)

    # Hierarchy rules
    allowed_parent_types = models.ManyToManyField(
        'self',
        symmetrical=False,
        blank=True,
        related_name='allowed_child_types',
        help_text='Unit types that can be parents of this type'
    )
    can_be_root = models.BooleanField(
        default=False,
        help_text='Whether units of this type can be root nodes (no parent)'
    )
    depth_level = models.PositiveSmallIntegerField(
        default=0,
        help_text='Typical depth in hierarchy (0=root level)'
    )

    # Capabilities
    can_have_wards = models.BooleanField(
        default=False,
        help_text='Whether units of this type can have ward allocations'
    )
    can_admit_patients = models.BooleanField(
        default=False,
        help_text='Whether units of this type can be primary teams for admissions'
    )
    can_consult = models.BooleanField(
        default=False,
        help_text='Whether units of this type can be consulting teams'
    )
    can_have_budget = models.BooleanField(
        default=False,
        help_text='Whether units of this type can have their own budget/cost center'
    )

    # Custom attributes schema (JSON Schema for validation)
    attributes_schema = models.JSONField(
        default=dict,
        blank=True,
        help_text='JSON Schema for validating custom_attributes on units of this type'
    )

    # Display
    icon = models.CharField(max_length=50, blank=True)
    color = models.CharField(max_length=20, blank=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['display_order', 'name']
        verbose_name = 'Unit Type Configuration'
        verbose_name_plural = 'Unit Type Configurations'

    def __str__(self):
        return self.name


class LeadershipRoleConfig(models.Model):
    """
    Defines leadership roles available in the system.
    Examples: head, deputy, nurse_manager, medical_director
    """
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)

    applicable_unit_types = models.ManyToManyField(
        UnitTypeConfig,
        blank=True,
        related_name='available_leadership_roles',
        help_text='Unit types that can have this leadership role'
    )
    is_primary_leader = models.BooleanField(
        default=False,
        help_text='Whether this is considered the primary leadership role for a unit'
    )
    max_per_unit = models.PositiveSmallIntegerField(
        default=1,
        help_text='Maximum number of this role per unit'
    )

    # Permissions granted by this role
    can_approve = models.BooleanField(
        default=False,
        help_text='Can approve requests, leaves, etc.'
    )
    can_manage_staff = models.BooleanField(
        default=False,
        help_text='Can manage staff assignments within the unit'
    )
    can_manage_budget = models.BooleanField(
        default=False,
        help_text='Can manage budget and financial matters'
    )
    can_view_all_data = models.BooleanField(
        default=True,
        help_text='Can view all clinical data within the unit'
    )

    display_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['display_order', 'name']
        verbose_name = 'Leadership Role Configuration'
        verbose_name_plural = 'Leadership Role Configurations'

    def __str__(self):
        return self.name


class StaffAssignmentTypeConfig(models.Model):
    """
    Defines assignment models for staff to units.
    Examples: single, primary_secondary, rotational
    """
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)

    requires_primary = models.BooleanField(
        default=False,
        help_text='Staff must have a primary unit assignment'
    )
    allows_secondary = models.BooleanField(
        default=False,
        help_text='Staff can have secondary unit assignments'
    )
    allows_multiple_primary = models.BooleanField(
        default=False,
        help_text='Staff can have multiple primary assignments'
    )
    supports_date_ranges = models.BooleanField(
        default=False,
        help_text='Assignments have effective date ranges (rotational)'
    )

    applicable_user_types = models.JSONField(
        default=list,
        blank=True,
        help_text='User types this assignment model applies to (e.g., ["doctor", "nurse"])'
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Staff Assignment Type Configuration'
        verbose_name_plural = 'Staff Assignment Type Configurations'

    def __str__(self):
        return self.name


class DepartmentDutyType(models.Model):
    """Configurable duty types per department."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='duty_types',
        help_text='Department this duty type belongs to'
    )
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=40)
    default_context = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_CONTEXT_CHOICES,
        default='inpatient'
    )
    default_role = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_ROLE_CHOICES,
        default='admitting'
    )
    default_role_label = models.CharField(max_length=80, blank=True)
    default_context_label = models.CharField(max_length=80, blank=True)
    requires_time_range = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['department', 'code'],
                name='unique_duty_type_code_per_department'
            ),
        ]
        indexes = [
            models.Index(fields=['department', 'is_active']),
            models.Index(fields=['department', 'display_order']),
        ]
        ordering = ['display_order', 'name']
        verbose_name = 'Department Duty Type'
        verbose_name_plural = 'Department Duty Types'

    def __str__(self):
        return self.name

    def clean(self):
        from django.core.exceptions import ValidationError
        if getattr(self.department.unit_type, 'code', None) != 'department':
            raise ValidationError({'department': 'Duty types must belong to a department unit.'})


class DepartmentStation(models.Model):
    """Controlled list of stations/locations per department."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='stations',
        help_text='Department this station belongs to'
    )
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=40)
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['department', 'code'],
                name='unique_station_code_per_department'
            ),
        ]
        indexes = [
            models.Index(fields=['department', 'is_active']),
        ]
        ordering = ['display_order', 'name']
        verbose_name = 'Department Station'
        verbose_name_plural = 'Department Stations'

    def __str__(self):
        return f'{self.code} - {self.name}'

    def clean(self):
        from django.core.exceptions import ValidationError
        if getattr(self.department.unit_type, 'code', None) != 'department':
            raise ValidationError({'department': 'Stations must belong to a department unit.'})


# =============================================================================
# Core Models
# =============================================================================


class ClinicalUnit(MPTTModel):
    """
    The main organizational unit model using MPTT for efficient tree queries.
    Represents any level of the hospital hierarchy: facility, department, team, etc.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Hierarchy (MPTT)
    parent = TreeForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='children'
    )
    unit_type = models.ForeignKey(
        UnitTypeConfig,
        on_delete=models.PROTECT,
        related_name='units'
    )
    core_department = models.ForeignKey(
        'core.Department',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='clinical_units',
        help_text='Mapped facility department for registration and reporting'
    )

    # DENORMALIZED for performance (updated via signals)
    root_unit = models.ForeignKey(
        'self',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
        help_text='Cached reference to root/facility for O(1) access'
    )
    path_cache = models.CharField(
        max_length=1000,
        blank=True,
        help_text='Cached full path string: "Hospital > Surgery > Team A"'
    )

    # Identity
    code = models.CharField(
        max_length=50,
        help_text='Short code, unique within parent'
    )
    name = models.CharField(max_length=200)
    short_name = models.CharField(max_length=50, blank=True)
    description = models.TextField(blank=True)

    # Location
    location = models.CharField(max_length=200, blank=True)
    floor = models.CharField(max_length=50, blank=True)
    building = models.CharField(max_length=100, blank=True)

    # Contact
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)

    # Operating hours
    operating_hours_start = models.TimeField(null=True, blank=True)
    operating_hours_end = models.TimeField(null=True, blank=True)
    operates_24_hours = models.BooleanField(default=False)

    # Custom attributes (validated against unit_type.attributes_schema on write)
    custom_attributes = models.JSONField(default=dict, blank=True)

    # Inherited settings
    timezone = models.CharField(max_length=50, blank=True)
    currency = models.CharField(max_length=3, blank=True)

    # Financial
    has_own_budget = models.BooleanField(default=False)
    cost_center_code = models.CharField(max_length=50, blank=True)

    # Clinical
    accepts_referrals = models.BooleanField(default=True)
    accepts_admissions = models.BooleanField(default=True)
    WARD_ASSIGNMENT_POLICY_CHOICES = [
        ('flexible', 'Flexible - Patient stays with admitting team'),
        ('strict', 'Strict - Patient transfers to ward\'s team'),
    ]
    ward_assignment_policy = models.CharField(
        max_length=20,
        choices=WARD_ASSIGNMENT_POLICY_CHOICES,
        default='flexible',
        help_text='Policy when patient is placed in a ward owned by another team'
    )
    STAFFING_MODE_CHOICES = (
        ('clinical_only', 'Clinical (Practitioner Only)'),
        ('mixed', 'Mixed (Clinical + Operations)'),
        ('ops_only', 'Operations (Non-Clinical Only)'),
    )
    staffing_mode = models.CharField(
        max_length=20,
        choices=STAFFING_MODE_CHOICES,
        default='clinical_only',
        help_text='Controls which staff assignments are allowed for this unit'
    )

    # Status
    is_active = models.BooleanField(default=True)
    effective_from = models.DateField(null=True, blank=True)
    effective_until = models.DateField(null=True, blank=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_units'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_units'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['parent', 'code'],
                name='unique_code_within_parent'
            ),
            models.UniqueConstraint(
                fields=['code'],
                condition=models.Q(parent__isnull=True),
                name='unique_root_code'
            ),
        ]
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['unit_type', 'is_active']),
            models.Index(fields=['parent', 'is_active']),
            models.Index(fields=['root_unit', 'is_active']),
            models.Index(fields=['core_department', 'is_active']),
            models.Index(fields=['ward_assignment_policy', 'is_active']),
        ]
        ordering = ['tree_id', 'lft']
        verbose_name = 'Clinical Unit'
        verbose_name_plural = 'Clinical Units'

    class MPTTMeta:
        order_insertion_by = ['name']

    def __str__(self):
        return self.name

    @property
    def full_path(self):
        """Use cached path for reads; fallback to computed for edge cases."""
        if self.path_cache:
            return self.path_cache
        return ' > '.join([a.name for a in self.get_ancestors(include_self=True)])

    @property
    def facility(self):
        """Use denormalized root_unit for O(1) access."""
        return self.root_unit

    def get_effective_timezone(self):
        """Get timezone, inheriting from ancestors if not set."""
        if self.timezone:
            return self.timezone
        for ancestor in self.get_ancestors(ascending=True):
            if ancestor.timezone:
                return ancestor.timezone
        return 'UTC'

    def get_effective_currency(self):
        """Get currency, inheriting from ancestors if not set."""
        if self.currency:
            return self.currency
        for ancestor in self.get_ancestors(ascending=True):
            if ancestor.currency:
                return ancestor.currency
        return 'USD'


class Clinic(models.Model):
    """Outpatient clinic configuration for visit management."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='clinics'
    )
    department = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.PROTECT,
        related_name='clinics',
        help_text='Clinical unit that owns this clinic'
    )
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    operating_hours_start = models.TimeField(null=True, blank=True)
    operating_hours_end = models.TimeField(null=True, blank=True)
    operates_24_hours = models.BooleanField(default=False)
    accepts_walk_ins = models.BooleanField(default=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_clinics'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_clinics'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'code'],
                name='unique_clinic_code_per_facility'
            )
        ]
        indexes = [
            models.Index(fields=['facility', 'is_active']),
            models.Index(fields=['department', 'is_active']),
            models.Index(fields=['code']),
        ]
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.code})"


class ClinicSchedule(models.Model):
    """Defines day/time schedules for clinics within a department."""
    class DayOfWeek(models.IntegerChoices):
        MONDAY = 0, 'Monday'
        TUESDAY = 1, 'Tuesday'
        WEDNESDAY = 2, 'Wednesday'
        THURSDAY = 3, 'Thursday'
        FRIDAY = 4, 'Friday'
        SATURDAY = 5, 'Saturday'
        SUNDAY = 6, 'Sunday'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='clinic_schedules'
    )
    department = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.PROTECT,
        related_name='clinic_schedules'
    )
    clinic = models.ForeignKey(
        Clinic,
        on_delete=models.PROTECT,
        related_name='schedules'
    )
    day_of_week = models.PositiveSmallIntegerField(choices=DayOfWeek.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_clinic_schedules'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_clinic_schedules'
    )

    class Meta:
        indexes = [
            models.Index(fields=['facility', 'day_of_week', 'is_active']),
            models.Index(fields=['department', 'day_of_week', 'is_active']),
            models.Index(fields=['clinic', 'day_of_week', 'is_active']),
        ]
        ordering = ['day_of_week', 'start_time']

    def __str__(self):
        return f"{self.clinic.name} ({self.get_day_of_week_display()} {self.start_time}-{self.end_time})"


class UnitLeadership(models.Model):
    """
    Tracks leadership positions with effective dates.
    Supports multiple leaders per unit and time-based assignments.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    unit = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.CASCADE,
        related_name='leadership_assignments'
    )
    role = models.ForeignKey(
        LeadershipRoleConfig,
        on_delete=models.PROTECT,
        related_name='assignments'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='leadership_positions'
    )

    effective_from = models.DateField()
    effective_until = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_leadership_assignments'
    )

    class Meta:
        indexes = [
            models.Index(fields=['unit', 'role', 'is_active']),
            models.Index(fields=['user', 'is_active']),
            models.Index(fields=['unit', 'is_active', 'effective_from', 'effective_until']),
        ]
        verbose_name = 'Unit Leadership'
        verbose_name_plural = 'Unit Leadership Assignments'

    def __str__(self):
        return f'{self.user} - {self.role} of {self.unit}'

    @property
    def is_currently_effective(self):
        """Check if this leadership assignment is currently active."""
        today = timezone.now().date()
        if not self.is_active:
            return False
        if self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True


# =============================================================================
# Staff Assignment Models
# =============================================================================


class StaffUnitAssignment(models.Model):
    """
    Staff assignment to clinical units (teams/departments).
    Supports primary, secondary, and rotational assignments.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    unit = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.CASCADE,
        related_name='staff_assignments'
    )
    practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.CASCADE,
        related_name='unit_assignments'
    )
    assignment_type = models.ForeignKey(
        StaffAssignmentTypeConfig,
        on_delete=models.PROTECT,
        related_name='assignments'
    )

    is_primary = models.BooleanField(
        default=False,
        help_text='This is the staff member\'s primary unit'
    )
    is_secondary = models.BooleanField(
        default=False,
        help_text='This is a secondary assignment'
    )

    # Rotational/time-based assignments
    effective_from = models.DateField(null=True, blank=True)
    effective_until = models.DateField(null=True, blank=True)

    role_description = models.CharField(
        max_length=100,
        blank=True,
        help_text='Specific role within the unit (e.g., "Senior Resident")'
    )
    fte_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=100.00,
        help_text='Full-time equivalent percentage (0-100)'
    )

    is_active = models.BooleanField(default=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='assigned_staff'
    )

    class Meta:
        indexes = [
            models.Index(fields=['unit', 'is_active']),
            models.Index(fields=['practitioner', 'is_active']),
            models.Index(fields=['is_primary', 'is_active']),
            models.Index(fields=['unit', 'is_active', 'effective_from', 'effective_until']),
        ]
        verbose_name = 'Staff Unit Assignment'
        verbose_name_plural = 'Staff Unit Assignments'

    def __str__(self):
        assignment = 'Primary' if self.is_primary else ('Secondary' if self.is_secondary else 'Assignment')
        return f'{self.practitioner} - {assignment} at {self.unit}'

    @property
    def is_currently_effective(self):
        """Check if this assignment is currently active."""
        if not self.is_active:
            return False
        today = timezone.now().date()
        if self.effective_from and self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True


class UnitMemberAssignment(models.Model):
    """
    Non-clinical staff assignment to units (ops-only units).
    Mirrors StaffUnitAssignment but links to Staff instead of PractitionerProfile.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    unit = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.CASCADE,
        related_name='member_assignments'
    )
    staff = models.ForeignKey(
        'users.Staff',
        on_delete=models.CASCADE,
        related_name='unit_memberships'
    )
    assignment_type = models.ForeignKey(
        StaffAssignmentTypeConfig,
        on_delete=models.PROTECT,
        related_name='member_assignments'
    )

    is_primary = models.BooleanField(
        default=False,
        help_text='This is the staff member\'s primary unit'
    )
    is_secondary = models.BooleanField(
        default=False,
        help_text='This is a secondary assignment'
    )

    effective_from = models.DateField(null=True, blank=True)
    effective_until = models.DateField(null=True, blank=True)

    role_description = models.CharField(
        max_length=100,
        blank=True,
        help_text='Specific role within the unit (e.g., "Billing Lead")'
    )
    fte_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=100.00,
        help_text='Full-time equivalent percentage (0-100)'
    )

    is_active = models.BooleanField(default=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='assigned_members'
    )

    class Meta:
        indexes = [
            models.Index(fields=['unit', 'is_active']),
            models.Index(fields=['staff', 'is_active']),
            models.Index(fields=['is_primary', 'is_active']),
            models.Index(fields=['unit', 'is_active', 'effective_from', 'effective_until']),
        ]
        verbose_name = 'Unit Member Assignment'
        verbose_name_plural = 'Unit Member Assignments'

    def __str__(self):
        assignment = 'Primary' if self.is_primary else ('Secondary' if self.is_secondary else 'Assignment')
        return f'{self.staff} - {assignment} at {self.unit}'

    @property
    def is_currently_effective(self):
        """Check if this assignment is currently active."""
        if not self.is_active:
            return False
        today = timezone.now().date()
        if self.effective_from and self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True


class CrossCoverageSchedule(models.Model):
    """
    Cross-coverage for on-call between units.
    Allows practitioners or entire units to cover other units.
    """
    COVERAGE_TYPE_CHOICES = [
        ('on_call', 'On Call'),
        ('backup', 'Backup'),
        ('primary', 'Primary Coverage'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    covered_unit = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.CASCADE,
        related_name='coverage_schedules',
        help_text='The unit being covered'
    )
    covering_practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='coverage_assignments',
        help_text='The practitioner providing coverage'
    )
    covering_unit = models.ForeignKey(
        ClinicalUnit,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='units_covered',
        help_text='The unit providing coverage (alternative to individual practitioner)'
    )

    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()

    coverage_type = models.CharField(
        max_length=20,
        choices=COVERAGE_TYPE_CHOICES,
        default='on_call'
    )

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_coverage_schedules'
    )

    class Meta:
        indexes = [
            models.Index(fields=['covered_unit', 'is_active', 'start_datetime', 'end_datetime']),
            models.Index(fields=['covering_practitioner', 'is_active']),
            models.Index(fields=['covering_unit', 'is_active']),
        ]
        verbose_name = 'Cross Coverage Schedule'
        verbose_name_plural = 'Cross Coverage Schedules'

    def __str__(self):
        covering = self.covering_practitioner or self.covering_unit
        return f'{covering} covers {self.covered_unit} ({self.start_datetime} - {self.end_datetime})'

    def clean(self):
        from django.core.exceptions import ValidationError
        if not self.covering_practitioner and not self.covering_unit:
            raise ValidationError('Either covering_practitioner or covering_unit must be set.')
        if self.covering_practitioner and self.covering_unit:
            raise ValidationError('Only one of covering_practitioner or covering_unit can be set.')


# =============================================================================
# Unit-Ward Capacity Allocation
# =============================================================================


class UnitWardAllocation(models.Model):
    """
    Links clinical units to ward bed capacity.
    Units get allocated beds - primary model is capacity-based.
    """
    ALLOCATION_TYPE_CHOICES = [
        ('dedicated', 'Dedicated Beds'),
        ('shared', 'Shared Pool'),
        ('overflow', 'Overflow Only'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    unit = models.ForeignKey(
        ClinicalUnit,
        on_delete=models.CASCADE,
        related_name='ward_allocations'
    )
    ward = models.ForeignKey(
        'wards.Ward',
        on_delete=models.CASCADE,
        related_name='unit_allocations'
    )

    # Capacity-based allocation
    allocation_type = models.CharField(
        max_length=20,
        choices=ALLOCATION_TYPE_CHOICES,
        default='dedicated'
    )
    allocated_beds = models.PositiveIntegerField(
        default=0,
        help_text='Number of dedicated beds'
    )
    max_beds = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Maximum beds for shared allocation'
    )
    min_beds = models.PositiveIntegerField(
        default=0,
        help_text='Minimum reserved beds'
    )
    priority = models.PositiveSmallIntegerField(
        default=100,
        help_text='Lower number = higher priority for bed assignment'
    )

    # Optional time-based validity
    effective_from = models.DateField(null=True, blank=True)
    effective_until = models.DateField(null=True, blank=True)
    days_of_week = ArrayField(
        models.IntegerField(),
        null=True,
        blank=True,
        help_text='Days of week this allocation applies (0=Monday, 6=Sunday)'
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_ward_allocations'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['unit', 'ward', 'effective_from'],
                name='unique_unit_ward_allocation'
            ),
        ]
        indexes = [
            models.Index(fields=['unit', 'is_active']),
            models.Index(fields=['ward', 'is_active']),
            models.Index(fields=['unit', 'is_active', 'effective_from', 'effective_until']),
        ]
        verbose_name = 'Unit Ward Allocation'
        verbose_name_plural = 'Unit Ward Allocations'

    def __str__(self):
        return f'{self.unit} - {self.ward} ({self.allocation_type})'

    @property
    def is_currently_effective(self):
        """Check if this allocation is currently active."""
        if not self.is_active:
            return False
        today = timezone.now().date()
        if self.effective_from and self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True


# =============================================================================
# Department Roster Models
# =============================================================================


class DepartmentRosterPattern(models.Model):
    """Named pattern grouping within a department roster plan."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        'organization.DepartmentRosterPlan',
        on_delete=models.CASCADE,
        related_name='patterns'
    )
    name = models.CharField(max_length=160)
    display_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['plan', 'name'],
                name='unique_roster_pattern_per_plan'
            ),
        ]
        indexes = [
            models.Index(fields=['plan', 'is_active']),
            models.Index(fields=['plan', 'display_order']),
        ]
        ordering = ['display_order', 'name']
        verbose_name = 'Department Roster Pattern'
        verbose_name_plural = 'Department Roster Patterns'

    def __str__(self):
        return f'{self.plan.name} - {self.name}'


class DepartmentRosterPlan(models.Model):
    """Versioned department roster plan with cycle-based slots."""
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('archived', 'Archived'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='roster_plans',
        help_text='Department this roster plan applies to'
    )
    name = models.CharField(max_length=160)
    cycle_length_days = models.PositiveSmallIntegerField(default=7)
    effective_from = models.DateField()
    effective_until = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    version = models.PositiveSmallIntegerField(default=1)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_department_roster_plans'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_department_roster_plans'
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(cycle_length_days__gte=1),
                name='department_roster_cycle_length_positive'
            ),
        ]
        indexes = [
            models.Index(fields=['department', 'status']),
            models.Index(fields=['department', 'effective_from', 'effective_until']),
        ]
        ordering = ['-effective_from', '-version']
        verbose_name = 'Department Roster Plan'
        verbose_name_plural = 'Department Roster Plans'

    def __str__(self):
        return f'{self.department.name} - {self.name} (v{self.version})'

    def clean(self):
        from django.core.exceptions import ValidationError
        if getattr(self.department.unit_type, 'code', None) != 'department':
            raise ValidationError({'department': 'Roster plans must belong to a department unit.'})
        if self.effective_until and self.effective_from and self.effective_until < self.effective_from:
            raise ValidationError({'effective_until': 'Effective until must be on or after effective from.'})
        if self.cycle_length_days < 1:
            raise ValidationError({'cycle_length_days': 'Cycle length must be at least 1 day.'})

    @property
    def is_active(self):
        today = timezone.now().date()
        if self.status != 'active':
            return False
        if self.effective_from and self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True


class RosterPatternSlot(models.Model):
    """Defines team duty assignments within a roster cycle."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        'organization.DepartmentRosterPlan',
        on_delete=models.CASCADE,
        related_name='pattern_slots'
    )
    pattern = models.ForeignKey(
        'organization.DepartmentRosterPattern',
        on_delete=models.CASCADE,
        related_name='slots',
        null=True,
        blank=True
    )
    day_offset = models.PositiveSmallIntegerField(help_text='0-based day index in the cycle')
    duty_type = models.ForeignKey(
        'organization.DepartmentDutyType',
        on_delete=models.CASCADE,
        related_name='pattern_slots'
    )
    team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='roster_pattern_slots'
    )
    context_override = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_CONTEXT_CHOICES,
        null=True, blank=True
    )
    role_override = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_ROLE_CHOICES,
        null=True, blank=True
    )
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['plan', 'pattern', 'day_offset', 'duty_type'],
                name='unique_roster_slot_per_pattern_day'
            ),
            models.CheckConstraint(
                check=models.Q(day_offset__gte=0),
                name='roster_slot_day_offset_nonnegative'
            ),
        ]
        indexes = [
            models.Index(fields=['plan', 'pattern', 'day_offset']),
            models.Index(fields=['plan', 'pattern', 'duty_type']),
            models.Index(fields=['team', 'day_offset']),
        ]
        ordering = ['day_offset', 'duty_type__display_order']
        verbose_name = 'Roster Pattern Slot'
        verbose_name_plural = 'Roster Pattern Slots'


class RosterOverride(models.Model):
    """Per-date override of roster plan slots."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        'organization.DepartmentRosterPlan',
        on_delete=models.CASCADE,
        related_name='overrides'
    )
    date = models.DateField()
    duty_type = models.ForeignKey(
        'organization.DepartmentDutyType',
        on_delete=models.CASCADE,
        related_name='overrides'
    )
    team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='roster_overrides'
    )
    context_override = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_CONTEXT_CHOICES,
        null=True, blank=True
    )
    role_override = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_ROLE_CHOICES,
        null=True, blank=True
    )
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    reason = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_roster_overrides'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_roster_overrides'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['plan', 'date', 'duty_type'],
                name='unique_roster_override_per_date'
            ),
        ]
        indexes = [
            models.Index(fields=['plan', 'date']),
            models.Index(fields=['plan', 'duty_type']),
        ]
        ordering = ['date', 'duty_type__display_order']
        verbose_name = 'Roster Override'
        verbose_name_plural = 'Roster Overrides'


class TeamRosterPlan(models.Model):
    """Optional detailed roster for teams linked to department plans."""
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('archived', 'Archived'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='team_roster_plans'
    )
    department_plan = models.ForeignKey(
        'organization.DepartmentRosterPlan',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='team_roster_plans'
    )
    name = models.CharField(max_length=160)
    effective_from = models.DateField()
    effective_until = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    version = models.PositiveSmallIntegerField(default=1)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_team_roster_plans'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_team_roster_plans'
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(version__gte=1),
                name='team_roster_version_positive'
            ),
        ]
        indexes = [
            models.Index(fields=['team', 'status']),
            models.Index(fields=['team', 'effective_from', 'effective_until']),
        ]
        ordering = ['-effective_from', '-version']
        verbose_name = 'Team Roster Plan'
        verbose_name_plural = 'Team Roster Plans'


class TeamRosterEntry(models.Model):
    """Granular team roster entries with station assignment."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='team_roster_entries'
    )
    date = models.DateField()
    duty_type = models.ForeignKey(
        'organization.DepartmentDutyType',
        on_delete=models.CASCADE,
        related_name='team_roster_entries'
    )
    station = models.ForeignKey(
        'organization.DepartmentStation',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='team_roster_entries'
    )
    practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.CASCADE,
        related_name='team_roster_entries'
    )
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_team_roster_entries'
    )

    class Meta:
        indexes = [
            models.Index(fields=['team', 'date']),
            models.Index(fields=['team', 'duty_type', 'date']),
            models.Index(fields=['practitioner', 'date']),
        ]
        ordering = ['date']
        verbose_name = 'Team Roster Entry'
        verbose_name_plural = 'Team Roster Entries'


# =============================================================================
# Duty Roster Models
# =============================================================================


class ShiftDefinition(models.Model):
    """
    Facility-configurable shift definitions.
    Examples: Day Shift (07:00-15:00), Evening Shift (15:00-23:00), Night Shift (23:00-07:00)
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='shift_definitions',
        help_text='Facility this shift belongs to'
    )

    name = models.CharField(max_length=100, help_text='Display name (e.g., "Day Shift")')
    code = models.CharField(max_length=50, help_text='Short code (e.g., "DAY", "EVE", "NIGHT")')
    start_time = models.TimeField()
    end_time = models.TimeField()
    crosses_midnight = models.BooleanField(
        default=False,
        help_text='True if shift ends after midnight (e.g., night shift 23:00-07:00)'
    )

    is_active = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_shift_definitions'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'code'],
                name='unique_shift_code_per_facility'
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'is_active']),
            models.Index(fields=['facility', 'display_order']),
        ]
        ordering = ['display_order', 'start_time']
        verbose_name = 'Shift Definition'
        verbose_name_plural = 'Shift Definitions'

    def __str__(self):
        return f'{self.name} ({self.start_time.strftime("%H:%M")}-{self.end_time.strftime("%H:%M")})'

    def clean(self):
        from django.core.exceptions import ValidationError
        # Auto-detect if shift crosses midnight
        if self.start_time and self.end_time:
            self.crosses_midnight = self.end_time < self.start_time

    def save(self, *args, **kwargs):
        # Auto-detect crosses_midnight on save
        if self.start_time and self.end_time:
            self.crosses_midnight = self.end_time < self.start_time
        super().save(*args, **kwargs)


class DutyRosterTemplate(models.Model):
    """
    Recurring duty patterns for automatic roster generation.
    Templates define which practitioner works which shift on which days of the week.
    """
    ROLE_CHOICES = DUTY_ROSTER_ROLE_CHOICES
    CONTEXT_CHOICES = DUTY_ROSTER_CONTEXT_CHOICES
    SENIORITY_CHOICES = DUTY_ROSTER_SENIORITY_CHOICES

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='duty_roster_templates',
    )
    unit = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='duty_roster_templates',
        help_text='Clinical unit this template applies to'
    )
    practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.CASCADE,
        related_name='duty_roster_templates',
    )

    # Schedule - either use shift definition OR custom times
    day_of_week = models.IntegerField(
        help_text='0=Monday, 6=Sunday'
    )
    shift = models.ForeignKey(
        'organization.ShiftDefinition',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='templates',
        help_text='Predefined shift (use this OR custom times)'
    )
    custom_start_time = models.TimeField(null=True, blank=True)
    custom_end_time = models.TimeField(null=True, blank=True)

    # Role and context
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='admitting')
    context = models.CharField(max_length=20, choices=CONTEXT_CHOICES, default='inpatient')
    seniority_level = models.CharField(max_length=20, choices=SENIORITY_CHOICES, default='attending')
    is_primary = models.BooleanField(
        default=False,
        help_text='Primary on-duty practitioner for this shift'
    )

    # Validity period
    effective_from = models.DateField()
    effective_until = models.DateField(null=True, blank=True)

    is_active = models.BooleanField(default=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_duty_roster_templates'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_duty_roster_templates'
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(shift__isnull=False, custom_start_time__isnull=True, custom_end_time__isnull=True) |
                    models.Q(shift__isnull=True, custom_start_time__isnull=False, custom_end_time__isnull=False)
                ),
                name='template_shift_or_custom_times'
            ),
        ]
        indexes = [
            models.Index(fields=['unit', 'is_active']),
            models.Index(fields=['practitioner', 'is_active']),
            models.Index(fields=['unit', 'day_of_week', 'is_active']),
            models.Index(fields=['facility', 'is_active', 'effective_from', 'effective_until']),
        ]
        ordering = ['unit', 'day_of_week']
        verbose_name = 'Duty Roster Template'
        verbose_name_plural = 'Duty Roster Templates'

    def __str__(self):
        day_name = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][self.day_of_week]
        return f'{self.practitioner} - {self.unit.name} - {day_name}'

    @property
    def start_time(self):
        return self.shift.start_time if self.shift else self.custom_start_time

    @property
    def end_time(self):
        return self.shift.end_time if self.shift else self.custom_end_time

    @property
    def is_currently_effective(self):
        today = timezone.now().date()
        if not self.is_active:
            return False
        if self.effective_from > today:
            return False
        if self.effective_until and self.effective_until < today:
            return False
        return True


class DutyRoster(models.Model):
    """
    Actual duty roster entries (generated from templates or manually created).
    This is the source of truth for "who's on duty when".
    """
    SOURCE_CHOICES = [
        ('template', 'Generated from Template'),
        ('manual', 'Manually Created'),
        ('swap', 'Duty Swap'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='duty_roster_entries',
    )
    unit = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.CASCADE,
        related_name='duty_roster_entries',
    )
    practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.CASCADE,
        related_name='duty_roster_entries',
    )

    # Schedule
    date = models.DateField()
    shift = models.ForeignKey(
        'organization.ShiftDefinition',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='roster_entries',
    )
    start_time = models.TimeField()
    end_time = models.TimeField()

    # Role and context (copied from template or set manually)
    role = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_ROLE_CHOICES,
        default='admitting'
    )
    context = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_CONTEXT_CHOICES,
        default='inpatient'
    )
    seniority_level = models.CharField(
        max_length=20,
        choices=DUTY_ROSTER_SENIORITY_CHOICES,
        default='attending'
    )
    is_primary = models.BooleanField(default=False)

    # Tracking
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='manual')
    template = models.ForeignKey(
        'organization.DutyRosterTemplate',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='generated_entries',
        help_text='Template this entry was generated from'
    )
    original_practitioner = models.ForeignKey(
        'users.PractitionerProfile',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='swapped_duty_entries',
        help_text='Original practitioner (for swaps)'
    )
    swap_reason = models.TextField(blank=True, help_text='Reason for the swap')
    notes = models.TextField(blank=True)

    is_active = models.BooleanField(default=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='created_duty_roster_entries'
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_duty_roster_entries'
    )

    class Meta:
        indexes = [
            # "Who's on duty now?" query
            models.Index(fields=['unit', 'date', 'start_time', 'end_time', 'is_active']),
            # "My schedule" query
            models.Index(fields=['practitioner', 'date', 'is_active']),
            # "Facility daily roster" query
            models.Index(fields=['facility', 'date', 'is_active']),
            # Role-based queries
            models.Index(fields=['unit', 'date', 'role', 'context', 'is_active']),
            # Primary on-duty lookup
            models.Index(fields=['unit', 'date', 'is_primary', 'is_active']),
            models.Index(fields=['unit', 'date', 'role', 'context', 'is_primary', 'is_active', 'start_time', 'end_time']),
        ]
        ordering = ['date', 'start_time', 'seniority_level']
        verbose_name = 'Duty Roster Entry'
        verbose_name_plural = 'Duty Roster Entries'

    def __str__(self):
        return f'{self.practitioner} - {self.unit.name} - {self.date}'

    @property
    def crosses_midnight(self):
        return self.end_time < self.start_time
