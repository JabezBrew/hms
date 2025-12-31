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
