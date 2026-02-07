from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ServiceCategoryViewSet, ServiceViewSet, InsuranceProviderViewSet,
    InsurancePlanViewSet, PatientInsuranceViewSet, InvoiceViewSet,
    InvoiceItemViewSet, PaymentViewSet, ClaimViewSet, ReceiptViewSet,
    BillingRuleViewSet, FacilityBillingSettingsViewSet, BillingDashboardViewSet,
    CashDrawerViewSet, CashSessionViewSet, CashMovementViewSet,
    PaymentIntentViewSet, SettlementBatchViewSet, HubtelWebhookView,
    PayerServiceCodeViewSet,
    NHISClaimBatchViewSet, NHISClaimExportJobViewSet, RemittanceImportJobViewSet,
    AccountsReceivableViewSet, PayerServiceCodeImportJobViewSet,
)

router = DefaultRouter()
router.register(r'service-categories', ServiceCategoryViewSet)
router.register(r'services', ServiceViewSet)
router.register(r'insurance-providers', InsuranceProviderViewSet)
router.register(r'insurance-plans', InsurancePlanViewSet)
router.register(r'payer-service-codes', PayerServiceCodeViewSet)
router.register(r'patient-insurances', PatientInsuranceViewSet)
router.register(r'invoices', InvoiceViewSet)
router.register(r'invoice-items', InvoiceItemViewSet)
router.register(r'payments', PaymentViewSet)
router.register(r'claims', ClaimViewSet)
router.register(r'receipts', ReceiptViewSet)
router.register(r'payment-intents', PaymentIntentViewSet, basename='payment-intents')
router.register(r'settlements', SettlementBatchViewSet, basename='settlements')
router.register(r'cash-drawers', CashDrawerViewSet)
router.register(r'cash-sessions', CashSessionViewSet)
router.register(r'cash-movements', CashMovementViewSet)
router.register(r'billing-rules', BillingRuleViewSet)
router.register(r'billing-settings', FacilityBillingSettingsViewSet)
router.register(r'dashboard', BillingDashboardViewSet, basename='billing-dashboard')

nhis_router = DefaultRouter()
nhis_router.register(r'batches', NHISClaimBatchViewSet, basename='nhis-batches')
nhis_router.register(r'exports', NHISClaimExportJobViewSet, basename='nhis-exports')
nhis_router.register(r'remittances', RemittanceImportJobViewSet, basename='nhis-remittances')
nhis_router.register(r'ar', AccountsReceivableViewSet, basename='nhis-ar')
nhis_router.register(r'mapping-imports', PayerServiceCodeImportJobViewSet, basename='nhis-mapping-imports')

urlpatterns = [
    path('psp/webhooks/hubtel/', HubtelWebhookView.as_view(), name='billing-hubtel-webhook'),
    path('nhis/', include(nhis_router.urls)),
    path('', include(router.urls)),
]
