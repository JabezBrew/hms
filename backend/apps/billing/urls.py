from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ServiceCategoryViewSet, ServiceViewSet, InsuranceProviderViewSet,
    InsurancePlanViewSet, PatientInsuranceViewSet, InvoiceViewSet,
    InvoiceItemViewSet, PaymentViewSet, ClaimViewSet, ReceiptViewSet,
    BillingRuleViewSet, FacilityBillingSettingsViewSet, BillingDashboardViewSet
)

router = DefaultRouter()
router.register(r'service-categories', ServiceCategoryViewSet)
router.register(r'services', ServiceViewSet)
router.register(r'insurance-providers', InsuranceProviderViewSet)
router.register(r'insurance-plans', InsurancePlanViewSet)
router.register(r'patient-insurances', PatientInsuranceViewSet)
router.register(r'invoices', InvoiceViewSet)
router.register(r'invoice-items', InvoiceItemViewSet)
router.register(r'payments', PaymentViewSet)
router.register(r'claims', ClaimViewSet)
router.register(r'receipts', ReceiptViewSet)
router.register(r'billing-rules', BillingRuleViewSet)
router.register(r'billing-settings', FacilityBillingSettingsViewSet)
router.register(r'dashboard', BillingDashboardViewSet, basename='billing-dashboard')

urlpatterns = [
    path('', include(router.urls)),
]
