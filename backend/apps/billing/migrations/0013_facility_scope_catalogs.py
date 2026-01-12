from django.db import migrations, models


def set_billing_catalog_facilities(apps, schema_editor):
    Facility = apps.get_model('core', 'Facility')
    ServiceCategory = apps.get_model('billing', 'ServiceCategory')
    Service = apps.get_model('billing', 'Service')
    InsuranceProvider = apps.get_model('billing', 'InsuranceProvider')
    InsurancePlan = apps.get_model('billing', 'InsurancePlan')

    facility = Facility.objects.order_by('created_at').first()
    if not facility:
        return

    ServiceCategory.objects.filter(facility__isnull=True).update(facility=facility)

    for service in Service.objects.filter(facility__isnull=True).select_related('category'):
        if service.category_id and service.category.facility_id:
            service.facility_id = service.category.facility_id
        else:
            service.facility_id = facility.id
        service.save(update_fields=['facility'])

    InsuranceProvider.objects.filter(facility__isnull=True).update(facility=facility)

    for plan in InsurancePlan.objects.filter(facility__isnull=True).select_related('provider'):
        if plan.provider_id and plan.provider.facility_id:
            plan.facility_id = plan.provider.facility_id
        else:
            plan.facility_id = facility.id
        plan.save(update_fields=['facility'])


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('billing', '0012_rename_billing_invoice_item_facility_service_idx_billing_inv_facilit_bfbe06_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='servicecategory',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='service_categories', to='core.facility'),
        ),
        migrations.AddField(
            model_name='service',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='services', to='core.facility'),
        ),
        migrations.AddField(
            model_name='insuranceprovider',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='insurance_providers', to='core.facility'),
        ),
        migrations.AddField(
            model_name='insuranceplan',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='insurance_plans', to='core.facility'),
        ),
        migrations.RunPython(set_billing_catalog_facilities, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='servicecategory',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='service_categories', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='service',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='services', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='insuranceprovider',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='insurance_providers', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='insuranceplan',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='insurance_plans', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='service',
            name='code',
            field=models.CharField(max_length=20),
        ),
        migrations.AlterField(
            model_name='insuranceprovider',
            name='code',
            field=models.CharField(max_length=20),
        ),
        migrations.AddConstraint(
            model_name='service',
            constraint=models.UniqueConstraint(fields=('facility', 'code'), name='service_facility_code_uniq'),
        ),
        migrations.AddConstraint(
            model_name='insuranceprovider',
            constraint=models.UniqueConstraint(fields=('facility', 'code'), name='insurance_provider_facility_code_uniq'),
        ),
        migrations.AddConstraint(
            model_name='insuranceplan',
            constraint=models.UniqueConstraint(fields=('facility', 'provider', 'code'), name='insurance_plan_facility_provider_code_uniq'),
        ),
        migrations.AddIndex(
            model_name='servicecategory',
            index=models.Index(fields=['facility', 'name'], name='billing_servi_facility_name_idx'),
        ),
        migrations.AddIndex(
            model_name='service',
            index=models.Index(fields=['facility', 'code'], name='billing_servi_facility_code_idx'),
        ),
        migrations.AddIndex(
            model_name='service',
            index=models.Index(fields=['facility', 'is_active'], name='billing_servi_facility_active_idx'),
        ),
        migrations.AddIndex(
            model_name='insuranceprovider',
            index=models.Index(fields=['facility', 'name'], name='billing_insu_facility_name_idx'),
        ),
        migrations.AddIndex(
            model_name='insuranceplan',
            index=models.Index(fields=['facility', 'provider'], name='billing_insu_facility_provider_idx'),
        ),
    ]
