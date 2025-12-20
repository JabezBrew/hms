import uuid
from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from django.db.models import Sum, F, Q, Avg, Count, Case, When, Value
from decimal import Decimal
from ..fhir_client.client import fhir_client
from ..fhir_client.utils import generate_fhir_id, create_reference

from .models import (
    ServiceCategory, Service, InsuranceProvider, InsurancePlan,
    PatientInsurance, Invoice, InvoiceItem, Payment, Claim, Receipt,
    BillingRule, FacilityBillingSettings
)
from .serializers import (
    ServiceCategorySerializer, ServiceSerializer, ServiceListSerializer,
    InsuranceProviderSerializer, InsurancePlanSerializer,
    PatientInsuranceSerializer, PatientInsuranceListSerializer,
    InvoiceSerializer, InvoiceListSerializer, InvoiceCreateUpdateSerializer,
    InvoiceItemSerializer,
    PaymentSerializer, PaymentListSerializer,
    ClaimSerializer, ClaimListSerializer,
    ReceiptSerializer, ReceiptDetailSerializer,
    BillingRuleSerializer, BillingRuleListSerializer,
    FacilityBillingSettingsSerializer,
    BillingDashboardMetricsSerializer, RecentInvoiceSerializer, RecentPaymentSerializer
)
from ..users.permissions import IsAdminOrOwner
from apps.core.pagination import StandardResultsSetPagination as CorePagination
from apps.audit.models import AuditAction, AuditCategory
from apps.audit.services import AuditService


class StandardResultsSetPagination(PageNumberPagination):
    """Standard pagination for billing endpoints."""
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class ServiceCategoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for service categories.
    """
    queryset = ServiceCategory.objects.all()
    serializer_class = ServiceCategorySerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class ServiceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for services.
    """
    queryset = Service.objects.all()
    serializer_class = ServiceSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'code', 'category__name']
    ordering_fields = ['name', 'base_price', 'category__name', 'created_at']
    ordering = ['category__name', 'name']

    def get_serializer_class(self):
        if self.action == 'list':
            return ServiceListSerializer
        return ServiceSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def by_category(self, request):
        """
        Get services grouped by category.
        """
        categories = ServiceCategory.objects.filter(is_active=True)
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
    """
    queryset = InsuranceProvider.objects.all()
    serializer_class = InsuranceProviderSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'contact_person', 'email', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

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
    """
    queryset = InsurancePlan.objects.all()
    serializer_class = InsurancePlanSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'description', 'provider__name']
    ordering_fields = ['name', 'provider__name', 'coverage_percentage', 'created_at']
    ordering = ['provider__name', 'name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientInsuranceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient insurance.
    """
    queryset = PatientInsurance.objects.all()
    serializer_class = PatientInsuranceSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'policy_number', 'plan__name', 'plan__provider__name']
    ordering_fields = ['valid_from', 'valid_until', 'created_at']
    ordering = ['-valid_from']

    def get_serializer_class(self):
        if self.action == 'list':
            return PatientInsuranceListSerializer
        return PatientInsuranceSerializer

    def perform_create(self, serializer):
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
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['invoice_number', 'patient__user__first_name', 'patient__user__last_name']
    ordering_fields = ['invoice_date', 'due_date', 'total_amount', 'status', 'created_at']
    ordering = ['-invoice_date']

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

        queryset = super().get_queryset().select_related(
            'patient__user', 'facility', 'patient_insurance__plan__provider'
        ).prefetch_related('items', payments_prefetch)

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by facility
        facility_id = self.request.query_params.get('facility')
        if facility_id:
            queryset = queryset.filter(facility_id=facility_id)

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
            # Generate claim number
            claim_number = f"CLM-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Create FHIR Claim resource if FHIR integration is enabled
            fhir_claim_id = None
            if invoice.patient.fhir_patient_id:
                try:
                    # Create FHIR Claim
                    claim_data = {
                        "resourceType": "Claim",
                        "id": generate_fhir_id(),
                        "status": "active",
                        "type": {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                                    "code": "professional",
                                    "display": "Professional"
                                }
                            ]
                        },
                        "use": "claim",
                        "patient": create_reference("Patient", invoice.patient.fhir_patient_id),
                        "created": invoice.invoice_date.isoformat(),
                        "provider": {
                            "display": "Hospital Management System"
                        },
                        "priority": {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/processpriority",
                                    "code": "normal"
                                }
                            ]
                        },
                        "insurance": [
                            {
                                "sequence": 1,
                                "focal": True,
                                "coverage": {
                                    "display": f"{invoice.patient_insurance.plan.provider.name} - {invoice.patient_insurance.plan.name}"
                                }
                            }
                        ],
                        "item": []
                    }

                    # Add items
                    for idx, item in enumerate(invoice.items.all()):
                        claim_data["item"].append({
                            "sequence": idx + 1,
                            "productOrService": {
                                "coding": [
                                    {
                                        "system": "http://hospital.example.org/fhir/service",
                                        "code": item.service.code,
                                        "display": item.service.name
                                    }
                                ]
                            },
                            "unitPrice": {
                                "value": float(item.unit_price),
                                "currency": "USD"
                            },
                            "net": {
                                "value": float(item.total_price),
                                "currency": "USD"
                            }
                        })

                    # Create the claim in FHIR
                    fhir_claim = fhir_client.create_resource("Claim", claim_data)
                    fhir_claim_id = fhir_claim["id"]

                except Exception as e:
                    # Log the error but continue (we don't want to roll back the claim creation)
                    print(f"Failed to create FHIR Claim: {str(e)}")

            # Create the claim
            claim = Claim.objects.create(
                claim_number=claim_number,
                invoice=invoice,
                claimed_amount=invoice.insurance_amount,
                fhir_claim_id=fhir_claim_id,
                created_by=request.user,
                updated_by=request.user
            )

            # Update the invoice with the FHIR claim ID
            if fhir_claim_id:
                invoice.fhir_claim_id = fhir_claim_id
                invoice.save()

            return Response(ClaimSerializer(claim).data)

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
            description=f"Printed invoice {invoice.invoice_number} for {invoice.patient.user.get_full_name()} - Amount: {invoice.total_amount}",
            resource_name=invoice.invoice_number,
        )

        serializer = InvoiceSerializer(invoice)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def mark_as_paid(self, request, pk=None):
        """
        Mark an invoice as paid.
        """
        invoice = self.get_object()

        # Check if invoice is already paid
        if invoice.status == 'paid':
            return Response(
                {"error": "Invoice is already marked as paid."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get payment details from request
        payment_method = request.data.get('payment_method', 'cash')
        reference_number = request.data.get('reference_number', '')
        notes = request.data.get('notes', '')

        # If amount is not provided, use the balance due
        amount = request.data.get('amount', None)
        if amount is None:
            amount = invoice.balance_due
        else:
            amount = float(amount)

        with transaction.atomic():
            # Create payment
            payment = Payment.objects.create(
                invoice=invoice,
                amount=amount,
                payment_method=payment_method,
                reference_number=reference_number,
                notes=notes,
                created_by=request.user,
                updated_by=request.user
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

            return Response({
                "message": "Invoice marked as paid.",
                "payment": PaymentSerializer(payment).data,
                "receipt": ReceiptSerializer(receipt).data
            })


class InvoiceItemViewSet(viewsets.ModelViewSet):
    """
    API endpoint for invoice items.
    """
    queryset = InvoiceItem.objects.all()
    serializer_class = InvoiceItemSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['service__name', 'description', 'invoice__invoice_number']
    ordering_fields = ['service__name', 'quantity', 'unit_price', 'created_at']
    ordering = ['service__name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PaymentViewSet(viewsets.ModelViewSet):
    """
    API endpoint for payments.
    """
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
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
        queryset = super().get_queryset().select_related(
            'invoice__patient__user', 'invoice__facility',
            'receipt', 'created_by'
        )

        # Filter by payment method
        payment_method = self.request.query_params.get('payment_method')
        if payment_method:
            queryset = queryset.filter(payment_method=payment_method)

        # Filter by facility
        facility_id = self.request.query_params.get('facility')
        if facility_id:
            queryset = queryset.filter(invoice__facility_id=facility_id)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(payment_date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(payment_date__lte=date_to)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def generate_receipt(self, request, pk=None):
        """
        Generate a receipt for a payment.
        """
        payment = self.get_object()

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


class ClaimViewSet(viewsets.ModelViewSet):
    """
    API endpoint for claims.
    """
    queryset = Claim.objects.all()
    serializer_class = ClaimSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
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
        queryset = super().get_queryset().select_related(
            'invoice__patient__user', 'invoice__facility'
        )

        # Filter by status
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # Filter by facility
        facility_id = self.request.query_params.get('facility')
        if facility_id:
            queryset = queryset.filter(invoice__facility_id=facility_id)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(submission_date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(submission_date__lte=date_to)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

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

        # Update claim
        claim.status = new_status
        claim.response_date = timezone.now().date()

        if approved_amount is not None:
            claim.approved_amount = float(approved_amount)

        if rejection_reason is not None:
            claim.rejection_reason = rejection_reason

        claim.updated_by = request.user
        claim.save()

        # If claim is approved or partially approved, create a payment from insurance
        if new_status in ['approved', 'partially_approved'] and claim.approved_amount > 0:
            # Create payment
            payment = Payment.objects.create(
                invoice=claim.invoice,
                amount=claim.approved_amount,
                payment_method='insurance',
                reference_number=f"INS-{claim.claim_number}",
                notes=f"Insurance payment for claim {claim.claim_number}",
                created_by=request.user,
                updated_by=request.user
            )

            # Generate receipt number
            receipt_number = f"RCP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Create receipt
            Receipt.objects.create(
                receipt_number=receipt_number,
                payment=payment,
                created_by=request.user,
                updated_by=request.user
            )

        return Response(ClaimSerializer(claim).data)


class ReceiptViewSet(viewsets.ModelViewSet):
    """
    API endpoint for receipts.
    """
    queryset = Receipt.objects.all()
    serializer_class = ReceiptSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['receipt_number', 'payment__invoice__invoice_number', 'payment__reference_number']
    ordering_fields = ['receipt_date', 'created_at']
    ordering = ['-receipt_date']

    def get_queryset(self):
        return super().get_queryset().select_related(
            'payment__invoice__patient__user',
            'payment__invoice__facility',
            'payment__created_by'
        ).prefetch_related(
            'payment__invoice__items__service'
        )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

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
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
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
        queryset = super().get_queryset()

        # Filter by facility
        facility_id = self.request.query_params.get('facility')
        if facility_id:
            queryset = queryset.filter(
                Q(facility_id=facility_id) | Q(facility__isnull=True)
            )

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
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = super().get_queryset()

        # Filter by facility
        facility_id = self.request.query_params.get('facility')
        if facility_id:
            queryset = queryset.filter(facility_id=facility_id)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class BillingDashboardViewSet(viewsets.ViewSet):
    """
    API endpoint for billing dashboard metrics.

    Provides aggregated billing data for dashboard displays.

    Performance optimizations:
    - View-level caching (30s TTL) for metrics endpoint
    - Conditional aggregation to consolidate ~15 queries into 4
    - Database indexes on invoice_date, payment_date, status, facility_id
    """
    permission_classes = [permissions.IsAuthenticated]

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

        # Base querysets with facility filter
        facility_id = request.query_params.get('facility')
        invoice_filter = Q(facility_id=facility_id) if facility_id else Q()
        payment_filter = Q(invoice__facility_id=facility_id) if facility_id else Q()
        claim_filter = Q(invoice__facility_id=facility_id) if facility_id else Q()

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
        payment_metrics = Payment.objects.filter(payment_filter).aggregate(
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
            pending_claims=Count('id', filter=Q(status='pending')),
            pending_claims_amount=Sum('claimed_amount', filter=Q(status='pending')),
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
            payment_date__gte=month_start
        ).values('payment_method').annotate(
            total=Sum('amount'),
            count=Count('id')
        ).order_by('-total'))

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
            'outstanding_amount': invoice_metrics['outstanding_amount'] or Decimal('0'),
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
        facility_id = request.query_params.get('facility')

        invoices = Invoice.objects.select_related(
            'patient__user'
        ).order_by('-created_at')

        if facility_id:
            invoices = invoices.filter(facility_id=facility_id)

        invoices = invoices[:limit]
        serializer = RecentInvoiceSerializer(invoices, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def recent_payments(self, request):
        """Get recent payments for dashboard."""
        limit = int(request.query_params.get('limit', 10))
        facility_id = request.query_params.get('facility')

        payments = Payment.objects.select_related(
            'invoice'
        ).order_by('-created_at')

        if facility_id:
            payments = payments.filter(invoice__facility_id=facility_id)

        payments = payments[:limit]
        serializer = RecentPaymentSerializer(payments, many=True)
        return Response(serializer.data)
