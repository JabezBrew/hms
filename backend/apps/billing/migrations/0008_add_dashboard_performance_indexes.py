# Generated migration for billing dashboard performance optimization

from django.db import migrations, models


class Migration(migrations.Migration):
    """
    Add database indexes to optimize billing dashboard metrics queries.

    These indexes support the conditional aggregation queries in
    BillingDashboardViewSet.metrics() which filter on:
    - Payment: payment_date (for date-based revenue calculations)
    - Payment: invoice + payment_date (for facility-filtered queries)
    - Claim: status (for pending/approved claim counts)
    - Claim: status + submission_date (for filtered claim queries)
    """

    dependencies = [
        ('billing', '0007_fix_date_fields_and_receipt_number_length'),
    ]

    operations = [
        # Payment indexes for revenue calculations
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(
                fields=['payment_date'],
                name='billing_pay_payment_date_idx'
            ),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(
                fields=['invoice', 'payment_date'],
                name='billing_pay_inv_date_idx'
            ),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(
                fields=['payment_method', 'payment_date'],
                name='billing_pay_method_date_idx'
            ),
        ),

        # Claim indexes for claims metrics
        migrations.AddIndex(
            model_name='claim',
            index=models.Index(
                fields=['status'],
                name='billing_claim_status_idx'
            ),
        ),
        migrations.AddIndex(
            model_name='claim',
            index=models.Index(
                fields=['status', 'submission_date'],
                name='billing_claim_stat_date_idx'
            ),
        ),
    ]
