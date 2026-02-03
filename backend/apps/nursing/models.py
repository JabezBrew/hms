import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.core.validators import MinValueValidator, MaxValueValidator
from ..users.models import PatientProfile, PractitionerProfile

User = get_user_model()


class VitalSigns(models.Model):
    """
    Model for recording patient vital signs.

    Optionally linked to an Encounter to group vitals by clinical visit.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='vital_signs')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='vital_sign_records',
        help_text="Facility context for this vital sign record"
    )
    recorded_by = models.ForeignKey(PractitionerProfile, on_delete=models.SET_NULL, null=True, related_name='recorded_vitals')

    # Link to encounter - required, groups vitals by clinical visit
    # The auto-encounter logic in views ensures this is always set
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.PROTECT,  # Prevent deletion of encounters with linked vitals
        null=False,
        blank=False,
        related_name='vital_signs',
        help_text="The clinical encounter/visit during which these vitals were recorded"
    )

    # Vital sign measurements
    temperature = models.DecimalField(
        max_digits=4,
        decimal_places=1,
        null=True,
        blank=True,
        validators=[MinValueValidator(35.0), MaxValueValidator(45.0)],
        help_text="Temperature in Celsius"
    )
    heart_rate = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(30), MaxValueValidator(250)],
        help_text="Heart rate in beats per minute"
    )
    blood_pressure_systolic = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(250)],
        help_text="Systolic blood pressure in mmHg"
    )
    blood_pressure_diastolic = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(30), MaxValueValidator(150)],
        help_text="Diastolic blood pressure in mmHg"
    )
    respiratory_rate = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(8), MaxValueValidator(60)],
        help_text="Respiratory rate per minute"
    )
    oxygen_saturation = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(50), MaxValueValidator(100)],
        help_text="Oxygen saturation percentage (SpO2)"
    )

    # Additional measurements
    pain_level = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
        help_text="Pain level on scale of 0-10"
    )

    # Timestamp and notes
    recorded_at = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True, null=True)

    # Alert flag for critical values
    is_critical = models.BooleanField(default=False)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-recorded_at']
        indexes = [
            models.Index(fields=['patient', '-recorded_at']),
            models.Index(fields=['is_critical', '-recorded_at']),
            models.Index(fields=['facility', '-recorded_at']),
        ]
        verbose_name = 'Vital Sign'
        verbose_name_plural = 'Vital Signs'

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.recorded_at.strftime('%Y-%m-%d %H:%M')}"

    @property
    def blood_pressure(self):
        """Return blood pressure in standard format."""
        if self.blood_pressure_systolic and self.blood_pressure_diastolic:
            return f"{self.blood_pressure_systolic}/{self.blood_pressure_diastolic}"
        return None

    def check_critical_values(self):
        """Check if any vital signs are in critical range."""
        critical = False

        if self.temperature:
            if self.temperature < 36.0 or self.temperature > 39.0:
                critical = True

        if self.heart_rate:
            if self.heart_rate < 50 or self.heart_rate > 120:
                critical = True

        if self.blood_pressure_systolic:
            if self.blood_pressure_systolic < 90 or self.blood_pressure_systolic > 180:
                critical = True

        if self.oxygen_saturation:
            if self.oxygen_saturation < 92:
                critical = True

        self.is_critical = critical
        return critical

    def save(self, *args, **kwargs):
        """Override save to check for critical values."""
        self.check_critical_values()
        super().save(*args, **kwargs)

        # Create alert if critical
        if self.is_critical:
            NursingAlert.objects.create(
                patient=self.patient,
                facility=self.facility,
                alert_type='vital_signs',
                severity='high',
                message=f"Critical vital signs recorded: {self.get_critical_values_message()}",
                related_vital_signs=self
            )

    def get_critical_values_message(self):
        """Get message describing critical values."""
        messages = []

        if self.temperature and (self.temperature < 36.0 or self.temperature > 39.0):
            messages.append(f"Temp: {self.temperature}°C")

        if self.heart_rate and (self.heart_rate < 50 or self.heart_rate > 120):
            messages.append(f"HR: {self.heart_rate} bpm")

        if self.blood_pressure_systolic and (self.blood_pressure_systolic < 90 or self.blood_pressure_systolic > 180):
            messages.append(f"BP: {self.blood_pressure}")

        if self.oxygen_saturation and self.oxygen_saturation < 92:
            messages.append(f"SpO2: {self.oxygen_saturation}%")

        return ", ".join(messages)


class NursingTask(models.Model):
    """
    Model for nursing tasks and care activities.
    """
    TASK_TYPE_CHOICES = (
        ('medication', 'Medication Administration'),
        ('assessment', 'Patient Assessment'),
        ('vitals', 'Vital Signs Monitoring'),
        ('wound_care', 'Wound Care'),
        ('hygiene', 'Hygiene Care'),
        ('nutrition', 'Nutrition/Feeding'),
        ('mobility', 'Mobility Assistance'),
        ('documentation', 'Documentation'),
        ('other', 'Other'),
    )

    PRIORITY_CHOICES = (
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    )

    STATUS_CHOICES = (
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
        ('overdue', 'Overdue'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='nursing_tasks')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='nursing_tasks',
        help_text="Facility context for this nursing task"
    )
    task_type = models.CharField(max_length=20, choices=TASK_TYPE_CHOICES)
    description = models.TextField()

    # Scheduling
    scheduled_time = models.DateTimeField()
    completed_time = models.DateTimeField(null=True, blank=True)

    # Assignment and priority
    assigned_to = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_tasks'
    )
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='medium')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    # Completion details
    completed_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_tasks'
    )
    completion_notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_nursing_tasks')

    class Meta:
        ordering = ['scheduled_time', '-priority']
        indexes = [
            models.Index(fields=['patient', 'status', 'scheduled_time']),
            models.Index(fields=['assigned_to', 'status']),
            models.Index(fields=['priority', 'scheduled_time']),
            models.Index(fields=['facility', 'status', 'scheduled_time']),
        ]

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.get_task_type_display()} - {self.scheduled_time.strftime('%Y-%m-%d %H:%M')}"

    def save(self, *args, **kwargs):
        """Override save to update status based on time."""
        if not self.facility_id and self.patient_id:
            self.facility = self.patient.facility
        if self.status == 'pending' and self.scheduled_time < timezone.now():
            self.status = 'overdue'

        super().save(*args, **kwargs)


class NursingAlert(models.Model):
    """
    Model for nursing alerts and notifications.
    """
    ALERT_TYPE_CHOICES = (
        ('vital_signs', 'Critical Vital Signs'),
        ('medication', 'Medication Due'),
        ('task_overdue', 'Task Overdue'),
        ('patient_fall', 'Patient Fall Risk'),
        ('deterioration', 'Patient Deterioration'),
        ('equipment', 'Equipment Issue'),
        ('other', 'Other'),
    )

    SEVERITY_CHOICES = (
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='nursing_alerts')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='nursing_alerts',
        help_text="Facility context for this nursing alert"
    )
    alert_type = models.CharField(max_length=20, choices=ALERT_TYPE_CHOICES)
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES)
    message = models.TextField()

    # References
    related_vital_signs = models.ForeignKey(
        VitalSigns,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='alerts'
    )
    related_task = models.ForeignKey(
        NursingTask,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='alerts'
    )

    # Acknowledgment
    is_acknowledged = models.BooleanField(default=False)
    acknowledged_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='acknowledged_alerts'
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    resolution_notes = models.TextField(blank=True, null=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['patient', 'is_acknowledged', '-created_at']),
            models.Index(fields=['severity', 'is_acknowledged']),
            models.Index(fields=['alert_type', '-created_at']),
            models.Index(fields=['facility', 'is_acknowledged', '-created_at']),
        ]

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.get_alert_type_display()} - {self.get_severity_display()}"

    def acknowledge(self, practitioner, notes=None):
        """Acknowledge the alert."""
        self.is_acknowledged = True
        self.acknowledged_by = practitioner
        self.acknowledged_at = timezone.now()
        if notes:
            self.resolution_notes = notes
        self.save()


class MedicationAdministration(models.Model):
    """
    Model for tracking medication administration (MAR - Medication Administration Record).
    """
    STATUS_CHOICES = (
        ('scheduled', 'Scheduled'),
        ('administered', 'Administered'),
        ('missed', 'Missed'),
        ('refused', 'Refused by Patient'),
        ('held', 'Held'),
        ('cancelled', 'Cancelled'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='medication_administrations')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='medication_administrations',
        help_text="Facility context for this medication administration"
    )

    # Medication details
    medication_name = models.CharField(max_length=200)
    dosage = models.CharField(max_length=100)
    route = models.CharField(max_length=50, help_text="e.g., Oral, IV, IM, SC")
    frequency = models.CharField(max_length=100, help_text="e.g., Once daily, TID, PRN")

    # Scheduling
    scheduled_time = models.DateTimeField()
    administered_time = models.DateTimeField(null=True, blank=True)

    # Administration details
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled')
    administered_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='administered_medications'
    )

    # Notes and reason
    administration_notes = models.TextField(blank=True, null=True)
    reason_not_given = models.TextField(blank=True, null=True, help_text="Required if status is missed, refused, or held")

    # Prescriber information
    prescribed_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name='prescribed_medications'
    )

    # Link to prescription (optional for backwards compatibility)
    prescription = models.ForeignKey(
        'clinical_notes.Prescription',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='mar_entries'
    )

    # Link to treatment sheet entry (for inpatient medication tracking)
    treatment_entry = models.ForeignKey(
        'TreatmentSheetEntry',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='dose_administrations',
        help_text="Parent treatment sheet entry for inpatient medications"
    )

    # Dispensing status (for pharmacy workflow)
    is_dispensed = models.BooleanField(default=False)
    dispensed_at = models.DateTimeField(null=True, blank=True)
    dispensed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dispensed_medications'
    )

    # Inventory integration (Phase 2: Clinical Integration)
    inventory_item = models.ForeignKey(
        'inventory.InventoryItem',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='medication_administrations',
        help_text="Linked inventory item for this medication"
    )
    batch_used = models.ForeignKey(
        'inventory.ExpiryTracker',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='medication_administrations',
        help_text="Batch/lot used for this administration (FEFO tracking)"
    )
    dispensing_location = models.ForeignKey(
        'inventory.StorageLocation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dispensed_medications',
        help_text="Location from which medication was dispensed"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_med_administrations')

    class Meta:
        ordering = ['scheduled_time']
        indexes = [
            models.Index(fields=['patient', 'scheduled_time', 'status']),
            models.Index(fields=['patient', 'status', 'scheduled_time'], name='nursing_med_patient_status_idx'),  # For dashboard prefetch
            models.Index(fields=['status', 'scheduled_time']),
            models.Index(fields=['administered_by', 'administered_time']),
            models.Index(fields=['facility', 'status', 'scheduled_time']),
        ]

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.medication_name} - {self.scheduled_time.strftime('%Y-%m-%d %H:%M')}"

    def save(self, *args, **kwargs):
        """Override save to create alerts for overdue medications."""
        super().save(*args, **kwargs)

        # Create alert if medication is overdue by more than 30 minutes
        if self.status == 'scheduled':
            time_diff = timezone.now() - self.scheduled_time
            if time_diff.total_seconds() > 1800:  # 30 minutes
                NursingAlert.objects.get_or_create(
                    patient=self.patient,
                    facility=self.facility,
                    alert_type='medication',
                    defaults={
                        'severity': 'medium',
                        'message': f"Medication overdue: {self.medication_name} scheduled at {self.scheduled_time.strftime('%H:%M')}"
                    }
                )


class ShiftHandoff(models.Model):
    """
    Model for nursing shift handoff reports.
    """
    SHIFT_TYPE_CHOICES = (
        ('day', 'Day Shift'),
        ('evening', 'Evening Shift'),
        ('night', 'Night Shift'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='shift_handoffs')
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='shift_handoffs',
        help_text="Facility context for this shift handoff"
    )

    # Shift details
    shift_date = models.DateField(default=timezone.now)
    shift_type = models.CharField(max_length=10, choices=SHIFT_TYPE_CHOICES)
    from_nurse = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name='handoffs_given'
    )
    to_nurse = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name='handoffs_received'
    )

    # Patient status summary
    patient_condition = models.TextField(help_text="Current patient condition and status")
    ongoing_issues = models.TextField(blank=True, null=True, help_text="Ongoing concerns or issues")
    pending_tasks = models.TextField(blank=True, null=True, help_text="Tasks pending for next shift")
    medication_changes = models.TextField(blank=True, null=True, help_text="Recent medication changes")

    # Key events during shift
    key_events = models.TextField(blank=True, null=True, help_text="Significant events during the shift")

    # Care plan updates
    care_plan_updates = models.TextField(blank=True, null=True)

    # Family communication
    family_updates = models.TextField(blank=True, null=True, help_text="Communication with family members")

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_handoffs')

    class Meta:
        ordering = ['-shift_date', '-created_at']
        indexes = [
            models.Index(fields=['patient', '-shift_date']),
            models.Index(fields=['shift_date', 'shift_type']),
            models.Index(fields=['from_nurse', 'to_nurse']),
            models.Index(fields=['facility', '-shift_date']),
        ]

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.get_shift_type_display()} - {self.shift_date}"


class TreatmentSheetEntry(models.Model):
    """
    Ongoing medication order for inpatients (parent of MAR doses).

    Represents a continuous medication order on the treatment sheet.
    Links to individual MedicationAdministration entries (doses).
    Used for tracking overall supply and medication lifecycle.
    """
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('discontinued', 'Discontinued'),
        ('on_hold', 'On Hold')
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(
        PatientProfile,
        on_delete=models.CASCADE,
        related_name='treatment_sheet_entries'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='treatment_sheet_entries',
        help_text="Facility context for this treatment sheet entry"
    )
    admission = models.ForeignKey(
        'wards.Admission',
        on_delete=models.CASCADE,
        related_name='treatment_entries'
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.PROTECT,
        help_text="The clinical encounter during which this was ordered"
    )

    # Medication details (denormalized for quick access)
    medication_name = models.CharField(max_length=255)
    dosage = models.CharField(max_length=100)
    route = models.CharField(max_length=50)
    frequency = models.CharField(max_length=100)

    # Temporal scope
    start_datetime = models.DateTimeField()
    duration_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Duration in days. Null means until discontinued."
    )
    end_datetime = models.DateTimeField(null=True, blank=True)

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    # Ordering practitioner
    ordered_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.CASCADE,
        related_name='treatment_orders'
    )

    # Supply tracking (aggregate counts)
    total_doses_ordered = models.PositiveIntegerField(
        default=0,
        help_text="Total number of doses generated in MAR"
    )
    total_doses_dispensed = models.PositiveIntegerField(
        default=0,
        help_text="Total doses dispensed by pharmacy"
    )
    total_doses_administered = models.PositiveIntegerField(
        default=0,
        help_text="Total doses actually administered to patient"
    )

    # Link to inventory item (for stock tracking)
    inventory_item = models.ForeignKey(
        'inventory.InventoryItem',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='treatment_entries',
        help_text="Linked inventory item for stock depletion on dispense"
    )

    # Link to source prescription (optional)
    prescription = models.ForeignKey(
        'clinical_notes.Prescription',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='treatment_entries'
    )

    # Discontinuation tracking
    discontinued_at = models.DateTimeField(null=True, blank=True)
    discontinued_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='discontinued_orders'
    )
    discontinuation_reason = models.TextField(blank=True)

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_treatment_entries'
    )

    class Meta:
        ordering = ['-start_datetime']
        indexes = [
            models.Index(fields=['admission', 'status']),
            models.Index(fields=['patient', 'status', '-start_datetime']),
            models.Index(fields=['status', '-start_datetime']),
            models.Index(fields=['facility', 'status', '-start_datetime']),
        ]
        verbose_name = 'Treatment Sheet Entry'
        verbose_name_plural = 'Treatment Sheet Entries'

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.medication_name} - {self.status}"

    @property
    def supply_remaining(self):
        """Calculate remaining supply (dispensed but not yet administered)."""
        return self.total_doses_dispensed - self.total_doses_administered

    @property
    def days_of_supply_remaining(self):
        """Estimate days of supply remaining based on frequency."""
        if self.supply_remaining <= 0:
            return 0

        # Parse frequency to estimate daily doses
        frequency_lower = self.frequency.lower()
        daily_doses = 1

        if 'bid' in frequency_lower or 'twice' in frequency_lower:
            daily_doses = 2
        elif 'tid' in frequency_lower or 'three' in frequency_lower:
            daily_doses = 3
        elif 'qid' in frequency_lower or 'four' in frequency_lower:
            daily_doses = 4
        elif 'q4h' in frequency_lower:
            daily_doses = 6
        elif 'q6h' in frequency_lower:
            daily_doses = 4
        elif 'q8h' in frequency_lower:
            daily_doses = 3
        elif 'q12h' in frequency_lower:
            daily_doses = 2

        if daily_doses > 0:
            return self.supply_remaining / daily_doses
        return 0


class SupplyRequest(models.Model):
    """
    Nurse request for medication supply from pharmacy.

    Represents a request for bulk supply of medication (multiple doses)
    for a treatment sheet entry. Pharmacy fulfills these requests.
    """
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('dispensed', 'Dispensed'),
        ('rejected', 'Rejected')
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    treatment_entry = models.ForeignKey(
        TreatmentSheetEntry,
        on_delete=models.CASCADE,
        related_name='supply_requests'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='supply_requests',
        help_text="Facility context for this supply request"
    )

    # Request details
    quantity_requested = models.PositiveIntegerField(
        help_text="Number of doses requested"
    )
    quantity_dispensed = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Actual quantity dispensed (may differ from requested)"
    )

    # Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    # Request tracking
    requested_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.CASCADE,
        related_name='supply_requests'
    )
    requested_at = models.DateTimeField(auto_now_add=True)

    # Dispensing tracking
    dispensed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dispensed_supplies'
    )
    dispensed_at = models.DateTimeField(null=True, blank=True)

    # Rejection handling
    rejection_reason = models.TextField(blank=True)

    # Additional notes
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-requested_at']
        indexes = [
            models.Index(fields=['status', '-requested_at']),
            models.Index(fields=['treatment_entry', '-requested_at']),
            models.Index(fields=['requested_by', 'status']),
            models.Index(fields=['facility', 'status', '-requested_at']),
        ]
        verbose_name = 'Supply Request'
        verbose_name_plural = 'Supply Requests'

    def __str__(self):
        return f"{self.treatment_entry.medication_name} - {self.quantity_requested} doses - {self.status}"


class FluidBalance(models.Model):
    """
    Model for tracking patient fluid intake and output.

    Used by nurses to monitor fluid balance for inpatients.
    Tracks both intake (oral, IV, enteral, blood products) and
    output (urine, vomit, stool, drain, N.G. suction).
    Output entries can include colour descriptions for clinical assessment.
    """
    ENTRY_TYPE_CHOICES = (
        ('intake', 'Intake'),
        ('output', 'Output'),
    )

    # Intake categories
    INTAKE_CATEGORY_CHOICES = (
        ('oral', 'Oral'),
        ('iv', 'IV Fluids'),
        ('enteral', 'Enteral Feed'),
        ('blood', 'Blood Products'),
    )

    # Output categories
    OUTPUT_CATEGORY_CHOICES = (
        ('urine', 'Urine'),
        ('vomit', 'Vomit'),
        ('stool', 'Stool'),
        ('drain', 'Drain'),
        ('ng_suction', 'N.G. Suction'),
        ('other', 'Other'),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(
        PatientProfile,
        on_delete=models.CASCADE,
        related_name='fluid_balance_records'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='fluid_balance_entries',
        help_text="Facility context for this fluid balance entry"
    )
    admission = models.ForeignKey(
        'wards.Admission',
        on_delete=models.CASCADE,
        related_name='fluid_balance_records',
        null=True,
        blank=True,
        help_text="Admission for inpatient tracking. Null for outpatient."
    )

    # Entry type and category
    entry_type = models.CharField(max_length=10, choices=ENTRY_TYPE_CHOICES)
    category = models.CharField(
        max_length=20,
        help_text="Category based on entry type (oral/iv/etc for intake, urine/vomit/etc for output)"
    )
    subcategory = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Optional subcategory, e.g., Water, Normal Saline, Foley, JP Drain"
    )

    # Volume
    volume_ml = models.PositiveIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10000)],
        help_text="Volume in milliliters"
    )

    # Recording details
    recorded_at = models.DateTimeField(default=timezone.now)
    recorded_by = models.ForeignKey(
        PractitionerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name='recorded_fluid_entries'
    )

    # Notes
    notes = models.TextField(blank=True, null=True)

    # Colour (for output entries - urine, stool, vomit, drain, ng_suction, etc.)
    colour = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Colour description for output entries (e.g., 'dark amber', 'clear', 'bloody')"
    )

    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_fluid_balance_entries'
    )
    modified_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='modified_fluid_balance_entries',
        help_text="User who last modified this entry"
    )

    # Soft delete support
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='deleted_fluid_balance_entries',
        help_text="User who deleted this entry"
    )
    deletion_reason = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ['-recorded_at']
        indexes = [
            models.Index(fields=['patient', '-recorded_at']),
            models.Index(fields=['patient', 'entry_type', '-recorded_at']),
            models.Index(fields=['admission', '-recorded_at']),
            models.Index(fields=['is_deleted', '-recorded_at']),
            models.Index(fields=['facility', 'entry_type', '-recorded_at']),
        ]
        verbose_name = 'Fluid Balance Entry'
        verbose_name_plural = 'Fluid Balance Entries'

    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.entry_type} - {self.volume_ml}ml - {self.recorded_at.strftime('%Y-%m-%d %H:%M')}"

    def clean(self):
        """Validate category matches entry type."""
        from django.core.exceptions import ValidationError

        valid_intake_categories = [c[0] for c in self.INTAKE_CATEGORY_CHOICES]
        valid_output_categories = [c[0] for c in self.OUTPUT_CATEGORY_CHOICES]

        if self.entry_type == 'intake' and self.category not in valid_intake_categories:
            raise ValidationError({
                'category': f"For intake, category must be one of: {', '.join(valid_intake_categories)}"
            })

        if self.entry_type == 'output' and self.category not in valid_output_categories:
            raise ValidationError({
                'category': f"For output, category must be one of: {', '.join(valid_output_categories)}"
            })
