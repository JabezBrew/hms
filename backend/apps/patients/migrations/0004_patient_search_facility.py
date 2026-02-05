from django.db import migrations, models


def set_patient_search_facility(apps, schema_editor):
    Facility = apps.get_model('core', 'Facility')
    PatientSearch = apps.get_model('patients', 'PatientSearch')

    facility = Facility.objects.order_by('created_at').first()
    if not facility:
        return

    PatientSearch.objects.filter(facility__isnull=True).update(facility=facility)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0009_facility_status_fields'),
        ('patients', '0003_alter_patientnote_facility_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='patientsearch',
            name='facility',
            field=models.ForeignKey(null=True, on_delete=models.PROTECT, related_name='patient_searches', to='core.facility'),
        ),
        migrations.RunPython(set_patient_search_facility, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='patientsearch',
            name='facility',
            field=models.ForeignKey(on_delete=models.PROTECT, related_name='patient_searches', to='core.facility'),
        ),
        migrations.AddIndex(
            model_name='patientsearch',
            index=models.Index(fields=['facility', 'user', '-search_date'], name='pat_search_fac_user_dt_idx'),
        ),
    ]
