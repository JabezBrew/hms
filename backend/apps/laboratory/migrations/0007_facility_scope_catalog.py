from django.db import migrations, models


def set_lab_catalog_facility(apps, schema_editor):
    Facility = apps.get_model('core', 'Facility')
    LabTestCatalog = apps.get_model('laboratory', 'LabTestCatalog')
    LabPanel = apps.get_model('laboratory', 'LabPanel')

    facility = Facility.objects.order_by('created_at').first()
    if not facility:
        return

    LabTestCatalog.objects.filter(facility__isnull=True).update(facility=facility)
    LabPanel.objects.filter(facility__isnull=True).update(facility=facility)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('laboratory', '0006_rename_lab_order_facility_status_idx_laboratory__facilit_1863e5_idx_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='labtestcatalog',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='lab_tests', to='core.facility'),
        ),
        migrations.AddField(
            model_name='labpanel',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='lab_panels', to='core.facility'),
        ),
        migrations.RunPython(set_lab_catalog_facility, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='labtestcatalog',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='lab_tests', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='labpanel',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='lab_panels', to='core.facility'),
        ),
        migrations.AlterField(
            model_name='labtestcatalog',
            name='code',
            field=models.CharField(max_length=20, help_text="Internal test code (e.g., 'CBC', 'BMP')"),
        ),
        migrations.AlterField(
            model_name='labpanel',
            name='code',
            field=models.CharField(max_length=20, help_text="Panel code (e.g., 'CMP', 'LFT')"),
        ),
        migrations.AddConstraint(
            model_name='labtestcatalog',
            constraint=models.UniqueConstraint(fields=('facility', 'code'), name='lab_test_facility_code_uniq'),
        ),
        migrations.AddConstraint(
            model_name='labpanel',
            constraint=models.UniqueConstraint(fields=('facility', 'code'), name='lab_panel_facility_code_uniq'),
        ),
        migrations.AddIndex(
            model_name='labtestcatalog',
            index=models.Index(fields=['facility', 'code'], name='lab_test_facility_code_idx'),
        ),
        migrations.AddIndex(
            model_name='labtestcatalog',
            index=models.Index(fields=['facility', 'is_active'], name='lab_test_facility_active_idx'),
        ),
        migrations.AddIndex(
            model_name='labpanel',
            index=models.Index(fields=['facility', 'code'], name='lab_panel_facility_code_idx'),
        ),
        migrations.AddIndex(
            model_name='labpanel',
            index=models.Index(fields=['facility', 'is_active'], name='lab_panel_facility_active_idx'),
        ),
    ]
