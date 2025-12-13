import uuid
from django.db import models
from django.contrib.auth import get_user_model
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
    def available_beds_count(self):
        """
        Calculate the number of available beds in the ward.
        """
        occupied_beds = self.beds.filter(status='occupied').count()
        return self.total_beds - occupied_beds

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

        # Apply section multiplier if section exists
        if self.section:
            base = base * self.section.rate_multiplier

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

    # FHIR Encounter reference
    fhir_encounter_id = models.CharField(max_length=100, blank=True, null=True)

    # Admission details
    admission_date = models.DateTimeField(default=timezone.now)
    expected_discharge_date = models.DateTimeField(null=True, blank=True)
    actual_discharge_date = models.DateTimeField(null=True, blank=True)

    # Admission status
    STATUS_CHOICES = (
        ('admitted', 'Admitted'),
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

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_admissions')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_admissions')

    class Meta:
        ordering = ['-admission_date']
        indexes = [
            models.Index(fields=['status', 'admission_date']),
            models.Index(fields=['bed', 'status']),
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['admission_date']),
            models.Index(fields=['fhir_encounter_id']),
        ]

    def __str__(self):
        bed_name = self.bed.ward.name if self.bed else "No Bed"
        return f"{self.patient.user.get_full_name()} - {bed_name} - {self.get_status_display()}"

    def save(self, *args, **kwargs):
        """
        Override save method to handle bed status changes.
        """
        # If this is a new admission, set the bed status to occupied
        if self._state.adding and self.status == 'admitted' and self.bed:
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
    def length_of_stay(self):
        """
        Calculate the length of stay in days.
        """
        end_date = self.actual_discharge_date or timezone.now()
        delta = end_date - self.admission_date
        return max(1, delta.days)  # Minimum 1 day

    @property
    def total_cost(self):
        """
        Calculate the total cost of the admission.
        """
        return self.daily_rate * self.length_of_stay

    def discharge_patient(self, discharge_notes=None):
        """
        Discharge the patient.
        """
        self.status = 'discharged'
        self.actual_discharge_date = timezone.now()
        if discharge_notes:
            self.discharge_notes = discharge_notes
        self.save()

        # Update bed status to available
        self.bed.status = 'available'
        self.bed.save()


class BedAllocationLog(models.Model):
    """
    Model to track bed allocation and status changes.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bed = models.ForeignKey(Bed, on_delete=models.CASCADE, related_name='allocation_logs')

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

    def __str__(self):
        return f"{self.bed} - {self.previous_status} to {self.new_status} - {self.timestamp.strftime('%Y-%m-%d %H:%M')}"


class Encounter(models.Model):
    """
    Local model for clinical encounters/visits.

    This replaces the FHIR-first approach with a local-first model that syncs to FHIR
    in the background. This provides fast queries while maintaining FHIR compliance.

    Encounter types:
    - inpatient: Hospital admission (linked to Admission model)
    - outpatient: Clinic visit, consultation
    - emergency: Emergency department visit
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Core relationships
    patient = models.ForeignKey(
        PatientProfile,
        on_delete=models.CASCADE,
        related_name='encounters'
    )
    practitioner = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='encounters'
    )

    # Encounter classification
    ENCOUNTER_TYPE_CHOICES = (
        ('inpatient', 'Inpatient'),
        ('outpatient', 'Outpatient'),
        ('emergency', 'Emergency'),
    )
    encounter_type = models.CharField(
        max_length=20,
        choices=ENCOUNTER_TYPE_CHOICES,
        default='outpatient'
    )

    # Encounter status lifecycle
    STATUS_CHOICES = (
        ('planned', 'Planned'),
        ('in-progress', 'In Progress'),
        ('finished', 'Finished'),
        ('cancelled', 'Cancelled'),
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='planned'
    )

    # Timing
    start_time = models.DateTimeField(default=timezone.now)
    end_time = models.DateTimeField(null=True, blank=True)

    # Clinical context
    reason = models.TextField(blank=True, null=True, help_text="Chief complaint or reason for visit")
    service_type = models.CharField(max_length=100, blank=True, null=True, help_text="Type of service (e.g., General Practice, Cardiology)")
    location = models.CharField(max_length=200, blank=True, null=True, help_text="Ward, clinic, or room")

    # Hospitalization details (for inpatient)
    admission_source = models.CharField(max_length=50, blank=True, null=True)
    discharge_disposition = models.CharField(max_length=50, blank=True, null=True)
    destination = models.CharField(max_length=200, blank=True, null=True)

    # Link to Admission (for inpatient encounters)
    admission = models.OneToOneField(
        'Admission',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='encounter'
    )

    # FHIR synchronization
    fhir_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        unique=True,
        help_text="FHIR Encounter resource ID"
    )
    fhir_synced = models.BooleanField(
        default=False,
        help_text="Whether this encounter has been synced to FHIR"
    )
    fhir_last_synced = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Last successful FHIR sync time"
    )
    fhir_sync_error = models.TextField(
        blank=True,
        null=True,
        help_text="Last FHIR sync error message"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_encounters'
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='updated_encounters'
    )

    class Meta:
        ordering = ['-start_time']
        indexes = [
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['practitioner', 'status']),
            models.Index(fields=['status', 'start_time']),
            models.Index(fields=['encounter_type', 'status']),
            models.Index(fields=['fhir_id']),
            models.Index(fields=['fhir_synced']),
            models.Index(fields=['start_time']),
        ]

    def __str__(self):
        patient_name = self.patient.user.get_full_name() if self.patient else "Unknown"
        return f"{patient_name} - {self.get_encounter_type_display()} ({self.get_status_display()}) - {self.start_time.strftime('%Y-%m-%d')}"

    @property
    def patient_name(self):
        """Get patient's full name."""
        if self.patient and self.patient.user:
            return self.patient.user.get_full_name() or "Unknown Patient"
        return "Unknown Patient"

    @property
    def practitioner_name(self):
        """Get practitioner's full name."""
        if self.practitioner and self.practitioner.staff and self.practitioner.staff.user:
            return self.practitioner.staff.user.get_full_name() or "Unknown Practitioner"
        return "Unknown Practitioner"

    @property
    def duration_minutes(self):
        """Calculate encounter duration in minutes."""
        if self.end_time:
            delta = self.end_time - self.start_time
            return int(delta.total_seconds() / 60)
        return None

    def finish(self, end_time=None, discharge_disposition=None, destination=None):
        """Mark the encounter as finished."""
        self.status = 'finished'
        self.end_time = end_time or timezone.now()
        if discharge_disposition:
            self.discharge_disposition = discharge_disposition
        if destination:
            self.destination = destination
        self.fhir_synced = False  # Mark for re-sync
        self.save()

    def cancel(self):
        """Cancel the encounter."""
        self.status = 'cancelled'
        self.end_time = timezone.now()
        self.fhir_synced = False  # Mark for re-sync
        self.save()


class WardTransfer(models.Model):
    """
    Model to track patient transfers between wards.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='transfers')

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
