import uuid
import hashlib
import logging
import sys
from rest_framework import viewsets, mixins, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from django.views.decorators.vary import vary_on_headers
from django.db.models import Sum, F, Q, Avg, Count, Case, When, Value, DecimalField
from decimal import Decimal, InvalidOperation

from .models import (
    ServiceCategory, Service, InsuranceProvider, InsurancePlan,
    PatientInsurance, Invoice, InvoiceItem, Payment, Claim, Receipt,
    BillingRule, FacilityBillingSettings,
    CashDrawer, CashSession, CashMovement,
    PaymentIntent, PSPWebhookEvent, SettlementBatch, SettlementLine,
    PayerServiceCode,
    PayerServiceCodeImportJob,
    NHISClaimBatch, ClaimValidationIssue, NHISClaimExportJob,
    RemittanceImportJob, RemittanceLine, InsurancePosting,
)
from .serializers import (
    ServiceCategorySerializer, ServiceSerializer, ServiceListSerializer,
    InsuranceProviderSerializer, InsurancePlanSerializer,
    PayerServiceCodeSerializer,
    PatientInsuranceSerializer, PatientInsuranceListSerializer,
    InvoiceSerializer, InvoiceListSerializer, InvoiceCreateUpdateSerializer,
    InvoiceItemSerializer,
    PaymentSerializer, PaymentListSerializer,
    ClaimSerializer, ClaimListSerializer,
    ClaimValidationIssueSerializer,
    NHISClaimBatchSerializer, NHISClaimBatchListSerializer,
    NHISClaimExportJobSerializer,
    RemittanceImportJobSerializer, RemittanceLineSerializer,
    PayerServiceCodeImportJobSerializer,
    ReceiptSerializer, ReceiptDetailSerializer,
    BillingRuleSerializer, BillingRuleListSerializer,
    FacilityBillingSettingsSerializer,
    BillingDashboardMetricsSerializer, RecentInvoiceSerializer, RecentPaymentSerializer,
    CashDrawerSerializer, CashSessionSerializer, CashMovementSerializer,
    PaymentIntentSerializer, PaymentIntentListSerializer, PaymentIntentCreateSerializer,
    SettlementBatchSerializer, SettlementLineSerializer,
)
from ..users.permissions import IsBillingStaff
from apps.core.idempotency import idempotent
from apps.core.pagination import StandardResultsSetPagination
from apps.core.security import (
    FacilityScopedPermission,
    FeatureRequiredPermission,
    check_billing_access,
    get_user_facility,
)
from apps.audit.models import AuditAction, AuditCategory
from apps.audit.services import AuditService
from apps.interop.crypto import encrypt_payload
from hms_backend.deployment import feature_enabled

from .psp import get_psp_adapter


LEGACY_PAYMENT_METHOD_MAP = {
    'card': 'credit_card',
}

logger = logging.getLogger(__name__)


def _to_decimal(value, *, default=Decimal('0.00')) -> Decimal:
    if value is None:
        return default
    return Decimal(str(value))


def _derive_invoice_status(*, invoice, patient_paid: Decimal, insurance_paid: Decimal) -> str:
    """
    CFO-grade invoice status derivation.

    Rules:
    - "paid" only when BOTH patient and insurance balances are settled
    - "overdue" applies only when patient balance is outstanding and due_date has passed
    """
    if invoice.status == 'cancelled':
        return 'cancelled'

    patient_responsibility = _to_decimal(getattr(invoice, 'patient_responsibility', 0))
    insurance_amount = _to_decimal(getattr(invoice, 'insurance_amount', 0))
    patient_balance_due = patient_responsibility - _to_decimal(patient_paid)
    insurance_balance_due = insurance_amount - _to_decimal(insurance_paid)
    total_balance_due = patient_balance_due + insurance_balance_due

    if total_balance_due <= 0:
        return 'paid'

    total_paid = _to_decimal(patient_paid) + _to_decimal(insurance_paid)
    if total_paid > 0:
        return 'partially_paid'

    # No payments posted yet
    try:
        due_date = invoice.due_date
    except Exception:
        due_date = None
    if due_date and patient_balance_due > 0 and due_date < timezone.now().date():
        return 'overdue'

    return 'pending'


def _recompute_and_persist_invoice_status(invoice) -> None:
    totals = Payment.objects.filter(invoice=invoice, status='posted').aggregate(
        patient_paid=Sum('amount', filter=Q(payer='patient')),
        insurance_paid=Sum('amount', filter=Q(payer='insurance')),
    )
    patient_paid = totals.get('patient_paid') or Decimal('0.00')
    insurance_paid = totals.get('insurance_paid') or Decimal('0.00')
    next_status = _derive_invoice_status(
        invoice=invoice,
        patient_paid=_to_decimal(patient_paid),
        insurance_paid=_to_decimal(insurance_paid),
    )

    if invoice.status != next_status:
        invoice.status = next_status
        invoice.save(update_fields=['status', 'updated_at'])


class ServiceCategoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for service categories.
    """
    queryset = ServiceCategory.objects.all()
    serializer_class = ServiceCategorySerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return ServiceCategory.objects.none()
        return ServiceCategory.objects.filter(facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)


    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class ServiceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for services.
    """
    queryset = Service.objects.all()
    serializer_class = ServiceSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'code', 'category__name']
    ordering_fields = ['name', 'base_price', 'category__name', 'created_at']
    ordering = ['category__name', 'name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Service.objects.none()
        return Service.objects.filter(facility=facility).select_related('category')

    def get_serializer_class(self):
        if self.action == 'list':
            return ServiceListSerializer
        return ServiceSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        category = serializer.validated_data.get('category')
        if category and category.facility_id != facility.id:
            raise PermissionDenied("Service category does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def by_category(self, request):
        """
        Get services grouped by category.
        """
        facility = get_user_facility(request)
        if not facility:
            return Response([])
        categories = ServiceCategory.objects.filter(is_active=True, facility=facility)
        result = []

        for category in categories:
            services = self.get_queryset().filter(category=category, is_active=True)
            if services.exists():
                result.append({
                    'category': ServiceCategorySerializer(category).data,
                    'services': ServiceSerializer(services, many=True).data
                })

        return Response(result)


class InsuranceProviderViewSet(viewsets.ModelViewSet):
    """
    API endpoint for insurance providers.

    Read access (list, retrieve, plans): Admin, billing, receptionist
    Write access (create, update, delete): Admin, billing only
    """
    queryset = InsuranceProvider.objects.all()
    serializer_class = InsuranceProviderSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'contact_person', 'email', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InsuranceProvider.objects.none()
        return InsuranceProvider.objects.filter(facility=facility)

    def get_permissions(self):
        # Allow read-only access for receptionists (needed for patient registration)
        if self.action in ['list', 'retrieve', 'plans']:
            if self.request.user.is_authenticated and self.request.user.user_type == 'receptionist':
                return [
                    FeatureRequiredPermission(),
                    permissions.IsAuthenticated(),
                    FacilityScopedPermission(),
                ]
        return super().get_permissions()

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['get'])
    def plans(self, request, pk=None):
        """
        Get all plans for an insurance provider.
        """
        provider = self.get_object()
        plans = provider.plans.all()

        # Filter by active status if requested
        active_only = request.query_params.get('active_only', 'false').lower() == 'true'
        if active_only:
            plans = plans.filter(is_active=True)

        serializer = InsurancePlanSerializer(plans, many=True)
        return Response(serializer.data)


class InsurancePlanViewSet(viewsets.ModelViewSet):
    """
    API endpoint for insurance plans.

    Read access (list, retrieve): Admin, billing, receptionist
    Write access (create, update, delete): Admin, billing only
    """
    queryset = InsurancePlan.objects.all()
    serializer_class = InsurancePlanSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'description', 'provider__name']
    ordering_fields = ['name', 'provider__name', 'coverage_percentage', 'created_at']
    ordering = ['provider__name', 'name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InsurancePlan.objects.none()
        return InsurancePlan.objects.filter(facility=facility).select_related('provider')

    def get_permissions(self):
        # Allow read-only access for receptionists (needed for patient registration)
        if self.action in ['list', 'retrieve']:
            if self.request.user.is_authenticated and self.request.user.user_type == 'receptionist':
                return [
                    FeatureRequiredPermission(),
                    permissions.IsAuthenticated(),
                    FacilityScopedPermission(),
                ]
        return super().get_permissions()

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        provider = serializer.validated_data.get('provider')
        if provider and provider.facility_id != facility.id:
            raise PermissionDenied("Insurance provider does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user, facility=facility)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientInsuranceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient insurance.
    """
    queryset = PatientInsurance.objects.all()
    serializer_class = PatientInsuranceSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'policy_number', 'plan__name', 'plan__provider__name']
    ordering_fields = ['valid_from', 'valid_until', 'created_at']
    ordering = ['-valid_from']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PatientInsurance.objects.none()
        return PatientInsurance.objects.filter(patient__facility=facility).select_related('plan', 'plan__provider')

    def get_permissions(self):
        if self.action == 'for_patient':
            return [
                FeatureRequiredPermission(),
                permissions.IsAuthenticated(),
                FacilityScopedPermission(),
            ]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action == 'list':
            return PatientInsuranceListSerializer
        return PatientInsuranceSerializer

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        patient = serializer.validated_data.get('patient')
        plan = serializer.validated_data.get('plan')
        if patient and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")
        if plan and plan.facility_id != facility.id:
            raise PermissionDenied("Insurance plan does not belong to the active facility.")
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def for_patient(self, request):
        """
        Get insurance for a specific patient.
        """
        patient_id = request.query_params.get('patient_id', None)
        if not patient_id:
            return Response(
                {"error": "patient_id parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # SECURITY: Billing access only (admin/billing/patient self)
        check_billing_access(request.user, patient_id)

        insurances = self.get_queryset().filter(patient_id=patient_id)

        # Filter by active status if requested
        active_only = request.query_params.get('active_only', 'false').lower() == 'true'
        if active_only:
            insurances = insurances.filter(is_active=True)
            # Also filter by validity date
            today = timezone.now().date()
            insurances = insurances.filter(
                valid_from__lte=today
            ).filter(
                Q(valid_until__isnull=True) | Q(valid_until__gte=today)
            )

        serializer = self.get_serializer(insurances, many=True)
        return Response(serializer.data)


class InvoiceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for invoices.
    """
    queryset = Invoice.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['invoice_number', 'patient__user__first_name', 'patient__user__last_name']
    ordering_fields = ['invoice_date', 'due_date', 'total_amount', 'status', 'created_at']
    ordering = ['-invoice_date']

    def get_permissions(self):
        if self.action == 'for_patient':
            return [
                FeatureRequiredPermission(),
                permissions.IsAuthenticated(),
                FacilityScopedPermission(),
            ]
        return super().get_permissions()

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return InvoiceCreateUpdateSerializer
        elif self.action == 'list':
            return InvoiceListSerializer
        return InvoiceSerializer

    def get_queryset(self):
        from django.db.models import Prefetch

        # Prefetch payments with their receipts to avoid N+1 queries
        payments_prefetch = Prefetch(
            'payments',
            queryset=Payment.objects.select_related('receipt', 'created_by')
        )

        facility = get_user_facility(self.request)
        if not facility:
            return Invoice.objects.none()

        queryset = super().get_queryset().select_related(
            'patient__user', 'facility', 'patient_insurance__plan__provider'
        ).prefetch_related('items', payments_prefetch).filter(facility=facility)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by facility (explicit filter must match active facility)
        facility_id = self.request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        # Filter by patient
        patient_id = self.request.query_params.get('patient')
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(invoice_date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(invoice_date__lte=date_to)

        return queryset

    @idempotent(operation_type='billing.invoice.create', timeout=86400)
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def for_patient(self, request):
        """
        Get invoices for a specific patient.
        """
        patient_id = request.query_params.get('patient_id', None)
        if not patient_id:
            return Response(
                {"error": "patient_id parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # SECURITY: Billing access only (admin/billing/patient self)
        check_billing_access(request.user, patient_id)

        invoices = self.get_queryset().filter(patient_id=patient_id)

        # Filter by status if requested
        status_filter = request.query_params.get('status', None)
        if status_filter:
            invoices = invoices.filter(status=status_filter)

        serializer = InvoiceSerializer(invoices, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def generate_claim(self, request, pk=None):
        """
        Generate an insurance claim for an invoice.
        """
        invoice = self.get_object()

        # Check if invoice has insurance
        if not invoice.patient_insurance or invoice.insurance_amount <= 0:
            return Response(
                {"error": "Invoice has no valid insurance or insurance amount is zero."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if claim already exists
        if hasattr(invoice, 'claim'):
            return Response(
                {"error": "Claim already exists for this invoice."},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            claim_number = f"CLM-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            claim = Claim.objects.create(
                claim_number=claim_number,
                invoice=invoice,
                claimed_amount=invoice.insurance_amount,
                created_by=request.user,
                updated_by=request.user
            )

            # Never block request threads on external I/O (FHIR). Gate behind a feature flag.
            if (
                getattr(settings, 'BILLING_ENABLE_FHIR_CLAIMS', False)
                and feature_enabled('fhir_claims', request=request)
                and getattr(invoice.patient, 'fhir_patient_id', None)
            ):
                from apps.billing.tasks import create_fhir_claim_for_claim
                create_fhir_claim_for_claim.delay(str(claim.id))

            return Response(ClaimSerializer(claim).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def print_detail(self, request, pk=None):
        """
        Get invoice details for printing.
        Logs an audit trail for the print action.
        """
        invoice = self.get_object()

        # Audit log the invoice print
        AuditService.log(
            request,
            action=AuditAction.INVOICE_PRINT,
            category=AuditCategory.BILLING,
            resource_type='Invoice',
            resource_id=str(invoice.id),
            description=f"Printed invoice {invoice.invoice_number} - Amount: {invoice.total_amount}",
            resource_name=invoice.invoice_number,
        )

        serializer = InvoiceSerializer(invoice)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    @idempotent(operation_type='billing.invoice.mark_as_paid', timeout=86400)
    def mark_as_paid(self, request, pk=None):
        """
        Post a patient payment against an invoice (does not post insurance payments).
        """
        invoice = self.get_object()

        if getattr(invoice, 'auto_update_enabled', False):
            return Response(
                {"error": "This invoice is still auto-updating. Finalize it before posting payments."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if invoice is already settled (patient + insurance)
        if invoice.status == 'paid':
            return Response(
                {"error": "Invoice is already settled."},
                status=status.HTTP_400_BAD_REQUEST
            )

        facility = invoice.facility or get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if invoice.facility_id and invoice.facility_id != facility.id:
            raise PermissionDenied("Invoice does not belong to the active facility.")

        try:
            billing_settings = facility.billing_settings
        except FacilityBillingSettings.DoesNotExist:
            billing_settings = None

        raw_method = request.data.get('payment_method') or 'cash'
        payment_method = LEGACY_PAYMENT_METHOD_MAP.get(str(raw_method), str(raw_method))
        if payment_method == 'insurance':
            return Response(
                {"error": "Insurance payments must be posted via insurance workflows."},
                status=status.HTTP_400_BAD_REQUEST
            )

        valid_methods = {choice[0] for choice in Payment.PAYMENT_METHOD_CHOICES}
        if payment_method not in valid_methods:
            return Response(
                {"error": f"Invalid payment_method. Must be one of: {', '.join(sorted(valid_methods))}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if billing_settings and billing_settings.accepted_payment_methods:
            if payment_method not in billing_settings.accepted_payment_methods:
                return Response(
                    {"error": "Payment method is not accepted for this facility."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        reference_number = request.data.get('reference_number') or None
        notes = request.data.get('notes') or None
        generate_receipt = bool(request.data.get('generate_receipt', True))

        # Authoritative patient balance due (exclude insurance and voided payments)
        patient_paid = Payment.objects.filter(
            invoice=invoice, status='posted', payer='patient'
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
        patient_balance_due = _to_decimal(invoice.patient_responsibility) - _to_decimal(patient_paid)

        if patient_balance_due <= 0:
            return Response(
                {"error": "Patient balance is already settled for this invoice."},
                status=status.HTTP_400_BAD_REQUEST
            )

        amount = request.data.get('amount', None)
        if amount is None:
            amount = patient_balance_due
        else:
            try:
                amount = _to_decimal(amount)
            except (ValueError, TypeError, InvalidOperation):
                return Response(
                    {"error": "amount must be a valid number."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if amount <= 0:
                return Response(
                    {"error": "amount must be greater than zero."},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if amount > patient_balance_due:
                return Response(
                    {"error": "amount cannot exceed the patient balance due."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        cash_session = None
        if billing_settings and billing_settings.cash_control_enabled:
            cash_session = CashSession.objects.filter(
                facility=facility,
                opened_by=request.user,
                status='open'
            ).first()
            if not cash_session:
                return Response(
                    {"error": "An open cash session is required to record payments for this facility."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        with transaction.atomic():
            payment = Payment(
                invoice=invoice,
                amount=amount,
                payment_method=payment_method,
                payer='patient',
                status='posted',
                reference_number=reference_number,
                notes=notes,
                created_by=request.user,
                updated_by=request.user,
                cash_session=cash_session,
            )
            payment.full_clean()
            payment.save()

            receipt = None
            if generate_receipt:
                receipt_number = f"RCP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
                receipt = Receipt.objects.create(
                    receipt_number=receipt_number,
                    payment=payment,
                    created_by=request.user,
                    updated_by=request.user
                )

            _recompute_and_persist_invoice_status(invoice)

            payload = {
                "message": "Payment posted.",
                "payment": PaymentSerializer(payment).data,
                "receipt": ReceiptSerializer(receipt).data if receipt else None,
            }
            return Response(payload, status=status.HTTP_201_CREATED)


class InvoiceItemViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for invoice items.
    """
    queryset = InvoiceItem.objects.all()
    serializer_class = InvoiceItemSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['service__name', 'description', 'invoice__invoice_number']
    ordering_fields = ['service__name', 'quantity', 'unit_price', 'created_at']
    ordering = ['service__name']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return InvoiceItem.objects.none()
        return super().get_queryset().select_related(
            'invoice', 'service'
        ).filter(invoice__facility=facility)


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for payments.
    """
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        'invoice__invoice_number', 'reference_number',
        'invoice__patient__user__first_name', 'invoice__patient__user__last_name',
        'invoice__patient__medical_record_number', 'receipt__receipt_number'
    ]
    ordering_fields = ['payment_date', 'amount', 'created_at']
    ordering = ['-payment_date']

    def get_serializer_class(self):
        if self.action == 'list':
            return PaymentListSerializer
        return PaymentSerializer

    def get_queryset(self):
        # Use select_related for all foreign keys to avoid N+1 queries
        facility = get_user_facility(self.request)
        if not facility:
            return Payment.objects.none()

        queryset = super().get_queryset().select_related(
            'invoice__patient__user', 'invoice__facility',
            'receipt', 'created_by', 'cash_session'
        ).filter(invoice__facility=facility)

        # Filter by payment method
        payment_method = self.request.query_params.get('payment_method')
        if payment_method:
            queryset = queryset.filter(payment_method=payment_method)

        # Filter by facility (explicit filter must match active facility)
        facility_id = self.request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(payment_date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(payment_date__lte=date_to)

        return queryset

    @action(detail=True, methods=['post'])
    def generate_receipt(self, request, pk=None):
        """
        Generate a receipt for a payment.
        """
        payment = self.get_object()

        if payment.status != 'posted':
            return Response(
                {"error": "Cannot generate a receipt for a voided payment."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if payment.payer != 'patient':
            return Response(
                {"error": "Receipts are only generated for patient payments."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if receipt already exists
        if hasattr(payment, 'receipt'):
            return Response(
                {"error": "Receipt already exists for this payment."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Generate receipt number
        receipt_number = f"RCP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

        # Create receipt
        receipt = Receipt.objects.create(
            receipt_number=receipt_number,
            payment=payment,
            created_by=request.user,
            updated_by=request.user
        )

        return Response(ReceiptSerializer(receipt).data)

    @action(detail=True, methods=['post'])
    def void(self, request, pk=None):
        """
        Explicit non-destructive void action for posted payments.
        """
        payment = self.get_object()

        if payment.status != 'posted':
            return Response(
                {"error": "Payment is already voided."},
                status=status.HTTP_400_BAD_REQUEST
            )

        reason = (request.data.get('reason') or request.data.get('void_reason') or '').strip()
        if not reason:
            return Response(
                {"error": "reason is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Tighten least-privilege: billing users cannot void closed-session payments.
        if (
            getattr(request.user, 'user_type', None) != 'admin' and
            payment.cash_session_id and
            getattr(payment.cash_session, 'status', None) == 'closed'
        ):
            raise PermissionDenied("Only admins can void payments from a closed cash session.")

        with transaction.atomic():
            payment.status = 'voided'
            payment.void_reason = reason
            payment.voided_at = timezone.now()
            payment.voided_by = request.user
            payment.updated_by = request.user
            payment.full_clean()
            payment.save(update_fields=[
                'status', 'void_reason', 'voided_at', 'voided_by', 'updated_by', 'updated_at'
            ])

            _recompute_and_persist_invoice_status(payment.invoice)

        return Response(PaymentSerializer(payment).data, status=status.HTTP_200_OK)


class ClaimViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for claims.
    """
    queryset = Claim.objects.all()
    serializer_class = ClaimSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['claim_number', 'invoice__invoice_number', 'invoice__patient__user__first_name', 'invoice__patient__user__last_name']
    ordering_fields = ['submission_date', 'status', 'claimed_amount', 'approved_amount', 'created_at']
    ordering = ['-submission_date']

    def get_serializer_class(self):
        if self.action == 'list':
            return ClaimListSerializer
        return ClaimSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Claim.objects.none()

        queryset = super().get_queryset().select_related(
            'invoice__patient__user', 'invoice__facility'
        ).filter(invoice__facility=facility)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by facility (explicit filter must match active facility)
        facility_id = self.request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(submission_date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(submission_date__lte=date_to)

        return queryset

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        """
        Update the status of a claim.
        """
        claim = self.get_object()

        # Get status from request
        new_status = request.data.get('status', None)
        if not new_status:
            return Response(
                {"error": "status parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate status
        valid_statuses = [status for status, _ in Claim.STATUS_CHOICES]
        if new_status not in valid_statuses:
            return Response(
                {"error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get additional fields
        approved_amount = request.data.get('approved_amount', None)
        rejection_reason = request.data.get('rejection_reason', None)

        # SECURITY: Validate approved_amount to prevent billing fraud
        if approved_amount is not None:
            try:
                approved_amount = Decimal(str(approved_amount))
            except (ValueError, TypeError):
                return Response(
                    {"error": "approved_amount must be a valid number."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            if approved_amount < 0:
                return Response(
                    {"error": "approved_amount cannot be negative."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            if approved_amount > claim.claimed_amount:
                return Response(
                    {"error": "approved_amount cannot exceed the claimed_amount."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Update claim
        claim.status = new_status
        claim.response_date = timezone.now().date()

        if approved_amount is not None:
            claim.approved_amount = approved_amount

        if rejection_reason is not None:
            claim.rejection_reason = rejection_reason

        claim.updated_by = request.user
        claim.save()

        # Phase 3: Insurance payments are posted via remittance workflows (NHIS AR).
        # Keep legacy "post-on-approval" behavior only when explicitly enabled and
        # only for non-NHIS payers.
        post_on_approval = bool(getattr(settings, 'BILLING_POST_INSURANCE_PAYMENTS_ON_CLAIM_APPROVAL', False))
        provider = None
        try:
            provider = claim.invoice.patient_insurance.plan.provider if claim.invoice.patient_insurance and claim.invoice.patient_insurance.plan else None
        except Exception:
            provider = None

        if (
            post_on_approval and
            new_status in ['approved', 'partially_approved'] and
            claim.approved_amount > 0 and
            (not provider or getattr(provider, 'payer_type', None) != 'nhis')
        ):
            posted_total = Payment.objects.filter(
                invoice=claim.invoice,
                status='posted',
                payer='insurance',
                reference_number=f"INS-{claim.claim_number}",
            ).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')

            delta = _to_decimal(claim.approved_amount) - _to_decimal(posted_total)
            if delta > 0:
                # Cap at current insurance balance due to avoid overposting.
                insurance_paid = Payment.objects.filter(
                    invoice=claim.invoice, status='posted', payer='insurance'
                ).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
                insurance_balance_due = _to_decimal(claim.invoice.insurance_amount) - _to_decimal(insurance_paid)
                amount_to_post = min(delta, insurance_balance_due)

                if amount_to_post > 0:
                    payment = Payment(
                        invoice=claim.invoice,
                        amount=amount_to_post,
                        payer='insurance',
                        status='posted',
                        payment_method='insurance',
                        reference_number=f"INS-{claim.claim_number}",
                        notes=f"Insurance payment for claim {claim.claim_number}",
                        created_by=request.user,
                        updated_by=request.user
                    )
                    payment.full_clean()
                    payment.save()

                    _recompute_and_persist_invoice_status(claim.invoice)

        return Response(ClaimSerializer(claim).data)


class ReceiptViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API endpoint for receipts.
    """
    queryset = Receipt.objects.all()
    serializer_class = ReceiptSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['receipt_number', 'payment__invoice__invoice_number', 'payment__reference_number']
    ordering_fields = ['receipt_date', 'created_at']
    ordering = ['-receipt_date']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return Receipt.objects.none()
        return super().get_queryset().select_related(
            'payment__invoice__patient__user',
            'payment__invoice__facility',
            'payment__created_by'
        ).prefetch_related(
            'payment__invoice__items__service'
        ).filter(payment__invoice__facility=facility)

    @action(detail=True, methods=['get'])
    def print_detail(self, request, pk=None):
        """
        Get detailed receipt data for printing.
        Includes invoice items to show what was paid for.
        Logs an audit trail for the print action.
        """
        receipt = self.get_object()

        # Audit log the receipt print
        AuditService.log(
            request,
            action=AuditAction.RECEIPT_PRINT,
            category=AuditCategory.BILLING,
            resource_type='Receipt',
            resource_id=str(receipt.id),
            description=f"Printed receipt {receipt.receipt_number} for payment of {receipt.payment.amount}",
            resource_name=receipt.receipt_number,
        )

        serializer = ReceiptDetailSerializer(receipt)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def by_receipt_number(self, request):
        """
        Get receipt by receipt number for printing.
        Logs an audit trail for the print action.
        """
        receipt_number = request.query_params.get('receipt_number')
        if not receipt_number:
            return Response(
                {"error": "receipt_number parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            receipt = self.get_queryset().get(receipt_number=receipt_number)

            # Audit log the receipt print
            AuditService.log(
                request,
                action=AuditAction.RECEIPT_PRINT,
                category=AuditCategory.BILLING,
                resource_type='Receipt',
                resource_id=str(receipt.id),
                description=f"Printed receipt {receipt.receipt_number} for payment of {receipt.payment.amount}",
                resource_name=receipt.receipt_number,
            )

            serializer = ReceiptDetailSerializer(receipt)
            return Response(serializer.data)
        except Receipt.DoesNotExist:
            return Response(
                {"error": "Receipt not found."},
                status=status.HTTP_404_NOT_FOUND
            )


class BillingRuleViewSet(viewsets.ModelViewSet):
    """
    API endpoint for billing rules.
    """
    queryset = BillingRule.objects.select_related('facility').all()
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'rule_type', 'description']
    ordering_fields = ['priority', 'name', 'rule_type', 'created_at']
    ordering = ['priority', 'name']

    def get_serializer_class(self):
        if self.action == 'list':
            return BillingRuleListSerializer
        return BillingRuleSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return BillingRule.objects.none()

        queryset = super().get_queryset().filter(
            Q(facility=facility) | Q(facility__isnull=True)
        )

        # Filter by facility (explicit filter must match active facility)
        facility_id = self.request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        # Filter by rule_type
        rule_type = self.request.query_params.get('rule_type')
        if rule_type:
            queryset = queryset.filter(rule_type=rule_type)

        # Filter by is_active
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        # Default to facility-scoped rules; allow global only for admins with explicit facility=null.
        requested_facility = serializer.validated_data.get('facility')
        if requested_facility and requested_facility.id != facility.id:
            raise PermissionDenied("Billing rule facility does not match active facility.")
        if requested_facility is None and getattr(self.request.user, 'user_type', None) != 'admin':
            serializer.validated_data['facility'] = facility

        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """Toggle the active status of a billing rule."""
        rule = self.get_object()
        rule.is_active = not rule.is_active
        rule.updated_by = request.user
        rule.save(update_fields=['is_active', 'updated_by', 'updated_at'])
        return Response(BillingRuleSerializer(rule).data)


class FacilityBillingSettingsViewSet(viewsets.ModelViewSet):
    """
    API endpoint for facility billing settings.
    """
    queryset = FacilityBillingSettings.objects.select_related('facility').all()
    serializer_class = FacilityBillingSettingsSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return FacilityBillingSettings.objects.none()

        queryset = super().get_queryset().filter(facility=facility)

        facility_id = self.request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        return queryset

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(facility=facility, created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class CashDrawerViewSet(viewsets.ModelViewSet):
    """
    Admin-managed cash drawers/registers within a facility.
    """
    queryset = CashDrawer.objects.all()
    serializer_class = CashDrawerSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'name', 'location']
    ordering_fields = ['code', 'name', 'created_at']
    ordering = ['code']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return CashDrawer.objects.none()
        return super().get_queryset().filter(facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class CashSessionViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    Cashier sessions for close-of-day reconciliation.
    """
    queryset = CashSession.objects.all()
    serializer_class = CashSessionSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['notes', 'drawer__code', 'drawer__name', 'opened_by__username']
    ordering_fields = ['opened_at', 'closed_at', 'is_flagged', 'status']
    ordering = ['-opened_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return CashSession.objects.none()
        queryset = super().get_queryset().select_related(
            'drawer', 'opened_by', 'closed_by', 'reviewed_by'
        ).filter(facility=facility)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        flagged = self.request.query_params.get('is_flagged')
        if flagged is not None and str(flagged).lower() in ('true', 'false'):
            queryset = queryset.filter(is_flagged=str(flagged).lower() == 'true')

        opened_by = self.request.query_params.get('opened_by')
        if opened_by:
            queryset = queryset.filter(opened_by_id=opened_by)

        return queryset

    @idempotent(operation_type='billing.cash_session.open', timeout=86400)
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        drawer = serializer.validated_data.get('drawer')
        if drawer and drawer.facility_id != facility.id:
            raise PermissionDenied("Cash drawer does not belong to the active facility.")

        serializer.save(
            facility=facility,
            opened_by=self.request.user,
            opened_at=timezone.now(),
            status='open',
        )

    @action(detail=False, methods=['get'])
    def current(self, request):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        session = CashSession.objects.select_related(
            'drawer', 'opened_by', 'closed_by', 'reviewed_by'
        ).filter(
            facility=facility,
            opened_by=request.user,
            status='open'
        ).first()

        return Response({
            'session': CashSessionSerializer(session).data if session else None
        })

    @action(detail=True, methods=['get'])
    def totals(self, request, pk=None):
        """
        Compute expected totals for an open session (so far).
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        session = self.get_object()
        if request.user.user_type != 'admin' and session.opened_by_id != request.user.id:
            raise PermissionDenied("You can only view totals for your own cash session.")

        payment_rows = list(
            Payment.objects.filter(
                cash_session=session,
                status='posted',
                payer='patient',
            ).values('payment_method').annotate(total=Sum('amount'))
        )
        expected_totals = {
            row['payment_method']: str(row['total'] or Decimal('0.00'))
            for row in payment_rows
        }
        cash_total = _to_decimal(expected_totals.get('cash')) if expected_totals.get('cash') else Decimal('0.00')

        movement_net = CashMovement.objects.filter(session=session).aggregate(
            net=Sum(
                Case(
                    When(direction='in', then=F('amount')),
                    When(direction='out', then=-F('amount')),
                    default=Value(Decimal('0.00')),
                    output_field=DecimalField(max_digits=10, decimal_places=2),
                )
            )
        )['net'] or Decimal('0.00')

        expected_cash_amount = (
            _to_decimal(session.opening_float_amount) +
            _to_decimal(movement_net) +
            _to_decimal(cash_total)
        )

        return Response(
            {
                'expected_totals': expected_totals,
                'expected_cash_amount': str(expected_cash_amount),
                'movement_net': str(movement_net),
            }
        )

    @action(detail=True, methods=['post'])
    @idempotent(operation_type='billing.cash_session.close', timeout=86400)
    def close(self, request, pk=None):
        """
        Close a cash session and compute expected totals + cash variance server-side.
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        try:
            counted_cash_amount = _to_decimal(request.data.get('counted_cash_amount'))
        except (ValueError, TypeError, InvalidOperation):
            return Response(
                {"error": "counted_cash_amount must be a valid number."},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            session = CashSession.objects.select_for_update().select_related('facility').get(id=pk)
            if session.facility_id != facility.id:
                raise PermissionDenied("Cash session does not belong to the active facility.")

            if session.status != 'open':
                return Response(
                    {"error": "Cash session is already closed."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            if request.user.user_type != 'admin' and session.opened_by_id != request.user.id:
                raise PermissionDenied("You can only close your own cash session.")

            # Expected totals by payment method (posted patient payments)
            payment_rows = list(
                Payment.objects.filter(
                    cash_session=session,
                    status='posted',
                    payer='patient',
                ).values('payment_method').annotate(total=Sum('amount'))
            )
            expected_totals = {
                row['payment_method']: str(row['total'] or Decimal('0.00'))
                for row in payment_rows
            }
            cash_total = Decimal('0.00')
            if expected_totals.get('cash'):
                cash_total = _to_decimal(expected_totals['cash'])

            # Net cash movements
            movement_net = CashMovement.objects.filter(session=session).aggregate(
                net=Sum(
                    Case(
                        When(direction='in', then=F('amount')),
                        When(direction='out', then=-F('amount')),
                        default=Value(Decimal('0.00')),
                        output_field=DecimalField(max_digits=10, decimal_places=2),
                    )
                )
            )['net'] or Decimal('0.00')

            expected_cash_amount = (
                _to_decimal(session.opening_float_amount) +
                _to_decimal(movement_net) +
                _to_decimal(cash_total)
            )
            variance = _to_decimal(counted_cash_amount) - _to_decimal(expected_cash_amount)

            try:
                billing_settings = facility.billing_settings
            except FacilityBillingSettings.DoesNotExist:
                billing_settings = None
            threshold = _to_decimal(
                getattr(billing_settings, 'cash_variance_threshold_amount', Decimal('0.00'))
            )

            is_flagged = abs(variance) > threshold

            session.status = 'closed'
            session.closed_by = request.user
            session.closed_at = timezone.now()
            session.expected_totals = expected_totals
            session.expected_cash_amount = expected_cash_amount
            session.counted_cash_amount = counted_cash_amount
            session.variance_cash_amount = variance
            session.is_flagged = is_flagged
            if request.data.get('notes') is not None:
                session.notes = request.data.get('notes')
            session.save(update_fields=[
                'status', 'closed_by', 'closed_at',
                'expected_totals', 'expected_cash_amount',
                'counted_cash_amount', 'variance_cash_amount', 'is_flagged',
                'notes', 'updated_at'
            ])

        return Response(CashSessionSerializer(session).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """
        Admin-only review of a closed session.
        """
        if request.user.user_type != 'admin':
            raise PermissionDenied("Only admins can review cash sessions.")

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        with transaction.atomic():
            session = CashSession.objects.select_for_update().get(id=pk)
            if session.facility_id != facility.id:
                raise PermissionDenied("Cash session does not belong to the active facility.")

            if session.status != 'closed':
                return Response(
                    {"error": "Only closed sessions can be reviewed."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            session.reviewed_by = request.user
            session.reviewed_at = timezone.now()
            session.review_notes = request.data.get('review_notes') or None
            session.save(update_fields=['reviewed_by', 'reviewed_at', 'review_notes', 'updated_at'])

        return Response(CashSessionSerializer(session).data, status=status.HTTP_200_OK)


class CashMovementViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    Cash movements within a cash session (float in/out, drops, expenses).
    """
    queryset = CashMovement.objects.all()
    serializer_class = CashMovementSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['reference', 'notes', 'movement_type']
    ordering_fields = ['created_at', 'amount', 'movement_type', 'direction']
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return CashMovement.objects.none()
        queryset = super().get_queryset().select_related('session', 'created_by').filter(
            session__facility=facility
        )

        session_id = self.request.query_params.get('session')
        if session_id:
            queryset = queryset.filter(session_id=session_id)
        return queryset

    @idempotent(operation_type='billing.cash_movement.create', timeout=86400)
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        session = serializer.validated_data.get('session')
        if not session:
            raise PermissionDenied("session is required.")
        if session.facility_id != facility.id:
            raise PermissionDenied("Cash session does not belong to the active facility.")
        if session.status != 'open':
            raise PermissionDenied("Cannot add movements to a closed cash session.")

        if self.request.user.user_type != 'admin' and session.opened_by_id != self.request.user.id:
            raise PermissionDenied("You can only add movements to your own open session.")

        serializer.save(created_by=self.request.user)


class PaymentIntentViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    PSP payment intents (provider-agnostic).
    """
    queryset = PaymentIntent.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['client_reference', 'provider_reference', 'invoice__invoice_number']
    ordering_fields = ['created_at', 'status']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return PaymentIntentListSerializer
        return PaymentIntentSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PaymentIntent.objects.none()
        qs = super().get_queryset().select_related('invoice', 'facility', 'cash_session', 'initiated_by', 'payment').filter(
            facility=facility
        )

        invoice_id = self.request.query_params.get('invoice')
        if invoice_id:
            qs = qs.filter(invoice_id=invoice_id)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @idempotent(operation_type='billing.psp.intent.create', timeout=86400)
    def create(self, request, *args, **kwargs):
        """
        Create a payment intent. Currently supports Hubtel.
        """
        serializer = PaymentIntentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        invoice_id = serializer.validated_data['invoice_id']
        invoice = Invoice.objects.select_related('facility').filter(id=invoice_id).first()
        if not invoice:
            return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        if invoice.facility_id != facility.id:
            raise PermissionDenied("Invoice does not belong to the active facility.")

        payment_method = serializer.validated_data['payment_method']
        if payment_method == 'cash' or payment_method == 'bank_transfer':
            return Response({"error": "PSP intents are not supported for this method."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            billing_settings = facility.billing_settings
        except FacilityBillingSettings.DoesNotExist:
            billing_settings = None

        if billing_settings and billing_settings.accepted_payment_methods:
            if payment_method not in billing_settings.accepted_payment_methods:
                return Response(
                    {"error": "Payment method is not accepted for this facility."},
                    status=status.HTTP_400_BAD_REQUEST
                )

        mobile_number = serializer.validated_data['mobile_number']

        # Amount defaults to current patient balance due.
        patient_paid = Payment.objects.filter(
            invoice=invoice, status='posted', payer='patient'
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')
        patient_balance_due = _to_decimal(invoice.patient_responsibility) - _to_decimal(patient_paid)

        requested_amount = serializer.validated_data.get('amount')
        if requested_amount is None:
            amount = patient_balance_due
        else:
            amount = _to_decimal(requested_amount)
            if amount <= 0:
                return Response({"error": "amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
            if amount > patient_balance_due:
                return Response({"error": "amount cannot exceed the patient balance due."}, status=status.HTTP_400_BAD_REQUEST)

        if patient_balance_due <= 0:
            return Response({"error": "Patient balance is already settled for this invoice."}, status=status.HTTP_400_BAD_REQUEST)

        cash_session = None
        if billing_settings and billing_settings.cash_control_enabled:
            cash_session = CashSession.objects.filter(
                facility=facility,
                opened_by=request.user,
                status='open'
            ).first()

        # Generate a non-PHI client reference for webhook correlation.
        client_reference = f"HMS-{facility.code}-{uuid.uuid4().hex[:16].upper()}"

        public_base = getattr(settings, 'PUBLIC_BASE_URL', '') or ''
        if public_base:
            public_base = public_base.rstrip('/')
            callback_url = f"{public_base}/api/billing/psp/webhooks/hubtel/"
        else:
            if not settings.DEBUG and "pytest" not in sys.modules:
                return Response(
                    {"error": "psp_misconfigured", "detail": "PUBLIC_BASE_URL is required for PSP callbacks."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            # Best-effort fallback. Prefer PUBLIC_BASE_URL in production behind proxies.
            callback_url = request.build_absolute_uri('/api/billing/psp/webhooks/hubtel/')

        hubtel_token = getattr(settings, 'HUBTEL_WEBHOOK_SECRET', '') or ''
        if hubtel_token:
            sep = '&' if '?' in callback_url else '?'
            callback_url = f"{callback_url}{sep}token={hubtel_token}"

        # Avoid PHI: description includes invoice number only.
        title = "Invoice Payment"
        description = f"Invoice {invoice.invoice_number}"

        with transaction.atomic():
            intent = PaymentIntent.objects.create(
                facility=facility,
                invoice=invoice,
                payer='patient',
                amount=amount,
                currency=getattr(facility, 'currency', 'GHS') or 'GHS',
                payment_method=payment_method,
                status='created',
                provider='hubtel',
                client_reference=client_reference,
                initiated_by=request.user,
                cash_session=cash_session,
            )

        adapter = get_psp_adapter('hubtel')
        try:
            result = adapter.create_intent(
                mobile_number=mobile_number,
                amount=_to_decimal(amount),
                client_reference=client_reference,
                callback_url=callback_url,
                title=title,
                description=description,
            )
        except Exception:
            PaymentIntent.objects.filter(id=intent.id).update(status='failed', updated_at=timezone.now())
            return Response(
                {"error": "psp_unavailable", "detail": "Unable to initiate PSP collection. Record the payment manually."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        intent.provider_reference = result.provider_reference
        intent.checkout_url = result.checkout_url
        intent.expires_at = result.expires_at
        intent.status = 'pending'
        intent.save(update_fields=['provider_reference', 'checkout_url', 'expires_at', 'status', 'updated_at'])

        return Response(PaymentIntentSerializer(intent).data, status=status.HTTP_201_CREATED)


class HubtelWebhookView(APIView):
    """
    Unauthenticated webhook endpoint for Hubtel PSP callbacks.
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        adapter = get_psp_adapter('hubtel')
        if not adapter.verify_webhook(request):
            return Response({"error": "invalid_webhook"}, status=status.HTTP_401_UNAUTHORIZED)

        body = request.body or b""
        payload_hash = hashlib.sha256(body).hexdigest()

        # Best-effort parse for indexing (ignore errors).
        provider_reference = None
        client_reference = None
        try:
            parsed = adapter.parse_webhook(body_bytes=body, headers=dict(request.headers))
            provider_reference = parsed.provider_reference
            client_reference = parsed.client_reference
        except Exception:
            parsed = None

        safe_headers = {}
        for key in ('User-Agent', 'Content-Type', 'X-Forwarded-For', 'X-Real-Ip', 'X-Request-Id'):
            if key in request.headers:
                safe_headers[key] = request.headers.get(key)

        try:
            with transaction.atomic():
                event = PSPWebhookEvent.objects.create(
                    provider='hubtel',
                    provider_reference=provider_reference,
                    client_reference=client_reference,
                    received_at=timezone.now(),
                    headers=safe_headers,
                    payload_hash=payload_hash,
                    payload_encrypted=encrypt_payload(body),
                    processing_status='pending',
                )
        except IntegrityError:
            # Duplicate payload_hash for this provider (idempotent re-delivery). Acknowledge.
            return Response({"ok": True}, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("Failed to persist Hubtel webhook event.")
            # Retryable failure: return non-2xx so provider retries delivery.
            return Response({"error": "webhook_persistence_failed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        from apps.billing.tasks import process_psp_webhook_event
        process_psp_webhook_event.delay(str(event.id))

        return Response({"ok": True}, status=status.HTTP_200_OK)


class SettlementBatchViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    PSP settlement statement imports (optional reconciliation).
    """
    queryset = SettlementBatch.objects.all()
    serializer_class = SettlementBatchSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['file_name', 'provider']
    ordering_fields = ['created_at', 'statement_date', 'status']
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return SettlementBatch.objects.none()
        return super().get_queryset().filter(facility=facility)

    @action(detail=False, methods=['post'], url_path='import')
    @idempotent(operation_type='billing.psp.settlement.import', timeout=86400)
    def import_settlement(self, request):
        from django.utils.dateparse import parse_date

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        provider = (request.data.get('provider') or 'hubtel').strip().lower()
        if provider != 'hubtel':
            return Response({"error": "Unsupported provider."}, status=status.HTTP_400_BAD_REQUEST)

        uploaded = request.FILES.get('file')
        if not uploaded:
            return Response({"error": "file is required."}, status=status.HTTP_400_BAD_REQUEST)

        raw = uploaded.read()
        checksum = hashlib.sha256(raw).hexdigest()

        statement_date_raw = request.data.get('statement_date') or None
        statement_date = parse_date(statement_date_raw) if statement_date_raw else None

        batch = SettlementBatch.objects.create(
            facility=facility,
            provider=provider,
            statement_date=statement_date,
            status='pending',
            file_name=getattr(uploaded, 'name', '') or '',
            payload_encrypted=encrypt_payload(raw),
            payload_checksum=checksum,
            uploaded_by=request.user,
        )

        from apps.billing.tasks import process_settlement_batch
        process_settlement_batch.delay(str(batch.id))

        return Response(SettlementBatchSerializer(batch).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def lines(self, request, pk=None):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        batch = self.get_object()
        if batch.facility_id != facility.id:
            raise PermissionDenied("Settlement batch does not belong to the active facility.")

        qs = SettlementLine.objects.filter(batch=batch).select_related('matched_intent', 'matched_payment')
        page = self.paginate_queryset(qs)
        serializer = SettlementLineSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class PayerServiceCodeViewSet(viewsets.ModelViewSet):
    """
    Map internal Services to payer-specific external codes (NHIS/other).
    """
    queryset = PayerServiceCode.objects.all()
    serializer_class = PayerServiceCodeSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['external_code', 'payer__name', 'payer__code', 'service__name', 'service__code']
    ordering_fields = ['effective_from', 'created_at', 'updated_at']
    ordering = ['-effective_from']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PayerServiceCode.objects.none()
        return super().get_queryset().select_related('payer', 'service').filter(facility=facility)

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        payer = serializer.validated_data.get('payer')
        service = serializer.validated_data.get('service')
        if payer and payer.facility_id != facility.id:
            raise PermissionDenied("Payer does not belong to the active facility.")
        if service and service.facility_id != facility.id:
            raise PermissionDenied("Service does not belong to the active facility.")

        serializer.save(
            facility=facility,
            created_by=self.request.user,
            updated_by=self.request.user,
        )

    def perform_update(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        payer = serializer.validated_data.get('payer')
        service = serializer.validated_data.get('service')
        if payer and payer.facility_id != facility.id:
            raise PermissionDenied("Payer does not belong to the active facility.")
        if service and service.facility_id != facility.id:
            raise PermissionDenied("Service does not belong to the active facility.")

        serializer.save(updated_by=self.request.user)


class NHISClaimBatchViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    NHIS claim batching and export workflow.
    """
    queryset = NHISClaimBatch.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['notes', 'status']
    ordering_fields = ['period_start', 'period_end', 'created_at', 'status']
    ordering = ['-period_end', '-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return NHISClaimBatchListSerializer
        return NHISClaimBatchSerializer

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return NHISClaimBatch.objects.none()
        qs = super().get_queryset().filter(facility=facility)
        if self.action == 'list':
            qs = qs.annotate(
                claim_count=Count('claims'),
                total_claimed_amount=Sum('claims__claimed_amount'),
            )
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def perform_create(self, serializer):
        facility = get_user_facility(self.request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        serializer.save(facility=facility, created_by=self.request.user, updated_by=self.request.user)

    def create(self, request, *args, **kwargs):
        from django.utils.dateparse import parse_date

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        period_start = parse_date(request.data.get('period_start'))
        period_end = parse_date(request.data.get('period_end'))
        if not period_start or not period_end:
            return Response({"error": "period_start and period_end are required (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)
        if period_start > period_end:
            return Response({"error": "period_start must be <= period_end."}, status=status.HTTP_400_BAD_REQUEST)

        notes = request.data.get('notes') or None

        with transaction.atomic():
            batch = NHISClaimBatch.objects.create(
                facility=facility,
                period_start=period_start,
                period_end=period_end,
                status='draft',
                notes=notes,
                created_by=request.user,
                updated_by=request.user,
            )

            # Attach or create claims for eligible invoices in the period.
            invoices = Invoice.objects.select_related(
                'patient', 'patient_insurance__plan__provider'
            ).filter(
                facility=facility,
                invoice_date__gte=period_start,
                invoice_date__lte=period_end,
                insurance_amount__gt=0,
                patient_insurance__isnull=False,
                patient_insurance__plan__provider__payer_type='nhis',
            )

            for inv in invoices.iterator(chunk_size=200):
                claim, created = Claim.objects.get_or_create(
                    invoice=inv,
                    defaults={
                        'claim_number': f"CLM-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}",
                        'claimed_amount': inv.insurance_amount,
                        'status': 'draft',
                        'created_by': request.user,
                        'updated_by': request.user,
                    }
                )

                if claim.batch_id and claim.batch_id != batch.id:
                    # Preserve existing non-closed batches to avoid duplicate submission.
                    if getattr(claim.batch, 'status', None) != 'closed':
                        continue

                Claim.objects.filter(id=claim.id).update(batch=batch, updated_at=timezone.now())

        return Response(NHISClaimBatchSerializer(batch).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def claims(self, request, pk=None):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        batch = self.get_object()
        if batch.facility_id != facility.id:
            raise PermissionDenied("Batch does not belong to the active facility.")

        qs = Claim.objects.select_related('invoice__patient__user').filter(batch=batch)
        page = self.paginate_queryset(qs)
        serializer = ClaimListSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=['post'])
    def lint(self, request, pk=None):
        """
        Run NHIS claim linting for this batch and persist issues.
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        batch = self.get_object()
        if batch.facility_id != facility.id:
            raise PermissionDenied("Batch does not belong to the active facility.")

        # Delete previous issues for this batch.
        ClaimValidationIssue.objects.filter(claim__batch=batch).delete()

        claims = list(
            Claim.objects.select_related(
                'invoice__patient',
                'invoice__patient_insurance__plan__provider',
            ).prefetch_related(
                'invoice__items__service',
            ).filter(batch=batch)
        )

        payer_ids = set()
        service_ids = set()
        for claim in claims:
            inv = claim.invoice
            provider = getattr(getattr(getattr(inv, 'patient_insurance', None), 'plan', None), 'provider', None)
            if provider:
                payer_ids.add(provider.id)
            for item in inv.items.all():
                if item.service_id:
                    service_ids.add(item.service_id)

        # Prefetch codes for faster matching; apply effective range in Python.
        codes = PayerServiceCode.objects.filter(
            facility=facility,
            payer_id__in=list(payer_ids) if payer_ids else [],
            service_id__in=list(service_ids) if service_ids else [],
            is_active=True,
        ).select_related('payer', 'service')

        code_map = {}
        for code in codes:
            code_map.setdefault((code.payer_id, code.service_id), []).append(code)

        issues = []
        for claim in claims:
            inv = claim.invoice
            patient = getattr(inv, 'patient', None)
            if not getattr(patient, 'nhis_id', None):
                issues.append(ClaimValidationIssue(
                    claim=claim,
                    severity='error',
                    code='missing_nhis_id',
                    message='Patient NHIS ID is required for NHIS claim export.',
                    field='patient.nhis_id',
                ))

            if not inv.patient_insurance:
                issues.append(ClaimValidationIssue(
                    claim=claim,
                    severity='error',
                    code='missing_insurance',
                    message='Invoice must have patient insurance for NHIS claim export.',
                    field='invoice.patient_insurance',
                ))
                continue

            provider = inv.patient_insurance.plan.provider if inv.patient_insurance and inv.patient_insurance.plan else None
            if not provider or provider.payer_type != 'nhis':
                issues.append(ClaimValidationIssue(
                    claim=claim,
                    severity='error',
                    code='not_nhis_payer',
                    message='Invoice insurance provider is not configured as NHIS.',
                    field='invoice.patient_insurance.plan.provider.payer_type',
                ))
                continue

            inv_date = inv.invoice_date
            for item in inv.items.all():
                key = (provider.id, item.service_id)
                candidates = code_map.get(key) or []
                best = None
                for c in candidates:
                    if c.effective_from and c.effective_from > inv_date:
                        continue
                    if c.effective_until and c.effective_until < inv_date:
                        continue
                    if not best or c.effective_from > best.effective_from:
                        best = c
                if not best:
                    issues.append(ClaimValidationIssue(
                        claim=claim,
                        severity='error',
                        code='missing_service_mapping',
                        message='Missing NHIS service code mapping for one or more invoice items.',
                        field='invoice.items.service',
                    ))
                    break

        if issues:
            ClaimValidationIssue.objects.bulk_create(issues, batch_size=500)

        summary = ClaimValidationIssue.objects.filter(claim__batch=batch).values('severity').annotate(count=Count('id'))
        return Response({'summary': list(summary)}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    @idempotent(operation_type='billing.nhis.export.create', timeout=86400)
    def export(self, request, pk=None):
        """
        Create an NHIS claim export job and enqueue generation.
        """
        batch = self.get_object()
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if batch.facility_id != facility.id:
            raise PermissionDenied("Batch does not belong to the active facility.")

        # Block export if there are lint errors unless explicitly overridden.
        allow_errors = bool(request.data.get('allow_errors', False))
        errors_exist = ClaimValidationIssue.objects.filter(claim__batch=batch, severity='error').exists()
        if errors_exist and not allow_errors:
            return Response(
                {"error": "lint_errors", "detail": "Fix claim lint errors before exporting."},
                status=status.HTTP_400_BAD_REQUEST
            )

        from datetime import timedelta
        ttl_hours = int(getattr(settings, 'RECORD_EXPORT_TTL_HOURS', 24) or 24)
        expires_at = timezone.now() + timedelta(hours=ttl_hours)

        job = NHISClaimExportJob.objects.create(
            facility=facility,
            batch=batch,
            status='pending',
            expires_at=expires_at,
            created_by=request.user,
        )

        from apps.billing.tasks import generate_nhis_claim_export
        generate_nhis_claim_export.delay(str(job.id))

        # Mark batch as exported (workflow tracking).
        if batch.status == 'draft':
            NHISClaimBatch.objects.filter(id=batch.id).update(status='exported', updated_at=timezone.now())

        return Response(NHISClaimExportJobSerializer(job).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='status')
    def update_status(self, request, pk=None):
        """
        Update batch status (draft/exported/submitted/closed).
        """
        batch = self.get_object()
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if batch.facility_id != facility.id:
            raise PermissionDenied("Batch does not belong to the active facility.")

        new_status = (request.data.get('status') or '').strip()
        valid = {s for s, _ in NHISClaimBatch.STATUS_CHOICES}
        if new_status not in valid:
            return Response({"error": f"Invalid status. Must be one of: {', '.join(sorted(valid))}."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked = NHISClaimBatch.objects.select_for_update().get(id=batch.id)
            locked.status = new_status
            locked.updated_by = request.user
            if request.data.get('notes') is not None:
                locked.notes = request.data.get('notes') or None
            locked.save(update_fields=['status', 'updated_by', 'notes', 'updated_at'])

            # If submitted, stamp claims.
            if new_status == 'submitted':
                Claim.objects.filter(batch=locked).update(
                    status='submitted',
                    submitted_at=timezone.now(),
                    submitted_by=request.user,
                    updated_at=timezone.now(),
                )

        return Response(NHISClaimBatchSerializer(locked).data, status=status.HTTP_200_OK)


class NHISClaimExportJobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    NHIS export jobs for batch downloads.
    """
    queryset = NHISClaimExportJob.objects.all()
    serializer_class = NHISClaimExportJobSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return NHISClaimExportJob.objects.none()
        qs = super().get_queryset().select_related('batch').filter(facility=facility)
        batch_id = self.request.query_params.get('batch')
        if batch_id:
            qs = qs.filter(batch_id=batch_id)
        return qs

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """
        Download an export payload (ZIP). Payload is stored encrypted at rest.
        """
        from django.http import HttpResponse
        from apps.interop.crypto import decrypt_payload

        job = self.get_object()
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        if job.facility_id != facility.id:
            raise PermissionDenied("Export job does not belong to the active facility.")

        if job.expires_at and job.expires_at <= timezone.now():
            return Response({"error": "expired"}, status=status.HTTP_410_GONE)
        if job.status not in ('ready', 'delivered') or not job.payload_encrypted:
            return Response({"error": "not_ready"}, status=status.HTTP_400_BAD_REQUEST)

        payload = decrypt_payload(job.payload_encrypted)
        filename = f"nhis-claim-it-{job.batch_id}-{job.id}.zip"

        AuditService.log(
            request,
            action=AuditAction.REPORT_EXPORT,
            category=AuditCategory.BILLING,
            resource_type='NHISClaimExportJob',
            resource_id=str(job.id),
            description="Downloaded NHIS claim export job payload.",
            resource_name=str(job.id),
        )

        resp = HttpResponse(payload, content_type='application/zip')
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'

        if job.status == 'ready':
            NHISClaimExportJob.objects.filter(id=job.id).update(status='delivered', updated_at=timezone.now())

        return resp


class RemittanceImportJobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    Remittance import jobs for NHIS/insurance AR posting.
    """
    queryset = RemittanceImportJob.objects.all()
    serializer_class = RemittanceImportJobSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return RemittanceImportJob.objects.none()
        qs = super().get_queryset().select_related('payer').filter(facility=facility)
        payer_id = self.request.query_params.get('payer')
        if payer_id:
            qs = qs.filter(payer_id=payer_id)
        return qs

    @action(detail=False, methods=['post'], url_path='import')
    @idempotent(operation_type='billing.remittance.import', timeout=86400)
    def import_remittance(self, request):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        payer_id = request.data.get('payer')
        if not payer_id:
            return Response({"error": "payer is required."}, status=status.HTTP_400_BAD_REQUEST)
        payer = InsuranceProvider.objects.filter(id=payer_id, facility=facility).first()
        if not payer:
            return Response({"error": "payer not found."}, status=status.HTTP_404_NOT_FOUND)

        uploaded = request.FILES.get('file')
        if not uploaded:
            return Response({"error": "file is required."}, status=status.HTTP_400_BAD_REQUEST)

        raw = uploaded.read()
        checksum = hashlib.sha256(raw).hexdigest()

        job = RemittanceImportJob.objects.create(
            facility=facility,
            payer=payer,
            status='pending',
            file_name=getattr(uploaded, 'name', '') or '',
            payload_encrypted=encrypt_payload(raw),
            payload_checksum=checksum,
            created_by=request.user,
        )

        from apps.billing.tasks import process_remittance_import_job
        process_remittance_import_job.delay(str(job.id))

        return Response(RemittanceImportJobSerializer(job).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def lines(self, request, pk=None):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        job = self.get_object()
        if job.facility_id != facility.id:
            raise PermissionDenied("Remittance job does not belong to the active facility.")

        qs = RemittanceLine.objects.filter(job=job).select_related('matched_claim', 'matched_invoice')
        page = self.paginate_queryset(qs)
        serializer = RemittanceLineSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class PayerServiceCodeImportJobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """
    Bulk import for payer service code mappings (NHIS/other).

    Two-step:
    1) Upload file -> async preview parse/validate
    2) Apply -> async upsert mappings (and optionally seed services)
    """
    queryset = PayerServiceCodeImportJob.objects.all()
    serializer_class = PayerServiceCodeImportJobSerializer
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]
    pagination_class = StandardResultsSetPagination
    ordering = ['-created_at']

    def get_queryset(self):
        facility = get_user_facility(self.request)
        if not facility:
            return PayerServiceCodeImportJob.objects.none()
        qs = super().get_queryset().select_related('payer').filter(facility=facility)
        payer_id = self.request.query_params.get('payer')
        if payer_id:
            qs = qs.filter(payer_id=payer_id)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @action(detail=False, methods=['post'], url_path='import')
    @idempotent(operation_type='billing.payer_service_code_import.create', timeout=86400)
    def import_file(self, request):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        payer_id = request.data.get('payer')
        if not payer_id:
            return Response({"error": "payer is required."}, status=status.HTTP_400_BAD_REQUEST)
        payer = InsuranceProvider.objects.filter(id=payer_id, facility=facility).first()
        if not payer:
            return Response({"error": "payer not found."}, status=status.HTTP_404_NOT_FOUND)

        uploaded = request.FILES.get('file')
        if not uploaded:
            return Response({"error": "file is required."}, status=status.HTTP_400_BAD_REQUEST)

        seed_raw = request.data.get('seed_services', False)
        seed_services = str(seed_raw).strip().lower() in ('1', 'true', 't', 'yes', 'y')

        raw = uploaded.read()
        checksum = hashlib.sha256(raw).hexdigest()

        job = PayerServiceCodeImportJob.objects.create(
            facility=facility,
            payer=payer,
            status='pending',
            seed_services=seed_services,
            file_name=getattr(uploaded, 'name', '') or '',
            payload_encrypted=encrypt_payload(raw),
            payload_checksum=checksum,
            created_by=request.user,
        )

        from apps.billing.tasks import process_payer_service_code_import_job
        process_payer_service_code_import_job.delay(str(job.id))

        return Response(PayerServiceCodeImportJobSerializer(job).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    @idempotent(operation_type='billing.payer_service_code_import.apply', timeout=86400)
    def apply(self, request, pk=None):
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        job = self.get_object()
        if job.facility_id != facility.id:
            raise PermissionDenied("Import job does not belong to the active facility.")

        if job.status not in ('preview_ready',):
            return Response({"error": "not_ready", "detail": "Preview must be ready before applying."}, status=status.HTTP_400_BAD_REQUEST)

        force = bool(request.data.get('force', False))
        summary = job.summary or {}
        errors = int(summary.get('errors', 0) or 0)
        if errors > 0 and not force:
            return Response(
                {"error": "preview_errors", "detail": "Fix preview errors before applying.", "summary": summary},
                status=status.HTTP_400_BAD_REQUEST
            )

        from apps.billing.tasks import apply_payer_service_code_import_job
        apply_payer_service_code_import_job.delay(str(job.id))

        # Reflect immediate status transition best-effort.
        PayerServiceCodeImportJob.objects.filter(id=job.id, status='preview_ready').update(
            status='applying',
            updated_at=timezone.now(),
        )
        job.refresh_from_db()

        return Response(PayerServiceCodeImportJobSerializer(job).data, status=status.HTTP_200_OK)


class AccountsReceivableViewSet(viewsets.ViewSet):
    """
    CFO-grade insurance AR analytics (no GL).
    """
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]

    @action(detail=False, methods=['get'])
    def insurance_aging(self, request):
        """
        Insurance AR aging buckets (0-30, 31-60, 61-90, 90+).

        Query params:
        - basis: invoice_date|claim_submission_date (default invoice_date)
        """
        from datetime import timedelta
        from django.db.models.functions import Coalesce

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        basis = (request.query_params.get('basis') or 'invoice_date').strip()
        today = timezone.now().date()
        cut30 = today - timedelta(days=30)
        cut60 = today - timedelta(days=60)
        cut90 = today - timedelta(days=90)

        qs = Invoice.objects.filter(
            facility=facility,
            insurance_amount__gt=0,
        ).annotate(
            insurance_paid=Coalesce(
                Sum('payments__amount', filter=Q(payments__status='posted', payments__payer='insurance')),
                Value(Decimal('0.00')),
            ),
        ).annotate(
            insurance_balance_due=F('insurance_amount') - F('insurance_paid'),
        ).filter(insurance_balance_due__gt=0)

        if basis == 'claim_submission_date':
            qs = qs.filter(claim__isnull=False)
            date_field = 'claim__submission_date'
        else:
            date_field = 'invoice_date'

        buckets = qs.aggregate(
            bucket_0_30=Sum('insurance_balance_due', filter=Q(**{f"{date_field}__gte": cut30})),
            bucket_31_60=Sum('insurance_balance_due', filter=Q(**{f"{date_field}__lt": cut30, f"{date_field}__gte": cut60})),
            bucket_61_90=Sum('insurance_balance_due', filter=Q(**{f"{date_field}__lt": cut60, f"{date_field}__gte": cut90})),
            bucket_90_plus=Sum('insurance_balance_due', filter=Q(**{f"{date_field}__lt": cut90})),
            total=Sum('insurance_balance_due'),
            invoice_count=Count('id'),
        )

        return Response({k: str(v or Decimal('0.00')) if k.startswith('bucket_') or k == 'total' else v for k, v in buckets.items()})

    @action(detail=False, methods=['get'])
    def insurance_dso(self, request):
        """
        Weighted DSO for outstanding insurance balances.
        """
        from django.db.models.functions import Now, Cast, Extract, Coalesce
        from django.db.models import DateTimeField, DurationField, ExpressionWrapper

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        basis = (request.query_params.get('basis') or 'invoice_date').strip()
        if basis == 'claim_submission_date':
            qs = Invoice.objects.filter(facility=facility, insurance_amount__gt=0, claim__isnull=False)
            basis_field = 'claim__submission_date'
        else:
            qs = Invoice.objects.filter(facility=facility, insurance_amount__gt=0)
            basis_field = 'invoice_date'

        qs = qs.annotate(
            insurance_paid=Coalesce(
                Sum('payments__amount', filter=Q(payments__status='posted', payments__payer='insurance')),
                Value(Decimal('0.00')),
            ),
        ).annotate(
            insurance_balance_due=F('insurance_amount') - F('insurance_paid'),
        ).filter(insurance_balance_due__gt=0)

        basis_dt = Cast(F(basis_field), output_field=DateTimeField())
        age = ExpressionWrapper(Now() - basis_dt, output_field=DurationField())
        age_days = Extract(age, 'day')

        weighted = ExpressionWrapper(
            F('insurance_balance_due') * age_days,
            output_field=DecimalField(max_digits=20, decimal_places=2),
        )

        agg = qs.aggregate(
            total_balance=Sum('insurance_balance_due'),
            weighted_sum=Sum(weighted),
        )
        total_balance = agg.get('total_balance') or Decimal('0.00')
        weighted_sum = agg.get('weighted_sum') or Decimal('0.00')
        dso = (weighted_sum / total_balance) if total_balance > 0 else Decimal('0.00')

        return Response({
            'basis': basis,
            'total_balance': str(total_balance),
            'dso_days': float(dso),
        })

    @action(detail=False, methods=['get'])
    def remittance_queue(self, request):
        """
        Denial/underpayment queues from remittance imports.
        """
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        qs = RemittanceLine.objects.filter(job__facility=facility)
        summary = qs.values('match_status').annotate(
            count=Count('id'),
            total_paid=Sum('paid_amount'),
        ).order_by('match_status')
        return Response({'summary': list(summary)})


class BillingDashboardViewSet(viewsets.ViewSet):
    """
    API endpoint for billing dashboard metrics.

    Provides aggregated billing data for dashboard displays.

    Performance optimizations:
    - View-level caching (30s TTL) for metrics endpoint
    - Conditional aggregation to consolidate ~15 queries into 4
    - Database indexes on invoice_date, payment_date, status, facility_id
    """
    permission_classes = [permissions.IsAuthenticated, IsBillingStaff, FacilityScopedPermission]

    @method_decorator(vary_on_headers('X-Facility-Code'))
    @method_decorator(cache_page(30))  # Cache for 30 seconds
    @action(detail=False, methods=['get'])
    def metrics(self, request):
        """
        Get billing dashboard metrics.

        Query params:
        - facility: Filter by facility ID
        - date_from: Start date (YYYY-MM-DD)
        - date_to: End date (YYYY-MM-DD)

        Performance: Uses conditional aggregation to reduce database queries
        from ~15 to 4. Cached for 30 seconds.
        """
        from datetime import timedelta

        today = timezone.now().date()
        week_start = today - timedelta(days=today.weekday())
        month_start = today.replace(day=1)
        last_month_start = (month_start - timedelta(days=1)).replace(day=1)

        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        facility_id = request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        invoice_filter = Q(facility_id=facility.id)
        payment_filter = Q(invoice__facility_id=facility.id)
        claim_filter = Q(invoice__facility_id=facility.id)

        # =================================================================
        # QUERY 1: All invoice metrics in a single query using conditional aggregation
        # Replaces 8+ separate queries
        # =================================================================
        invoice_metrics = Invoice.objects.filter(invoice_filter).aggregate(
            # Counts by status
            total_invoices=Count('id'),
            pending_invoices=Count('id', filter=Q(status='pending')),
            overdue_invoices=Count('id', filter=Q(status='overdue')),
            paid_invoices=Count('id', filter=Q(status='paid')),
            outstanding_invoices=Count('id', filter=Q(status__in=['pending', 'partially_paid'])),

            # Outstanding amount (pending + partially_paid)
            outstanding_amount=Sum(
                F('total_amount') - F('insurance_amount'),
                filter=Q(status__in=['pending', 'partially_paid'])
            ),

            # Total overdue amount
            total_overdue=Sum(
                F('total_amount') - F('insurance_amount'),
                filter=Q(status='overdue')
            ),

            # Today's invoices created
            invoices_created_today=Count('id', filter=Q(invoice_date=today)),

            # Average invoice amount (excluding drafts)
            average_invoice_amount=Avg('total_amount', filter=~Q(status='draft')),
        )

        # Unique patients billed this month (separate query - can't combine with above)
        unique_patients_billed = Invoice.objects.filter(
            invoice_filter,
            invoice_date__gte=month_start
        ).values('patient').distinct().count()

        # =================================================================
        # QUERY 2: All payment/revenue metrics in a single query
        # Replaces 5+ separate queries
        # =================================================================
        payment_metrics = Payment.objects.filter(payment_filter, status='posted').aggregate(
            # Revenue by time period using conditional sums
            revenue_today=Sum('amount', filter=Q(payment_date=today)),
            revenue_this_week=Sum('amount', filter=Q(payment_date__gte=week_start)),
            revenue_this_month=Sum('amount', filter=Q(payment_date__gte=month_start)),
            revenue_last_month=Sum(
                'amount',
                filter=Q(payment_date__gte=last_month_start, payment_date__lt=month_start)
            ),

            # Today's payment count
            payments_received_today=Count('id', filter=Q(payment_date=today)),

            # Patient payments posted against outstanding invoices (netting support)
            patient_payments_on_outstanding=Sum(
                'amount',
                filter=Q(payer='patient', invoice__status__in=['pending', 'partially_paid'])
            ),
        )

        # Calculate revenue trend
        revenue_this_month = payment_metrics['revenue_this_month'] or Decimal('0')
        revenue_last_month = payment_metrics['revenue_last_month'] or Decimal('0')

        if revenue_last_month > 0:
            revenue_trend = ((revenue_this_month - revenue_last_month) / revenue_last_month) * 100
        else:
            revenue_trend = Decimal('0')

        # =================================================================
        # QUERY 3: All claims metrics in a single query
        # Replaces 3+ separate queries
        # =================================================================
        claims_metrics = Claim.objects.filter(claim_filter).aggregate(
            pending_claims=Count('id', filter=Q(status__in=['submitted', 'in_review'])),
            pending_claims_amount=Sum('claimed_amount', filter=Q(status__in=['submitted', 'in_review'])),
            approved_claims_amount=Sum(
                'approved_amount',
                filter=Q(status__in=['approved', 'partially_approved'])
            ),
        )

        # =================================================================
        # QUERY 4: Payment method breakdown (this month)
        # =================================================================
        payment_methods = list(Payment.objects.filter(
            payment_filter,
            status='posted',
            payment_date__gte=month_start
        ).values('payment_method').annotate(
            total=Sum('amount'),
            count=Count('id')
        ).order_by('-total'))

        raw_outstanding = invoice_metrics['outstanding_amount'] or Decimal('0')
        net_outstanding = raw_outstanding - (payment_metrics.get('patient_payments_on_outstanding') or Decimal('0'))
        if net_outstanding < 0:
            net_outstanding = Decimal('0')

        # Build response data
        data = {
            # Revenue metrics
            'revenue_today': payment_metrics['revenue_today'] or Decimal('0'),
            'revenue_this_week': payment_metrics['revenue_this_week'] or Decimal('0'),
            'revenue_this_month': revenue_this_month,
            'revenue_trend': round(revenue_trend, 2),

            # Invoice metrics
            'total_invoices': invoice_metrics['total_invoices'] or 0,
            'pending_invoices': invoice_metrics['pending_invoices'] or 0,
            'overdue_invoices': invoice_metrics['overdue_invoices'] or 0,
            'paid_invoices': invoice_metrics['paid_invoices'] or 0,
            'outstanding_amount': net_outstanding,
            'outstanding_invoices': invoice_metrics['outstanding_invoices'] or 0,
            'total_overdue': invoice_metrics['total_overdue'] or Decimal('0'),

            # Claims metrics
            'pending_claims': claims_metrics['pending_claims'] or 0,
            'pending_claims_amount': claims_metrics['pending_claims_amount'] or Decimal('0'),
            'approved_claims_amount': claims_metrics['approved_claims_amount'] or Decimal('0'),

            # Activity metrics
            'invoices_created_today': invoice_metrics['invoices_created_today'] or 0,
            'payments_received_today': payment_metrics['payments_received_today'] or 0,
            'unique_patients_billed': unique_patients_billed,
            'average_invoice_amount': invoice_metrics['average_invoice_amount'] or Decimal('0'),
            'payment_methods': payment_methods,
        }

        serializer = BillingDashboardMetricsSerializer(data)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def recent_invoices(self, request):
        """Get recent invoices for dashboard."""
        limit = int(request.query_params.get('limit', 10))
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        facility_id = request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        invoices = Invoice.objects.select_related(
            'patient__user'
        ).order_by('-created_at')

        invoices = invoices.filter(facility_id=facility.id)

        invoices = invoices[:limit]
        serializer = RecentInvoiceSerializer(invoices, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def recent_payments(self, request):
        """Get recent payments for dashboard."""
        limit = int(request.query_params.get('limit', 10))
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")
        facility_id = request.query_params.get('facility')
        if facility_id and str(facility_id) != str(facility.id):
            raise PermissionDenied("Facility filter does not match active facility.")

        payments = Payment.objects.select_related(
            'invoice'
        ).order_by('-created_at')

        payments = payments.filter(invoice__facility_id=facility.id, status='posted')

        payments = payments[:limit]
        serializer = RecentPaymentSerializer(payments, many=True)
        return Response(serializer.data)


from apps.core.features import attach_required_feature, bind_required_feature

bind_required_feature(globals(), 'billing')
attach_required_feature(
    [
        ClaimViewSet,
        NHISClaimBatchViewSet,
        NHISClaimExportJobViewSet,
        RemittanceImportJobViewSet,
        PayerServiceCodeImportJobViewSet,
        AccountsReceivableViewSet,
    ],
    'insurance_claims',
)
