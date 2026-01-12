import uuid
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class AuditCategory:
    """Audit log categories"""
    AUTHENTICATION = 'AUTHENTICATION'
    PATIENT = 'PATIENT'
    CLINICAL = 'CLINICAL'
    ENCOUNTER = 'ENCOUNTER'
    ADMIN = 'ADMIN'
    WARD = 'WARD'
    APPOINTMENT = 'APPOINTMENT'
    LABORATORY = 'LABORATORY'
    DRUG_SAFETY = 'DRUG_SAFETY'
    REFERRAL = 'REFERRAL'
    PRESCRIPTION = 'PRESCRIPTION'
    VITALS = 'VITALS'
    NURSING = 'NURSING'
    PHARMACY = 'PHARMACY'
    BILLING = 'BILLING'

    CHOICES = [
        (AUTHENTICATION, 'Authentication'),
        (PATIENT, 'Patient'),
        (CLINICAL, 'Clinical'),
        (ENCOUNTER, 'Encounter'),
        (ADMIN, 'Admin'),
        (WARD, 'Ward'),
        (APPOINTMENT, 'Appointment'),
        (LABORATORY, 'Laboratory'),
        (DRUG_SAFETY, 'Drug Safety'),
        (REFERRAL, 'Referral'),
        (PRESCRIPTION, 'Prescription'),
        (VITALS, 'Vital Signs'),
        (NURSING, 'Nursing'),
        (PHARMACY, 'Pharmacy'),
        (BILLING, 'Billing'),
    ]


class AuditAction:
    """Audit log actions"""
    # Authentication
    LOGIN = 'LOGIN'
    LOGOUT = 'LOGOUT'
    LOGIN_FAILED = 'LOGIN_FAILED'
    PASSWORD_CHANGE = 'PASSWORD_CHANGE'
    OFFSITE_ACCESS = 'OFFSITE_ACCESS'

    # CRUD
    CREATE = 'CREATE'
    READ = 'READ'
    UPDATE = 'UPDATE'
    DELETE = 'DELETE'

    # Clinical specific
    NOTE_CREATE = 'NOTE_CREATE'
    NOTE_UPDATE = 'NOTE_UPDATE'
    NOTE_DELETE = 'NOTE_DELETE'
    ORDER_CREATE = 'ORDER_CREATE'

    # Encounter specific
    DISCHARGE = 'DISCHARGE'
    CANCEL = 'CANCEL'

    # Ward specific
    ADMISSION = 'ADMISSION'
    TRANSFER = 'TRANSFER'
    BED_ASSIGN = 'BED_ASSIGN'

    # Appointment specific
    CHECK_IN = 'CHECK_IN'

    # Admin specific
    USER_CREATE = 'USER_CREATE'
    USER_UPDATE = 'USER_UPDATE'
    ROLE_CHANGE = 'ROLE_CHANGE'

    # Laboratory specific
    LAB_ORDER_SUBMIT = 'LAB_ORDER_SUBMIT'
    LAB_SPECIMEN_COLLECT = 'LAB_SPECIMEN_COLLECT'
    LAB_SPECIMEN_RECEIVE = 'LAB_SPECIMEN_RECEIVE'
    LAB_PROCESSING_START = 'LAB_PROCESSING_START'
    LAB_RESULT_ENTER = 'LAB_RESULT_ENTER'
    LAB_RESULT_VERIFY = 'LAB_RESULT_VERIFY'
    LAB_ORDER_COMPLETE = 'LAB_ORDER_COMPLETE'
    LAB_ORDER_CANCEL = 'LAB_ORDER_CANCEL'

    # Drug Safety specific
    ALLERGY_RECORDED = 'ALLERGY_RECORDED'
    ALLERGY_VERIFY = 'ALLERGY_VERIFY'
    ALLERGY_DEACTIVATE = 'ALLERGY_DEACTIVATE'
    SAFETY_CHECK_PERFORMED = 'SAFETY_CHECK_PERFORMED'
    SAFETY_ALERT_OVERRIDE = 'SAFETY_ALERT_OVERRIDE'

    # Referral specific
    REFERRAL_SUBMIT = 'REFERRAL_SUBMIT'
    REFERRAL_ACCEPT = 'REFERRAL_ACCEPT'
    REFERRAL_DECLINE = 'REFERRAL_DECLINE'
    REFERRAL_SCHEDULE = 'REFERRAL_SCHEDULE'
    REFERRAL_COMPLETE = 'REFERRAL_COMPLETE'

    # Prescription specific
    PRESCRIPTION_CREATE = 'PRESCRIPTION_CREATE'
    PRESCRIPTION_UPDATE = 'PRESCRIPTION_UPDATE'
    PRESCRIPTION_DISCONTINUE = 'PRESCRIPTION_DISCONTINUE'

    # Vital Signs specific
    VITALS_RECORD = 'VITALS_RECORD'
    VITALS_UPDATE = 'VITALS_UPDATE'

    # Fluid Balance specific
    FLUID_INTAKE_RECORD = 'FLUID_INTAKE_RECORD'
    FLUID_OUTPUT_RECORD = 'FLUID_OUTPUT_RECORD'
    FLUID_BALANCE_UPDATE = 'FLUID_BALANCE_UPDATE'
    FLUID_BALANCE_DELETE = 'FLUID_BALANCE_DELETE'

    # Billing specific
    INVOICE_CREATE = 'INVOICE_CREATE'
    INVOICE_UPDATE = 'INVOICE_UPDATE'
    INVOICE_CANCEL = 'INVOICE_CANCEL'
    INVOICE_VOID = 'INVOICE_VOID'
    PAYMENT_RECORD = 'PAYMENT_RECORD'
    PAYMENT_VOID = 'PAYMENT_VOID'
    CLAIM_SUBMIT = 'CLAIM_SUBMIT'
    CLAIM_UPDATE = 'CLAIM_UPDATE'
    INSURANCE_ADD = 'INSURANCE_ADD'
    INSURANCE_UPDATE = 'INSURANCE_UPDATE'

    # Document/Print actions
    DOCUMENT_PRINT = 'DOCUMENT_PRINT'
    RECEIPT_PRINT = 'RECEIPT_PRINT'
    INVOICE_PRINT = 'INVOICE_PRINT'
    REPORT_GENERATE = 'REPORT_GENERATE'
    REPORT_EXPORT = 'REPORT_EXPORT'

    # Access override
    BREAK_GLASS = 'BREAK_GLASS'

    CHOICES = [
        (LOGIN, 'Login'),
        (LOGOUT, 'Logout'),
        (LOGIN_FAILED, 'Login Failed'),
        (PASSWORD_CHANGE, 'Password Change'),
        (OFFSITE_ACCESS, 'Off-Site Access'),
        (CREATE, 'Create'),
        (READ, 'Read'),
        (UPDATE, 'Update'),
        (DELETE, 'Delete'),
        (NOTE_CREATE, 'Note Create'),
        (NOTE_UPDATE, 'Note Update'),
        (NOTE_DELETE, 'Note Delete'),
        (ORDER_CREATE, 'Order Create'),
        (DISCHARGE, 'Discharge'),
        (CANCEL, 'Cancel'),
        (ADMISSION, 'Admission'),
        (TRANSFER, 'Transfer'),
        (BED_ASSIGN, 'Bed Assign'),
        (CHECK_IN, 'Check In'),
        (USER_CREATE, 'User Create'),
        (USER_UPDATE, 'User Update'),
        (ROLE_CHANGE, 'Role Change'),
        # Laboratory
        (LAB_ORDER_SUBMIT, 'Lab Order Submitted'),
        (LAB_SPECIMEN_COLLECT, 'Lab Specimen Collected'),
        (LAB_SPECIMEN_RECEIVE, 'Lab Specimen Received'),
        (LAB_PROCESSING_START, 'Lab Processing Started'),
        (LAB_RESULT_ENTER, 'Lab Result Entered'),
        (LAB_RESULT_VERIFY, 'Lab Result Verified'),
        (LAB_ORDER_COMPLETE, 'Lab Order Completed'),
        (LAB_ORDER_CANCEL, 'Lab Order Cancelled'),
        # Drug Safety
        (ALLERGY_RECORDED, 'Allergy Recorded'),
        (ALLERGY_VERIFY, 'Allergy Verified'),
        (ALLERGY_DEACTIVATE, 'Allergy Deactivated'),
        (SAFETY_CHECK_PERFORMED, 'Safety Check Performed'),
        (SAFETY_ALERT_OVERRIDE, 'Safety Alert Overridden'),
        # Referral
        (REFERRAL_SUBMIT, 'Referral Submitted'),
        (REFERRAL_ACCEPT, 'Referral Accepted'),
        (REFERRAL_DECLINE, 'Referral Declined'),
        (REFERRAL_SCHEDULE, 'Referral Scheduled'),
        (REFERRAL_COMPLETE, 'Referral Completed'),
        # Prescription
        (PRESCRIPTION_CREATE, 'Prescription Created'),
        (PRESCRIPTION_UPDATE, 'Prescription Updated'),
        (PRESCRIPTION_DISCONTINUE, 'Prescription Discontinued'),
        # Vital Signs
        (VITALS_RECORD, 'Vital Signs Recorded'),
        (VITALS_UPDATE, 'Vital Signs Updated'),
        # Fluid Balance
        (FLUID_INTAKE_RECORD, 'Fluid Intake Recorded'),
        (FLUID_OUTPUT_RECORD, 'Fluid Output Recorded'),
        (FLUID_BALANCE_UPDATE, 'Fluid Balance Updated'),
        (FLUID_BALANCE_DELETE, 'Fluid Balance Deleted'),
        # Billing
        (INVOICE_CREATE, 'Invoice Created'),
        (INVOICE_UPDATE, 'Invoice Updated'),
        (INVOICE_CANCEL, 'Invoice Cancelled'),
        (INVOICE_VOID, 'Invoice Voided'),
        (PAYMENT_RECORD, 'Payment Recorded'),
        (PAYMENT_VOID, 'Payment Voided'),
        (CLAIM_SUBMIT, 'Claim Submitted'),
        (CLAIM_UPDATE, 'Claim Updated'),
        (INSURANCE_ADD, 'Insurance Added'),
        (INSURANCE_UPDATE, 'Insurance Updated'),
        # Documents/Printing
        (DOCUMENT_PRINT, 'Document Printed'),
        (RECEIPT_PRINT, 'Receipt Printed'),
        (INVOICE_PRINT, 'Invoice Printed'),
        (REPORT_GENERATE, 'Report Generated'),
        (REPORT_EXPORT, 'Report Exported'),
        (BREAK_GLASS, 'Break-Glass Access'),
    ]


class AuditLog(models.Model):
    """
    Audit log model for tracking significant user actions.
    Optimized with composite indexes for efficient querying.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    facility = models.ForeignKey(
        'core.Facility',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs',
        help_text="Facility context for this audit event"
    )

    # Who performed the action
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs'
    )
    user_email = models.CharField(max_length=255)  # Denormalized for deleted users
    user_type = models.CharField(max_length=50)    # admin, doctor, nurse, etc.

    # What action was performed
    action = models.CharField(max_length=50, choices=AuditAction.CHOICES)
    category = models.CharField(max_length=50, choices=AuditCategory.CHOICES)

    # What resource was affected
    resource_type = models.CharField(max_length=100)  # Patient, Encounter, User, etc.
    resource_id = models.CharField(max_length=100, null=True, blank=True)
    resource_name = models.CharField(max_length=255, null=True, blank=True)

    # Additional context
    description = models.TextField()
    changes = models.JSONField(null=True, blank=True)  # {"field": {"old": x, "new": y}}
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, null=True, blank=True)

    # Timestamp
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'audit_logs'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['facility', '-timestamp'], name='audit_facility_ts_idx'),
            models.Index(fields=['user', '-timestamp'], name='audit_user_ts_idx'),
            models.Index(fields=['category', '-timestamp'], name='audit_cat_ts_idx'),
            models.Index(fields=['action', '-timestamp'], name='audit_act_ts_idx'),
            models.Index(fields=['resource_type', 'resource_id'], name='audit_res_idx'),
            models.Index(fields=['-timestamp'], name='audit_ts_idx'),
        ]

    def __str__(self):
        return f"{self.user_email} - {self.action} - {self.resource_type} - {self.timestamp}"
