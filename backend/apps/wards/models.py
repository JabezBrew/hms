import uuid
from django.core.exceptions import ObjectDoesNotExist
from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.postgres.indexes import GinIndex
from django.utils import timezone
from datetime import timedelta
from ..users.models import PatientProfile, PractitionerProfile


User = get_user_model()


# ============================================================================
# Ward Staff Assignment Models
# ============================================================================

class StaffRole(models.Model):
    """
    Configurable staff roles for ward assignments.

    Facilities can customize roles to match their organizational structure.
    Default roles include nursing and medical categories, but facilities
    can add custom roles like 'Charge Nurse', 'Unit Manager', etc.
    """
    CATEGORY_CHOICES = (
        ('nursing', 'Nursing'),
        ('medical', 'Medical'),
        ('allied', 'Allied Health'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=50, unique=True, help_text="Display name (e.g., 'Staff Nurse')")
    code = models.CharField(max_length=30, unique=True, help_text="Unique code (e.g., 'staff_nurse')")
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        default='nursing',
        help_text="Role category for filtering"
    )
    description = models.TextField(blank=True, help_text="Optional description of the role")
    is_active = models.BooleanField(default=True, help_text="Whether this role can be assigned")

    class Meta:
        ordering = ['category', 'name']
        verbose_name = 'Staff Role'
        verbose_name_plural = 'Staff Roles'

    def __str__(self):
        return self.name


class WardStaffAssignment(models.Model):
    """
    Tracks staff (nurses, doctors) assigned to work on specific wards.

    Supports many-to-many relationships - a practitioner can be assigned
    to multiple wards, and a ward can have multiple practitioners.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ward = models.ForeignKey(
        'Ward',
        on_delete=models.CASCADE,
        related_name='staff_assignments',
        help_text="Ward this staff member is assigned to"
    )
    practitioner = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.CASCADE,
        related_name='ward_assignments',
        help_text="Practitioner assigned to this ward"
    )
    role = models.ForeignKey(
        StaffRole,
        on_delete=models.PROTECT,
        related_name='assignments',
        help_text="Staff role on this ward"
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Whether currently assigned to this ward"
    )
    is_primary = models.BooleanField(
        default=False,
        help_text="Primary ward assignment for this staff member"
    )

    # Audit fields
    assigned_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    assigned_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='ward_assignments_made'
    )

    class Meta:
        unique_together = ('ward', 'practitioner')
        ordering = ['ward', 'role', 'practitioner']
        verbose_name = 'Ward Staff Assignment'
        verbose_name_plural = 'Ward Staff Assignments'
        indexes = [
            models.Index(fields=['ward', 'is_active']),
            models.Index(fields=['practitioner', 'is_active']),
            models.Index(fields=['role', 'is_active']),
        ]

    def __str__(self):
        practitioner_name = self.practitioner.staff.user.get_full_name() if self.practitioner.staff else 'Unknown'
        return f"{practitioner_name} - {self.ward.name} ({self.role.name})"


# ============================================================================
# Ward Models
# ============================================================================


class Ward(models.Model):
    """
    Model for hospital wards.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    # Department association (for multi-facility support)
    # Hierarchy: Facility → Department → Ward
    department = models.ForeignKey(
        'core.Department',
        on_delete=models.CASCADE,
        null=True,  # Nullable for backward compatibility during migration
        blank=True,
        related_name='wards',
        help_text="The department this ward belongs to"
    )

    # Ward type choices
    WARD_TYPE_CHOICES = (
        ('general', 'General Ward'),
        ('private', 'Private Ward'),
        ('icu', 'Intensive Care Unit'),
        ('emergency', 'Emergency Ward'),
        ('maternity', 'Maternity Ward'),
        ('pediatric', 'Pediatric Ward'),
        ('psychiatric', 'Psychiatric Ward'),
        ('isolation', 'Isolation Ward'),
    )
    ward_type = models.CharField(max_length=20, choices=WARD_TYPE_CHOICES)

    # Ward status
    is_active = models.BooleanField(default=True)

    # Capacity
    total_beds = models.PositiveIntegerField(default=0)

    # Charge per night
    base_rate_per_night = models.DecimalField(max_digits=10, decimal_places=2)

    # Staff in charge
    head_nurse = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='headed_wards'
    )

    # Section configuration
    uses_sections = models.BooleanField(
        default=False,
        help_text="If true, beds must be assigned to sections for better organization"
    )
    default_section = models.ForeignKey(
        'WardSection',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='default_for_wards',
        help_text="Default section for backward compatibility"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_wards')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_wards')

    def __str__(self):
        return f"{self.name} ({self.get_ward_type_display()})"

    @property
    def facility(self):
        """
        Get the facility this ward belongs to via its department.
        Convenience property for accessing facility through the hierarchy:
        Facility → Department → Ward
        """
        return self.department.facility if self.department else None

    @property
    def available_beds_count(self):
        """
        Calculate the number of available beds in the ward.
        """
        return self.beds.filter(status='available').count()

    @property
    def occupancy_rate(self):
        """
        Calculate the occupancy rate of the ward.
        """
        if self.total_beds == 0:
            return 0
        occupied_beds = self.beds.filter(status='occupied').count()
        return (occupied_beds / self.total_beds) * 100


class Bed(models.Model):
    """
    Model for beds in wards.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ward = models.ForeignKey(Ward, on_delete=models.CASCADE, related_name='beds')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='ward_beds',
        help_text="Facility context for this bed"
    )
    bed_number = models.CharField(max_length=20)

    # Bed type
    BED_TYPE_CHOICES = (
        ('standard', 'Standard Bed'),
        ('icu', 'ICU Bed'),
        ('pediatric', 'Pediatric Bed'),
        ('bariatric', 'Bariatric Bed'),
        ('maternity', 'Maternity Bed'),
    )
    bed_type = models.CharField(max_length=20, choices=BED_TYPE_CHOICES, default='standard')

    # Bed status
    STATUS_CHOICES = (
        ('available', 'Available'),
        ('occupied', 'Occupied'),
        ('reserved', 'Reserved'),
        ('maintenance', 'Under Maintenance'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')

    # Additional rate for special beds
    additional_rate = models.DecimalField(max_digits=10, decimal_places=2, default='0.00')

    # Location in ward
    location_x = models.PositiveSmallIntegerField(default=0, help_text="X coordinate for bed location")
    location_y = models.PositiveSmallIntegerField(default=0, help_text="Y coordinate for bed location")

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Section FK (nullable for backward compatibility)
    section = models.ForeignKey(
        'WardSection',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='beds',
        help_text="Section this bed belongs to (optional for backward compatibility)"
    )

    # Amenities M2M
    amenities = models.ManyToManyField(
        'BedAmenity',
        blank=True,
        related_name='beds',
        help_text="Amenities/features available with this bed"
    )

    # Isolation support
    is_isolation_capable = models.BooleanField(default=False, help_text="Can this bed handle isolation cases")
    has_negative_pressure = models.BooleanField(default=False, help_text="Has negative pressure for airborne isolation")

    ISOLATION_TYPE_CHOICES = (
        ('none', 'None'),
        ('contact', 'Contact Isolation'),
        ('airborne', 'Airborne Isolation'),
        ('droplet', 'Droplet Isolation'),
        ('protective', 'Protective Isolation'),
    )
    current_isolation_type = models.CharField(
        max_length=20,
        choices=ISOLATION_TYPE_CHOICES,
        default='none',
        help_text="Current isolation status of this bed"
    )

    # Accommodation tier override (if set, overrides section's tier)
    ACCOMMODATION_TIER_CHOICES = (
        ('open', 'Open Ward'),
        ('semi_private', 'Semi-Private'),
        ('private', 'Private'),
        ('vip', 'VIP'),
    )
    accommodation_tier = models.CharField(
        max_length=20,
        choices=ACCOMMODATION_TIER_CHOICES,
        null=True,
        blank=True,
        help_text="Override section accommodation tier if specified"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_beds')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_beds')

    class Meta:
        unique_together = ('ward', 'bed_number')
        ordering = ['ward', 'bed_number']
        indexes = [
            models.Index(fields=['ward', 'status']),
            models.Index(fields=['status']),
            models.Index(fields=['bed_type']),
            models.Index(fields=['section', 'status']),
            models.Index(fields=['accommodation_tier']),
            models.Index(fields=['current_isolation_type']),
            models.Index(fields=['is_isolation_capable']),
            models.Index(fields=['facility', 'status']),
        ]

    def __str__(self):
        return f"{self.ward.name} - Bed {self.bed_number} ({self.get_status_display()})"

    @property
    def total_rate(self):
        """
        Calculate the total rate for this bed per night including section multiplier and amenities.
        """
        from decimal import Decimal
        base = self.ward.base_rate_per_night
        if not isinstance(base, Decimal):
            base = Decimal(str(base))

        # Apply section multiplier if section exists
        if self.section:
            multiplier = self.section.rate_multiplier
            if not isinstance(multiplier, Decimal):
                multiplier = Decimal(str(multiplier))
            base = base * multiplier

        # Add bed-level additional rate (ensure Decimal type)
        additional = self.additional_rate if isinstance(self.additional_rate, Decimal) else Decimal(str(self.additional_rate))
        rate = base + additional

        # Add amenity costs
        amenity_cost = self.amenities.aggregate(
            total=models.Sum('additional_rate')
        )['total'] or Decimal('0')

        return rate + amenity_cost

    @property
    def effective_accommodation_tier(self):
        """
        Get accommodation tier (bed override or section default or 'open').
        """
        if self.accommodation_tier:
            return self.accommodation_tier
        if self.section:
            return self.section.accommodation_tier
        return 'open'

    @property
    def effective_gender_restriction(self):
        """
        Get gender restriction from section.
        """
        if self.section:
            return self.section.gender_restriction
        return 'mixed'


class Admission(models.Model):
    """
    Model for patient admissions to wards.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='admissions')
    bed = models.ForeignKey(Bed, on_delete=models.CASCADE, related_name='admissions', null=True, blank=True)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='admissions',
        help_text="Facility context for this admission"
    )

    # FHIR Encounter reference
    fhir_encounter_id = models.CharField(max_length=100, blank=True, null=True)

    # Admission details
    admission_date = models.DateTimeField(default=timezone.now)
    expected_discharge_date = models.DateTimeField(null=True, blank=True)
    actual_discharge_date = models.DateTimeField(null=True, blank=True)

    # Admission status
    STATUS_CHOICES = (
        ('admitted', 'Admitted'),
        ('pending_discharge', 'Pending Discharge'),
        ('discharged', 'Discharged'),
        ('transferred', 'Transferred'),
        ('deceased', 'Deceased'),
        ('waiting', 'Waiting List'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='admitted')

    # Admission type
    ADMISSION_TYPE_CHOICES = (
        ('emergency', 'Emergency'),
        ('elective', 'Elective'),
        ('maternity', 'Maternity'),
        ('newborn', 'Newborn'),
    )
    admission_type = models.CharField(max_length=20, choices=ADMISSION_TYPE_CHOICES, default='elective')

    # Admission notes
    admission_notes = models.TextField(blank=True, null=True)
    discharge_notes = models.TextField(blank=True, null=True)

    # Billing
    daily_rate = models.DecimalField(max_digits=10, decimal_places=2, help_text="Rate per day at time of admission", default=0.00)
    is_billed = models.BooleanField(default=False)

    # Staff
    admitting_doctor = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name='admissions_handled'
    )

    # Clinical Unit (Team) - for flexible organizational hierarchy
    # DEPRECATED: Use encounter.primary_team instead. Kept for backward compatibility.
    primary_team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='primary_admissions',
        help_text='DEPRECATED: Use encounter.primary_team instead. Kept for backward compatibility.'
    )
    # DEPRECATED: Use encounter.consulting_teams / EncounterCareTeam instead.
    consulting_teams = models.ManyToManyField(
        'organization.ClinicalUnit',
        through='CareTeamAssignment',
        related_name='consulting_admissions',
        blank=True,
        help_text='DEPRECATED: Use encounter.consulting_teams instead.'
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_admissions')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_admissions')

    class Meta:
        ordering = ['-admission_date']
        indexes = [
            models.Index(fields=['status'], name='wards_admis_status_single_idx'),  # Single column for dashboard filter
            models.Index(fields=['status', 'admission_date']),
            models.Index(fields=['bed', 'status']),
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['admission_date']),
            models.Index(fields=['fhir_encounter_id']),
            models.Index(fields=['primary_team', 'status']),  # For team-based filtering
            models.Index(fields=['facility', 'status', 'admission_date']),
        ]

    def __str__(self):
        bed_name = self.bed.ward.name if self.bed else "No Bed"
        return f"{self.patient.user.get_full_name()} - {bed_name} - {self.get_status_display()}"

    # SECURITY: Define valid status transitions to prevent manipulation
    VALID_STATUS_TRANSITIONS = {
        'waiting': ['admitted', 'cancelled'],
        'admitted': ['pending_discharge', 'discharged', 'transferred', 'deceased'],
        'pending_discharge': ['admitted', 'discharged'],
        'discharged': [],  # Terminal state
        'transferred': [],  # Terminal state
        'deceased': [],  # Terminal state
    }

    def save(self, *args, **kwargs):
        """
        Override save method to handle bed status changes and validate transitions.
        """
        # SECURITY: Validate status transitions on updates
        if self.pk and not self._state.adding:
            try:
                old_admission = Admission.objects.get(pk=self.pk)
                old_status = old_admission.status
                new_status = self.status

                if old_status != new_status:
                    valid_transitions = self.VALID_STATUS_TRANSITIONS.get(old_status, [])
                    if new_status not in valid_transitions:
                        from django.core.exceptions import ValidationError
                        raise ValidationError(
                            f"Invalid status transition from '{old_status}' to '{new_status}'."
                        )
            except Admission.DoesNotExist:
                pass  # New record, no validation needed

        # If this is a new admission, set the bed status to occupied
        if self._state.adding and self.status in {'admitted', 'pending_discharge'} and self.bed:
            self.bed.status = 'occupied'
            self.bed.save()

            # Set the daily rate to the bed's total rate
            self.daily_rate = self.bed.total_rate

        # If this is an update and the status changed to discharged
        elif self.pk and self.status == 'discharged' and self._state.adding is False:
            # Get the previous state
            old_admission = Admission.objects.get(pk=self.pk)
            if old_admission.status != 'discharged':
                # Set the actual discharge date if not already set
                if not self.actual_discharge_date:
                    self.actual_discharge_date = timezone.now()

                # Set the bed status to available
                self.bed.status = 'available'
                self.bed.save()

        super().save(*args, **kwargs)

    @property
    def effective_primary_team(self):
        """
        Get primary team from encounter (preferred) or admission (fallback).

        The source of truth for primary_team is now Encounter.primary_team.
        This property provides backward compatibility by checking the linked
        encounter first, then falling back to the admission's own primary_team.
        """
        if hasattr(self, 'encounter') and self.encounter and self.encounter.primary_team:
            return self.encounter.primary_team
        return self.primary_team

    @property
    def length_of_stay(self):
        """
        Calculate the length of stay in days.
        """
        end_date = self.actual_discharge_date or self.get_billing_end_time() or timezone.now()
        delta = end_date - self.admission_date
        return max(1, delta.days)  # Minimum 1 day

    @property
    def total_cost(self):
        """
        Calculate the total cost of the admission.
        """
        return self.daily_rate * self.length_of_stay

    def get_billing_end_time(self):
        if self.actual_discharge_date:
            return self.actual_discharge_date

        if self.status == 'pending_discharge':
            try:
                discharge_case = self.discharge_case
            except ObjectDoesNotExist:
                discharge_case = None
            if discharge_case and discharge_case.billing_cutoff_at:
                return discharge_case.billing_cutoff_at

        return timezone.now()

    def discharge_patient(self, discharge_notes=None, discharge_at=None):
        """
        Discharge the patient.
        """
        self.status = 'discharged'
        self.actual_discharge_date = discharge_at or timezone.now()
        if discharge_notes:
            self.discharge_notes = discharge_notes
        self.save()

        # Update bed status to available
        if self.bed:
            self.bed.status = 'available'
            self.bed.save()


class CareTeamAssignment(models.Model):
    """
    Consulting/co-managing teams for an admission.
    Primary team is stored on Admission.primary_team (not here).

    Note: 'primary' role is NOT included - that's on Admission.primary_team only.
    This avoids sync issues and enables fast primary-team filters.
    """
    ROLE_CHOICES = [
        ('consulting', 'Consulting'),
        ('co_managing', 'Co-Managing'),
        ('procedure', 'Procedure Team'),
    ]

    STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('accepted', 'Accepted'),
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('declined', 'Declined'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    admission = models.ForeignKey(
        Admission,
        on_delete=models.CASCADE,
        related_name='care_team_assignments'
    )
    team = models.ForeignKey(
        'organization.ClinicalUnit',
        on_delete=models.PROTECT,
        related_name='care_team_assignments'
    )

    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='consulting')

    # Consult workflow
    consult_reason = models.TextField(blank=True)
    consult_requested_at = models.DateTimeField(null=True, blank=True)
    consult_accepted_at = models.DateTimeField(null=True, blank=True)
    consult_completed_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='requested')

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_care_team_assignments'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['admission', 'team'],
                name='unique_admission_team'
            ),
        ]
        indexes = [
            models.Index(fields=['admission', 'status', 'is_active']),
            models.Index(fields=['team', 'status', 'is_active']),
        ]
        verbose_name = 'Care Team Assignment'
        verbose_name_plural = 'Care Team Assignments'

    def __str__(self):
        return f'{self.team.name} ({self.get_role_display()}) for {self.admission}'


class BedAllocationLog(models.Model):
    """
    Model to track bed allocation and status changes.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bed = models.ForeignKey(Bed, on_delete=models.CASCADE, related_name='allocation_logs')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='bed_allocation_logs',
        help_text="Facility context for this bed allocation log"
    )

    # Status change
    previous_status = models.CharField(max_length=20, choices=Bed.STATUS_CHOICES)
    new_status = models.CharField(max_length=20, choices=Bed.STATUS_CHOICES)

    # Related admission if applicable
    admission = models.ForeignKey(Admission, on_delete=models.SET_NULL, null=True, blank=True, related_name='bed_logs')

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Audit fields
    timestamp = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='bed_status_changes')

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['facility', '-timestamp']),
        ]

    def __str__(self):
        return f"{self.bed} - {self.previous_status} to {self.new_status} - {self.timestamp.strftime('%Y-%m-%d %H:%M')}"


# Encounter model has been moved to apps.encounters
# Re-export for backward compatibility
from apps.encounters.models import Encounter  # noqa: F401


class WardTransfer(models.Model):
    """
    Model to track patient transfers between wards.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='transfers')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='ward_transfers',
        help_text="Facility context for this ward transfer"
    )

    # Transfer details
    from_admission = models.ForeignKey(
        Admission, 
        on_delete=models.CASCADE, 
        related_name='transfers_from'
    )
    to_admission = models.ForeignKey(
        Admission, 
        on_delete=models.CASCADE, 
        related_name='transfers_to'
    )

    # Transfer reason
    reason = models.TextField()

    # Transfer time
    transfer_time = models.DateTimeField(default=timezone.now)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='initiated_transfers')

    class Meta:
        ordering = ['-transfer_time']
        indexes = [
            models.Index(fields=['facility', '-transfer_time']),
        ]

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.from_admission.bed.ward.name} to {self.to_admission.bed.ward.name}"

    def save(self, *args, **kwargs):
        """
        Override save method to handle admission status changes.
        """
        # Update the from_admission status to transferred
        if self.from_admission.status != 'transferred':
            self.from_admission.status = 'transferred'
            self.from_admission.actual_discharge_date = self.transfer_time
            self.from_admission.save()

        super().save(*args, **kwargs)


class BedAmenity(models.Model):
    """
    Model for tracking bed-level amenities/features.
    Examples: oxygen supply, cardiac monitoring, private bathroom, TV, etc.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True, help_text="Unique identifier code for the amenity")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    icon = models.CharField(max_length=50, blank=True, null=True, help_text="Icon name for frontend display (lucide-react)")

    # Categorization
    CATEGORY_CHOICES = (
        ('medical', 'Medical Equipment'),
        ('comfort', 'Comfort & Convenience'),
        ('accessibility', 'Accessibility'),
        ('safety', 'Safety'),
    )
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='medical')

    # Pricing impact
    additional_rate = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0.00,
        help_text="Additional charge per night for this amenity"
    )

    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "Bed Amenities"
        ordering = ['category', 'name']

    def __str__(self):
        return self.name


class WardSection(models.Model):
    """
    Model for sections within wards.
    Sections represent logical groupings like "Male Side", "Female Side", "VIP Wing", "Open Ward Area".
    Provides hierarchical organization: Ward → Section → Bed
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ward = models.ForeignKey(Ward, on_delete=models.CASCADE, related_name='sections')
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)

    # Display ordering
    display_order = models.PositiveSmallIntegerField(default=0, help_text="Order for display (lower numbers first)")

    # Gender restrictions
    GENDER_RESTRICTION_CHOICES = (
        ('male_only', 'Male Only'),
        ('female_only', 'Female Only'),
        ('mixed', 'Mixed'),
    )
    gender_restriction = models.CharField(
        max_length=20,
        choices=GENDER_RESTRICTION_CHOICES,
        default='mixed'
    )

    # Privacy/Accommodation tier
    ACCOMMODATION_TIER_CHOICES = (
        ('open', 'Open Ward (6+ beds)'),
        ('semi_private', 'Semi-Private (2-4 beds)'),
        ('private', 'Private (Single room)'),
        ('vip', 'VIP (Premium amenities)'),
    )
    accommodation_tier = models.CharField(
        max_length=20,
        choices=ACCOMMODATION_TIER_CHOICES,
        default='open'
    )

    # Pricing - rate multiplier applied to ward base rate
    rate_multiplier = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=1.00,
        help_text="Multiplier applied to ward base rate (e.g., 1.5 = 150%)"
    )

    # Isolation capabilities
    is_isolation_capable = models.BooleanField(default=False, help_text="Can this section handle isolation cases")
    has_negative_pressure = models.BooleanField(default=False, help_text="Has negative pressure rooms for airborne isolation")

    ISOLATION_TYPE_CHOICES = (
        ('none', 'None'),
        ('contact', 'Contact Isolation'),
        ('airborne', 'Airborne Isolation'),
        ('droplet', 'Droplet Isolation'),
        ('protective', 'Protective Isolation'),
    )
    default_isolation_type = models.CharField(
        max_length=20,
        choices=ISOLATION_TYPE_CHOICES,
        default='none',
        help_text="Default isolation type for this section"
    )

    # Capacity
    max_beds = models.PositiveSmallIntegerField(
        default=0,
        help_text="Maximum number of beds (0 = unlimited)"
    )

    is_active = models.BooleanField(default=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_sections')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_sections')

    class Meta:
        unique_together = ('ward', 'name')
        ordering = ['ward', 'display_order', 'name']
        indexes = [
            models.Index(fields=['ward', 'is_active']),
            models.Index(fields=['gender_restriction']),
            models.Index(fields=['accommodation_tier']),
        ]

    def __str__(self):
        return f"{self.ward.name} - {self.name}"

    @property
    def bed_count(self):
        """Get total number of beds in this section."""
        return self.beds.count()

    @property
    def available_beds_count(self):
        """Get number of available beds in this section."""
        return self.beds.filter(status='available').count()

    @property
    def occupancy_rate(self):
        """Calculate the occupancy rate of the section."""
        total = self.bed_count
        if total == 0:
            return 0
        occupied = self.beds.filter(status='occupied').count()
        return (occupied / total) * 100

    @property
    def effective_rate(self):
        """Calculate the effective base rate for this section (ward base rate * section multiplier)."""
        return self.ward.base_rate_per_night * self.rate_multiplier


class WardSearchIndex(models.Model):
    """
    Compact projection table for ward search lookups in omni-search.
    """
    ward = models.OneToOneField(
        Ward,
        on_delete=models.CASCADE,
        related_name='search_projection',
        primary_key=True,
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='ward_search_indexes',
    )
    search_document = models.TextField(blank=True)
    ward_type = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['facility', 'is_active'], name='ward_search_idx_fac_active_idx'),
            GinIndex(
                name='ward_search_idx_doc_trgm',
                fields=['search_document'],
                opclasses=['gin_trgm_ops'],
            ),
        ]

    def __str__(self):
        return f"Search index for ward {self.ward_id}"


class AdmissionSearchIndex(models.Model):
    """
    Compact projection table for admission search lookups in omni-search.
    """
    admission = models.OneToOneField(
        Admission,
        on_delete=models.CASCADE,
        related_name='search_projection',
        primary_key=True,
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.CASCADE,
        related_name='admission_search_indexes',
    )
    search_document = models.TextField(blank=True)
    status = models.CharField(max_length=20, blank=True)
    admission_date = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['facility', 'status'], name='adm_search_idx_fac_status_idx'),
            GinIndex(
                name='adm_search_idx_doc_trgm',
                fields=['search_document'],
                opclasses=['gin_trgm_ops'],
            ),
        ]

    def __str__(self):
        return f"Search index for admission {self.admission_id}"
