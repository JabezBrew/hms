import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class LabTestCatalog(models.Model):
    """
    Catalog of available lab tests with LOINC codes and reference ranges.
    Represents the test menu available for ordering.

    Supports facility customization:
    - System defaults are seeded with is_system_default=True
    - Facilities can modify prices, reference ranges, TAT
    - Original system values are preserved in system_defaults JSON
    - Custom facility tests have is_system_default=False
    """
    CATEGORY_CHOICES = [
        ('hematology', 'Hematology'),
        ('chemistry', 'Chemistry'),
        ('microbiology', 'Microbiology'),
        ('immunology', 'Immunology'),
        ('urinalysis', 'Urinalysis'),
        ('coagulation', 'Coagulation'),
        ('serology', 'Serology'),
        ('molecular', 'Molecular/PCR'),
        ('pathology', 'Pathology'),
        ('toxicology', 'Toxicology'),
        ('endocrine', 'Endocrine'),
        ('cardiac', 'Cardiac Markers'),
        ('other', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='lab_tests',
        help_text="Facility that owns this test catalog entry"
    )
    code = models.CharField(
        max_length=20,
        help_text="Internal test code (e.g., 'CBC', 'BMP')"
    )

    # Facility customization tracking
    is_system_default = models.BooleanField(
        default=False,
        help_text="True if this test was seeded from the system catalog"
    )
    is_facility_modified = models.BooleanField(
        default=False,
        help_text="True if facility has customized this system test"
    )
    system_defaults = models.JSONField(
        default=dict,
        blank=True,
        help_text="Original system values (price, reference_ranges, tat_hours) for reset capability"
    )
    loinc_code = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        help_text="LOINC standard code for interoperability"
    )
    name = models.CharField(
        max_length=255,
        help_text="Full test name (e.g., 'Complete Blood Count')"
    )
    short_name = models.CharField(
        max_length=50,
        help_text="Abbreviated name (e.g., 'CBC')"
    )
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES)
    description = models.TextField(blank=True)

    # Specimen requirements
    specimen_type = models.CharField(
        max_length=50,
        help_text="Required specimen type (e.g., 'Whole Blood', 'Serum', 'Urine')"
    )
    container_type = models.CharField(
        max_length=50,
        help_text="Container/tube type (e.g., 'Lavender Top', 'Red Top', 'Sterile Cup')"
    )
    volume_required = models.CharField(
        max_length=50,
        blank=True,
        help_text="Minimum volume needed (e.g., '5 mL', '2-3 mL')"
    )
    special_instructions = models.TextField(
        blank=True,
        help_text="Special handling or collection instructions"
    )

    # Reference ranges (JSON format for flexibility)
    reference_ranges = models.JSONField(
        default=dict,
        help_text='Reference ranges by population (e.g., {"adult_male": {"low": 4.5, "high": 5.5, "unit": "million/uL"}})'
    )
    unit = models.CharField(
        max_length=30,
        help_text="Unit of measurement"
    )

    # Operations
    tat_hours = models.PositiveIntegerField(
        help_text="Expected turnaround time in hours"
    )
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Test price"
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Whether test is currently available for ordering"
    )

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Lab Test'
        verbose_name_plural = 'Lab Test Catalog'
        ordering = ['category', 'short_name']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'code'], name='lab_test_facility_code_uniq'),
        ]
        indexes = [
            models.Index(fields=['facility', 'code']),
            models.Index(fields=['facility', 'is_active']),
            models.Index(fields=['loinc_code']),
            models.Index(fields=['name']),  # Added for search optimization
            models.Index(fields=['category', 'is_active']),
        ]

    def __str__(self):
        return f"{self.short_name} - {self.name}"

    def reset_to_system_defaults(self):
        """Reset facility-customized values back to system defaults."""
        if not self.is_system_default or not self.system_defaults:
            return False

        if 'price' in self.system_defaults:
            self.price = self.system_defaults['price']
        if 'reference_ranges' in self.system_defaults:
            self.reference_ranges = self.system_defaults['reference_ranges']
        if 'tat_hours' in self.system_defaults:
            self.tat_hours = self.system_defaults['tat_hours']

        self.is_facility_modified = False
        self.save()
        return True


class LabPanel(models.Model):
    """
    Groupings of lab tests (e.g., CBC, BMP, LFT panels).
    Allows ordering multiple related tests as a bundle.

    Supports facility customization similar to LabTestCatalog.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='lab_panels',
        help_text="Facility that owns this lab panel"
    )
    code = models.CharField(
        max_length=20,
        help_text="Panel code (e.g., 'CMP', 'LFT')"
    )

    # Facility customization tracking
    is_system_default = models.BooleanField(
        default=False,
        help_text="True if this panel was seeded from the system catalog"
    )
    is_facility_modified = models.BooleanField(
        default=False,
        help_text="True if facility has customized this system panel"
    )
    system_defaults = models.JSONField(
        default=dict,
        blank=True,
        help_text="Original system values (price) for reset capability"
    )
    name = models.CharField(
        max_length=255,
        help_text="Panel name (e.g., 'Comprehensive Metabolic Panel')"
    )
    description = models.TextField(blank=True)
    tests = models.ManyToManyField(
        LabTestCatalog,
        related_name='panels',
        help_text="Tests included in this panel"
    )
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Panel price (usually discounted vs individual tests)"
    )
    is_active = models.BooleanField(default=True)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Lab Panel'
        verbose_name_plural = 'Lab Panels'
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'code'], name='lab_panel_facility_code_uniq'),
        ]
        indexes = [
            models.Index(fields=['facility', 'code']),
            models.Index(fields=['facility', 'is_active']),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def reset_to_system_defaults(self):
        """Reset facility-customized values back to system defaults."""
        if not self.is_system_default or not self.system_defaults:
            return False

        if 'price' in self.system_defaults:
            self.price = self.system_defaults['price']

        self.is_facility_modified = False
        self.save()
        return True


class LabOrderStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    ORDERED = 'ordered', 'Ordered'
    COLLECTED = 'collected', 'Specimen Collected'
    RECEIVED = 'received', 'Received in Lab'
    PROCESSING = 'processing', 'Processing'
    COMPLETED = 'completed', 'Completed'
    CANCELLED = 'cancelled', 'Cancelled'


class LabOrderPriority(models.TextChoices):
    ROUTINE = 'routine', 'Routine'
    URGENT = 'urgent', 'Urgent'
    STAT = 'stat', 'STAT'


class LabOrder(models.Model):
    """
    Lab order placed by a clinician.
    Tracks the complete lifecycle from order to result.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_number = models.CharField(
        max_length=20,
        unique=True,
        help_text="Unique order identifier (auto-generated)"
    )
    patient = models.ForeignKey(
        'users.PatientProfile',
        on_delete=models.CASCADE,
        related_name='lab_orders'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='lab_orders',
        help_text="Facility context for this lab order"
    )
    encounter = models.ForeignKey(
        'encounters.Encounter',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='lab_orders'
    )
    ordering_provider = models.ForeignKey(
        'users.PractitionerProfile',
        on_delete=models.CASCADE,
        related_name='ordered_labs'
    )

    # Tests and panels
    tests = models.ManyToManyField(
        LabTestCatalog,
        through='LabOrderTest',
        related_name='orders'
    )
    panels = models.ManyToManyField(
        LabPanel,
        blank=True,
        related_name='orders'
    )

    # Order details
    priority = models.CharField(
        max_length=20,
        choices=LabOrderPriority.choices,
        default=LabOrderPriority.ROUTINE
    )
    status = models.CharField(
        max_length=20,
        choices=LabOrderStatus.choices,
        default=LabOrderStatus.DRAFT
    )
    clinical_notes = models.TextField(
        blank=True,
        help_text="Clinical indication or notes for lab"
    )
    fasting_required = models.BooleanField(
        default=False,
        help_text="Whether patient must be fasting"
    )

    # Timestamps for status transitions
    ordered_at = models.DateTimeField(null=True, blank=True)
    collected_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)

    # FHIR sync
    fhir_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        unique=True,
        help_text="FHIR ServiceRequest resource ID"
    )
    fhir_synced = models.BooleanField(default=False)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Lab Order'
        verbose_name_plural = 'Lab Orders'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['patient', 'status']),
            models.Index(fields=['order_number']),
            models.Index(fields=['status', 'priority']),
            models.Index(fields=['ordered_at']),
            models.Index(fields=['facility', 'status', 'ordered_at']),
        ]

    def __str__(self):
        return f"Lab Order {self.order_number} - {self.patient.user.get_full_name()}"

    def save(self, *args, **kwargs):
        """Generate order number if not set."""
        if not self.order_number:
            # Generate order number: LAB-YYYYMMDD-####
            from django.db.models import Max
            today = timezone.now().strftime('%Y%m%d')
            prefix = f"LAB-{today}"
            last_order = LabOrder.objects.filter(order_number__startswith=prefix).aggregate(
                Max('order_number')
            )
            if last_order['order_number__max']:
                last_num = int(last_order['order_number__max'].split('-')[-1])
                self.order_number = f"{prefix}-{last_num + 1:04d}"
            else:
                self.order_number = f"{prefix}-0001"
        super().save(*args, **kwargs)


class LabOrderTest(models.Model):
    """
    Through model for LabOrder and LabTestCatalog relationship.
    Tracks individual test status within an order.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(
        LabOrder,
        on_delete=models.CASCADE,
        related_name='order_tests'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='lab_order_tests',
        help_text="Facility context for this lab order test"
    )
    test = models.ForeignKey(
        LabTestCatalog,
        on_delete=models.CASCADE,
        related_name='order_tests'
    )
    status = models.CharField(
        max_length=20,
        choices=LabOrderStatus.choices,
        default=LabOrderStatus.ORDERED
    )
    notes = models.TextField(blank=True)

    class Meta:
        verbose_name = 'Lab Order Test'
        verbose_name_plural = 'Lab Order Tests'
        unique_together = ['order', 'test']
        indexes = [
            models.Index(fields=['facility', 'status']),
        ]

    def __str__(self):
        return f"{self.order.order_number} - {self.test.short_name}"


class LabSpecimen(models.Model):
    """
    Physical specimen collected from patient for testing.
    Tracks specimen lifecycle and handling.
    """
    STATUS_CHOICES = [
        ('collected', 'Collected'),
        ('in_transit', 'In Transit'),
        ('received', 'Received in Lab'),
        ('processing', 'Processing'),
        ('stored', 'Stored'),
        ('disposed', 'Disposed'),
        ('rejected', 'Rejected'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    barcode = models.CharField(
        max_length=50,
        unique=True,
        help_text="Specimen barcode identifier"
    )
    order = models.ForeignKey(
        LabOrder,
        on_delete=models.CASCADE,
        related_name='specimens'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='lab_specimens',
        help_text="Facility context for this specimen"
    )

    # Specimen details
    specimen_type = models.CharField(max_length=50)
    container_type = models.CharField(max_length=50)
    volume_collected = models.CharField(
        max_length=30,
        blank=True,
        help_text="Actual volume collected"
    )

    # Collection information
    collected_by = models.ForeignKey(
        'users.Staff',
        on_delete=models.SET_NULL,
        null=True,
        related_name='collected_specimens'
    )
    collection_site = models.CharField(
        max_length=100,
        blank=True,
        help_text="Anatomical site of collection"
    )
    collected_at = models.DateTimeField()

    # Status tracking
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='collected'
    )
    is_rejected = models.BooleanField(default=False)
    rejection_reason = models.TextField(
        blank=True,
        help_text="Reason for specimen rejection (e.g., hemolyzed, insufficient volume)"
    )

    # Lab receipt
    received_by = models.ForeignKey(
        'users.Staff',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='received_specimens'
    )
    received_at = models.DateTimeField(null=True, blank=True)
    storage_location = models.CharField(
        max_length=100,
        blank=True,
        help_text="Storage location in lab (e.g., 'Freezer A-12')"
    )

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Lab Specimen'
        verbose_name_plural = 'Lab Specimens'
        ordering = ['-collected_at']
        indexes = [
            models.Index(fields=['barcode']),
            models.Index(fields=['order', 'status']),
            models.Index(fields=['status', 'is_rejected']),
            models.Index(fields=['facility', 'status', 'collected_at']),
        ]

    def __str__(self):
        return f"Specimen {self.barcode} - {self.specimen_type}"


class LabResult(models.Model):
    """
    Individual test result with values and interpretation.
    Links to LabOrderTest for tracking.
    """
    FLAG_CHOICES = [
        ('normal', 'Normal'),
        ('low', 'Low'),
        ('high', 'High'),
        ('critical_low', 'Critical Low'),
        ('critical_high', 'Critical High'),
        ('abnormal', 'Abnormal'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order_test = models.OneToOneField(
        LabOrderTest,
        on_delete=models.CASCADE,
        related_name='result'
    )
    specimen = models.ForeignKey(
        LabSpecimen,
        on_delete=models.CASCADE,
        related_name='results'
    )
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.PROTECT,
        related_name='lab_results',
        help_text="Facility context for this lab result"
    )

    # Result values
    value = models.CharField(
        max_length=100,
        help_text="Result value (numeric or text)"
    )
    unit = models.CharField(max_length=30)
    reference_low = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Lower reference range"
    )
    reference_high = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Upper reference range"
    )

    # Interpretation
    flag = models.CharField(
        max_length=20,
        choices=FLAG_CHOICES,
        default='normal'
    )
    interpretation = models.TextField(
        blank=True,
        help_text="Additional interpretation or comments"
    )

    # Performer tracking
    performed_by = models.ForeignKey(
        'users.Staff',
        on_delete=models.SET_NULL,
        null=True,
        related_name='performed_results',
        help_text="Lab technician who performed the test"
    )
    performed_at = models.DateTimeField()

    # Verification (required for result release)
    is_verified = models.BooleanField(
        default=False,
        help_text="Whether result has been verified by supervisor/pathologist"
    )
    verified_by = models.ForeignKey(
        'users.Staff',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='verified_results'
    )
    verified_at = models.DateTimeField(null=True, blank=True)

    # FHIR sync
    fhir_id = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        unique=True,
        help_text="FHIR Observation resource ID"
    )
    fhir_synced = models.BooleanField(default=False)

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Lab Result'
        verbose_name_plural = 'Lab Results'
        ordering = ['-performed_at']
        indexes = [
            models.Index(fields=['order_test']),
            models.Index(fields=['flag', 'is_verified']),
            models.Index(fields=['performed_at']),
            models.Index(fields=['facility', 'performed_at']),
        ]

    def __str__(self):
        return f"{self.order_test.test.short_name}: {self.value} {self.unit}"

    def is_critical(self):
        """Check if result is flagged as critical."""
        return self.flag in ['critical_low', 'critical_high']
