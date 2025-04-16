import uuid
from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from decimal import Decimal

from ..users.models import PatientProfile
from ..wards.models import Admission
from ..appointments.models import AppointmentType

User = get_user_model()


class ServiceCategory(models.Model):
    """
    Model for categorizing billable services.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_service_categories')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_service_categories')
    
    class Meta:
        verbose_name_plural = "Service Categories"
        ordering = ['name']
    
    def __str__(self):
        return self.name


class Service(models.Model):
    """
    Model for billable services.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey(ServiceCategory, on_delete=models.CASCADE, related_name='services')
    code = models.CharField(max_length=20, unique=True)
    
    # Pricing
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_services')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_services')
    
    class Meta:
        ordering = ['category__name', 'name']
    
    def __str__(self):
        return f"{self.name} ({self.code})"
    
    @property
    def total_price(self):
        """
        Calculate the total price including tax.
        """
        return self.base_price * (1 + self.tax_rate / 100)


class InsuranceProvider(models.Model):
    """
    Model for insurance providers.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, unique=True)
    contact_person = models.CharField(max_length=100, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    address = models.TextField(blank=True, null=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_insurance_providers')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_insurance_providers')
    
    class Meta:
        ordering = ['name']
    
    def __str__(self):
        return self.name


class InsurancePlan(models.Model):
    """
    Model for insurance plans.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    provider = models.ForeignKey(InsuranceProvider, on_delete=models.CASCADE, related_name='plans')
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    description = models.TextField(blank=True, null=True)
    
    # Coverage details
    coverage_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=80.00)
    annual_limit = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_insurance_plans')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_insurance_plans')
    
    class Meta:
        unique_together = ['provider', 'code']
        ordering = ['provider__name', 'name']
    
    def __str__(self):
        return f"{self.provider.name} - {self.name}"


class PatientInsurance(models.Model):
    """
    Model for patient insurance information.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='insurances')
    plan = models.ForeignKey(InsurancePlan, on_delete=models.CASCADE, related_name='patient_insurances')
    policy_number = models.CharField(max_length=50)
    
    # Validity period
    valid_from = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    
    # Status
    is_active = models.BooleanField(default=True)
    
    # Additional details
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_patient_insurances')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_patient_insurances')
    
    class Meta:
        ordering = ['-valid_from']
    
    def __str__(self):
        return f"{self.patient.user.get_full_name()} - {self.plan.provider.name} - {self.policy_number}"
    
    @property
    def is_valid(self):
        """
        Check if the insurance is currently valid.
        """
        today = timezone.now().date()
        if not self.is_active:
            return False
        if self.valid_until and self.valid_until < today:
            return False
        return self.valid_from <= today


class Invoice(models.Model):
    """
    Model for patient invoices.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice_number = models.CharField(max_length=20, unique=True)
    patient = models.ForeignKey(PatientProfile, on_delete=models.CASCADE, related_name='invoices')
    
    # Dates
    invoice_date = models.DateField(default=timezone.now)
    due_date = models.DateField()
    
    # Related records
    admission = models.ForeignKey(Admission, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    appointment_type = models.ForeignKey(AppointmentType, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    
    # FHIR references
    fhir_encounter_id = models.CharField(max_length=100, blank=True, null=True)
    fhir_claim_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Amounts
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    # Insurance
    patient_insurance = models.ForeignKey(PatientInsurance, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    insurance_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    patient_responsibility = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    # Status
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('pending', 'Pending'),
        ('paid', 'Paid'),
        ('partially_paid', 'Partially Paid'),
        ('overdue', 'Overdue'),
        ('cancelled', 'Cancelled'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    
    # Notes
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_invoices')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_invoices')
    
    class Meta:
        ordering = ['-invoice_date']
    
    def __str__(self):
        return f"Invoice #{self.invoice_number} - {self.patient.user.get_full_name()}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to calculate totals.
        """
        # Calculate totals if this is a new invoice
        if not self.pk:
            self.calculate_totals()
        
        super().save(*args, **kwargs)
    
    def calculate_totals(self):
        """
        Calculate invoice totals.
        """
        # Calculate subtotal from line items
        self.subtotal = sum(item.total_price for item in self.items.all()) if self.pk else Decimal('0.00')
        
        # Calculate tax amount
        self.tax_amount = sum(item.tax_amount for item in self.items.all()) if self.pk else Decimal('0.00')
        
        # Calculate total amount
        self.total_amount = self.subtotal + self.tax_amount - self.discount_amount
        
        # Calculate insurance amount and patient responsibility
        if self.patient_insurance and self.patient_insurance.is_valid:
            coverage_percentage = self.patient_insurance.plan.coverage_percentage / 100
            self.insurance_amount = self.total_amount * coverage_percentage
            self.patient_responsibility = self.total_amount - self.insurance_amount
        else:
            self.insurance_amount = Decimal('0.00')
            self.patient_responsibility = self.total_amount
    
    @property
    def amount_paid(self):
        """
        Calculate the total amount paid.
        """
        return sum(payment.amount for payment in self.payments.all())
    
    @property
    def balance_due(self):
        """
        Calculate the remaining balance due.
        """
        return self.patient_responsibility - self.amount_paid
    
    @property
    def is_fully_paid(self):
        """
        Check if the invoice is fully paid.
        """
        return self.balance_due <= 0


class InvoiceItem(models.Model):
    """
    Model for invoice line items.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='invoice_items')
    
    # Quantities and pricing
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    discount_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)
    
    # Description
    description = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_invoice_items')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_invoice_items')
    
    class Meta:
        ordering = ['service__name']
    
    def __str__(self):
        return f"{self.service.name} x {self.quantity}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to set default values from service.
        """
        # Set default values from service if this is a new item
        if not self.pk and self.service:
            self.unit_price = self.service.base_price
            self.tax_rate = self.service.tax_rate
        
        super().save(*args, **kwargs)
        
        # Update invoice totals
        self.invoice.calculate_totals()
        self.invoice.save()
    
    @property
    def subtotal(self):
        """
        Calculate the subtotal before tax and discount.
        """
        return self.quantity * self.unit_price
    
    @property
    def discount_amount(self):
        """
        Calculate the discount amount.
        """
        return self.subtotal * (self.discount_percentage / 100)
    
    @property
    def tax_amount(self):
        """
        Calculate the tax amount.
        """
        return (self.subtotal - self.discount_amount) * (self.tax_rate / 100)
    
    @property
    def total_price(self):
        """
        Calculate the total price including tax and discount.
        """
        return self.subtotal - self.discount_amount + self.tax_amount


class Payment(models.Model):
    """
    Model for invoice payments.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    
    # Payment details
    payment_date = models.DateField(default=timezone.now)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    
    # Payment method
    PAYMENT_METHOD_CHOICES = (
        ('cash', 'Cash'),
        ('credit_card', 'Credit Card'),
        ('debit_card', 'Debit Card'),
        ('bank_transfer', 'Bank Transfer'),
        ('mobile_money', 'Mobile Money'),
        ('insurance', 'Insurance'),
        ('other', 'Other'),
    )
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES)
    
    # Reference information
    reference_number = models.CharField(max_length=50, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_payments')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_payments')
    
    class Meta:
        ordering = ['-payment_date']
    
    def __str__(self):
        return f"Payment of {self.amount} for Invoice #{self.invoice.invoice_number}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to update invoice status.
        """
        super().save(*args, **kwargs)
        
        # Update invoice status based on payments
        invoice = self.invoice
        total_paid = sum(payment.amount for payment in invoice.payments.all())
        
        if total_paid >= invoice.patient_responsibility:
            invoice.status = 'paid'
        elif total_paid > 0:
            invoice.status = 'partially_paid'
        else:
            invoice.status = 'pending'
        
        invoice.save()


class Claim(models.Model):
    """
    Model for insurance claims.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    claim_number = models.CharField(max_length=20, unique=True)
    invoice = models.OneToOneField(Invoice, on_delete=models.CASCADE, related_name='claim')
    
    # Claim details
    submission_date = models.DateField(default=timezone.now)
    
    # FHIR reference
    fhir_claim_id = models.CharField(max_length=100, blank=True, null=True)
    fhir_explanation_of_benefit_id = models.CharField(max_length=100, blank=True, null=True)
    
    # Status
    STATUS_CHOICES = (
        ('draft', 'Draft'),
        ('submitted', 'Submitted'),
        ('in_review', 'In Review'),
        ('approved', 'Approved'),
        ('partially_approved', 'Partially Approved'),
        ('rejected', 'Rejected'),
        ('paid', 'Paid'),
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    
    # Amounts
    claimed_amount = models.DecimalField(max_digits=10, decimal_places=2)
    approved_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    
    # Response details
    response_date = models.DateField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_claims')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_claims')
    
    class Meta:
        ordering = ['-submission_date']
    
    def __str__(self):
        return f"Claim #{self.claim_number} for Invoice #{self.invoice.invoice_number}"
    
    def save(self, *args, **kwargs):
        """
        Override save method to set default values.
        """
        # Set default claimed amount from invoice
        if not self.pk and self.invoice:
            self.claimed_amount = self.invoice.insurance_amount
        
        super().save(*args, **kwargs)
    
    @property
    def is_fully_approved(self):
        """
        Check if the claim is fully approved.
        """
        return self.status == 'approved' and self.approved_amount >= self.claimed_amount
    
    @property
    def is_partially_approved(self):
        """
        Check if the claim is partially approved.
        """
        return self.status == 'partially_approved' or (self.status == 'approved' and self.approved_amount < self.claimed_amount)


class Receipt(models.Model):
    """
    Model for payment receipts.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    receipt_number = models.CharField(max_length=20, unique=True)
    payment = models.OneToOneField(Payment, on_delete=models.CASCADE, related_name='receipt')
    
    # Receipt details
    receipt_date = models.DateField(default=timezone.now)
    
    # Additional information
    notes = models.TextField(blank=True, null=True)
    
    # Audit fields
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_receipts')
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='updated_receipts')
    
    class Meta:
        ordering = ['-receipt_date']
    
    def __str__(self):
        return f"Receipt #{self.receipt_number} for Payment of {self.payment.amount}"