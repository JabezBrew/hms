# Generated migration for performance optimization
# Adds composite index on MedicationAdministration for dashboard prefetch queries

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('nursing', '0008_fluidbalance_colour_ng_suction'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='medicationadministration',
            index=models.Index(
                fields=['patient', 'status', 'scheduled_time'],
                name='nursing_med_patient_status_idx'
            ),
        ),
    ]
