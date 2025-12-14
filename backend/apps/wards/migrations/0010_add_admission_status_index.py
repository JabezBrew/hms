# Generated migration for performance optimization
# Adds index on Admission.status for dashboard filtering

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('wards', '0009_add_ward_staff_assignment'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='admission',
            index=models.Index(fields=['status'], name='wards_admis_status_single_idx'),
        ),
    ]
