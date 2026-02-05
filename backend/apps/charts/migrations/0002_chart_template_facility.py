from django.db import migrations, models


def set_chart_template_facility(apps, schema_editor):
    Facility = apps.get_model('core', 'Facility')
    ChartTemplate = apps.get_model('charts', 'ChartTemplate')

    facility = Facility.objects.order_by('created_at').first()
    if not facility:
        return

    ChartTemplate.objects.filter(facility__isnull=True).update(facility=facility)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('charts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='charttemplate',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='chart_templates', to='core.facility'),
        ),
        migrations.RunPython(set_chart_template_facility, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='charttemplate',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='chart_templates', to='core.facility'),
        ),
        migrations.AddIndex(
            model_name='charttemplate',
            index=models.Index(fields=['facility', 'visibility'], name='charts_template_facility_visibility_idx'),
        ),
    ]
